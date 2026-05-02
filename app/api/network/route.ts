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
 * Visibility (matches /api/contacts):
 * - Regular users: their own contacts (owner_user_id = userId) + legacy NULL-owner.
 * - Admins: all contacts.
 * Accounts are org-wide (no per-user scoping at the account level).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';

  // 1. Contacts (per-user scoped)
  const contactsSql = isAdmin
    ? `SELECT id, account_id, full_name, first_name, last_name, email, title, seniority,
              persona_type, phone, linkedin_url, notes, source, owner_user_id,
              communication_profile, created_at, updated_at
       FROM contacts ORDER BY updated_at DESC`
    : `SELECT id, account_id, full_name, first_name, last_name, email, title, seniority,
              persona_type, phone, linkedin_url, notes, source, owner_user_id,
              communication_profile, created_at, updated_at
       FROM contacts
       WHERE owner_user_id = $1 OR owner_user_id IS NULL
       ORDER BY updated_at DESC`;
  const contactsValues = isAdmin ? [] : [session.userId];
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
       FROM deals WHERE LOWER(company) = ANY($1::text[])${dealFilter}`,
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
