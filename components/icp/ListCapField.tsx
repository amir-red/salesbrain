'use client';

/**
 * The Leads Finder's cap for one list (migration 105): how many people it may add before it stops searching this
 * list. Only people the Leads Finder found count; imported or hand-added people never fill it. The owner is told once
 * when the list reaches the cap. Saved on its own (POST /api/icp/[id]/cap), so it never waits on the other settings.
 */
import { useEffect, useState } from 'react';
import { Info, Search } from '@/components/icons';

interface Status {
  searched?: boolean; ready?: boolean; missing?: string[];
  cap?: { cap: number; count: number; full: boolean; left: number };
  max_leads_set?: number | null; searches?: number; finished?: number;
  stop?: { kind: string; reason: string } | null; error?: string;
}

const muted = { color: 'var(--text-muted)' } as const;

export default function ListCapField({ icpId, editable }: { icpId: string; editable: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const r = await fetch(`/api/icp/${icpId}/cap`).catch(() => null);
    const j: Status = r ? await r.json().catch(() => ({ error: 'Could not read the list status' })) : { error: 'Network error' };
    setStatus(j);
    if (j.cap) setValue(String(j.max_leads_set ?? j.cap.cap));
  };
  useEffect(() => { void load(); }, [icpId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (n: number) => {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`/api/icp/${icpId}/cap`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_leads: n }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) setMsg({ ok: false, text: j.error || 'Not saved' });
      else { setMsg({ ok: true, text: n === 0 ? 'Back to the default' : 'Saved' }); await load(); }
    } finally { setSaving(false); }
  };

  if (!status) return <div className="h-10 rounded-xl animate-pulse motion-reduce:animate-none" style={{ background: 'var(--bg-input)' }} />;
  if (status.error || !status.cap) return <p className="text-xs" style={muted}>{status.error || 'No cap information yet.'}</p>;

  const { cap } = status;
  const pct = Math.min(100, Math.round((cap.count / Math.max(1, cap.cap)) * 100));
  const n = Number(value);
  const dirty = value.trim() !== '' && Number.isInteger(n) && n > 0 && n !== (status.max_leads_set ?? cap.cap);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Search width={16} height={16} style={{ color: 'var(--accent)' }} />Most people the Leads Finder adds
        <span title="Only people the Leads Finder found count; imported or hand-added people never fill it. When the list reaches the cap, the Leads Finder stops searching it and the owner is told once."
          className="inline-flex" style={muted}><Info width={14} height={14} /></span>
      </div>
      <div className="flex items-center gap-3">
        <input type="number" min={1} max={100000} value={value} onChange={(e) => setValue(e.target.value)}
          aria-label="Cap for this list" className="z-input text-sm w-28" disabled={!editable || saving} />
        <div className="flex-1 min-w-0">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
            <div className="h-full" style={{ width: `${pct}%`, background: cap.full ? 'var(--orange)' : 'var(--accent)' }} />
          </div>
          <p className="text-[11px] mt-1" style={{ color: cap.full ? 'var(--orange)' : 'var(--text-muted)' }}>
            {cap.count} of {cap.cap} added{cap.full ? ' · full, not searched' : ` · ${cap.left} left`}
            {status.max_leads_set == null ? ' · default' : ''}
          </p>
        </div>
        {editable && (
          <button type="button" className="z-btn" disabled={!dirty || saving} onClick={() => void save(n)}>
            {saving ? 'Saving…' : 'Save cap'}
          </button>
        )}
      </div>
      {editable && status.max_leads_set != null && (
        <button type="button" className="text-[11px] underline" style={muted} disabled={saving} onClick={() => void save(0)}>
          Use the default
        </button>
      )}
      {status.searched !== false && status.stop && status.stop.kind !== 'full' && (
        <p className="text-xs" style={{ color: 'var(--orange)' }}>{status.stop.reason}</p>
      )}
      {status.searched !== false && !status.stop && (status.finished ?? 0) > 0 && (
        <p className="text-[11px]" style={muted}>{status.finished} of {status.searches} searches finished (they stopped finding people who fit).</p>
      )}
      {msg && <p className="text-xs" role="status" style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</p>}
    </div>
  );
}
