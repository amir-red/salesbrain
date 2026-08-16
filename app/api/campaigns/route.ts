import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

const CreateCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  deal_type: z.enum(['sales', 'grant', 'ai_credit']).default('sales'),
  persona_target: z.string().optional(),
  segment_definition: z.string().optional(),
  positioning_angle: z.string().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT c.*, u.name as created_by_name,
       (SELECT COUNT(*)::int FROM prospects WHERE campaign_id = c.id) as prospect_count,
       (SELECT COUNT(*)::int FROM outreach_messages om
          JOIN prospects p ON p.id = om.prospect_id
          WHERE p.campaign_id = c.id AND om.status = 'sent') as messages_sent
     FROM campaigns c
     LEFT JOIN users u ON u.id = c.created_by
     ORDER BY c.updated_at DESC`
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
  const parsed = CreateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const { rows } = await pool.query(
    `INSERT INTO campaigns (name, description, deal_type, persona_target, segment_definition, positioning_angle, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [d.name, d.description || null, d.deal_type, d.persona_target || null, d.segment_definition || null, d.positioning_angle || null, session.userId]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
