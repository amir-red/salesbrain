'use client';

import { useState } from 'react';
import { REASONS, type FeedbackResult, type VoiceRule } from '@/lib/voice';

/**
 * Rate one draft 1–10 and say why (Brand & Voice, core 079). A lesson becomes a rule in the SENDER's own voice at
 * once; anything learned is shown with an Undo. Never blocks anything: the draft is already decided or still waiting.
 */
export default function DraftFeedback({ approvalId, label, onDone, compact = false }: {
  approvalId: string; label?: string; onDone?: (res: FeedbackResult) => void; compact?: boolean;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<FeedbackResult | null>(null);
  const [undone, setUndone] = useState<Record<string, boolean>>({});

  const toggle = (k: string) => setReasons((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k]));

  const save = async () => {
    if (rating == null && reasons.length === 0 && !text.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/drafts/${approvalId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'feedback', rating: rating ?? undefined, reasons, reason: text.trim() || undefined }),
      });
      const out = (await r.json()) as FeedbackResult;
      setRes(r.ok ? out : { error: out.error || 'Could not save the rating' });
      if (r.ok) onDone?.(out);
    } finally { setBusy(false); }
  };

  const undo = async (rule: VoiceRule) => {
    const r = await fetch(`/api/voice/rules/${rule.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'forget' }) });
    if (r.ok) setUndone((u) => ({ ...u, [rule.id]: true }));
  };

  if (res && !res.error) {
    const rules = [...(res.learned ?? []), ...(res.reinforced ?? [])];
    return (
      <div className="rounded-lg p-3 text-xs space-y-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
        <div style={{ color: 'var(--text-muted)' }}>
          {res.rating ? `Rated ${res.rating}/10` : 'Thanks'}{res.reason ? ` — ${res.reason}` : ''}.
          {res.decision === 'golden' ? ' Kept as an example of your voice.' : ''}
          {res.decision === 'learn' && rules.length === 0 ? ' Nothing general to learn from this one.' : ''}
        </div>
        {(res.learned ?? []).map((r) => (
          <div key={r.id} className="flex items-start gap-2">
            <span>🧠</span>
            <span className="flex-1" style={{ textDecoration: undone[r.id] ? 'line-through' : 'none' }}>Learned for your voice: “{r.content}”</span>
            {!undone[r.id] && <button onClick={() => undo(r)} className="underline shrink-0" style={{ color: 'var(--text-muted)' }}>Undo</button>}
          </div>
        ))}
        {(res.reinforced ?? []).map((r) => (
          <div key={r.id} className="flex items-start gap-2"><span>🧠</span><span>Noted again: “{r.content}”</span></div>
        ))}
      </div>
    );
  }

  return (
    <div className={`rounded-lg ${compact ? 'p-2' : 'p-3'} space-y-2`} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-medium">{label ?? 'How good was this draft?'} <span className="font-normal" style={{ color: 'var(--text-muted)' }}>1 = unusable, 10 = I&apos;d send it as is</span></div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Rating from 1 to 10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} role="radio" aria-checked={rating === n} onClick={() => setRating(n)}
            className="w-7 h-7 rounded-md text-xs tabular-nums"
            style={{ background: rating === n ? 'var(--accent)' : 'var(--bg-card)', color: rating === n ? 'var(--accent-fg)' : 'var(--text)', border: '1px solid var(--border)' }}>{n}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {REASONS.map((r) => (
          <button key={r.key} onClick={() => toggle(r.key)} aria-pressed={reasons.includes(r.key)}
            className="px-2 py-0.5 rounded-full text-[11px]"
            style={{ background: reasons.includes(r.key) ? 'var(--accent-soft)' : 'transparent', color: reasons.includes(r.key) ? 'var(--accent)' : 'var(--text-muted)', border: '1px solid var(--border)' }}>{r.label}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Why? In your own words (optional)"
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          className="flex-1 px-2 py-1 rounded-md text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        <button onClick={save} disabled={busy || (rating == null && reasons.length === 0 && !text.trim())}
          className="px-3 py-1 rounded-md text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {res?.error && <div className="text-[11px]" style={{ color: 'var(--red)' }}>{res.error}</div>}
    </div>
  );
}
