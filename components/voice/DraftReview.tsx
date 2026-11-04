'use client';

import { useEffect, useRef, useState } from 'react';
import { diffWords } from '@/lib/diff-words';
import type { FeedbackResult, VoiceRule } from '@/lib/voice';
import { Send, Sparkle, Star } from '@/components/icons';

/**
 * The Before / After review of an AI draft, in a popup (core 098, Mateo's sketch 2026-11-04). Top: what they wrote.
 * Two columns: the AI's proposal (read-only) and the text that goes out (editable, "show changes" marks the edits).
 * Under them: how good the proposal was, 1–5, and one line on what the AI missed. Folded: why the AI wrote it, and the
 * sender's priorities it was given. Footer: Draft again · Save feedback only · Queue for the sender's approval.
 *
 * Nothing here sends. The parent files `after` (the AI's text kept as draft_original) and sends the rating and the line
 * along, or teaches without filing.
 */
export interface DraftReviewProps {
  open: boolean;
  onClose: () => void;
  title: string;                                   // "Reply to Jannik Bühring"
  eyebrow: string;                                 // "LinkedIn reply · from Matthias's account"
  context?: { who: string; when: string | null; text: string } | null;   // their last message
  drafting: boolean;
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
  onRedraft: () => void;
  onTeach: () => void;
  onQueue: () => void;
  busy: '' | 'draft' | 'teach' | 'queue';
  canQueue: boolean;
  queueBlockedWhy?: string | null;
  error?: string | null;
  learned?: FeedbackResult | null;
  teachNote?: string | null;
}

const RATINGS: { n: number; label: string }[] = [
  { n: 1, label: 'Unusable' }, { n: 2, label: 'Weak' }, { n: 3, label: 'Needed work' }, { n: 4, label: 'Small fixes' }, { n: 5, label: 'Send as is' },
];

