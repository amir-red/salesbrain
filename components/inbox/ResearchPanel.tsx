'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import CheckBeforeWrite from '@/components/prospect/CheckBeforeWrite';
import { Skeleton } from '@/components/panel/Skeleton';
import { External, Sparkle } from '@/components/icons';
import type { LeadBrief } from '@/lib/lead-brief';
import { agoLabel, dayLabel, SIGNAL_LABEL } from '@/lib/lead-brief';
import { channelWord, clip, firstName, firstSentence, roleFromTitle, shortSize, standLine, whyNowLines } from '@/lib/person-page';

/**
 * The research column beside an Inbox conversation (2026-11-10, Mateo's sales experiments: "a research card beside
 * every conversation"). The same kernel brief as the person page, in the order Mateo works before he writes:
 * check before you write · the next move · where we stand and what is open both ways · who they are · their company
 * today and what changed (dated, linked) · the relationship · how to write. "Profile" opens the full page.
 */

type Loaded = { brief: LeadBrief } | { notLead: true } | { error: string };
const cache = new Map<string, { at: number; v: Loaded }>();
const FRESH_MS = 5 * 60_000;

const muted = { color: 'var(--text-muted)' } as const;

function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="py-3 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>{title}</h3>
        {note && <span className="ml-auto text-[11px]" style={muted}>{note}</span>}
      </div>
      <div className="text-[13px] leading-snug flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

