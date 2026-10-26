'use client';

/**
 * "What answers on this list" on /icp/[id]: per fit criterion, how often people answered when it matched vs when it
 * did not, and the weights that would follow (core policy/icp_tuning.py). A person applies them; nothing changes by
 * itself. Hidden when nobody on the list has been contacted yet.
 */
import { useEffect, useState } from 'react';
import { pct } from '@/lib/funnel';

interface Dim {
  dimension: string; label: string; weight: number; proposed?: number; matched: number; matched_answered: number;
  unmatched: number; unmatched_answered: number; matched_rate: number | null; unmatched_rate: number | null;
  lift: number | null; enough: boolean; action: 'lower' | 'raise' | null;
}
interface Tuning {
  contacted: number; answered: number; current_weights: Record<string, number>; weights: Record<string, number> | null;
  why: string[]; dimensions: Dim[]; can_apply: boolean; note: string | null;
}

export default function TuningPanel({ icpId, onApplied }: { icpId: string; onApplied?: (note: string) => void }) {
  const [data, setData] = useState<Tuning | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetch(`/api/icp/${icpId}/tuning`).then(async (r) => {
    const o = await r.json().catch(() => ({}));
    if (r.ok) setData(o); else setError(o.error || null);
  }).catch(() => {});
  useEffect(() => { void load(); }, [icpId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || data.contacted === 0) return null;
  const apply = async () => {
    if (!data.weights) return;
    const diff = Object.entries(data.weights).filter(([k, v]) => data.current_weights[k] !== v)
      .map(([k, v]) => `${k}: ${data.current_weights[k] ?? 0} → ${v}`).join('\n');
    if (!window.confirm(`Change this list's fit weights and re-score everyone on it?\n\n${diff}`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/icp/${icpId}/tuning`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weights: data.weights }) });
      const out = await res.json();
      if (!res.ok) { setError(out.error || `Not applied (${res.status})`); return; }
      onApplied?.('Fit weights changed and the list re-scored.');
      await load();
    } catch { setError('Could not reach the server'); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl p-4 space-y-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
      <div>
        <h2 className="text-sm font-semibold">What answers on this list</h2>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {data.contacted} reached out to, {data.answered} answered. Per fit criterion: how often people answered when it
          matched vs when it did not. Weights change only when someone applies them.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left font-normal py-1">Criterion</th>
              <th className="text-right font-normal">Matched · answered</th>
              <th className="text-right font-normal">Not matched · answered</th>
              <th className="text-right font-normal">Weight</th>
            </tr>
          </thead>
          <tbody>
            {data.dimensions.filter((d) => d.matched + d.unmatched > 0).map((d) => (
              <tr key={d.dimension} style={{ borderTop: '1px solid var(--border)', opacity: d.enough ? 1 : 0.6 }}>
                <td className="py-1">{d.label}</td>
                <td className="text-right tabular-nums">{d.matched_answered}/{d.matched} · {pct(d.matched_rate)}</td>
                <td className="text-right tabular-nums">{d.unmatched_answered}/{d.unmatched} · {pct(d.unmatched_rate)}</td>
                <td className="text-right tabular-nums">
                  {d.weight}{d.proposed !== undefined && d.proposed !== d.weight
                    ? <b style={{ color: d.proposed > d.weight ? 'var(--green)' : 'var(--orange)' }}> → {d.proposed}</b> : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.why.length > 0 && <ul className="text-xs space-y-0.5">{data.why.map((w, i) => <li key={i}>→ {w}</li>)}</ul>}
      {data.note && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{data.note}</p>}
      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
      {data.weights && data.can_apply && (
        <button onClick={apply} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Applying…' : 'Apply these weights and re-score'}</button>
      )}
    </section>
  );
}
