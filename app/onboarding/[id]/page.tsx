'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { STAGES, canAdvanceFrom, type OnboardingRow } from '@/lib/onboarding';

interface DetailRow extends OnboardingRow {
  deal_name: string | null;
  deal_company: string | null;
  deal_contact_email: string | null;
  deal_contact_name: string | null;
  pm_name: string | null;
  pm_email: string | null;
  assistant_name: string | null;
  assistant_email: string | null;
  can_edit: boolean;
  is_admin: boolean;
  can_assign_assistant: boolean;
}

interface UserOption {
  id: string;
  name: string;
  email: string;
}

export default function OnboardingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<DetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingStage, setSavingStage] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/onboardings/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setRow(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [id]);

  // Lazily fetch the user list when the row tells us we're an admin —
  // populates the PM-reassignment dropdown.
  useEffect(() => {
    if (!row?.is_admin || users.length > 0) return;
    (async () => {
      try {
        const res = await fetch('/api/users');
        if (res.ok) setUsers(await res.json());
      } catch { /* non-fatal */ }
    })();
  }, [row?.is_admin, users.length]);

  async function patch(updates: Record<string, unknown>): Promise<DetailRow | null> {
    setSavingStage(row?.stage ?? null);
    try {
      const res = await fetch(`/api/onboardings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setRow({ ...(row as DetailRow), ...json });
      return json;
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Failed');
      setTimeout(() => setToast(null), 3500);
      return null;
    } finally {
      setSavingStage(null);
    }
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  if (loading) return <Loading />;
  if (error || !row) return <Loading message={error || 'Not found'} error />;

  const ro = !row.can_edit;

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      <Sidebar />
      <div className="flex-1 flex overflow-hidden">
        {/* Left stepper */}
        <aside className="w-72 border-r overflow-y-auto p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          <Link href="/onboarding" className="text-xs hover:underline" style={{ color: 'var(--text-muted)' }}>
            ← Back to kanban
          </Link>
          <h1 className="text-lg font-bold mt-3" style={{ color: 'var(--text)' }}>{row.company_name}</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            From deal: <Link href={`/?deal=${row.deal_id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>{row.deal_name ?? row.deal_id.slice(0, 8)}</Link>
          </p>
          {row.is_admin ? (
            <div className="mt-2">
              <label className="text-[10px] uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>
                Project Manager
              </label>
              <select
                value={row.pm_user_id ?? ''}
                onChange={async (e) => {
                  const next = e.target.value || null;
                  const result = await patch({ pm_user_id: next });
                  if (result) flash(next ? 'PM reassigned' : 'PM cleared');
                }}
                className="mt-1 w-full px-2 py-1 rounded border text-xs"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              PM: {row.pm_name || 'Unassigned'}
            </p>
          )}
          {/* Assistant slot — co-PM with the same edit rights. PM or admin
              can pick; everyone else sees a read-only label. */}
          {row.can_assign_assistant ? (
            <div className="mt-2">
              <label className="text-[10px] uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>
                Assistant
              </label>
              <select
                value={row.assistant_user_id ?? ''}
                onChange={async (e) => {
                  const next = e.target.value || null;
                  const result = await patch({ assistant_user_id: next });
                  if (result) flash(next ? 'Assistant assigned' : 'Assistant cleared');
                }}
                className="mt-1 w-full px-2 py-1 rounded border text-xs"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <option value="">— None —</option>
                {users
                  .filter((u) => u.id !== row.pm_user_id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
              </select>
            </div>
          ) : row.assistant_name ? (
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Assistant: {row.assistant_name}
            </p>
          ) : null}
          {ro && (
            <p className="text-[11px] mt-2 px-2 py-1 rounded" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
              Read-only — only the assigned PM, the assistant, or an admin can edit.
            </p>
          )}

          <div className="mt-5 space-y-1">
            {STAGES.map((s) => {
              const completed = !!(row[`stage${s.number as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}_completed_at` as keyof DetailRow]);
              const isCurrent = s.number === row.stage;
              return (
                <a
                  key={s.number}
                  href={`#stage-${s.number}`}
                  className="flex items-center gap-2 p-2 rounded hover:bg-white/5 transition-colors"
                  style={{
                    background: isCurrent ? 'var(--accent-glow)' : 'transparent',
                    color: completed ? '#34d399' : isCurrent ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: completed ? '#34d399' : isCurrent ? 'var(--accent)' : 'var(--bg-input)', color: completed || isCurrent ? '#0b1220' : 'var(--text-muted)' }}>
                    {completed ? '✓' : s.number}
                  </span>
                  <span className="text-xs">{s.name}</span>
                </a>
              );
            })}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-8">
            {/* Stage 1 */}
            <Section number={1} row={row} title="Company Info">
              <DeploymentPlanBadge plan={row.deployment_plan} />
              <Field label="Company name" value={row.company_name} onChange={(v) => patch({ company_name: v })} disabled={ro} required />
              <Field label="Website"      value={row.website ?? ''}      onChange={(v) => patch({ website: v || null })} disabled={ro} />
              <Field label="Company size" value={row.company_size ?? ''} onChange={(v) => patch({ company_size: v || null })} disabled={ro} placeholder="e.g. 50–200" />
              <Field label="Description"  value={row.description ?? ''}  onChange={(v) => patch({ description: v || null })} disabled={ro} multiline />
              <Field label="Primary contact email" value={row.primary_contact_email ?? ''} onChange={(v) => patch({ primary_contact_email: v })} disabled={ro} type="email" placeholder="primary point of contact on the client side" />
              <AdvanceBtn row={row} stage={1} onAdvance={async () => { const r = await patch({ advance: true }); if (r) flash('Advanced to Stage 2'); }} disabled={ro} />
            </Section>

            {/* Stage 2 */}
            <Section number={2} row={row} title="Contact Person & Roles">
              <ContactGroup label="Executive sponsor"
                name={row.executive_name ?? ''}  onName={(v) => patch({ executive_name: v || null })}
                email={row.executive_email ?? ''} onEmail={(v) => patch({ executive_email: v })}
                role={row.executive_role ?? ''}  onRole={(v) => patch({ executive_role: v || null })}
                disabled={ro} />
              <ContactGroup label="Project manager (client-side)"
                name={row.project_manager_name ?? ''}  onName={(v) => patch({ project_manager_name: v || null })}
                email={row.project_manager_email ?? ''} onEmail={(v) => patch({ project_manager_email: v })}
                disabled={ro} />
              <ContactGroup label="IT admin"
                name={row.it_admin_name ?? ''}  onName={(v) => patch({ it_admin_name: v || null })}
                email={row.it_admin_email ?? ''} onEmail={(v) => patch({ it_admin_email: v })}
                disabled={ro} />
              <Stage2ClientForm onboardingId={row.id} disabled={ro} flash={flash} dealContactEmail={row.deal_contact_email} />
              <AdvanceBtn row={row} stage={2} onAdvance={async () => { const r = await patch({ advance: true }); if (r) flash('Advanced to Stage 3'); }} disabled={ro} />
            </Section>

            {/* Stage 3 */}
            <Section number={3} row={row} title="Access & Communication">
              <Toggle label="Server Setup done" checked={row.server_setup_done} onChange={(v) => patch({ server_setup_done: v })} disabled={ro} />
              <Toggle label="App Setup done"    checked={row.app_setup_done}    onChange={(v) => patch({ app_setup_done: v })} disabled={ro} />
              <Field label="Download URL"  value={row.download_url ?? ''}  onChange={(v) => patch({ download_url: v || null })} disabled={ro} placeholder="https://download.zeami.io/..." />
              <Field label="Admin credentials"  value={row.app_credentials ?? ''}  onChange={(v) => patch({ app_credentials: v || null })} disabled={ro || !!row.email_sent_at} multiline placeholder="Username + temporary password. Cleared from the database after the email is sent." />
              <Stage3SendBtn row={row} disabled={ro} reload={load} flash={flash} />
              {row.email_sent_at && (
                <p className="text-xs" style={{ color: '#34d399' }}>
                  ✓ IT-Admin email sent {new Date(row.email_sent_at).toLocaleString()} to {row.it_admin_email}. Credentials have been cleared from the database.
                </p>
              )}
            </Section>

            {/* Stage 4 */}
            <Section number={4} row={row} title="System Briefing Meeting">
              <Field label="Meeting datetime" type="datetime-local"
                value={row.briefing_meeting_at ? row.briefing_meeting_at.slice(0, 16) : ''}
                onChange={(v) => patch({ briefing_meeting_at: v ? new Date(v).toISOString() : null })} disabled={ro} />
              <Field label="Notes" value={row.briefing_notes ?? ''} onChange={(v) => patch({ briefing_notes: v || null })} disabled={ro} multiline />
              <AdvanceBtn row={row} stage={4} onAdvance={async () => { const r = await patch({ advance: true }); if (r) flash('Advanced to Stage 5'); }} disabled={ro} />
            </Section>

            {/* Stage 5 */}
            <Section number={5} row={row} title="Employee Setup">
              <Field label="Employee count" type="number"
                value={row.employee_count?.toString() ?? ''}
                onChange={(v) => patch({ employee_count: v ? parseInt(v, 10) : null })} disabled={ro} />
              <Field label="Notes" value={row.employee_setup_notes ?? ''} onChange={(v) => patch({ employee_setup_notes: v || null })} disabled={ro} multiline />
              <AdvanceBtn row={row} stage={5} onAdvance={async () => { const r = await patch({ advance: true }); if (r) flash('Advanced to Stage 6'); }} disabled={ro} />
            </Section>

            {/* Stage 6 */}
            <Section number={6} row={row} title="Deploy Zeami">
              <Toggle label="Deployment started" checked={!!row.deployment_started_at}
                onChange={(v) => patch({ deployment_started_at: v ? new Date().toISOString() : null })}
                disabled={ro} />
              <AdvanceBtn row={row} stage={6} onAdvance={async () => { const r = await patch({ advance: true }); if (r) flash('Advanced to Stage 7'); }} disabled={ro} />
            </Section>

            {/* Stage 7 */}
            <Section number={7} row={row} title="Start Automated Audit">
              <Toggle label="Audit started" checked={!!row.audit_started_at}
                onChange={(v) => patch({ audit_started_at: v ? new Date().toISOString() : null })}
                disabled={ro} />
              <Field label="Notes" value={row.audit_notes ?? ''} onChange={(v) => patch({ audit_notes: v || null })} disabled={ro} multiline />
              <AdvanceBtn row={row} stage={7} onAdvance={async () => { const r = await patch({ advance: true }); if (r) flash('Advanced to Stage 8'); }} disabled={ro} />
            </Section>

            {/* Stage 8 */}
            <Section number={8} row={row} title="P&L Report — Live">
              <Field label="P&L report URL" value={row.pnl_report_url ?? ''} onChange={(v) => patch({ pnl_report_url: v || null })} disabled={ro} placeholder="https://app.zeami.io/clients/.../pnl" />
              <Toggle label="Report ready" checked={!!row.pnl_ready_at}
                onChange={(v) => patch({ pnl_ready_at: v ? new Date().toISOString() : null })} disabled={ro} />
              {row.status === 'completed' && (
                <p className="text-xs" style={{ color: '#34d399' }}>
                  ✓ Onboarding complete on {row.stage8_completed_at ? new Date(row.stage8_completed_at).toLocaleDateString() : 'today'}.
                </p>
              )}
            </Section>

            {savingStage !== null && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Saving…</p>}
          </div>
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 px-3 py-2 rounded text-sm shadow-lg z-40" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Small reusable building blocks ─────────────────────────────────────────

function Loading({ message, error }: { message?: string; error?: boolean } = {}) {
  return (
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      <Sidebar />
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: error ? '#fb7185' : 'var(--text-muted)' }}>
        {message ?? 'Loading…'}
      </div>
    </div>
  );
}

function Section({ number, row, title, children }: { number: number; row: DetailRow; title: string; children: React.ReactNode }) {
  const completed = !!(row[`stage${number as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}_completed_at` as keyof DetailRow]);
  const isCurrent = row.stage === number;
  const stage = STAGES.find((s) => s.number === number)!;
  return (
    <section
      id={`stage-${number}`}
      className="rounded-lg overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}`,
        opacity: !isCurrent && !completed && number > row.stage ? 0.5 : 1,
      }}
    >
      <header className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Stage {number} {completed ? '· Completed' : isCurrent ? '· Current' : ''}
          </p>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</h2>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: stage.color, color: '#fff' }}>
          {completed ? '✓ Done' : isCurrent ? 'In progress' : 'Locked'}
        </span>
      </header>
      <div className="p-4 space-y-3">
        {children}
      </div>
    </section>
  );
}

