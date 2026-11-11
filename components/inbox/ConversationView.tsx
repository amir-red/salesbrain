'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/panel/Button';
import { Pill } from '@/components/panel/PageHeader';
import type { InboxMessage, InboxThread, ReplyTarget } from '@/lib/inbox';
import { channelLabel, initials, parseKey, threadKey } from '@/lib/inbox';

/** A written proposal is kept in this browser (with your edits) until it is sent or discarded, so opening the
 *  conversation again shows it at once instead of drafting a second time. A new message in the thread drops it. */
const DRAFT_STORE = 'inbox.drafts';
type StoredDraft = { lastId: string | null; proposal: InboxProposal; text: string; at: string };
function readDrafts(): Record<string, StoredDraft> {
  try { return JSON.parse(localStorage.getItem(DRAFT_STORE) || '{}') as Record<string, StoredDraft>; } catch { return {}; }
}
function loadDraft(key: string, lastId: string | null): StoredDraft | null {
  const d = readDrafts()[key];
  return d && d.lastId === lastId ? d : null;
}
function saveDraft(key: string, d: StoredDraft | null) {
  try {
    const all = readDrafts();
    if (d) all[key] = d; else delete all[key];
    // keep the store small: newest 40 drafts
    const keys = Object.keys(all).sort((a, b) => (all[b].at || '').localeCompare(all[a].at || '')).slice(40);
    for (const k of keys) delete all[k];
    localStorage.setItem(DRAFT_STORE, JSON.stringify(all));
  } catch { /* storage unavailable: the draft just is not remembered */ }
}
import ChannelIcon from './ChannelIcon';
import { EMPTY_VERDICT, ProposalStrip, RatingStrip, verdictGiven, verdictReason, type InboxProposal, type Verdict } from './InboxDraft';
import { LearnedLines } from '@/components/voice/DraftReview';
import type { FeedbackResult } from '@/lib/voice';
import { Sparkle } from '@/components/icons';
import PlanPanel, { planLine } from './PlanPanel';
import ResearchPanel from './ResearchPanel';
import { AttachButton, AttachmentChips, MessageFiles, dropProps, useAttachments } from './Attachments';
import type { PlanSummary } from '@/lib/inbox';

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

