'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { relativeTime } from '@/lib/time';

/**
 * Profile → Email: connect your own Gmail as a SENDING mailbox for email waves (core 076). Separate from the read-only
 * import connection under Imports. Waves go out from here only after you approve them; replies come back to this inbox
 * and stop the sequence.
 */
interface Mine { address: string; display_name: string | null; signature: string | null; daily_cap: number;
  connected_at: string; revoked_at: string | null; last_sent_at: string | null; last_error: string | null }
interface Box { user_id: string; address: string; name: string | null; cap: number; sent_last_24h: number; left: number }

export default function EmailSendingPanel() {
  const params = useSearchParams();
  const [mine, setMine] = useState<Mine | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [form, setForm] = useState({ display_name: '', signature: '', daily_cap: '50' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(params.get('connected') ? 'Gmail connected for sending.' : null);
  const [error, setError] = useState<string | null>(params.get('error'));

  const load = useCallback(async () => {
    const res = await fetch('/api/email/mailboxes');
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) { setError(out.error || 'Could not load.'); return; }
    const m: Mine | null = out.mine && !out.mine.revoked_at ? out.mine : null;
    setMine(m); setBoxes(out.senders || []);
    if (m) setForm({ display_name: m.display_name || '', signature: m.signature || '', daily_cap: String(m.daily_cap) });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch('/api/email/mailboxes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: form.display_name, signature: form.signature, daily_cap: Number(form.daily_cap) || 50 }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not save.');
      setMsg('Saved.'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!confirm('Stop sending from this mailbox? Approved emails that have not gone out wait until a mailbox is connected again.')) return;
    setBusy(true);
    try { await fetch('/api/email/disconnect', { method: 'POST' }); await load(); setMsg('Disconnected.'); }
    finally { setBusy(false); }
  };
  const me = boxes.find((b) => mine && b.address === mine.address);

  return (
    <div className="grid gap-4 max-w-2xl">
      <div className="z-card p-5 grid gap-3" style={{ background: 'var(--bg-card)' }}>
        <div>
          <div className="font-semibold">Send email waves from your Gmail</div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Waves of first emails and follow-ups go out from your own address, a few every 10 minutes, only after you approve
            each wave. Replies land in your inbox as usual and stop the sequence for that person.
          </p>
        </div>
        {!mine && (
          <a href="/api/email/connect" className="z-btn text-sm justify-self-start">Connect Gmail for sending</a>
        )}
        {mine && (
          <>
            <div className="text-sm grid gap-1">
              <div><b>{mine.address}</b> · connected {relativeTime(mine.connected_at)}</div>
              <div style={{ color: 'var(--text-muted)' }}>
                {me ? `${me.sent_last_24h} sent in the last 24 hours · ${me.left} left of ${me.cap}` : ''}
                {mine.last_sent_at ? ` · last email ${relativeTime(mine.last_sent_at)}` : ''}
              </div>
              {mine.last_error && <div role="alert" style={{ color: 'var(--red)' }}>Last problem: {mine.last_error}</div>}
            </div>
            <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>From name
              <input id="email-from-name" className="z-input text-sm" value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Mateo Klemmayer" />
            </label>
            <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>Signature (added under every email)
              <textarea id="email-signature" rows={4} className="z-input text-sm" value={form.signature} onChange={(e) => setForm((f) => ({ ...f, signature: e.target.value }))}
                placeholder={'Mateo Klemmayer\nFounder, Zeami · zeami.io'} />
            </label>
            <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>Daily cap (at most the team limit)
              <input id="email-cap" type="number" min={1} max={500} className="z-input text-sm w-32" value={form.daily_cap} onChange={(e) => setForm((f) => ({ ...f, daily_cap: e.target.value }))} />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={busy} className="z-btn text-sm">{busy ? 'Saving…' : 'Save'}</button>
              <a href="/api/email/connect" className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>Reconnect</a>
              <button type="button" onClick={disconnect} disabled={busy} className="text-sm px-4 py-2 rounded-full" style={{ color: 'var(--text-muted)' }}>Disconnect</button>
            </div>
          </>
        )}
        {msg && <p className="text-sm" style={{ color: 'var(--green)' }}>{msg}</p>}
        {error && <p className="text-sm" role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      </div>
      {!!boxes.length && (
        <div className="z-card p-5" style={{ background: 'var(--bg-card)' }}>
          <div className="z-eyebrow mb-2">Team mailboxes that can send waves</div>
          <ul className="text-sm grid gap-1">
            {boxes.map((b) => <li key={b.user_id}>{b.name || b.address} · {b.address} <span style={{ color: 'var(--text-muted)' }}>· {b.sent_last_24h}/{b.cap} in 24 h</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
