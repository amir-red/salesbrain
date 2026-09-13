import type { ReactNode } from 'react';

/** The /agents 4-up tile: a number, a label, an optional one-line sub. */
export default function StatTile({ label, value, sub, color, title }: {
  label: string; value: ReactNode; sub?: ReactNode; color?: string; title?: string;
}) {
  return (
    <div className="rounded-lg px-3 py-2 min-w-0" style={{ background: 'var(--bg-input)' }} title={title}>
      <div className="text-base font-semibold leading-tight tabular-nums" style={{ color: color ?? 'var(--text)' }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}
