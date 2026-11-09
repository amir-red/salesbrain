'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import Button from '@/components/panel/Button';
import { Pill } from '@/components/panel/PageHeader';
import { Building, Calendar, Chat, Clock, External, Flag, Handshake, Pencil, Send, Sparkle, Target, User } from '@/components/icons';
import { FACT_KIND_LABEL, SIGNAL_LABEL, agoLabel, asOf, dayLabel, type BriefChannel, type LeadBrief as Brief, type OpenItem } from '@/lib/lead-brief';
import { TRUST_KIND_LABELS } from '@/lib/trust';

/**
 * The brief (2026-11-09): the eight questions Mateo answers before he writes to someone, answered on the page itself
 * (plan ~/.claude/plans/lead-brief-mateo-method.md). Live parts (conversations, warmth, ties, the next step) are read
 * as they are; researched parts (who, the company's numbers, dated facts, what they gain) say when they were found
 * and what fills them when empty. Nothing here is a form: it reads like a profile.
 */

const muted = { color: 'var(--text-muted)' } as const;

function Section({ n, icon, title, stamp, children, action }: { n?: number; icon: ReactNode; title: string; stamp?: string | null; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="py-5 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 mb-2.5">
        {n != null && <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{n}</span>}
        <span style={{ color: 'var(--accent)' }}>{icon}</span>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <span className="flex-1" />
        {stamp && <span className="text-[11px]" style={muted}>{stamp}</span>}
        {action}
      </div>
      <div className="text-sm leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs italic" style={muted}>{children}</p>;
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const live = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!live.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {live.map(([k, v]) => (<div key={k} className="contents"><dt style={muted}>{k}</dt><dd className="min-w-0">{v}</dd></div>))}
    </dl>
  );
}

function ChannelRow({ c }: { c: BriefChannel }) {
  const who = c.kind === 'meeting' ? (c.owner_name ? `${c.owner_name}` : 'we') : c.last_from_them ? 'They' : (c.owner_name || 'We');
  const text = (c.last_text || c.text || '').replace(/\s+/g, ' ').trim();
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="mt-0.5 w-20 shrink-0 text-xs font-medium">{c.label}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs" style={muted}>
          {who}{c.owner_name && c.kind !== 'meeting' && !c.last_from_them ? '' : c.owner_name && c.kind !== 'meeting' ? ` → ${c.owner_name}` : ''} · {agoLabel(c.last_at)}
          {c.count > 1 ? ` · ${c.count} messages` : ''}{c.needs_reply ? ' · ' : ''}{c.needs_reply && <span style={{ color: 'var(--orange)' }}>needs a reply</span>}
        </p>
        {text && <p className="text-xs truncate" title={text}>“{text.slice(0, 160)}{text.length > 160 ? '…' : ''}”</p>}
      </div>
      {c.inbox_key && <Link href={`/inbox?c=${encodeURIComponent(c.inbox_key)}`} className="text-[11px] shrink-0 hover:underline" style={{ color: 'var(--accent)' }}>Open in Inbox →</Link>}
    </div>
  );
}

function Item({ it }: { it: OpenItem }) {
  const color = it.kind === 'question' && it.side === 'us' ? 'var(--orange)' : it.kind === 'draft' ? 'var(--yellow)' : 'var(--text-muted)';
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      <span><span className="font-medium">{it.side === 'us' ? 'Ours' : 'Theirs'}:</span> {it.item}</span>
    </li>
  );
}

