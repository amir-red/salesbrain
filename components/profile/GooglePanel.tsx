'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Button from '@/components/panel/Button';
import { Pill } from '@/components/panel/PageHeader';
import SectionCard from '@/components/panel/SectionCard';
import { relativeTime } from '@/lib/time';

/**
 * Profile → Google: the person's ONE Google connection (2026-10-22) — contacts, Gmail sync and sending email waves /
 * campaign emails all come from it. Shows what Google really allowed (a box unticked on the consent screen shows as
 * missing), says "Reconnect" when the stored connection no longer works, and holds the sending settings.
 */
interface GoogleState {
  account_email: string | null; connected_at: string | null; needs_reconnect: boolean;
  can: { contacts: boolean; read_mail: boolean; send: boolean; calendar?: boolean };
}
interface Mine { address: string; display_name: string | null; signature: string | null; daily_cap: number;
  connected_at: string; revoked_at: string | null; last_sent_at: string | null; last_error: string | null;
  ramp_started_at?: string | null; ramp_skipped?: boolean; paused_at?: string | null; pause_reason?: string | null }
interface Box { user_id: string; address: string; name: string | null; cap: number; sent_last_24h: number; left: number;
  paused?: boolean; ramp?: { cap: number | null; until: string | null; active: boolean };
  bounces?: { sent: number; bounced: number; rate: number; window_days: number } }

const muted = { color: 'var(--text-muted)' };
const CONNECT = '/api/integrations/google/connect';