function Field({
  label, value, onChange, disabled, type = 'text', multiline, placeholder, required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const Cmp = (multiline ? 'textarea' : 'input') as 'textarea' | 'input';
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
        {label} {required && <span style={{ color: '#fb7185' }}>*</span>}
      </span>
      <Cmp
        type={type}
        value={local}
        placeholder={placeholder}
        disabled={disabled}
        rows={multiline ? 3 : undefined}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onChange(local); }}
        className="w-full px-2 py-1.5 rounded border text-sm"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="text-sm" style={{ color: 'var(--text)' }}>{label}</span>
    </label>
  );
}

function ContactGroup({
  label, name, onName, email, onEmail, role, onRole, disabled,
}: {
  label: string;
  name: string; onName: (v: string) => void;
  email: string; onEmail: (v: string) => void;
  role?: string; onRole?: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="rounded p-3" style={{ border: '1px solid var(--border)' }}>
      <legend className="text-[11px] px-1 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name" value={name} onChange={onName} disabled={disabled} />
        <Field label="Email" value={email} onChange={onEmail} disabled={disabled} type="email" />
      </div>
      {onRole && <Field label="Role / title" value={role ?? ''} onChange={onRole} disabled={disabled} />}
    </fieldset>
  );
}

function AdvanceBtn({ row, stage, onAdvance, disabled }: { row: DetailRow; stage: number; onAdvance: () => void; disabled?: boolean }) {
  if (row.stage !== stage) return null;
  if (stage === 8) return null; // stage 8 completes via pnl_ready_at toggle
  const can = canAdvanceFrom(stage, row);
  return (
    <button
      onClick={onAdvance}
      disabled={disabled || !can}
      className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-40"
      style={{ background: 'var(--accent)', color: '#0b1220' }}
      title={!can ? 'Required fields are missing' : ''}
    >
      Mark Stage {stage} complete →
    </button>
  );
}

