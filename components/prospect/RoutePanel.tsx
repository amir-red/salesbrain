'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ROUTE_COLORS, ROUTE_LEGEND } from '@/lib/prospects';
import type { IntroRequestLite, RouteEntry, RouteHop, RoutePath } from '@/lib/prospects';
import { relativeTime } from '@/lib/time';

const RouteGraph = dynamic(() => import('@/components/prospect/RouteGraph'), { ssr: false });

/**
 * Step 5 — how do I reach this person. The picture, the ranked routes, and the
 * three actions: find (free), probe LinkedIn (spends), ask a connector for an
 * intro (files an approval). Cold send stays where it always was.
 */
export default function RoutePanel({ prospectId, route, intros, degree, teammatesWithLinkedin, onChanged }: {
  prospectId: string; route: RouteEntry | null; intros: IntroRequestLite[]; degree: string | null;
  teammatesWithLinkedin: number; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(route?.paths?.[0]?.path_id ?? null);
  const [ask, setAsk] = useState<{ path: RoutePath; hop: RouteHop } | null>(null);

  const run = async (mode: 'find' | 'expand') => {
    setBusy(mode); setNote(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/route-find`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const out = await res.json();
      if (out.error) setNote(String(out.error));
      else if (out.deferred) setNote(String(out.message || 'Deferred — LinkedIn budget.'));
      else {
        const ex = out.expand as Record<string, Record<string, unknown>> | undefined;
        const bits = [out.note];
        if (ex?.mutual?.searched) bits.push(`Connections-of search: ${ex.mutual.found} found, ${ex.mutual.edges} edges`);
        else if (ex?.mutual?.skipped) bits.push(`mutual search skipped: ${ex.mutual.skipped}`);
        if (ex?.probe && Number(ex.probe.accounts_checked) > 0) bits.push(`teammates checked: ${ex.probe.accounts_checked}, 1st-degree hits: ${ex.probe.hits}`);
        setNote(bits.filter(Boolean).join(' · '));
        setLit((out.paths?.[0]?.path_id as string) ?? null);
      }
      onChanged();
    } finally { setBusy(null); }
  };

  const degreeLabel = degree === '1' ? '1st degree' : degree === '2' ? '2nd degree' : degree === '3' ? '3rd degree' : null;
  const shared = (route?.expand as Record<string, Record<string, unknown>> | undefined)?.profile?.shared_connections_count;
  const openIntros = intros.filter((i) => ['drafted', 'pending_approval', 'sent', 'awaiting_reply'].includes(i.state));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {degreeLabel && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: degree === '1' ? 'var(--green)' : degree === '2' ? 'var(--yellow)' : 'var(--text-muted)' }}>LinkedIn: {degreeLabel}{shared !== undefined && shared !== null ? ` · ${shared} shared` : ''}</span>}
        {route && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>computed {relativeTime(route.computed_at)}</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={() => run('find')} disabled={!!busy} className="px-3 py-1 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }} title="Free — uses what the graph already knows">{busy === 'find' ? 'Finding…' : route ? 'Recompute' : 'Find route'}</button>
          <button onClick={() => run('expand')} disabled={!!busy} className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }} title={`Spends LinkedIn budget: the lead's profile, then a Connections-of search for a 2nd-degree lead, then ${teammatesWithLinkedin} teammate account${teammatesWithLinkedin === 1 ? '' : 's'}`}>{busy === 'expand' ? 'Looking up…' : 'Look up LinkedIn'}</button>
        </div>
      </div>
      {note && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{note}</div>}

      {!route && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No route computed yet. <b>Find route</b> is free and uses your graph (LinkedIn connections, conversations, email, teammates).
          {degree === '2' ? ' This lead is 2nd degree on LinkedIn — Look up LinkedIn can name the shared connection.' : ''}
        </p>
      )}

      {route && (
        <>
          <RouteGraph nodes={route.graph.nodes} edges={route.graph.edges} highlightPathId={lit} />
          <div className="flex flex-wrap gap-3 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {ROUTE_LEGEND.map((l) => <span key={l.color} className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 4, background: ROUTE_COLORS[l.color], display: 'inline-block' }} />{l.label}</span>)}
          </div>

          {route.paths.length === 0 ? (
            <div className="text-xs rounded-lg p-3" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
              <b style={{ color: 'var(--text)' }}>No warm route yet.</b> {route.note}
              {route.bridge_candidates.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider">People who know the lead (yellow)</div>
                  {route.bridge_candidates.map((b) => (
                    <div key={b.person_id}>· <b style={{ color: 'var(--text)' }}>{b.name}</b>{b.headline ? ` — ${b.headline}` : b.org ? ` — ${b.org}` : ''} · {b.evidence}{b.known ? ' · in your ring' : ''}</div>
                  ))}
                  <div className="pt-1">Build the bridge: message one of them first (cold, value-first), and the route opens once they reply.</div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {route.paths.map((p, i) => {
                const first = p.hops[0];
                const asked = openIntros.find((x) => x.connector_name === first.to.name);
                return (
                  <div key={p.path_id} className="rounded-lg p-3 space-y-1.5" style={{ background: 'var(--bg-input)', border: `1px solid ${lit === p.path_id ? 'var(--accent)' : 'var(--border)'}` }} onMouseEnter={() => setLit(p.path_id)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium">Route {i + 1} · {p.hops.length} hop{p.hops.length === 1 ? '' : 's'} · score {p.score.toFixed(2)}</div>
                      {first.to.role === 'target'
                        ? <span className="text-[10px]" style={{ color: 'var(--green)' }}>you can message the lead directly ({first.channel})</span>
                        : asked
                          ? <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>intro ask {asked.state.replace(/_/g, ' ')}</span>
                          : <button onClick={() => setAsk({ path: p, hop: first })} disabled={!first.actionable_now} className="px-2.5 py-1 rounded-lg text-[11px] font-medium disabled:opacity-40" style={{ background: 'var(--green)', color: '#fff' }}>Ask {first.to.name.split(' ')[0]} for an intro</button>}
                    </div>
                    {p.hops.map((h, j) => (
                      <div key={j} className="text-[11px] flex flex-wrap gap-x-2" style={{ color: 'var(--text-muted)' }}>
                        <span><b style={{ color: 'var(--text)' }}>{h.from.name}</b> → <b style={{ color: 'var(--text)' }}>{h.to.name}</b></span>
                        {h.channel && <span>via {h.channel}</span>}
                        <span>· {h.evidence}</span>
                        {h.why_this_person && <span>· {h.why_this_person}</span>}
                        <span>· {Math.round(h.confidence * 100)}%</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {ask && <IntroAskModal prospectId={prospectId} path={ask.path} hop={ask.hop} onClose={() => setAsk(null)} onFiled={() => { setAsk(null); onChanged(); }} />}
    </div>
  );
}

function IntroAskModal({ prospectId, path, hop, onClose, onFiled }: {
  prospectId: string; path: RoutePath; hop: RouteHop; onClose: () => void; onFiled: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [blurb, setBlurb] = useState('');
  const [busy, setBusy] = useState<'draft' | 'propose' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const connector = { person_id: hop.to.person_id, name: hop.to.name, role: hop.to.role, evidence: hop.evidence, why: hop.why_this_person, channel: hop.channel };

  const draft = async () => {
    setBusy('draft'); setErr(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/intro`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft', connector_person_id: connector.person_id, connector }) });
      const out = await res.json();
      if (out.error) setErr(String(out.error));
      else { setSubject(out.subject || ''); setMessage(out.message || ''); setBlurb(out.forwardable_blurb || ''); }
    } finally { setBusy(null); }
  };
  const propose = async () => {
    setBusy('propose'); setErr(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/intro`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'propose', connector_person_id: connector.person_id, path_id: path.path_id, message, subject: hop.channel === 'email' ? subject : undefined, forwardable_blurb: blurb, rationale: `Route via ${hop.to.name}: ${hop.evidence}` }) });
      const out = await res.json();
      if (out.error) setErr(String(out.error));
      else onFiled();
    } finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl p-5 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-sm font-semibold">Ask {hop.to.name} for an intro</h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>via {hop.channel || '—'} · {hop.evidence}{hop.why_this_person ? ` · ${hop.why_this_person}` : ''}</p>
        </div>
        {err && <div className="text-xs" style={{ color: 'var(--red)' }}>{err}</div>}
        <div className="flex gap-2">
          <button onClick={draft} disabled={!!busy} className="px-3 py-1 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>{busy === 'draft' ? 'Drafting…' : message ? 'Redraft with AI' : 'Draft with AI'}</button>
        </div>
        {hop.channel === 'email' && (
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        )}
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} placeholder="The ask, in your voice. Give them an easy out." className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        <div>
          <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Forwardable blurb (they paste this to the lead)</label>
          <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Files an approval — nothing is sent until you tap Send.</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Cancel</button>
            <button onClick={propose} disabled={!!busy || !message.trim()} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>{busy === 'propose' ? 'Filing…' : 'Propose for approval'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
