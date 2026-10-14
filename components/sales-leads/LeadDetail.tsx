'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { addDays, CHANNELS, MANUAL_EVENT_KINDS, ROLES, type EventKind, type Lead, type LeadEvent, type TeamUser } from '@/lib/sales-leads';
import { EventIcon, External, Mail } from './icons';

/**
 * The expanded card, in the order Mateo reads it before a call: talking points
 * → who they are → why relevant → firm → track record (+ add a line) → notes.
 * The right rail is "working this lead": back / front office, ping-by date,
 * where met, status actions.
 */
export default function LeadDetail({ lead, users, onPatch, onConvert, busy }: {
  lead: Lead; users: TeamUser[];
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
  onConvert: () => void; busy: boolean;
}) {
  const [events, setEvents] = useState<LeadEvent[] | null>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [kind, setKind] = useState<EventKind>('note');
  const [channel, setChannel] = useState('');
  const [when, setWhen] = useState('');
  const [text, setText] = useState('');
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [saved, setSaved] = useState('');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAll, setShowAll] = useState(false);

  const loadEvents = async () => {
    try {
      const res = await fetch(`/api/sales-leads/${lead.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setEvents(data.events || []);
      setEvErr(null);
    } catch (err) { setEvErr(err instanceof Error ? err.message : String(err)); }
  };
  useEffect(() => { loadEvents(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lead.id, lead.last_contact_at, lead.status, lead.priority]);

  const d = lead.dossier;
  const Eyebrow = ({ children }: { children: React.ReactNode }) => <h4 className="z-eyebrow mt-5 mb-2 first:mt-0">{children}</h4>;
  const field = { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '0.5rem' } as const;
  const ghost = { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '9999px' } as const;

  async function addEvent() {
    if (!text.trim()) return;
    const ok = await onPatch({ note: text.trim(), note_kind: kind, ...(channel ? { channel } : {}), ...(when ? { occurred_at: when } : {}) });
    if (ok) { setText(''); setWhen(''); await loadEvents(); }
  }

  function onNotes(v: string) {
    setNotes(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      const ok = await onPatch({ notes: v });
      setSaved(ok ? 'Saved' : 'Not saved');
      setTimeout(() => setSaved(''), 1500);
    }, 700);
  }

  const shown = events ? (showAll ? events : events.slice(0, 8)) : null;
  const website = lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : null;

  return (
    <div className="px-4 pb-5 pt-3 text-sm" style={{ background: 'var(--accent-glow)', borderTop: '1px solid var(--border)' }}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
        {/* ── Left: the briefing ─────────────────────────────────────── */}
        <div className="min-w-0 rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {d?.talking_points?.length ? (<>
            <Eyebrow>Talking points</Eyebrow>
            <ul className="space-y-1.5">
              {d.talking_points.map((t, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />{t}
                </li>
              ))}
            </ul>
          </>) : null}

          {d?.chronology?.length || d?.interesting ? (<>
            <Eyebrow>Who they are</Eyebrow>
            {d.chronology?.length ? (
              <ol className="space-y-1 pl-3" style={{ borderLeft: '2px solid var(--border)' }}>
                {d.chronology.map((c, i) => (
                  <li key={i} className="text-[13px] leading-relaxed" style={{ color: /^education/i.test(c) ? 'var(--text-muted)' : 'var(--text)' }}>{c}</li>
                ))}
              </ol>) : null}
            {d.interesting ? <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}><span className="font-medium" style={{ color: 'var(--text)' }}>Worth knowing. </span>{d.interesting}</p> : null}
          </>) : null}

          {d?.relevance ? (<><Eyebrow>Why relevant to us</Eyebrow><p className="text-[13px] leading-relaxed">{d.relevance}</p></>) : null}
          {d?.firm_summary ? (<><Eyebrow>Firm &amp; fund</Eyebrow><p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{d.firm_summary}</p></>) : null}
          {d?.sources?.length ? (
            <details className="mt-3">
              <summary className="z-eyebrow cursor-pointer">Sources ({d.sources.length})</summary>
              <div className="mt-1 space-y-0.5">{d.sources.map((s) => <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="block truncate text-xs hover:underline" style={{ color: 'var(--accent)' }}>{s}</a>)}</div>
            </details>
          ) : null}
          {!d && lead.description ? (<><Eyebrow>Origin</Eyebrow><p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-muted)' }}>{lead.description}</p></>) : null}

          <Eyebrow>Track record</Eyebrow>
          {evErr && <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>{evErr} <button type="button" className="underline" onClick={loadEvents}>retry</button></p>}
          {shown === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-4 rounded animate-pulse" style={{ background: 'var(--bg-input)', width: `${80 - i * 15}%` }} />)}</div>
          ) : shown.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nothing on record yet. The first line goes below.</p>
          ) : (
            <ol className="relative pl-6" style={{ borderLeft: '1px solid var(--border)', marginLeft: 7 }}>
              {shown.map((e) => (
                <li key={e.id} className="relative pb-3 last:pb-0">
                  <span className="absolute -left-[1.45rem] top-0.5 w-4 h-4 rounded-full inline-flex items-center justify-center"
                    style={{ background: 'var(--bg-card)', color: ['met', 'sent', 'reply', 'call', 'meeting'].includes(e.kind) ? 'var(--accent)' : 'var(--text-muted)' }}>
                    <EventIcon kind={e.kind} width={13} height={13} />
                  </span>
                  <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {new Date(e.occurred_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    {[e.channel?.replace('_', ' '), e.actor_name].filter(Boolean).map((x) => ` · ${x}`).join('')}
                  </div>
                  <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{e.text}</div>
                </li>
              ))}
            </ol>
          )}
          {events && events.length > 8 && (
            <button type="button" className="mt-2 text-xs underline" style={{ color: 'var(--text-muted)' }} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'show fewer' : `show all ${events.length}`}
            </button>
          )}

          <div className="mt-4 rounded-xl p-3" style={{ background: 'var(--bg-input)' }}>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} className="text-xs px-2 py-1.5" style={field} aria-label="Kind">
                {MANUAL_EVENT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className="text-xs px-2 py-1.5" style={field} aria-label="Channel">
                <option value="">Channel</option>
                {CHANNELS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
              <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} className="text-xs px-2 py-1.5" style={field} aria-label="When" />
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened — coffee in Danville, asked for an intro to the CTO…"
                className="text-xs px-3 py-1.5 flex-1 min-w-[220px]" style={field} onKeyDown={(e) => { if (e.key === 'Enter') addEvent(); }} />
              <button type="button" disabled={busy || !text.trim()} onClick={addEvent}
                className="text-xs px-3.5 py-1.5 rounded-full font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Add</button>
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>Calls, meetings, messages and replies reset the days-since-contact counter. Notes don’t.</p>
          </div>

          <Eyebrow>Notes</Eyebrow>
          <textarea value={notes} onChange={(e) => onNotes(e.target.value)} rows={3} placeholder="Your own notes — saved as you type"
            className="w-full text-[13px] px-3 py-2 resize-y leading-relaxed" style={field} />
          <div className="text-[11px] h-4" style={{ color: 'var(--green)' }}>{saved}</div>
        </div>

        {/* ── Right: working this lead ───────────────────────────────── */}
        <aside className="rounded-2xl p-4 space-y-4 self-start" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="space-y-1 text-xs">
            {lead.email && <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 hover:underline"><Mail width={13} height={13} style={{ color: 'var(--text-muted)' }} />{lead.email}</a>}
            {website && <a href={website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:underline"><External width={13} height={13} style={{ color: 'var(--text-muted)' }} />{website.replace(/^https?:\/\//, '')}</a>}
            {lead.booking_status === 'scheduled' && lead.meet_link && <a href={lead.meet_link} target="_blank" rel="noopener noreferrer" className="font-medium" style={{ color: 'var(--green)' }}>Join the booked demo →</a>}
            {lead.converted_deal_id && <div>Deal: <Link href={`/deals/${lead.converted_deal_id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>{lead.converted_deal_name || 'open'} (G{lead.converted_deal_gate ?? '?'})</Link></div>}
            {lead.prospect_id && <Link href={`/prospects/${lead.prospect_id}`} className="block hover:underline" style={{ color: 'var(--accent)' }}>Lead journey →</Link>}
            <div style={{ color: 'var(--text-muted)' }}>{lead.source.replace(/[:_-]/g, ' ')} · added {new Date(lead.created_at).toLocaleDateString()}</div>
          </div>

          <div className="space-y-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <label className="block">
              <span className="z-eyebrow">Back office</span>
              <select value={lead.responsible_user_id ?? ''} onChange={(e) => onPatch({ responsible_user_id: e.target.value })} className="mt-1 w-full text-xs px-2 py-1.5" style={field}>
                <option value="">Nobody yet</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <span className="block text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{ROLES.responsible.duties} Hears: {ROLES.responsible.hears}</span>
            </label>
            <label className="block">
              <span className="z-eyebrow">Front office</span>
              <select value={lead.front_user_id ?? ''} onChange={(e) => onPatch({ front_user_id: e.target.value })} className="mt-1 w-full text-xs px-2 py-1.5" style={field}>
                <option value="">Same as back office{lead.responsible_name ? ` (${lead.responsible_name})` : ''}</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <span className="block text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{ROLES.front.duties} Hears: {ROLES.front.hears}</span>
            </label>
          </div>

          <div className="space-y-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <div>
              <span className="z-eyebrow">Ping again on</span>
              <div className="mt-1 flex gap-1.5 items-center flex-wrap">
                <input type="date" value={lead.next_contact_at ?? ''} onChange={(e) => onPatch({ next_contact_at: e.target.value })} className="text-xs px-2 py-1.5" style={field} />
                {[1, 3, 7, 14].map((n) => (
                  <button key={n} type="button" onClick={() => onPatch({ next_contact_at: addDays(null, n) })} className="text-[11px] px-2 py-1" style={ghost}>+{n}d</button>
                ))}
                {lead.next_contact_at && <button type="button" onClick={() => onPatch({ next_contact_at: '' })} className="text-[11px] underline" style={{ color: 'var(--text-muted)' }}>clear</button>}
              </div>
            </div>
            <label className="block">
              <span className="z-eyebrow">Where we met</span>
              <input defaultValue={lead.met_at ?? ''} key={`${lead.id}-${lead.met_at ?? ''}`} placeholder="PEI Napa 2026, Fakuma…"
                onBlur={(e) => { if ((e.target.value || '') !== (lead.met_at || '')) onPatch({ met_at: e.target.value }); }}
                className="mt-1 w-full text-xs px-2 py-1.5" style={field} />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            {lead.status !== 'converted' && (
              <button type="button" onClick={onConvert} disabled={busy} className="text-xs px-3.5 py-1.5 rounded-full font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Convert to deal</button>
            )}
            {lead.status === 'new' && <button type="button" disabled={busy} onClick={() => onPatch({ status: 'contacted' })} className="text-xs px-3 py-1.5" style={ghost}>Mark contacted</button>}
            {lead.status === 'contacted' && <button type="button" disabled={busy} onClick={() => onPatch({ status: 'replied' })} className="text-xs px-3 py-1.5" style={ghost}>Mark replied</button>}
            {lead.status !== 'archived' && lead.status !== 'converted' && <button type="button" disabled={busy} onClick={() => onPatch({ status: 'archived' })} className="text-xs px-3 py-1.5" style={{ ...ghost, color: 'var(--text-muted)' }}>Archive</button>}
            {lead.status === 'archived' && <button type="button" disabled={busy} onClick={() => onPatch({ status: 'new' })} className="text-xs px-3 py-1.5" style={ghost}>Restore</button>}
          </div>
        </aside>
      </div>
    </div>
  );
}
