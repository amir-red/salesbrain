'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addDays, CHANNELS, EVENT_ICON, MANUAL_EVENT_KINDS, type EventKind, type Lead, type LeadEvent, type TeamUser,
} from '@/lib/sales-leads';

/**
 * The expanded card, in the order Mateo reads it before a call: talking points
 * → who they are → why relevant → firm → track record (+ add a line) → notes
 * → the controls (responsible / front, ping-by date, where met, status).
 */
export default function LeadDetail({ lead, users, onPatch, onConvert, busy }: {
  lead: Lead; users: TeamUser[];
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
  onConvert: () => void; busy: boolean;
}) {
  const [events, setEvents] = useState<LeadEvent[] | null>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [kind, setKind] = useState<EventKind>('note');
  const [channel, setChannel] = useState<string>('');
  const [when, setWhen] = useState<string>('');
  const [text, setText] = useState('');
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [saved, setSaved] = useState('');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showDesc, setShowDesc] = useState(false);

  const loadEvents = async () => {
    try {
      const res = await fetch(`/api/sales-leads/${lead.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setEvents(data.events || []);
    } catch (err) { setEvErr(err instanceof Error ? err.message : String(err)); }
  };
  useEffect(() => { loadEvents(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lead.id, lead.last_contact_at, lead.status, lead.priority]);

  const d = lead.dossier;
  const sec = (title: string) => <h4 className="text-[10px] uppercase tracking-wider font-bold mt-3 mb-1" style={{ color: 'var(--accent)' }}>{title}</h4>;
  const input = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' } as const;

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

  return (
    <div className="px-4 pb-4 pt-1 text-sm" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="grid gap-x-6 md:grid-cols-[1fr_minmax(260px,340px)]">
        <div className="min-w-0">
          {d?.talking_points?.length ? (<>
            {sec('Talking points')}
            <ul className="list-disc pl-5 space-y-1 rounded-lg p-2.5 text-[13px]"
              style={{ background: 'color-mix(in srgb, var(--cat-blue) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--cat-blue) 25%, transparent)' }}>
              {d.talking_points.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </>) : null}

          {d?.chronology?.length || d?.interesting ? (<>
            {sec('Who they are')}
            {d.chronology?.length ? (
              <ul className="space-y-1 ml-1 pl-3" style={{ borderLeft: '2px solid var(--border)' }}>
                {d.chronology.map((c, i) => (
                  <li key={i} className="text-[13px]" style={{ color: /^education/i.test(c) ? 'var(--text-muted)' : 'var(--text)' }}>{c}</li>
                ))}
              </ul>) : null}
            {d.interesting ? <div className="mt-2 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'color-mix(in srgb, var(--yellow) 10%, transparent)' }}>★ {d.interesting}</div> : null}
          </>) : null}

          {d?.relevance ? (<>{sec('Why relevant to us')}<div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'color-mix(in srgb, var(--green) 8%, transparent)' }}>{d.relevance}</div></>) : null}
          {d?.firm_summary ? (<>{sec('Firm & fund')}<p className="text-[13px]">{d.firm_summary}</p></>) : null}
          {d?.sources?.length ? (<>{sec('Sources')}<div className="text-xs space-y-0.5">{d.sources.map((s) => <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="block truncate hover:underline" style={{ color: 'var(--accent)' }}>{s}</a>)}</div></>) : null}

          {lead.description ? (<>
            {sec('Origin')}
            <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>
              {showDesc || lead.description.length < 240 ? lead.description : lead.description.slice(0, 240) + '…'}
              {lead.description.length >= 240 && <button type="button" className="ml-1 underline" onClick={() => setShowDesc(!showDesc)}>{showDesc ? 'less' : 'more'}</button>}
            </p>
          </>) : null}

          {sec('Track record')}
          {evErr && <p className="text-xs" style={{ color: 'var(--red)' }}>{evErr}</p>}
          {events === null ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
            : events.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nothing on record yet. Add the first line below.</p>
            : (
              <ul className="space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-2 text-[13px]">
                    <span className="w-5 text-center flex-shrink-0" title={e.kind}>{EVENT_ICON[e.kind] ?? '•'}</span>
                    <span className="tabular-nums flex-shrink-0 text-xs pt-0.5" style={{ color: 'var(--text-muted)' }}>{e.occurred_at.slice(0, 10)}</span>
                    <span className="min-w-0 whitespace-pre-wrap break-words">
                      {e.text}
                      <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>{[e.channel, e.actor_name].filter(Boolean).join(' · ')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          <div className="mt-2 flex flex-wrap gap-1.5 items-center">
            <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} className="text-xs rounded px-1.5 py-1" style={input}>
              {MANUAL_EVENT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className="text-xs rounded px-1.5 py-1" style={input}>
              <option value="">channel…</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
            <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} className="text-xs rounded px-1.5 py-1" style={input} title="when it happened (default today)" />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="what happened — e.g. coffee in Danville, asked for intro to CTO"
              className="text-xs rounded px-2 py-1 flex-1 min-w-[200px]" style={input}
              onKeyDown={(e) => { if (e.key === 'Enter') addEvent(); }} />
            <button type="button" disabled={busy || !text.trim()} onClick={addEvent}
              className="text-xs px-2.5 py-1 rounded font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Add</button>
          </div>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Call, meeting, met, sent and reply move the “days ago” ticker; a note does not.</p>

          {sec('Notes')}
          <textarea value={notes} onChange={(e) => onNotes(e.target.value)} rows={3}
            placeholder="Your notes on this person (saved as you type)…"
            className="w-full text-[13px] rounded-lg px-3 py-2 resize-y" style={input} />
          <div className="text-[10px] h-3" style={{ color: 'var(--green)' }}>{saved}</div>
        </div>

        {/* Right rail: the controls */}
        <div className="mt-3 md:mt-0 rounded-lg p-3 space-y-3 self-start" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <div className="text-xs space-y-1">
            {lead.email && <div><a href={`mailto:${lead.email}`} className="hover:underline">{lead.email}</a></div>}
            {lead.website && <div><a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--accent)' }}>{lead.website.replace(/^https?:\/\//, '')}</a></div>}
            <div style={{ color: 'var(--text-muted)' }}>{lead.source} · added {new Date(lead.created_at).toLocaleDateString()}</div>
            {lead.booking_status === 'scheduled' && lead.meet_link && <div><a href={lead.meet_link} target="_blank" rel="noopener noreferrer" className="font-medium" style={{ color: 'var(--green)' }}>Join booked demo →</a></div>}
            {lead.converted_deal_id && <div>→ <Link href={`/deals/${lead.converted_deal_id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>{lead.converted_deal_name || 'deal'} (G{lead.converted_deal_gate ?? '?'})</Link></div>}
            {lead.prospect_id && <div><Link href={`/prospects/${lead.prospect_id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>Open the lead journey →</Link></div>}
          </div>

          <label className="block text-xs">
            <span className="font-semibold">Back office</span> <span style={{ color: 'var(--text-muted)' }}>drives the lead</span>
            <select value={lead.responsible_user_id ?? ''} onChange={(e) => onPatch({ responsible_user_id: e.target.value })}
              className="mt-1 w-full text-xs rounded px-2 py-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
              <option value="">— nobody —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="block text-xs">
            <span className="font-semibold">Front office</span> <span style={{ color: 'var(--text-muted)' }}>the face in calls</span>
            <select value={lead.front_user_id ?? ''} onChange={(e) => onPatch({ front_user_id: e.target.value })}
              className="mt-1 w-full text-xs rounded px-2 py-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
              <option value="">— same as back office —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>

          <div className="text-xs">
            <div className="font-semibold">Ping again on</div>
            <div className="flex gap-1 mt-1 items-center flex-wrap">
              <input type="date" value={lead.next_contact_at ?? ''} onChange={(e) => onPatch({ next_contact_at: e.target.value })}
                className="text-xs rounded px-2 py-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              {[1, 3, 7, 14].map((n) => (
                <button key={n} type="button" onClick={() => onPatch({ next_contact_at: addDays(null, n) })}
                  className="text-[11px] px-1.5 py-1 rounded" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>+{n}d</button>
              ))}
              {lead.next_contact_at && <button type="button" onClick={() => onPatch({ next_contact_at: '' })} className="text-[11px] underline" style={{ color: 'var(--text-muted)' }}>clear</button>}
            </div>
          </div>

          <label className="block text-xs">
            <span className="font-semibold">Where we met</span>
            <input defaultValue={lead.met_at ?? ''} key={`${lead.id}-${lead.met_at ?? ''}`} placeholder="e.g. PEI Napa 2026, Fakuma"
              onBlur={(e) => { if ((e.target.value || '') !== (lead.met_at || '')) onPatch({ met_at: e.target.value }); }}
              className="mt-1 w-full text-xs rounded px-2 py-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          </label>

          <div className="flex flex-wrap gap-1.5 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
            {lead.status !== 'converted' && (
              <button type="button" onClick={onConvert} disabled={busy} className="text-xs px-2.5 py-1 rounded font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Convert to deal</button>
            )}
            {lead.status === 'new' && <button type="button" disabled={busy} onClick={() => onPatch({ status: 'contacted' })} className="text-xs px-2.5 py-1 rounded" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>Mark contacted</button>}
            {lead.status === 'contacted' && <button type="button" disabled={busy} onClick={() => onPatch({ status: 'replied' })} className="text-xs px-2.5 py-1 rounded" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>Mark replied</button>}
            {lead.status !== 'archived' && lead.status !== 'converted' && <button type="button" disabled={busy} onClick={() => onPatch({ status: 'archived' })} className="text-xs px-2.5 py-1 rounded" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Archive</button>}
            {lead.status === 'archived' && <button type="button" disabled={busy} onClick={() => onPatch({ status: 'new' })} className="text-xs px-2.5 py-1 rounded" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>Restore</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
