'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface StatusState {
  connected: boolean;
  account?: {
    display_name: string | null;
    public_identifier: string | null;
    premium_features: string[] | null;
    proxy_country: string | null;
    connected_at: string;
    last_synced_at: string | null;
  };
  threads?: number;
  awaiting_you?: number;
  note?: string;
}

export default function LinkedInPanel() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <LinkedInSettings />
    </Suspense>
  );
}

function LinkedInSettings() {
  const params = useSearchParams();
  const [state, setState] = useState<StatusState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/linkedin/connect');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setState(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Coming back from Unipile's hosted flow: claim the account for this session.
  const claim = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/linkedin/claim', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to bind account');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }, [load]);

  // Depend on the VALUES we read, not the params object itself. The object
  // identity changes whenever the URL does — and switching tabs rewrites the
  // URL — so depending on it re-ran this effect on every tab click, firing a
  // second status check. Each one spawns a Python subprocess and writes an
  // audit row, so the duplicates were visible in the audit log.
  const connectedParam = params.get('connected');
  const failedParam = params.get('failed');

  useEffect(() => {
    if (connectedParam === '1') claim();
    else load();
    if (failedParam === '1') setError('LinkedIn connection was cancelled or failed.');
  }, [connectedParam, failedParam, claim, load]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/linkedin/connect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start the connect flow');
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect LinkedIn? Syncing stops immediately. Past conversations stay in the CRM.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/linkedin/connect', { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const acc = state?.account;
  const hasSalesNav = !!acc?.premium_features?.includes('sales_navigator');

  return (
    <div>
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">LinkedIn</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Connect your LinkedIn account so the assistant can triage your inbox, draft replies for
            your approval, and follow up on new connections. Your inbox stays yours — nobody else on
            the team can read it.
          </p>
        </div>

        <div className="p-4 max-w-3xl">
          {error && (
            <div className="rounded p-2 mb-3 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              {error}
            </div>
          )}

          {loading || busy ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {busy ? 'Working…' : 'Loading…'}
            </p>
          ) : state?.connected && acc ? (
            <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                >
                  Connected
                </span>
                <p className="text-sm font-medium">{acc.display_name || acc.public_identifier}</p>
                {hasSalesNav && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>
                    Sales Navigator
                  </span>
                )}
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {state.threads ?? 0} conversations synced
                {typeof state.awaiting_you === 'number' && ` · ${state.awaiting_you} awaiting your reply`}
                {acc.last_synced_at && ` · last synced ${new Date(acc.last_synced_at).toLocaleString()}`}
              </p>
              {acc.proxy_country && (
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  Session egress: <span className="font-mono">{acc.proxy_country.toUpperCase()}</span>.
                  If that is far from where you actually use LinkedIn, tell an admin — a large
                  mismatch is one of the signals LinkedIn checks.
                </p>
              )}
              <button
                onClick={disconnect}
                className="mt-3 px-3 py-1.5 rounded text-xs"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-2">Connect your LinkedIn account</h2>
              <ol className="text-xs space-y-2 mb-4" style={{ color: 'var(--text-muted)' }}>
                <li>1. Click <strong>Connect LinkedIn</strong> — you&apos;ll be taken to our provider&apos;s secure page.</li>
                <li>2. Sign in there with your own LinkedIn credentials (2FA included if you use it).</li>
                <li>3. You&apos;ll come straight back here and your inbox starts syncing.</li>
              </ol>
              <button
                onClick={connect}
                className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                Connect LinkedIn
              </button>
            </div>
          )}

          <section className="mt-6 rounded-lg p-4 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <p><strong style={{ color: 'var(--text)' }}>Before you connect — please read:</strong></p>
            <ul className="mt-2 space-y-1 list-disc pl-4">
              <li>
                <strong style={{ color: 'var(--text)' }}>We never see your password.</strong> You enter it on
                the provider&apos;s page; we only ever store an opaque account id.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>The assistant can read your whole LinkedIn inbox</strong> —
                including personal conversations. That is how it separates real opportunities from
                pitch noise. Only you can see it: LinkedIn tools are excluded from the board group
                and from admin-wide visibility, unlike deals.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Nothing is sent without you approving it</strong>, word
                for word. There is no automated connecting and no automated messaging.
              </li>
              <li>
                Automating LinkedIn is against LinkedIn&apos;s terms of service. We keep the volume low
                and human-approved to stay well inside normal use, but the account risk is yours to
                accept — don&apos;t connect an account you can&apos;t afford to lose.
              </li>
              <li>You can disconnect at any time; syncing stops immediately.</li>
            </ul>
          </section>
        </div>
      </div>
  );
}
