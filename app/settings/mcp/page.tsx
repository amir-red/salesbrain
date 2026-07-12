'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';

interface McpToken {
  id: string;
  token_prefix: string;
  name: string;
  last_used_at: string | null;
  created_at: string;
}

export default function McpSettingsPage() {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-token form state
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // One-time reveal modal
  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/mcp/tokens');
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
    if (!newName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      setRevealed({ token: data.raw_token, name: data.token.name });
      setNewName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (!confirm(`Revoke "${name}"? Any client using this token will stop working immediately.`)) return;
    try {
      const res = await fetch(`/api/mcp/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Revoke failed');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Revoke failed');
    }
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">MCP Tokens</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Personal bearer tokens for connecting external agents (Hermes, Claude Desktop, Cursor, etc.) to your SalesBrain account.
            Tokens act on your behalf and inherit your visibility scope — you only see the deals you created or lead. Revoke any time.
          </p>
        </div>

        <div className="p-4 max-w-3xl">
          {/* Create form */}
          <section
            className="rounded-lg p-4 mb-6"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          >
            <h2 className="text-sm font-semibold mb-2">Generate a new token</h2>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              Give the token a label so you can identify it later (e.g. &quot;Hermes on my laptop&quot;). The token is shown once — save it somewhere safe.
            </p>
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Hermes production"
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
                onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
              />
              <button
                onClick={generate}
                disabled={!newName.trim() || creating}
                className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {creating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </section>

          {/* Existing tokens */}
          <section>
            <h2 className="text-sm font-semibold mb-2">Your tokens</h2>
            {error && (
              <div className="rounded p-2 mb-3 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                {error}
              </div>
            )}
            {loading ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : tokens.length === 0 ? (
              <div className="rounded-lg p-6 text-center text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                No tokens yet. Generate one above to get started.
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
                      <p className="text-sm font-medium truncate">{t.name}</p>
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
            <p className="mb-1"><strong style={{ color: 'var(--text)' }}>Connecting an MCP client:</strong></p>
            <p>Point it at <span className="font-mono">https://salescrm.chipchip.social/api/mcp</span> and send your token in the <span className="font-mono">Authorization: Bearer &lt;token&gt;</span> header. See docs/mcp-integration.md for the full protocol reference.</p>
          </section>
        </div>
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
                This is the ONLY time you&apos;ll see the full value of &quot;{revealed.name}&quot;. Copy it into your password manager or MCP client config now.
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
