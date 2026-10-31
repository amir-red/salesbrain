'use client';

/**
 * The trust score on a row (095): the number in a coloured pill; click = the four parts as bars, the why line, the
 * path, value to us, and ✓ right / ↓ lower (POST /api/prospects/[id]/score-feedback → kernel crm_score_feedback,
 * audited; the person moves at once, the weekly review learns the list's weights from every mark).
 */
import { useEffect, useRef, useState } from 'react';
import { BAND_COLOR, PART_LABELS, TRUST_KIND_LABELS, VALUE_LABELS, partFractions, trustBand, type TrustSummary } from '@/lib/trust';

export default function ScoreBadge({ s, prospectId, size = 'sm', onChanged, readOnly }: {
  s: TrustSummary; prospectId?: string; size?: 'sm' | 'md'; onChanged?: () => void; readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const total = s.trust_total ?? null;
  const band = trustBand(total);
  const color = BAND_COLOR[band];
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const mark = async (direction: 'up' | 'down') => {
    if (!prospectId) return;
    setBusy(direction); setMsg(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/score-feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) { setMsg(out.error || 'Not saved'); return; }
      setMsg(`${out.before ?? '—'} → ${out.after ?? '—'}`);
      onChanged?.();
    } catch { setMsg('Not saved'); } finally { setBusy(null); }
  };

  const pad = size === 'md' ? 'h-8 px-2.5 text-sm' : 'h-6 px-2 text-xs';
  const bars = partFractions(s.trust_parts);
  return (
    <span ref={ref} className="relative inline-flex" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded-md font-semibold tabular-nums ${pad}`}
        style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color, border: '1px solid transparent' }}
        title={total == null ? 'not scored yet' : `Trust score ${total}: ${s.trust_why || ''} — click for the parts`}>
        {total ?? '—'}
        {s.has_feedback && <span aria-label="has feedback" style={{ fontSize: 9 }}>✓</span>}
      </button>
      {open && (
        <div role="dialog" className="absolute z-30 mt-1 left-0 top-full w-72 rounded-xl p-3 text-xs shadow-lg space-y-2"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          <div className="flex items-center justify-between">
            <span className="font-semibold">Trust score {total ?? '—'}</span>
            {s.value_to_us && <span style={{ color: 'var(--text-muted)' }}>{VALUE_LABELS[s.value_to_us] ?? s.value_to_us}</span>}
          </div>
          {bars.map((b) => (
            <div key={b.part} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2">
              <span style={{ color: 'var(--text-muted)' }} title={PART_LABELS[b.part]}>{b.label}</span>
              <span className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                <span className="block h-full rounded-full" style={{ width: `${Math.round(b.fraction * 100)}%`, background: color }} />
              </span>
              <span className="tabular-nums text-right">{b.points}/{b.max}</span>
            </div>
          ))}
          {s.held ? <div style={{ color: 'var(--text-muted)' }}>held {s.held > 0 ? '+' : ''}{s.held} by feedback</div> : null}
          {s.trust_why && <div style={{ color: 'var(--text-muted)' }}>{s.trust_why}</div>}
          <div style={{ color: 'var(--text-muted)' }}>
            {TRUST_KIND_LABELS[s.trust_kind ?? 'none'] ?? ''}{s.trust_via ? ` · via ${s.trust_via}` : ''}
            {s.multiplier ? ` · knows ${s.multiplier} on our lists` : ''}
          </div>
          {!readOnly && prospectId && (
            <div className="flex items-center gap-2 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
              <button type="button" disabled={busy !== null} onClick={() => void mark('up')} className="px-2 py-1 rounded-md font-medium"
                style={{ background: 'color-mix(in srgb, var(--green) 14%, transparent)', color: 'var(--green)' }} title="Yes, this rank is right (+8)">✓ right</button>
              <button type="button" disabled={busy !== null} onClick={() => void mark('down')} className="px-2 py-1 rounded-md font-medium"
                style={{ background: 'color-mix(in srgb, var(--orange) 14%, transparent)', color: 'var(--orange)' }} title="No, rank this person lower (−15)">↓ lower</button>
              {msg && <span style={{ color: msg.includes('→') ? 'var(--text-muted)' : 'var(--red)' }}>{msg}</span>}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
