/**
 * A used/cap bar, coloured the way /admin/linkedin does it: accent, yellow
 * from 70 %, red from 90 %. cap 0 means "no ceiling" and renders as ∞.
 */
export default function ProgressBar({ used, cap, label, compact = false, title }: {
  used: number; cap: number; label?: string; compact?: boolean; title?: string;
}) {
  const p = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const col = p >= 90 ? 'var(--red)' : p >= 70 ? 'var(--yellow)' : 'var(--accent)';
  return (
    <div className="min-w-0" title={title}>
      {(label || !compact) && (
        <div className="flex justify-between text-[10px] mb-1 gap-2" style={{ color: 'var(--text-muted)' }}>
          <span className="truncate">{label}</span>
          <span className="font-mono shrink-0" style={{ color: p >= 90 ? 'var(--red)' : 'var(--text)' }}>{used}/{cap || '∞'}</span>
        </div>
      )}
      <div className={`${compact ? 'h-1' : 'h-1.5'} rounded-full overflow-hidden`} style={{ background: 'var(--bg-input)' }}>
        <div className="h-full rounded-full" style={{ width: `${p}%`, background: col }} />
      </div>
    </div>
  );
}
