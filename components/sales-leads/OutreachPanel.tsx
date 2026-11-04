'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OutreachState } from '@/lib/sales-leads';
import type { FeedbackResult } from '@/lib/voice';
import DraftReview, { LearnedLines } from '@/components/voice/DraftReview';
import { LinkedIn, Send, Sparkle } from './icons';

/**
 * LinkedIn outreach on the lead card: send a connection request, or draft the next message —
 * both FILED for the sender's approval (Telegram card or /agents); nothing goes out from here.
 * The sender is the lead's prospect owner: their LinkedIn account is the one that sends.
 *
 * "Draft … with AI" is the main action (098): it opens the Before / After review in a popup — the AI's text, the text
 * that goes out, a 1–5 and one line on what was missed. Queue files the edited text (the AI's kept as draft_original)
 * and sends the rating and the line along, so the lesson lands in the sender's voice at once; "Save feedback only"
 * teaches without filing. Writing it yourself stays a small option on the card.
 */
export default function OutreachPanel({ leadId, leadName, onChanged }: { leadId: string; leadName?: string | null; onChanged?: () => void }) {
  const [s, setS] = useState<OutreachState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'connect' | 'propose'>('');
  const [ok, setOk] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  // writing it yourself (no AI)
  const [manual, setManual] = useState(false);
  const [msg, setMsg] = useState('');
  // the AI review popup
  const [open, setOpen] = useState(false);
  const [rBusy, setRBusy] = useState<'' | 'draft' | 'teach' | 'queue'>('');
  const [rErr, setRErr] = useState<string | null>(null);
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [stamp, setStamp] = useState<unknown>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [usedFacts, setUsedFacts] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<{ content: string; kind: string }[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [explanation, setExplanation] = useState('');
  const [learned, setLearned] = useState<FeedbackResult | null>(null);
  const [teachNote, setTeachNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sales-leads/${leadId}/outreach`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load');
      setS(data); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [leadId]);
  useEffect(() => { load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/sales-leads/${leadId}/outreach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed');
    return data;
  };

  async function draft() {
    setOpen(true); setRBusy('draft'); setRErr(null); setTeachNote(null); setLearned(null);
    setBefore(''); setAfter(''); setRating(null); setExplanation('');
    try {
      const d = await post({ action: 'draft' });
      setBefore(d.message ?? ''); setAfter(d.message ?? ''); setStamp(d.voice ?? null);
      setReasoning(d.reasoning ?? (d.source === 'template' ? "The list's first-message template." : null));
      setUsedFacts(Array.isArray(d.used_facts) ? d.used_facts : []);
      setPriorities(Array.isArray(d.priorities) ? d.priorities : []);
      if (Array.isArray(d.flags) && d.flags.length) setRErr(`Check before filing: ${d.flags.map((f: { detail: string }) => f.detail).join(' · ')}`);
    } catch (e) { setRErr(e instanceof Error ? e.message : String(e)); }
    finally { setRBusy(''); }
  }

  async function queueReview() {
    setRBusy('queue'); setRErr(null);
    try {
      const d = await post({ action: 'propose', message: after, voice: stamp ?? undefined });
      let fb: FeedbackResult | null = null;
      if (!d.duplicate && d.approval_id && (rating || explanation.trim())) {
        try {
          const r = await fetch(`/api/drafts/${d.approval_id}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'feedback', ...(rating ? { rating: rating * 2 } : {}), ...(explanation.trim() ? { reason: explanation.trim() } : {}) }),
          });
          if (r.ok) fb = (await r.json()) as FeedbackResult;
        } catch { /* the draft is filed; the lesson is best effort */ }
      }
      const who = d.acted_as?.name ?? s?.sender?.name ?? 'the sender';
      setOk(d.duplicate ? `Already waiting for ${who}'s decision — nothing new filed.`
        : `Filed for ${who}'s approval (Telegram card or /agents). Nothing goes out until they approve.`);
      setLearned(fb);
      setOpen(false); setBefore(''); setAfter(''); setStamp(null);
      await load(); onChanged?.();
    } catch (e) { setRErr(e instanceof Error ? e.message : String(e)); }
    finally { setRBusy(''); }
  }

  async function teachOnly() {
    setRBusy('teach'); setRErr(null); setTeachNote(null);
    try {
      const res = await fetch('/api/drafts/teach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before, after, prospect_id: s?.prospect_id ?? undefined, channel: 'linkedin', step,
          ...(rating ? { rating } : {}), ...(explanation.trim() ? { reason: explanation.trim() } : {}) }),
      });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error || 'Could not save the feedback');
      setLearned(out as FeedbackResult);
      setTeachNote(`Saved to ${s?.sender?.name ?? 'the sender'}'s voice — nothing was filed or sent.`);
    } catch (e) { setRErr(e instanceof Error ? e.message : String(e)); }
    finally { setRBusy(''); }
  }

  async function act(action: 'connect' | 'propose') {
    setBusy(action); setErr(null); setOk(null); setLearned(null);
    try {
      const d = await post(action === 'connect' ? { action, note: note.trim() || undefined } : { action, message: msg });
      const who = d.acted_as?.name ?? s?.sender?.name ?? 'the sender';
      setOk(d.duplicate ? `Already waiting for ${who}'s decision — nothing new filed.`
        : `Filed for ${who}'s approval (Telegram card or /agents). Nothing goes out until they approve.`);
      if (action === 'propose') { setMsg(''); setManual(false); }
      if (action === 'connect') { setNote(''); setShowNote(false); }
      await load(); onChanged?.();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }

  if (!s) return err ? <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p> : null;
  const sender = s.sender?.name ?? 'the owner';
  const first = sender.split(' ')[0];
  const field = { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '0.5rem' } as const;
  const primary = { background: 'var(--accent)', color: 'var(--accent-fg)' } as const;
  const ghost = { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)' } as const;
  const canMessage = s.mode === 'first_message' || s.mode === 'thread';
  const lastFromThem = s.thread.length > 0 && !s.thread[s.thread.length - 1].ours;
  const lastThem = [...s.thread].reverse().find((m) => !m.ours) ?? null;
  // One pending request / one pending message per person (the kernel refuses a second): say so, don't offer it.
  const waitingConnect = s.pending.some((p) => p.kind === 'connect');
  const waitingMsg = s.pending.some((p) => p.kind !== 'connect');
  const step = s.mode === 'first_message' ? 'first' : lastFromThem ? 'reply' : 'followup';
  const what = s.mode === 'first_message' ? 'first message' : lastFromThem ? 'reply' : 'follow-up';
  const name = leadName || 'them';
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null);

  return (
    <div className="mt-5 rounded-xl p-4" style={{ border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-baseline gap-2 mb-3">
        <span style={{ color: 'var(--accent)' }}><LinkedIn width={14} height={14} /></span>
        <h4 className="z-eyebrow">LinkedIn outreach</h4>
        {s.sender && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>sends from {sender}&apos;s LinkedIn · every send waits for {first}&apos;s approval</span>}
      </div>

      {s.pending.length > 0 && (
        <ul className="mb-3 space-y-1">
          {s.pending.map((p) => (
            <li key={p.id} className="text-xs rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--yellow) 12%, transparent)' }}>
              <span className="font-medium">{p.status === 'approved' ? 'Approved, going out' : `Waiting for ${first}'s approval`}</span>
              {' · '}{p.kind === 'connect' ? 'connection request' : p.kind === 'followup' ? 'message in the conversation' : 'first message'}
              {p.message ? <span style={{ color: 'var(--text-muted)' }}> — “{p.message.slice(0, 140)}{p.message.length > 140 ? '…' : ''}”</span> : null}
            </li>
          ))}
        </ul>
      )}

      {s.why && <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{s.why}</p>}

      {s.mode === 'connect' && !waitingConnect && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Not connected yet — a message can only go to a connection.</span>
          {showNote && (
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Optional note (max 200 characters)"
              className="text-xs px-2.5 py-1.5 flex-1 min-w-[220px]" style={field} />
          )}
          {!showNote && <button type="button" className="text-xs underline" style={{ color: 'var(--text-muted)' }} onClick={() => setShowNote(true)} disabled={!s.can_act}>add a note</button>}
          <button type="button" onClick={() => act('connect')} disabled={!s.can_act || !!busy}
            className="text-xs px-3.5 py-1.5 rounded-full font-medium disabled:opacity-50" style={primary}>
            {busy === 'connect' ? 'Filing…' : 'Send connection request'}
          </button>
        </div>
      )}
      {s.mode === 'request_pending' && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Connection request sent — waiting for them to accept. The first message unlocks when they do.</p>
      )}

      {canMessage && (
        <>
          {s.thread.length > 0 && (
            <ol className="mb-3 space-y-1.5">
              {s.thread.slice(-3).map((m, i) => (
                <li key={i} className="text-xs leading-relaxed" style={{ color: m.ours ? 'var(--text-muted)' : 'var(--text)' }}>
                  <span className="font-medium">{m.ours ? 'We' : 'They'}</span>
                  {m.sent_at ? <span style={{ color: 'var(--text-muted)' }}> · {fmt(m.sent_at)}</span> : null}
                  {': '}{(m.text ?? '').slice(0, 220)}{(m.text ?? '').length > 220 ? '…' : ''}
                </li>
              ))}
            </ol>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={draft} disabled={!s.can_act || !!rBusy}
              className="inline-flex items-center gap-2 text-sm px-5 py-2.5 rounded-full font-semibold shadow-sm disabled:opacity-50 transition-transform hover:-translate-y-px"
              style={primary}>
              <Sparkle width={16} height={16} />Draft {what} with AI
            </button>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>in {first}&apos;s own voice — you review it before anything is filed</span>
            <span className="flex-1" />
            {!manual && (
              <button type="button" onClick={() => setManual(true)} disabled={!s.can_act} className="text-xs underline disabled:opacity-50" style={{ color: 'var(--text-muted)' }}>
                or write it yourself
              </button>
            )}
          </div>

          {manual && (
            <div className="mt-3 space-y-2">
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} autoFocus
                placeholder={s.mode === 'first_message' ? 'The first message to this new connection…' : lastFromThem ? 'Your reply…' : 'Your follow-up…'}
                className="w-full text-[13px] px-3 py-2 leading-relaxed resize-y" style={field} disabled={!s.can_act} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => { setManual(false); setMsg(''); }} className="text-xs px-3 py-1.5 rounded-full" style={ghost}>Cancel</button>
                <span className="flex-1" />
                {waitingMsg && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>A message already waits for {first}&apos;s decision — approve or skip it first.</span>}
                <button type="button" onClick={() => act('propose')} disabled={!s.can_act || !!busy || !msg.trim() || waitingMsg}
                  className="inline-flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-full font-medium disabled:opacity-50" style={primary}>
                  <Send width={12} height={12} />{busy === 'propose' ? 'Filing…' : `Queue for ${first}'s approval`}
                </button>
              </div>
            </div>
          )}

          <DraftReview open={open} onClose={() => setOpen(false)}
            title={`${what === 'reply' ? 'Reply to' : what === 'follow-up' ? 'Follow-up to' : 'First message to'} ${name}`}
            eyebrow={`LinkedIn ${what} · from ${sender}'s account`}
            context={lastThem?.text ? { who: name, when: fmt(lastThem.sent_at), text: lastThem.text } : null}
            drafting={rBusy === 'draft'} before={before} after={after} onAfter={setAfter}
            reasoning={reasoning} usedFacts={usedFacts} priorities={priorities} senderName={sender}
            rating={rating} onRating={setRating} explanation={explanation} onExplanation={setExplanation}
            onRedraft={draft} onTeach={teachOnly} onQueue={queueReview} busy={rBusy}
            canQueue={s.can_act && !waitingMsg}
            queueBlockedWhy={waitingMsg ? `A message already waits for ${first}'s decision — skip or approve it first, or save your feedback only.` : null}
            error={rErr} learned={open ? learned : null} teachNote={teachNote} />
        </>
      )}

      {ok && <p className="mt-3 text-xs" style={{ color: 'var(--green)' }}>{ok}</p>}
      {learned && !open && <div className="mt-2"><LearnedLines res={learned} /></div>}
      {err && <p role="alert" className="mt-2 text-xs font-medium" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
}