// ─── Stage 2: send-client-form button ───────────────────────────────────────

function Stage2ClientForm({ onboardingId, disabled, flash, dealContactEmail }: {
  onboardingId: string; disabled?: boolean; flash: (m: string) => void; dealContactEmail: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [override, setOverride] = useState('');

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/onboardings/${onboardingId}/form-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override.trim() ? { to: override.trim() } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setLink(json.url);
      flash(json.email_sent ? `Form link emailed to ${json.recipient}` : 'Form link generated');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded p-3" style={{ border: '1px dashed var(--border)' }}>
      <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
        Resend the welcome / contacts form to the client
      </p>
      <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        A welcome email with the form link is sent automatically when an onboarding starts.
        Use this if the client lost it — a new single-use link will be issued.
      </p>
      <div className="flex gap-2">
        <input
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          placeholder={dealContactEmail || 'client@company.com'}
          disabled={disabled || busy}
          className="flex-1 px-2 py-1.5 rounded border text-sm"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
        <button
          onClick={generate}
          disabled={disabled || busy}
          className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0b1220' }}
        >
          {busy ? '…' : 'Resend client form'}
        </button>
      </div>
      {link && (
        <p className="text-xs mt-2 break-all" style={{ color: 'var(--text-muted)' }}>
          Link: <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{link}</a>
        </p>
      )}
    </div>
  );
}

