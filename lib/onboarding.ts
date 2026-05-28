/**
 * Pure helpers for the post-G9 client onboarding workflow.
 *
 * No DB / IO / `pool` imports here — this file is imported by client
 * components (e.g. app/onboarding/[id]/page.tsx) so it must stay
 * webpack-safe for the browser bundle. Server-only orchestration that
 * touches the DB or email service lives in `lib/onboarding-server.ts`.
 */

export interface OnboardingRow {
  id: string;
  deal_id: string;
  pm_user_id: string | null;
  /** Optional co-PM with the same edit rights as the PM. Lets a single
   *  onboarding be driven by two people without bottlenecking on one. */
  assistant_user_id: string | null;
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
  /** Primary client-side email for the project. Seeded from deal.contact_email
   *  at creation; the client can later confirm/update via the public form. */
  primary_contact_email: string | null;
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

/**
 * Returns the public form URL for the given token. This is the URL emailed to
 * the client. In production it points at zeami.io
 * (PUBLIC_FORM_BASE_URL=https://zeami.io/onboarding); in dev it falls back to
 * salesbrain's own /forms/onboarding page.
 *
 * Pure function — does not need a request object, so it works equally well
 * inside the agent loop, cron jobs, and route handlers.
 */
export function buildFormUrl(rawToken: string): string {
  const base = process.env.PUBLIC_FORM_BASE_URL?.replace(/\/+$/, '');
  if (base) return `${base}/${rawToken}`;
  const app = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${app}/forms/onboarding/${rawToken}`;
}

/**
 * The single welcome / kickoff email we send to a client when an onboarding
 * starts. Combines the welcome message, PM introduction, an outline of the
 * 8 stages, and the Stage-2 contacts-form CTA. Used both for the initial
 * auto-send (G9 / manual create) and for any resend via the "Send client
 * form" button on the detail page.
 */
export function composeOnboardingKickoffEmail(args: {
  companyName: string;
  formUrl: string;
  pmName?: string | null;
  pmEmail?: string | null;
}): { subject: string; body: string } {
  const { companyName, formUrl, pmName, pmEmail } = args;
  const subject = `[Zeami] Welcome — let's get ${companyName} set up`;
  const pmLine = pmName
    ? `Your project manager is <strong>${escapeHtml(pmName)}</strong>${pmEmail ? ` (<a href="mailto:${escapeHtml(pmEmail)}" style="color:#2563eb">${escapeHtml(pmEmail)}</a>)` : ''}. They'll guide you through every step.`
    : `Your project manager will be in touch shortly with personal introductions.`;
  const body = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111;">
  <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #2563eb; margin: 0;">Zeami onboarding</p>
  <h1 style="font-size: 22px; margin: 4px 0 16px;">Welcome, ${escapeHtml(companyName)}!</h1>

  <p>Thanks for partnering with Zeami. Over the next few weeks our team will be onboarding ${escapeHtml(companyName)} through 8 stages, ending with your live deployment and the first P&amp;L impact report.</p>

  <p>${pmLine}</p>

  <h2 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin: 24px 0 8px;">What to expect</h2>
  <ol style="line-height: 1.7; padding-left: 20px; margin: 0;">
    <li><strong>Company info</strong> — confirm the basics about your organization.</li>
    <li><strong>Project contacts</strong> — name your executive sponsor, project manager, and IT admin <em>(action needed below)</em>.</li>
    <li><strong>Access &amp; communication</strong> — we set up your instance and email your IT admin the deployment toolkit.</li>
    <li><strong>System briefing meeting</strong> — we walk your team through using Zeami.</li>
    <li><strong>Employee setup</strong> — your IT admin registers your team in Zeami.</li>
    <li><strong>Deploy Zeami</strong> — your team installs the app and logs in.</li>
    <li><strong>Automated audit</strong> — Zeami begins scanning workflow patterns.</li>
    <li><strong>P&amp;L report</strong> — after about 48 hours of data, your dashboard goes live.</li>
  </ol>

  <h2 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin: 28px 0 8px;">First step — confirm your contacts</h2>
  <p>To begin, please tell us who on your side will own each role on the project (executive sponsor, project manager, IT admin):</p>

  <p style="margin: 20px 0;">
    <a href="${escapeHtml(formUrl)}" style="display: inline-block; padding: 12px 22px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">Open the contacts form</a>
  </p>

  <p style="font-size: 12px; color: #6b7280;">This link is single-use and expires in 30 days. If you can't open the button, copy and paste this URL into your browser:<br /><span style="word-break: break-all; color: #6b7280;">${escapeHtml(formUrl)}</span></p>

  <p style="margin-top: 32px;">If anything's unclear, just reply to this email — we're happy to help.</p>
  <p style="margin: 4px 0 0;">— The Zeami team</p>
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
 * send emails, generate form links). PM, assigned assistant, or admin.
 */
export function canMutate(
  session: { userId: string; role?: string } | null,
  row: { pm_user_id: string | null; assistant_user_id?: string | null }
): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (session.userId === row.pm_user_id) return true;
  return session.userId === (row.assistant_user_id ?? null);
}

