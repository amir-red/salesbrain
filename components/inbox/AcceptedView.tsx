'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/panel/Button';
import { Pill } from '@/components/panel/PageHeader';
import { Sparkle } from '@/components/icons';
import type { AcceptedItem } from '@/lib/inbox-accepted';
import { initials, shortWhen } from '@/lib/inbox';
import type { FeedbackResult } from '@/lib/voice';
import { EMPTY_VERDICT, ProposalStrip, verdictGiven, verdictReason, type InboxProposal, type Verdict } from './InboxDraft';
import { LearnedLines } from '@/components/voice/DraftReview';

/** The status line of an accepted request, for the list and the view. */
export function acceptedStatus(it: AcceptedItem): { label: string; color: string } {
  if (it.status === 'card') return { label: 'first message waiting', color: 'var(--accent)' };
  if (it.status === 'to_draft') return { label: 'no message yet', color: 'var(--orange)' };
  if (it.status === 'messaged') return { label: 'messaged', color: 'var(--green)' };
  return { label: 'not a lead', color: 'var(--text-muted)' };
}

/** One row of the Accepted tab. */
export function AcceptedRow({ it, active, showOwner, onSelect }: { it: AcceptedItem; active: boolean; showOwner: boolean; onSelect: () => void }) {
  const st = acceptedStatus(it);
  return (
    <button type="button" onClick={onSelect} aria-current={active ? 'true' : undefined}
      className="w-full text-left px-3 py-2.5 flex gap-3 border-b transition-colors hover:bg-[var(--accent-glow)]"
      style={{ borderColor: 'var(--border)', background: active ? 'var(--accent-glow)' : undefined }}>
      <div className="relative flex-shrink-0">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{initials(it.name)}</div>
        <span className="absolute -bottom-1 -right-1 text-[11px]" aria-hidden>🤝</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm" style={{ fontWeight: it.status === 'card' || it.status === 'to_draft' ? 700 : 500 }}>{it.name || 'Unknown'}</span>
          <span className="ml-auto text-[11px] flex-shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>{shortWhen(it.accepted_at)}</span>
        </div>
        <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{[it.headline, it.company].filter(Boolean).join(' · ') || ' '}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] px-1.5 rounded-full" style={{ color: st.color, background: `color-mix(in srgb, ${st.color} 14%, transparent)` }}>{st.label}</span>
          {it.list_name && <span className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>{it.list_name}</span>}
        </div>
        {showOwner && it.owner_name && (
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>on {it.owner_name.split(' ')[0]}&apos;s account</p>
        )}
      </div>
    </button>
  );
}

/**
 * The right side of the Accepted tab: the Telegram notice "🤝 X accepted your connection request", then the first
 * message — the waiting card (edit, send, skip) or a draft written here (the list's template, else the AI in your
 * voice). Send = your decision; it goes out from your LinkedIn through the send gate and opens the conversation.
 */
