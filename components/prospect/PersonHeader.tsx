'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Button from '@/components/panel/Button';
import PriorityPicker from '@/components/PriorityPicker';
import ScoreBadge from '@/components/ScoreBadge';
import { Check } from '@/components/icons';
import type { Prospect } from '@/lib/prospects';
import { currentStep, type JourneyStep } from '@/lib/person-page';

/**
 * The top of a person page (redesign D, 2026-11-09): who they are in one line, and where they are on the journey —
 * Met → Connected → First message → Reply → Meeting → Opportunity, with "you are here". Everything else is below.
 */
export default function PersonHeader({ p, steps, backHref, backLabel, onChanged, researching, onResearch, enriching, onEnrich, converting, onConvert }: {
  p: Prospect; steps: JourneyStep[] | null; backHref: string; backLabel: string; onChanged: () => void;
  researching: boolean; onResearch: () => void; enriching: boolean; onEnrich: () => void; converting: boolean; onConvert: () => void;
}) {
  const canConvert = !p.converted_deal_id && ((p.trust_total ?? 0) >= 50 || (p.icp_score ?? 0) >= 40);
  const where = p.person_city || p.hq_location;
  const here = steps ? currentStep(steps) : -1;
  return (
    <header className="border-b" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
      <div className="mx-auto w-full max-w-[1180px] px-6 lg:px-8 pt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href={backHref} className="text-xs" style={{ color: 'var(--text-muted)' }}>← {backLabel}</Link>
        <div className="flex items-center gap-2">
          {p.converted_deal_id
            ? <Button size="sm" variant="success" href={`/deals/${p.converted_deal_id}`}>View opportunity →</Button>
            : <Button size="sm" onClick={onConvert} disabled={!canConvert || converting} title={canConvert ? 'Open an opportunity for this person' : 'Needs a score of 50+ or a fit of 40+'}>
                {converting ? 'Converting…' : 'Convert to opportunity'}
              </Button>}
          <details className="relative">
            <summary className="list-none cursor-pointer h-8 w-8 rounded-full flex items-center justify-center text-base"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)' }} aria-label="More actions">⋯</summary>
            <div className="absolute right-0 mt-1 z-20 w-56 rounded-xl p-1 text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
              <button type="button" onClick={onEnrich} disabled={enriching} className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--accent-glow)] disabled:opacity-50">
                {enriching ? 'Enriching…' : 'Enrich'}<span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>employer, company, email</span>
              </button>
              <button type="button" onClick={onResearch} disabled={researching} className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--accent-glow)] disabled:opacity-50">
                {researching ? 'Researching…' : 'Research again'}<span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>LinkedIn, the web, one deep lookup</span>
              </button>
            </div>
          </details>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3">
        <Avatar name={p.full_name} src={p.picture_url} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[22px] leading-tight font-bold tracking-tight">{p.full_name || '—'}</h1>
            <PriorityPicker value={p.priority} prospectId={p.id} size="md" onChanged={onChanged} />
            {p.trust_total != null && <ScoreBadge s={p} prospectId={p.id} size="md" onChanged={onChanged} />}
          </div>
          <p className="text-sm mt-0.5">
            {p.title || <span style={{ color: 'var(--text-muted)' }}>role unknown</span>}
            {p.company_name && <> <span style={{ color: 'var(--text-muted)' }}>at</span> <span className="font-semibold">{p.company_name}</span></>}
            {where && <span style={{ color: 'var(--text-muted)' }}> · {where}</span>}
          </p>
        </div>
      </div>

      {steps ? (
        <ol className="flex items-start mt-5 pb-4 overflow-x-auto" aria-label="Where they are">
          {steps.map((s, i) => {
            const isHere = i === here;
            // the first step sits flush with the name above it, the last with the right edge
            const edge = i === 0 ? 'items-start text-left' : i === steps.length - 1 ? 'items-end text-right' : 'items-center text-center';
            return (
              <li key={s.key} className="contents">
                {i > 0 && <span aria-hidden className="flex-1 min-w-[16px] h-[2px] mt-[10px] mx-2 rounded-full" style={{ background: s.done || isHere ? 'var(--accent)' : 'var(--highlight)', opacity: s.done || isHere ? 1 : 0.6 }} />}
                <span className={`flex flex-col gap-0.5 w-[96px] flex-shrink-0 ${edge}`} aria-current={isHere ? 'step' : undefined}>
                  <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center mb-1"
                    style={s.done
                      ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                      : isHere ? { background: 'var(--bg-card)', border: '2.5px solid var(--accent)' }
                        : { background: 'var(--bg-card)', border: '2px solid var(--highlight)' }}>
                    {s.done && <Check width={11} height={11} />}
                  </span>
                  <span className="text-xs" style={{ fontWeight: s.done || isHere ? 600 : 400, color: isHere ? 'var(--accent)' : s.done ? 'var(--text)' : 'var(--text-muted)' }}>{s.label}</span>
                  <span className="text-[11px] leading-tight whitespace-nowrap" style={{ color: isHere ? 'var(--accent)' : 'var(--text-muted)' }}>{isHere ? 'you are here' : s.note || ' '}</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : <div className="h-5" />}
      </div>
    </header>
  );
}