/**
 * True if the session can reassign the PM or the assistant. Reassigning PM is
 * still admin-only (canonical owner change), but the PM themselves (or an admin)
 * can pick/swap their assistant without escalating.
 */
export function canAssignAssistant(
  session: { userId: string; role?: string } | null,
  row: { pm_user_id: string | null }
): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  return session.userId === row.pm_user_id;
}

// Server-only token + email orchestration lives in `lib/onboarding-server.ts`
// so this file stays import-safe for client components.

// ─── Deal → onboarding prefill ──────────────────────────────────────────────

interface DealForPrefill {
  company: string;
  contact_email: string | null;
  notes: string | null;
  fields: Record<string, unknown> | null;
}

interface OnboardingPrefill {
  company_name: string;
  website: string | null;
  company_size: string | null;
  description: string | null;
  deployment_plan: 'on_premise' | 'saas_cloud' | null;
  primary_contact_email: string | null;
}

/**
 * Computes the values to seed a new client_onboardings row from a sales deal
 * at G9. Pulls from `deals.fields` (the agent's captured info) first, then
 * from a few sensible fallbacks (e.g. inferring website from the email domain
 * when sales never explicitly captured it).
 *
 * Used by both the G9 auto-create (lib/tool-executors.ts) and the manual
 * create endpoint (app/api/onboardings/route.ts) so they stay in sync.
 */
export function prefillFromDeal(deal: DealForPrefill): OnboardingPrefill {
  const fields = deal.fields ?? {};
  const get = (k: string): string | null => {
    const v = fields[k];
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v.trim() || null;
    return String(v);
  };

  // Website: explicit field wins; otherwise infer from the contact email
  // domain (e.g. bruk@chipchip.social → https://chipchip.social). Agent
  // doesn't currently capture website explicitly, so this fallback covers
  // the common case.
  let website = get('website');
  if (!website && deal.contact_email) {
    const at = deal.contact_email.indexOf('@');
    if (at > 0) {
      const domain = deal.contact_email.slice(at + 1).trim().toLowerCase();
      if (domain && !/^(gmail|yahoo|hotmail|outlook|icloud|proton|aol)\./i.test(domain)) {
        website = `https://${domain}`;
      }
    }
  }

  // Description: prefer a concise sales field; fall back to the company name
  // alone. Avoid `deal.notes` — it often contains a long internal concept
  // draft the client shouldn't see.
  const description = get('business_model')
    || get('pain_point')
    || null;

  const rawPlan = get('deployment_plan');
  const deployment_plan = rawPlan === 'on_premise' || rawPlan === 'saas_cloud' ? rawPlan : null;

  return {
    company_name: deal.company,
    website,
    company_size: get('company_size'),
    description,
    deployment_plan,
    primary_contact_email: deal.contact_email?.trim() || null,
  };
}
