/**
 * Loading shapes: grey blocks in the place of what is coming, so a page shows its layout at once and each part
 * fills in when its data arrives (never a page-wide "Loading…"). `Skeleton` = one block; `SkeletonRows` = table rows.
 */
export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`rounded-md animate-pulse ${className}`} style={{ background: 'var(--bg-input)', ...style }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 8, cols = [40, 22, 10, 10, 12, 6] }: { rows?: number; cols?: number[] }) {
  const total = cols.reduce((a, b) => a + b, 0);
  return (
    <div className="divide-y" style={{ borderColor: 'var(--border)' }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          {cols.map((w, j) => (
            <Skeleton key={j} className={j === 0 ? 'h-4' : 'h-3'} style={{ width: `${(w / total) * 100}%`, opacity: 1 - i * 0.07 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="z-panel p-4 space-y-2.5" aria-busy="true">
      <Skeleton className="h-3.5 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className="h-2.5" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}
