'use client';

/**
 * What a cohort list is for (Mateo's table, 2026-10-28): the companies we want and the person to contact. Shown at the
 * top of a cohort's list page so whoever works it reads the same definition the sorter and the ranking use.
 */
import type { CohortInfo } from '@/lib/cohorts';
import { Building, Users } from '@/components/icons';

export default function CohortHeader({ cohort }: { cohort: CohortInfo }) {
  if (cohort.key === 'unsorted') {
    return (
      <section className="z-panel p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        {cohort.characteristics}
      </section>
    );
  }
  return (
    <section className="z-panel p-4 grid gap-4 md:grid-cols-2">
      {([[Building, 'Characteristics we want', cohort.characteristics], [Users, 'Person to contact', cohort.person_to_contact]] as const).map(([I, label, text]) => (
        <div key={label} className="flex gap-3">
          <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <I width={16} height={16} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</div>
            <p className="text-sm mt-0.5">{text}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
