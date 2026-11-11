'use client';

import { useState } from 'react';
import { Sparkle, Star } from '@/components/icons';
import { LearnedLines } from '@/components/voice/DraftReview';
import { diffWords } from '@/lib/diff-words';
import PriorityList from '@/components/voice/PriorityList';
import type { FeedbackResult, VoiceFlag, VoiceStamp } from '@/lib/voice';
import type { EmailReading } from '@/lib/inbox';
import type { Recipients } from '@/lib/email-recipients';

/**
 * The AI proposal inside the Inbox (2026-11-05). `Draft reply` asks the one drafter (core 098) for the next message
 * in this conversation, in the OWNER's voice, with the thread as context; the text lands in the reply box, editable.
 * This strip above the box says why it was written and lets the person drop it. After Send (or after dropping it)
 * the strip turns into the rating: five stars and one line on what the AI missed — a sent draft is rated on its
 * approval row (the stars reach the trust ladder), a dropped one teaches without filing (draft_teach).
 */
export interface InboxProposal {
  message: string;               // what the AI wrote (before)
  reasoning: string | null;
  used_facts: string[];
  voice: VoiceStamp;
  situation: 'reply' | 'followup' | 'first';
  priorities: { id?: string | null; content: string; kind: string }[];
  /** email (core 108): the conversation reader's result, whom it proposed the reply goes to, the checks that did not
   *  pass after one rewrite (greeting, du/Sie, a time not free in the calendar), the free times it was given */
  reading?: EmailReading | null;
  recipients?: Recipients | null;
  warnings?: VoiceFlag[];
  free_times?: { label: string }[] | null;
  time_zone?: string | null;
}

const RATINGS = ['Unusable', 'Weak', 'Needed work', 'Small fixes', 'Send as is'];

export interface Verdict { rating: number | null; note: string }
export const EMPTY_VERDICT: Verdict = { rating: null, note: '' };
export function verdictReason(v: Verdict): string {
  return v.note.trim().slice(0, 500);
}
export function verdictGiven(v: Verdict): boolean {
  return !!v.rating || !!v.note.trim();
}

