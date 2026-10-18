'use client';

/**
 * Quick ranges (Today · Yesterday · Last 7 days), a More menu (This / Last month,
 * This / Last year) and a calendar for any range. Every choice applies at once
 * except the calendar, which applies on "Apply" so a half-picked range never
 * fires a request. Popovers close on outside click and on Escape.
 */
import { useEffect, useRef, useState } from 'react';
import { MORE_PRESETS, QUICK_PRESETS, presetRange, rangeLabel, ymd, type RangePreset } from '@/lib/marketing';

export interface RangeValue { preset: RangePreset; since: string; until: string }

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

const pill = (on: boolean) => ({
  background: on ? 'var(--accent-glow)' : 'transparent',
  color: on ? 'var(--accent)' : 'var(--text-muted)',
  fontWeight: on ? 600 : 400,
  border: `1px solid ${on ? 'transparent' : 'var(--border)'}`,
});

export default function DateRangePicker({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [from, setFrom] = useState(value.since);
  const [to, setTo] = useState(value.until);
  const moreRef = useOutside(moreOpen, () => setMoreOpen(false));
  const calRef = useOutside(calOpen, () => setCalOpen(false));
  useEffect(() => { setFrom(value.since); setTo(value.until); }, [value.since, value.until]);

  const pick = (p: Exclude<RangePreset, 'custom'>) => { onChange({ preset: p, ...presetRange(p) }); setMoreOpen(false); };
  const today = ymd(new Date());
  const moreActive = MORE_PRESETS.find((p) => p.id === value.preset);
  const valid = from && to && from <= to && to <= today;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {QUICK_PRESETS.map((p) => (
        <button key={p.id} type="button" onClick={() => pick(p.id as Exclude<RangePreset, 'custom'>)}
          aria-pressed={value.preset === p.id} className="px-3 py-1.5 rounded-full" style={pill(value.preset === p.id)}>
          {p.label}
        </button>
      ))}

      <div className="relative" ref={moreRef}>
        <button type="button" onClick={() => { setMoreOpen((o) => !o); setCalOpen(false); }} aria-haspopup="menu" aria-expanded={moreOpen}
          className="px-3 py-1.5 rounded-full inline-flex items-center gap-1" style={pill(Boolean(moreActive))}>
          {moreActive ? moreActive.label : 'More'}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: moreOpen ? 'rotate(180deg)' : undefined }}><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        {moreOpen && (
          <div role="menu" className="absolute right-0 mt-1 z-30 min-w-[10rem] rounded-xl py-1 shadow-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            {MORE_PRESETS.map((p) => (
              <button key={p.id} role="menuitem" type="button" onClick={() => pick(p.id as Exclude<RangePreset, 'custom'>)}
                className="w-full text-left px-3 py-2 hover:bg-[var(--accent-glow)]"
                style={{ color: value.preset === p.id ? 'var(--accent)' : 'var(--text)', fontWeight: value.preset === p.id ? 600 : 400 }}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative" ref={calRef}>
        <button type="button" onClick={() => { setCalOpen((o) => !o); setMoreOpen(false); }} aria-haspopup="dialog" aria-expanded={calOpen}
          title="Pick any date range" className="px-3 py-1.5 rounded-full inline-flex items-center gap-1.5" style={pill(value.preset === 'custom')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {rangeLabel(value.since, value.until)}
        </button>
        {calOpen && (
          <div role="dialog" aria-label="Custom date range" className="absolute right-0 mt-1 z-30 rounded-xl p-3 shadow-lg w-64 space-y-2"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <label className="block">
              <span className="z-eyebrow">From</span>
              <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </label>
            <label className="block">
              <span className="z-eyebrow">To</span>
              <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </label>
            {!valid && <p className="text-[11px]" style={{ color: 'var(--red)' }}>Pick a start on or before the end, no later than today.</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCalOpen(false)} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
              <button type="button" disabled={!valid} onClick={() => { onChange({ preset: 'custom', since: from, until: to }); setCalOpen(false); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Apply</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
