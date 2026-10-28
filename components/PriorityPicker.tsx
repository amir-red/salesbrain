'use client';

/**
 * The one person priority (1 = top … 10, blank = not set), the same number on a prospect, a lead card and the
 * opportunity it becomes (2026-10-28). Shown as a coloured P-badge; click to change. Saves through POST /api/priority
 * (kernel `crm_set_priority`, audited). Pass `prospectId` for a lead row, `dealId` for an opportunity.
 */
import { useState } from 'react';
import { PRIORITY_LEVELS, priorityLevel } from '@/lib/sales-leads';

export default function PriorityPicker({ value, prospectId, dealId, size = 'sm', readOnly, onChanged }: {
  value: number | null | undefined; prospectId?: string; dealId?: string; size?: 'sm' | 'md'; readOnly?: boolean;
  onChanged?: (priority: number | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lvl = priorityLevel(value);
  const save = async (next: number) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/priority', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId, deal_id: dealId, priority: next }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) { setErr(out.error || 'Not saved'); return; }
      onChanged?.(next || null);
    } catch { setErr('Not saved'); } finally { setBusy(false); }
  };
  const pad = size === 'md' ? 'h-8 px-2.5 text-sm' : 'h-6 px-1.5 text-[11px]';
  const style = {
    background: lvl ? `color-mix(in srgb, ${lvl.color} 14%, transparent)` : 'var(--bg-input)',
    color: lvl ? lvl.color : 'var(--text-muted)', border: `1px solid ${lvl ? 'transparent' : 'var(--border)'}`,
  } as const;
  if (readOnly || (!prospectId && !dealId)) {
    return <span className={`inline-flex items-center rounded-md font-semibold tabular-nums ${pad}`} style={style} title={lvl ? `priority ${lvl.label}` : 'no priority set'}>{lvl ? lvl.short : '—'}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <select value={value ?? 0} disabled={busy} onChange={(e) => void save(Number(e.target.value))} aria-label="Priority"
        title={lvl ? `priority ${lvl.label} — click to change` : 'set a priority (1 = top)'}
        className={`rounded-md font-semibold tabular-nums outline-none cursor-pointer appearance-none text-center disabled:opacity-50 ${pad}`} style={style}>
        <option value={0}>—</option>
        {PRIORITY_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.short}</option>)}
      </select>
      {err && <span className="text-[10px]" style={{ color: 'var(--red)' }}>{err}</span>}
    </span>
  );
}
