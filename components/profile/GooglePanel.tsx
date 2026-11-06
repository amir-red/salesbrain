'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Button from '@/components/panel/Button';
import { Pill } from '@/components/panel/PageHeader';
import SectionCard from '@/components/panel/SectionCard';
import { relativeTime } from '@/lib/time';

/**
 * Profile → Google: the person's Google accounts (core 102: several per person). Each one brings its contacts, the
 * mail in its inbox (into the Inbox) and its calendar meetings; each one allowed to send is a sending mailbox, and one
 * of those is the default that campaign emails and email waves go out from unless a campaign picks another. Shows what
 * Google really allowed per account (a box unticked on the consent screen shows as missing), says "Reconnect" when a
 * stored connection no longer works, and holds the sending settings per mailbox.
 */
interface GoogleAccount {
  account_email: string; connected_at: string | null; is_default: boolean; needs_reconnect: boolean;
  can: { contacts: boolean; read_mail: boolean; send: boolean; calendar?: boolean };
}
interface Mine { address: string; display_name: string | null; signature: string | null; daily_cap: number; is_default?: boolean;
  connected_at: string; revoked_at: string | null; last_sent_at: string | null; last_error: string | null;
  ramp_started_at?: string | null; ramp_skipped?: boolean; paused_at?: string | null; pause_reason?: string | null }
interface Box { user_id: string; address: string; name: string | null; cap: number; sent_last_24h: number; left: number;
  is_default?: boolean; paused?: boolean; ramp?: { cap: number | null; until: string | null; active: boolean };
  bounces?: { sent: number; bounced: number; rate: number; window_days: number } }