export default function GooglePanel() {
  const params = useSearchParams();
  const [g, setG] = useState<GoogleState | null | undefined>(undefined);   // undefined = loading, null = not connected
  const [mine, setMine] = useState<Mine | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [admin, setAdmin] = useState(false);
  useEffect(() => { fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => setAdmin(d?.role === 'admin')).catch(() => {}); }, []);
  const resume = async (userId?: string) => {
    setBusy('resume'); setError(null);
    try {
      const res = await fetch('/api/email/mailboxes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume', ...(userId ? { user_id: userId } : {}) }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not resume.');
      setMsg('Sending resumed.'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not resume.'); }
    finally { setBusy(null); }
  };
  const skipRamp = async (skip: boolean) => {
    setBusy('ramp'); setError(null);
    try {
      const res = await fetch('/api/email/mailboxes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ramp_skipped: skip }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not change the ramp.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not change the ramp.'); }
    finally { setBusy(null); }
  };
  const [form, setForm] = useState({ display_name: '', signature: '', daily_cap: '50' });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(params.get('connected') ? 'Google connected.' : null);
  const [error, setError] = useState<string | null>(params.get('error'));
  const [syncStats, setSyncStats] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    const [st, mb] = [await fetch('/api/integrations/status'), await fetch('/api/email/mailboxes')];
    const s = await st.json().catch(() => ({}));
    setG(s.providers?.google ? s.providers.google as GoogleState : null);
    const m = await mb.json().catch(() => ({}));
    const me: Mine | null = m.mine && !m.mine.revoked_at ? m.mine : null;
    setMine(me); setBoxes(m.senders || []);
    if (me) setForm({ display_name: me.display_name || '', signature: me.signature || '', daily_cap: String(me.daily_cap) });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sync = async (mode: 'contacts' | 'messages' | 'both') => {
    setBusy(mode); setSyncStats(null); setError(null);
    try {
      const res = await fetch('/api/integrations/google/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      setSyncStats(await res.json());
    } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save'); setError(null); setMsg(null);
    try {
      const res = await fetch('/api/email/mailboxes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: form.display_name, signature: form.signature, daily_cap: Number(form.daily_cap) || 50 }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not save.');
      setMsg('Saved.'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    finally { setBusy(null); }
  };
  const disconnect = async () => {
    if (!confirm('Disconnect Google? Contact and email sync stop, and approved emails that have not gone out wait until you reconnect.')) return;
    setBusy('disconnect');
    try { await fetch('/api/integrations/google/disconnect', { method: 'POST' }); setMsg('Disconnected.'); await load(); }
    finally { setBusy(null); }
  };

  const works = !!g && !g.needs_reconnect;
  const perms = g ? [['Contacts', g.can.contacts], ['Read Gmail', g.can.read_mail], ['Send email', g.can.send], ['Calendar meetings', !!g.can.calendar]] as const : [];
  const missing = perms.filter(([, ok]) => !ok).map(([k]) => k);
  const me = boxes.find((b) => mine && b.address === mine.address);

  return (
    <div className="grid gap-4 max-w-3xl">
      {error && <div className="rounded-lg px-3 py-2 text-xs" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>Google said: {error}</div>}
      {msg && <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)', color: 'var(--green)' }}>{msg}</div>}

      <SectionCard title="Google"
        subtitle="One connection for your contacts, your Gmail (sync and replies) and sending campaign emails from your own address."
        right={g === undefined ? null : !g ? null
          : g.needs_reconnect ? <Pill color="var(--orange)">Needs reconnecting</Pill> : <Pill color="var(--green)">Connected</Pill>}>
        {g === undefined && <p className="text-xs" style={muted}>Loading…</p>}
        {g === null && (
          <div className="grid gap-2">
            <p className="text-sm">Not connected. You’ll pick a Google account and allow contacts, reading Gmail and sending email.</p>
            <div><Button variant="primary" href={CONNECT}>Connect Google</Button></div>
          </div>
        )}
        {g && (
          <div className="grid gap-3">
            <div className="text-sm">
              <b>{g.account_email ?? 'Google account'}</b>
              {g.connected_at && <span style={muted}> · connected {relativeTime(g.connected_at)}</span>}
            </div>
            {g.needs_reconnect && (
              <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--orange) 10%, transparent)', color: 'var(--orange)' }}>
                This connection no longer works — Google refused it (access was removed, or it was made with SalesBrain’s previous
                Google setup). Reconnect to use contacts, Gmail and sending again.
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {perms.map(([k, ok]) => <Pill key={k} color={ok ? 'var(--green)' : 'var(--text-muted)'}>{ok ? '✓' : '✕'} {k}</Pill>)}
            </div>
            {works && missing.length > 0 && (
              <p className="text-xs" style={muted}>
                Not allowed: {missing.join(', ')}. Reconnect and leave every box ticked on Google’s screen to use {missing.length > 1 ? 'them' : 'it'}.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {works && <>
                <Button size="sm" disabled={busy !== null || !g.can.contacts} onClick={() => sync('contacts')}>{busy === 'contacts' ? 'Syncing…' : 'Sync contacts'}</Button>
                <Button size="sm" disabled={busy !== null || !g.can.read_mail} onClick={() => sync('messages')}>{busy === 'messages' ? 'Syncing…' : 'Sync recent emails'}</Button>
                <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => sync('both')}>{busy === 'both' ? 'Syncing…' : 'Full sync'}</Button>
              </>}
              <Button size="sm" variant={g.needs_reconnect ? 'primary' : 'secondary'} href={CONNECT}>Reconnect</Button>
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={disconnect}>Disconnect</Button>
            </div>
            {syncStats && <pre className="text-xs p-2 rounded-lg overflow-x-auto" style={{ background: 'var(--bg-input)', ...muted }}>{JSON.stringify(syncStats, null, 2)}</pre>}
          </div>
        )}
      </SectionCard>

      {works && (
        <SectionCard title="Sending email"
          subtitle="Campaign emails and email waves go out from this address, a few every 10 minutes, only after you approve them. Replies land in your inbox as usual and stop the sequence for that person."
          right={mine ? <Pill color="var(--green)">Sending from {mine.address}</Pill> : <Pill color="var(--text-muted)">Off</Pill>}>
          {!mine ? (
            <p className="text-sm">Sending is off because Google was not allowed to send email. <a href={CONNECT} className="underline">Reconnect</a> and keep “Send email on your behalf” ticked.</p>
          ) : (
            <div className="grid gap-3">
              {mine.paused_at && (
                <div className="rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-3" role="alert"
                  style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>
                  <span>Sending is paused: {mine.pause_reason || 'too many bounces'}. Check the list’s addresses first.</span>
                  <Button size="sm" disabled={busy !== null} onClick={() => resume()}>{busy === 'resume' ? 'Resuming…' : 'Resume'}</Button>
                </div>
              )}
              <div className="text-xs" style={muted}>
                {me ? `${me.sent_last_24h} sent in the last 24 hours · ${me.left} left of ${me.cap}` : ''}
                {mine.last_sent_at ? ` · last email ${relativeTime(mine.last_sent_at)}` : ''}
                {me?.bounces && me.bounces.sent > 0 ? ` · bounces (${me.bounces.window_days} d): ${me.bounces.bounced} of ${me.bounces.sent}` : ''}
              </div>
              {me?.ramp?.active && (
                <div className="text-xs flex items-center gap-2 flex-wrap" style={muted}>
                  <span>Ramping up a new mailbox: {me.ramp.cap} a day{me.ramp.until ? ` until ${new Date(me.ramp.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''} — mail providers trust a mailbox that grows slowly.</span>
                  {admin && <button type="button" className="underline" disabled={busy !== null} onClick={() => skipRamp(true)}>Skip the ramp (already warm)</button>}
                </div>
              )}
              {!me?.ramp?.active && mine.ramp_skipped && admin && (
                <div className="text-xs" style={muted}>Ramp-up skipped. <button type="button" className="underline" disabled={busy !== null} onClick={() => skipRamp(false)}>Ramp again</button></div>
              )}
              {mine.last_error && <div className="text-xs" role="alert" style={{ color: 'var(--red)' }}>Last problem: {mine.last_error}</div>}
              <label className="grid gap-1"><span className="text-xs font-medium">From name</span>
                <input className="z-input text-sm" value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Amir Redwan" /></label>
              <label className="grid gap-1"><span className="text-xs font-medium">Signature <span className="font-normal" style={muted}>· added under every email</span></span>
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
              <li key={b.user_id} className="flex items-center gap-2 flex-wrap">
                <span>{b.name || b.address} · {b.address}</span>
                <span style={muted}>· {b.sent_last_24h}/{b.cap} in 24 h{b.ramp?.active ? ' · ramping' : ''}{b.bounces?.sent ? ` · ${b.bounces.bounced}/${b.bounces.sent} bounced` : ''}</span>
                {b.paused && <span className="text-[11px] px-1.5 rounded-full" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 12%, transparent)' }}>paused</span>}
                {b.paused && admin && <button type="button" className="text-xs underline" disabled={busy !== null} onClick={() => resume(b.user_id)}>Resume</button>}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
