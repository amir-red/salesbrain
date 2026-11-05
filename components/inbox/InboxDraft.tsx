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

export function ProposalStrip({ p, senderFirst, onDiscard }: { p: InboxProposal; senderFirst: string; onDiscard: () => void }) {
  const [why, setWhy] = useState(false);
  return (
    <div className="rounded-xl px-3 py-2 mb-2 text-xs space-y-1" style={{ background: 'var(--accent-soft)' }}>
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--accent)' }}><Sparkle width={13} height={13} /></span>
        <span className="font-medium">AI proposal in {senderFirst}&apos;s voice</span>
        <span style={{ color: 'var(--text-muted)' }}>· {p.situation === 'reply' ? 'a reply to what they wrote' : 'a follow-up, they have not answered'} · edit it below, Send is yours</span>
        <span className="flex-1" />
        {p.reasoning && <button type="button" onClick={() => setWhy((v) => !v)} className="underline" style={{ color: 'var(--text-muted)' }}>{why ? 'hide why' : 'why this'}</button>}
        <button type="button" onClick={onDiscard} className="underline" style={{ color: 'var(--text-muted)' }}>Discard</button>
      </div>
      {why && p.reasoning && <p style={{ color: 'var(--text-muted)' }}>{p.reasoning}{p.used_facts.length ? ` · used: ${p.used_facts.join(', ')}` : ''}</p>}
    </div>
  );
}

/** Stars + one line, after the decision. `approvalId` set = the reply went out (rate the row); otherwise the proposal
 * was dropped and `before` / `after` teach without filing. */
export function RatingStrip({ approvalId, before, after, prospectId, channel, step, senderFirst, onClose }: {
  approvalId: string | null; before: string; after: string; prospectId: string | null; channel: 'linkedin' | 'email';
  step: 'reply' | 'followup'; senderFirst: string; onClose: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
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
        <div className="flex items-center" role="radiogroup" aria-label="Rating from 1 to 5 stars" onMouseLeave={() => setHover(null)}>
          {RATINGS.map((label, i) => {
            const n = i + 1; const lit = n <= (hover ?? rating ?? 0);
            return (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} stars — ${label}`} title={label}
                disabled={!!res} onMouseEnter={() => setHover(n)} onClick={() => setRating(rating === n ? null : n)}
                className="p-0.5 hover:scale-110 transition-transform disabled:opacity-60" style={{ color: lit ? 'var(--yellow)' : 'var(--text-muted)' }}>
                <Star filled={lit} width={20} height={20} />
              </button>
            );
          })}
        </div>
        <span style={{ color: 'var(--text-muted)' }}>{(hover ?? rating) ? RATINGS[(hover ?? rating)! - 1] : ''}</span>
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
