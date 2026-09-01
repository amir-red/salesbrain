'use client';

import { useEffect, useState, useCallback } from 'react';

interface ServiceToken {
  id: string;
  app_key: string;
  token_prefix: string;
  name: string;
  last_used_at: string | null;
  created_at: string;
}

/**
 * Admin-only: mint the bearer token a sibling internal app uses on
 * /api/service-mcp (Outreach as a Service). One token per app; the app then
 * acts on behalf of its employees via the X-On-Behalf-Of header. See
 * docs/service-mcp.md.
 */
export default function ServiceTokenPanel() {
  const [tokens, setTokens] = useState<ServiceToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [appKey, setAppKey] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/service-tokens');
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
      const data = await res.json();
      setTokens(data.tokens || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    if (!appKey.trim() || !newName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/service-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_key: appKey.trim(), name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      setRevealed({ token: data.token, name: data.name });
      setNewName('');
      setAppKey('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (!confirm(`Revoke "${name}"? The app using this token will stop working immediately.`)) return;
    try {
      const res = await fetch(`/api/admin/service-tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Revoke failed');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Revoke failed');
    }
  }

  return (
    <div>
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h1 className="text-lg font-bold">Service API tokens</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Bearer tokens for a sibling internal app to drive the outreach pipeline (ICP → find → enrich → draft → send)
          on behalf of its own employees, via <span className="font-mono">/api/service-mcp</span>. One token per app.
          Admin only. Revoke any time.
        </p>
        <a href="/admin/service" className="inline-block mt-2 text-xs" style={{ color: 'var(--accent)' }}>
          View service activity (per app &amp; employee) →
        </a>
      </div>

      <div className="p-4 max-w-3xl">
        {/* Create form */}
        <section
          className="rounded-lg p-4 mb-6"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
        >
          <h2 className="text-sm font-semibold mb-2">Issue a token to an app</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text)' }}>App key</strong> namespaces that app&apos;s employee ids
            (e.g. <span className="font-mono">chipchip-outbound</span>). The token is shown once — save it in the app&apos;s secrets.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              placeholder="app key — e.g. chipchip-outbound"
              className="flex-1 px-3 py-2 rounded text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="label — e.g. ChipChip outbound (prod)"
              className="flex-1 px-3 py-2 rounded text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
            />
            <button
              onClick={generate}
              disabled={!appKey.trim() || !newName.trim() || creating}
              className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {creating ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </section>

        {/* Existing tokens */}
        <section>
          <h2 className="text-sm font-semibold mb-2">Active tokens</h2>
          {error && (
            <div className="rounded p-2 mb-3 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              {error}
            </div>
          )}
          {loading ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : tokens.length === 0 ? (
            <div className="rounded-lg p-6 text-center text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              No service tokens yet. Issue one above.
            </div>
          ) : (
            <div className="space-y-2">
              {tokens.map((t) => (
                <div
                  key={t.id}
                  className="rounded p-3 flex items-center justify-between gap-4"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {t.name}
                      <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{t.app_key}</span>
                    </p>
                    <p className="text-[10px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
                      {t.token_prefix}… · created {new Date(t.created_at).toLocaleDateString()}
                      {t.last_used_at
                        ? <> · last used {new Date(t.last_used_at).toLocaleString()}</>
                        : <> · never used</>}
                    </p>
                  </div>
                  <button
                    onClick={() => revoke(t.id, t.name)}
                    className="px-3 py-1.5 rounded text-xs"
                    style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Integration hint */}
        <section className="mt-6 rounded-lg p-4 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <p className="mb-1"><strong style={{ color: 'var(--text)' }}>Wiring the app:</strong></p>
          <p>
            Point it at <span className="font-mono">https://salescrm.chipchip.social/api/service-mcp</span> with
            <span className="font-mono"> Authorization: Bearer &lt;token&gt;</span>, register each employee once
            (<span className="font-mono">register_user</span>), then send <span className="font-mono">X-On-Behalf-Of: &lt;employee_id&gt;</span>
            on every call. Full contract in <span className="font-mono">docs/service-mcp.md</span>.
          </p>
        </section>
      </div>

      {/* One-time reveal modal */}
      {revealed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setRevealed(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '2px solid #eab308' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-base font-bold" style={{ color: '#eab308' }}>
                ⚠️ Save this token now
              </h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                This is the ONLY time the full value of &quot;{revealed.name}&quot; is shown. Copy it into the app&apos;s secrets now.
              </p>
            </div>
            <div className="p-4">
              <div
                className="rounded p-3 font-mono text-xs break-all"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                {revealed.token}
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(revealed.token); }}
                className="mt-3 w-full py-2 rounded text-sm font-medium"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                Copy to clipboard
              </button>
            </div>
            <div className="px-4 py-3 border-t flex justify-end" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => setRevealed(null)}
                className="px-4 py-2 rounded text-xs font-medium text-white"
                style={{ background: 'var(--accent)' }}
              >
                I&apos;ve saved it — close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
