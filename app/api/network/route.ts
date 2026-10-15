import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  buildGraphFromData,
  type ContactRow,
  type AccountRow,
  type ProspectRow,
  type DealRow,
  type MessageCountRow,
} from '@/lib/network-graph';

export const dynamic = 'force-dynamic';

/**
 * GET /api/network
 * Returns the full network graph payload for the current user.
 *
 * Visibility: TEAM-WIDE (Amir, 2026-10-15: "the networks should be shared across
 * the team") — every signed-in user sees every contact, prospect link, deal and
 * message count, with the holder's name on each contact node. Same rule as
 * /pipeline. Per-user privacy on `contacts` still applies to /api/contacts
 * and the agent; this page is the shared map.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = true; // team-wide by decision — kept as a flag so the scoping branches below stay readable

  // 1. Contacts (team-wide), with the holder's name
  const contactsSql = `SELECT c.id, c.account_id, c.full_name, c.first_name, c.last_name, c.email, c.title, c.seniority,
              c.persona_type, c.phone, c.linkedin_url, c.notes, c.source, c.owner_user_id,
              u.name AS owner_name, c.communication_profile, c.created_at, c.updated_at
       FROM contacts c LEFT JOIN users u ON u.id = c.owner_user_id ORDER BY c.updated_at DESC`;
  const contactsValues: unknown[] = [];
  const { rows: contactRows } = await pool.query(contactsSql, contactsValues);
  const contacts = contactRows as ContactRow[];

  if (contacts.length === 0) {
    return NextResponse.json({
      nodes: [],
      edges: [],
      meta: { industries: [], locations: [], companies: [], contact_count: 0, account_count: 0 },
    });
  }

  const accountIds = Array.from(new Set(contacts.map((c) => c.account_id).filter(Boolean))) as string[];
  const contactIds = contacts.map((c) => c.id);

  // 2. Accounts referenced by these contacts
  let accounts: AccountRow[] = [];
  if (accountIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT id, name, domain, website, industry, company_size, hq_location, notes
       FROM accounts WHERE id = ANY($1::uuid[])`,
      [accountIds]
    );
    accounts = rows as AccountRow[];
  }

  // 3. Prospects whose contact_id is in this set (per-user scoped)
  let prospects: ProspectRow[] = [];
  if (contactIds.length > 0) {
    const prospectFilter = isAdmin ? '' : ' AND (owner_user_id = $2 OR owner_user_id IS NULL)';
    const prospectValues = isAdmin ? [contactIds] : [contactIds, session.userId];
    const { rows } = await pool.query(
      `SELECT id, account_id, contact_id, stage, reply_status, converted_deal_id, last_contacted_at
       FROM prospects WHERE contact_id = ANY($1::uuid[])${prospectFilter}`,
      prospectValues
    );
    prospects = rows as ProspectRow[];
  }

  // 4. Deals matching account names (per-user scoped on deals)
  let deals: DealRow[] = [];
  if (accounts.length > 0) {
    const names = accounts.map((a) => a.name.toLowerCase());
    const dealFilter = isAdmin ? '' : ' AND user_id = $2';
    const dealValues = isAdmin ? [names] : [names, session.userId];
    const { rows } = await pool.query(
      `SELECT id, name, company, gate, deal_type
       FROM deals WHERE LOWER(company) = ANY($1::text[]) AND deleted_at IS NULL${dealFilter}`,
      dealValues
    );
    deals = rows as DealRow[];
  }

  // 5. Imported message counts per contact (for sizing)
  let messageCounts: MessageCountRow[] = [];
  if (contactIds.length > 0) {
    const msgFilter = isAdmin ? '' : ' AND user_id = $2';
    const msgValues = isAdmin ? [contactIds] : [contactIds, session.userId];
    const { rows } = await pool.query(
      `SELECT contact_id, COUNT(*)::int as msg_count
       FROM imported_messages
       WHERE contact_id = ANY($1::uuid[])${msgFilter}
       GROUP BY contact_id`,
      msgValues
    );
    messageCounts = rows as MessageCountRow[];
  }

  const graph = buildGraphFromData({ contacts, accounts, prospects, deals, messageCounts });
  return NextResponse.json(graph);
}
