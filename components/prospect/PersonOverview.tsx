'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import Button from '@/components/panel/Button';
import CheckBeforeWrite from '@/components/prospect/CheckBeforeWrite';
import { External, Send, Sparkle } from '@/components/icons';
import type { LeadBrief } from '@/lib/lead-brief';
import { agoLabel, dayLabel, initialsOf, SIGNAL_LABEL } from '@/lib/lead-brief';
import type { Prospect } from '@/lib/prospects';
import { DEFAULT_WEIGHTS, PART_SHORT, TRUST_PARTS } from '@/lib/trust';
import { channelWord, clip, firstName, firstSentence, roleFromTitle, shortSize, standLine, whyNowLines } from '@/lib/person-page';

/**
 * The person page's Overview (redesign E, 2026-11-09): the eight questions a seller asks before writing, each its own
 * numbered card with a bold title and a one- or two-sentence answer. Left: 1 Where do we stand, 2 Who is the person,
 * 3 What is the company, 4 Why now, 5 What do they gain. Right: 8 Next step (the action, on top), 6 Who gets us in,
 * 7 How do we write, then the score. The long research stays on the Full brief tab.
 */

const muted = { color: 'var(--text-muted)' } as const;
const SCORE_COLORS = ['var(--accent)', 'var(--blue)', 'var(--highlight)', 'var(--cat-teal)'];

function Badge({ n, inverse }: { n: number; inverse?: boolean }) {
  return (
    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" aria-hidden
      style={inverse ? { background: '#ffffff', color: 'var(--deep-plum)' } : { background: 'var(--accent)', color: 'var(--accent-fg)' }}>{n}</span>
  );
}

/** One question: number, bold title, an optional quiet note on the right, then the answer indented under the title. */
function Question({ n, title, note, children }: { n: number; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl px-4 py-4 flex flex-col gap-2" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}
      aria-labelledby={`q${n}`}>
      <div className="flex items-center gap-2.5">
        <Badge n={n} />
        <h2 id={`q${n}`} className="text-[15px] font-semibold leading-tight">{title}</h2>
        {note && <span className="ml-auto text-xs text-right" style={muted}>{note}</span>}
      </div>
      <div className="sm:pl-[34px] flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Chip({ children, tone = 'teal' }: { children: ReactNode; tone?: 'teal' | 'muted' | 'orange' | 'plum' }) {
  const c = tone === 'teal' ? 'var(--cat-teal)' : tone === 'orange' ? 'var(--orange)' : tone === 'plum' ? 'var(--accent)' : 'var(--text-muted)';
  return <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, fontWeight: tone === 'plum' ? 600 : 400 }}>{children}</span>;
}

function Dot({ name, solid }: { name: string | null; solid?: boolean }) {
  return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0" title={name || undefined}
      style={solid ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--accent-soft)', color: 'var(--accent)' }}>{initialsOf(name)}</span>
  );
}

function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="flex items-center gap-3 flex-wrap"><p className="text-sm flex-1" style={muted}>{children}</p>{action}</div>;
}

