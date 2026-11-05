'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/panel/Button';
import { Pill } from '@/components/panel/PageHeader';
import type { InboxMessage, InboxThread } from '@/lib/inbox';
import { CHANNEL_LABEL, initials } from '@/lib/inbox';
import ChannelIcon from './ChannelIcon';
import { EMPTY_VERDICT, ProposalStrip, RatingStrip, verdictGiven, verdictReason, type InboxProposal, type Verdict } from './InboxDraft';
import { LearnedLines } from '@/components/voice/DraftReview';
import type { FeedbackResult } from '@/lib/voice';
import { Sparkle } from '@/components/icons';

function dayLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function time(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
}

function Bubble({ m, channel }: { m: InboxMessage; channel: InboxThread['channel'] }) {
  return (
    <div className={`flex ${m.from_me ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm"
        style={{
          background: m.from_me ? 'var(--accent-soft)' : 'var(--bg-input)',
          borderBottomRightRadius: m.from_me ? 6 : undefined, borderBottomLeftRadius: m.from_me ? undefined : 6,
          opacity: m.pending ? 0.75 : 1,
        }}>
        {channel === 'email' && m.from && !m.from_me && (
          <p className="text-[11px] mb-1 truncate" style={{ color: 'var(--text-muted)' }}>{m.from}</p>
        )}
        <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text || <em style={{ color: 'var(--text-muted)' }}>(no text)</em>}</p>
        <p className="text-[10px] mt-1 text-right" style={{ color: 'var(--text-muted)' }}>
          {m.pending ? 'Waiting to be sent' : time(m.sent_at)}
        </p>
      </div>
    </div>
  );
}

/** The right side: who it is, the conversation, and the reply box (only on your own account). */
export default function ConversationView({ thread, loading, onBack, onChanged }: {
  thread: InboxThread | null; loading: boolean; onBack: () => void; onChanged: (t: InboxThread | null) => void;
}) {
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<InboxProposal | null>(null);   // the AI draft in the box, until sent or dropped
  const [rate, setRate] = useState<{ approvalId: string | null; before: string; after: string; step: 'reply' | 'followup' } | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(EMPTY_VERDICT);        // stars + right / wrong, filled while reviewing
  const [learned, setLearned] = useState<FeedbackResult | null>(null);   // what the last Save / Send taught
  const [teaching, setTeaching] = useState(false);
  const [teachErr, setTeachErr] = useState<string | null>(null);
  const autoDrafted = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const key = thread ? `${thread.channel}:${thread.id}` : '';

  useEffect(() => { setText(''); setNote(null); setProposal(null); setRate(null); setVerdict(EMPTY_VERDICT); setLearned(null); setTeachErr(null); }, [key]);
  // A conversation that needs an answer drafts by itself when it opens (once per conversation per visit).
  useEffect(() => {
    if (!thread || !thread.can_reply || thread.state !== 'needs_reply' || !thread.last_from_them) return;
    if (autoDrafted.current.has(key) || proposal || text.trim()) return;
    autoDrafted.current.add(key);
    act('draft');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, thread?.can_reply, thread?.state]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [key, thread?.messages.length]);
  useEffect(() => {
    const el = boxRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 220)}px`; }
  }, [text]);

  if (loading && !thread) {
    return <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  }
  if (!thread) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-8">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ color: 'var(--text-muted)' }}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <p className="mt-3 text-sm font-medium">Pick a conversation</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Read it and answer from here — the reply goes out from your own LinkedIn or Gmail.</p>
      </div>
    );
  }

  async function act(action: 'reply' | 'done' | 'reopen' | 'refresh' | 'draft') {
    if (!thread) return;
    setBusy(action); setNote(null);
    try {
      const res = await fetch(`/api/inbox/${thread.channel}/${thread.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reply' ? { action, text, ...(proposal ? { voice: proposal.voice } : {}) } : { action }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || data.reason || 'Something went wrong');
      if (action === 'draft') {
        setProposal({ message: data.message, reasoning: data.reasoning ?? null, used_facts: data.used_facts ?? [], voice: data.voice,
          situation: data.situation === 'followup' ? 'followup' : 'reply', priorities: data.priorities ?? [] });
        setRate(null); setVerdict(EMPTY_VERDICT); setLearned(null); setTeachErr(null); setText(data.message);
        return;
      }
      if (action === 'reply') {
        const sentOrHeld = data.sent || data.waiting;
        if (sentOrHeld && proposal) {
          // the proposal went out (as is, or edited): a verdict already given is recorded on its approval row now,
          // otherwise the stars are offered once more
          const approvalId = typeof data.approval_id === 'string' ? data.approval_id : null;
          if (approvalId && verdictGiven(verdict)) {
            const r = await fetch(`/api/drafts/${approvalId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'feedback', ...(verdict.rating ? { rating: verdict.rating * 2 } : {}), ...(verdictReason(verdict) ? { reason: verdictReason(verdict) } : {}) }) });
            const d = await r.json().catch(() => ({}));
            setLearned(r.ok && !d.error ? (d as FeedbackResult) : { note: d.error || 'Sent; the feedback was not saved.' });
            setRate(null);
          } else {
            setRate({ approvalId, before: proposal.message, after: text, step: proposal.situation });
          }
          setProposal(null);
        }
        if (data.sent) { setText(''); setNote(null); }
        else if (data.waiting) { setText(''); setNote({ kind: 'info', text: data.note || 'Held by the send rules; it goes out at the next send window.' }); }
        else throw new Error(data.reason || 'Not sent');
      }
      if (action === 'done' || action === 'reopen') {
        onChanged({ ...thread, state: action === 'done' ? 'done' : (thread.last_from_them ? 'needs_reply' : 'waiting') });
      } else {
        onChanged(data.thread ?? thread);
      }
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  }

  /** Teach from the proposal without sending: the edit so far, the stars and the two lines (draft_teach). */
  async function teach(after: string) {
    if (!thread || !proposal) return;
    setTeaching(true); setTeachErr(null);
    try {
      const r = await fetch('/api/drafts/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before: proposal.message, after, ...(verdict.rating ? { rating: verdict.rating } : {}),
          ...(verdictReason(verdict) ? { reason: verdictReason(verdict) } : {}), ...(thread.prospect_id ? { prospect_id: thread.prospect_id } : {}),
          channel: thread.channel, step: proposal.situation }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Not saved');
      setLearned(d as FeedbackResult);
      return true;
    } catch (e) {
      setTeachErr(e instanceof Error ? e.message : 'Not saved');
      return false;
    } finally {
      setTeaching(false);
    }
  }

  // Day separators between messages.
  const rows: ({ day: string } | { m: InboxMessage })[] = [];
  let last = '';
  for (const m of thread.messages) {
    const d = dayLabel(m.sent_at);
    if (d && d !== last) { rows.push({ day: d }); last = d; }
    rows.push({ m });
  }
  const leadHref = thread.sales_lead_id
    ? `/sales-leads?q=${encodeURIComponent(thread.name || '')}&open=${thread.sales_lead_id}`
    : thread.prospect_id ? `/prospects/${thread.prospect_id}` : null;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b flex items-start gap-3" style={{ borderColor: 'var(--border)' }}>
        <button type="button" onClick={onBack} className="md:hidden mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }} aria-label="Back to the list">←</button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{initials(thread.name)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h2 className="font-semibold truncate">{thread.name || 'Unknown'}</h2>
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              <ChannelIcon channel={thread.channel} size={14} /> {CHANNEL_LABEL[thread.channel]}
            </span>
            {thread.state === 'needs_reply' && <Pill color="var(--orange)">Needs reply</Pill>}
            {thread.state === 'done' && <Pill color="var(--green)">Done</Pill>}
            {thread.campaign_name && <Pill color="var(--blue)">{thread.campaign_name}</Pill>}
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
            {[thread.headline, thread.company, thread.channel === 'email' ? thread.email : null].filter(Boolean).join(' · ')}
          </p>
          {thread.channel === 'email' && thread.subject && (
            <p className="text-xs truncate mt-0.5"><span style={{ color: 'var(--text-muted)' }}>Subject:</span> {thread.subject}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {leadHref && <Button size="sm" href={leadHref}>Open lead</Button>}
          {thread.profile_url && (
            <a href={thread.profile_url} target="_blank" rel="noreferrer" className="px-2.5 py-1 text-xs rounded-lg font-medium" style={{ border: '1px solid var(--border)' }}>Profile ↗</a>
          )}
          {thread.can_reply && (
            <Button size="sm" onClick={() => act('refresh')} disabled={!!busy} title="Read this conversation again now">
              {busy === 'refresh' ? 'Checking…' : 'Refresh'}
            </Button>
          )}
          {thread.state === 'done'
            ? <Button size="sm" onClick={() => act('reopen')} disabled={!!busy}>Reopen</Button>
            : <Button size="sm" onClick={() => act('done')} disabled={!!busy} title="Nothing to answer — move it out of Needs reply">Mark done</Button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 flex flex-col gap-2">
        {!thread.messages.length && (
          <p className="text-sm text-center mt-10" style={{ color: 'var(--text-muted)' }}>No messages stored yet. Press Refresh to read the conversation now.</p>
        )}
        {rows.map((r, i) => ('day' in r
          ? <p key={`d${i}`} className="text-[11px] text-center my-2" style={{ color: 'var(--text-muted)' }}>{r.day}</p>
          : <Bubble key={r.m.id} m={r.m} channel={thread.channel} />))}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
        {note && (
          <p className="text-xs mb-2 p-2 rounded-lg" style={{
            color: note.kind === 'error' ? 'var(--red)' : 'var(--text)',
            background: note.kind === 'error' ? 'color-mix(in srgb, var(--red) 10%, transparent)' : 'var(--bg-input)',
          }}>{note.text}</p>
        )}
        {thread.can_reply ? (
          <>
            {proposal && <ProposalStrip p={proposal} senderFirst={(thread.owner_name || 'your').split(' ')[0]} verdict={verdict} onVerdict={setVerdict}
              onTeach={() => teach(text)} teaching={teaching} learned={learned} error={teachErr}
              onDiscard={async () => {
                if (verdictGiven(verdict) && !learned) await teach(text);
                else if (!learned) setRate({ approvalId: null, before: proposal.message, after: text, step: proposal.situation });
                setProposal(null); setText('');
              }} />}
            {!proposal && learned && (
              <div className="rounded-xl px-3 py-2 mb-2 text-xs flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--green) 8%, transparent)' }}>
                <div className="flex-1"><LearnedLines res={learned} /></div>
                <button type="button" onClick={() => setLearned(null)} className="underline" style={{ color: 'var(--text-muted)' }}>Close</button>
              </div>
            )}
            {rate && <RatingStrip approvalId={rate.approvalId} before={rate.before} after={rate.after} prospectId={thread.prospect_id}
              channel={thread.channel} step={rate.step} senderFirst={(thread.owner_name || 'your').split(' ')[0]} onClose={() => setRate(null)} />}
            <textarea
              ref={boxRef} value={text} onChange={(e) => setText(e.target.value)} rows={2}
              placeholder={thread.channel === 'email' ? `Reply to ${thread.name || 'them'}…` : `Message ${thread.name || 'them'} on LinkedIn…`}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim() && !busy) { e.preventDefault(); act('reply'); } }}
              className="z-input resize-none" style={{ minHeight: 64 }} aria-label="Reply"
            />
            <div className="flex items-center gap-2 mt-2">
              <p className="text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>
                {thread.channel === 'email'
                  ? `From ${thread.mailbox || 'your Gmail'} · in this thread${thread.subject ? ` (Re: ${thread.subject.replace(/^re:\s*/i, '')})` : ''} · your signature is added`
                  : 'From your LinkedIn'} · ⌘/Ctrl + Enter to send
              </p>
              <Button size="sm" onClick={() => act('draft')} disabled={!!busy} title="An AI proposal in your voice, with this conversation as context — you edit and send">
                <span className="inline-flex items-center gap-1"><Sparkle width={12} height={12} />{busy === 'draft' ? 'Drafting…' : proposal ? 'Draft again' : 'Draft reply'}</span>
              </Button>
              <Button variant="primary" onClick={() => act('reply')} disabled={!text.trim() || !!busy}>
                {busy === 'reply' ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{thread.reply_note}</p>
        )}
      </div>
    </div>
  );
}