function Stars({ value, onChange, size = 20, disabled }: { value: number | null; onChange: (n: number | null) => void; size?: number; disabled?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center" role="radiogroup" aria-label="Rating from 1 to 5 stars" onMouseLeave={() => setHover(null)}>
        {RATINGS.map((label, i) => {
          const n = i + 1; const lit = n <= (hover ?? value ?? 0);
          return (
            <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} stars — ${label}`} title={label} disabled={disabled}
              onMouseEnter={() => setHover(n)} onClick={() => onChange(value === n ? null : n)}
              className="p-0.5 hover:scale-110 transition-transform disabled:opacity-60" style={{ color: lit ? 'var(--yellow)' : 'var(--text-muted)' }}>
              <Star filled={lit} width={size} height={size} />
            </button>
          );
        })}
      </span>
      <span className="text-[11px] min-w-[5rem]" style={{ color: 'var(--text-muted)' }}>{(hover ?? value) ? RATINGS[(hover ?? value)! - 1] : ''}</span>
    </span>
  );
}

/** The AI proposal (2026-11-06, Amir's sketch): no separate reply box while a proposal is open. Before (what the AI
 * wrote, the words you removed struck out) with "Send as is" under it · how good it was, 1 to 5 · After = the text you
 * edit, the words you added marked, with Send under it. Folded below: the sender's priority list and the note on how
 * you improved it, so the conversation keeps the room. Send records the rating and note on the sent draft; "Save
 * feedback" teaches without sending; Discard teaches from it too. */
export function ProposalStrip({ p, after, onAfter, senderFirst, verdict, onVerdict, onDiscard, onTeach, teaching, learned, error,
  onSendAsIs, onSend, onRedraft, busy, fromLine, copyOnly, openUrl, openLabel, editablePriorities = true, sendBlocked = false }: {
  p: InboxProposal; after: string; onAfter: (t: string) => void; senderFirst: string; verdict: Verdict; onVerdict: (v: Verdict) => void;
  onDiscard: () => void; onTeach: () => void; teaching: boolean; learned: FeedbackResult | null; error: string | null;
  onSendAsIs: () => void; onSend: () => void; onRedraft: () => void; busy: string | null; fromLine: string;
  /** a chat that cannot be sent from here: the buttons copy the text (and open the app when there is a link) */
  copyOnly?: boolean; openUrl?: string | null; openLabel?: string;
  /** the viewer is the sender (their own conversation): the priority list can be reordered and added to */
  editablePriorities?: boolean;
  /** nothing can be sent yet (an email with nobody in To) */
  sendBlocked?: boolean;
}) {
  const asIsLabel = copyOnly ? (openUrl ? `Copy as is & open ${openLabel}` : 'Copy as is') : 'Send as is';
  const sendLabel = copyOnly ? (openUrl ? `Copy & open ${openLabel}` : 'Copy') : 'Send';
  const [why, setWhy] = useState(false);
  // Folded to one line so the conversation above can be read in full; the text and rating stay as they are.
  const [folded, setFolded] = useState(false);
  const diff = diffWords(p.message, after);
  const changed = diff.some((d) => d.op !== 'same');
  // The After box is a textarea over a copy of its text in which the added words are marked: same font, padding and
  // wrapping, so the marks sit exactly under the words you typed.
  const face = 'px-3 py-2 text-sm whitespace-pre-wrap break-words leading-relaxed';
  const label = 'text-[11px] font-semibold uppercase tracking-wide mb-1';
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)' };
  return (
    <div className="rounded-xl p-3 text-xs space-y-3" style={{ background: 'var(--accent-soft)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span style={{ color: 'var(--accent)' }}><Sparkle width={13} height={13} /></span>
        <span className="font-medium">AI proposal in {senderFirst}&apos;s voice</span>
        <span style={{ color: 'var(--text-muted)' }}>· {p.situation === 'reply' ? 'a reply to what they wrote' : p.situation === 'first' ? 'a first message — they accepted your request' : 'a follow-up, they have not answered'}</span>
        <span className="flex-1" />
        {p.reasoning && <button type="button" onClick={() => setWhy((v) => !v)} className="underline" style={{ color: 'var(--text-muted)' }}>{why ? 'hide why' : 'why this'}</button>}
        <button type="button" onClick={onRedraft} disabled={!!busy} className="underline disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>
          {busy === 'draft' ? 'Drafting…' : 'Draft again'}
        </button>
        <button type="button" onClick={onDiscard} className="underline" style={{ color: 'var(--text-muted)' }}>Discard</button>
        <button type="button" onClick={() => setFolded((v) => !v)} className="underline" style={{ color: 'var(--text-muted)' }}
          aria-expanded={!folded} title={folded ? 'Show the proposal again' : 'Fold the proposal to read the conversation'}>
          {folded ? 'Show' : 'Minimise'}
        </button>
      </div>
      {folded ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>{after || p.message}</p>
          <button type="button" onClick={onSend} disabled={!after.trim() || !!busy || sendBlocked}
            className="px-4 py-1 rounded-full text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            {busy === 'reply' ? 'Sending…' : sendLabel}
          </button>
        </div>
      ) : (<>
      {why && p.reasoning && <p style={{ color: 'var(--text-muted)' }}>{p.reasoning}{p.used_facts.length ? ` · used: ${p.used_facts.join(', ')}` : ''}</p>}
      {!!p.warnings?.length && (
        <div className="rounded-lg px-2 py-1.5" style={{ background: 'color-mix(in srgb, var(--orange) 12%, transparent)' }}>
          {p.warnings.map((w, i) => <p key={i}><b>Check:</b> {w.detail || w.check}</p>)}
        </div>
      )}
      {why && !!p.free_times?.length && (
        <p style={{ color: 'var(--text-muted)' }}>Free in your calendar{p.time_zone ? ` (${p.time_zone})` : ''}: {p.free_times.slice(0, 6).map((f) => f.label).join(' · ')}</p>
      )}

      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-stretch">
        <div className="flex flex-col">
          <p className={label} style={{ color: 'var(--text-muted)' }}>Before · the AI&apos;s text</p>
          <div className={`${face} rounded-lg flex-1 min-h-[6rem] max-h-[13rem] overflow-y-auto`} style={card}>
            {diff.filter((d) => d.op !== 'ins').map((d, i) => d.op === 'same' ? <span key={i}>{d.text}</span>
              : <del key={i} style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 8%, transparent)' }}>{d.text}</del>)}
          </div>
          <div className="mt-2 flex justify-center">
            <button type="button" onClick={onSendAsIs} disabled={!!busy || sendBlocked} title={copyOnly ? "Copies the AI's text exactly as written" : "Sends the AI's text exactly as written"}
              className="px-4 py-1.5 rounded-full text-sm font-medium disabled:opacity-40" style={card}>
              {busy === 'reply-asis' ? 'Sending…' : asIsLabel}
            </button>
          </div>
        </div>
        <div className="md:w-40">
          <p className={label} style={{ color: 'var(--text-muted)' }}>How good was it?</p>
          <div className="flex md:flex-col gap-1 flex-wrap" role="radiogroup" aria-label="Rating from 1 to 5">
            {RATINGS.map((r, i) => {
              const n = i + 1; const on = verdict.rating === n;
              return (
                <button key={n} type="button" role="radio" aria-checked={on} disabled={!!learned}
                  onClick={() => onVerdict({ ...verdict, rating: on ? null : n })}
                  className="text-left px-2 py-1 rounded-lg flex items-center gap-2 disabled:opacity-60"
                  style={{ background: on ? 'var(--accent)' : 'var(--bg-card)', color: on ? 'var(--accent-fg)' : 'var(--text)', border: '1px solid var(--border)' }}>
                  <b className="tabular-nums">{n}</b><span>{r}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col">
          <p className={label} style={{ color: 'var(--text-muted)' }}>After · your text, edit it here {changed ? '' : '(no edits yet)'}</p>
          <div className="rounded-lg flex-1 min-h-[6rem] max-h-[13rem] overflow-y-auto" style={card}>
          <div className="relative min-h-full">
            <div aria-hidden className={`${face} absolute inset-0 overflow-hidden pointer-events-none`} style={{ color: 'transparent' }}>
              {diff.filter((d) => d.op !== 'del').map((d, i) => d.op === 'same' ? <span key={i}>{d.text}</span>
                : <mark key={i} style={{ color: 'transparent', background: 'color-mix(in srgb, var(--green) 22%, transparent)', borderRadius: 3 }}>{d.text}</mark>)}
              {'\n'}
            </div>
            <textarea value={after} onChange={(e) => onAfter(e.target.value)} aria-label="Your reply"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && after.trim() && !busy) { e.preventDefault(); onSend(); } }}
              className={`${face} relative w-full h-full min-h-[6rem] resize-none bg-transparent outline-none`}
              style={{ color: 'var(--text)', overflow: 'hidden' }}
              ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }} />
          </div>
          </div>
          <div className="mt-2 flex justify-center">
            <button type="button" onClick={onSend} disabled={!after.trim() || !!busy || sendBlocked} title={copyOnly ? 'Copies the text in the After box' : 'Sends the text in the After box'}
              className="px-5 py-1.5 rounded-full text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              {busy === 'reply' ? 'Sending…' : sendLabel}
            </button>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>{fromLine}</p>

      <div className="grid gap-3 md:grid-cols-2 items-start">
        <details className="rounded-lg px-3 py-2" style={card}>
          <summary className="cursor-pointer font-medium">{senderFirst}&apos;s priority list ({p.priorities.length})</summary>
          {/* editable since 2026-11-10: ↑ / ↓ and "Add to the top" save to the sender's voice; the next draft follows it */}
          <PriorityList items={p.priorities} senderFirst={senderFirst} editable={editablePriorities} />
        </details>
        <details className="rounded-lg px-3 py-2" style={card} open={!!verdict.note.trim() || undefined}>
          <summary className="cursor-pointer font-medium">How you improved it and what the AI missed{verdict.note.trim() ? ' ✓' : ''}</summary>
          <textarea value={verdict.note} onChange={(e) => onVerdict({ ...verdict, note: e.target.value.slice(0, 500) })} rows={3}
            disabled={!!learned} className="z-input mt-2 w-full resize-y" aria-label="How you improved it and what the AI missed"
            placeholder="e.g. he wrote du, the draft said Sie · too long · asked for a call too early" />
          <div className="flex items-center gap-2 mt-2">
            <p className="text-[11px] flex-1" style={{ color: 'var(--text-muted)' }}>
              Your edits, the rating and this note become rules in {senderFirst}&apos;s voice — saved with Send, or now without sending.
            </p>
            {!learned && (
              <button type="button" onClick={onTeach} disabled={teaching || !verdictGiven(verdict)} title={`Teaches ${senderFirst}'s voice now, sends nothing`}
                className="px-3 py-1 rounded-lg font-medium disabled:opacity-40" style={card}>
                {teaching ? 'Saving…' : 'Save feedback'}
              </button>
            )}
          </div>
        </details>
      </div>
      </>)}
      {learned && <LearnedLines res={learned} />}
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
    </div>
  );
}

