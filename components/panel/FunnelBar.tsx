import { funnelSegments, stageTotal } from '@/lib/icp-panel';
import type { StageCounts } from '@/lib/icp-panel';

/**
 * One stacked bar, one segment per prospect stage with people in it, in
 * pipeline order (P0 → P9). Width is the share of the list; hover for the
 * count. An empty list draws a dashed track instead of nothing.
 */
export default function FunnelBar({ stages, legend = false, height = 10 }: { stages: StageCounts; legend?: boolean; height?: number }) {
  const total = stageTotal(stages);
  const segs = funnelSegments(stages);
  if (total === 0) {
    return <div className="rounded-full" style={{ height, border: '1px dashed var(--border)' }} title="no leads yet" />;
  }
  return (
    <div className="space-y-1.5">
      <div className="flex rounded-full overflow-hidden" style={{ height, background: 'var(--bg-input)' }}>
        {segs.map((s) => (
          <div key={s.stage} title={`${s.label}: ${s.n}`} style={{ width: `${(s.n / total) * 100}%`, background: s.color, minWidth: 2 }} />
        ))}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {segs.map((s) => (
            <span key={s.stage} className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color }} />
              {s.label} <b style={{ color: 'var(--text)' }}>{s.n}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
