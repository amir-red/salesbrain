'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Button from '@/components/panel/Button';
import { Pill } from '@/components/panel/PageHeader';
import SectionCard from '@/components/panel/SectionCard';
import { relativeTime } from '@/lib/time';

/**
 * Profile → Messaging (core 100): how WhatsApp, iMessage and Telegram conversations reach my Inbox.
 *   1. a Zeami Messaging private link (read-only, every 10 minutes);
 *   2. WhatsApp connected through Unipile (full history, and replies from the Inbox);
 *   3. iMessage pushed from my Mac (scripts/imessage_push.py).
 * Only one-to-one conversations with people already in the CRM are kept; everything else is dropped, never stored.
 */
interface Source {
  id: string; kind: 'zeami_link' | 'unipile_whatsapp' | 'mac_push'; label: string | null; secret_tail: string | null;
  phone: string | null; status: 'ok' | 'expired' | 'error'; last_error: string | null; last_sync_at: string | null;
  expires_at: string | null; created_at: string; threads: number | null;
  apps: { app: string; label?: string; way?: string; enabled?: boolean; read_state?: string; read_detail?: string; last_read_at?: string }[] | null;
}

const muted = { color: 'var(--text-muted)' };

// Zeami's read_state values, in words (from its documentation).
const READ_STATE: Record<string, string> = {
  pending: 'not read yet — the first read comes soon',
  ok: 'reading fine',
  waiting_mac: 'your Mac could not be read just now (locked, asleep or offline)',
  not_open: 'its window is not open on your Mac',
  needs_signin: 'the link stopped — sign in again in Zeami → Messaging',
  mac_not_allowed: 'your Mac has not allowed reading yet',
  permissions_missing: 'your Mac needs a permission first',
  private_window: 'open only in a private window, which is never read',
  unsupported_os: 'apps on the computer can only be read on a Mac',
  failed: 'the last read failed',
  off: 'switched off',
};

const STATUS_PILL: Record<Source['status'], [string, string]> = {
  ok: ['var(--green)', 'Connected'],
  expired: ['var(--orange)', 'Ended — needs a new link'],
  error: ['var(--red)', 'Not working'],
};