const muted = { color: 'var(--text-muted)' };
const CONNECT = '/api/integrations/google/connect';
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function GooglePanel() {
  const params = useSearchParams();
  const [accounts, setAccounts] = useState<GoogleAccount[] | undefined>(undefined);   // undefined = loading
  const [mine, setMine] = useState<Mine[]>([]);
  const [current, setCurrent] = useState<string>('');                                 // the mailbox being edited
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [admin, setAdmin] = useState(false);
  const [form, setForm] = useState({ display_name: '', signature: '', daily_cap: '50' });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(params.get('connected') ? 'Google account connected.' : null);
  const [error, setError] = useState<string | null>(params.get('error'));
  const [syncStats, setSyncStats] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => setAdmin(d?.role === 'admin')).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const [st, mb] = [await fetch('/api/integrations/status'), await fetch('/api/email/mailboxes')];
    const s = await st.json().catch(() => ({}));
    setAccounts((s.google_accounts as GoogleAccount[]) ?? []);
    const m = await mb.json().catch(() => ({}));
    const live: Mine[] = (m.my_mailboxes as Mine[]) ?? (m.mine && !m.mine.revoked_at ? [m.mine] : []);
    setMine(live); setBoxes(m.senders || []);
    setCurrent((c) => (live.some((x) => x.address === c) ? c : (live[0]?.address ?? '')));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const box = mine.find((x) => x.address === current) ?? null;
  useEffect(() => {
    if (box) setForm({ display_name: box.display_name || '', signature: box.signature || '', daily_cap: String(box.daily_cap) });
  }, [box?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, fn: () => Promise<Response>, ok?: string) => {
    setBusy(key); setError(null); setMsg(null);
    try {
      const res = await fn();
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Something went wrong.');
      if (ok) setMsg(ok);
      await load();
      return out;
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); return null; }
    finally { setBusy(null); }
  };
  const sync = async (mode: 'contacts' | 'messages' | 'both') => {
    setBusy(mode); setSyncStats(null); setError(null);
    try {
      const res = await fetch('/api/integrations/google/sync', json('POST', { mode }));
      setSyncStats(await res.json());
    } finally { setBusy(null); }
  };
  const disconnect = (mailbox: string) => {
    if (!confirm(`Disconnect ${mailbox}? Its contacts, mail and meetings stop coming in, and approved emails from it wait until you reconnect it. What is already in the Inbox stays.`)) return;
    void run(`disconnect:${mailbox}`, () => fetch('/api/integrations/google/disconnect', json('POST', { mailbox })), `${mailbox} disconnected.`);
  };
  const makeDefault = (address: string) =>
    run(`default:${address}`, () => fetch('/api/email/mailboxes', json('PATCH', { address, is_default: true })), `Emails now go out from ${address} by default.`);
  const save = () => run('save', () => fetch('/api/email/mailboxes', json('PATCH', {
    address: current, display_name: form.display_name, signature: form.signature, daily_cap: Number(form.daily_cap) || 50 })), 'Saved.');
  const resume = (address: string, userId?: string) =>
    run('resume', () => fetch('/api/email/mailboxes', json('POST', { action: 'resume', address, ...(userId ? { user_id: userId } : {}) })), 'Sending resumed.');
  const skipRamp = (skip: boolean) => run('ramp', () => fetch('/api/email/mailboxes', json('PATCH', { address: current, ramp_skipped: skip })));

  const anyWorks = (accounts ?? []).some((a) => !a.needs_reconnect);
  const stats = boxes.find((b) => box && b.address === box.address);

  return (
    <div className="grid gap-4 max-w-3xl">
      {error && <div className="rounded-lg px-3 py-2 text-xs" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>Google said: {error}</div>}
      {msg && <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)', color: 'var(--green)' }}>{msg}</div>}

      <SectionCard title="Google accounts"
        subtitle="Connect every Google account you work from. Each brings its contacts, its inbox (into the Inbox) and its calendar meetings; the ones allowed to send can send campaign emails."
        right={accounts?.length ? <Button size="sm" href={CONNECT}>+ Add another account</Button> : null}>
        {accounts === undefined && <p className="text-xs" style={muted}>Loading…</p>}
        {accounts?.length === 0 && (
          <div className="grid gap-2">
            <p className="text-sm">Not connected. You’ll pick a Google account and allow contacts, reading Gmail and sending email.</p>
            <div><Button variant="primary" href={CONNECT}>Connect Google</Button></div>
          </div>
        )}
        {!!accounts?.length && (
          <div className="grid gap-3">
            {accounts.map((a) => {
              const perms = [['Contacts', a.can.contacts], ['Read Gmail', a.can.read_mail], ['Send email', a.can.send], ['Calendar meetings', !!a.can.calendar]] as const;
              const missing = perms.filter(([, ok]) => !ok).map(([k]) => k);
              return (
                <div key={a.account_email} className="rounded-xl p-3 grid gap-2" style={{ border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <b>{a.account_email}</b>
                    {a.connected_at && <span style={muted}>· connected {relativeTime(a.connected_at)}</span>}
                    {a.is_default && <Pill color="var(--accent)">Default for sending</Pill>}
                    {a.needs_reconnect ? <Pill color="var(--orange)">Needs reconnecting</Pill> : <Pill color="var(--green)">Connected</Pill>}
                  </div>
                  {a.needs_reconnect && (
                    <p className="text-xs" style={{ color: 'var(--orange)' }}>
                      Google refused this connection (access was removed, or it was made with SalesBrain’s previous Google setup). Reconnect it.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {perms.map(([k, ok]) => <Pill key={k} color={ok ? 'var(--green)' : 'var(--text-muted)'}>{ok ? '✓' : '✕'} {k}</Pill>)}
                  </div>
                  {!a.needs_reconnect && missing.length > 0 && (
                    <p className="text-xs" style={muted}>Not allowed: {missing.join(', ')}. Reconnect and leave every box ticked to use {missing.length > 1 ? 'them' : 'it'}.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {!a.is_default && a.can.send && !a.needs_reconnect && (
                      <Button size="sm" disabled={busy !== null} onClick={() => makeDefault(a.account_email)}>Use for sending by default</Button>
                    )}
                    <Button size="sm" variant={a.needs_reconnect ? 'primary' : 'secondary'} href={CONNECT}>Reconnect</Button>
                    <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => disconnect(a.account_email)}>Disconnect</Button>
                  </div>
                </div>
              );
            })}
            {anyWorks && (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs" style={muted}>Sync every account now:</span>
                <Button size="sm" disabled={busy !== null} onClick={() => sync('contacts')}>{busy === 'contacts' ? 'Syncing…' : 'Contacts'}</Button>
                <Button size="sm" disabled={busy !== null} onClick={() => sync('messages')}>{busy === 'messages' ? 'Syncing…' : 'Recent emails'}</Button>
                <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => sync('both')}>{busy === 'both' ? 'Syncing…' : 'Full sync'}</Button>
              </div>
            )}
            {syncStats && <pre className="text-xs p-2 rounded-lg overflow-x-auto" style={{ background: 'var(--bg-input)', ...muted }}>{JSON.stringify(syncStats, null, 2)}</pre>}
            <p className="text-[11px]" style={muted}>
              The Inbox shows the mail in each account’s Primary inbox (not Promotions or Social). Mail with people who are not in the
              CRM is visible to you only.
            </p>
          </div>
        )}
      </SectionCard>

      {anyWorks && (
        <SectionCard title="Sending email"
          subtitle="Campaign emails and email waves go out from your default mailbox (a campaign can pick another), a few every 10 minutes, only after you approve them. Inbox replies go out from the mailbox the conversation is in."
          right={box ? <Pill color="var(--green)">{mine.length > 1 ? `${mine.length} sending mailboxes` : `Sending from ${box.address}`}</Pill> : <Pill color="var(--text-muted)">Off</Pill>}>
          {!box ? (
            <p className="text-sm">Sending is off because Google was not allowed to send email. <a href={CONNECT} className="underline">Reconnect</a> and keep “Send email on your behalf” ticked.</p>
          ) : (
            <div className="grid gap-3">
              {mine.length > 1 && (
                <label className="grid gap-1"><span className="text-xs font-medium">Mailbox</span>
                  <select className="z-input text-sm" value={current} onChange={(e) => setCurrent(e.target.value)}>
                    {mine.map((x) => <option key={x.address} value={x.address}>{x.address}{x.is_default ? ' (default)' : ''}</option>)}
                  </select></label>
              )}
              {box.paused_at && (
                <div className="rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-3" role="alert"
                  style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>
                  <span>Sending from {box.address} is paused: {box.pause_reason || 'too many bounces'}. Check the list’s addresses first.</span>
                  <Button size="sm" disabled={busy !== null} onClick={() => resume(box.address)}>{busy === 'resume' ? 'Resuming…' : 'Resume'}</Button>
                </div>
              )}
              <div className="text-xs" style={muted}>
                {stats ? `${stats.sent_last_24h} sent in the last 24 hours · ${stats.left} left of ${stats.cap}` : ''}
                {box.last_sent_at ? ` · last email ${relativeTime(box.last_sent_at)}` : ''}
                {stats?.bounces && stats.bounces.sent > 0 ? ` · bounces (${stats.bounces.window_days} d): ${stats.bounces.bounced} of ${stats.bounces.sent}` : ''}
              </div>
              {stats?.ramp?.active && (
                <div className="text-xs flex items-center gap-2 flex-wrap" style={muted}>
                  <span>Ramping up a new mailbox: {stats.ramp.cap} a day{stats.ramp.until ? ` until ${new Date(stats.ramp.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''} — mail providers trust a mailbox that grows slowly.</span>
                  {admin && <button type="button" className="underline" disabled={busy !== null} onClick={() => skipRamp(true)}>Skip the ramp (already warm)</button>}
                </div>
              )}
              {!stats?.ramp?.active && box.ramp_skipped && admin && (
                <div className="text-xs" style={muted}>Ramp-up skipped. <button type="button" className="underline" disabled={busy !== null} onClick={() => skipRamp(false)}>Ramp again</button></div>
              )}
              {box.last_error && <div className="text-xs" role="alert" style={{ color: 'var(--red)' }}>Last problem: {box.last_error}</div>}
              <label className="grid gap-1"><span className="text-xs font-medium">From name</span>
                <input className="z-input text-sm" value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Amir Redwan" /></label>
              <label className="grid gap-1"><span className="text-xs font-medium">Signature <span className="font-normal" style={muted}>· added under every email from this mailbox</span></span>
                <textarea rows={4} className="z-input text-sm" value={form.signature} onChange={(e) => setForm((f) => ({ ...f, signature: e.target.value }))}
                  placeholder={'Amir Redwan\nZeami · zeami.io'} /></label>
              <label className="grid gap-1"><span className="text-xs font-medium">Daily cap <span className="font-normal" style={muted}>· at most the team limit</span></span>
                <input type="number" min={1} max={500} className="z-input text-sm" style={{ width: 120 }} value={form.daily_cap}
                  onChange={(e) => setForm((f) => ({ ...f, daily_cap: e.target.value }))} /></label>
              <div><Button variant="primary" disabled={busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</Button></div>
            </div>
          )}
        </SectionCard>
      )}

      {boxes.length > 0 && (
        <SectionCard title="Team mailboxes that can send" subtitle="Who can send campaign emails right now, and how much of today’s cap is left.">
          <ul className="text-sm grid gap-1">
            {boxes.map((b) => (
              <li key={`${b.user_id}:${b.address}`} className="flex items-center gap-2 flex-wrap">
                <span>{b.name || b.address} · {b.address}{b.is_default ? '' : ' · extra'}</span>
                <span style={muted}>· {b.sent_last_24h}/{b.cap} in 24 h{b.ramp?.active ? ' · ramping' : ''}{b.bounces?.sent ? ` · ${b.bounces.bounced}/${b.bounces.sent} bounced` : ''}</span>
                {b.paused && <span className="text-[11px] px-1.5 rounded-full" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 12%, transparent)' }}>paused</span>}
                {b.paused && admin && <button type="button" className="text-xs underline" disabled={busy !== null} onClick={() => resume(b.address, b.user_id)}>Resume</button>}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
