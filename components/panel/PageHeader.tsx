import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The page header every main page uses (/icp, /agents, /pipeline, /prospecting): a bar under the top edge with the
 * title, one muted line under it, and the page's actions on the right. `back` adds a ← link before the title.
 */
export default function PageHeader({ title, subtitle, actions, back, badge }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; badge?: ReactNode;
}) {
  return (
    <div className="p-4 border-b flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: 'var(--border)' }}>
      <div className="min-w-0">
        <h1 className="text-lg font-bold flex items-center gap-2 min-w-0">
          {back && (
            <Link href={back.href} className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }} title={back.label} aria-label={back.label}>←</Link>
          )}
          <span className="truncate">{title}</span>
          {badge}
        </h1>
        {subtitle && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/** A small status pill next to a title or in a row. */
export function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{children}</span>
  );
}
