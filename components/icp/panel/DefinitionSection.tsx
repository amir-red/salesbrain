'use client';

import { OBJECTIVES, PRODUCTS, SENIORITY_BANDS, summarizeCriteria } from '@/lib/icp';
import { FIT_COLORS } from '@/lib/icp-panel';
import type { PanelPayload } from '@/lib/icp-panel';
import SectionCard from '@/components/panel/SectionCard';
import StatTile from '@/components/panel/StatTile';

const Chip = ({ text, tone = 'include' }: { text: string; tone?: 'include' | 'exclude' }) => (
  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-input)', color: tone === 'exclude' ? 'var(--red)' : 'var(--text-muted)' }}>{tone === 'exclude' ? '⊘ ' : ''}{text}</span>
);

/** Step 1 of the journey: who we are looking for, and how the list scored against it. */
export default function DefinitionSection({ data, onEdit }: { data: PanelPayload; onEdit?: () => void }) {
  const { icp, fit } = data;
  const c = icp.criteria;
  const scored = fit.strong + fit.proceed + fit.weak + fit.do_not_pursue;
  const total = scored + fit.unscored;
  const segs = [
    ['strong', fit.strong, 'strong fit'], ['proceed', fit.proceed, 'proceed with caution'], ['weak', fit.weak, 'weak fit'],
    ['do_not_pursue', fit.do_not_pursue, 'do not pursue'], ['unscored', fit.unscored, 'unscored'],
  ] as const;
  return (
    <SectionCard title="1 · Definition" subtitle={`${PRODUCTS.find((p) => p.key === icp.product)?.label ?? icp.product ?? '—'}${icp.objective ? ` · ⌾ ${OBJECTIVES.find((o) => o.key === icp.objective)?.label ?? icp.objective}` : ''} · updated ${new Date(icp.updated_at).toLocaleDateString()}`}
                 right={onEdit && <button onClick={onEdit} className="px-2.5 py-1 rounded-lg text-[11px]" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Edit</button>}>
      {icp.description && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{icp.description}</p>}
      <p className="text-xs">{summarizeCriteria(c)}</p>
      <div className="flex flex-wrap gap-1">
        {c.titles.map((t) => <Chip key={t} text={t} />)}
        {c.seniority.map((s) => <Chip key={s} text={SENIORITY_BANDS.find((b) => b.key === s)?.label ?? s} />)}
        {c.exclude_titles.map((t) => <Chip key={`x-${t}`} text={t} tone="exclude" />)}
        {c.exclude_companies.map((t) => <Chip key={`xc-${t}`} text={t} tone="exclude" />)}
      </div>
      <div className="space-y-1.5">
        <div className="flex rounded-full overflow-hidden h-2" style={{ background: 'var(--bg-input)' }}>
          {total > 0 && segs.filter(([, n]) => n > 0).map(([k, n, label]) => (
            <div key={k} title={`${label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: FIT_COLORS[k], minWidth: 2 }} />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {segs.map(([k, n, label]) => <StatTile key={k} label={label} value={n} color={FIT_COLORS[k]} />)}
        </div>
      </div>
    </SectionCard>
  );
}