// ─── Stage 3: send IT-admin email ───────────────────────────────────────────

function DeploymentPlanBadge({ plan }: { plan: 'on_premise' | 'saas_cloud' | null }) {
  // Carried over from the deal at G9 — read-only here. If missing, surface
  // a warning so the PM can flag it back to sales rather than guessing.
  if (!plan) {
    return (
      <div className="rounded p-3 text-xs flex items-center justify-between" style={{ background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', color: '#fbbf24' }}>
        <span>
          <strong>Deployment plan not set.</strong> This should have been captured at G7 (Negotiation). Confirm with the sales team before proceeding.
        </span>
      </div>
    );
  }
  const isOnPrem = plan === 'on_premise';
  return (
    <div className="rounded p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Deployment plan</span>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded"
          style={{
            background: isOnPrem ? 'rgba(167, 139, 250, 0.2)' : 'rgba(52, 211, 153, 0.2)',
            color: isOnPrem ? '#a78bfa' : '#34d399',
          }}
        >
          {isOnPrem ? 'On-premise' : 'SaaS Cloud'}
        </span>
      </div>
      <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
        {isOnPrem
          ? 'Secure local deployment · air-gapped compliance · full infrastructure control. Stage 3 download URL points to the on-premise installer.'
          : 'Fully managed instance · auto-scaling infrastructure · instant updates & support. Stage 3 download URL points to the cloud client.'}
      </p>
    </div>
  );
}

function Stage3SendBtn({ row, disabled, reload, flash }: { row: DetailRow; disabled?: boolean; reload: () => void; flash: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (row.email_sent_at) return null;
  const ready = row.server_setup_done && row.app_setup_done && !!row.download_url?.trim() && !!row.app_credentials?.trim() && !!row.it_admin_email?.trim();
  async function send() {
    setBusy(true);
    try {
      const res = await fetch(`/api/onboardings/${row.id}/send-email`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      flash(`Email sent to ${json.sent_to}`);
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={send}
      disabled={disabled || busy || !ready}
      className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-40"
      style={{ background: 'var(--accent)', color: '#0b1220' }}
      title={!ready ? 'Fill server/app/download/credentials/IT-admin email first' : ''}
    >
      {busy ? 'Sending…' : 'Send IT-Admin email →'}
    </button>
  );
}
