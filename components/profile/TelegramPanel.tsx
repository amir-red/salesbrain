'use client';

import { useCallback, useEffect, useState } from 'react';

interface LinkState {
  linked: boolean;
  link: {
    telegram_username: string | null;
    telegram_first_name: string | null;
    telegram_last_name: string | null;
    linked_at: string;
  } | null;
}

interface TokenReveal {
  raw: string;
  expires_at: string;
  botUsername: string | null;
}

export default function TelegramPanel() {
  const [state, setState] = useState<LinkState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<TokenReveal | null>(null);
  const [copied, setCopied] = useState(false);

  // Clipboard with feedback + legacy fallback (some browsers gate
  // navigator.clipboard behind permissions and fail silently).
  const copyCode = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/telegram/link-tokens');
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setState(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch('/api/telegram/link-tokens', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setReveal({ raw: data.raw_token, expires_at: data.expires_at, botUsername: data.bot_username });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!confirm('Unlink your Telegram account? You won\'t receive messages or notifications until you re-link.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/telegram/link', { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const linkedName =
    state?.link?.telegram_username ? `@${state.link.telegram_username}`
    : [state?.link?.telegram_first_name, state?.link?.telegram_last_name].filter(Boolean).join(' ')
    || 'Telegram user';

  return (
    <div>
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Telegram Bot</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Link your Telegram account to chat with the SalesBrain assistant, ask about your deals in natural language, and receive push notifications for SLA breaches and new assignments.
          </p>
        </div>

        <div className="p-4 max-w-3xl">
          {error && (
            <div className="rounded p-2 mb-3 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : state?.linked ? (
            // Linked state
            <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                >
                  Linked
                </span>
                <p className="text-sm font-medium">{linkedName}</p>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Linked {state.link ? new Date(state.link.linked_at).toLocaleString() : ''}.
                DM the bot on Telegram to start brainstorming.
              </p>
              <button
                onClick={unlink}
                disabled={busy}
                className="mt-3 px-3 py-1.5 rounded text-xs"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                Unlink
              </button>
            </div>
          ) : (
            // Not linked — show flow
            <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-2">Link your Telegram account</h2>
              <ol className="text-xs space-y-2 mb-4" style={{ color: 'var(--text-muted)' }}>
                <li>1. Click <strong>Generate linking code</strong> below.</li>
                <li>2. Open Telegram and start a chat with the SalesBrain bot.</li>
                <li>3. Send the code as a message: <span className="font-mono">/start LINK-XXXXXX</span>.</li>
                <li>4. Bot confirms the link. Refresh this page to see the linked state.</li>
              </ol>
              <button
                onClick={generate}
                disabled={busy}
                className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {busy ? 'Generating…' : 'Generate linking code'}
              </button>
            </div>
          )}

          <section className="mt-6 rounded-lg p-4 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <p><strong style={{ color: 'var(--text)' }}>What linking gets you:</strong></p>
            <ul className="mt-2 space-y-1 list-disc pl-4">
              <li>Chat with SalesBrain in natural language from Telegram — same tools as MCP, same visibility scope</li>
              <li>Push notifications when your deals breach SLA</li>
              <li>Push notifications when a new deal is assigned to you as lead</li>
              <li>Existing board-review voting (in the group chat) is unaffected — you don&apos;t need to be linked for that</li>
            </ul>
          </section>
        </div>

      {/* Reveal modal */}
      {reveal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setReveal(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '2px solid var(--accent)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-base font-bold">Send this to the bot</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Expires {new Date(reveal.expires_at).toLocaleString()}. Single use.
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
                  Message to send
                </label>
                <div
                  className="rounded p-3 font-mono text-sm break-all"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                >
                  /start {reveal.raw}
                </div>
              </div>
              <button
                onClick={() => copyCode(`/start ${reveal.raw}`)}
                className="w-full py-2 rounded text-sm font-medium transition-colors"
                style={{
                  background: copied ? 'var(--accent-glow)' : 'var(--bg-input)',
                  border: `1px solid ${copied ? 'var(--accent)' : 'var(--border)'}`,
                  color: copied ? 'var(--accent)' : 'var(--text)',
                }}
              >
                {copied ? '✓ Copied' : 'Copy to clipboard'}
              </button>
              {reveal.botUsername && (
                <>
                  <a
                    href={`https://t.me/${reveal.botUsername}?start=${reveal.raw}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full py-2 rounded text-sm font-medium text-center text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    Open in Telegram →
                  </a>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Telegram shows the sent message as a bare “/start” — the code travels
                    hidden inside it. If the bot doesn&apos;t confirm within a few seconds,
                    paste the full message above manually.
                  </p>
                </>
              )}
            </div>
            <div className="px-4 py-3 border-t flex justify-end" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => { setReveal(null); load(); }}
                className="px-4 py-2 rounded text-xs font-medium"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
