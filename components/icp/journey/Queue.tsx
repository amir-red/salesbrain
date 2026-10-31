'use client';

/**
 * The queue of one lane on the journey view: the people in it, one line each, and the one thing that can be done for
 * each from here. Nothing sends by itself — Approve goes through /api/agents/approvals (the kernel's send gate, the
 * draft owner's decision), Draft / Queue file a draft for the owner's approval, Pick attaches a profile. "Do all"
 * walks the lane one person at a time with a pause between sends, the way the Telegram batch card paces them.
 */
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { JourneyPayload, LaneKey, LanePerson } from '@/lib/icp-journey';
import { LANE_META, initials } from '@/lib/icp-journey';
import { relativeTime } from '@/lib/time';
import Button from '@/components/panel/Button';

const muted = { color: 'var(--text-muted)' };
const PACE_MS = 8_000;  // between two sends started from here: a human pace, like the batch card

type Candidate = { public_identifier: string | null; provider_id: string | null; name: string | null; headline: string | null; location: string | null };
type Detail = { profile_lookup?: { candidates?: Candidate[]; strong?: string[]; possible?: string[] } | null };

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.error) throw new Error(String(out?.error || `Failed (${res.status})`));
  return out as Record<string, unknown>;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Queue({ icpId, lane, data, onChanged }: {
  icpId: string; lane: LaneKey; data: JourneyPayload; onChanged: () => Promise<void>;
}) {
  const meta = LANE_META[lane];
  const people = data.lanes[lane];
  const { viewer, connect } = data;
  const [busy, setBusy] = useState<string | null>(null);          // prospect id (or 'all') being worked
  const [note, setNote] = useState<{ id: string; text: string; bad?: boolean } | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});   // prospect id → what happened, until the next refresh
  const [draft, setDraft] = useState<{ id: string; text: string; voice?: unknown; thread?: boolean } | null>(null);
  const [picker, setPicker] = useState<{ id: string; cands: Candidate[]; strong: Set<string>; possible: Set<string> } | null>(null);
  const [progress, setProgress] = useState<{ i: number; n: number; stop?: boolean } | null>(null);
  const stopRef = useRef(false);
  useEffect(() => { setDone({}); setDraft(null); setPicker(null); setNote(null); }, [lane]);

  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy(id); setNote(null);
    try { const text = await fn(); setDone((d) => ({ ...d, [id]: text })); setNote({ id, text }); await onChanged(); }
    catch (e) { setNote({ id, text: e instanceof Error ? e.message : String(e), bad: true }); }
    finally { setBusy(null); }
  };

  const decide = (p: LanePerson, decision: 'approve' | 'reject') => run(p.prospect_id, async () => {
    const out = await post('/api/agents/approvals', { approval_id: p.approval_id, decision });
    if (decision === 'reject') return 'Skipped.';
    return out.sent ? 'Sent.' : `Not sent: ${out.note || out.status || 'see /agents'}`;
  });

  /** Walk every row that has a draft: approve, wait, next. Stops on the first refusal or when asked. */
  const doAll = async () => {
    const rows = people.filter((p) => p.approval_id && !done[p.prospect_id]);
    if (rows.length === 0) return;
    const what = lane === 'send' ? `Send ${rows.length} connection ${rows.length === 1 ? 'request' : 'requests'} now, one every ${PACE_MS / 1000} s, from ${data.sender.name}'s LinkedIn?`
      : `Approve and send ${rows.length} ${rows.length === 1 ? 'message' : 'messages'} now, one every ${PACE_MS / 1000} s?`;
    if (!confirm(what)) return;
    stopRef.current = false; setBusy('all'); setNote(null);
    let i = 0;
    try {
      for (const p of rows) {
        if (stopRef.current) break;
        setProgress({ i, n: rows.length });
        try {
          const out = await post('/api/agents/approvals', { approval_id: p.approval_id, decision: 'approve' });
          setDone((d) => ({ ...d, [p.prospect_id]: out.sent ? 'Sent.' : `Not sent: ${out.note || out.status || ''}` }));
          if (!out.sent && /cap|quota|budget|paused|not an? (owner|administrator)/i.test(String(out.note || out.status || ''))) { setNote({ id: 'all', text: `Stopped: ${out.note || out.status}`, bad: true }); break; }
        } catch (e) { setNote({ id: 'all', text: `Stopped at ${p.full_name ?? 'a person'}: ${e instanceof Error ? e.message : String(e)}`, bad: true }); break; }
        i += 1;
        setProgress({ i, n: rows.length });
        if (i < rows.length && !stopRef.current) await sleep(PACE_MS);
      }
    } finally { setBusy(null); setProgress(null); await onChanged(); }
  };

  const queueNext = () => run('queue', async () => {
    const k = Math.min(data.counts.send_ready, Math.max(connect.remaining, 1), 20);
    const out = await post(`/api/icp/${icpId}/connect`, { limit: k });
    const n = Number(out.filed ?? out.proposed ?? out.count ?? (Array.isArray(out.approvals) ? out.approvals.length : 0));
    return n ? `${n} ${n === 1 ? 'request' : 'requests'} filed for ${data.sender.name}'s approval.` : String(out.note || out.message || 'Nothing filed.');
  });

  const startDraft = (p: LanePerson) => run(p.prospect_id, async () => {
    const out = lane === 'follow'
      ? await post(`/api/prospects/${p.prospect_id}/followup`, { action: 'draft' })
      : await post(`/api/sales-leads/${p.lead_id}/outreach`, { action: 'draft' });
    setDraft({ id: p.prospect_id, text: String(out.message ?? ''), voice: out.voice });
    return 'Draft written — edit it, then queue it.';
  });
  const propose = (p: LanePerson) => draft && run(p.prospect_id, async () => {
    if (lane === 'follow') await post(`/api/prospects/${p.prospect_id}/followup`, { action: 'propose', message: draft.text, voice: draft.voice });
    else await post(`/api/sales-leads/${p.lead_id}/outreach`, { action: 'propose', message: draft.text, voice: draft.voice });
    setDraft(null);
    return `Queued for ${data.sender.name}'s approval.`;
  });
  const skipFollow = (p: LanePerson) => run(p.prospect_id, async () => { await post(`/api/prospects/${p.prospect_id}/followup`, { action: 'skip' }); return 'No more follow-ups to this person.'; });

  const openPicker = (p: LanePerson) => run(p.prospect_id, async () => {
    const res = await fetch(`/api/icp/${icpId}/leads/${p.prospect_id}`);
    const out = (await res.json()) as Detail;
    const cands = (out.profile_lookup?.candidates ?? []).filter((c) => c.public_identifier);
    setPicker({ id: p.prospect_id, cands, strong: new Set(out.profile_lookup?.strong ?? []), possible: new Set(out.profile_lookup?.possible ?? []) });
    return cands.length ? `${cands.length} candidates.` : 'No candidates stored for this person.';
  });
  const pickOne = (p: LanePerson, c: Candidate) => run(p.prospect_id, async () => {
    const out = await post(`/api/prospects/${p.prospect_id}/find-linkedin`, { public_identifier: c.public_identifier, ...(c.provider_id ? { member_id: c.provider_id } : {}) });
    setPicker(null);
    return String(out.note || 'Profile attached.');
  });

  const withDraft = people.filter((p) => p.approval_id && !done[p.prospect_id]).length;
  const canDecide = viewer.is_owner;
  const canEdit = viewer.can_edit;
  const headerBtn = (() => {
    if (busy === 'all' && progress) return <Button variant="danger" size="sm" onClick={() => { stopRef.current = true; }}>Stop after this one</Button>;
    if (lane === 'send') {
      if (withDraft && canDecide) return <Button variant="primary" size="sm" onClick={doAll}>Send {withDraft} now</Button>;
      if (canEdit && data.counts.send_ready > 0) return <Button variant="primary" size="sm" onClick={queueNext} disabled={busy !== null || !data.sender.linkedin || connect.remaining === 0}
        title={!data.sender.linkedin ? `${data.sender.name} has no LinkedIn connected` : connect.remaining === 0 ? 'Today\'s requests are all used' : `Files the next requests for ${data.sender.name}'s approval; sends nothing`}>
        Queue next {Math.min(data.counts.send_ready, Math.max(connect.remaining, 1), 20)}</Button>;
      return null;
    }
    if ((lane === 'message' || lane === 'follow') && withDraft > 1 && canDecide) return <Button variant="primary" size="sm" onClick={doAll}>Approve all {withDraft} drafts</Button>;
    if (lane === 'answer' && people.length) return <Button variant="primary" size="sm" href="/inbox?filter=needs_reply">Open the Inbox</Button>;
    return null;
  })();

  return (
    <section className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        <h2 className="text-sm font-semibold">{meta.label} · {people.filter((p) => !done[p.prospect_id]).length}</h2>
        <span className="text-xs" style={muted}>{meta.sub}</span>
        <div className="ml-auto flex items-center gap-2">{headerBtn}</div>
      </div>
      {progress && (
        <div className="px-4 py-2 text-xs flex items-center gap-3" style={{ background: 'var(--accent-soft)' }}>
          <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
            <div className="h-2 rounded-full transition-all" style={{ width: `${Math.round((progress.i / Math.max(progress.n, 1)) * 100)}%`, background: 'var(--accent)' }} />
          </div>
          <span className="font-mono">{progress.i}/{progress.n}</span>
        </div>
      )}
      {note?.id === 'all' && <div className="px-4 py-2 text-xs" style={{ color: note.bad ? 'var(--red)' : 'var(--text-muted)' }}>{note.text}</div>}
      {note?.id === 'queue' && <div className="px-4 py-2 text-xs" style={{ color: note.bad ? 'var(--red)' : 'var(--text-muted)' }}>{note.text}</div>}
      {lane === 'send' && !people.length && data.counts.send_ready > 0 && (
        <div className="px-4 py-3 text-xs" style={muted}>
          {data.counts.send_ready.toLocaleString()} people have a profile and were never asked. {connect.remaining > 0
            ? `${connect.remaining} of ${connect.per_day} requests are still free in the last 24 h${data.counts.fresh_profiles ? ` · ${data.counts.fresh_profiles} profiles found in the last 5 hours go first` : ''}.`
            : `Today's ${connect.per_day} requests are all used${connect.next_request_at ? ` — the next one is free ${relativeTime(connect.next_request_at)}` : ''}.`}
        </div>
      )}
      {people.length === 0 && !(lane === 'send' && data.counts.send_ready > 0) && (
        <div className="px-4 py-8 text-center text-sm" style={muted}>Nothing left here. The next lane is waiting.</div>
      )}
      {people.map((p, i) => {
        const finished = done[p.prospect_id];
        const isBusy = busy === p.prospect_id;
        const rowNote = note?.id === p.prospect_id ? note : null;
        return (
          <div key={p.prospect_id} className="px-4 py-2.5 text-sm" style={{ borderBottom: '1px solid var(--border)', opacity: finished ? 0.55 : 1 }}>
            <div className="grid items-center gap-3" style={{ gridTemplateColumns: '34px minmax(0, 1.2fr) minmax(0, 1fr) auto' }}>
              <span className="w-[34px] h-[34px] rounded-full inline-flex items-center justify-center text-[11px] font-semibold"
                style={{ background: ['var(--deep-plum)', 'var(--deep-blue)', 'var(--deep-teal)', 'var(--deep-violet)'][i % 4], color: '#fff' }}>{initials(p.full_name)}</span>
              <span className="flex flex-col min-w-0">
                <Link href={p.lead_id ? `/sales-leads?open=${p.lead_id}` : `/prospects/${p.prospect_id}`} className="font-medium truncate hover:underline">{p.full_name ?? '—'}</Link>
                <span className="text-xs truncate" style={muted}>{[p.title, p.company].filter(Boolean).join(' · ') || '—'}</span>
              </span>
              <span className="text-xs truncate" style={{ color: finished ? 'var(--text-muted)' : 'var(--text)' }} title={p.detail ?? undefined}>
                {finished ?? p.detail ?? ''}
                {!finished && p.priority ? <span className="ml-1.5 px-1 rounded text-[10px]" style={{ background: 'var(--bg-input)' }}>P{p.priority}</span> : null}
                {!finished && p.trust_total != null ? (
                  <span className="ml-1.5 px-1 rounded text-[10px] tabular-nums" title={`Trust score ${p.trust_total}${p.trust_why ? `: ${p.trust_why}` : ''}`}
                    style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{p.trust_total}</span>
                ) : null}
              </span>
              <span className="flex items-center gap-1.5 justify-end">
                {!finished && lane === 'answer' && p.thread_id && p.channel && (
                  <Button variant="primary" size="sm" href={`/inbox?c=${p.channel}:${p.thread_id}`}>Answer</Button>
                )}
                {!finished && p.approval_id && canDecide && lane !== 'answer' && <>
                  <Button variant="primary" size="sm" onClick={() => decide(p, 'approve')} disabled={busy !== null} title="Send now through the policy gate">{lane === 'send' ? 'Send' : 'Approve'}</Button>
                  <Button size="sm" onClick={() => decide(p, 'reject')} disabled={busy !== null}>Skip</Button>
                </>}
                {!finished && p.approval_id && !canDecide && lane !== 'answer' && <span className="text-[11px]" style={muted}>{data.sender.name} decides</span>}
                {!finished && !p.approval_id && lane === 'message' && canEdit && (p.lead_id
                  ? <Button size="sm" onClick={() => startDraft(p)} disabled={busy !== null}>{isBusy ? 'Writing…' : 'Draft'}</Button>
                  : <Button size="sm" href={`/prospects/${p.prospect_id}`}>Open</Button>)}
                {!finished && !p.approval_id && lane === 'follow' && canEdit && <>
                  <Button size="sm" onClick={() => startDraft(p)} disabled={busy !== null || !p.thread_id} title={p.thread_id ? undefined : 'No LinkedIn conversation on the owner\'s account'}>{isBusy ? 'Writing…' : 'Draft'}</Button>
                  <Button size="sm" onClick={() => skipFollow(p)} disabled={busy !== null} title="No more follow-ups to this person">Skip</Button>
                </>}
                {!finished && lane === 'pick' && canEdit && <Button size="sm" onClick={() => (picker?.id === p.prospect_id ? setPicker(null) : openPicker(p))} disabled={busy !== null}>{picker?.id === p.prospect_id ? 'Close' : 'Pick'}</Button>}
                {!finished && (lane === 'pick' || lane === 'message' || lane === 'follow') && !canEdit && !p.approval_id && <span className="text-[11px]" style={muted}>owner or admin</span>}
              </span>
            </div>
            {rowNote && <div className="mt-1 ml-[46px] text-xs" style={{ color: rowNote.bad ? 'var(--red)' : 'var(--text-muted)' }}>{rowNote.text}</div>}
            {draft?.id === p.prospect_id && (
              <div className="mt-2 ml-[46px] space-y-2">
                <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={4}
                  className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => propose(p)} disabled={busy !== null || !draft.text.trim()}>Queue for {viewer.is_owner ? 'my' : `${data.sender.name}'s`} approval</Button>
                  <Button size="sm" onClick={() => setDraft(null)}>Discard</Button>
                  <span className="text-[11px]" style={muted}>Nothing is sent from here — the card goes to {data.sender.name}'s Telegram and /agents.</span>
                </div>
              </div>
            )}
            {picker?.id === p.prospect_id && (
              <div className="mt-2 ml-[46px] space-y-1.5">
                {picker.cands.length === 0 && <div className="text-xs" style={muted}>No candidates stored — search again from the table.</div>}
                {picker.cands.map((c) => (
                  <div key={c.public_identifier!} className="rounded-lg px-2.5 py-1.5 flex items-start gap-2 text-xs"
                    style={{ border: `1px solid ${picker.strong.has(c.public_identifier!) ? 'var(--green)' : picker.possible.has(c.public_identifier!) ? 'var(--yellow)' : 'var(--border)'}`, background: 'var(--bg-input)' }}>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {c.name || c.public_identifier}
                        {picker.strong.has(c.public_identifier!) && <span className="ml-1 text-[9px] px-1 rounded" style={{ background: 'color-mix(in srgb, var(--green) 14%, transparent)', color: 'var(--green)' }}>likely</span>}
                        {!picker.strong.has(c.public_identifier!) && picker.possible.has(c.public_identifier!) && <span className="ml-1 text-[9px] px-1 rounded" style={{ background: 'color-mix(in srgb, var(--yellow) 14%, transparent)', color: 'var(--yellow)' }}>possible</span>}
                      </div>
                      <div className="truncate" style={muted}>{c.headline || '—'}{c.location ? ` · ${c.location}` : ''}</div>
                      <a href={`https://www.linkedin.com/in/${c.public_identifier}`} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent)' }}>open ↗</a>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => pickOne(p, c)} disabled={busy !== null}>Use this</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
