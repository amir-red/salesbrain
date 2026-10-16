'use client';

import { useEffect, useState } from 'react';

const SNOOZE_KEY = 'salesbrain-telegram-nudge-until';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One line at the top of the home page for a person who has not connected Telegram.
 * "Connect" mints a link code and opens `t.me/<bot>?start=<code>` — one tap in Telegram, then
 * Start. The bot answers nobody who has not sent a code, so this is the front door.
 * Snoozes for a week; renders nothing once linked.
 */
export default function TelegramNudge() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let until = 0;
    try { until = Number(localStorage.getItem(SNOOZE_KEY) || 0); } catch { /* private window */ }
    if (until > Date.now()) return;
    fetch('/api/telegram/link-tokens')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s && s.linked === false) setShow(true); })
      .catch(() => undefined);
  }, []);

  if (!show) return null;

  async function connect() {
    setBusy(true);
    setNote(null);
    // Open the tab inside the click so the browser allows it, then point it at Telegram.
    const tab = window.open('', '_blank');
    try {
      const res = await fetch('/api/telegram/link-tokens', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (data.bot_username && tab) {
        tab.location.href = `https://t.me/${data.bot_username}?start=${data.raw_token}`;
        setNote('Press Start in Telegram. This banner disappears once you are connected.');
      } else {
        tab?.close();
        window.location.href = '/profile?tab=telegram';
      }
    } catch (e) {
      tab?.close();
      setNote(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  function snooze() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
    setShow(false);
  }

  return (
    <div className="px-4 py-2 border-b flex flex-wrap items-center gap-3 text-xs"
         style={{ borderColor: 'var(--border)', background: 'var(--accent-soft, var(--bg-card))' }}>
      <span>
        <b>Get SalesBrain in Telegram.</b> Receive your notifications there and manage your deals, leads and approvals by chat.
      </span>
      <button onClick={connect} disabled={busy} className="rounded-full px-3 py-1 font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)', opacity: busy ? 0.6 : 1 }}>
        {busy ? '…' : 'Connect Telegram'}
      </button>
      <button onClick={snooze} className="underline" style={{ color: 'var(--text-muted)' }}>Not now</button>
      {note && <span style={{ color: 'var(--text-muted)' }}>{note}</span>}
    </div>
  );
}
