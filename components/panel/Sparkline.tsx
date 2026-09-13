/** Seven flex bars, the way /admin/linkedin draws its 7-day trend. */
export default function Sparkline({ points, height = 36, label, color = 'var(--accent)' }: {
  points: { day: string; n: number; title?: string }[]; height?: number; label?: string; color?: string;
}) {
  if (points.length === 0) return <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>no runs in the last 7 days</div>;
  const max = Math.max(1, ...points.map((p) => p.n));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {points.map((p) => (
        <div key={p.day} title={p.title ?? `${p.day}: ${p.n}`} className="flex-1 rounded-t"
             style={{ height: `${Math.max(6, (p.n / max) * 100)}%`, background: color, opacity: 0.55 }} />
      ))}
      {label && <span className="text-[10px] ml-1 self-end" style={{ color: 'var(--text-muted)' }}>{label}</span>}
    </div>
  );
}
