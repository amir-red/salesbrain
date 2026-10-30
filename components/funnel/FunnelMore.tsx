'use client';

/**
 * The details under /dashboard's "More" switch: where people stand per channel, who left or is resting and where, and
 * the words the whole team uses. Moved out of the old /funnel page unchanged.
 */
import { GROUP_COLOR } from '@/components/panel/FunnelStrip';
import { CHANNEL_LABELS, FUNNEL_EXITS, FUNNEL_GROUPS, FUNNEL_LABELS, FUNNEL_STAGES, type FunnelSummary } from '@/lib/funnel';

export default function More({ data }: { data: FunnelSummary }) {
  const exitsAt = data.stages.filter((s) => Object.keys(s.exits).length);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Channels</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Where the people still in the funnel stand on each channel. A channel is not a stage.</p>
        {(['linkedin', 'email'] as const).map((ch) => {
          const rows = Object.entries(data.channels[ch] || {}).sort((a, b) => b[1] - a[1]);
          const total = rows.reduce((n, [, v]) => n + v, 0);
          return (
            <div key={ch} className="space-y-1">
              <div className="text-xs font-medium">{ch === 'linkedin' ? 'LinkedIn' : 'Email'}</div>
              <div className="flex flex-wrap gap-1.5">
                {rows.map(([k, v]) => (
                  <span key={k} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-input)' }}
                    title={`${Math.round((v / Math.max(1, total)) * 100)}%`}>
                    {CHANNEL_LABELS[ch][k] ?? k} <b>{v.toLocaleString()}</b>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Who left or is resting, and where</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Counted at the furthest stage the person reached. Resting people come back by themselves at the next touch or reply.</p>
        {exitsAt.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nobody left in this slice.</p> : (
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-normal py-1">Stage</th>
                {Object.entries(FUNNEL_EXITS).map(([k, l]) => <th key={k} className="text-right font-normal">{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {exitsAt.map((s) => (
                <tr key={s.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-1">{s.label}</td>
                  {Object.keys(FUNNEL_EXITS).map((k) => (
                    <td key={k} className="text-right tabular-nums">{(s.exits as Record<string, number>)[k]?.toLocaleString() ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">What the words mean</h3>
        {FUNNEL_GROUPS.map((g) => (
          <div key={g.key} className="space-y-1">
            <div className="text-xs font-semibold" style={{ color: GROUP_COLOR[g.key] }}>{g.label}</div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{g.meaning}</p>
            <ul className="text-xs space-y-0.5">
              {FUNNEL_STAGES.filter((s) => data.stages.find((r) => r.key === s)?.group === g.key).map((s) => (
                <li key={s}><b>{FUNNEL_LABELS[s]}</b> — {data.definitions.stages[s]}</li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Someone becomes a lead only when contact happens. An accepted connection request is still “Contacted” until
          they answer. Resting = in contact but quiet for 30 days with nothing planned. Opportunities created directly
          count in Opportunity and Client but not in any conversion rate.
        </p>
      </section>
    </div>
  );
}
