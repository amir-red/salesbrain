import type { ReactNode } from 'react';

/** The control panel's card: title row with an optional right-hand slot, then the body. */
export default function SectionCard({ title, subtitle, right, children, tone }: {
  title: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; tone?: 'default' | 'warn';
}) {
  return (
    <section className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: `1px solid ${tone === 'warn' ? 'var(--red)' : 'var(--border)'}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
        </div>
        {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}
