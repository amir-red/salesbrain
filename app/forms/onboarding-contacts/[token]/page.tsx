'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface FormState {
  executive_name: string;
  executive_email: string;
  executive_role: string;
  project_manager_name: string;
  project_manager_email: string;
  it_admin_name: string;
  it_admin_email: string;
}

const EMPTY: FormState = {
  executive_name: '', executive_email: '', executive_role: '',
  project_manager_name: '', project_manager_email: '',
  it_admin_name: '', it_admin_email: '',
};

export default function OnboardingContactsForm() {
  const { token } = useParams<{ token: string }>();
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/onboarding-contacts/${token}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Link invalid');
        setCompanyName(json.company_name);
      } catch (e) {
        setLinkError(e instanceof Error ? e.message : 'Link invalid');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/public/onboarding-contacts/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Submission failed');
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-xl rounded-xl p-8" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="mb-6">
          <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Zeami onboarding</p>
          <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>Project contacts</h1>
        </div>

        {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading form…</p>}

        {linkError && (
          <div className="rounded p-3 text-sm" style={{ background: 'rgba(251, 113, 133, 0.1)', color: '#fb7185' }}>
            {linkError}<br />
            <span style={{ color: 'var(--text-muted)' }} className="text-xs">
              If you believe this is a mistake, please reach out to your project manager so they can issue a new link.
            </span>
          </div>
        )}

        {done && (
          <div className="rounded p-4 text-center" style={{ background: 'rgba(52, 211, 153, 0.1)', color: '#34d399' }}>
            <p className="text-2xl">✓</p>
            <p className="font-semibold mt-2">Thanks! Your contacts have been saved.</p>
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              Your project manager will be in touch within 1–2 business days.
            </p>
          </div>
        )}

        {!loading && !linkError && !done && (
          <>
            <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
              {companyName ? <>To kick off onboarding for <strong style={{ color: 'var(--text)' }}>{companyName}</strong>, we need three points of contact on your side.</> : <>We need three points of contact on your side.</>}
            </p>

            <form onSubmit={submit} className="space-y-5">
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
                {submitting ? 'Submitting…' : 'Submit contacts'}
              </button>
              <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
                This link is single-use. After submission you'll receive a confirmation message above.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

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
  label, value, onChange, type = 'text', required,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
        {label} {required && <span style={{ color: '#fb7185' }}>*</span>}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded border text-sm"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
      />
    </label>
  );
}
