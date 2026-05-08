'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

interface FormState {
  // 3 role contacts (required)
  executive_name: string;
  executive_email: string;
  executive_role: string;
  project_manager_name: string;
  project_manager_email: string;
  it_admin_name: string;
  it_admin_email: string;
  // Company-profile fields (prefilled, optional to update)
  website: string;
  company_size: string;
  description: string;
  deployment_plan: '' | 'on_premise' | 'saas_cloud';
  primary_contact_email: string;
}

const EMPTY: FormState = {
  executive_name: '', executive_email: '', executive_role: '',
  project_manager_name: '', project_manager_email: '',
  it_admin_name: '', it_admin_email: '',
  website: '', company_size: '', description: '',
  deployment_plan: '', primary_contact_email: '',
};

interface ServerState {
  company_name: string;
  website: string | null;
  company_size: string | null;
  description: string | null;
  deployment_plan: '' | 'on_premise' | 'saas_cloud' | null;
  primary_contact_email: string | null;
  expires_at: string;
  submitted_at: string | null;
  stage: number;
  status: 'in_progress' | 'completed' | 'paused';
  stage_completions: Record<`stage${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`, string | null>;
}

export default function OnboardingContactsForm() {
  const { token } = useParams<{ token: string }>();
  const [server, setServer] = useState<ServerState | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Poll for fresh progress so the client sees stages tick over without refresh
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const res = await fetch(`/api/public/onboarding/${token}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Link invalid');
      setServer(json);
      // Mirror prefill into the form state on first load only — don't clobber
      // anything the client has been typing.
      setForm((prev) => {
        if (prev !== EMPTY) return prev;
        return {
          ...prev,
          website: json.website ?? '',
          company_size: json.company_size ?? '',
          description: json.description ?? '',
          deployment_plan: (json.deployment_plan ?? '') as FormState['deployment_plan'],
          primary_contact_email: json.primary_contact_email ?? '',
        };
      });
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Link invalid');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [token]);

  // Once submitted, poll every 30s for stage updates so the timeline advances
  // without requiring a refresh.
  useEffect(() => {
    if (!server?.submitted_at) return;
    pollRef.current = setInterval(refresh, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [server?.submitted_at]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = {
        executive_name: form.executive_name,
        executive_email: form.executive_email,
        executive_role: form.executive_role || undefined,
        project_manager_name: form.project_manager_name,
        project_manager_email: form.project_manager_email,
        it_admin_name: form.it_admin_name,
        it_admin_email: form.it_admin_email,
        website: form.website || null,
        company_size: form.company_size || null,
        description: form.description || null,
        primary_contact_email: form.primary_contact_email || null,
      };
      if (form.deployment_plan) body.deployment_plan = form.deployment_plan;

      const res = await fetch(`/api/public/onboarding/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Submission failed');
      // Pull the fresh state so we transition into the progress view.
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  const submitted = !!server?.submitted_at;

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-2xl rounded-xl p-8" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="mb-6">
          <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Zeami onboarding</p>
          <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>
            {submitted ? `Onboarding ${server!.company_name}` : 'Project setup form'}
          </h1>
          {server && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Link expires {new Date(server.expires_at).toLocaleDateString()}.
          </p>}
        </div>

        {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}

        {linkError && (
          <div className="rounded p-3 text-sm" style={{ background: 'rgba(251, 113, 133, 0.1)', color: '#fb7185' }}>
            {linkError}<br />
            <span style={{ color: 'var(--text-muted)' }} className="text-xs">
              If you believe this is a mistake, please reach out to your project manager so they can issue a new link.
            </span>
          </div>
        )}

        {/* Progress view — shown after submission, on every subsequent visit */}
        {!loading && !linkError && submitted && server && (
          <ProgressTimeline server={server} />
        )}

        {/* Form view — only before submission */}
        {!loading && !linkError && !submitted && (
          <FormBody
            form={form}
            setForm={setForm}
            onSubmit={submit}
            submitting={submitting}
            submitError={submitError}
            companyName={server?.company_name}
          />
        )}
      </div>
    </div>
  );
}

