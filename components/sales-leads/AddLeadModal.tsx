'use client';

import { useState } from 'react';
import type { TeamUser } from '@/lib/sales-leads';

/**
 * Add one lead by hand (a business card, a name from a call). POST /api/sales-leads → crm_sales_lead_add: refuses a
 * duplicate and names it, fills the roles, writes the first track-record line, and gives the lead its prospect at
 * once so the agents can find the LinkedIn and enrich it.
 */
export default function AddLeadModal({ users, viewerId, onClose, onAdded }: {
  users: TeamUser[]; viewerId: string | null; onClose: () => void; onAdded: (name: string) => void;
}) {
  const me = users.find((u) => u.id === viewerId);
  const [f, setF] = useState({
    full_name: '', company: '', title: '', email: '', phone: '', linkedin_url: '', website: '',
    met_at: '', list_name: '', priority: '', must_talk: false, responsible: me?.email || '', front: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.full_name.trim()) { setError('A name is required.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/sales-leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error || 'Could not add the lead.');
      if (out.created === false) { setError(out.note || 'This person is already a lead.'); return; }
      onAdded(out.full_name || f.full_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the lead.');
    } finally { setBusy(false); }
  }

  const field = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
      {label}
      <input id={`add-${k}`} value={f[k] as string} onChange={set(k)} className="z-input text-sm" {...props} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" style={{ background: 'color-mix(in srgb, var(--text) 35%, transparent)' }}
      role="dialog" aria-modal="true" aria-labelledby="add-lead-title" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="z-card w-full max-w-2xl p-6 grid gap-4" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="z-eyebrow mb-1">Sales leads</div>
            <h2 id="add-lead-title" className="text-lg font-semibold">Add a lead</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>It lands as New, gets its prospect at once, and the agents look up the LinkedIn profile and enrich it.</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm px-2" aria-label="Close" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {field('full_name', 'Name *', { required: true, autoFocus: true, placeholder: 'Anna Berg' })}
          {field('company', 'Company', { placeholder: 'Berg Plastics GmbH' })}
          {field('title', 'Title / role', { placeholder: 'Geschäftsführerin' })}
          {field('email', 'Email', { type: 'email', placeholder: 'anna@berg.de' })}
          {field('phone', 'Phone', { placeholder: '+49 …' })}
          {field('linkedin_url', 'LinkedIn', { placeholder: 'linkedin.com/in/…' })}
          {field('website', 'Website', { placeholder: 'berg.de' })}
          {field('met_at', 'Where we met', { placeholder: 'Fakuma 2026' })}
          {field('list_name', 'List (optional)', { placeholder: 'Hannover Messe 2027' })}
          <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            Priority
            <select id="add-priority" value={f.priority} onChange={set('priority')} className="z-input text-sm">
              <option value="">Not set</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>P{n}{n === 1 ? ' · top' : ''}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            Back office (drives the lead)
            <select id="add-responsible" value={f.responsible} onChange={set('responsible')} className="z-input text-sm">
              <option value="">Me</option>
              {users.map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            Front office (the face in calls)
            <select id="add-front" value={f.front} onChange={set('front')} className="z-input text-sm">
              <option value="">Same as back office</option>
              {users.map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Notes
          <textarea id="add-notes" value={f.notes} onChange={set('notes')} rows={3} className="z-input text-sm" placeholder="What you talked about, what they need" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input id="add-must_talk" type="checkbox" checked={f.must_talk} onChange={set('must_talk')} /> Must talk (star it)
        </label>

        {error && <p className="text-sm rounded-lg px-3 py-2" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>Cancel</button>
          <button type="submit" disabled={busy} className="z-btn text-sm">{busy ? 'Adding…' : 'Add lead'}</button>
        </div>
      </form>
    </div>
  );
}