export default function LeadBrief({ b, researching, onResearch, enriching, onEnrich }: { b: Brief; researching: boolean; onResearch: () => void; enriching: boolean; onEnrich: () => void }) {
  const research = (label = 'Research now') => (
    <Button size="sm" onClick={onResearch} disabled={researching}><Sparkle width={12} height={12} />{researching ? 'Researching…' : label}</Button>
  );
  const p = b.person; const co = b.company; const w = b.who_in; const h = b.how; const n = b.next_step;
  const who = p.background || p.mandate || p.prior_roles.length || p.tenure_months != null || p.posts_topics.length;
  const companyKnown = co.summary || co.size || co.revenue || co.ownership || co.aims || co.industry;
  const channelWord = h.channel === 'linkedin' ? 'LinkedIn' : h.channel === 'email' ? 'email' : h.channel === 'whatsapp' ? 'WhatsApp' : null;

  return (
    <div className="grid gap-x-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div>
        <Section n={1} icon={<Chat width={15} height={15} />} title="Where do we stand" stamp={b.stand.channels.length ? `${b.stand.channels.length} channel${b.stand.channels.length === 1 ? '' : 's'}` : null}>
          <p className="text-base font-medium">{b.stand.line}</p>
          {b.stand.channels.length > 0 && (
            <div className="divide-y rounded-xl px-3 mt-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
              {b.stand.channels.slice(0, 6).map((c, i) => <ChannelRow key={i} c={c} />)}
            </div>
          )}
          {b.stand.open_items.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-wider mb-1" style={muted}>Open on both sides</p>
              <ul className="space-y-1">{b.stand.open_items.map((it, i) => <Item key={i} it={it} />)}</ul>
            </div>
          )}
          {b.stand.channels.length === 0 && <Empty>No conversation on any channel yet. The first message starts one — see 7 and 8.</Empty>}
        </Section>

        <Section n={2} icon={<User width={15} height={15} />} title="Who is the person" stamp={asOf(p.as_of)} action={!who ? research() : undefined}>
          {p.background && <p>{p.background}</p>}
          <Facts rows={[
            ['Role', p.title ? <>{p.title}{p.role_confirmed === true ? <span style={muted}> · confirmed</span> : p.role_confirmed === false ? <span style={{ color: 'var(--orange)' }}> · not confirmed</span> : null}</> : null],
            ['In role', p.tenure_months != null ? `${p.tenure_months} months` : null],
            ['Mandate', p.mandate],
            ['Before', p.prior_roles.length ? p.prior_roles.slice(0, 4).join(' · ') : null],
            ['Posts about', p.posts_topics.length ? p.posts_topics.join(', ') : null],
            ['Background', p.employers.length || p.schools.length ? [...p.employers.slice(0, 4), ...p.schools.slice(0, 2)].join(' · ') : null],
          ]} />
          {p.signals.length > 0 && <div className="flex flex-wrap gap-1">{p.signals.map((s) => <Pill key={s} color="var(--cat-teal)">{SIGNAL_LABEL[s] ?? s}</Pill>)}</div>}
          {!who && <Empty>Nothing researched about the person yet — the nightly pass or Research now fills role, tenure, background and what they post about.</Empty>}
        </Section>

        <Section n={3} icon={<Building width={15} height={15} />} title="What is the company" stamp={co.as_of ? asOf(co.as_of) : companyKnown ? 'from the company research' : null} action={!companyKnown ? <Button size="sm" onClick={onEnrich} disabled={enriching}>{enriching ? 'Enriching…' : 'Enrich'}</Button> : undefined}>
          {co.name && <p className="font-medium">{co.name}{co.industry ? <span style={muted}> · {co.industry}</span> : null}</p>}
          {co.summary && <p>{co.summary}</p>}
          <Facts rows={[
            ['Size', co.size], ['Revenue', co.revenue ? `${co.revenue}${co.year ? ` (${co.year})` : ''}` : null],
            ['Ownership', co.ownership], ['Funding', co.funding], ['HQ', co.hq], ['Aims', co.aims],
          ]} />
          {co.signals.length > 0 && <p className="text-xs" style={muted}>Signals: {co.signals.join(', ')}</p>}
          {co.source_url && <a href={co.source_url} target="_blank" rel="noreferrer" className="text-[11px] inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--accent)' }}>source <External width={10} height={10} /></a>}
          {!companyKnown && <Empty>{co.name ? 'No research on the company yet.' : 'No employer on file.'} Enrich finds the employer, the website and the research; Research again adds numbers from filings and the press.</Empty>}
        </Section>

        <Section n={4} icon={<Calendar width={15} height={15} />} title="Why now" stamp={b.why_now.facts.length ? asOf(b.why_now.as_of) : null} action={!b.why_now.facts.length ? research(b.research.at ? 'Research again' : 'Research now') : undefined}>
          {b.why_now.facts.length > 0 ? (
            <ol className="space-y-2">
              {b.why_now.facts.map((f, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="shrink-0 w-20 text-xs tabular-nums" style={muted}>{f.date.length === 7 ? dayLabel(`${f.date}-01`).replace(/^\d+ /, '') : dayLabel(f.date)}</span>
                  <span className="min-w-0 flex-1">
                    <Pill color="var(--cat-violet)">{FACT_KIND_LABEL[f.kind] ?? f.kind}</Pill> {f.fact}
                    {' '}<a href={f.source_url} target="_blank" rel="noreferrer" className="text-[11px] inline-flex items-center gap-0.5 hover:underline" style={{ color: 'var(--accent)' }}>{f.source_title || 'source'} <External width={10} height={10} /></a>
                  </span>
                </li>
              ))}
            </ol>
          ) : b.why_now.legacy ? <p className="whitespace-pre-wrap text-xs">{b.why_now.legacy}</p>
            : <Empty>No dated public fact on record. A deep lookup looks for a new role, hiring, funding, an expansion or a post of the last 18 months — each with a date and a source.</Empty>}
          {b.why_now.signals.length > 0 && <div className="flex flex-wrap gap-1">{b.why_now.signals.map((s) => <Pill key={s} color="var(--cat-teal)">{SIGNAL_LABEL[s] ?? s.replace(/_/g, ' ')}</Pill>)}</div>}
        </Section>

        <Section n={5} icon={<Target width={15} height={15} />} title="What do they gain" stamp={b.gains.angle ? asOf(b.gains.as_of) : null} action={!b.gains.angle ? research(b.research.at ? 'Research again' : 'Research now') : undefined}>
          {b.gains.angle ? <p className="text-base">{b.gains.angle}</p> : <Empty>No angle yet — the research writes one in the person's own terms: what their business gains, and the fact that makes it true for them.</Empty>}
          {b.gains.why && <p className="text-xs" style={muted}>Because: {b.gains.why}</p>}
          {Object.keys(b.gains.partner).length > 0 && (
            <Facts rows={[['They get', b.gains.partner.partner_gets], ['They need', b.gains.partner.partner_needs], ['They give', b.gains.partner.partner_gives]]} />
          )}
          {b.gains.talking_points && <details className="text-xs"><summary className="cursor-pointer" style={{ color: 'var(--accent)' }}>Talking points</summary><p className="whitespace-pre-wrap mt-1">{b.gains.talking_points}</p></details>}
        </Section>
      </div>

      <aside className="lg:pl-8 lg:border-l" style={{ borderColor: 'var(--border)' }}>
        <Section n={8} icon={<Flag width={15} height={15} />} title="Next step">
          {n.set ? <p className="text-base font-medium">{n.set}</p>
            : n.suggested ? <p className="text-base font-medium">{n.suggested.label}</p>
            : <Empty>Nothing to do — this lead is finished.</Empty>}
          {n.suggested && (n.set !== n.suggested.label) && <p className="text-xs" style={muted}>{n.set ? `Suggested: ${n.suggested.label} — ` : ''}{n.suggested.why}</p>}
          <Facts rows={[
            ['Ping again', n.ping_at ? dayLabel(n.ping_at) : null],
            ['Call', n.booked_at && n.booking_status !== 'cancelled' ? dayLabel(n.booked_at) : null],
            ['By', n.responsible ? `${n.responsible}${n.front && n.front !== n.responsible ? ` · front office ${n.front}` : ''}` : null],
            ['Automation', n.lifecycle.step],
          ]} />
          {b.waiting.length > 0 && (
            <p className="text-xs"><span style={{ color: 'var(--yellow)' }}>●</span> {b.waiting.length === 1 ? 'One card waits' : `${b.waiting.length} cards wait`} for a tap · <Link href="/agents" className="underline">Agents</Link></p>
          )}
          <div className="pt-1">
            <Button variant="primary" size="sm" href={`/inbox?compose=${b.prospect_id}`}><Send width={12} height={12} />Write message</Button>
          </div>
        </Section>

        <Section n={6} icon={<Handshake width={15} height={15} />} title="Who gets us in">
          <p>{w.line}</p>
          {w.connected.length > 0 && (
            <ul className="text-xs space-y-0.5">
              {w.connected.map((c) => <li key={c.owner_user_id}><span className="font-medium">{c.owner}</span> · {c.status === 'connected' ? `connected${c.since ? ` since ${dayLabel(c.since)}` : ''}` : 'request pending'}</li>)}
            </ul>
          )}
          {w.warm_with.length > 0 && (
            <ul className="text-xs space-y-0.5">
              {w.warm_with.map((x) => (
                <li key={x.teammate}><Pill color={x.band === 'hot' ? 'var(--red)' : x.band === 'warm' ? 'var(--orange)' : 'var(--text-muted)'}>{x.band}</Pill> {x.teammate}{x.reasons.length ? <span style={muted}> · {x.reasons.join(' · ')}</span> : null}</li>
              ))}
            </ul>
          )}
          <Facts rows={[
            ['Path', w.kind !== 'none' ? `${TRUST_KIND_LABELS[w.kind] ?? w.kind}${w.via ? ` · via ${w.via}` : ''}${w.hops ? ` · ${w.hops} hop${w.hops === 1 ? '' : 's'}` : ''}` : null],
            ['Mutual', w.mutual ? `${w.mutual} on LinkedIn` : null],
            ['Connector', w.connector ? 'visibly brings people together' : null],
          ]} />
          {w.route?.bridges.length ? (
            <p className="text-xs" style={muted}>Bridges: {w.route.bridges.map((x) => `${x.name}${x.is_blue ? ' (reachable now)' : ''}`).join(' · ')}</p>
          ) : null}
        </Section>

        <Section n={7} icon={<Pencil width={15} height={15} />} title="How do we write">
          <div className="flex flex-wrap gap-1.5">
            {channelWord ? <Pill color="var(--accent)">{channelWord}</Pill> : <Pill color="var(--text-muted)">no channel yet</Pill>}
            {h.language && <Pill color="var(--cat-blue)">{h.language === 'de' ? 'German' : h.language === 'en' ? 'English' : h.language}</Pill>}
            {h.address && <Pill color="var(--cat-blue)">{h.address}</Pill>}
          </div>
          <p className="text-xs" style={muted}>
            {h.why}{h.language_from ? ` · language from ${h.language_from}` : ''}{h.address_from ? ` · ${h.address} from ${h.address_from}` : ''}
          </p>
          <p className="text-xs" style={muted}>The drafter writes in the sender&apos;s own voice; it reads this conversation and the facts above.</p>
        </Section>

        <Section icon={<Clock width={15} height={15} />} title="Freshness">
          <p className="text-xs" style={muted}>
            {b.research.at ? `Researched ${agoLabel(b.research.at)} (${b.research.tier === 'grounded' ? 'deep lookup' : 'free lookup'})` : 'Not researched yet'}
            {b.research.sources.length ? ' · sources: ' : ''}
            {b.research.sources.slice(0, 4).map((s, i) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline mr-1.5" style={{ color: 'var(--accent)' }}>{s.title || `link ${i + 1}`}</a>)}
          </p>
        </Section>
      </aside>
    </div>
  );
}