export default function AcceptedView({ item, onBack, onChanged, onOpenThread }: {
  item: AcceptedItem | null; onBack: () => void; onChanged: () => void; onOpenThread: (threadId: string) => void;
}) {
  const [proposal, setProposal] = useState<InboxProposal | null>(null);
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<Verdict>(EMPTY_VERDICT);
  const [learned, setLearned] = useState<FeedbackResult | null>(null);
  const [teaching, setTeaching] = useState(false);
  const [teachErr, setTeachErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'error' | 'info' | 'ok'; text: string } | null>(null);
  const drafted = useRef<Set<string>>(new Set());

  // A waiting card is shown as the proposal; a lead with no card drafts once when opened.
  useEffect(() => {
    setNote(null); setVerdict(EMPTY_VERDICT); setLearned(null); setTeachErr(null);
    if (!item) { setProposal(null); setText(''); return; }
    if (item.status === 'card' && item.approval_message) {
      const before = (item.draft_original || item.approval_message).trim();
      setProposal({ message: before, reasoning: null, used_facts: [], situation: 'first', priorities: [],
        voice: { draft_original: before, drafted_by: 'card', voice_rule_ids: [] } });
      setText(item.approval_message.trim());
    } else {
      setProposal(null); setText('');
      if (item.status === 'to_draft' && item.mine && !drafted.current.has(item.id)) { drafted.current.add(item.id); draft(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.status]);

  if (!item) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-8">
        <p className="text-3xl" aria-hidden>🤝</p>
        <p className="mt-3 text-sm font-medium">Pick someone who accepted</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Send them a first message from here — it goes out from your own LinkedIn.</p>
      </div>
    );
  }
  const it = item;

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/inbox/accepted/${it.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || data.reason || 'Something went wrong');
    return data;
  }

  async function draft() {
    setBusy('draft'); setNote(null);
    try {
      const d = await post({ action: 'draft' });
      setProposal({ message: d.message, reasoning: d.reasoning ?? null, used_facts: d.used_facts ?? [], voice: d.voice, situation: 'first', priorities: d.priorities ?? [] });
      setText(d.message); setVerdict(EMPTY_VERDICT); setLearned(null);
    } catch (e) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : 'Could not draft' });
    } finally { setBusy(null); }
  }

  async function teach(after: string) {
    if (!proposal) return false;
    setTeaching(true); setTeachErr(null);
    try {
      const r = await fetch('/api/drafts/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before: proposal.message, after, ...(verdict.rating ? { rating: verdict.rating } : {}),
          ...(verdictReason(verdict) ? { reason: verdictReason(verdict) } : {}), ...(it.prospect_id ? { prospect_id: it.prospect_id } : {}),
          channel: 'linkedin', step: 'first' }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Not saved');
      setLearned(d as FeedbackResult);
      return true;
    } catch (e) {
      setTeachErr(e instanceof Error ? e.message : 'Not saved');
      return false;
    } finally { setTeaching(false); }
  }

  async function send(asIs: boolean) {
    if (!proposal) return;
    const out = asIs ? proposal.message : text;
    setBusy(asIs ? 'reply-asis' : 'reply'); setNote(null);
    try {
      const d = await post({ action: 'send', text: out, voice: proposal.voice });
      if (d.approval_id && verdictGiven(verdict)) {
        await fetch(`/api/drafts/${d.approval_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'feedback', ...(verdict.rating ? { rating: verdict.rating * 2 } : {}), ...(verdictReason(verdict) ? { reason: verdictReason(verdict) } : {}) }) })
          .catch(() => undefined);
      }
      setProposal(null); setText('');
      setNote(d.sent === false
        ? { kind: 'info', text: d.note || 'Held by the send rules — it goes out at the next send window.' }
        : { kind: 'ok', text: `Sent to ${it.name || 'them'} on LinkedIn. The conversation is in the LinkedIn tab.` });
      onChanged();
    } catch (e) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : 'Not sent' });
    } finally { setBusy(null); }
  }

  async function skip() {
    if (!proposal) return;
    if (verdictGiven(verdict) && !learned) await teach(text);
    if (it.approval_id) {
      setBusy('skip');
      try { await post({ action: 'skip' }); onChanged(); } catch (e) { setNote({ kind: 'error', text: e instanceof Error ? e.message : 'Not skipped' }); }
      finally { setBusy(null); }
    }
    setProposal(null); setText('');
  }

  const st = acceptedStatus(it);
  const leadHref = it.card_id ? `/sales-leads?q=${encodeURIComponent(it.name || '')}&open=${it.card_id}`
    : it.prospect_id ? `/prospects/${it.prospect_id}` : null;
  const owner = (it.owner_name || 'your').split(' ')[0];

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b flex items-start gap-3" style={{ borderColor: 'var(--border)' }}>
        <button type="button" onClick={onBack} className="md:hidden mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }} aria-label="Back to the list">←</button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{initials(it.name)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h2 className="font-semibold truncate">{it.name || 'Unknown'}</h2>
            <Pill color={st.color}>{st.label}</Pill>
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{[it.headline, it.company].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {leadHref && <Button size="sm" href={leadHref}>Open lead</Button>}
          {it.profile_url && (
            <a href={it.profile_url} target="_blank" rel="noreferrer" className="px-2.5 py-1 text-xs rounded-lg font-medium" style={{ border: '1px solid var(--border)' }}>Profile ↗</a>
          )}
          {it.thread_id && <Button size="sm" onClick={() => onOpenThread(it.thread_id!)}>Open conversation</Button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-6">
        <div className="max-w-xl mx-auto rounded-2xl p-4 text-sm leading-relaxed" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <p className="font-semibold">🤝 {it.name || 'Someone'} accepted {it.mine ? 'your' : `${owner}'s`} connection request</p>
          {it.headline && <p>{it.headline}</p>}
          {it.profile_url && (
            <a href={it.profile_url} target="_blank" rel="noreferrer" className="underline break-all" style={{ color: 'var(--accent)' }}>
              {it.profile_url.replace(/^https:\/\/www\./, '')}
            </a>
          )}
          <p className="mt-3" style={{ color: 'var(--text-muted)' }}>
            {it.status === 'card' ? '→ A first-message card is waiting for you below: edit it, send it, or skip it.'
              : it.status === 'to_draft' ? '→ No first message yet — draft one below.'
                : it.status === 'messaged' ? '→ You already wrote to them: the conversation is in the LinkedIn tab.'
                  : '→ Not a lead in SalesBrain (the request was sent on LinkedIn itself) — message them there.'}
          </p>
          <p className="mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Accepted {shortWhen(it.accepted_at)}{it.sent_at ? ` · request sent ${shortWhen(it.sent_at)}` : ''}
            {it.list_name ? ` · list “${it.list_name}”` : ''}{!it.mine && it.owner_name ? ` · on ${it.owner_name}'s account` : ''}
          </p>
        </div>
      </div>

      <div className="border-t p-3 max-h-[65vh] overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
        {note && (
          <p className="text-xs mb-2 p-2 rounded-lg" style={{
            color: note.kind === 'error' ? 'var(--red)' : 'var(--text)',
            background: note.kind === 'error' ? 'color-mix(in srgb, var(--red) 10%, transparent)'
              : note.kind === 'ok' ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'var(--bg-input)',
          }}>{note.text}</p>
        )}
        {!it.mine ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>On {it.owner_name || 'a teammate'}&apos;s LinkedIn — only they can message from it.</p>
        ) : proposal ? (
          <ProposalStrip p={proposal} after={text} onAfter={setText} senderFirst={owner} verdict={verdict} onVerdict={setVerdict}
            onTeach={() => teach(text)} teaching={teaching} learned={learned} error={teachErr}
            onSendAsIs={() => send(true)} onSend={() => send(false)} onRedraft={draft} busy={busy}
            fromLine="From your LinkedIn · opens a new conversation · ⌘/Ctrl + Enter to send"
            onDiscard={skip} />
        ) : (it.status === 'card' || it.status === 'to_draft') ? (
          <div className="flex items-center gap-2">
            <p className="text-[11px] flex-1" style={{ color: 'var(--text-muted)' }}>A first message in your voice — you edit it, Send is yours.</p>
            <Button size="sm" onClick={draft} disabled={!!busy}>
              <span className="inline-flex items-center gap-1"><Sparkle width={12} height={12} />{busy === 'draft' ? 'Drafting…' : 'Draft first message'}</span>
            </Button>
          </div>
        ) : null}
        {!proposal && learned && <div className="mt-2 text-xs"><LearnedLines res={learned} /></div>}
      </div>
    </div>
  );
}
