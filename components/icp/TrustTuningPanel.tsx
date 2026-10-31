'use client';

/**
 * What a list's ✓ / ↓ marks say about its four trust weights, and the one-click apply (owner or admin). Reads
 * GET /api/icp/[id]/trust-tuning (kernel crm_trust_tuning); nothing changes until Apply (crm_trust_apply_tuning).
 */
import { useCallback, useEffect, useState } from 'react';
import Button from '@/components/panel/Button';
import { PART_LABELS, type TrustPart } from '@/lib/trust';

interface PartRow { part: TrustPart; label: string; weight: number; up_mean: number | null; down_mean: number | null; lift: number | null; action: string | null; proposed?: number }
interface Payload {
  error?: string; icp?: { id: string; name: string }; current_weights: Record<TrustPart, number>;
  parts: PartRow[]; weights: Record<TrustPart, number> | null; why: string[]; rows: number; up: number; down: number;
  can_apply: boolean; note: string | null;
}

export default function TrustTuningPanel({ icpId, onApplied }: { icpId: string; onApplied?: (note: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/icp/${icpId}/trust-tuning`);
      const out = await res.json();
      if (!res.ok || out.error) { setErr(out.error || `Failed (${res.status})`); return; }
      setData(out); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [icpId]);
  useEffect(() => { void load(); }, [load]);

  const apply = async () => {
    if (!data?.weights || !confirm('Apply these weights to this list and re-score its people?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/icp/${icpId}/trust-tuning`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weights: data.weights }) });
      const out = await res.json();
      if (!res.ok || out.error) { setErr(out.error || 'Not applied'); return; }
      onApplied?.(`Trust weights applied: ${Object.entries(out.to || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}.`);
      await load();
    } finally { setBusy(false); }
  };

  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  return (
    <section className="z-panel p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Trust weights from your ✓ / ↓</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Mark people right or too high on any row; this compares the two groups on each part and proposes new weights. Nothing changes until you apply.
          </p>
        </div>
        {data?.weights && data.can_apply && <Button onClick={() => void apply()} disabled={busy}>{busy ? 'Applying…' : 'Apply'}</Button>}
      </div>
      {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
      {data && !err && (
        <>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{data.rows} marks on this list · {data.up} ✓ · {data.down} ↓</p>
          <table className="w-full text-xs">
            <thead><tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left font-medium py-1">Part</th><th className="text-right font-medium">Weight</th>
              <th className="text-right font-medium">✓ score</th><th className="text-right font-medium">↓ score</th>
              <th className="text-right font-medium">Proposed</th>
            </tr></thead>
            <tbody>
              {data.parts.map((r) => (
                <tr key={r.part} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-1">{PART_LABELS[r.part] ?? r.label}</td>
                  <td className="text-right tabular-nums">{r.weight}</td>
                  <td className="text-right tabular-nums">{pct(r.up_mean)}</td>
                  <td className="text-right tabular-nums">{pct(r.down_mean)}</td>
                  <td className="text-right tabular-nums font-semibold" style={{ color: r.action === 'raise' ? 'var(--green)' : r.action === 'lower' ? 'var(--orange)' : 'var(--text-muted)' }}>
                    {r.proposed ?? '—'}{r.action ? (r.action === 'raise' ? ' ↑' : ' ↓') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.why.length > 0 && <ul className="text-xs space-y-0.5" style={{ color: 'var(--text-muted)' }}>{data.why.map((w) => <li key={w}>· {w}</li>)}</ul>}
          {data.note && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{data.note}</p>}
        </>
      )}
    </section>
  );
}