/** Stars + one line, after the decision. `approvalId` set = the reply went out (rate the row); otherwise the proposal
 * was dropped and `before` / `after` teach without filing. */
export function RatingStrip({ approvalId, before, after, prospectId, channel, step, senderFirst, onClose }: {
  approvalId: string | null; before: string; after: string; prospectId: string | null; channel: 'linkedin' | 'email' | 'whatsapp';
  step: 'reply' | 'followup' | 'first'; senderFirst: string; onClose: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<FeedbackResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const changed = before.trim() !== after.trim();

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = approvalId
        ? await fetch(`/api/drafts/${approvalId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'feedback', ...(rating ? { rating: rating * 2 } : {}), ...(line.trim() ? { reason: line.trim() } : {}) }) })
        : await fetch('/api/drafts/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ before, after, ...(rating ? { rating } : {}), ...(line.trim() ? { reason: line.trim() } : {}),
              ...(prospectId ? { prospect_id: prospectId } : {}), channel, step }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Not saved');
      setRes(d as FeedbackResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Not saved');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl px-3 py-2.5 mb-2 text-xs space-y-2" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">
          {approvalId ? (changed ? 'Sent with your edits — learned from them.' : 'Sent as proposed.') : 'Proposal dropped.'} How good was the AI&apos;s draft?
        </span>
        <Stars value={rating} onChange={setRating} disabled={!!res} />
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="underline" style={{ color: 'var(--text-muted)' }}>{res ? 'Close' : 'Skip'}</button>
      </div>
      {!res && (
        <div className="flex gap-2">
          <input value={line} onChange={(e) => setLine(e.target.value.slice(0, 500))} placeholder={`What did the AI miss? This becomes a rule in ${senderFirst}'s voice.`}
            className="z-input flex-1 !py-1.5" aria-label="What the AI missed" onKeyDown={(e) => { if (e.key === 'Enter' && (rating || line.trim()) && !busy) save(); }} />
          <button type="button" onClick={save} disabled={busy || (!rating && !line.trim())}
            className="px-3 py-1.5 rounded-lg font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {res && <LearnedLines res={res} />}
      {err && <p role="alert" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
}
