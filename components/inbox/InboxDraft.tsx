'use client';

import { useState } from 'react';
import { Sparkle, Star } from '@/components/icons';
import { LearnedLines } from '@/components/voice/DraftReview';
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

export interface Verdict { rating: number | null; right: string; wrong: string }
export const EMPTY_VERDICT: Verdict = { rating: null, right: '', wrong: '' };
export function verdictReason(v: Verdict): string {
  return [v.right.trim() && `Right: ${v.right.trim()}`, v.wrong.trim() && `Wrong: ${v.wrong.trim()}`].filter(Boolean).join(' · ').slice(0, 500);
}
export function verdictGiven(v: Verdict): boolean {
  return !!v.rating || !!v.right.trim() || !!v.wrong.trim();
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

/** The proposal strip above the reply box: why it was written, the stars and two lines (what was right, what went
 * wrong) the person can fill while they read and edit. Send records them on the sent draft; "Save feedback" teaches
 * now without sending; Discard teaches from them too. */
export function ProposalStrip({ p, senderFirst, verdict, onVerdict, onDiscard, onTeach, teaching, learned, error }: {
  p: InboxProposal; senderFirst: string; verdict: Verdict; onVerdict: (v: Verdict) => void; onDiscard: () => void;
  onTeach: () => void; teaching: boolean; learned: FeedbackResult | null; error: string | null;
}) {
  const [why, setWhy] = useState(false);
  const field = 'z-input flex-1 min-w-[10rem] !py-1';
  return (
    <div className="rounded-xl px-3 py-2 mb-2 text-xs space-y-1.5" style={{ background: 'var(--accent-soft)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span style={{ color: 'var(--accent)' }}><Sparkle width={13} height={13} /></span>
        <span className="font-medium">AI proposal in {senderFirst}&apos;s voice</span>
        <span style={{ color: 'var(--text-muted)' }}>· {p.situation === 'reply' ? 'a reply to what they wrote' : 'a follow-up, they have not answered'} · edit it below, Send is yours</span>
        <span className="flex-1" />
        {p.reasoning && <button type="button" onClick={() => setWhy((v) => !v)} className="underline" style={{ color: 'var(--text-muted)' }}>{why ? 'hide why' : 'why this'}</button>}
        <button type="button" onClick={onDiscard} className="underline" style={{ color: 'var(--text-muted)' }}>Discard</button>
      </div>
      {why && p.reasoning && <p style={{ color: 'var(--text-muted)' }}>{p.reasoning}{p.used_facts.length ? ` · used: ${p.used_facts.join(', ')}` : ''}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">How good is it?</span>
        <Stars value={verdict.rating} onChange={(n) => onVerdict({ ...verdict, rating: n })} disabled={!!learned} />
      </div>
      {!learned && (
        <div className="flex gap-2 flex-wrap">
          <input value={verdict.right} onChange={(e) => onVerdict({ ...verdict, right: e.target.value.slice(0, 240) })} className={field}
            placeholder="What was right (keep doing this)" aria-label="What was right" />
          <input value={verdict.wrong} onChange={(e) => onVerdict({ ...verdict, wrong: e.target.value.slice(0, 240) })} className={field}
            placeholder="What went wrong (e.g. he wrote du, the draft says Sie)" aria-label="What went wrong" />
          <button type="button" onClick={onTeach} disabled={teaching || !verdictGiven(verdict)} title={`Teaches ${senderFirst}'s voice now, sends nothing`}
            className="px-3 py-1 rounded-lg font-medium disabled:opacity-40" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            {teaching ? 'Saving…' : 'Save feedback'}
          </button>
        </div>
      )}
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Your edits, the stars and the two lines become rules in {senderFirst}&apos;s voice: saved with Send, or with Save feedback alone.</p>
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
