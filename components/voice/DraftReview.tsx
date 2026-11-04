'use client';

import { useState } from 'react';
import { diffWords } from '@/lib/diff-words';
import type { FeedbackResult, VoiceRule } from '@/lib/voice';

/**
 * The Before / After review of an AI draft (core 098, Mateo's sketch 2026-11-04). Left: what the AI proposed, read-only.
 * Right: the text that will go out, editable. Between them: how good the proposal was, 1–5. Under the right column:
 * one line on what you changed and what the AI missed; folded under it, why the AI wrote it and the facts it used.
 * Under the left column, folded: the sender's priorities the AI was given.
 *
 * Nothing here sends. The parent files `after` (with the AI's text as draft_original) and then sends the rating and the
 * line through `onFeedback`; or, with nothing to file, teaches without filing (`onTeachOnly`).
 */
export interface DraftReviewProps {
  label: string;                                   // "LinkedIn reply", "first message on LinkedIn", …
  before: string;
  after: string;
  onAfter: (v: string) => void;
  reasoning?: string | null;
  usedFacts?: string[];
  priorities?: { content: string; kind: string }[];
  senderName: string;
  rating: number | null;
  onRating: (n: number | null) => void;
  explanation: string;
  onExplanation: (v: string) => void;
  disabled?: boolean;
}

const RATING_LABEL: Record<number, string> = { 1: 'unusable', 2: 'weak', 3: 'needed work', 4: 'small fixes', 5: 'send as is' };

export default function DraftReview(p: DraftReviewProps) {
  const [showWhy, setShowWhy] = useState(false);
  const [showPrio, setShowPrio] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const changed = p.after.trim() !== p.before.trim();
  const box = { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '0.5rem' } as const;
  const first = p.senderName.split(' ')[0];

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">Proposed: {p.label}</div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-start">
        {/* Before */}
        <div className="space-y-1 min-w-0">
          <div className="z-eyebrow">Before · the AI&apos;s proposal</div>
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap px-3 py-2 min-h-[8rem]"
            style={{ ...box, background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{p.before}</p>
        </div>

        {/* Rating */}
        <div className="flex md:flex-col items-center gap-1.5 md:pt-6" role="radiogroup" aria-label="How good was the proposal, 1 to 5">
          <span className="text-[11px] md:text-center md:w-28 leading-tight" style={{ color: 'var(--text-muted)' }}>How good was the proposal?</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={p.rating === n} disabled={p.disabled}
              onClick={() => p.onRating(p.rating === n ? null : n)} title={RATING_LABEL[n]}
              className="w-8 h-8 rounded-full text-xs tabular-nums disabled:opacity-50"
              style={{ background: p.rating === n ? 'var(--accent)' : 'var(--bg-card)', color: p.rating === n ? 'var(--accent-fg)' : 'var(--text)', border: '1px solid var(--border)' }}>{n}</button>
          ))}
          <span className="text-[10px] h-3 md:text-center" style={{ color: 'var(--text-muted)' }}>{p.rating ? RATING_LABEL[p.rating] : ''}</span>
        </div>

        {/* After */}
        <div className="space-y-1 min-w-0">
          <div className="z-eyebrow flex items-center gap-2">After · what goes out
            {changed && <button type="button" onClick={() => setShowDiff((v) => !v)} className="normal-case tracking-normal underline font-normal" style={{ color: 'var(--text-muted)' }}>{showDiff ? 'hide changes' : 'show changes'}</button>}
          </div>
          {showDiff && changed ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap px-3 py-2 min-h-[8rem]" style={box}>
              {diffWords(p.before, p.after).map((d, i) => d.op === 'same' ? <span key={i}>{d.text}</span>
                : d.op === 'del' ? <del key={i} style={{ color: 'var(--red)', opacity: 0.8 }}>{d.text}</del>
                  : <ins key={i} style={{ color: 'var(--green)', textDecoration: 'none', fontWeight: 600 }}>{d.text}</ins>)}
            </p>
          ) : (
            <textarea value={p.after} onChange={(e) => p.onAfter(e.target.value)} rows={Math.min(14, Math.max(6, p.after.split('\n').length + 2))}
              disabled={p.disabled} aria-label="The text that goes out — edit it"
              className="w-full text-[13px] px-3 py-2 leading-relaxed resize-y" style={{ ...box, border: '1px solid var(--accent)' }} />
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Priorities (folded) */}
        <div>
          <button type="button" onClick={() => setShowPrio((v) => !v)} className="text-[11px] underline" style={{ color: 'var(--text-muted)' }}>
            {showPrio ? '▾' : '▸'} {first}&apos;s priority list ({p.priorities?.length ?? 0})
          </button>
          {showPrio && (
            (p.priorities?.length ?? 0) === 0
              ? <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>No priorities yet — every explanation you write here becomes one. Order them on Brand → Voice.</p>
              : <ol className="mt-1 space-y-0.5 text-xs list-decimal pl-5">
                  {p.priorities!.map((r, i) => <li key={i}>{r.kind === 'never_write' ? `Never write “${r.content}”` : r.content}</li>)}
                </ol>
          )}
        </div>

        {/* Explanation + why (folded) */}
        <div className="space-y-1">
          <textarea value={p.explanation} onChange={(e) => p.onExplanation(e.target.value.slice(0, 500))} rows={2} disabled={p.disabled}
            placeholder="Short explanation: how you improved the text and what the AI missed"
            aria-label="How you improved the text and what the AI missed"
            className="w-full text-xs px-2.5 py-1.5 resize-y" style={box} />
          <button type="button" onClick={() => setShowWhy((v) => !v)} className="text-[11px] underline" style={{ color: 'var(--text-muted)' }}>
            {showWhy ? '▾' : '▸'} Why the AI wrote it
          </button>
          {showWhy && (
            <div className="text-[11px] space-y-1 rounded-md p-2" style={{ background: 'var(--bg-input)' }}>
              <div>{p.reasoning || 'No reason given.'}</div>
              {(p.usedFacts?.length ?? 0) > 0 && <div style={{ color: 'var(--text-muted)' }}>Facts it used: {p.usedFacts!.join(' · ')}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** What the drafter learned from a review, with Undo for each new rule. */
export function LearnedLines({ res }: { res: FeedbackResult }) {
  const [undone, setUndone] = useState<Record<string, boolean>>({});
  const undo = async (rule: VoiceRule) => {
    const r = await fetch(`/api/voice/rules/${rule.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'forget' }) });
    if (r.ok) setUndone((u) => ({ ...u, [rule.id]: true }));
  };
  const learned = res.learned ?? [];
  const again = res.reinforced ?? [];
  if (!learned.length && !again.length && !res.fact_noted) {
    return <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{res.rating ? `Rated ${res.rating / 2}/5. ` : ''}{res.note || 'Nothing general to learn from this one.'}</p>;
  }
  return (
    <div className="text-xs space-y-1">
      {res.fact_noted && <div>📝 Noted on the person: “{res.fact_noted}”</div>}
      {learned.map((r) => (
        <div key={r.id} className="flex items-start gap-2">
          <span>🧠</span>
          <span className="flex-1" style={{ textDecoration: undone[r.id] ? 'line-through' : 'none' }}>Learned: “{r.content}”</span>
          {!undone[r.id] && <button type="button" onClick={() => undo(r)} className="underline shrink-0" style={{ color: 'var(--text-muted)' }}>Undo</button>}
        </div>
      ))}
      {again.map((r) => <div key={r.id} className="flex items-start gap-2"><span>🧠</span><span>Noted again: “{r.content}”</span></div>)}
    </div>
  );
}
