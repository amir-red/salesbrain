'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Button from '@/components/panel/Button';
import { Pill } from '@/components/panel/PageHeader';
import { LinkedIn, Mail, Sparkle } from '@/components/icons';
import type { ComposeFacts } from '@/lib/inbox-compose-server';
import type { FeedbackResult } from '@/lib/voice';
import { LearnedLines } from '@/components/voice/DraftReview';
import { EMPTY_VERDICT, ProposalStrip, RatingStrip, verdictGiven, verdictReason, type InboxProposal, type Verdict } from './InboxDraft';

type Channel = 'linkedin' | 'email';

/**
 * Compose (2026-11-09): "Write message" on a person page opens the Inbox here. The viewer writes from THEIR OWN
 * account — a LinkedIn first message when they own the lead and are connected, an email from their default Gmail
 * when we hold an address. Draft with AI proposes it in their voice (the same Before / After review as a reply);
 * Send sends it now through the send gate, and the new conversation opens in the Inbox. Nothing goes out on behalf
 * of someone else: a lead held by a teammate gets a note, and a connection request is filed for the owner's approval.
 */
export default function ComposeView({ prospectId, onBack, onOpen }: { prospectId: string; onBack: () => void; onOpen: (key: string) => void }) {
  const [f, setF] = useState<ComposeFacts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>('linkedin');
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [proposal, setProposal] = useState<InboxProposal | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(EMPTY_VERDICT);
  const [learned, setLearned] = useState<FeedbackResult | null>(null);
  const [teaching, setTeaching] = useState(false);
  const [teachErr, setTeachErr] = useState<string | null>(null);
  const [rate, setRate] = useState<{ approvalId: string | null; before: string; after: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/inbox/compose?prospect=${prospectId}`);
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Could not load');
      setF(d as ComposeFacts); setErr(null);
      const facts = d as ComposeFacts;
      // a conversation of yours already exists: open it instead of writing a second first message
      if (facts.open) { onOpen(facts.open); return; }
      setChannel(facts.linkedin.mode === 'first_message' ? 'linkedin' : facts.email.mode === 'ok' ? 'email' : 'linkedin');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [prospectId, onOpen]);
  useEffect(() => { void load(); }, [load]);

  const lane = f ? (channel === 'linkedin' ? f.linkedin : f.email) : null;
  const canSend = !!f && (channel === 'linkedin' ? f.linkedin.mode === 'first_message' : f.email.mode === 'ok');
  const first = (f?.person.name || '').split(' ')[0] || 'them';

  async function draft() {
    setBusy('draft'); setNote(null);
    try {
      const res = await fetch('/api/inbox/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draft', prospect_id: prospectId, channel }) });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Could not draft');
      setProposal({ message: d.message, reasoning: d.reasoning ?? null, used_facts: d.used_facts ?? [], voice: d.voice, situation: 'first', priorities: d.priorities ?? [] });
      setText(d.message); if (d.subject && !subject.trim()) setSubject(d.subject);
      setVerdict(EMPTY_VERDICT); setLearned(null); setTeachErr(null); setRate(null);
    } catch (e) { setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function teach(after: string) {
    if (!proposal) return false;
    setTeaching(true); setTeachErr(null);
    try {
      const r = await fetch('/api/drafts/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before: proposal.message, after, ...(verdict.rating ? { rating: verdict.rating } : {}),
          ...(verdictReason(verdict) ? { reason: verdictReason(verdict) } : {}), prospect_id: prospectId, channel, step: 'first' }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Not saved');
      setLearned(d as FeedbackResult);
      return true;
    } catch (e) { setTeachErr(e instanceof Error ? e.message : 'Not saved'); return false; }
    finally { setTeaching(false); }
  }

  async function send(asIs = false) {
    const out = asIs && proposal ? proposal.message : text;
    if (!out.trim()) return;
    setBusy(asIs ? 'send-asis' : 'send'); setNote(null);
    try {
      const res = await fetch('/api/inbox/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', prospect_id: prospectId, channel, text: out, subject, ...(proposal ? { voice: proposal.voice } : {}) }) });
      const d = await res.json();
      if (!res.ok || d.error) {
        if (d.open) { onOpen(d.open); return; }
        throw new Error(d.error || d.reason || 'Not sent');
      }
      const approvalId = typeof d.approval_id === 'string' ? d.approval_id : null;
      if (proposal) {
        if (approvalId && verdictGiven(verdict)) {
          const r = await fetch(`/api/drafts/${approvalId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'feedback', ...(verdict.rating ? { rating: verdict.rating * 2 } : {}), ...(verdictReason(verdict) ? { reason: verdictReason(verdict) } : {}) }) });
          const dd = await r.json().catch(() => ({}));
          setLearned(r.ok && !dd.error ? (dd as FeedbackResult) : { note: dd.error || 'Sent; the feedback was not saved.' });
        } else {
          setRate({ approvalId, before: proposal.message, after: out });
        }
        setProposal(null);
      }
      if (d.sent) {
        setText('');
        setNote({ kind: 'info', text: `Sent from your ${channel === 'linkedin' ? 'LinkedIn' : (d.mailbox || 'Gmail')}.` });
        if (d.open) setTimeout(() => onOpen(d.open), 1200);
      } else if (d.waiting) {
        setText(''); setNote({ kind: 'info', text: d.note || 'Held by the send rules; it goes out at the next send window.' });
      } else {
        throw new Error(d.reason || 'Not sent');
      }
    } catch (e) { setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function connect() {
    setBusy('connect'); setNote(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Could not file the request');
      const who = d.acted_as?.name ?? f?.owner.name ?? 'the owner';
      setNote({ kind: 'info', text: d.duplicate ? `A request already waits for ${who}'s approval.` : `Connection request filed for ${who}'s approval — nothing was sent yet.` });
      await load();
    } catch (e) { setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  if (err) return <div className="h-full flex items-center justify-center text-sm px-8 text-center" style={{ color: 'var(--red)' }}>{err}</div>;
  if (!f) return <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>;

  const tab = (c: Channel, label: string, Icon: typeof LinkedIn, ok: boolean) => (
    <button type="button" onClick={() => { setChannel(c); setProposal(null); setText(''); setNote(null); }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
      style={{ background: channel === c ? 'var(--accent)' : 'transparent', color: channel === c ? 'var(--accent-fg)' : ok ? 'var(--text)' : 'var(--text-muted)', border: `1px solid ${channel === c ? 'var(--accent)' : 'var(--border)'}` }}>
      <Icon width={13} height={13} />{label}{!ok && <span className="opacity-70">· not ready</span>}
    </button>
  );
  const fromLine = channel === 'email'
    ? `From ${f.email.mailbox || 'your Gmail'} to ${f.email.address || '—'} · your signature is added · ⌘/Ctrl + Enter to send`
    : `From your LinkedIn (${f.linkedin.account || 'your account'}) · a new conversation · ⌘/Ctrl + Enter to send`;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b flex items-start gap-3" style={{ borderColor: 'var(--border)' }}>
        <button type="button" onClick={onBack} className="md:hidden mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }} aria-label="Back to the list">←</button>
        <Avatar name={f.person.name} src={f.person.picture_url} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold truncate">{f.person.name || 'Unknown'}</h2>
            <Pill color="var(--blue)">New message</Pill>
            {!f.owner.is_viewer && f.owner.name && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>lead held by {f.owner.name}</span>}
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{[f.person.title, f.person.company, f.person.location].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button size="sm" href={`/prospects/${prospectId}`}>Profile</Button>
          {f.person.linkedin_url && <a href={f.person.linkedin_url} target="_blank" rel="noreferrer" className="px-2.5 py-1 text-xs rounded-lg font-medium" style={{ border: '1px solid var(--border)' }}>LinkedIn ↗</a>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        <div className="flex items-center gap-2 mb-4">
          {tab('linkedin', 'LinkedIn', LinkedIn, f.linkedin.mode === 'first_message')}
          {tab('email', 'Email', Mail, f.email.mode === 'ok')}
        </div>
        {!canSend && lane && (
          <div className="rounded-xl p-4 text-sm space-y-3" style={{ background: 'var(--bg-input)' }}>
            <p>{lane.why}</p>
            {channel === 'linkedin' && f.linkedin.mode === 'not_connected' && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="primary" size="sm" onClick={connect} disabled={!!busy}>{busy === 'connect' ? 'Filing…' : `Send connection request${f.owner.is_viewer ? '' : ` (from ${f.owner.name || 'the owner'}'s account)`}`}</Button>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>filed for approval; the first message unlocks once they accept</span>
              </div>
            )}
            {channel === 'linkedin' && f.linkedin.mode === 'no_account' && <Link href="/profile" className="text-xs underline" style={{ color: 'var(--accent)' }}>Connect LinkedIn on your profile →</Link>}
            {channel === 'email' && f.email.mode === 'no_mailbox' && <Link href="/profile?tab=email" className="text-xs underline" style={{ color: 'var(--accent)' }}>Connect Google on your profile →</Link>}
            {channel === 'email' && f.email.mode === 'no_address' && <Link href={`/prospects/${prospectId}`} className="text-xs underline" style={{ color: 'var(--accent)' }}>Enrich on the profile →</Link>}
            {f.email.mode === 'ok' && channel === 'linkedin' && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>You can email {first} instead — switch to the Email tab.</p>}
          </div>
        )}
        {f.waiting.length > 0 && (
          <ul className="mt-3 space-y-1">
            {f.waiting.map((w) => (
              <li key={w.id} className="text-xs rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--yellow) 12%, transparent)' }}>
                {w.status === 'approved' ? 'Approved, going out' : 'Waiting for your approval'} · {w.kind === 'connect' ? 'connection request' : w.kind === 'followup' ? 'message' : 'first message'}
                {w.message ? <span style={{ color: 'var(--text-muted)' }}> — “{w.message}”</span> : null} · <Link href="/agents" className="underline">decide on Agents</Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canSend && (
        <div className="border-t p-3 max-h-[70vh] overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
          {note && (
            <p className="text-xs mb-2 p-2 rounded-lg" style={{ color: note.kind === 'error' ? 'var(--red)' : 'var(--text)', background: note.kind === 'error' ? 'color-mix(in srgb, var(--red) 10%, transparent)' : 'var(--bg-input)' }}>{note.text}</p>
          )}
          {channel === 'email' && (
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="z-input mb-2" aria-label="Subject" />
          )}
          {proposal ? (
            <ProposalStrip p={proposal} after={text} onAfter={setText} senderFirst="your"
              verdict={verdict} onVerdict={setVerdict} onTeach={() => teach(text)} teaching={teaching} learned={learned} error={teachErr}
              onSendAsIs={() => send(true)} onSend={() => send()} onRedraft={draft} busy={busy} fromLine={fromLine}
              onDiscard={async () => {
                if (verdictGiven(verdict) && !learned) await teach(text);
                else if (!learned) setRate({ approvalId: null, before: proposal.message, after: text });
                setProposal(null); setText('');
              }} />
          ) : (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
                placeholder={channel === 'email' ? `Your first email to ${first}…` : `Your first LinkedIn message to ${first}…`}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim() && !busy) { e.preventDefault(); void send(); } }}
                className="z-input resize-none" style={{ minHeight: 96 }} aria-label="Message" />
              <div className="flex items-center gap-2 mt-2">
                <p className="text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>{fromLine}</p>
                <Button size="sm" onClick={draft} disabled={!!busy} title="An AI proposal in your voice, from what we know about them — you edit and send">
                  <span className="inline-flex items-center gap-1"><Sparkle width={12} height={12} />{busy === 'draft' ? 'Drafting…' : 'Draft with AI'}</span>
                </Button>
                <Button variant="primary" onClick={() => send()} disabled={!text.trim() || !!busy || (channel === 'email' && !subject.trim())}>
                  {busy === 'send' ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </>
          )}
          {!proposal && learned && (
            <div className="rounded-xl px-3 py-2 mt-3 text-xs flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--green) 8%, transparent)' }}>
              <div className="flex-1"><LearnedLines res={learned} /></div>
              <button type="button" onClick={() => setLearned(null)} className="underline" style={{ color: 'var(--text-muted)' }}>Close</button>
            </div>
          )}
          {rate && <RatingStrip approvalId={rate.approvalId} before={rate.before} after={rate.after} prospectId={prospectId}
            channel={channel} step="first" senderFirst="your" onClose={() => setRate(null)} />}
        </div>
      )}
    </div>
  );
}
