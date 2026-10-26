'use client';

/**
 * The funnel strip — one ladder from prospect to client, the same on every page (lib/funnel.ts has the words).
 *
 * Fetches GET /api/funnel with `query` (icp_id / owner / lane) itself, so a page drops it in with one line. Each stage
 * shows the people there now; under it, how many reached it and the conversion to the next stage. Exits (not a fit,
 * lost, archived) are counted at the furthest stage a person reached. Opportunities created directly (not from a
 * lead) count in Opportunity / Client but never in a conversion rate.
 *
 * `compact` = one row of stage tiles (for a page header); full = grouped columns with sub-states and links.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  FUNNEL_EXITS, FUNNEL_GROUPS, SUBSTAGE_LABELS, groupCount, pct,
  type FunnelGroup, type FunnelSummary, type FunnelStageRow,
} from '@/lib/funnel';

export const GROUP_COLOR: Record<FunnelGroup, string> = {
  prospect: 'var(--cat-blue)',
  lead: 'var(--accent)',
  opportunity: 'var(--cat-violet)',
  client: 'var(--green)',
};

export const GROUP_HREF: Record<FunnelGroup, string> = {
  prospect: '/prospecting',
  lead: '/sales-leads',
  opportunity: '/',
  client: '/?status=won',
};

export function useFunnel(query: Record<string, string | undefined>, enabled = true) {
  const [data, setData] = useState<FunnelSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setError(null);
    fetch(`/api/funnel${qs ? `?${qs}` : ''}`)
      .then(async (r) => {
        const out = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) { setError(out.error || `Could not load the funnel (${r.status})`); return; }
        setData(out as FunnelSummary);
      })
      .catch(() => { if (live) setError('Could not reach the server'); });
    return () => { live = false; };
  }, [qs, enabled]);
  return { data, error, loading: !data && !error };
}

function exitText(r: FunnelStageRow): string {
  return Object.entries(r.exits).map(([k, n]) => `${n} ${FUNNEL_EXITS[k as keyof typeof FUNNEL_EXITS].toLowerCase()}`).join(' · ');
}

function Tile({ r, compact, next }: { r: FunnelStageRow; compact?: boolean; next?: boolean }) {
  const color = GROUP_COLOR[r.group];
  const subs = Object.entries(r.substages);
  const tip = [r.meaning, `${r.current} here now · ${r.reached} reached this stage or further`,
    r.direct ? `${r.direct} of them are opportunities created directly, not from a lead` : '',
    exitText(r) ? `Left here: ${exitText(r)}` : ''].filter(Boolean).join('\n');
  return (
    <div className="flex items-stretch shrink-0">
      <div className="rounded-lg px-2.5 py-1.5 min-w-[84px]" title={tip}
        style={{ background: `color-mix(in srgb, ${color} 9%, var(--bg-card))`, border: `1px solid color-mix(in srgb, ${color} 28%, var(--border))` }}>
        <div className="text-[10px] font-medium uppercase tracking-wide whitespace-nowrap" style={{ color }}>{r.label}</div>
        <div className="text-lg font-semibold leading-tight tabular-nums" style={{ color: 'var(--text)' }}>{r.current.toLocaleString()}</div>
        {!compact && (
          <div className="text-[10px] leading-tight tabular-nums" style={{ color: 'var(--text-muted)' }}>
            reached {r.reached.toLocaleString()}
          </div>
        )}
        {!compact && subs.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {subs.map(([k, n]) => (
              <div key={k} className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                <b style={{ color: 'var(--text)' }}>{n}</b> {SUBSTAGE_LABELS[k] ?? k}
              </div>
            ))}
          </div>
        )}
      </div>
      {next && (
        <div className="flex flex-col items-center justify-center px-1 text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}
          title="Share of the people who reached this stage that reached the next one">
          <span>→</span>
          {r.conversion != null && <span>{pct(r.conversion)}</span>}
        </div>
      )}
    </div>
  );
}

export default function FunnelStrip({ query = {}, compact = false, title, data: given, href }: {
  query?: Record<string, string | undefined>; compact?: boolean; title?: string; data?: FunnelSummary | null;
  /** In compact mode: a "Funnel →" link (e.g. /funnel?icp_id=…). */
  href?: string;
}) {
  const own = useFunnel(query, given === undefined);
  const data = given === undefined ? own.data : given;
  const error = given === undefined ? own.error : null;
  const loading = !data && !error;

  if (error) {
    return <div className="text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>{error}</div>;
  }
  if (loading || !data) {
    return (
      <div className="flex gap-2 overflow-hidden" aria-busy="true">
        {Array.from({ length: compact ? 10 : 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg animate-pulse shrink-0" style={{ width: compact ? 84 : 220, background: 'var(--bg-input)' }} />
        ))}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="space-y-1">
        {(title || href) && (
          <div className="flex items-baseline gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            {title && <span className="font-medium">{title}</span>}
            {href && <Link href={href} className="underline">open the funnel →</Link>}
          </div>
        )}
        <div className="flex items-stretch overflow-x-auto pb-1">
          {data.stages.map((r, i) => <Tile key={r.key} r={r} compact next={i < data.stages.length - 1} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {title && <div className="text-sm font-semibold">{title}</div>}
      <div className="flex flex-wrap gap-y-3">
        {FUNNEL_GROUPS.map((g, gi) => {
          const rows = data.stages.filter((r) => r.group === g.key);
          const last = rows[rows.length - 1];
          return (
            <div key={g.key} className="flex items-stretch shrink-0">
              <div className="rounded-xl p-2.5 space-y-2 max-w-full" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <div className="flex items-baseline justify-between gap-3" title={g.meaning}>
                  <Link href={GROUP_HREF[g.key]} className="text-xs font-semibold hover:underline" style={{ color: GROUP_COLOR[g.key] }}>{g.label} →</Link>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{groupCount(data, g.key).toLocaleString()} now</span>
                </div>
                <div className="flex items-stretch overflow-x-auto">
                  {rows.map((r, i) => <Tile key={r.key} r={r} next={i < rows.length - 1} />)}
                </div>
              </div>
              {gi < FUNNEL_GROUPS.length - 1 && (
                <div className="flex flex-col items-center justify-center px-1.5 text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}
                  title="Share of the people who reached the last stage of this group that reached the next group">
                  <span className="text-sm">→</span>
                  <span>{pct(last.conversion)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
