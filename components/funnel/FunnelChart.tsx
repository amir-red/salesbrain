'use client';

/**
 * The funnel, drawn (/funnel, design A 2026-10-28): six steps side by side, each a trapezoid whose height is the
 * square root of how many people reached that step or further, on one plum ramp from prospect to client. Clicking a
 * step shows what it means, its sub-counts and who left there, with a link to the people. `lib/funnel.ts::drawnSteps`
 * decides the steps; this file only draws them.
 */
import Link from 'next/link';
import { useState } from 'react';
import { GROUP_HREF } from '@/components/panel/FunnelStrip';
import { Target } from '@/components/icons';
import { drawnSteps, pct, type DrawnStep, type FunnelGroup, type FunnelSummary } from '@/lib/funnel';

/** One hue, light → dark, in funnel order (validated ordinal ramp; the light end still clears the surface 2:1). */
export const RAMP: Record<FunnelGroup, string> = {
  prospect: 'color-mix(in srgb, var(--accent) 40%, var(--bg-card))',
  lead: 'color-mix(in srgb, var(--accent) 62%, var(--bg-card))',
  opportunity: 'color-mix(in srgb, var(--accent) 82%, var(--bg-card))',
  client: 'var(--accent)',
};

const H = 180;

function heightOf(n: number, max: number): number {
  return Math.max(10, Math.round((Math.sqrt(Math.max(0, n)) / Math.sqrt(Math.max(1, max))) * H));
}

export default function FunnelChart({ data, unit }: { data: FunnelSummary; unit: 'people' | 'companies' }) {
  const steps = drawnSteps(data);
  const [sel, setSel] = useState<string>('contacted');
  const cur: DrawnStep = steps.find((s) => s.key === sel) ?? steps[0];
  const max = Math.max(1, ...steps.map((s) => s.reached));

  return (
    <section className="z-panel p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="inline-flex items-center gap-2.5 text-sm font-semibold" style={{ color: 'var(--text)' }}>
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg" aria-hidden="true"
            style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
            <Target width={16} height={16} />
          </span>
          Everyone once, at the furthest stage they reached
        </span>
        {(['prospect', 'lead', 'opportunity', 'client'] as FunnelGroup[]).map((g) => (
          <span key={g} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: RAMP[g] }} />
            {g === 'prospect' ? 'Prospects' : g === 'lead' ? 'Leads' : g === 'opportunity' ? 'Opportunities' : 'Clients'}
          </span>
        ))}
        <span className="ml-auto">Heights on a square-root scale · click a step</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const a = heightOf(s.reached, max);
          const b = heightOf(steps[i + 1]?.reached ?? s.reached, max);
          const t1 = (H - a) / 2, t2 = (H - b) / 2;
          const on = s.key === cur.key;
          return (
            <button key={s.key} type="button" onClick={() => setSel(s.key)} aria-pressed={on}
              className="flex flex-col gap-2 text-left rounded-lg px-3 py-2 min-w-0"
              style={{ background: on ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent' }}
              title={s.meaning}>
              <span className="flex flex-col min-h-[46px]">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                <span className="text-2xl font-semibold leading-tight tabular-nums">{s.reached.toLocaleString()}</span>
              </span>
              <span className="block relative w-full" style={{ height: H }}>
                <span className="absolute inset-0 block" aria-hidden="true" style={{
                  background: RAMP[s.group], opacity: on ? 1 : 0.85,
                  clipPath: `polygon(0 ${t1}px, 100% ${t2}px, 100% ${H - t2}px, 0 ${H - t1}px)`,
                }} />
              </span>
              <span className="flex flex-col min-h-[36px] text-xs">
                <span><b className="font-semibold tabular-nums">{s.current.toLocaleString()}</b> here now</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {i === 0 ? `everyone on a list` : `${pct(steps[i - 1].conversion)} of ${steps[i - 1].label.toLowerCase()}`}
                </span>
                {s.entered !== undefined && (
                  <span className="tabular-nums font-medium" style={{ color: s.entered ? 'var(--accent)' : 'var(--text-muted)' }}>+{s.entered.toLocaleString()} in period</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3.5 py-2.5 text-sm"
        style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
        <b className="font-semibold" style={{ color: 'var(--accent)' }}>{cur.label}</b>
        <span style={{ color: 'var(--text)' }}>{cur.meaning}</span>
        <span className="inline-flex flex-wrap gap-1.5 ml-auto">
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
            <span key={x.label} className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              title="Left the funnel from this step">
              <b className="font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{x.n.toLocaleString()}</b> {x.label.toLowerCase()}
            </span>
          ))}
        </span>
        <Link href={GROUP_HREF[cur.group]} className="text-xs underline whitespace-nowrap">See the {unit} →</Link>
      </div>
    </section>
  );
}
