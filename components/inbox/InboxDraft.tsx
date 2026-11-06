'use client';

import { useState } from 'react';
import { Sparkle, Star } from '@/components/icons';
import { LearnedLines } from '@/components/voice/DraftReview';
import { diffWords } from '@/lib/diff-words';
import type { FeedbackResult, VoiceStamp } from '@/lib/voice';

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
  situation: 'reply' | 'followup';
  priorities: { content: string; kind: string }[];
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

/** The review of an AI proposal, BELOW the reply box and Send (2026-11-06, Amir's sketch): Before (what the AI wrote,
 * the words you removed struck out) · how good it was, 1 to 5 · After (what is in the box now, the words you added
 * marked). Under them, folded: the sender's priority list the drafter followed, and one box for how you improved it and
 * what the AI missed. Send records all of it on the sent draft; "Save feedback" teaches now without sending; Discard
 * teaches from it too. */
export function ProposalStrip({ p, after, senderFirst, verdict, onVerdict, onDiscard, onTeach, teaching, learned, error }: {
  p: InboxProposal; after: string; senderFirst: string; verdict: Verdict; onVerdict: (v: Verdict) => void; onDiscard: () => void;
  onTeach: () => void; teaching: boolean; learned: FeedbackResult | null; error: string | null;
}) {
  const [why, setWhy] = useState(false);
  const diff = diffWords(p.message, after);
  const changed = diff.some((d) => d.op !== 'same');
  const box = 'rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words leading-relaxed min-h-[6rem]';
  const label = 'text-[11px] font-semibold uppercase tracking-wide mb-1';
  return (
    <div className="rounded-xl p-3 mt-3 text-xs space-y-3" style={{ background: 'var(--accent-soft)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span style={{ color: 'var(--accent)' }}><Sparkle width={13} height={13} /></span>
        <span className="font-medium">AI proposal in {senderFirst}&apos;s voice</span>
        <span style={{ color: 'var(--text-muted)' }}>· {p.situation === 'reply' ? 'a reply to what they wrote' : 'a follow-up, they have not answered'} · edit it in the box above, Send is yours</span>
        <span className="flex-1" />
        {p.reasoning && <button type="button" onClick={() => setWhy((v) => !v)} className="underline" style={{ color: 'var(--text-muted)' }}>{why ? 'hide why' : 'why this'}</button>}
        <button type="button" onClick={onDiscard} className="underline" style={{ color: 'var(--text-muted)' }}>Discard</button>
      </div>
      {why && p.reasoning && <p style={{ color: 'var(--text-muted)' }}>{p.reasoning}{p.used_facts.length ? ` · used: ${p.used_facts.join(', ')}` : ''}</p>}

      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-start">
        <div>
          <p className={label} style={{ color: 'var(--text-muted)' }}>Before · the AI&apos;s text</p>
          <div className={box} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            {diff.filter((d) => d.op !== 'ins').map((d, i) => d.op === 'same' ? <span key={i}>{d.text}</span>
              : <del key={i} style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 8%, transparent)' }}>{d.text}</del>)}
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
        <div>
          <p className={label} style={{ color: 'var(--text-muted)' }}>After · your text {changed ? '' : '(no edits yet)'}</p>
          <div className={box} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            {after.trim() ? diff.filter((d) => d.op !== 'del').map((d, i) => d.op === 'same' ? <span key={i}>{d.text}</span>
              : <ins key={i} style={{ color: 'var(--green)', textDecoration: 'none', fontWeight: 600, background: 'color-mix(in srgb, var(--green) 10%, transparent)' }}>{d.text}</ins>)
              : <em style={{ color: 'var(--text-muted)' }}>The reply box is empty.</em>}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 items-start">
        <details className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <summary className="cursor-pointer font-medium">{senderFirst}&apos;s priority list ({p.priorities.length})</summary>
          {p.priorities.length ? (
            <ol className="list-decimal pl-5 mt-2 space-y-1" style={{ color: 'var(--text-muted)' }}>
              {p.priorities.map((r, i) => <li key={i}>{r.content}</li>)}
            </ol>
          ) : <p className="mt-2" style={{ color: 'var(--text-muted)' }}>No priorities yet — what you write on the right becomes one.</p>}
        </details>
        <details open className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <summary className="cursor-pointer font-medium">How you improved it and what the AI missed</summary>
          <textarea value={verdict.note} onChange={(e) => onVerdict({ ...verdict, note: e.target.value.slice(0, 500) })} rows={3}
            disabled={!!learned} className="z-input mt-2 w-full resize-y" aria-label="How you improved it and what the AI missed"
            placeholder="e.g. he wrote du, the draft said Sie · too long · asked for a call too early" />
        </details>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[11px] flex-1" style={{ color: 'var(--text-muted)' }}>
          Your edits, the rating and the note become rules in {senderFirst}&apos;s voice: saved with Send, or with Save feedback alone.
        </p>
        {!learned && (
          <button type="button" onClick={onTeach} disabled={teaching || !verdictGiven(verdict)} title={`Teaches ${senderFirst}'s voice now, sends nothing`}
            className="px-3 py-1 rounded-lg font-medium disabled:opacity-40" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            {teaching ? 'Saving…' : 'Save feedback'}
          </button>
        )}
      </div>
      {learned && <LearnedLines res={learned} />}
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
    </div>
  );
}

/** Stars + one line, after the decision. `approvalId` set = the reply went out (rate the row); otherwise the proposal
 * was dropped and `before` / `after` teach without filing. */
export function RatingStrip({ approvalId, before, after, prospectId, channel, step, senderFirst, onClose }: {
  approvalId: string | null; before: string; after: string; prospectId: string | null; channel: 'linkedin' | 'email' | 'whatsapp';
  step: 'reply' | 'followup'; senderFirst: string; onClose: () => void;
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
