'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import SectionCard from '@/components/panel/SectionCard';
import { relativeTime } from '@/lib/time';

/**
 * Email outreach for a list (core 076): the list's email sequence, who sends, "queue the next wave", and the waves so
 * far. A wave is filed for the SENDER's one-tap approval (Telegram card + /waves/[id]); nothing is sent from here.
 */
interface Step { day: number; body: string }
interface Sequence { subject: string; steps: Step[] }
interface Mailbox { user_id: string; address: string; name: string | null; cap: number; sent_last_24h: number; left: number }
interface Wave { id: string; step: number; size: number; status: string; sender_address: string; sender_name: string;
  created_at: string; sent: number; queued: number; failed: number }

const STARTER: Sequence = {
  subject: 'Zeami: AI that maps and automates how teams work',
  steps: [
    { day: 0, body: 'Hi {first_name},\n\n{hook}\n\nZeami maps how a company\'s teams actually work and automates the repetitive parts with AI agents. We are raising a pre-seed round and I would value 20 minutes with you.\n\nWould a short call in the next two weeks work? I am happy to send the deck first.' },
    { day: 5, body: 'Hi {first_name}, a quick follow-up on my note below. Happy to send the deck if a call is too much right now.' },
    { day: 12, body: 'Hi {first_name}, last note from me. If Zeami is not a fit for {firm} right now, no problem; a short "not for us" helps me too.' },
  ],
};
const STATUS_COLOR: Record<string, string> = { pending: 'var(--orange)', approved: 'var(--blue)', sending: 'var(--blue)', done: 'var(--green)', skipped: 'var(--text-muted)', expired: 'var(--text-muted)' };

