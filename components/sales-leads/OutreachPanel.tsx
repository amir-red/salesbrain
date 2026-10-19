'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OutreachState } from '@/lib/sales-leads';
import { LinkedIn, Send } from './icons';

/**
 * LinkedIn outreach on the lead card: send a connection request, or draft the next message —
 * both FILED for the sender's approval (Telegram card or /agents); nothing goes out from here.
 * The sender is the lead's prospect owner: their LinkedIn account is the one that sends.
 */
export default function OutreachPanel({ leadId, onChanged }: { leadId: string; onChanged?: () => void }) {
  const [s, setS] = useState<OutreachState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'connect' | 'draft' | 'propose'>('');
  const [ok, setOk] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [msg, setMsg] = useState('');
  const [source, setSource] = useState<'' | 'template' | 'model'>('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sales-leads/${leadId}/outreach`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load');
      setS(data); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [leadId]);
  useEffect(() => { load(); }, [load]);

  async function act(action: 'connect' | 'draft' | 'propose') {
    setBusy(action); setErr(null); setOk(null);
    try {
      const res = await fetch(`/api/sales-leads/${leadId}/outreach`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'connect' ? { action, note: note.trim() || undefined }
          : action === 'propose' ? { action, message: msg } : { action }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed');
      if (action === 'draft') { setMsg(data.message); setSource(data.source); return; }
      const who = data.acted_as?.name ?? s?.sender?.name ?? 'the sender';
      setOk(data.duplicate
        ? `Already waiting for ${who}'s decision — nothing new filed.`
        : `Filed for ${who}'s approval (Telegram card or /agents). Nothing goes out until they approve.`);
      if (action === 'propose') { setMsg(''); setSource(''); }
      if (action === 'connect') { setNote(''); setShowNote(false); }
      await load(); onChanged?.();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }

  if (!s) return err ? <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p> : null;
  const sender = s.sender?.name ?? 'the owner';
  const field = { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '0.5rem' } as const;
  const primary = { background: 'var(--accent)', color: 'var(--accent-fg)' } as const;
  const ghost = { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)' } as const;
  const canMessage = s.mode === 'first_message' || s.mode === 'thread';
  const lastFromThem = s.thread.length > 0 && !s.thread[s.thread.length - 1].ours;
  // One pending request / one pending message per person (the kernel refuses a second): say so, don't offer it.
  const waitingConnect = s.pending.some((p) => p.kind === 'connect');
  const waitingMsg = s.pending.some((p) => p.kind !== 'connect');

  return (
    <div className="mt-5 rounded-xl p-3" style={{ border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <span style={{ color: 'var(--accent)' }}><LinkedIn width={14} height={14} /></span>
        <h4 className="z-eyebrow">LinkedIn outreach</h4>
        {s.sender && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>sends from {sender}&apos;s LinkedIn · every send waits for {sender}&apos;s approval</span>}
      </div>

      {s.pending.length > 0 && (
        <ul className="mb-2 space-y-1">
          {s.pending.map((p) => (
            <li key={p.id} className="text-xs rounded-lg px-2.5 py-1.5" style={{ background: 'color-mix(in srgb, var(--yellow) 12%, transparent)' }}>
              <span className="font-medium">{p.status === 'approved' ? 'Approved, going out' : `Waiting for ${sender}'s approval`}</span>
              {' · '}{p.kind === 'connect' ? 'connection request' : p.kind === 'followup' ? 'message in the conversation' : 'first message'}
              {p.message ? <span style={{ color: 'var(--text-muted)' }}> — “{p.message.slice(0, 140)}{p.message.length > 140 ? '…' : ''}”</span> : null}
            </li>
          ))}
        </ul>
      )}

      {s.why && <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{s.why}</p>}

      {s.mode === 'connect' && !waitingConnect && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Not connected yet — a message can only go to a connection.</span>
          {showNote && (
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Optional note (max 200 characters)"
              className="text-xs px-2.5 py-1.5 flex-1 min-w-[220px]" style={field} />
          )}
          {!showNote && <button type="button" className="text-xs underline" style={{ color: 'var(--text-muted)' }} onClick={() => setShowNote(true)} disabled={!s.can_act}>add a note</button>}
          <button type="button" onClick={() => act('connect')} disabled={!s.can_act || !!busy}
            className="text-xs px-3.5 py-1.5 rounded-full font-medium disabled:opacity-50" style={primary}>
            {busy === 'connect' ? 'Filing…' : 'Send connection request'}
          </button>
        </div>
      )}
      {s.mode === 'request_pending' && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Connection request sent — waiting for them to accept. The first message unlocks when they do.</p>
      )}

      {canMessage && (
        <>
          {s.thread.length > 0 && (
            <ol className="mb-2 space-y-1">
              {s.thread.slice(-3).map((m, i) => (
                <li key={i} className="text-xs leading-relaxed" style={{ color: m.ours ? 'var(--text-muted)' : 'var(--text)' }}>
                  <span className="font-medium">{m.ours ? 'We' : 'They'}</span>
                  {m.sent_at ? <span style={{ color: 'var(--text-muted)' }}> · {new Date(m.sent_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span> : null}
                  {': '}{(m.text ?? '').slice(0, 220)}{(m.text ?? '').length > 220 ? '…' : ''}
                </li>
              ))}
            </ol>
          )}
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={msg ? 5 : 2}
            placeholder={s.mode === 'first_message' ? 'The first message to this new connection…' : lastFromThem ? 'Your reply…' : 'Your follow-up…'}
            className="w-full text-[13px] px-3 py-2 leading-relaxed resize-y" style={field} disabled={!s.can_act} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => act('draft')} disabled={!s.can_act || !!busy}
              className="text-xs px-3 py-1.5 rounded-full disabled:opacity-50" style={ghost}>
              {busy === 'draft' ? 'Drafting…' : msg ? 'Draft again' : s.mode === 'first_message' ? 'Draft first message' : lastFromThem ? 'Draft a reply' : 'Draft a follow-up'}
            </button>
            {source && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{source === 'template' ? "from the list's first-message template" : 'AI draft — read it before you queue it'}</span>}
            <span className="flex-1" />
            {waitingMsg && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>A message already waits for {sender}&apos;s decision — approve or skip it first.</span>}
            <button type="button" onClick={() => act('propose')} disabled={!s.can_act || !!busy || !msg.trim() || waitingMsg}
              className="inline-flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-full font-medium disabled:opacity-50" style={primary}>
              <Send width={12} height={12} />{busy === 'propose' ? 'Filing…' : `Queue for ${sender}'s approval`}
            </button>
          </div>
        </>
      )}

      {ok && <p className="mt-2 text-xs" style={{ color: 'var(--green)' }}>{ok}</p>}
      {err && <p role="alert" className="mt-2 text-xs font-medium" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
}
