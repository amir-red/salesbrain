/**
 * Pure helpers for the post-G9 client onboarding workflow.
 * No DB calls or IO here — this file is testable in isolation.
 */

export interface OnboardingRow {
  id: string;
  deal_id: string;
  pm_user_id: string | null;
  stage: number;
  status: 'in_progress' | 'completed' | 'paused';

  company_name: string;
  website: string | null;
  company_size: string | null;
  description: string | null;

  executive_name: string | null;
  executive_email: string | null;
  executive_role: string | null;
  project_manager_name: string | null;
  project_manager_email: string | null;
  it_admin_name: string | null;
  it_admin_email: string | null;
  /** Carried over from the deal at G9. 'on_premise' | 'saas_cloud' | null. */
  deployment_plan: 'on_premise' | 'saas_cloud' | null;

  server_setup_done: boolean;
  app_setup_done: boolean;
  download_url: string | null;
  app_credentials: string | null;
  email_sent_at: string | null;

  briefing_meeting_at: string | null;
  briefing_notes: string | null;

  employee_count: number | null;
  employee_setup_notes: string | null;

  deployment_started_at: string | null;

  audit_started_at: string | null;
  audit_notes: string | null;

  pnl_ready_at: string | null;
  pnl_report_url: string | null;

  stage1_completed_at: string | null;
  stage2_completed_at: string | null;
  stage3_completed_at: string | null;
  stage4_completed_at: string | null;
  stage5_completed_at: string | null;
  stage6_completed_at: string | null;
  stage7_completed_at: string | null;
  stage8_completed_at: string | null;

  created_at: string;
  updated_at: string;
}

export interface StageDef {
  number: number;
  name: string;
  description: string;
  color: string;             // kanban column accent
}

export const STAGES: StageDef[] = [
  { number: 1, name: 'Company Info',         description: 'Basic organization details — usually prefilled from the deal.', color: '#1D4ED8' },
  { number: 2, name: 'Contact Person & Roles', description: 'Executive, project manager, and IT admin contacts.', color: '#1D4ED8' },
  { number: 3, name: 'Access & Communication', description: 'Server + app setup, then email IT admin with download links.', color: '#6D28D9' },
  { number: 4, name: 'System Briefing Meeting', description: 'Walk the contact + IT admin through the application.', color: '#6D28D9' },
  { number: 5, name: 'Employee Setup',       description: 'IT admin registers employee data into Zeami.', color: '#6D28D9' },
  { number: 6, name: 'Deploy Zeami',         description: 'Employees install the software and log in.', color: '#D97706' },
  { number: 7, name: 'Start Automated Audit', description: 'Initialize audit protocols; system scans for workflow patterns.', color: '#D97706' },
  { number: 8, name: 'P&L Report (Live)',    description: 'Dashboard transitions to Active state; client sees automation opportunities.', color: '#166534' },
];

export function getStage(n: number): StageDef | undefined {
  return STAGES.find((s) => s.number === n);
}

/** Returns true if the row has all data needed to advance to the next stage. */
export function canAdvanceFrom(stage: number, row: OnboardingRow): boolean {
  switch (stage) {
    case 1:
      return !!row.company_name?.trim();
    case 2:
      return !!(
        row.executive_name && row.executive_email &&
        row.project_manager_name && row.project_manager_email &&
        row.it_admin_name && row.it_admin_email
      );
    case 3:
      return row.server_setup_done && row.app_setup_done && !!row.email_sent_at;
    case 4:
      return !!row.briefing_meeting_at;
    case 5:
      return !!row.employee_count && row.employee_count > 0;
    case 6:
      return !!row.deployment_started_at;
    case 7:
      return !!row.audit_started_at;
    case 8:
      return !!row.pnl_ready_at;
    default:
      return false;
  }
}

/** Days the onboarding has spent in its current stage (for kanban sorting). */
export function daysInCurrentStage(row: OnboardingRow): number {
  const enteredAt = row[`stage${(row.stage - 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}_completed_at` as keyof OnboardingRow] as string | null;
  const start = enteredAt ? Date.parse(enteredAt) : Date.parse(row.created_at);
  if (Number.isNaN(start)) return 0;
  return Math.floor((Date.now() - start) / 86400_000);
}

// ─── Email composition ───────────────────────────────────────────────────────

export function composeItAdminEmail(row: OnboardingRow): { subject: string; body: string } {
  const subject = `[Zeami] Welcome — your deployment toolkit for ${row.company_name}`;
  const adminName = row.it_admin_name?.trim() || 'IT Administrator';
  const downloadUrl = row.download_url || '(download link not provided)';
  const creds = row.app_credentials || '(credentials will be provided separately)';

  // Plain-HTML email so Resend renders nicely in any client.
  const body = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111;">
  <h1 style="font-size: 20px; margin: 0 0 16px;">Welcome to Zeami, ${adminName}</h1>

  <p>Your organization (<strong>${row.company_name}</strong>) is now set up on Zeami's work intelligence platform. As the IT admin, here's everything you need to roll Zeami out to your team.</p>

  <h2 style="font-size: 16px; margin: 24px 0 8px;">Download the Zeami app</h2>
  <p><a href="${downloadUrl}" style="color: #2563eb; word-break: break-all;">${downloadUrl}</a></p>

  <h2 style="font-size: 16px; margin: 24px 0 8px;">Your admin credentials</h2>
  <pre style="background: #f4f4f5; padding: 12px; border-radius: 6px; font-size: 13px; white-space: pre-wrap;">${escapeHtml(creds)}</pre>
  <p style="font-size: 12px; color: #6b7280;">Please rotate this password on first login. Do not forward this email.</p>

  <h2 style="font-size: 16px; margin: 24px 0 8px;">Next steps</h2>
  <ol style="line-height: 1.6;">
    <li>Install the Zeami app on a test machine using the link above.</li>
    <li>Log in with the admin credentials provided.</li>
    <li>We'll schedule a briefing meeting to walk you through registering employees and granting access levels.</li>
    <li>Once your team is registered, distribute the install link to staff.</li>
  </ol>

  <p style="margin-top: 24px;">If anything's unclear, reply to this email and your project manager will help.</p>
  <p>— The Zeami team</p>
</div>
`.trim();

  return { subject, body };
}

export function composeClientFormEmail(formUrl: string, companyName: string): { subject: string; body: string } {
  const subject = `[Zeami] Please confirm your project contacts for ${companyName}`;
  const body = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111;">
  <h1 style="font-size: 20px; margin: 0 0 16px;">Hello from Zeami!</h1>
  <p>To kick off the onboarding for <strong>${companyName}</strong>, we need three points of contact on your side:</p>
  <ul style="line-height: 1.6;">
    <li><strong>Executive sponsor</strong> — high-level stakeholder.</li>
    <li><strong>Project manager</strong> — main point of contact for coordination.</li>
    <li><strong>IT admin</strong> — responsible for technical deployment and user management.</li>
  </ul>
  <p>Please fill them in here:</p>
  <p><a href="${formUrl}" style="display: inline-block; padding: 12px 20px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">Open the contacts form</a></p>
  <p style="font-size: 12px; color: #6b7280;">This link is single-use and expires in 30 days. If you have any questions, just reply to this email.</p>
  <p>— The Zeami team</p>
</div>
`.trim();
  return { subject, body };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Permission helpers ─────────────────────────────────────────────────────

/**
 * True if the session can mutate this onboarding (advance stages, fill fields,
 * send emails, generate form links). PM or admin only.
 */
export function canMutate(
  session: { userId: string; role?: string } | null,
  row: { pm_user_id: string | null }
): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  return session.userId === row.pm_user_id;
}
