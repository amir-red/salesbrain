'use client';

import type { BriefCheck } from '@/lib/lead-brief';

/**
 * "Check before you write" (2026-11-10, from Mateo's sales experiments): what to look at before writing to this
 * person — they are in the CRM more than once, a teammate holds the lead or wrote in the last 72 hours, a date was
 * mentioned but no call is booked, the research may be about a namesake. Read from the kernel's lead brief, for the
 * viewer. Nothing to check = nothing shown.
 */
export default function CheckBeforeWrite({ checks, compact }: { checks: BriefCheck[] | undefined; compact?: boolean }) {
  const list = (checks ?? []).slice().sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1));
  if (!list.length) return null;
  const warn = list.some((c) => c.level === 'warn');
  const tone = warn ? 'var(--orange)' : 'var(--blue)';
  return (
    <section className={`rounded-xl ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`} aria-label="Check before you write"
      style={{ background: `color-mix(in srgb, ${tone} 9%, transparent)`, border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)` }}>
      <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: tone }}>Check before you write</p>
      <ul className="space-y-1.5">
        {list.map((c, i) => (
          <li key={i} className={`flex gap-2 leading-snug ${compact ? 'text-xs' : 'text-[13px]'}`}>
            <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: c.level === 'warn' ? 'var(--orange)' : 'var(--text-muted)' }} />
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
