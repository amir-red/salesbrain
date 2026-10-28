'use client';

/**
 * The funnel card on /dashboard (design 1, 2026-10-28): the narrowing shape on the left — one trapezoid per step,
 * width on a square-root scale of how many reached that step or further, one plum ramp from first to last step — and
 * the numbers on the right (reached, step, conversion from the step before; the weakest step in orange). Clicking a
 * step shows what it means, its sub-counts and who left there. `lib/funnel.ts::drawnSteps` decides the steps.
 */
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { GROUP_HREF } from '@/components/panel/FunnelStrip';
import { drawnSteps, pct, type DrawnStep, type FunnelSummary } from '@/lib/funnel';

/** Lighter → deeper along the funnel; color-mix of the theme accent, so dark mode gets its own ramp. */
const SHADES = [32, 46, 60, 74, 88, 100];

function width(n: number, max: number) {
  return Math.max(8, (Math.sqrt(Math.max(0, n)) / Math.sqrt(Math.max(1, max))) * 100);
}

/** The step with the lowest conversion from the one before, among steps whose previous step had 8+ people. */
export function weakestStep(steps: DrawnStep[]): string | null {
  let best: { key: string; c: number } | null = null;
  steps.forEach((s, i) => {
    const prev = steps[i - 1];
    if (!prev || prev.reached < 8 || prev.conversion == null) return;
    if (!best || prev.conversion < best.c) best = { key: s.key, c: prev.conversion };
  });
  return (best as { key: string } | null)?.key ?? null;
}

export default function FunnelChart({ data, unit, controls }: { data: FunnelSummary; unit: 'people' | 'companies'; controls?: ReactNode }) {
  const steps = drawnSteps(data);
  const [sel, setSel] = useState<string | null>(null);
  const max = Math.max(1, ...steps.map((s) => s.reached));
  const weak = weakestStep(steps);
  const cur = steps.find((s) => s.key === sel) ?? null;
  const contacted = steps.find((s) => s.key === 'contacted');
  const opp = steps.find((s) => s.key === 'opportunity');
  const fromLeads = Math.max(0, (opp?.reached ?? 0) - (opp?.direct ?? 0));
  const rate = contacted?.reached ? fromLeads / contacted.reached : null;

  return (
    <section className="z-panel rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">The funnel</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Each {unit === 'companies' ? 'company' : 'person'} once · % = from the step before · click a step</p>
        </div>
        {controls}
      </div>

      <div className="grid gap-5 items-center" style={{ gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)' }}>
        <div className="flex flex-col gap-1" aria-hidden="true">
          {steps.map((s, i) => {
            const a = width(s.reached, max), b = width(steps[i + 1]?.reached ?? s.reached, max);
            return (
              <button key={s.key} type="button" tabIndex={-1} onClick={() => setSel(sel === s.key ? null : s.key)} className="relative h-10 block w-full">
                <span className="absolute inset-0 block" style={{
                  background: `color-mix(in srgb, var(--accent) ${SHADES[i] ?? 100}%, var(--bg-card))`,
                  opacity: sel && sel !== s.key ? 0.45 : 1,
                  clipPath: `polygon(${50 - a / 2}% 0, ${50 + a / 2}% 0, ${50 + b / 2}% 100%, ${50 - b / 2}% 100%)`,
                }} />
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-1">
          {steps.map((s, i) => {
            const prev = steps[i - 1];
            const on = sel === s.key;
            return (
              <button key={s.key} type="button" onClick={() => setSel(on ? null : s.key)} aria-pressed={on}
                className="h-10 grid items-center gap-2 text-left rounded-lg px-2 text-sm"
                style={{ gridTemplateColumns: '64px 1fr 52px', background: on ? 'color-mix(in srgb, var(--accent) 9%, transparent)' : 'transparent' }}
                title={s.meaning}>
                <b className="font-semibold tabular-nums font-mono">{s.reached.toLocaleString()}</b>
                <span className="truncate">{s.label}</span>
                <span className="text-right text-xs tabular-nums font-mono"
                  style={weak === s.key ? { color: 'var(--orange)', fontWeight: 600 } : { color: 'var(--text-muted)' }}>
                  {prev ? pct(prev.conversion) : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {cur && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3.5 py-2.5 text-sm"
          style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
          <b className="font-semibold" style={{ color: 'var(--accent)' }}>{cur.label}</b>
          <span>{cur.meaning}</span>
          <span className="inline-flex flex-wrap gap-1.5">
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <b className="font-semibold tabular-nums">{cur.current.toLocaleString()}</b> here now
            </span>
            {cur.chips.map((c) => (
              <span key={c.label} className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <b className="font-semibold tabular-nums">{c.n.toLocaleString()}</b> {c.label}
              </span>
            ))}
            {cur.direct > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                title="Created as a deal directly, not from a lead; never in a conversion rate">
                <b className="font-semibold tabular-nums">{cur.direct.toLocaleString()}</b> created directly
              </span>
            )}
            {cur.exits.map((x) => (
              <span key={x.label} className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <b className="font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{x.n.toLocaleString()}</b> {x.label.toLowerCase()}
              </span>
            ))}
          </span>
          <Link href={GROUP_HREF[cur.group]} className="text-xs underline whitespace-nowrap ml-auto">See the {unit} →</Link>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="text-sm">
          Conversion rate <b className="text-xl font-semibold tabular-nums font-mono">{pct(rate)}</b>{' '}
          <span style={{ color: 'var(--text-muted)' }}>contacted → opportunity</span>
        </span>
        <Link href="/sales-leads" className="text-xs underline">Open the leads →</Link>
      </div>
    </section>
  );
}
