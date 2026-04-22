import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { exec_create_or_import_prospect } from '@/lib/prospect-executors';

const CreateProspectSchema = z.object({
  company_name: z.string().min(1),
  domain: z.string().optional(),
  full_name: z.string().min(1),
  email: z.string().email().optional(),
  title: z.string().optional(),
  source_type: z.string().optional(),
  source_detail: z.string().optional(),
  campaign_id: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const stage = params.get('stage');
  const ownerOnly = params.get('mine') === 'true';
  const campaignId = params.get('campaign_id');
  const replyStatus = params.get('reply_status');
  const isAdmin = session.role === 'admin';

  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  // Default visibility: regular users see only their own prospects (or legacy ones
  // with no owner). Admins see all. Explicit `?mine=true` still works as a further filter.
  if (!isAdmin && !ownerOnly) {
    filters.push(`(p.owner_user_id = $${i++} OR p.owner_user_id IS NULL)`);
    values.push(session.userId);
  } else if (ownerOnly) {
    filters.push(`p.owner_user_id = $${i++}`);
    values.push(session.userId);
  }

  if (stage) {
    filters.push(`p.stage = $${i++}`);
    values.push(stage);
  }
  if (campaignId) {
    filters.push(`p.campaign_id = $${i++}`);
    values.push(campaignId);
  }
  if (replyStatus) {
    filters.push(`p.reply_status = $${i++}`);
    values.push(replyStatus);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT p.*, a.name as company_name, a.domain, a.industry, a.company_size,
            c.full_name, c.email, c.title, c.seniority,
            u.name as owner_name
     FROM prospects p
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN contacts c ON c.id = p.contact_id
     LEFT JOIN users u ON u.id = p.owner_user_id
     ${where}
     ORDER BY p.updated_at DESC LIMIT 200`,
    values
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = CreateProspectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const result = await exec_create_or_import_prospect(parsed.data, { userId: session.userId });
  // Ensure prospect owner is the current user (contact owner is set via the executor).
  if (result.prospect_id) {
    await pool.query(`UPDATE prospects SET owner_user_id = $1 WHERE id = $2 AND owner_user_id IS NULL`, [session.userId, result.prospect_id]);
  }
  return NextResponse.json(result, { status: 201 });
}
