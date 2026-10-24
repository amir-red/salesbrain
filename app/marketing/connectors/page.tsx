'use client';

/**
 * /marketing/connectors — connect the ad platforms the CRM pulls performance
 * data from. One card per provider: status, what the flow will ask for, and
 * what the operator still has to configure (shown straight from the server's
 * env check, so the page never says "ready" when the server is not).
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { AD_PROVIDERS, PROVIDER_META, type ConnectorStatus } from '@/lib/marketing';

export default function AdConnectorsPage() {
  return <Suspense fallback={null}><Connectors /></Suspense>;
}

function Connectors() {
  const params = useSearchParams();
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [notice, setNotice] = useState<{ provider: string; text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/marketing/connectors')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setConnectors(d?.connectors ?? []))
      .catch(() => setConnectors([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Landing back from the LinkedIn consent screen.
  useEffect(() => {
    const ok = params.get('connected'); const err = params.get('error');
    if (ok) setNotice({ provider: ok, error: false, text: 'Connected. The Marketing page now reads this account.' });
    else if (err) setNotice({ provider: 'linkedin_ads', error: true, text: `Connect failed: ${err}` });
  }, [params]);

  const connect = async (provider: string) => {
    setBusy(provider); setNotice(null);
    const meta = PROVIDER_META[provider as keyof typeof PROVIDER_META];
    if (meta.auth === 'oauth') { window.location.href = `/api/marketing/connectors/${provider}/connect`; return; }
    try {
      // Service account: the route verifies access with one API call.
      const res = await fetch(`/api/marketing/connectors/${provider}/connect`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.verified) {
        const v = body.verified as { customer_id: string; name: string | null; currency: string | null };
        setNotice({ provider, error: false, text: `Verified: ${v.name ?? 'account'} ${v.customer_id}${v.currency ? ` · ${v.currency}` : ''}` });
        load();
      } else {
        const missing: string[] = body.missing_env ?? [];
        setNotice({ provider, error: true, text: missing.length ? `${body.error}. Missing: ${missing.join(', ')}` : (body.error ?? `HTTP ${res.status}`) });
      }
    } finally { setBusy(null); }
  };

  const disconnect = async (provider: string) => {
    setBusy(provider); setNotice(null);
    try {
      const res = await fetch(`/api/marketing/connectors/${provider}/disconnect`, { method: 'POST' });
      if (res.ok) { setNotice({ provider, error: false, text: 'Disconnected. Pulled data is kept.' }); load(); }
      else setNotice({ provider, error: true, text: `Could not disconnect (HTTP ${res.status})` });
    } finally { setBusy(null); }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Link href="/marketing" className="text-sm" style={{ color: 'var(--text-muted)' }} title="Back to Marketing" aria-label="Back to Marketing">←</Link>
            Ad connectors
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Marketing settings · read-only access to ad accounts. Each person connects their own login; the CRM never creates or edits ads.
          </p>
        </div>

        <div className="p-4 grid gap-4 lg:grid-cols-2 max-w-6xl">
          {AD_PROVIDERS.map((id) => {
            const meta = PROVIDER_META[id];
            const st = connectors?.find((c) => c.provider === id);
            const loading = connectors === null;
            const ready = !!st && st.missing_env.length === 0;
            return (
              <div key={id} className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{meta.label}</h2>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{meta.blurb}</p>
                  </div>
                  <StatusPill loading={loading} connected={!!st?.connected} ready={ready} />
                </div>

                {st?.connected && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {meta.auth === 'service_account' ? 'Service account ' : 'Connected by '}<span style={{ color: 'var(--text)' }}>{st.account_label ?? 'unknown account'}</span>
                    {st.connected_at && <> · since {new Date(st.connected_at).toLocaleDateString()}</>}
                  </p>
                )}

                {!loading && !st?.connected && st && st.missing_env.length > 0 && (
                  <div className="rounded-lg p-2.5 text-xs" style={{ background: 'color-mix(in srgb, var(--yellow) 12%, transparent)', color: 'var(--text)' }}>
                    <div className="font-medium">Server not configured</div>
                    <div className="mt-0.5" style={{ color: 'var(--text-muted)' }}>Set in <code>.env.local</code> (dev) / GitHub secrets (prod): <code>{st.missing_env.join(', ')}</code></div>
                  </div>
                )}

                <details className="text-xs">
                  <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>{meta.auth === 'oauth' ? 'What connecting asks for, and what has to exist first' : 'How the service account gets access'}</summary>
                  <div className="mt-2 space-y-2" style={{ color: 'var(--text-muted)' }}>
                    <div>
                      <div className="z-eyebrow mb-1">{meta.auth === 'oauth' ? 'Scopes requested' : 'API scope used'}</div>
                      <ul className="list-disc pl-4 space-y-0.5">{meta.scopes.map((s) => <li key={s}><code>{s}</code></li>)}</ul>
                    </div>
                    <div>
                      <div className="z-eyebrow mb-1">Setup outside this app</div>
                      <ul className="list-disc pl-4 space-y-0.5">{meta.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul>
                    </div>
                    <a href={meta.docs} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent)' }}>Platform API docs ↗</a>
                  </div>
                </details>

                {notice?.provider === id && (
                  <p className="text-xs" role="status" style={{ color: notice.error ? 'var(--red)' : 'var(--green)' }}>{notice.text}</p>
                )}

                <div className="flex gap-2 mt-auto">
                  {meta.auth === 'service_account' ? (
                    <button onClick={() => connect(id)} disabled={loading || busy === id || !ready} className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                      title={ready ? 'Make one read call to confirm the service account can see the ad account' : 'Set the env vars first'}>
                      {busy === id ? 'Checking…' : 'Verify access'}
                    </button>
                  ) : st?.connected ? (
                    <>
                      <button onClick={() => connect(id)} disabled={busy === id} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Reconnect</button>
                      <button onClick={() => disconnect(id)} disabled={busy === id} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Disconnect</button>
                    </>
                  ) : (
                    <button onClick={() => connect(id)} disabled={loading || busy === id || !ready} className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                      {busy === id ? 'Starting…' : `Connect ${meta.label}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ loading, connected, ready }: { loading: boolean; connected: boolean; ready: boolean }) {
  const [text, color] = loading
    ? ['…', 'var(--text-muted)']
    : connected
      ? ['Connected', 'var(--green)']
      : ready
        ? ['Not connected', 'var(--text-muted)']
        : ['Needs setup', 'var(--yellow)'];
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)` }}>
      {text}
    </span>
  );
}