export default function PersonOverview({ b, p, onEnrich, enriching, onResearch, researching, onTab }: {
  b: LeadBrief; p: Prospect; onEnrich: () => void; enriching: boolean; onResearch: () => void; researching: boolean;
  onTab: (t: 'brief' | 'journey' | 'activity') => void;
}) {
  const [allPoints, setAllPoints] = useState(false);
  const [moreWho, setMoreWho] = useState(false);
  const [moreGain, setMoreGain] = useState(false);
  const name = firstName(b.person.name || p.full_name);
  const stand = standLine(b);
  const per = b.person; const co = b.company; const w = b.who_in; const n = b.next_step; const h = b.how;
  const who = firstSentence(per.background) || firstSentence(per.mandate);
  const companyName = co.name || p.company_name;
  const company = firstSentence(co.summary)
    || [companyName, co.industry, shortSize(co.size), co.hq].filter(Boolean).join(' · ')
    || null;
  const gain = firstSentence(b.gains.why) || firstSentence(b.gains.angle);
  const pains = (b.gains.pains ?? []).slice(0, 2);
  const points = whyNowLines(b);
  const role = roleFromTitle(per.title || p.title);
  const site = co.website || (co.domain ? `https://${co.domain}` : null);
  const siteLabel = co.domain || (co.website ? co.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : null);
  const shown = allPoints ? points : points.slice(0, 3);
  const researchBtn = (label: string) => (
    <Button size="sm" onClick={onResearch} disabled={researching}><Sparkle width={12} height={12} />{researching ? 'Researching…' : label}</Button>
  );

  // 6 · 7 · 8
  const move = n.set || n.suggested?.label || null;
  const byLine = n.responsible ? `From ${firstName(n.responsible)}${n.front && n.front !== n.responsible ? ` · ${firstName(n.front)} takes the call` : ''}` : null;
  const warmest = w.warm_with.find((x) => x.band === 'hot' || x.band === 'warm');
  const conn = w.connected.find((c) => c.status === 'connected');
  const pending = w.connected.find((c) => c.status === 'pending');
  const email = per.email || p.email;
  const phone = per.phone || p.phone;
  const linkedin = per.linkedin_url || p.linkedin_url;
  const lang = h.language === 'de' ? 'German' : h.language === 'en' ? 'English' : h.language;
  const parts = b.trust.parts;
  const total = b.trust.total;

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 py-6">
      <main className="flex-1 min-w-0 flex flex-col gap-3">
        <CheckBeforeWrite checks={b.checks} />
        <Question n={1} title="Where do we stand?" note={b.stand.days != null ? `${b.stand.days} days since last contact` : null}>
          <p className="text-sm leading-relaxed">{stand.line}</p>
          {stand.sub && <p className="text-xs" style={muted}>{stand.sub}</p>}
          {b.stand.open_items.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {b.stand.open_items.slice(0, 4).map((it, i) => (
                <Chip key={i} tone={it.side === 'us' ? 'orange' : 'muted'}>{it.side === 'us' ? 'We owe: ' : `${name} owes: `}{clip(it.item, 60)}</Chip>
              ))}
            </div>
          )}
        </Question>

        <Question n={2} title="Who is the person?" note={per.as_of ? `as of ${dayLabel(per.as_of)}` : null}>
          {who ? <p className="text-sm leading-relaxed">{who}</p>
            : role ? (
              <>
                <p className="text-sm leading-relaxed">{role.role}{companyName ? ` at ${companyName}` : ''}.{role.also ? <> Also {role.also}.</> : null}</p>
                <Empty action={researchBtn('Research now')}>Background not researched yet.</Empty>
              </>
            )
            : <Empty action={researchBtn('Research now')}>Nothing researched about {name} yet.</Empty>}
          {(per.tenure_months != null || per.signals.length > 0 || per.role_confirmed === false) && (
            <div className="flex flex-wrap gap-1.5">
              {per.tenure_months != null && <Chip>{per.tenure_months} months in role</Chip>}
              {per.signals.map((s) => <Chip key={s}>{SIGNAL_LABEL[s] ?? s.replace(/_/g, ' ')}</Chip>)}
              {per.role_confirmed === false && <Chip tone="orange">role not confirmed</Chip>}
            </div>
          )}
          {(per.prior_roles.length > 0 || (per.mandate && per.background)) && (
            moreWho ? (
              <div className="text-[13px] flex flex-col gap-1.5" style={muted}>
                {per.mandate && per.background && <p><span className="font-medium" style={{ color: 'var(--text)' }}>Mandate:</span> {per.mandate}</p>}
                {per.prior_roles.length > 0 && <p><span className="font-medium" style={{ color: 'var(--text)' }}>Before:</span> {per.prior_roles.slice(0, 4).join(' · ')}</p>}
              </div>
            ) : <button type="button" onClick={() => setMoreWho(true)} className="text-xs self-start" style={{ color: 'var(--accent)' }}>More about {name}</button>
          )}
        </Question>

        <Question n={3} title="What is the company?" note={co.as_of ? `as of ${dayLabel(co.as_of)}` : null}>
          {company ? <p className="text-sm leading-relaxed">{company}</p>
            : <Empty action={<Button size="sm" onClick={onEnrich} disabled={enriching}>{enriching ? 'Enriching…' : 'Enrich'}</Button>}>No employer on file.</Empty>}
          {(shortSize(co.size) || co.industry || co.revenue || co.ownership || co.funding || siteLabel) && (
            <div className="flex flex-wrap gap-1.5 items-center">
              {shortSize(co.size) && <Chip tone="muted">{shortSize(co.size)}</Chip>}
              {co.industry && <Chip tone="muted">{co.industry}</Chip>}
              {co.revenue && <Chip tone="muted">revenue {co.revenue}{co.year ? ` (${co.year})` : ''}</Chip>}
              {co.ownership && <Chip tone="muted">{co.ownership}</Chip>}
              {co.funding && <Chip tone="muted">{co.funding}</Chip>}
              {site && siteLabel && <a href={site} target="_blank" rel="noreferrer" className="text-[11px] inline-flex items-center gap-0.5 ml-0.5" style={{ color: 'var(--accent)' }}>{siteLabel}<External width={10} height={10} /></a>}
            </div>
          )}
        </Question>

        <Question n={4} title="Why now?" note={b.why_now.as_of && points.length ? `as of ${dayLabel(b.why_now.as_of)}` : null}>
          {points.length > 0 ? (
            <>
              <ul className="flex flex-col gap-2">
                {shown.map((t, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-snug">
                    {t.when !== null
                      ? <span className="w-[64px] flex-shrink-0 tabular-nums text-xs pt-px" style={muted}>{t.when}</span>
                      : <span aria-hidden className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />}
                    <span className="min-w-0">
                      {t.text}
                      {t.source && <a href={t.source} target="_blank" rel="noreferrer" className="ml-1.5 text-[11px] inline-flex items-center gap-0.5" style={{ color: 'var(--accent)' }}>{t.sourceTitle || 'source'}<External width={10} height={10} /></a>}
                    </span>
                  </li>
                ))}
              </ul>
              {points.length > 3 && (
                <button type="button" onClick={() => setAllPoints((v) => !v)} className="text-xs self-start" style={{ color: 'var(--accent)' }}>
                  {allPoints ? 'Show fewer' : `Show all ${points.length}`}
                </button>
              )}
            </>
          ) : <Empty action={researchBtn(b.research.at ? 'Research again' : 'Research now')}>No dated news on record yet.</Empty>}
        </Question>

        <Question n={5} title="What do they gain?">
          {gain ? <p className="text-sm leading-relaxed">{gain}</p>
            : <Empty action={researchBtn(b.research.at ? 'Research again' : 'Research now')}>No angle written yet.</Empty>}
          {pains.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold" style={muted}>Likely pains</span>
              {pains.map((x, i) => (
                <span key={i} className="text-[13px] flex gap-2 leading-snug"><span aria-hidden style={{ color: 'var(--orange)' }}>•</span>{clip(x, 110)}</span>
              ))}
            </div>
          )}
          {b.gains.angle && firstSentence(b.gains.angle) !== b.gains.angle.trim() && (
            moreGain ? <p className="text-[13px] leading-relaxed" style={muted}>{b.gains.angle}</p>
              : <button type="button" onClick={() => setMoreGain(true)} className="text-xs self-start" style={{ color: 'var(--accent)' }}>The full angle</button>
          )}
        </Question>

        <p className="text-xs mt-1" style={muted}>
          {b.research.at ? `Researched ${agoLabel(b.research.at)}${b.research.sources.length ? ` from ${b.research.sources.length} source${b.research.sources.length === 1 ? '' : 's'}` : ''}` : 'Not researched yet'}
          {' · '}<button type="button" onClick={onResearch} disabled={researching} style={{ color: 'var(--accent)' }}>{researching ? 'Researching…' : 'Research again'}</button>
          {' · '}<button type="button" onClick={() => onTab('brief')} style={{ color: 'var(--accent)' }}>Full brief</button>
          {' · '}<button type="button" onClick={() => onTab('activity')} style={{ color: 'var(--accent)' }}>Activity</button>
        </p>
      </main>

      <aside className="w-full lg:w-[340px] flex-shrink-0 flex flex-col gap-3 lg:sticky lg:top-6 self-start">
        <section className="rounded-xl p-4 flex flex-col gap-2" style={{ background: 'var(--deep-plum)', color: '#ffffff' }} aria-labelledby="q8">
          <div className="flex items-center gap-2.5">
            <Badge n={8} inverse />
            <h2 id="q8" className="text-[15px] font-semibold">Next step</h2>
          </div>
          <span className="text-base font-semibold leading-snug sm:pl-[34px]">{move || 'Nothing to do now'}</span>
          {(byLine || n.suggested?.why) && <span className="text-xs sm:pl-[34px]" style={{ color: '#ebdff0' }}>{byLine || n.suggested?.why}</span>}
          {n.booked_at && n.booking_status !== 'cancelled' && <span className="text-xs sm:pl-[34px]" style={{ color: '#ebdff0' }}>Call booked for {dayLabel(n.booked_at)}</span>}
          {n.ping_at && <span className="text-xs sm:pl-[34px]" style={{ color: '#ebdff0' }}>Ping again {dayLabel(n.ping_at)}</span>}
          <Link href={`/inbox?compose=${p.id}`} className="h-10 mt-2 rounded-full flex items-center justify-center gap-2 text-sm font-semibold"
            style={{ background: '#ffffff', color: 'var(--deep-plum)' }}>
            <Send width={14} height={14} />Write message
          </Link>
          {warmest && warmest.teammate !== n.responsible && (
            <button type="button" onClick={() => onTab('journey')} className="text-xs hover:underline" style={{ color: '#ffffff' }}>
              or ask {firstName(warmest.teammate)} for an intro
            </button>
          )}
          {b.waiting.length > 0 && (
            <Link href="/settings?section=agents" className="text-xs" style={{ color: '#ebdff0' }}>
              {b.waiting.length === 1 ? 'A draft waits' : `${b.waiting.length} drafts wait`} for approval →
            </Link>
          )}
        </section>

        <Question n={6} title="Who gets us in?">
          {(warmest || conn) && (
            <div className="flex items-center gap-2.5">
              <Dot name={warmest?.teammate ?? conn?.owner ?? null} />
              <span className="flex-1 flex flex-col items-center gap-0.5">
                <span className="text-[11px] font-semibold" style={{ color: warmest ? 'var(--orange)' : 'var(--text-muted)' }}>{warmest ? warmest.band : 'connected'}</span>
                <span className="w-full h-0.5 rounded-full" style={{ background: warmest ? 'var(--orange)' : 'var(--border)' }} />
              </span>
              <Dot name={b.person.name || p.full_name} solid />
            </div>
          )}
          <p className="text-[13px] leading-relaxed" style={muted}>
            {[
              warmest ? `${firstName(warmest.teammate)} is ${warmest.band} with ${name}.` : null,
              conn ? `${firstName(conn.owner)} is connected on LinkedIn.` : pending ? `${firstName(pending.owner)}'s request is pending.` : null,
              w.mutual ? `${w.mutual} mutual connections.` : null,
            ].filter(Boolean).join(' ') || 'Nobody on the team knows them yet.'}
          </p>
        </Question>

        <Question n={7} title="How do we write?">
          <div className="flex flex-wrap gap-1.5">
            {h.channel ? <Chip tone="plum">{channelWord(h.channel)}</Chip> : <Chip tone="muted">no channel yet</Chip>}
            {lang && <Chip tone="muted">{lang}</Chip>}
            {h.address && <Chip tone="muted">{h.address}</Chip>}
          </div>
          <div className="flex flex-col gap-1.5 text-[13px]">
            <div className="flex justify-between gap-3">
              <span>LinkedIn</span>
              {conn ? <span className="font-semibold" style={{ color: 'var(--green)' }}>connected</span>
                : pending ? <span style={{ color: 'var(--yellow)' }}>request pending</span>
                : linkedin ? <a href={linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: 'var(--accent)' }}>profile<External width={10} height={10} /></a>
                : <span style={muted}>no profile</span>}
            </div>
            <div className="flex justify-between gap-3">
              <span>Email</span>
              {email ? <a href={`mailto:${email}`} className="truncate" style={{ color: 'var(--accent)' }}>{email}</a>
                : <button type="button" onClick={onEnrich} disabled={enriching} style={{ color: 'var(--accent)' }}>{enriching ? 'Looking…' : 'find email'}</button>}
            </div>
            <div className="flex justify-between gap-3">
              <span>Phone</span>
              <span style={phone ? undefined : muted}>{phone || 'none'}</span>
            </div>
            {conn && linkedin && (
              <a href={linkedin} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 self-start" style={{ color: 'var(--accent)' }}>Open LinkedIn profile<External width={10} height={10} /></a>
            )}
          </div>
        </Question>

        {total != null && parts && (
          <section className="rounded-xl px-4 py-3.5 flex flex-col gap-2" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold">Why {name} scores {total}</h2>
              <span className="text-[13px] font-semibold" style={{ color: 'var(--green)' }}>{total} / 100</span>
            </div>
            <div className="flex gap-1 h-2" role="img" aria-label={TRUST_PARTS.map((k) => `${PART_SHORT[k]} ${parts[k] ?? 0} of ${DEFAULT_WEIGHTS[k]}`).join(', ')}>
              {TRUST_PARTS.map((k, i) => <span key={k} className="rounded-sm" style={{ flex: Math.max(0, parts[k] ?? 0), background: SCORE_COLORS[i] }} />)}
              <span className="rounded-sm" style={{ flex: Math.max(0, 100 - TRUST_PARTS.reduce((s, k) => s + (parts[k] ?? 0), 0)), background: 'var(--border)' }} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]" style={muted}>
              {TRUST_PARTS.map((k, i) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ background: SCORE_COLORS[i] }} />
                  {PART_SHORT[k]} {parts[k] ?? 0}/{DEFAULT_WEIGHTS[k]}
                </span>
              ))}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
