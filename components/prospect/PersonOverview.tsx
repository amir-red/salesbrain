'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import Button from '@/components/panel/Button';
import { External, Send, Sparkle } from '@/components/icons';
import type { LeadBrief } from '@/lib/lead-brief';
import { agoLabel, dayLabel, initialsOf, SIGNAL_LABEL } from '@/lib/lead-brief';
import type { Prospect } from '@/lib/prospects';
import { DEFAULT_WEIGHTS, PART_SHORT, TRUST_PARTS } from '@/lib/trust';
import { channelWord, clip, firstName, firstSentence, shortSize, standLine, talkingPoints } from '@/lib/person-page';

/**
 * The person page's Overview (redesign D, 2026-11-09): a short story on the left — one or two sentences per question —
 * and on the right the next move with its one button, how we get in, how to reach them and the score. The long
 * research lives on the Full brief tab; nothing here is longer than two lines unless asked.
 */

const muted = { color: 'var(--text-muted)' } as const;

function Story({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--blue)' }}>{label}</h2>
      {children}
    </section>
  );
}

function Chip({ children, tone = 'teal' }: { children: ReactNode; tone?: 'teal' | 'muted' | 'orange' }) {
  const c = tone === 'teal' ? 'var(--cat-teal)' : tone === 'orange' ? 'var(--orange)' : 'var(--text-muted)';
  return <span className="text-xs px-2.5 py-1 rounded-full" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>{children}</span>;
}

function RailCard({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl p-5 flex flex-col gap-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{title}</h2>{right}</div>
      {children}
    </section>
  );
}

function Dot({ name, solid }: { name: string | null; solid?: boolean }) {
  return (
    <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0" title={name || undefined}
      style={solid ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--accent-soft)', color: 'var(--accent)' }}>{initialsOf(name)}</span>
  );
}