/** One message. The footer carries the channel it came through — a person's conversation mixes them. */
function Bubble({ m }: { m: InboxMessage }) {
  return (
    <div className={`flex ${m.from_me ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm"
        style={{
          background: m.from_me ? 'var(--accent-soft)' : 'var(--bg-input)',
          borderBottomRightRadius: m.from_me ? 6 : undefined, borderBottomLeftRadius: m.from_me ? undefined : 6,
          opacity: m.pending ? 0.75 : 1,
        }}>
        {m.sender_name && !m.from_me && (
          <p className="text-[11px] mb-1 truncate font-medium" style={{ color: 'var(--text-muted)' }}>{m.sender_name}</p>
        )}
        {m.channel === 'email' && m.from && !m.from_me && (
          <p className="text-[11px] mb-1 truncate" style={{ color: 'var(--text-muted)' }}>{m.from}</p>
        )}
        {m.channel === 'email' && (m.to || m.cc) && (
          <p className="text-[11px] mb-1 truncate" style={{ color: 'var(--text-muted)' }}
            title={[m.to && `To: ${m.to}`, m.cc && `Cc: ${m.cc}`].filter(Boolean).join('\n')}>
            {m.to && <>to {m.to}</>}{m.to && m.cc && ' · '}{m.cc && <>cc {m.cc}</>}
          </p>
        )}
        {m.text ? <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
          : !m.attachments?.length ? <p><em style={{ color: 'var(--text-muted)' }}>(no text)</em></p> : null}
        <MessageFiles files={m.attachments} mine={m.from_me} />
        <p className="text-[10px] mt-1 flex items-center justify-end gap-1" style={{ color: 'var(--text-muted)' }}
          title={channelLabel(m)}>
          <ChannelIcon channel={m.channel} app={m.app} size={11} />
          {m.pending ? 'Waiting to be sent' : `${m.sender_unknown ? 'sender not shown · ' : ''}${m.read_time ? 'read ' : ''}${time(m.sent_at)}`}
        </p>
      </div>
    </div>
  );
}

/** The line a reply goes out on, for one target. */
function fromLine(t: ReplyTarget): string {
  return `${t.channel === 'email'
    ? `From ${t.mailbox || 'your Gmail'} · in this thread${t.subject ? ` (Re: ${t.subject.replace(/^re:\s*/i, '')})` : ''} · your signature is added`
    : `From your ${t.label}`} · ⌘/Ctrl + Enter to send`;
}

/** The right side: who it is, the whole conversation across channels, and the reply box (only on your own account). */
type CleanupAction = 'delete' | 'spam' | 'optout';
/** The More menu (core 107, Amir 2026-11-11). */
const CLEANUP: { action: CleanupAction; label: string; hint: string; confirm?: (name: string) => string }[] = [
  { action: 'delete', label: 'Delete', hint: 'Gone from the Inbox (and Gmail\'s Bin). Comes back if they write again.' },
  { action: 'spam', label: 'Mark as spam', hint: 'Gone for good (and Gmail\'s Spam). Never contacted again.',
    confirm: (n) => `Mark ${n} as spam? The conversation leaves the Inbox, their later mail lands as spam, and nobody on the team can contact them.` },
  { action: 'optout', label: 'Opt out — never contact them', hint: 'Keeps the conversation; no campaign, agent or teammate ever writes to them.',
    confirm: (n) => `Never contact ${n} again? Their open drafts are dropped, their leads are archived, and every send to them is refused, on every channel.` },
];

export default function ConversationView({ thread, loading, onBack, onChanged }: {
  thread: InboxThread | null; loading: boolean; onBack: () => void; onChanged: (t: InboxThread | null) => void;
}) {
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<InboxProposal | null>(null);   // the AI draft in the box, until sent or dropped
  const [rate, setRate] = useState<{ approvalId: string | null; before: string; after: string; step: 'reply' | 'followup' | 'first' } | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(EMPTY_VERDICT);        // stars + right / wrong, filled while reviewing
  const [learned, setLearned] = useState<FeedbackResult | null>(null);   // what the last Save / Send taught
  const [teaching, setTeaching] = useState(false);
  const [teachErr, setTeachErr] = useState<string | null>(null);
  const autoDrafted = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);   // the "No reply needed" panel (core 103)
  // The research column beside the conversation (2026-11-10): open by default, the choice remembered per browser.
  const [research, setResearchState] = useState(true);
  useEffect(() => { try { if (localStorage.getItem('inbox.research') === '0') setResearchState(false); } catch { /* ignore */ } }, []);
  const setResearch = (on: boolean) => { setResearchState(on); try { localStorage.setItem('inbox.research', on ? '1' : '0'); } catch { /* ignore */ } };
  const att = useAttachments();                        // files going out with the reply (core 104)
  // Which thread a reply goes into (2026-11-09): a person's conversation offers one target per channel thread; the
  // default is where they last wrote and we can answer. Chosen per conversation, reset when another one opens.
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const convKey = thread ? (thread.key || threadKey(thread)) : '';
  const targets: ReplyTarget[] = useMemo(() => (thread?.targets?.length ? thread.targets : thread ? [{
    channel: thread.channel, id: thread.id, app: thread.app ?? null, label: channelLabel(thread), can_reply: thread.can_reply,
    copy_only: !thread.can_reply && thread.channel === 'chat' && !!thread.mine, reply_note: thread.reply_note,
    last_from_them: thread.last_from_them, last_message_at: thread.last_message_at, state: thread.state, plan: thread.plan ?? null,
    mailbox: thread.mailbox, subject: thread.subject, open_url: thread.open_url ?? null, profile_url: thread.profile_url, mine: !!thread.mine,
  }] : []), [thread]);
  const cur: ReplyTarget | null = targets.find((t) => threadKey(t) === targetKey) ?? targets.find((t) => threadKey(t) === thread?.default_target) ?? targets[0] ?? null;
  // the draft key is the TARGET thread: a proposal written for LinkedIn is not the email's
  const key = cur ? threadKey(cur) : '';
  // Your own chat that cannot be sent from here (iMessage, WhatsApp read through the Zeami link): draft, copy, send in the app.
  const copyOnly = !!cur && cur.copy_only;
  const canReply = !!cur && cur.can_reply;
  const grouped = !!thread && parseKey(convKey)?.kind !== 'thread';

  const lastId = thread?.messages.length ? thread.messages[thread.messages.length - 1].id : null;
  const restored = useRef(false);

  useEffect(() => { setTargetKey(null); att.clear(); }, [convKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setNote(null); setRate(null); setVerdict(EMPTY_VERDICT); setLearned(null); setTeachErr(null); setPlanOpen(false);
    // a proposal written earlier for this conversation (and the edits made to it) comes back as it was
    const kept = key ? loadDraft(key, lastId) : null;
    setProposal(kept ? kept.proposal : null); setText(kept ? kept.text : '');
    restored.current = !!kept;
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  // A conversation that needs an answer drafts by itself when it opens — once; afterwards the kept draft is shown.
  useEffect(() => {
    if (!thread || !cur || !(canReply || copyOnly) || cur.state !== 'needs_reply' || !cur.last_from_them || cur.plan) return;
    if (restored.current || autoDrafted.current.has(key) || proposal || text.trim()) return;
    if (loadDraft(key, lastId)) return;
    autoDrafted.current.add(key);
    act('draft');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, canReply, cur?.state]);
  // edits to the proposal are remembered with it
  useEffect(() => {
    if (!key || !proposal) return;
    saveDraft(key, { lastId, proposal, text, at: new Date().toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, proposal, text]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [convKey, thread?.messages.length]);
  useEffect(() => {
    const el = boxRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 220)}px`; }
  }, [text]);

  if (loading && !thread) {
    return <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  }
  if (!thread || !cur) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-8">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ color: 'var(--text-muted)' }}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <p className="mt-3 text-sm font-medium">Pick a conversation</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Read it and answer from here — the reply goes out from your own LinkedIn, Gmail or WhatsApp.</p>
      </div>
    );
  }

  /** `asIs` = send the AI's own text, untouched (the Before column's button). Replies, drafts and refreshes go to the
   *  TARGET thread; done / reopen to the whole person. */
  async function act(action: 'reply' | 'done' | 'reopen' | 'refresh' | 'draft', asIs = false) {
    if (!thread || !cur) return;
    const out = asIs && proposal ? proposal.message : text;
    if (action === 'reply' && att.uploading) { setNote({ kind: 'info', text: 'A file is still uploading — send when it is done.' }); return; }
    setBusy(asIs ? 'reply-asis' : action); setNote(null);
    try {
      const url = (action === 'done' || action === 'reopen') && grouped
        ? `/api/inbox/person/${encodeURIComponent(convKey)}` : `/api/inbox/${cur.channel}/${cur.id}`;
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reply'
          ? { action, text: out, ...(proposal ? { voice: proposal.voice } : {}), ...(att.ids.length ? { file_ids: att.ids } : {}) }
          : { action }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || data.reason || 'Something went wrong');
      if (action === 'draft') {
        setProposal({ message: data.message, reasoning: data.reasoning ?? null, used_facts: data.used_facts ?? [], voice: data.voice,
          situation: data.situation === 'followup' ? 'followup' : 'reply', priorities: data.priorities ?? [] });
        if (data.planned) setNote({ kind: 'info', text: `Drafted for the follow-up you planned: ${data.planned}` });
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
            setRate({ approvalId, before: proposal.message, after: out, step: proposal.situation });
          }
          setProposal(null); saveDraft(key, null);
        }
        if (data.sent) { setText(''); att.clear(); setNote(null); }
        else if (data.waiting) { setText(''); att.clear(); setNote({ kind: 'info', text: data.note || 'Held by the send rules; it goes out at the next send window.' }); }
        else throw new Error(data.reason || 'Not sent');
      }
      if (action === 'done' || action === 'reopen') {
        const next = (them: boolean) => (action === 'done' ? 'done' : them ? 'needs_reply' : 'waiting') as InboxThread['state'];
        onChanged({ ...thread, state: next(thread.last_from_them),
          threads: thread.threads.map((t) => ({ ...t, state: next(t.last_from_them) })),
          targets: thread.targets.map((t) => ({ ...t, state: next(t.last_from_them) })) });
      } else {
        onChanged(data.thread ?? thread);
      }
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  }

  /** Delete / Mark as spam / Opt out (core 107) on the viewer's own threads of this person. Delete and spam also move
   *  an email thread in Gmail when the connection has the permission; otherwise the result says to reconnect. */
  async function cleanup(action: CleanupAction) {
    if (!thread) return;
    setMenuOpen(false);
    const c = CLEANUP.find((x) => x.action === action)!;
    if (c.confirm && !window.confirm(c.confirm(thread.name || 'this person'))) return;
    setBusy(action); setNote(null);
    try {
      const res = await fetch(`/api/inbox/person/${encodeURIComponent(convKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong');
      const lines: string[] = [];
      if (data.needs_reconnect?.length) {
        lines.push(`Cleared here, but Gmail was not changed: reconnect Google on Profile → Google to let SalesBrain ${action === 'spam' ? 'mark mail as spam' : 'delete mail'} in Gmail.`);
      }
      if (data.errors?.length) lines.push(data.errors[0]);
      if (action === 'optout') {
        const n = data.prospects_archived ? ` ${data.prospects_archived} lead${data.prospects_archived > 1 ? 's' : ''} archived.` : '';
        setNote({ kind: 'info', text: `${thread.name || 'They'} will never be contacted again, on any channel.${n} ${lines.join(' ')}`.trim() });
        onChanged({ ...thread, state: 'done', threads: thread.threads.map((t) => ({ ...t, state: 'done' })),
          targets: thread.targets.map((t) => ({ ...t, state: 'done' })) });
        return;
      }
      if (lines.length) window.alert(lines.join('\n\n'));
      onChanged(null);
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  }

  /** A chat that cannot be sent from here (iMessage, the Zeami link): the text is copied, the app opened when there
   *  is a link, and the edit / rating teach the voice like a send would (draft_teach). */
  async function copyOut(asIs: boolean) {
    if (!thread || !cur || !proposal) return;
    const out = asIs ? proposal.message : text;
    try { await navigator.clipboard.writeText(out); } catch { setNote({ kind: 'error', text: 'Could not copy — select the text and copy it yourself.' }); return; }
    if (cur.open_url) window.open(cur.open_url, '_blank', 'noopener');
    if (!learned && (verdictGiven(verdict) || out.trim() !== proposal.message.trim())) await teach(out);
    else if (!learned) setRate({ approvalId: null, before: proposal.message, after: out, step: proposal.situation });
    setProposal(null); setText(''); saveDraft(key, null);
    setNote({ kind: 'info', text: `Copied — paste it in ${cur.label} and send it there.` });
  }

  /** Teach from the proposal without sending: the edit so far, the stars and the two lines (draft_teach). */
  async function teach(after: string) {
    if (!thread || !cur || !proposal) return;
    setTeaching(true); setTeachErr(null);
    try {
      const r = await fetch('/api/drafts/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before: proposal.message, after, ...(verdict.rating ? { rating: verdict.rating } : {}),
          ...(verdictReason(verdict) ? { reason: verdictReason(verdict) } : {}), ...(thread.prospect_id ? { prospect_id: thread.prospect_id } : {}),
          channel: cur.channel, step: proposal.situation }) });
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

  // Day separators between messages; when the person is on several channels, a "via …" line wherever it changes.
  const mixed = new Set(thread.messages.map((m) => `${m.channel}:${m.app ?? ''}`)).size > 1;
  const rows: ({ day: string } | { via: InboxMessage } | { m: InboxMessage })[] = [];
  let last = '';
  let lastCh = '';
  for (const m of thread.messages) {
    const d = dayLabel(m.sent_at);
    if (d && d !== last) { rows.push({ day: d }); last = d; }
    const ch = `${m.channel}:${m.app ?? ''}`;
    if (mixed && ch !== lastCh) { rows.push({ via: m }); lastCh = ch; }
    rows.push({ m });
  }
  const leadHref = thread.sales_lead_id
    ? `/sales-leads?q=${encodeURIComponent(thread.name || '')}&open=${thread.sales_lead_id}`
    : thread.prospect_id ? `/prospects/${thread.prospect_id}` : null;
  const emailTarget = targets.find((t) => t.channel === 'email');
  // Pills: every non-email thread, email threads that need a reply, the newest email thread, and the chosen one;
  // a person with many email threads keeps the rest in a select.
  const emails = targets.filter((t) => t.channel === 'email');
  const pills = targets.filter((t) => t.channel !== 'email' || t.state === 'needs_reply' || t === emails[0] || threadKey(t) === key);
  const moreEmail = emails.filter((t) => !pills.includes(t));
  const marks = targets.filter((t, i) => targets.findIndex((x) => x.channel === t.channel && (x.app ?? '') === (t.app ?? '')) === i);
  const subjectOf = (t: ReplyTarget | undefined) => (t?.channel === 'email' && t.subject ? t.subject : null);
  const viaLabel = (m: InboxMessage) => {
    const s = subjectOf(targets.find((x) => x.id === m.thread_id));
    return `via ${channelLabel(m)}${s ? ` · ${s}` : ''}`;
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b flex items-start gap-3" style={{ borderColor: 'var(--border)' }}>
        <button type="button" onClick={onBack} className="md:hidden mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }} aria-label="Back to the list">←</button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{initials(thread.name)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h2 className="font-semibold truncate">{thread.name || 'Unknown'}</h2>
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}
              title={marks.length > 1 ? `One conversation across ${marks.map((t) => t.label).join(', ')}` : undefined}>
              {marks.map((t) => <ChannelIcon key={threadKey(t)} channel={t.channel} app={t.app} size={14} />)}
              {marks.length === 1 ? marks[0].label : `${marks.length} channels`}
            </span>
            {thread.state === 'needs_reply' && <Pill color="var(--orange)">Needs reply</Pill>}
            {thread.threads.some((t) => t.channel === 'email' && t.cc_only && t.last_from_them) && (
              <span title="Their latest email was written to someone else — you were only copied, so it does not wait for your reply.">
                <Pill color="var(--text-muted)">You&apos;re in Cc</Pill>
              </span>
            )}
            {thread.state === 'done' && !thread.plan && <Pill color="var(--green)">Done</Pill>}
            {thread.plan && (
              <button type="button" onClick={() => setPlanOpen(true)} title="The plan you set on this conversation — click to see or change it">
                <Pill color={thread.plan.decision === 'leave' ? 'var(--text-muted)' : 'var(--blue)'}>{planLine(thread.plan)}</Pill>
              </button>
            )}
            {thread.campaign_name && <Pill color="var(--blue)">{thread.campaign_name}</Pill>}
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
            {[thread.headline, thread.company, thread.email].filter(Boolean).join(' · ')}
          </p>
          {!mixed && subjectOf(cur) && (
            <p className="text-xs truncate mt-0.5"><span style={{ color: 'var(--text-muted)' }}>Subject:</span> {subjectOf(cur)}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {(thread.prospect_id || thread.person_id) && (
            <Button size="sm" onClick={() => setResearch(!research)} title={research ? 'Hide the research about this person' : 'Show who they are, what changed, what is open — before you write'}>
              <span style={{ color: research ? 'var(--accent)' : undefined }}>Research</span>
            </Button>
          )}
          {leadHref && <Button size="sm" href={leadHref}>Open lead</Button>}
          {thread.profile_url && (
            <a href={thread.profile_url} target="_blank" rel="noreferrer" className="px-2.5 py-1 text-xs rounded-lg font-medium" style={{ border: '1px solid var(--border)' }}>Profile ↗</a>
          )}
          {(cur.channel === 'chat' || cur.channel === 'email') && cur.open_url && (
            <a href={cur.open_url} target="_blank" rel="noreferrer" className="px-2.5 py-1 text-xs rounded-lg font-medium" style={{ border: '1px solid var(--border)' }}>
              Open in {cur.channel === 'email' ? 'Gmail' : cur.label} ↗
            </a>
          )}
          {cur.channel !== 'email' && emailTarget?.open_url && (
            <a href={emailTarget.open_url} target="_blank" rel="noreferrer" className="px-2.5 py-1 text-xs rounded-lg font-medium" style={{ border: '1px solid var(--border)' }}>Open in Gmail ↗</a>
          )}
          {(canReply || (cur.channel === 'chat' && cur.mine)) && (
            <Button size="sm" onClick={() => act('refresh')} disabled={!!busy} title={`Read the ${cur.label} conversation again now`}>
              {busy === 'refresh' ? 'Checking…' : 'Refresh'}
            </Button>
          )}
          {(canReply || cur.mine) && (
            <Button size="sm" onClick={() => setPlanOpen((v) => !v)} disabled={!!busy}
              title={`No reply needed on ${cur.label}: set follow-ups with a reason, or leave it with a reason — the system learns from it`}>
              {cur.plan ? 'Plan' : 'No reply needed'}
            </Button>
          )}
          {thread.state === 'done'
            ? <Button size="sm" onClick={() => act('reopen')} disabled={!!busy}>Reopen</Button>
            : <Button size="sm" onClick={() => act('done')} disabled={!!busy} title={targets.length > 1 ? 'Nothing to answer on any channel — move it out of Needs reply' : 'Nothing to answer — move it out of Needs reply'}>Mark done</Button>}
          {thread.targets.some((t) => t.mine) && (
            <div className="relative">
              <Button size="sm" onClick={() => setMenuOpen((v) => !v)} disabled={!!busy} aria-haspopup="menu" aria-expanded={menuOpen}
                title="Delete, mark as spam, or never contact them">More ▾</Button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 top-full mt-1 z-20 w-64 rounded-xl p-1 text-sm shadow-lg"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  {CLEANUP.map((c) => (
                    <button key={c.action} type="button" role="menuitem" onClick={() => cleanup(c.action)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--bg-input)]">
                      <span className="font-medium" style={{ color: c.action === 'delete' ? 'var(--text)' : 'var(--red)' }}>{c.label}</span>
                      <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{c.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 flex flex-col gap-2">
        {!thread.messages.length && (
          <p className="text-sm text-center mt-10" style={{ color: 'var(--text-muted)' }}>No messages stored yet. Press Refresh to read the conversation now.</p>
        )}
        {thread.source_note && (
          <p className="text-[11px] text-center mb-1" style={{ color: 'var(--text-muted)' }}>{thread.source_note}</p>
        )}
        {rows.map((r, i) => ('day' in r
          ? <p key={`d${i}`} className="text-[11px] text-center my-2" style={{ color: 'var(--text-muted)' }}>{r.day}</p>
          : 'via' in r
            ? <p key={`v${i}`} className="text-[10px] inline-flex items-center gap-1 self-center px-2 py-0.5 rounded-full" style={{ color: 'var(--text-muted)', background: 'var(--bg-input)' }}>
                <ChannelIcon channel={r.via.channel} app={r.via.app} size={11} /> {viaLabel(r.via)}
              </p>
            : <Bubble key={r.m.id} m={r.m} />))}
        <div ref={endRef} />
      </div>

      {planOpen && (
        <PlanPanel thread={cur} onClose={() => setPlanOpen(false)}
          onSaved={(state, plan: PlanSummary | null) => {
            setPlanOpen(false);
            const targetsNext = thread.targets.map((t) => (threadKey(t) === key ? { ...t, state, plan } : t));
            const threadsNext = thread.threads.map((t) => (threadKey(t) === key ? { ...t, state, plan } : t));
            const states = threadsNext.length ? threadsNext.map((t) => t.state) : [state];
            onChanged({ ...thread, targets: targetsNext, threads: threadsNext,
              state: states.includes('needs_reply') ? 'needs_reply' : states.includes('waiting') ? 'waiting' : state,
              plan: threadsNext.find((t) => t.plan)?.plan ?? (threadsNext.length ? null : plan) });
          }} />
      )}

      {/* At most 45% of the height (2026-11-11, Amir: "I can barely see the prior conversation"): the conversation keeps the room. */}
      <div className="border-t p-3 max-h-[45vh] overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
        {note && (
          <p className="text-xs mb-2 p-2 rounded-lg" style={{
            color: note.kind === 'error' ? 'var(--red)' : 'var(--text)',
            background: note.kind === 'error' ? 'color-mix(in srgb, var(--red) 10%, transparent)' : 'var(--bg-input)',
          }}>{note.text}</p>
        )}
        {targets.length > 1 && (
          <div className="flex items-center gap-1.5 mb-2 flex-wrap" role="radiogroup" aria-label="Answer on">
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Answer on</span>
            {pills.map((t) => {
              const k = threadKey(t);
              const on = k === key;
              const usable = t.can_reply || t.copy_only;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setTargetKey(k)}
                  title={usable ? `${t.label}${t.last_from_them ? ' · they wrote last here' : ''}${t.copy_only ? ' · copy and send in the app' : ''}` : (t.reply_note || `${t.label}: not from here`)}
                  className="h-7 px-2 rounded-full text-xs font-medium inline-flex items-center gap-1.5"
                  style={{ background: on ? 'var(--accent-glow)' : 'transparent', color: on ? 'var(--accent)' : usable ? 'var(--text)' : 'var(--text-muted)',
                    border: `1px solid ${on ? 'transparent' : 'var(--border)'}`, opacity: usable ? 1 : 0.6 }}>
                  <ChannelIcon channel={t.channel} app={t.app} size={13} />
                  {t.label}{t.channel === 'email' && t.subject ? <span className="truncate max-w-[160px] font-normal" style={{ color: 'var(--text-muted)' }}>· {t.subject}</span> : null}
                  {t.state === 'needs_reply' && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--orange)' }} aria-label="needs reply" />}
                </button>
              );
            })}
            {moreEmail.length > 0 && (
              <select value={moreEmail.some((t) => threadKey(t) === key) ? key : ''} onChange={(e) => { if (e.target.value) setTargetKey(e.target.value); }}
                className="z-input !w-auto !h-7 !py-0 text-xs" aria-label="Other email threads" title="Older email threads with this person">
                <option value="">{`${moreEmail.length} older email thread${moreEmail.length > 1 ? 's' : ''}…`}</option>
                {moreEmail.map((t) => <option key={threadKey(t)} value={threadKey(t)}>{t.subject || '(no subject)'}{t.last_message_at ? ` · ${new Date(t.last_message_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}</option>)}
              </select>
            )}
          </div>
        )}
        {canReply || copyOnly ? (
          <>
            {/* While an AI proposal is open it IS the reply area (2026-11-06): edit in After, send from either column. */}
            {copyOnly && !proposal && (
              <div className="flex items-center gap-2">
                <p className="text-[11px] flex-1" style={{ color: 'var(--text-muted)' }}>{cur.reply_note}</p>
                <Button size="sm" onClick={() => act('draft')} disabled={!!busy} title="An AI proposal in your voice, with this conversation as context — you edit, copy and send it in the app">
                  <span className="inline-flex items-center gap-1"><Sparkle width={12} height={12} />{busy === 'draft' ? 'Drafting…' : 'Draft reply'}</span>
                </Button>
              </div>
            )}
            {proposal ? (
              <ProposalStrip p={proposal} after={text} onAfter={setText} senderFirst={(thread.owner_name || 'your').split(' ')[0]}
                verdict={verdict} onVerdict={setVerdict} onTeach={() => teach(text)} teaching={teaching} learned={learned} error={teachErr}
                onSendAsIs={() => (copyOnly ? copyOut(true) : act('reply', true))} onSend={() => (copyOnly ? copyOut(false) : act('reply'))}
                onRedraft={() => act('draft')} busy={busy}
                copyOnly={copyOnly} openUrl={cur.open_url ?? null} openLabel={cur.label}
                fromLine={fromLine(cur)}
                onDiscard={async () => {
                  if (verdictGiven(verdict) && !learned) await teach(text);
                  else if (!learned) setRate({ approvalId: null, before: proposal.message, after: text, step: proposal.situation });
                  setProposal(null); setText(''); saveDraft(key, null);
                }} />
            ) : copyOnly ? null : (
              <div {...dropProps(att.add, true)}>
                <textarea
                  ref={boxRef} value={text} onChange={(e) => setText(e.target.value)} rows={2}
                  placeholder={cur.channel === 'email' ? `Reply to ${thread.name || 'them'} by email…` : `Message ${thread.name || 'them'} on ${cur.label}…`}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && (text.trim() || att.count) && !busy && !att.uploading) { e.preventDefault(); act('reply'); } }}
                  className="z-input resize-none" style={{ minHeight: 64 }} aria-label="Reply"
                />
                <AttachmentChips files={att.files} onRemove={att.remove} />
                <div className="flex items-center gap-2 mt-2">
                  <AttachButton onPick={att.add} disabled={!!busy} compact />
                  <p className="text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>{fromLine(cur)}</p>
                  <Button size="sm" onClick={() => act('draft')} disabled={!!busy} title="An AI proposal in your voice, with this conversation as context — you edit and send">
                    <span className="inline-flex items-center gap-1"><Sparkle width={12} height={12} />{busy === 'draft' ? 'Drafting…' : 'Draft reply'}</span>
                  </Button>
                  <Button variant="primary" onClick={() => act('reply')} disabled={(!text.trim() && !att.count) || !!busy || att.uploading}>
                    {busy === 'reply' ? 'Sending…' : att.uploading ? 'Uploading…' : 'Send'}
                  </Button>
                </div>
              </div>
            )}
            {proposal && !copyOnly && (
              <div className="flex items-center gap-2 mt-2 flex-wrap" {...dropProps(att.add, true)}>
                <AttachButton onPick={att.add} disabled={!!busy} />
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {att.count ? `${att.count} file${att.count > 1 ? 's' : ''} go${att.count > 1 ? '' : 'es'} out with the reply` : 'Files go out with the reply'}
                </span>
                <div className="w-full"><AttachmentChips files={att.files} onRemove={att.remove} /></div>
              </div>
            )}
            {!proposal && learned && (
              <div className="rounded-xl px-3 py-2 mt-3 text-xs flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--green) 8%, transparent)' }}>
                <div className="flex-1"><LearnedLines res={learned} /></div>
                <button type="button" onClick={() => setLearned(null)} className="underline" style={{ color: 'var(--text-muted)' }}>Close</button>
              </div>
            )}
            {rate && <RatingStrip approvalId={rate.approvalId} before={rate.before} after={rate.after} prospectId={thread.prospect_id}
              channel={cur.channel === 'chat' ? 'whatsapp' : cur.channel} step={rate.step} senderFirst={(thread.owner_name || 'your').split(' ')[0]} onClose={() => setRate(null)} />}
          </>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{cur.reply_note}</p>
        )}
      </div>
      </div>
      {research && (thread.prospect_id || thread.person_id) && (
        <div className="hidden lg:flex min-h-0">
          <ResearchPanel prospectId={thread.prospect_id} personId={thread.person_id} name={thread.name} onClose={() => setResearch(false)} />
        </div>
      )}
      </div>
    </div>
  );
}