export default function MessagingPanel() {
  const params = useSearchParams();
  const [items, setItems] = useState<Source[] | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/messaging');
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed');
      setItems(out.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setItems([]);
    }
  }, []);

  const call = useCallback(async (what: string, init: RequestInit, url = '/api/messaging') => {
    setBusy(what); setError(null); setMsg(null);
    try {
      const res = await fetch(url, init);
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Failed');
      return out;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const wa = params.get('wa');
  useEffect(() => {
    if (wa === 'connected') {
      call('claim', { method: 'POST' }, '/api/messaging/whatsapp/claim').then((out) => {
        if (out) setMsg('WhatsApp is connected. Your chats with people in the CRM are being read into the Inbox.');
        load();
      });
    } else {
      if (wa === 'failed') setError('The WhatsApp connection was cancelled or failed.');
      load();
    }
  }, [wa, call, load]);

  const zeami = items?.find((s) => s.kind === 'zeami_link') ?? null;
  const whatsapp = items?.find((s) => s.kind === 'unipile_whatsapp') ?? null;
  const mac = items?.find((s) => s.kind === 'mac_push') ?? null;

  async function saveLink() {
    const out = await call('zeami', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'zeami', link }) });
    if (out) {
      setLink('');
      const n = (out.synced?.synced || []).reduce((a: number, s: { conversations?: number }) => a + (s.conversations || 0), 0);
      setMsg(`Link saved. ${n ? `${n} conversation${n === 1 ? '' : 's'} with people in the CRM read into the Inbox.` : 'Nothing new to read yet.'}`);
      load();
    }
  }
  async function syncNow() {
    const out = await call('sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) });
    if (out) {
      const s = (out.synced || []) as { new_messages?: number; error?: string }[];
      const n = s.reduce((a, x) => a + (x.new_messages || 0), 0);
      const err = s.find((x) => x.error)?.error;
      setMsg(err ? `Read, with a problem: ${err}` : n ? `${n} new message${n === 1 ? '' : 's'}.` : 'Nothing new.');
      load();
    }
  }
  async function remove(kind: Source['kind']) {
    if (!window.confirm(kind === 'unipile_whatsapp'
      ? 'Disconnect WhatsApp? Nothing more is read and no replies can be sent from it. The conversations already in the Inbox stay.'
      : 'Remove this link? Nothing more is read from it. The conversations already in the Inbox stay.')) return;
    if (await call(`remove:${kind}`, { method: 'DELETE' }, `/api/messaging?kind=${kind}`)) load();
  }
  async function connectWhatsApp() {
    const out = await call('wa', { method: 'POST' }, '/api/messaging/whatsapp');
    if (out?.url) window.location.href = out.url;
    else if (out) setError('Unipile did not give a connect link.');
  }

  return (
    <div className="grid gap-4 max-w-3xl">
      {error && <div className="rounded-lg px-3 py-2 text-xs" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>}
      {msg && <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)', color: 'var(--green)' }}>{msg}</div>}
      <p className="text-xs" style={muted}>
        Only one-to-one conversations with people who are already in the CRM reach your Inbox. Group chats and anyone
        else are left out and never stored.
      </p>

      <SectionCard title="Zeami Messaging link"
        subtitle="Reads WhatsApp, iMessage and Telegram through your Zeami private link, every 10 minutes. Read-only: you answer in the app itself. Zeami keeps only the last message of most chats (all recent ones for WhatsApp read through a linked device), cut to 160 characters."
        right={zeami ? <Pill color={STATUS_PILL[zeami.status][0]}>{STATUS_PILL[zeami.status][1]}</Pill> : null}>
        {items === null && <p className="text-xs" style={muted}>Loading…</p>}
        {zeami && (
          <div className="grid gap-2 text-sm">
            <div>
              Link <code className="text-xs">{zeami.secret_tail}</code>
              <span style={muted}>
                {' '}· added {relativeTime(zeami.created_at)}
                {zeami.last_sync_at ? ` · last read ${relativeTime(zeami.last_sync_at)}` : ' · not read yet'}
                {zeami.threads ? ` · ${zeami.threads} conversation${zeami.threads === 1 ? '' : 's'}` : ''}
              </span>
            </div>
            {zeami.status !== 'ok' && (
              <p className="text-xs" style={{ color: 'var(--orange)' }}>
                {zeami.status === 'expired' ? 'Zeami says this link has ended. Make a new one in Zeami → Messaging → Private link and paste it below.' : zeami.last_error}
              </p>
            )}
            {!!zeami.apps?.length && (
              <ul className="grid gap-1 text-xs">
                {zeami.apps.map((a, i) => (
                  <li key={`${a.app}${i}`} className="flex gap-2">
                    <span className="font-medium min-w-[9rem]">{a.label || a.app}</span>
                    <span style={{ color: a.read_state === 'ok' ? 'var(--text-muted)' : 'var(--orange)' }}>
                      {a.enabled === false ? 'switched off' : READ_STATE[a.read_state || ''] || a.read_state || '—'}
                      {a.last_read_at ? ` · read ${relativeTime(a.last_read_at)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy !== null} onClick={syncNow}>{busy === 'sync' ? 'Reading…' : 'Read now'}</Button>
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => remove('zeami_link')}>Remove</Button>
            </div>
          </div>
        )}
        <div className="grid gap-2">
          <label className="text-xs font-medium" htmlFor="zeami-link">{zeami ? 'Replace with a new link' : 'Paste your private link'}</label>
          <div className="flex gap-2">
            <input id="zeami-link" type="password" autoComplete="off" spellCheck={false} value={link}
              onChange={(e) => setLink(e.target.value)} placeholder="https://zhaw.zeami.io/mcp/k/…" className="z-input flex-1" />
            <Button variant="primary" disabled={!link.trim() || busy !== null} onClick={saveLink}>{busy === 'zeami' ? 'Checking…' : 'Save'}</Button>
          </div>
          <p className="text-[11px]" style={muted}>
            Make it in Zeami → Messaging → Private link. It is a personal key: it is kept on the server only and never shown again here.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="WhatsApp"
        subtitle="Connect your WhatsApp to read the full conversations and reply from the Inbox (through the send gate: quiet hours and caps apply). You scan a QR code on Unipile's page."
        right={whatsapp ? <Pill color={STATUS_PILL[whatsapp.status][0]}>{STATUS_PILL[whatsapp.status][1]}</Pill> : null}>
        {whatsapp ? (
          <div className="grid gap-2 text-sm">
            <div>
              <b>{whatsapp.phone || whatsapp.label || 'WhatsApp'}</b>
              <span style={muted}>
                {' '}· connected {relativeTime(whatsapp.created_at)}
                {whatsapp.last_sync_at ? ` · last read ${relativeTime(whatsapp.last_sync_at)}` : ''}
                {whatsapp.threads ? ` · ${whatsapp.threads} conversation${whatsapp.threads === 1 ? '' : 's'}` : ''}
              </span>
            </div>
            {whatsapp.status !== 'ok' && <p className="text-xs" style={{ color: 'var(--orange)' }}>{whatsapp.last_error || 'Reconnect WhatsApp.'}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy !== null} onClick={syncNow}>{busy === 'sync' ? 'Reading…' : 'Read now'}</Button>
              {whatsapp.status !== 'ok' && <Button size="sm" variant="primary" disabled={busy !== null} onClick={connectWhatsApp}>Reconnect</Button>}
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => remove('unipile_whatsapp')}>Disconnect</Button>
            </div>
          </div>
        ) : (
          <div><Button variant="primary" disabled={busy !== null} onClick={connectWhatsApp}>{busy === 'wa' || busy === 'claim' ? 'Connecting…' : 'Connect WhatsApp'}</Button></div>
        )}
      </SectionCard>

      <SectionCard title="iMessage from your Mac"
        subtitle="iMessage can only be read on your own Mac. A small script there sends the messages with people in the CRM — nothing else leaves the Mac."
        right={mac ? <Pill color="var(--green)">Pushing</Pill> : null}>
        <div className="grid gap-1 text-xs" style={muted}>
          {mac
            ? <p>Last pushed {mac.last_sync_at ? relativeTime(mac.last_sync_at) : 'never'}{mac.threads ? ` · ${mac.threads} conversation${mac.threads === 1 ? '' : 's'}` : ''}.</p>
            : <p>Not set up. Ask an admin for the script (scripts/imessage_push.py) and an MCP token from Profile → MCP; the Mac needs Full Disk Access for it.</p>}
        </div>
      </SectionCard>
    </div>
  );
}