// ─── Progress timeline ──────────────────────────────────────────────────────

const STAGES = [
  { n: 1, title: 'Company info',                     desc: 'Confirm your basic organization details.' },
  { n: 2, title: 'Project contacts',                 desc: 'Tell us who on your side owns each role.' },
  { n: 3, title: 'Access & communication',           desc: 'We are setting up your system. We will email the IT admin with a link to download our tool and their credentials within the next few hours.' },
  { n: 4, title: 'System briefing meeting',          desc: 'Once the IT admin has the tool, we schedule a briefing with your contact person to walk through how to use the app, register employees, and grant access levels.' },
  { n: 5, title: 'Employee setup',                   desc: 'After the briefing, the IT admin registers your employee data and distributes Zeami to the team.' },
  { n: 6, title: 'Deploy Zeami',                     desc: 'Employees install and log in to Zeami using the credentials provided by the IT admin.' },
  { n: 7, title: 'Start automated system audit',     desc: 'Initializing automated audit protocols. Zeami begins scanning workflow patterns.' },
  { n: 8, title: 'P&L Report',                       desc: 'After ~48 hours of data, you will see automation opportunities and P&L impact on your dashboard.' },
] as const;

function ProgressTimeline({ server }: { server: ServerState }) {
  const completions = server.stage_completions;
  return (
    <div className="space-y-4">
      <div className="rounded-lg p-4" style={{ background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
        <div className="flex items-start gap-3">
          <div className="text-xl">✓</div>
          <div>
            <p className="font-semibold" style={{ color: '#34d399' }}>Thanks — your form is submitted.</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Submitted on {new Date(server.submitted_at!).toLocaleString()}. Your project manager will be in touch within 1–2 business days. This page now shows your live onboarding progress — bookmark it.
            </p>
          </div>
        </div>
      </div>

      <ol className="relative" style={{ paddingLeft: 28 }}>
        <span
          aria-hidden
          className="absolute"
          style={{ left: 17, top: 16, bottom: 16, width: 2, background: 'var(--border)' }}
        />
        {STAGES.map((s) => {
          const completed = !!completions[`stage${s.n}` as keyof typeof completions];
          const isCurrent = !completed && server.stage === s.n;
          const isFuture = !completed && server.stage < s.n;
          let circleBg = 'var(--bg-input)';
          let circleColor = 'var(--text-muted)';
          let circleBorder = '2px solid var(--border)';
          if (completed) { circleBg = '#34d399'; circleColor = '#0b1220'; circleBorder = 'none'; }
          else if (isCurrent) { circleBg = 'var(--accent)'; circleColor = '#0b1220'; circleBorder = 'none'; }

          return (
            <li key={s.n} className="relative mb-3 rounded-lg p-3 transition-colors"
                style={{
                  background: 'var(--bg-input)',
                  border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}`,
                  opacity: isFuture ? 0.6 : 1,
                }}>
              <div
                aria-hidden
                className="absolute flex items-center justify-center font-bold text-[11px]"
                style={{
                  left: -28, top: 12,
                  width: 28, height: 28, borderRadius: '50%',
                  background: circleBg, color: circleColor, border: circleBorder,
                }}
              >
                {completed ? '✓' : s.n}
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {s.title}
                {isCurrent && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
                    In progress
                  </span>
                )}
                {completed && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399' }}>
                    Done
                  </span>
                )}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{s.desc}</p>
              {completed && (
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  Completed {new Date(completions[`stage${s.n}` as keyof typeof completions]!).toLocaleDateString()}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Form body (extracted to keep the page slim) ────────────────────────────

interface FormBodyProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  submitError: string | null;
  companyName?: string;
}

function FormBody(props: FormBodyProps) {
  const { form, setForm, onSubmit, submitting, submitError, companyName } = props;
  return (
    <>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
        {companyName ? <>To kick off onboarding for <strong style={{ color: 'var(--text)' }}>{companyName}</strong>, please confirm the company details below and tell us who'll be your project contacts.</> : <>Please confirm the details below.</>}
      </p>

      <form onSubmit={onSubmit} className="space-y-5">
        <FieldGroup title="About your company" hint="Confirm or update what we already have on file.">
          <Input label="Website"      value={form.website}      onChange={(v) => setForm({ ...form, website: v })} placeholder="https://acme.com" />
          <Input label="Company size" value={form.company_size} onChange={(v) => setForm({ ...form, company_size: v })} placeholder="e.g. 50–200" />
          <Textarea label="Brief description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="What does your company do?" />
          <Input label="Primary contact email" value={form.primary_contact_email} onChange={(v) => setForm({ ...form, primary_contact_email: v })} type="email" />
        </FieldGroup>

        <FieldGroup title="Deployment plan" hint="How would you like Zeami deployed for your team?">
          <RadioGroup
            name="deployment_plan"
            value={form.deployment_plan}
            onChange={(v) => setForm({ ...form, deployment_plan: v as FormState['deployment_plan'] })}
            options={[
              { value: 'on_premise', label: 'On-premise', description: 'Secure local deployment · air-gapped compliance · full infrastructure control' },
              { value: 'saas_cloud', label: 'SaaS Cloud', description: 'Fully managed instance · auto-scaling · instant updates & support' },
            ]}
          />
        </FieldGroup>

        <FieldGroup title="Executive sponsor" hint="High-level stakeholder.">
          <Input label="Name"  value={form.executive_name}  onChange={(v) => setForm({ ...form, executive_name: v })} required />
          <Input label="Email" value={form.executive_email} onChange={(v) => setForm({ ...form, executive_email: v })} type="email" required />
          <Input label="Role / title" value={form.executive_role} onChange={(v) => setForm({ ...form, executive_role: v })} />
        </FieldGroup>

        <FieldGroup title="Project manager" hint="Main point of contact for coordination on your side.">
          <Input label="Name"  value={form.project_manager_name}  onChange={(v) => setForm({ ...form, project_manager_name: v })} required />
          <Input label="Email" value={form.project_manager_email} onChange={(v) => setForm({ ...form, project_manager_email: v })} type="email" required />
        </FieldGroup>

        <FieldGroup title="IT admin" hint="Responsible for technical deployment and user management.">
          <Input label="Name"  value={form.it_admin_name}  onChange={(v) => setForm({ ...form, it_admin_name: v })} required />
          <Input label="Email" value={form.it_admin_email} onChange={(v) => setForm({ ...form, it_admin_email: v })} type="email" required />
        </FieldGroup>

        {submitError && <p className="text-sm" style={{ color: '#fb7185' }}>{submitError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-4 py-3 rounded text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#0b1220' }}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
        <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
          You can keep this link bookmarked — after submitting it'll show your live onboarding progress.
        </p>
      </form>
    </>
  );
}

// ─── Reusable form atoms ────────────────────────────────────────────────────

function FieldGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg p-4" style={{ border: '1px solid var(--border)' }}>
      <legend className="px-1 text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</legend>
      {hint && <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function Input({
  label, value, onChange, type = 'text', required, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
        {label} {required && <span style={{ color: '#fb7185' }}>*</span>}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded border text-sm"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
      />
    </label>
  );
}

function Textarea({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <textarea
        value={value}
        rows={3}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded border text-sm"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
      />
    </label>
  );
}

function RadioGroup({
  name, value, onChange, options,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; description: string }[];
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className="cursor-pointer rounded-lg p-3 transition-colors"
            style={{
              background: selected ? 'var(--accent-glow)' : 'var(--bg-input)',
              border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full inline-block flex-shrink-0"
                style={{
                  background: selected ? 'var(--accent)' : 'transparent',
                  border: `2px solid ${selected ? 'var(--accent)' : 'var(--text-muted)'}`,
                }}
              />
              <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{opt.label}</span>
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>{opt.description}</p>
          </label>
        );
      })}
    </div>
  );
}
