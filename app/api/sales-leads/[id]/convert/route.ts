/**
 * POST /api/sales-leads/:id/convert
 *
 * Converts a captured demo-form lead into a sales deal at G1
 * (Lead Qualification). The new deal:
 *   - inherits the lead's company / contact_name / contact_email
 *   - is named "<company> — Demo request" (editable later)
 *   - is owned (user_id) by the caller and assigned to them as lead_id
 *   - stores the source description into deal.notes so the agent has it
 *
 * The lead row is marked converted with a link to the new deal.
 *
 * Idempotent: if the lead is already converted, returns the existing deal id.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getMissingFields } from '@/lib/gates';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Load the lead. Re-converting returns the existing deal.
  const { rows: leadRows } = await pool.query(
    'SELECT * FROM sales_leads WHERE id = $1',
    [id],
  );
  const lead = leadRows[0];
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  if (lead.status === 'converted' && lead.converted_deal_id) {
    return NextResponse.json(
      { deal_id: lead.converted_deal_id, already_converted: true },
      { status: 200 },
    );
  }

  const dealName = `${lead.company} — Demo request`;
  const missing = getMissingFields(1, {}, 'sales');

  // Append the preferred demo time as a single structured line so the agent
  // can spot it on the next chat turn (predictable prefix → easy to parse).
  // Skipped when the form didn't include the demo-time fields.
  const demoLine = (() => {
    if (!lead.preferred_demo_date) return null;
    const time = (lead.preferred_demo_time as string | null) || '00:00:00';
    const tz = (lead.preferred_demo_timezone as string | null) || 'UTC';
    try {
      const t = time.length === 5 ? `${time}:00` : time;
      const d = new Date(`${lead.preferred_demo_date}T${t}Z`);
      if (isNaN(d.getTime())) return null;
      const dateFmt = new Intl.DateTimeFormat('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      });
      const timeFmt = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
      });
      return `Preferred demo: ${dateFmt.format(d)} · ${timeFmt.format(d)} · ${tz}`;
    } catch {
      return `Preferred demo: ${lead.preferred_demo_date} · ${time} · ${tz}`;
    }
  })();

  const noteParts: string[] = ['Demo request from zeami.io.'];
  if (demoLine) noteParts.push(demoLine);
  if (lead.description) noteParts.push('--- Their message ---', lead.description);
  else if (!demoLine) noteParts[0] = 'Demo request from zeami.io. No description provided.';
  const notes = noteParts.join('\n');

  // Best-effort transaction: deal + lead update in one shot. Postgres autocommits
  // each statement separately when not in a transaction; using a single client
  // keeps them together for the typical happy path.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: dealRows } = await client.query(
      `INSERT INTO deals
        (name, company, contact_name, contact_email, notes, missing,
         user_id, lead_id, deal_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'sales')
       RETURNING id`,
      [dealName, lead.company, lead.full_name, lead.email, notes, missing, session.userId],
    );
    const dealId = dealRows[0].id;

    await client.query(
      `UPDATE sales_leads
       SET status = 'converted', converted_deal_id = $1,
           converted_at = now(), converted_by = $2
       WHERE id = $3`,
      [dealId, session.userId, id],
    );
    await client.query('COMMIT');
    return NextResponse.json({ deal_id: dealId, already_converted: false }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[sales-leads convert] failed:', err);
    return NextResponse.json({ error: 'Failed to convert lead' }, { status: 500 });
  } finally {
    client.release();
  }
}
