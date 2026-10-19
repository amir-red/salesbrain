'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { addDays, CHANNEL_LABELS, CHANNEL_REQUIRED, CHANNELS, DEFAULT_CHANNEL, JOURNEY_STAGES, linkedInLabel, type LinkedInLink, linkedInState, MANUAL_EVENT_KINDS, NEXT_STEP_PRESETS, ROLES, suggestNextStep, type EventKind, type Lead, type LeadEvent, type TeamUser } from '@/lib/sales-leads';
import { Chevron, EventIcon, External, LinkedIn, Mail, Pencil, Phone } from './icons';
import { EnrichProgress, useEnrich } from './EnrichPanel';
import LifecyclePanel from './LifecyclePanel';

/**
 * The expanded card, in the order Mateo reads it before a call: talking points
 * → who they are → why relevant → firm → track record (+ log a line) → background.
 * The right rail is "working this lead": back / front office, ping-by date,
 * where met, status actions.
 */
export default function LeadDetail({ lead, users, onPatch, onConvert, onRefresh, busy, viewerId, viewerIsAdmin }: {
  lead: Lead; users: TeamUser[];
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
  onConvert: () => void; onRefresh?: () => void; busy: boolean;
  viewerId?: string | null; viewerIsAdmin?: boolean;
}) {
  const [events, setEvents] = useState<LeadEvent[] | null>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [kind, setKind] = useState<EventKind>('note');
  const [channel, setChannel] = useState('');
  const [when, setWhen] = useState(todayLocal);
  const [text, setText] = useState('');
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [saved, setSaved] = useState<'' | 'saving' | 'saved' | 'failed'>('');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const logRef = useRef<HTMLTextAreaElement | null>(null);
  const [cardErr, setCardErr] = useState(false);
  // Both boxes grow with their text (the background box up to a sensible height, then it scrolls).
  useEffect(() => grow(notesRef.current, 420), [notes]);
  useEffect(() => grow(logRef.current, 240), [text]);
  const [showAll, setShowAll] = useState(false);
  // Track record open / folded — the viewer's own preference, remembered in this browser only.
  const [trackOpen, setTrackOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(TRACK_KEY) === '0') setTrackOpen(false); } catch { /* storage blocked: stay open */ } }, []);
  const toggleTrack = () => setTrackOpen((o) => { try { localStorage.setItem(TRACK_KEY, o ? '0' : '1'); } catch { /* ignore */ } return !o; });
  // Card edits (name / title / company) and the one track-record line being edited.
  const [editingCard, setEditingCard] = useState(false);
  const [card, setCard] = useState({ full_name: lead.full_name, title: lead.title ?? '', company: lead.company === 'Unknown' ? '' : lead.company });
  const [editingEvent, setEditingEvent] = useState<{ id: string; text: string; when: string } | null>(null);
  const [evSaving, setEvSaving] = useState(false);
  const [links, setLinks] = useState<LinkedInLink[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [stepDraft, setStepDraft] = useState(lead.next_step ?? '');
  useEffect(() => setStepDraft(lead.next_step ?? ''), [lead.id, lead.next_step]);

  const loadEvents = async () => {
    try {
      const res = await fetch(`/api/sales-leads/${lead.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setEvents(data.events || []);
      setLinks(data.linkedin_links || []);
      setEvErr(null);
    } catch (err) { setEvErr(err instanceof Error ? err.message : String(err)); }
  };
  useEffect(() => { loadEvents(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lead.id, lead.last_contact_at, lead.status, lead.priority]);

  const d = lead.dossier;
  const Eyebrow = ({ children }: { children: React.ReactNode }) => <h4 className="z-eyebrow mt-5 mb-2 first:mt-0">{children}</h4>;
  const field = { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '0.5rem' } as const;
  const enrich = useEnrich(lead, onRefresh);
  const liState = linkedInState(lead);
  const liInfo = linkedInLabel(liState, lead);
  // The back / front office seats (front falls back to the back office); teammates linked but not in a seat.
  const seats = ((): { id: string; name: string; role: string }[] => {
    const out: { id: string; name: string; role: string }[] = [];
    if (lead.responsible_user_id) out.push({ id: lead.responsible_user_id, name: lead.responsible_name ?? 'Back office', role: lead.front_user_id && lead.front_user_id !== lead.responsible_user_id ? 'back office' : 'back + front office' });
    if (lead.front_user_id && lead.front_user_id !== lead.responsible_user_id) out.push({ id: lead.front_user_id, name: lead.front_name ?? 'Front office', role: 'front office' });
    return out;
  })();
  const others = (links ?? []).filter((l) => !seats.some((x) => x.id === l.owner_user_id));
  const suggestion = suggestNextStep(lead);
  const canConnect = !!lead.prospect_id && (liState === 'not_invited' || liState === 'not_accepted' || liState === 'no_answer' || liState === 'failed');
  async function connect() {
    if (!lead.prospect_id) return;
    setConnecting(true); setConnectMsg(null);
    try {
      const res = await fetch(`/api/prospects/${lead.prospect_id}/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error || 'Could not file the request');
      setConnectMsg({ ok: true, text: `Request filed for ${out.acted_as?.name ?? 'the owner'}'s approval (Telegram or /agents). Nothing is sent until they approve.` });
      onRefresh?.();
    } catch (err) {
      setConnectMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally { setConnecting(false); }
  }
  const saveStep = (v: string) => { if (v.trim() !== (lead.next_step ?? '')) onPatch({ next_step: v.trim() }); };
  const ghost = { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '9999px' } as const;

  async function saveCard() {
    const patch: Record<string, unknown> = {};
    if (card.full_name.trim() && card.full_name.trim() !== lead.full_name) patch.full_name = card.full_name.trim();
    if ((card.title || '') !== (lead.title || '')) patch.title = card.title;
    if ((card.company || '') !== (lead.company === 'Unknown' ? '' : lead.company)) patch.company = card.company;
    if (Object.keys(patch).length === 0) { setEditingCard(false); return; }
    setCardErr(false);
    const ok = await onPatch(patch);
    if (ok) { setEditingCard(false); await loadEvents(); }
    else setCardErr(true);
  }

  async function saveEvent() {
    if (!editingEvent || !editingEvent.text.trim()) return;
    setEvSaving(true);
    try {
      const res = await fetch(`/api/sales-leads/${lead.id}/events/${editingEvent.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editingEvent.text.trim(), ...(editingEvent.when ? { occurred_at: editingEvent.when } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setEditingEvent(null);
      await loadEvents();
    } catch (err) { setEvErr(err instanceof Error ? err.message : String(err)); }
    finally { setEvSaving(false); }
  }

  const canEdit = (e: LeadEvent) => ['note', 'met', 'sent', 'reply', 'call', 'meeting'].includes(e.kind)
    && (viewerIsAdmin || (!!viewerId && e.actor_user_id === viewerId));

  const kindInfo = MANUAL_EVENT_KINDS.find((k) => k.kind === kind);
  const needsChannel = CHANNEL_REQUIRED.has(kind) && !channel;
  function pickKind(k: EventKind) { setKind(k); setChannel(DEFAULT_CHANNEL[k] ?? ''); }
  async function addEvent() {
    if (!text.trim() || needsChannel) return;
    // Today = no date sent: the line keeps the real time instead of noon.
    const ok = await onPatch({ note: text.trim(), note_kind: kind, ...(kindInfo?.contact && channel ? { channel } : {}),
      ...(when && when !== todayLocal() ? { occurred_at: when } : {}) });
    if (ok) { setText(''); setWhen(todayLocal()); setChannel(DEFAULT_CHANNEL[kind] ?? ''); await loadEvents(); }
  }

  function onNotes(v: string) {
    setNotes(v);
    setSaved('saving');
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      const ok = await onPatch({ notes: v });
      setSaved(ok ? 'saved' : 'failed');
      if (ok) setTimeout(() => setSaved((s) => (s === 'saved' ? '' : s)), 2000);
    }, 700);
  }

  const shown = events ? (showAll ? events : events.slice(0, 8)) : null;
  const website = lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : null;

  return (
    <div className="px-4 pb-5 pt-3 text-sm" style={{ background: 'var(--accent-glow)', borderTop: '1px solid var(--border)' }}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
        {/* ── Left: the briefing ─────────────────────────────────────── */}
        <div className="min-w-0 rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {/* Who this is — editable in place */}
          <div className="flex items-start gap-3 mb-3">
            {editingCard ? (
              <div className="flex-1 grid gap-2 sm:grid-cols-3">
                <input value={card.full_name} onChange={(e) => setCard({ ...card, full_name: e.target.value })} placeholder="Name" className="text-sm px-3 py-1.5 font-semibold" style={field} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') saveCard(); if (e.key === 'Escape') setEditingCard(false); }} />
                <input value={card.title} onChange={(e) => setCard({ ...card, title: e.target.value })} placeholder="Title" className="text-sm px-3 py-1.5" style={field}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveCard(); if (e.key === 'Escape') setEditingCard(false); }} />
                <input value={card.company} onChange={(e) => setCard({ ...card, company: e.target.value })} placeholder="Company" className="text-sm px-3 py-1.5" style={field}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveCard(); if (e.key === 'Escape') setEditingCard(false); }} />
                <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy || !card.full_name.trim()} onClick={saveCard} className="text-xs px-3.5 py-1.5 rounded-full font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Saving…' : 'Save'}</button>
                  <button type="button" onClick={() => { setEditingCard(false); setCardErr(false); setCard({ full_name: lead.full_name, title: lead.title ?? '', company: lead.company === 'Unknown' ? '' : lead.company }); }} className="text-xs px-3 py-1.5" style={ghost}>Cancel</button>
                  {cardErr && <span role="alert" className="text-xs font-medium" style={{ color: 'var(--red)' }}>Not saved — your changes are still here, try Save again.</span>}
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => { setCard({ full_name: lead.full_name, title: lead.title ?? '', company: lead.company === 'Unknown' ? '' : lead.company }); setEditingCard(true); }}
                title="Edit name, title, company" className="flex-1 text-left group min-w-0">
                <span className="text-base font-semibold">{lead.full_name}</span>
                <span className="ml-2 inline-flex items-center gap-1 text-[11px] align-middle opacity-60 group-hover:opacity-100" style={{ color: 'var(--text-muted)' }}><Pencil width={12} height={12} />edit</span>
                <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{[lead.title, lead.company !== 'Unknown' ? lead.company : null].filter(Boolean).join(' · ') || 'no title on file'}</div>
              </button>
            )}
          </div>

          {/* What the system is doing about this lead, and the controls that fit the stage */}
          <LifecyclePanel lead={lead} viewerId={viewerId} onRefresh={() => { onRefresh?.(); loadEvents(); }} onConnect={connect} connecting={connecting} canConnect={canConnect} busy={busy} />

          {/* Journey — five steps, click to set; step 1 rates the intro, step 5 closes */}
          <div className="mb-4 rounded-xl p-3" style={{ background: 'var(--bg-input)' }}>
            <ol className="flex items-stretch gap-1">
              {JOURNEY_STAGES.map((st) => {
                const done = lead.journey_stage >= st.stage;
                const current = lead.journey_stage === st.stage;
                const lost = st.stage === 5 && lead.journey_outcome === 'lost';
                const fill = lost ? 'var(--red)' : done ? 'var(--accent)' : 'var(--border)';
                return (
                  <li key={st.stage} className="flex-1 min-w-0">
                    <button type="button" disabled={busy} title={st.hint}
                      onClick={() => onPatch({ journey_stage: current ? st.stage - 1 : st.stage })}
                      className="w-full text-left group">
                      <div className="h-1.5 rounded-full" style={{ background: fill }} />
                      <div className="mt-1 text-[11px] leading-tight truncate" style={{ color: done ? 'var(--text)' : 'var(--text-muted)', fontWeight: current ? 600 : 400 }}>
                        {st.stage}. {st.label}
                      </div>
                    </button>
                    {st.stage === 1 && lead.journey_stage >= 1 && (
                      <select value={lead.intro_quality ?? 0} onChange={(e) => onPatch({ intro_quality: Number(e.target.value) })} className="mt-1 text-[11px] px-1.5 py-0.5" style={field} aria-label="Quality of the introduction">
                        <option value={0}>quality?</option>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                      </select>
                    )}
                    {st.stage === 5 && lead.journey_stage >= 5 && (
                      <div className="mt-1 flex gap-1">
                        <button type="button" disabled={busy} onClick={() => { if (lead.journey_outcome !== 'qualified') onPatch({ journey_outcome: 'qualified' }); if (lead.status !== 'converted') onConvert(); }}
                          className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: lead.journey_outcome === 'qualified' ? 'var(--accent)' : 'var(--bg-card)', color: lead.journey_outcome === 'qualified' ? 'var(--accent-fg)' : 'var(--text)', border: '1px solid var(--border)' }}>
                          {lead.status === 'converted' ? 'in funnel' : 'qualified → funnel'}
                        </button>
                        <button type="button" disabled={busy} onClick={() => onPatch({ journey_outcome: lost ? '' : 'lost' })}
                          className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: lost ? 'var(--red)' : 'var(--bg-card)', color: lost ? 'var(--accent-fg)' : 'var(--text)', border: '1px solid var(--border)' }}>lost</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

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

          <button type="button" onClick={toggleTrack} aria-expanded={trackOpen}
            className="mt-5 mb-2 w-full flex items-center gap-2 text-left group">
            <Chevron width={14} height={14} style={{ color: 'var(--text-muted)', transform: trackOpen ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }} />
            <h4 className="z-eyebrow">Track record</h4>
            {events && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{events.length} {events.length === 1 ? 'line' : 'lines'}</span>}
            <span className="ml-auto text-[11px] opacity-60 group-hover:opacity-100" style={{ color: 'var(--text-muted)' }}>{trackOpen ? 'fold' : 'show'}</span>
          </button>
          {evErr && <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>{evErr} <button type="button" className="underline" onClick={loadEvents}>retry</button></p>}
          {!trackOpen ? (
            events && events[0] ? (
              <button type="button" onClick={toggleTrack} className="w-full text-left text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                Latest · {new Date(events[0].occurred_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} — {events[0].text}
              </button>
            ) : null
          ) : shown === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-4 rounded animate-pulse" style={{ background: 'var(--bg-input)', width: `${80 - i * 15}%` }} />)}</div>
          ) : shown.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nothing on record yet.</p>
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
                    {[e.channel ? (CHANNEL_LABELS[e.channel] ?? e.channel.replace('_', ' ')) : null, e.actor_name].filter(Boolean).map((x) => ` · ${x}`).join('')}
                  </div>
                  {editingEvent?.id === e.id ? (
                    <div className="mt-1 space-y-1.5">
                      <textarea value={editingEvent.text} onChange={(ev) => setEditingEvent({ ...editingEvent, text: ev.target.value })} rows={3} className="w-full text-[13px] px-3 py-2 resize-y" style={field} autoFocus />
                      <div className="flex gap-2 items-center">
                        <input type="date" value={editingEvent.when} onChange={(ev) => setEditingEvent({ ...editingEvent, when: ev.target.value })} className="text-xs px-2 py-1" style={field} aria-label="Date" />
                        <button type="button" disabled={evSaving || !editingEvent.text.trim()} onClick={saveEvent} className="text-xs px-3.5 py-1 rounded-full font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Save</button>
                        <button type="button" onClick={() => setEditingEvent(null)} className="text-xs px-3 py-1" style={ghost}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words group">
                      {e.text}
                      {canEdit(e) && (
                        <button type="button" onClick={() => setEditingEvent({ id: e.id, text: e.text, when: e.occurred_at.slice(0, 10) })}
                          className="ml-2 text-[11px] underline opacity-0 group-hover:opacity-100" style={{ color: 'var(--text-muted)' }}>edit</button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {trackOpen && events && events.length > 8 && (
            <button type="button" className="mt-2 text-xs underline" style={{ color: 'var(--text-muted)' }} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'show fewer' : `show all ${events.length}`}
            </button>
          )}

          {/* Log a line: what kind first (it decides whether "last talked" moves), then what happened. */}
          <div className="mt-4 rounded-xl p-3" style={{ background: 'var(--bg-input)' }}>
            <div className="flex flex-wrap items-center gap-1.5 mb-2" role="radiogroup" aria-label="What kind of line">
              {MANUAL_EVENT_KINDS.map((k) => {
                const on = k.kind === kind;
                return (
                  <button key={k.kind} type="button" role="radio" aria-checked={on} onClick={() => pickKind(k.kind)}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                    style={on ? { background: 'var(--accent)', color: 'var(--accent-fg)', border: '1px solid var(--accent)' }
                      : { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                    <EventIcon kind={k.kind} width={13} height={13} />{k.label}
                  </button>
                );
              })}
            </div>
            <textarea ref={logRef} value={text} onChange={(e) => setText(e.target.value)} rows={2}
              placeholder={kind === 'note' ? 'Write a note — what you learned, decided or agreed…' : `What happened in this ${kindInfo?.label.toLowerCase() ?? 'contact'}?`}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addEvent(); } }}
              className="w-full text-[13px] px-3 py-2 leading-relaxed resize-none" style={field} aria-label="What happened" />
            {kindInfo?.contact && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Channel">
                <span className="text-xs mr-0.5" style={{ color: needsChannel ? 'var(--red)' : 'var(--text-muted)', fontWeight: needsChannel ? 600 : undefined }}>
                  {needsChannel ? 'Via which channel?' : 'Via'}
                </span>
                {CHANNELS.map((c) => {
                  const on = c === channel;
                  return (
                    <button key={c} type="button" role="radio" aria-checked={on} onClick={() => setChannel(on && !CHANNEL_REQUIRED.has(kind) ? '' : c)}
                      className="text-[11px] px-2 py-0.5 rounded-full"
                      style={on ? { background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', border: '1px solid var(--accent)' }
                        : { background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                      {CHANNEL_LABELS[c] ?? c}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                {when === todayLocal() ? 'Today' : 'On'}
                <input type="date" value={when} max={todayLocal()} onChange={(e) => setWhen(e.target.value || todayLocal())} className="text-xs px-2 py-1" style={field} aria-label="Date" />
              </label>
              <span className="text-[11px] flex-1 min-w-[180px]" style={{ color: 'var(--text-muted)' }}>
                {kindInfo?.contact ? 'Counts as contact — resets “last talked”.' : 'A note does not reset “last talked”.'} ⌘/Ctrl + Enter to add.
              </span>
              <button type="button" disabled={busy || !text.trim() || needsChannel} onClick={addEvent}
                title={needsChannel ? 'Pick the channel first' : undefined}
                className="text-xs px-4 py-1.5 rounded-full font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                Add to track record
              </button>
            </div>
          </div>

          <div className="mt-5 mb-2 flex items-baseline gap-2">
            <h4 className="z-eyebrow">Background</h4>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>standing context, not dated — anything that happened goes in the track record</span>
            <span className="ml-auto text-[11px]" aria-live="polite"
              style={{ color: saved === 'failed' ? 'var(--red)' : saved === 'saved' ? 'var(--green)' : 'var(--text-muted)', fontWeight: saved === 'failed' ? 600 : undefined }}>
              {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved ✓' : saved === 'failed' ? 'Not saved — keep typing to retry' : ''}
            </span>
          </div>
          <textarea ref={notesRef} value={notes} onChange={(e) => onNotes(e.target.value)} rows={3}
            placeholder="Who they are to us, how the relationship works, what to keep in mind… (saves as you type)"
            className="w-full text-[13px] px-3 py-2 resize-y leading-relaxed" style={field} aria-label="Background" />
        </div>

        {/* ── Right: working this lead ───────────────────────────────── */}
        <aside className="rounded-2xl p-4 space-y-4 self-start" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div>
            <div className="flex items-center justify-between">
              <span className="z-eyebrow">Contact</span>
              <button type="button" onClick={enrich.start} disabled={enrich.running || enrich.missing.length === 0}
                title={enrich.missing.length === 0 ? 'LinkedIn, website and email are all filled in' : `Look up the missing ${enrich.missing.map((m) => m.label.toLowerCase()).join(', ')}. Phone is not searched.`}
                className="text-[11px] px-3 py-1 rounded-full font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                {enrich.running && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />}
                {enrich.running ? 'Enriching…' : 'Enrich'}
              </button>
            </div>
            {enrich.steps && <EnrichProgress steps={enrich.steps} running={enrich.running} fatal={enrich.fatal} onPick={enrich.pick} />}
            <div className="mt-1.5 space-y-1.5 text-xs">
              <ContactRow label="Website" value={lead.website} field="website" placeholder="add website" icon={<External width={13} height={13} />}
                href={website} display={website ? website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null} onSave={(v) => onPatch({ website: v })} />
              <ContactRow label="Email" value={lead.email} field="email" placeholder="add email" icon={<Mail width={13} height={13} />}
                href={lead.email ? `mailto:${lead.email}` : null} display={lead.email || null} onSave={(v) => onPatch({ email: v })} />
              <ContactRow label="Phone" value={lead.phone} field="phone" placeholder="add phone" icon={<Phone width={13} height={13} />}
                href={lead.phone ? `tel:${lead.phone.replace(/[^+\d]/g, '')}` : null} display={lead.phone || null} onSave={(v) => onPatch({ phone: v })} />
              <ContactRow label="LinkedIn" value={lead.linkedin_url} field="linkedin_url" placeholder="add profile URL" icon={<LinkedIn width={13} height={13} />}
                href={lead.linkedin_url} display={lead.linkedin_url ? lead.linkedin_url.replace(/^https?:\/\/(www\.)?linkedin\.com\//, '').replace(/\/$/, '') : null} onSave={(v) => onPatch({ linkedin_url: v })} />
            </div>

            {/* who on the team is linked to this person — the lead's own back / front office may not be, a teammate may be */}
            <div className="mt-2 rounded-xl px-3 py-2 space-y-1 text-[11px]" style={{ background: 'var(--bg-input)' }}>
              <div className="z-eyebrow">Connected on LinkedIn</div>
              {links === null ? <div style={{ color: 'var(--text-muted)' }}>checking…</div> : (<>
                {seats.map((seat) => {
                  const hit = links.find((l) => l.owner_user_id === seat.id);
                  const tone = hit?.status === 'connected' ? 'var(--green)' : hit ? 'var(--yellow)' : 'var(--text-muted)';
                  return (
                    <div key={seat.role} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tone }} />
                      <span><span className="font-medium">{seat.name}</span> <span style={{ color: 'var(--text-muted)' }}>({seat.role})</span></span>
                      <span className="ml-auto" style={{ color: hit ? tone : 'var(--text-muted)' }}>
                        {hit ? `${hit.status === 'connected' ? 'connected' : 'request pending'}${hit.since ? ` · ${new Date(hit.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}` : 'not connected'}
                      </span>
                    </div>
                  );
                })}
                {others.map((l) => (
                  <div key={l.owner_user_id} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: l.status === 'connected' ? 'var(--green)' : 'var(--yellow)' }} />
                    <span className="font-medium">{l.owner}</span>
                    <span className="ml-auto" style={{ color: l.status === 'connected' ? 'var(--green)' : 'var(--yellow)' }}>
                      {l.status === 'connected' ? 'connected' : 'request pending'}{l.since ? ` · ${new Date(l.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
                    </span>
                  </div>
                ))}
                {links.length === 0 && lead.journey_stage >= 2 && <div style={{ color: 'var(--text-muted)' }}>Marked as connected by hand.</div>}
                {links.length === 0 && lead.journey_stage < 2 && !seats.length && <div style={{ color: 'var(--text-muted)' }}>Nobody on the team is connected yet.</div>}
                {others.length > 0 && !links.some((l) => seats.some((x) => x.id === l.owner_user_id) && l.status === 'connected') && (
                  <div style={{ color: 'var(--text-muted)' }}>Not through {seats.map((x) => x.name).join(' or ') || 'the lead owner'} — {others[0].owner} can reach them, or introduce.</div>
                )}
              </>)}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {canConnect && (
                  <button type="button" onClick={connect} disabled={connecting || busy} className="text-[11px] px-3 py-1 rounded-full font-medium disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }} title="Files the request for the lead owner's approval; nothing is sent until they approve">{connecting ? 'Filing…' : 'Connect on LinkedIn'}</button>
                )}
                {liState !== 'connected' && lead.journey_stage < 2 && (
                  <button type="button" onClick={() => onPatch({ journey_stage: 2 })} disabled={busy} className="text-[11px] px-2.5 py-1 disabled:opacity-50" style={ghost}
                    title="We are already connected on LinkedIn — set the journey to step 2">Mark as connected</button>
                )}
              </div>
              {connectMsg && <p style={{ color: connectMsg.ok ? 'var(--green)' : 'var(--red)' }}>{connectMsg.text}</p>}
              {liState === 'not_invited' && !lead.prospect_id && (
                <p style={{ color: 'var(--text-muted)' }}>This lead is not on a prospect list, so the request cannot be filed from here. Connect on LinkedIn, then mark it connected.</p>
              )}
            </div>
          </div>

          <div className="space-y-1 text-xs pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            {lead.booking_status === 'scheduled' && lead.meet_link && <a href={lead.meet_link} target="_blank" rel="noopener noreferrer" className="font-medium" style={{ color: 'var(--green)' }}>Join the booked demo →</a>}
            {lead.converted_deal_id && <div>Deal: <Link href={`/deals/${lead.converted_deal_id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>{lead.converted_deal_name || 'open'} (G{lead.converted_deal_gate ?? '?'})</Link></div>}
            {lead.prospect_id && <Link href={`/prospects/${lead.prospect_id}`} className="block hover:underline" style={{ color: 'var(--accent)' }}>Lead journey →</Link>}
            <div style={{ color: 'var(--text-muted)' }}>{lead.source.replace(/[:_-]/g, ' ')} · added {new Date(lead.created_at).toLocaleDateString()}</div>
          </div>

          <div className="space-y-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <label className="block">
              <span className="z-eyebrow" title={`${ROLES.responsible.duties} Hears: ${ROLES.responsible.hears}`}>Back office</span>
              <select value={lead.responsible_user_id ?? ''} onChange={(e) => onPatch({ responsible_user_id: e.target.value })} className="mt-1 w-full text-xs px-2 py-1.5" style={field}>
                <option value="">Nobody yet</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="z-eyebrow" title={`${ROLES.front.duties} Hears: ${ROLES.front.hears}`}>Front office</span>
              <select value={lead.front_user_id ?? ''} onChange={(e) => onPatch({ front_user_id: e.target.value })} className="mt-1 w-full text-xs px-2 py-1.5" style={field}>
                <option value="">Same as back office{lead.responsible_name ? ` (${lead.responsible_name})` : ''}</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
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
            <div>
              <span className="z-eyebrow">Next step</span>
              <input value={stepDraft} onChange={(e) => setStepDraft(e.target.value)} list={`steps-${lead.id}`} maxLength={200}
                placeholder="What we plan to do next…" className="mt-1 w-full text-xs px-2 py-1.5" style={field}
                onBlur={(e) => saveStep(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <datalist id={`steps-${lead.id}`}>{NEXT_STEP_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
              {suggestion && suggestion.label !== (lead.next_step ?? '') && (
                <div className="mt-1.5 flex items-start gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  <span className="flex-1">Suggested: <span className="font-medium" style={{ color: 'var(--text)' }}>{suggestion.label}</span> — {suggestion.why}.</span>
                  <button type="button" onClick={() => { setStepDraft(suggestion.label); onPatch({ next_step: suggestion.label }); }} disabled={busy}
                    className="px-2.5 py-0.5 flex-shrink-0 disabled:opacity-50" style={ghost}>Use</button>
                </div>
              )}
              {lead.next_step && <button type="button" onClick={() => { setStepDraft(''); onPatch({ next_step: '' }); }} className="text-[11px] underline mt-1" style={{ color: 'var(--text-muted)' }}>clear</button>}
            </div>
            <label className="block">
              <span className="z-eyebrow">Where we met</span>
              <input defaultValue={lead.met_at ?? ''} key={`${lead.id}-${lead.met_at ?? ''}`} placeholder="Fakuma 2026…"
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


/** One contact line: label, value (link when set, a quiet placeholder when not), click to edit, Enter / blur saves. */
function ContactRow({ label, value, display, href, placeholder, icon, onSave }: {
  label: string; value: string | null; field: string; display: string | null; href: string | null;
  placeholder: string; icon: React.ReactNode; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => { setEditing(false); if (draft.trim() !== (value ?? '')) onSave(draft.trim()); };
  return (
    <div className="flex items-center gap-2 min-h-[1.5rem]">
      <span className="w-14 flex-shrink-0 z-eyebrow flex items-center gap-1" title={label}>{label}</span>
      {editing ? (
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); } }}
          className="flex-1 min-w-0 text-xs px-2 py-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--accent)', color: 'var(--text)', borderRadius: '0.5rem' }} />
      ) : (<>
        {display && href ? (
          <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="flex-1 min-w-0 truncate hover:underline flex items-center gap-1.5">
            <span style={{ color: 'var(--text-muted)' }}>{icon}</span><span className="truncate">{display}</span>
          </a>
        ) : <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>— </span>}
        <button type="button" onClick={() => setEditing(true)} className="text-[11px] underline flex-shrink-0" style={{ color: 'var(--text-muted)' }}
          aria-label={`Edit ${label}`}>{display ? 'edit' : placeholder}</button>
      </>)}
    </div>
  );
}

/** Today as YYYY-MM-DD in the viewer's own timezone (what a date input shows). */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Fit a textarea to its text, up to `max` px; past that it scrolls. */
function grow(el: HTMLTextAreaElement | null, max: number) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
}

/** localStorage key for the folded / open track record (per viewer, this browser only). */
const TRACK_KEY = 'salesleads.trackOpen';
