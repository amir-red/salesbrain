import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';

  const { rows: accountRows } = await pool.query(`SELECT * FROM accounts WHERE id = $1`, [params.id]);
  if (accountRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Contacts: scoped per user (unless admin). Legacy NULL-owner contacts visible to all.
  const contactsFilter = isAdmin
    ? `WHERE account_id = $1`
    : `WHERE account_id = $1 AND (owner_user_id = $2 OR owner_user_id IS NULL)`;
  const contactsValues = isAdmin ? [params.id] : [params.id, session.userId];

  // Prospects: scoped per user via owner_user_id.
  const prospectsFilter = isAdmin
    ? `WHERE p.account_id = $1`
    : `WHERE p.account_id = $1 AND (p.owner_user_id = $2 OR p.owner_user_id IS NULL)`;
  const prospectsValues = isAdmin ? [params.id] : [params.id, session.userId];

  const [contacts, prospects, deals] = await Promise.all([
    pool.query(`SELECT * FROM contacts ${contactsFilter} ORDER BY created_at DESC`, contactsValues),
    pool.query(
      `SELECT p.*, c.full_name as contact_name FROM prospects p
       LEFT JOIN contacts c ON c.id = p.contact_id
       ${prospectsFilter} ORDER BY p.updated_at DESC`,
      prospectsValues
    ),
    // Deals already follow their own visibility rules (admin sees all, users see own elsewhere).
    // On the account page we show ALL deals for this company since deals are org-visible in pipeline/reports.
    pool.query(
      `SELECT id, name, gate, score, verdict, value, currency, deal_type, created_at
       FROM deals WHERE LOWER(company) = LOWER($1) ORDER BY updated_at DESC`,
      [accountRows[0].name]
    ),
  ]);

  return NextResponse.json({
    account: accountRows[0],
    contacts: contacts.rows,
    prospects: prospects.rows,
    deals: deals.rows,
  });
}
