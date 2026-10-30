/**
 * Server-only ICP helpers shared by the /api/icp route handlers. Next.js
 * forbids non-handler exports from route.ts files, so the request schema and
 * the audit shim live here.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';

const BandSchema = z.enum(['c_level', 'founder', 'vp', 'head', 'director', 'manager', 'senior']);
const CriteriaSchema = z.object({
  titles: z.array(z.string()).default([]),
  seniority: z.array(BandSchema).default([]),
  locations: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  company_sizes: z.array(z.string()).default([]),
  exclude_titles: z.array(z.string()).default([]),
  exclude_companies: z.array(z.string()).default([]),
  weights: z.record(z.string(), z.number().min(0).max(100)).optional(),
});

export const IcpBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  product: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  // 'list' = a hand-made list the Leads Finder never searches (Lead Conductor, 068); the builder sends it back unchanged.
  objective: z.enum(['speed_to_market', 'volume', 'margin', 'logo', 'test_cases', 'list']).nullable().optional(),
  // What the list sends once a connection request is accepted (053): one approval card per acceptance.
  first_message_template: z.string().trim().max(1900).nullable().optional(),
  criteria: CriteriaSchema,
});

/** Same table the kernel audits to (agent_audit_log), so builder saves sit next to agent ones. */
export async function auditBestEffort(userId: string, command: string, input: Record<string, unknown>) {
  try {
    await pool.query(
      `INSERT INTO agent_audit_log (actor_user_id, command, input, status, detail)
       VALUES ($1, $2, $3, 'success', 'web')`,
      [userId, command, JSON.stringify(input)],
    );
  } catch { /* audit must never fail the request */ }
}

type IcpRow = Record<string, unknown> & {
  id: string; name: string; owner_user_id: string; owner_name: string; is_active: boolean; paused_at: string | null;
  /** The viewer may change this list: its owner or an admin. */
  can_edit: boolean;
};

/**
 * The ICP a request may READ: any list, for every signed-in teammate (Amir 2026-10-26: "all the ICPs visible for
 * everyone, and who the owner is"). The row carries the owner and `can_edit`. Leads are scoped by the LIST
 * (prospects.icp_profile_id), never by the owner: a list's leads can be held by several people (the sending account).
 * Every route that CHANGES a list uses `guardEditable`.
 */
export async function visibleIcp(id: string, session: { userId: string; role: string }): Promise<IcpRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { rows } = await pool.query(
    `SELECT i.*, u.name AS owner_name, u.email AS owner_email,
            (i.owner_user_id = $2 OR $3::boolean) AS can_edit
       FROM icp_profiles i JOIN users u ON u.id = i.owner_user_id
      WHERE i.id = $1`,
    [id, session.userId, session.role === 'admin'],
  );
  return (rows[0] ?? null) as IcpRow | null;
}

export const NOT_EDITABLE = 'Only the list’s owner or an admin can change this list.';

/** For write handlers: the list when the viewer may change it, else the response to return (404 missing, 403 view-only). */
export async function guardEditable(id: string, session: { userId: string; role: string }):
    Promise<{ icp: IcpRow; denied?: undefined } | { icp?: undefined; denied: NextResponse }> {
  const icp = await visibleIcp(id, session);
  if (!icp) return { denied: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (!icp.can_edit) return { denied: NextResponse.json({ error: NOT_EDITABLE }, { status: 403 }) };
  return { icp };
}