export default function ResearchPanel({ prospectId, personId, name, onClose }: {
  prospectId: string | null; personId: string | null; name: string | null; onClose: () => void;
}) {
  const key = prospectId ? `p:${prospectId}` : personId ? `n:${personId}` : '';
  const [v, setV] = useState<Loaded | null>(() => (key && cache.get(key)?.v) || null);
  const [researching, setResearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!key) { setV({ notLead: true }); return; }
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < FRESH_MS) { setV(hit.v); return; }
    if (!hit) setV(null);
    try {
      const q = prospectId ? `prospect=${prospectId}` : `person=${personId}`;
      const res = await fetch(`/api/inbox/brief?${q}`);
      const d = await res.json();
      const out: Loaded = d.not_a_lead ? { notLead: true } : !res.ok || d.error ? { error: d.error || 'The research did not load' } : { brief: d as LeadBrief };
      cache.set(key, { at: Date.now(), v: out });
      setV(out);
    } catch (e) { setV({ error: e instanceof Error ? e.message : String(e) }); }
  }, [key, prospectId, personId]);
  useEffect(() => { setNote(null); void load(); }, [load]);

  const b = v && 'brief' in v ? v.brief : null;
  async function researchAgain() {
    if (!b) return;
    setResearching(true); setNote(null);
    try {
      const res = await fetch(`/api/prospects/${b.prospect_id}/trust-research`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok || d.error) setNote(d.error === 'Not found' ? 'Only the lead’s owner or an admin can research them.' : (d.error || 'Research failed'));
      else { setNote(d.extracted ? 'Researched. Updated below.' : 'Nothing new was found.'); await load(true); }
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setResearching(false); }
  }

  const head = (
    <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
      <span className="text-sm font-semibold">Research</span>
      {b && <span className="text-[11px] truncate" style={muted}>{b.research.at ? `researched ${agoLabel(b.research.at)}` : 'not researched yet'}</span>}
      <span className="flex-1" />
      {b && <Link href={`/prospects/${b.prospect_id}`} className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Profile →</Link>}
      <button type="button" onClick={onClose} className="text-sm leading-none px-1" style={muted} aria-label="Hide the research" title="Hide the research">×</button>
    </div>
  );

  let body: ReactNode;
  if (!v) {
    body = <div className="p-4 space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-1/2" /></div>;
  } else if ('notLead' in v) {
    body = <p className="p-4 text-[13px]" style={muted}>{firstName(name)} is not in the CRM yet, so nothing is researched. Add them as a lead to get the research and the checks.</p>;
  } else if ('error' in v) {
    body = <p className="p-4 text-[13px]" style={{ color: 'var(--red)' }}>{v.error}</p>;
  } else {
    const bb = v.brief;
    const who = firstName(bb.person.name || name);
    const stand = standLine(bb);
    const role = roleFromTitle(bb.person.title);
    const n = bb.next_step;
    const move = n.set || n.suggested?.label || null;
    const points = whyNowLines(bb).slice(0, 3);
    const co = bb.company;
    const companyLine = firstSentence(co.summary) || [co.name, co.industry, shortSize(co.size), co.hq].filter(Boolean).join(' · ') || null;
    const warm = bb.who_in.warm_with.filter((w) => w.band === 'hot' || w.band === 'warm');
    const conn = bb.who_in.connected.filter((c) => c.status === 'connected');
    const touches = bb.stand.channels.slice(0, 4);
    const lang = bb.how.language === 'de' ? 'German' : bb.how.language === 'en' ? 'English' : bb.how.language;
    body = (
      <div className="px-4 pb-4">
        {(bb.checks?.length ?? 0) > 0 && <div className="pt-3"><CheckBeforeWrite checks={bb.checks} compact /></div>}

        <Block title="Next move">
          <p className="font-semibold">{move || 'Nothing to do now'}</p>
          {n.suggested?.why && n.suggested.label === move && <p className="text-xs" style={muted}>{n.suggested.why}</p>}
          {n.booked_at && n.booking_status !== 'cancelled' && <p className="text-xs" style={muted}>Call booked for {dayLabel(n.booked_at)}</p>}
          {n.ping_at && <p className="text-xs" style={muted}>Ping again {dayLabel(n.ping_at)}</p>}
        </Block>

        <Block title="Where we stand" note={bb.stand.days != null ? `${bb.stand.days} d since last contact` : null}>
          <p>{stand.line}</p>
          {bb.stand.open_items.length > 0 && (
            <ul className="flex flex-col gap-1">
              {bb.stand.open_items.slice(0, 4).map((it, i) => (
                <li key={i} className="text-xs flex gap-1.5">
                  <span className="font-semibold flex-shrink-0" style={{ color: it.side === 'us' ? 'var(--orange)' : 'var(--text-muted)' }}>{it.side === 'us' ? 'We owe' : `${who} owes`}</span>
                  <span>{clip(it.item, 120)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Who they are" note={bb.person.as_of ? `as of ${dayLabel(bb.person.as_of)}` : null}>
          {role && <p>{role.role}{co.name ? ` at ${co.name}` : ''}{bb.person.tenure_months != null ? ` · ${bb.person.tenure_months} months in role` : ''}</p>}
          {firstSentence(bb.person.background) && <p style={muted}>{firstSentence(bb.person.background)}</p>}
          {bb.person.signals.length > 0 && <p className="text-xs" style={muted}>{bb.person.signals.map((s) => SIGNAL_LABEL[s] ?? s.replace(/_/g, ' ')).join(' · ')}</p>}
          {!role && !bb.person.background && <p className="text-xs" style={muted}>Nothing researched about {who} yet.</p>}
        </Block>

        <Block title="Company today" note={co.as_of ? `as of ${dayLabel(co.as_of)}` : null}>
          {companyLine ? <p>{companyLine}</p> : <p className="text-xs" style={muted}>No employer on file.</p>}
          {points.length > 0 && (
            <ul className="flex flex-col gap-1.5 mt-0.5">
              {points.map((t, i) => (
                <li key={i} className="text-xs flex gap-2">
                  <span className="w-14 flex-shrink-0 tabular-nums" style={muted}>{t.when ?? '•'}</span>
                  <span className="min-w-0">{clip(t.text, 160)}
                    {t.source && <a href={t.source} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5" style={{ color: 'var(--accent)' }}>source<External width={9} height={9} /></a>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Relationship">
          {warm.length || conn.length ? (
            <p>{[
              ...warm.slice(0, 2).map((w) => `${firstName(w.teammate)} is ${w.band}`),
              ...conn.filter((c) => !warm.some((w) => w.teammate === c.owner)).slice(0, 2).map((c) => `${firstName(c.owner)} is connected`),
            ].join(' · ')}</p>
          ) : <p className="text-xs" style={muted}>Nobody on the team knows them yet.</p>}
          {touches.length > 0 && (
            <ul className="flex flex-col gap-1">
              {touches.map((c, i) => (
                <li key={i} className="text-xs flex gap-2 min-w-0">
                  <span className="w-16 flex-shrink-0 font-medium">{channelWord(c.channel) ?? c.label}</span>
                  <span className="min-w-0 truncate" style={muted} title={c.last_text || c.text || undefined}>
                    {c.kind === 'meeting' ? 'met' : c.last_from_them ? who : firstName(c.owner_name || 'We')} · {agoLabel(c.last_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="How to write">
          <p>{[channelWord(bb.how.channel) ?? 'No channel yet', lang, bb.how.address].filter(Boolean).join(' · ')}</p>
          <p className="text-xs" style={muted}>{bb.how.why}</p>
        </Block>

        <div className="pt-3 flex items-center gap-3 flex-wrap">
          <button type="button" onClick={researchAgain} disabled={researching}
            className="inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50" style={{ color: 'var(--accent)' }}>
            <Sparkle width={12} height={12} />{researching ? 'Researching… (about 30 s)' : bb.research.at ? 'Research again' : 'Research now'}
          </button>
          {note && <span className="text-[11px]" style={muted}>{note}</span>}
        </div>
      </div>
    );
  }

  return (
    <aside className="w-full xl:w-[360px] flex-shrink-0 border-l flex flex-col min-h-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
      aria-label="Research about this person">
      {head}
      <div className="flex-1 overflow-y-auto min-h-0">{body}</div>
    </aside>
  );
}
