'use client';

/**
 * "What converts" on /funnel (funnel Phase C): everyone we contacted, as they were at first contact, against how far
 * they got. Findings and suggestions are for people to act on; nothing changes by itself.
 *
 * `useInsights(query)` fetches once; the page hands the result to the KPI tiles, the "What gets answers" card and this
 * full table, so one request serves all three.
 */
import { useEffect, useState } from 'react';
import { pct } from '@/lib/funnel';
import type { FunnelInsights } from '@/lib/warm';

export function useInsights(query: Record<string, string | undefined>) {
  const [data, setData] = useState<FunnelInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString();
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    fetch(`/api/funnel/insights${qs ? `?${qs}` : ''}`)
      .then(async (r) => { const o = await r.json().catch(() => ({})); if (!live) return; if (!r.ok) setError(o.error || `Could not load (${r.status})`); else setData(o); })
      .catch(() => { if (live) setError('Could not reach the server'); });
    return () => { live = false; };
  }, [qs]);
  return { data, error };
}

export default function Insights({ data, error }: { data: FunnelInsights | null; error: string | null }) {
  const [open, setOpen] = useState<string | null>('fit');

  return (
    <section className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Everyone we contacted, as they were at first contact, against how far they got. Groups under 8 people are shown
        but never used for a finding.
      </p>
      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
      {!data && !error && <div className="h-16 rounded-lg animate-pulse" style={{ background: 'var(--bg-input)' }} />}
      {data && (
        <>
          <div className="flex flex-wrap gap-4 text-xs">
            <span><b className="text-base">{data.overall.contacted.toLocaleString()}</b> contacted</span>
            <span><b className="text-base">{pct(data.overall.answer_rate)}</b> answered ({data.overall.answered})</span>
            <span><b className="text-base">{pct(data.overall.meeting_rate)}</b> got to a meeting ({data.overall.meetings})</span>
          </div>
          {(data.suggestions.length > 0 || data.findings.length > 0) && (
            <ul className="text-xs space-y-1">
              {data.suggestions.map((s, i) => <li key={`s${i}`}><b>→</b> {s}</li>)}
              {data.findings.map((f, i) => (
                <li key={`f${i}`} style={{ color: f.kind === 'works' ? 'var(--green)' : 'var(--text-muted)' }}>
                  {f.kind === 'works' ? '▲' : '▼'} {f.text}
                </li>
              ))}
            </ul>
          )}
          {data.note && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{data.note}</p>}
          <div className="flex flex-wrap gap-1">
            {Object.entries(data.dimensions).map(([k, d]) => (
              <button key={k} onClick={() => setOpen(open === k ? null : k)} className="text-[11px] px-2 py-1 rounded-full"
                style={{ background: open === k ? 'var(--accent)' : 'var(--bg-input)', color: open === k ? 'var(--accent-fg)' : 'var(--text)' }}>
                {d.label}
              </button>
            ))}
          </div>
          {open && data.dimensions[open] && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left font-normal py-1">{data.dimensions[open].label}</th>
                    <th className="text-right font-normal">Contacted</th>
                    <th className="text-right font-normal">Answered</th>
                    <th className="text-right font-normal">Meeting</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dimensions[open].rows.map((r) => (
                    <tr key={r.value} style={{ borderTop: '1px solid var(--border)', opacity: r.enough ? 1 : 0.6 }}>
                      <td className="py-1 pr-2">{r.value}</td>
                      <td className="text-right tabular-nums">{r.contacted}</td>
                      <td className="text-right tabular-nums">{r.answered} · {pct(r.answer_rate)}</td>
                      <td className="text-right tabular-nums">{r.meetings} · {pct(r.meeting_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