export default function EmailOutreachSection({ icpId }: { icpId: string }) {
  const [seq, setSeq] = useState<Sequence | null>(null);
  const [saved, setSaved] = useState(false);
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [optOut, setOptOut] = useState('');
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [sender, setSender] = useState('');
  const [waves, setWaves] = useState<Wave[]>([]);
  const [editing, setEditing] = useState(false);
  const [includeCheck, setIncludeCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // One after another: each opens a kernel connection on the shared pooler (no fan-out).
    const get = (u: string) => fetch(u).then((r) => r.json()).catch(() => ({}));
    const s = await get(`/api/icp/${icpId}/email/sequence`);
    const m = await get('/api/email/mailboxes');
    const w = await get(`/api/icp/${icpId}/email/waves`);
    const has = s?.sequence?.steps?.length;
    setSeq(has ? s.sequence : null); setSaved(Boolean(has));
    setPlaceholders(s?.placeholders || []); setOptOut(s?.opt_out_line || '');
    setBoxes(m?.senders || []); setMe(m?.me || null);
    setSender((cur) => cur || (m?.senders || []).find((b: Mailbox) => b.user_id === m?.me)?.user_id || (m?.senders?.[0]?.user_id ?? ''));
    setWaves(w?.waves || []);
  }, [icpId]);
  useEffect(() => { void load(); }, [load]);

  const saveSeq = async () => {
    if (!seq) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await fetch(`/api/icp/${icpId}/email/sequence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sequence: seq }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not save.');
      setSeq(out.sequence); setSaved(true); setEditing(false); setNote('Sequence saved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  const queue = async () => {
    setBusy(true); setError(null); setNote(null);
    try {
      const box = boxes.find((b) => b.user_id === sender);
      const res = await fetch(`/api/icp/${icpId}/email/waves`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20, sender: box?.address, include_check: includeCheck }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not queue a wave.');
      setNote(out.wave_id ? `${out.note} Review: /waves/${out.wave_id}` : out.note);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not queue a wave.'); }
    finally { setBusy(false); }
  };

  const setStep = (i: number, patch: Partial<Step>) => setSeq((s) => s && { ...s, steps: s.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const box = boxes.find((b) => b.user_id === sender);
  const subtitle = `${saved ? `${seq?.steps.length ?? 0}-email sequence` : 'no sequence yet'} · ${boxes.length ? `${boxes.length} mailbox(es) can send` : 'no mailbox connected'} · ${waves.length} wave(s)`;

  return (
    <SectionCard title="Email outreach" subtitle={subtitle} right={
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={() => { if (!seq) setSeq(STARTER); setEditing((e) => !e); }} className="px-2.5 py-1 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}>
          {saved ? (editing ? 'Close editor' : 'Edit emails') : 'Write the emails'}
        </button>
      </div>
    }>
      {editing && seq && (
        <div className="rounded-xl p-4 grid gap-3 mb-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          {!saved && <p className="text-xs" style={{ color: 'var(--orange)' }}>A starting text — read and change it before you save. It is sent exactly as written.</p>}
          <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>Subject
            <input id="seq-subject" className="z-input text-sm" value={seq.subject} onChange={(e) => setSeq({ ...seq, subject: e.target.value })} />
          </label>
          {seq.steps.map((st, i) => (
            <div key={i} className="grid gap-1">
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span className="font-medium" style={{ color: 'var(--text)' }}>{i === 0 ? 'First email' : `Follow-up ${i}`}</span>
                {i > 0 && (<>
                  <span>on day</span>
                  <input id={`seq-day-${i}`} type="number" min={1} className="z-input text-xs py-0.5 w-16" value={st.day} onChange={(e) => setStep(i, { day: Number(e.target.value) || 1 })} />
                  <span>after the first, same thread, only if no reply</span>
                  <button type="button" onClick={() => setSeq({ ...seq, steps: seq.steps.filter((_, j) => j !== i) })} className="ml-auto underline">remove</button>
                </>)}
              </div>
              <textarea id={`seq-body-${i}`} rows={i === 0 ? 8 : 3} className="z-input text-sm" value={st.body} onChange={(e) => setStep(i, { body: e.target.value })} />
            </div>
          ))}
          {seq.steps.length < 4 && (
            <button type="button" className="text-xs underline justify-self-start" style={{ color: 'var(--text-muted)' }}
              onClick={() => setSeq({ ...seq, steps: [...seq.steps, { day: (seq.steps[seq.steps.length - 1]?.day || 0) + 7, body: 'Hi {first_name}, ' }] })}>
              Add a follow-up
            </button>
          )}
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Placeholders: {placeholders.map((p) => `{${p}}`).join(' ')} · {'{hook}'} is the researched opening line for that firm.
            Your signature (Profile → Email) and this line are added under every email: “{optOut}”
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>Cancel</button>
            <button type="button" onClick={saveSeq} disabled={busy} className="z-btn text-xs">{busy ? 'Saving…' : 'Save sequence'}</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>From
          <select id="wave-sender" className="z-input text-xs py-1" value={sender} onChange={(e) => setSender(e.target.value)} disabled={!boxes.length}>
            {!boxes.length && <option value="">no mailbox connected</option>}
            {boxes.map((b) => <option key={b.user_id} value={b.user_id}>{b.name || b.address} · {b.address} ({b.left} left today)</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <input id="wave-include-check" type="checkbox" checked={includeCheck} onChange={(e) => setIncludeCheck(e.target.checked)} /> also firms marked Check
        </label>
        <button type="button" onClick={queue} disabled={busy || !saved || !sender} className="px-2.5 py-1 rounded-lg font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          title={!saved ? 'Write the email sequence first' : !sender ? 'Connect a Gmail for sending on Profile → Email' : 'Draft the next 20 first emails (one person per Go firm) for the sender to approve'}>
          {busy ? 'Working…' : 'Queue next 20 for approval'}
        </button>
        {!boxes.length && <Link href="/profile?tab=email" className="underline" style={{ color: 'var(--accent)' }}>Connect Gmail for sending</Link>}
        {box && sender !== me && <span style={{ color: 'var(--text-muted)' }}>The card goes to {box.name || box.address}; they approve it.</span>}
      </div>
      {note && <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>{note}</div>}
      {error && <div className="mt-2 text-xs" role="alert" style={{ color: 'var(--red)' }}>{error}</div>}

      {!!waves.length && (
        <table className="w-full text-xs mt-3">
          <thead><tr className="text-left" style={{ color: 'var(--text-muted)' }}>
            <th className="px-2 py-1 font-medium">Wave</th><th className="px-2 py-1 font-medium">From</th><th className="px-2 py-1 font-medium">Status</th>
            <th className="px-2 py-1 font-medium">Sent</th><th className="px-2 py-1 font-medium">Waiting</th><th className="px-2 py-1 font-medium">Failed</th><th />
          </tr></thead>
          <tbody>
            {waves.map((w) => (
              <tr key={w.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="px-2 py-1.5">{w.step === 0 ? 'First emails' : `Follow-up ${w.step}`} · {w.size} · {relativeTime(w.created_at)}</td>
                <td className="px-2 py-1.5">{w.sender_name || w.sender_address}</td>
                <td className="px-2 py-1.5" style={{ color: STATUS_COLOR[w.status] }}>{w.status === 'pending' ? 'waiting for approval' : w.status}</td>
                <td className="px-2 py-1.5 tabular-nums">{w.sent}</td><td className="px-2 py-1.5 tabular-nums">{w.queued}</td><td className="px-2 py-1.5 tabular-nums">{w.failed}</td>
                <td className="px-2 py-1.5"><Link href={`/waves/${w.id}`} className="underline" style={{ color: 'var(--accent)' }}>Review</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}
