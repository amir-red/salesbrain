'use client';

/**
 * "Client setup in Zeami" — rendered on /deals/[id] for sales deals (Zeami handover parts 3 + 4).
 *
 * Fetched once when the page opens (GET /api/deals/:id/zeami, which asks Zeami live). Stage labels and details are
 * rendered exactly as Zeami sends them, so a new stage on Zeami's side needs no change here. Names only — Zeami
 * sends no emails or ids. The support group can be added from here once; after that it is changed in Zeami.
 * The footer says what SalesBrain last told Zeami about the deal (deal won / sales rep changed).
 */

import { useCallback, useEffect, useState } from 'react';
import type { ZeamiOnboarding } from '@/lib/zeami';

interface SyncState {
  won_sent_at: string | null;
  rep_email: string | null;
  last_type: string | null;
  last_result: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
}

type Payload =
  | { state: 'found'; onboarding: ZeamiOnboarding; sync: SyncState | null; can_edit: boolean }
  | { state: 'not_onboarded'; sync: SyncState | null; can_edit: boolean }
  | { state: 'unavailable'; message: string; sync: SyncState | null; can_edit: boolean };

const STATUS: Record<string, { label: string; color: string }> = {
  not_started: { label: 'Not started', color: 'var(--text-muted)' },
  setting_up: { label: 'Setting up', color: 'var(--yellow)' },
  live: { label: 'Live', color: 'var(--green)' },
};

const RESULT: Record<string, string> = {
  applied: 'is now the client’s sales person in Zeami',
  unchanged: 'was already the client’s sales person in Zeami',
  suggested: 'was suggested to the Zeami operator, who had picked someone by hand',
  sales_rep_not_a_user: 'has no Zeami account, so Zeami changed nothing',
  no_sales_rep: 'none sent; Zeami linked the deal to the client',
  no_company_for_deal: 'not stored yet: no client is set up for this deal in Zeami',
};

function panelStyle() {
  return { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 } as const;
}

function inputStyle() {
  return {
    background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '6px 8px', color: 'var(--text)', fontSize: 13,
  } as const;
}

function pill(text: string, color: string) {
  return (
    <span style={{
      background: `color-mix(in srgb, ${color} 14%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
      borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 500,
    }}>{text}</span>
  );
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function Person({ role, name, backup }: { role: string; name: string | null; backup: string | null }) {
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{role}</div>
      <div className="text-sm" style={{ color: name ? 'var(--text)' : 'var(--text-muted)' }}>{name || 'Not set'}</div>
      {backup && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Backup: {backup}</div>}
    </div>
  );
}

function SyncLine({ sync }: { sync: SyncState | null }) {
  if (!sync?.last_attempt_at) return null;
  const what = sync.last_type === 'deal.sales_rep_changed' ? 'Sales rep change' : 'Deal won';
  const failed = sync.last_result === 'failed' || sync.last_result === 'rejected';
  const text = failed
    ? `${what} not delivered to Zeami yet: ${sync.last_error ?? 'no answer'}`
    : `${what} sent to Zeami ${fmtDate(sync.last_attempt_at)}: ${sync.rep_email ?? 'no sales rep'} `
      + (RESULT[sync.last_result ?? ''] ?? `(${sync.last_result})`);
  return (
    <div className="text-xs mt-3 pt-3" style={{ borderTop: '1px solid var(--border)', color: failed ? 'var(--red)' : 'var(--text-muted)' }}>
      {text}
    </div>
  );
}

export default function ZeamiOnboardingPanel({ dealId }: { dealId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/zeami`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) { setLoadError(body.error || `Could not load (${res.status})`); return; }
      setData(body as Payload);
      if (body.state === 'found' && !name) setName(`${body.onboarding.company?.name ?? ''} x Zeami support`.trim());
    } catch {
      setLoadError('Could not reach the server.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    if (!/^https:\/\//i.test(link.trim())) { setSaveError('The link must start with https://'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/zeami/support-group`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), link: link.trim() }),
      });
      const body = await res.json();
      if (!res.ok) { setSaveError(body.error || `Not saved (${res.status})`); return; }
      setData(body as Payload);
      setLink('');
    } catch {
      setSaveError('Not saved: could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  const heading = (right?: React.ReactNode) => (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Client setup in Zeami
      </h3>
      {right}
    </div>
  );

  if (loadError) {
    return <div style={panelStyle()}>{heading()}<div className="text-sm" style={{ color: 'var(--red)' }}>{loadError}</div></div>;
  }
  if (!data) {
    return <div style={panelStyle()}>{heading()}<div className="text-sm" style={{ color: 'var(--text-muted)' }}>Asking Zeami…</div></div>;
  }
  if (data.state === 'not_onboarded') {
    return (
      <div style={panelStyle()}>
        {heading(pill('Not onboarded yet', 'var(--text-muted)'))}
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No client is set up in the Zeami platform for this deal yet. Once an operator sets it up from this deal,
          its progress shows here.
        </div>
        <SyncLine sync={data.sync} />
      </div>
    );
  }
  if (data.state === 'unavailable') {
    return (
      <div style={panelStyle()}>
        {heading()}
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{data.message}</div>
        <SyncLine sync={data.sync} />
      </div>
    );
  }

  const o = data.onboarding;
  const status = STATUS[o.status] ?? { label: o.status, color: 'var(--text-muted)' };
  return (
    <div style={panelStyle()}>
      {heading(
        <div className="flex items-center gap-2">
          {o.went_live_at && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>live since {fmtDate(o.went_live_at)}</span>}
          {pill(status.label, status.color)}
        </div>,
      )}

      <ol className="flex flex-wrap gap-2 mb-4">
        {o.stages.map((s, i) => {
          const color = s.done ? 'var(--green)' : s.current ? 'var(--accent)' : 'var(--text-muted)';
          return (
            <li key={s.key} className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg"
                style={{ border: `1px solid ${s.current ? 'var(--accent)' : 'var(--border)'}`,
                         background: s.current ? 'var(--accent-soft)' : 'transparent' }}>
              <span aria-hidden style={{ color, fontWeight: 600 }}>{s.done ? '✓' : i + 1}</span>
              <span style={{ color: s.done || s.current ? 'var(--text)' : 'var(--text-muted)' }}>{s.label}</span>
              {s.detail && <span style={{ color: 'var(--text-muted)' }}>· {s.detail}</span>}
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Person role="Sales person" name={o.sales_person} backup={o.backup_sales_person} />
        <Person role="Project manager" name={o.project_manager} backup={o.backup_project_manager} />
      </div>

      <div>
        <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Support group</div>
        {o.support_group ? (
          <a href={o.support_group.link} target="_blank" rel="noopener noreferrer" className="text-sm"
             style={{ color: 'var(--accent)' }}>
            {o.support_group.name} ↗
          </a>
        ) : data.can_edit ? (
          <form onSubmit={addGroup} className="flex flex-wrap items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name"
                   style={{ ...inputStyle(), minWidth: 200 }} required />
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://chat.whatsapp.com/…"
                   style={{ ...inputStyle(), flex: 1, minWidth: 220 }} required />
            <button type="submit" disabled={saving} className="text-sm px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--accent)', color: 'var(--accent-fg)', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Adding…' : 'Add'}
            </button>
            <div className="w-full text-xs" style={{ color: saveError ? 'var(--red)' : 'var(--text-muted)' }}>
              {saveError ?? 'Can be added once from here; Zeami emails the project manager. Later changes are made in the Zeami console.'}
            </div>
          </form>
        ) : (
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>None yet</div>
        )}
      </div>

      <SyncLine sync={data.sync} />
    </div>
  );
}