export default function PersonOverview({ b, p, onEnrich, enriching, onResearch, researching, onTab }: {
  b: LeadBrief; p: Prospect; onEnrich: () => void; enriching: boolean; onResearch: () => void; researching: boolean;
  onTab: (t: 'brief' | 'journey' | 'activity') => void;
}) {
  const [allPoints, setAllPoints] = useState(false);
  const [moreWho, setMoreWho] = useState(false);
  const name = firstName(b.person.name || p.full_name);
  const stand = standLine(b);
  const per = b.person; const co = b.company; const w = b.who_in; const n = b.next_step;
  const who = firstSentence(per.background) || firstSentence(per.mandate);
  const whyNow = firstSentence(b.gains.why) || firstSentence(b.gains.angle);
  const points = talkingPoints(b);
  const shown = allPoints ? points : points.slice(0, 3);
  const researched = !!(who || whyNow || points.length);

  // the rail
  const move = n.set || n.suggested?.label || null;
  const byLine = n.responsible ? `From ${firstName(n.responsible)}${n.front && n.front !== n.responsible ? ` · ${firstName(n.front)} takes the call` : ''}` : null;
  const warmest = w.warm_with.find((x) => x.band === 'hot' || x.band === 'warm');
  const conn = w.connected.find((c) => c.status === 'connected');
  const pending = w.connected.find((c) => c.status === 'pending');
  const email = per.email || p.email;
  const phone = per.phone || p.phone;
  const linkedin = per.linkedin_url || p.linkedin_url;
  const parts = b.trust.parts;
  const total = b.trust.total;

  // recent activity: what each channel last saw, newest first
  const recent = [...b.stand.channels].sort((a, c) => (c.last_at || '').localeCompare(a.last_at || '')).slice(0, 4);

  return (
    <div className="flex flex-col lg:flex-row gap-10 lg:gap-12 py-8">
      <main className="flex-1 min-w-0 max-w-[700px] flex flex-col gap-8">
        <Story label="Where we stand">
          <p className="text-xl font-semibold leading-snug">{stand.line}</p>
          {stand.sub && <p className="text-sm" style={muted}>{stand.sub}</p>}
          {b.stand.open_items.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {b.stand.open_items.slice(0, 4).map((it, i) => (
                <Chip key={i} tone={it.side === 'us' ? 'orange' : 'muted'}>{it.side === 'us' ? 'We owe: ' : `${name} owes: `}{clip(it.item, 60)}</Chip>
              ))}
            </div>
          )}
        </Story>

        <Story label={`Who ${name} is`}>
          {who ? <p className="text-base leading-relaxed">{who}</p>
            : <p className="text-sm" style={muted}>Nothing researched about {name} yet.</p>}
          <div className="flex flex-wrap gap-1.5">
            {per.tenure_months != null && <Chip>{per.tenure_months} months in role</Chip>}
            {per.signals.map((s) => <Chip key={s}>{SIGNAL_LABEL[s] ?? s.replace(/_/g, ' ')}</Chip>)}
            {per.role_confirmed === false && <Chip tone="orange">role not confirmed</Chip>}
          </div>
          {(per.prior_roles.length > 0 || (per.mandate && per.background)) && (
            moreWho ? (
              <div className="text-sm flex flex-col gap-1.5 mt-1" style={muted}>
                {per.mandate && per.background && <p><span className="font-medium" style={{ color: 'var(--text)' }}>Mandate:</span> {per.mandate}</p>}
                {per.prior_roles.length > 0 && <p><span className="font-medium" style={{ color: 'var(--text)' }}>Before:</span> {per.prior_roles.slice(0, 4).join(' · ')}</p>}
              </div>
            ) : <button type="button" onClick={() => setMoreWho(true)} className="text-xs self-start" style={{ color: 'var(--accent)' }}>More about {name}</button>
          )}
        </Story>

        {whyNow && (
          <Story label={`Why ${name}, why now`}>
            <p className="text-base leading-relaxed">{whyNow}</p>
          </Story>
        )}

        {points.length > 0 && (
          <Story label="Talking points">
            <ul className="flex flex-col gap-2.5">
              {shown.map((t, i) => (
                <li key={i} className="flex gap-4 text-[15px] leading-snug">
                  {t.when !== null && <span className="w-[76px] flex-shrink-0 tabular-nums" style={muted}>{t.when}</span>}
                  {t.when === null && <span aria-hidden className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />}
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
          </Story>
        )}

        {!researched && (
          <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: 'var(--bg-input)' }}>
            <p className="text-sm flex-1">No research yet. One lookup fills in who {name} is, why now and what to talk about.</p>
            <Button size="sm" onClick={onResearch} disabled={researching}><Sparkle width={12} height={12} />{researching ? 'Researching…' : 'Research now'}</Button>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-2xl px-5 py-4 flex flex-col gap-1" style={{ border: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold" style={muted}>The person</span>
            <span className="text-sm">{per.title || p.title || 'Role unknown'}</span>
            <span className="text-sm" style={muted}>{[per.location || p.person_city, per.employers.length > 1 ? `ex ${per.employers.slice(1, 3).join(', ')}` : null].filter(Boolean).join(' · ') || ' '}</span>
          </div>
          <div className="rounded-2xl px-5 py-4 flex flex-col gap-1" style={{ border: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold" style={muted}>The company</span>
            <span className="text-sm">{[co.name || p.company_name, co.industry].filter(Boolean).join(' · ') || 'Unknown'}</span>
            <span className="text-sm" style={muted}>{[shortSize(co.size), co.revenue, co.hq].filter(Boolean).join(' · ') || (co.summary ? clip(co.summary, 60) : ' ')}</span>
          </div>
        </div>

        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-sm font-semibold">Recent</h2>
            <button type="button" onClick={() => onTab('activity')} className="text-xs" style={{ color: 'var(--accent)' }}>All activity</button>
          </div>
          {recent.length === 0 && <p className="text-sm" style={muted}>Nothing yet.</p>}
          {recent.map((c, i) => (
            <div key={i} className="flex gap-4 text-sm">
              <span className="w-[64px] flex-shrink-0 tabular-nums" style={muted}>{dayLabel(c.last_at)}</span>
              <span className="min-w-0">
                <span className="font-medium">{channelWord(c.channel) ?? c.label}</span>
                {c.owner_name && <span style={muted}> · {c.owner_name}</span>}
                {(c.last_text || c.text) && <span style={muted}> — {clip(c.last_text || c.text || '', 90)}</span>}
              </span>
            </div>
          ))}
          <p className="text-xs" style={muted}>
            {b.research.at ? `Researched ${agoLabel(b.research.at)}${b.research.sources.length ? ` from ${b.research.sources.length} source${b.research.sources.length === 1 ? '' : 's'}` : ''}` : 'Not researched yet'}
            {' · '}<button type="button" onClick={onResearch} disabled={researching} style={{ color: 'var(--accent)' }}>{researching ? 'Researching…' : 'Research again'}</button>
            {' · '}<button type="button" onClick={() => onTab('brief')} style={{ color: 'var(--accent)' }}>Full brief</button>
          </p>
        </section>
      </main>

      <aside className="w-full lg:w-[360px] flex-shrink-0 flex flex-col gap-4 lg:sticky lg:top-6 self-start">
        <section className="rounded-2xl p-6 flex flex-col gap-3" style={{ background: 'var(--deep-plum)', color: '#ffffff' }}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: '#ebdff0' }}>Your next move</span>
          <span className="text-xl font-semibold leading-snug">{move || 'Nothing to do now'}</span>
          {(byLine || n.suggested?.why) && <span className="text-sm" style={{ color: '#ebdff0' }}>{byLine || n.suggested?.why}</span>}
          {n.booked_at && n.booking_status !== 'cancelled' && <span className="text-sm" style={{ color: '#ebdff0' }}>Call booked for {dayLabel(n.booked_at)}</span>}
          {n.ping_at && <span className="text-sm" style={{ color: '#ebdff0' }}>Ping again {dayLabel(n.ping_at)}</span>}
          <Link href={`/inbox?compose=${p.id}`} className="h-11 mt-1 rounded-full flex items-center justify-center gap-2 text-sm font-semibold"
            style={{ background: '#ffffff', color: 'var(--deep-plum)' }}>
            <Send width={14} height={14} />Write message
          </Link>
          {warmest && warmest.teammate !== n.responsible && (
            <button type="button" onClick={() => onTab('journey')} className="text-sm underline-offset-2 hover:underline" style={{ color: '#ffffff' }}>
              or ask {firstName(warmest.teammate)} for an intro
            </button>
          )}
          {b.waiting.length > 0 && (
            <Link href="/agents" className="text-xs" style={{ color: '#ebdff0' }}>
              {b.waiting.length === 1 ? 'A draft waits' : `${b.waiting.length} drafts wait`} for approval →
            </Link>
          )}
        </section>

        <RailCard title="How we get in">
          {warmest || conn ? (
            <div className="flex items-center gap-2.5">
              <Dot name={warmest?.teammate ?? conn?.owner ?? null} />
              <span className="flex-1 flex flex-col items-center gap-0.5">
                <span className="text-[11px] font-semibold" style={{ color: warmest ? 'var(--orange)' : 'var(--text-muted)' }}>{warmest ? warmest.band : 'connected'}</span>
                <span className="w-full h-0.5 rounded-full" style={{ background: warmest ? 'var(--orange)' : 'var(--border)' }} />
              </span>
              <Dot name={b.person.name || p.full_name} solid />
            </div>
          ) : null}
          <p className="text-sm" style={muted}>
            {[
              warmest ? `${firstName(warmest.teammate)} is ${warmest.band} with ${name}${warmest.reasons[0] ? ` (${warmest.reasons[0]})` : ''}.` : null,
              conn ? `${firstName(conn.owner)} is connected on LinkedIn.` : pending ? `${firstName(pending.owner)}'s request is pending.` : null,
              w.mutual ? `${w.mutual} mutual connections.` : null,
            ].filter(Boolean).join(' ') || 'Nobody on the team knows them yet.'}
          </p>
        </RailCard>

        <RailCard title={`Reach ${name}`}>
          <div className="flex flex-col gap-2 text-sm">
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
        </RailCard>

        {total != null && parts && (
          <RailCard title={`Why ${total}`} right={<span className="text-sm font-semibold" style={{ color: 'var(--green)' }}>{total} / 100</span>}>
            <div className="flex gap-1 h-2.5" role="img" aria-label={TRUST_PARTS.map((k) => `${PART_SHORT[k]} ${parts[k] ?? 0} of ${DEFAULT_WEIGHTS[k]}`).join(', ')}>
              {TRUST_PARTS.map((k, i) => (
                <span key={k} className="rounded-sm" style={{ flex: Math.max(0, parts[k] ?? 0), background: ['var(--accent)', 'var(--blue)', 'var(--highlight)', 'var(--cat-teal)'][i] }} />
              ))}
              <span className="rounded-sm" style={{ flex: Math.max(0, 100 - TRUST_PARTS.reduce((s, k) => s + (parts[k] ?? 0), 0)), background: 'var(--border)' }} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" style={muted}>
              {TRUST_PARTS.map((k, i) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ background: ['var(--accent)', 'var(--blue)', 'var(--highlight)', 'var(--cat-teal)'][i] }} />
                  {PART_SHORT[k]} {parts[k] ?? 0}/{DEFAULT_WEIGHTS[k]}
                </span>
              ))}
            </div>
          </RailCard>
        )}
      </aside>
    </div>
  );
}