export default function DraftReview(p: DraftReviewProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [showPrio, setShowPrio] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!p.open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.open, p.onClose]);
  if (!p.open) return null;

  const first = p.senderName.split(' ')[0];
  const changed = !!p.before && p.after.trim() !== p.before.trim();
  const hasFeedback = !!p.rating || !!p.explanation.trim() || changed;
  const pane = 'rounded-xl px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap h-full min-h-[15rem]';
  const ghost = { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
      style={{ background: 'color-mix(in srgb, var(--text) 40%, transparent)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={p.title}
        className="w-full max-w-5xl rounded-2xl shadow-xl flex flex-col" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>

        {/* header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="z-eyebrow">{p.eyebrow}</div>
            <h2 className="text-lg font-semibold mt-0.5">{p.title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={p.onClose} aria-label="Close"
            className="w-9 h-9 rounded-full inline-flex items-center justify-center flex-shrink-0 hover:bg-[var(--accent-glow)]" style={{ color: 'var(--text-muted)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* what they wrote */}
          {p.context?.text && (
            <div className="rounded-xl px-4 py-3 text-[13px] leading-relaxed max-h-36 overflow-y-auto"
              style={{ background: 'var(--bg-input)', borderLeft: '3px solid var(--border)' }}>
              <div className="text-[11px] font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                {p.context.who} wrote{p.context.when ? ` · ${p.context.when}` : ''}
              </div>
              <div className="whitespace-pre-wrap">{p.context.text}</div>
            </div>
          )}

          {/* before / after */}
          <div className="grid gap-4 md:grid-cols-2 items-stretch">
            <section className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span style={{ color: 'var(--accent)' }}><Sparkle width={14} height={14} /></span>
                The AI&apos;s proposal
                <span className="font-normal" style={{ color: 'var(--text-muted)' }}>· before</span>
              </div>
              {p.drafting ? (
                <div className={`${pane} flex flex-col gap-2`} style={{ background: 'var(--bg-input)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Writing in {first}&apos;s voice…</span>
                  {[92, 100, 85, 96, 60].map((w, i) => <div key={i} className="h-3 rounded animate-pulse" style={{ width: `${w}%`, background: 'var(--border)' }} />)}
                </div>
              ) : (
                <div className={pane} style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{p.before}</div>
              )}
            </section>

            <section className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span style={{ color: 'var(--green)' }}><Send width={13} height={13} /></span>
                What goes out
                <span className="font-normal" style={{ color: 'var(--text-muted)' }}>· after — edit freely</span>
                {changed && (
                  <button type="button" onClick={() => setShowDiff((v) => !v)} className="ml-auto font-normal underline text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {showDiff ? 'Edit text' : 'Show my changes'}
                  </button>
                )}
              </div>
              {showDiff && changed ? (
                <div className={pane} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  {diffWords(p.before, p.after).map((d, i) => d.op === 'same' ? <span key={i}>{d.text}</span>
                    : d.op === 'del' ? <del key={i} style={{ color: 'var(--red)', opacity: 0.75 }}>{d.text}</del>
                      : <ins key={i} style={{ color: 'var(--green)', textDecoration: 'none', fontWeight: 600, background: 'color-mix(in srgb, var(--green) 10%, transparent)' }}>{d.text}</ins>)}
                </div>
              ) : (
                <textarea value={p.after} onChange={(e) => p.onAfter(e.target.value)} disabled={p.drafting}
                  aria-label="The text that goes out — edit it"
                  className={`${pane} w-full resize-y outline-none focus:ring-2`}
                  style={{ background: 'var(--bg-card)', border: '1.5px solid var(--accent)', color: 'var(--text)' }} />
              )}
            </section>
          </div>

          {/* rating — five stars, empty to full */}
          <div className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ background: 'var(--bg-input)' }}>
            <span className="text-xs font-semibold">How good was the AI&apos;s proposal?</span>
            <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Rating from 1 to 5 stars"
              onMouseLeave={() => setHover(null)}>
              {RATINGS.map((r) => {
                const shown = hover ?? p.rating ?? 0;
                const lit = r.n <= shown;
                return (
                  <button key={r.n} type="button" role="radio" aria-checked={p.rating === r.n} aria-label={`${r.n} star${r.n > 1 ? 's' : ''} — ${r.label}`}
                    title={r.label} disabled={p.drafting}
                    onMouseEnter={() => setHover(r.n)} onFocus={() => setHover(r.n)} onBlur={() => setHover(null)}
                    onClick={() => p.onRating(p.rating === r.n ? null : r.n)}
                    className="p-1 rounded-md transition-transform hover:scale-110 disabled:opacity-50"
                    style={{ color: lit ? 'var(--yellow)' : 'var(--text-muted)' }}>
                    <Star filled={lit} width={26} height={26} />
                  </button>
                );
              })}
            </div>
            <span className="text-xs font-medium min-w-[6rem]" style={{ color: (hover ?? p.rating) ? 'var(--text)' : 'var(--text-muted)' }}>
              {(hover ?? p.rating) ? `${RATINGS[(hover ?? p.rating)! - 1].label}` : 'Tap a star'}
            </span>
          </div>

          {/* what the AI missed */}
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold">What did you improve, and what did the AI miss?</span>
            <textarea value={p.explanation} onChange={(e) => p.onExplanation(e.target.value.slice(0, 500))} rows={2} disabled={p.drafting}
              placeholder="e.g. Too formal for someone who wrote du — and it should mention we met at Fakuma"
              className="w-full rounded-xl px-3 py-2 text-[13px] resize-y" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>This becomes a rule in {first}&apos;s voice — the next draft follows it.</span>
          </label>

          {/* folded details */}
          <div className="grid gap-3 md:grid-cols-2">
            <details open={showWhy} onToggle={(e) => setShowWhy((e.target as HTMLDetailsElement).open)} className="rounded-xl px-4 py-2.5" style={{ border: '1px solid var(--border)' }}>
              <summary className="text-xs font-medium cursor-pointer">Why the AI wrote it</summary>
              <div className="pt-2 text-xs space-y-1.5">
                <p>{p.reasoning || 'No reason given.'}</p>
                {(p.usedFacts?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.usedFacts!.map((f, i) => <span key={i} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{f}</span>)}
                  </div>
                )}
              </div>
            </details>
            <details open={showPrio} onToggle={(e) => setShowPrio((e.target as HTMLDetailsElement).open)} className="rounded-xl px-4 py-2.5" style={{ border: '1px solid var(--border)' }}>
              <summary className="text-xs font-medium cursor-pointer">{first}&apos;s priorities ({p.priorities?.length ?? 0})</summary>
              <div className="pt-2 text-xs">
                {(p.priorities?.length ?? 0) === 0
                  ? <p style={{ color: 'var(--text-muted)' }}>None yet. Every explanation you write here becomes one; order them on Brand → Voice.</p>
                  : <ol className="list-decimal pl-5 space-y-0.5">{p.priorities!.map((r, i) => <li key={i}>{r.kind === 'never_write' ? `Never write “${r.content}”` : r.content}</li>)}</ol>}
              </div>
            </details>
          </div>

          {p.learned && <div className="rounded-xl px-4 py-3" style={{ background: 'color-mix(in srgb, var(--green) 8%, transparent)' }}><LearnedLines res={p.learned} /></div>}
          {p.teachNote && <p className="text-xs" style={{ color: 'var(--green)' }}>{p.teachNote}</p>}
          {p.error && <p role="alert" className="text-xs font-medium" style={{ color: 'var(--red)' }}>{p.error}</p>}
        </div>

        {/* footer */}
        <div className="px-6 py-4 border-t flex flex-wrap items-center gap-2 rounded-b-2xl" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
          <button type="button" onClick={p.onRedraft} disabled={!!p.busy || p.drafting}
            className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-full disabled:opacity-50" style={ghost}>
            <Sparkle width={13} height={13} />{p.busy === 'draft' ? 'Drafting…' : 'Draft again'}
          </button>
          <span className="flex-1" />
          {!p.canQueue && p.queueBlockedWhy && <span className="text-[11px] max-w-xs text-right" style={{ color: 'var(--text-muted)' }}>{p.queueBlockedWhy}</span>}
          <button type="button" onClick={p.onTeach} disabled={!!p.busy || p.drafting || !hasFeedback}
            title={`Saves the rating, your edits and the explanation to ${first}'s voice — files and sends nothing`}
            className="text-xs px-3.5 py-2 rounded-full disabled:opacity-40" style={ghost}>
            {p.busy === 'teach' ? 'Saving…' : 'Save feedback only'}
          </button>
          <button type="button" onClick={p.onQueue} disabled={!!p.busy || p.drafting || !p.canQueue || !p.after.trim()}
            className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-full font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            <Send width={13} height={13} />{p.busy === 'queue' ? 'Filing…' : `Queue for ${first}'s approval`}
          </button>
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
    return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{res.rating ? `Rated ${res.rating / 2}/5. ` : ''}{res.note || 'Saved — nothing general to learn from this one.'}</p>;
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
