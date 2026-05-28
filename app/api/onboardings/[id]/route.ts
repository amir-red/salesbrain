import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canMutate, canAssignAssistant, canAdvanceFrom, type OnboardingRow } from '@/lib/onboarding';

/**
 * GET /api/onboardings/[id]
 * Returns the onboarding row + joined deal/PM info.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT o.*,
            d.name as deal_name, d.company as deal_company, d.contact_email as deal_contact_email,
            d.contact_name as deal_contact_name,
            u.name as pm_name, u.email as pm_email,
            a.name as assistant_name, a.email as assistant_email
     FROM client_onboardings o
     LEFT JOIN deals d ON d.id = o.deal_id
     LEFT JOIN users u ON u.id = o.pm_user_id
     LEFT JOIN users a ON a.id = o.assistant_user_id
     WHERE o.id = $1`,
    [params.id]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    ...row,
    can_edit: canMutate(session, row),
    // Admin override flag for the UI — admins get the PM-reassignment dropdown.
    is_admin: session.role === 'admin',
    // Whether the viewer can pick/swap the assistant (PM or admin).
    can_assign_assistant: canAssignAssistant(session, row),
  });
}

// ─── PATCH: update fields and/or advance stage ──────────────────────────────

// All editable fields. Stage isn't directly settable — use `advance: true`
// to bump the stage (server enforces canAdvanceFrom).
const PatchSchema = z.object({
  pm_user_id: z.string().uuid().nullable().optional(),         // admin-only
  assistant_user_id: z.string().uuid().nullable().optional(),  // PM or admin
  status: z.enum(['in_progress', 'completed', 'paused']).optional(),

  // Stage 1
  company_name: z.string().min(1).max(255).optional(),
  website: z.string().max(512).nullable().optional(),
  company_size: z.string().max(64).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  primary_contact_email: z.union([z.string().email(), z.literal('')]).nullable().optional(),
  deployment_plan: z.enum(['on_premise', 'saas_cloud']).nullable().optional(),

  // Stage 2
  executive_name: z.string().max(255).nullable().optional(),
  executive_email: z.union([z.string().email(), z.literal('')]).nullable().optional(),
  executive_role: z.string().max(255).nullable().optional(),
  project_manager_name: z.string().max(255).nullable().optional(),
  project_manager_email: z.union([z.string().email(), z.literal('')]).nullable().optional(),
  it_admin_name: z.string().max(255).nullable().optional(),
  it_admin_email: z.union([z.string().email(), z.literal('')]).nullable().optional(),

  // Stage 3
  server_setup_done: z.boolean().optional(),
  app_setup_done: z.boolean().optional(),
  download_url: z.string().max(1024).nullable().optional(),
  app_credentials: z.string().max(2000).nullable().optional(),

  // Stage 4
  briefing_meeting_at: z.string().nullable().optional(),  // ISO datetime
  briefing_notes: z.string().max(5000).nullable().optional(),

  // Stage 5
  employee_count: z.number().int().nonnegative().nullable().optional(),
  employee_setup_notes: z.string().max(5000).nullable().optional(),

  // Stage 6
  deployment_started_at: z.string().nullable().optional(),

  // Stage 7
  audit_started_at: z.string().nullable().optional(),
  audit_notes: z.string().max(5000).nullable().optional(),

  // Stage 8
  pnl_ready_at: z.string().nullable().optional(),
  pnl_report_url: z.string().max(1024).nullable().optional(),

  // Action: bump stage by +1 if canAdvanceFrom(currentStage, row) is true
  advance: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  const { rows: existingRows } = await pool.query<OnboardingRow>(
    `SELECT * FROM client_onboardings WHERE id = $1`,
    [params.id]
  );
  const existing = existingRows[0];
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canMutate(session, existing)) {
    return NextResponse.json({ error: 'You are not the assigned PM' }, { status: 403 });
  }
  // pm_user_id reassignment is admin-only.
  if (d.pm_user_id !== undefined && session.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can reassign the PM' }, { status: 403 });
  }
  // assistant_user_id is PM-or-admin (the PM picks their own helper).
  if (d.assistant_user_id !== undefined && !canAssignAssistant(session, existing)) {
    return NextResponse.json({ error: 'Only the PM or an admin can assign the assistant' }, { status: 403 });
  }
  // Prevent the PM from assigning themselves as their own assistant
  // (no-op + confusing for the UI).
  if (d.assistant_user_id !== undefined && d.assistant_user_id !== null) {
    const effectivePm = d.pm_user_id !== undefined ? d.pm_user_id : existing.pm_user_id;
    if (d.assistant_user_id === effectivePm) {
      return NextResponse.json({ error: 'Assistant cannot be the same person as the PM' }, { status: 400 });
    }
  }

  // ── Build dynamic UPDATE for the editable fields ──
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const set = (col: string, v: unknown) => { sets.push(`${col} = $${i++}`); values.push(v); };

  // Empty-string emails → NULL
  const normEmail = (v: string | null | undefined): string | null =>
    v === undefined ? undefined as unknown as string | null
      : v === '' ? null
      : v;

  if (d.pm_user_id !== undefined)            set('pm_user_id', d.pm_user_id);
  if (d.assistant_user_id !== undefined)     set('assistant_user_id', d.assistant_user_id);
  if (d.status !== undefined)                set('status', d.status);
  if (d.company_name !== undefined)          set('company_name', d.company_name);
  if (d.website !== undefined)               set('website', d.website);
  if (d.company_size !== undefined)          set('company_size', d.company_size);
  if (d.description !== undefined)           set('description', d.description);
  if (d.primary_contact_email !== undefined) set('primary_contact_email', normEmail(d.primary_contact_email));
  if (d.deployment_plan !== undefined)       set('deployment_plan', d.deployment_plan);
  if (d.executive_name !== undefined)        set('executive_name', d.executive_name);
  if (d.executive_email !== undefined)       set('executive_email', normEmail(d.executive_email));
  if (d.executive_role !== undefined)        set('executive_role', d.executive_role);
  if (d.project_manager_name !== undefined)  set('project_manager_name', d.project_manager_name);
  if (d.project_manager_email !== undefined) set('project_manager_email', normEmail(d.project_manager_email));
  if (d.it_admin_name !== undefined)         set('it_admin_name', d.it_admin_name);
  if (d.it_admin_email !== undefined)        set('it_admin_email', normEmail(d.it_admin_email));
  if (d.server_setup_done !== undefined)     set('server_setup_done', d.server_setup_done);
  if (d.app_setup_done !== undefined)        set('app_setup_done', d.app_setup_done);
  if (d.download_url !== undefined)          set('download_url', d.download_url);
  if (d.app_credentials !== undefined)       set('app_credentials', d.app_credentials);
  if (d.briefing_meeting_at !== undefined)   set('briefing_meeting_at', d.briefing_meeting_at);
  if (d.briefing_notes !== undefined)        set('briefing_notes', d.briefing_notes);
  if (d.employee_count !== undefined)        set('employee_count', d.employee_count);
  if (d.employee_setup_notes !== undefined)  set('employee_setup_notes', d.employee_setup_notes);
  if (d.deployment_started_at !== undefined) set('deployment_started_at', d.deployment_started_at);
  if (d.audit_started_at !== undefined)      set('audit_started_at', d.audit_started_at);
  if (d.audit_notes !== undefined)           set('audit_notes', d.audit_notes);
  if (d.pnl_ready_at !== undefined)          set('pnl_ready_at', d.pnl_ready_at);
  if (d.pnl_report_url !== undefined)        set('pnl_report_url', d.pnl_report_url);

  if (sets.length > 0) {
    values.push(params.id);
    await pool.query(
      `UPDATE client_onboardings SET ${sets.join(', ')} WHERE id = $${i}`,
      values
    );
  }

  // ── Optionally advance the stage ──
  let advanced = false;
  if (d.advance) {
    // Re-fetch latest values after the field updates above
    const { rows: refreshed } = await pool.query<OnboardingRow>(
      `SELECT * FROM client_onboardings WHERE id = $1`, [params.id]
    );
    const row = refreshed[0]!;
    if (canAdvanceFrom(row.stage, row)) {
      const newStage = Math.min(8, row.stage + 1);
      const completedCol = `stage${row.stage}_completed_at`;
      const newStatus = newStage === 8 && row.stage === 7 ? 'in_progress' : row.status;  // status -> completed only on stage 8 done
      await pool.query(
        `UPDATE client_onboardings
         SET stage = $1, ${completedCol} = COALESCE(${completedCol}, now()), status = $2
         WHERE id = $3`,
        [newStage, newStatus, params.id]
      );
      advanced = true;
    } else {
      return NextResponse.json({ error: `Cannot advance from stage ${row.stage} — required fields missing` }, { status: 400 });
    }
  }

  // ── Auto-complete: if stage 8 has pnl_ready_at, mark status = completed
  const { rows: finalRows } = await pool.query<OnboardingRow>(
    `SELECT * FROM client_onboardings WHERE id = $1`, [params.id]
  );
  const final = finalRows[0]!;
  if (final.stage === 8 && final.pnl_ready_at && final.status !== 'completed') {
    await pool.query(
      `UPDATE client_onboardings SET status = 'completed', stage8_completed_at = COALESCE(stage8_completed_at, now()) WHERE id = $1`,
      [params.id]
    );
  }

  // Return latest row
  const { rows: outRows } = await pool.query(
    `SELECT o.*, d.name as deal_name, d.company as deal_company, d.contact_email as deal_contact_email,
            u.name as pm_name, u.email as pm_email,
            a.name as assistant_name, a.email as assistant_email
     FROM client_onboardings o
     LEFT JOIN deals d ON d.id = o.deal_id
     LEFT JOIN users u ON u.id = o.pm_user_id
     LEFT JOIN users a ON a.id = o.assistant_user_id
     WHERE o.id = $1`,
    [params.id]
  );
  return NextResponse.json({ ...outRows[0], advanced });
}
