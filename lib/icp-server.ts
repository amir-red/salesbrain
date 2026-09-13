/**
 * Server-only ICP helpers shared by the /api/icp route handlers. Next.js
 * forbids non-handler exports from route.ts files, so the request schema and
 * the audit shim live here.
 */
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
  objective: z.enum(['speed_to_market', 'volume', 'margin', 'logo', 'test_cases']).nullable().optional(),
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

/**
 * The ICP a request may READ: the owner's own, or any when the viewer is an
 * admin (the control panel's "owners see theirs, admins see all" rule). The
 * row carries `owner_user_id` so callers scope prospects by the ICP's owner,
 * not by the session — the bug that made a colleague's list come back empty.
 * Write routes keep their stricter owner-only checks.
 */
export async function visibleIcp(id: string, session: { userId: string; role: string }) {
  const { rows } = await pool.query(
    `SELECT i.*, u.name AS owner_name, u.email AS owner_email
       FROM icp_profiles i JOIN users u ON u.id = i.owner_user_id
      WHERE i.id = $1 AND (i.owner_user_id = $2 OR $3::boolean)`,
    [id, session.userId, session.role === 'admin'],
  );
  return (rows[0] ?? null) as (Record<string, unknown> & { id: string; name: string; owner_user_id: string; owner_name: string; is_active: boolean; paused_at: string | null }) | null;
}
