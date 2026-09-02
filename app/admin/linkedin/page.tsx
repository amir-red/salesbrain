'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { relativeTime } from '@/lib/time';

const ACTIONS = ['search', 'profile_view', 'message', 'relations', 'inbox_read', 'params'] as const;
type Action = typeof ACTIONS[number];
const LABEL: Record<Action, string> = {
  search: 'Searches', profile_view: 'Profile views', message: 'Messages',
  relations: 'Connections', inbox_read: 'Inbox reads', params: 'Filter lookups',
};

interface Account {
  unipile_account_id: string;
  display_name: string | null;
  public_identifier: string | null;
  owner_name: string | null;
  tier: 'sales_navigator' | 'free';
  proxy_country: string | null;
  paused_at: string | null;
  pause_reason: string | null;
  consecutive_errors: number;
  caps: Partial<Record<Action, number>>;
  today: Record<Action, number>;
  errors_24h: number;
  blocks_24h: number;
  trend: { day: string; n: number }[];
}
interface Payload { accounts: Account[]; min_gap_seconds: number }

export default function LinkedInHealthPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/linkedin-health');
      if (res.status === 403) throw new Error('Admin only — sign in as an admin to view LinkedIn health.');
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function resume(acct: string) {
    setBusy(acct);
    try {
      const res = await fetch('/api/admin/linkedin-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unipile_account_id: acct }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Resume failed');
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)' } as const;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">LinkedIn health</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Every request we make to each connected LinkedIn account today, against a safe daily ceiling —
              so accounts don&apos;t get flagged for automation. Calls are paced ≥{data?.min_gap_seconds ?? 6}s apart.
            </p>
          </div>
          <button onClick={load} className="px-3 py-1.5 rounded text-xs" style={{ ...card, color: 'var(--text-muted)' }}>Refresh</button>
        </div>

        <div className="p-4 max-w-5xl">
          {error && <div className="rounded p-3 mb-4 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}
          {loading ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : !data?.accounts.length && !error ? (
            <div className="rounded-lg p-8 text-center text-xs" style={{ ...card, color: 'var(--text-muted)' }}>
              No connected LinkedIn accounts yet.
            </div>
          ) : (
            <div className="space-y-4">
              {data!.accounts.map((a) => {
                const maxTrend = Math.max(1, ...a.trend.map((t) => t.n));
                const anyHot = ACTIONS.some((k) => (a.caps[k] || 0) > 0 && a.today[k] / (a.caps[k] || 1) >= 0.8);
                return (
                  <div key={a.unipile_account_id} className="rounded-lg p-4" style={card}>
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          {a.display_name || a.public_identifier || a.unipile_account_id}
                          <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                            style={{ background: a.tier === 'sales_navigator' ? 'var(--accent-glow)' : 'var(--bg-input)',
                                     color: a.tier === 'sales_navigator' ? 'var(--accent)' : 'var(--text-muted)' }}>
                            {a.tier === 'sales_navigator' ? 'Sales Navigator' : 'Free'}
                          </span>
                          {a.proxy_country && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>· {a.proxy_country}</span>}
                        </div>
                        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {a.owner_name || '—'}
                          {a.errors_24h > 0 && <span> · {a.errors_24h} errors/24h</span>}
                          {a.blocks_24h > 0 && <span style={{ color: '#ef4444' }}> · {a.blocks_24h} blocked</span>}
                        </div>
                      </div>
                      {a.paused_at && (
                        <button onClick={() => resume(a.unipile_account_id)} disabled={busy === a.unipile_account_id}
                          className="px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
                          style={{ background: 'var(--green)' }}>
                          {busy === a.unipile_account_id ? '…' : 'Resume'}
                        </button>
                      )}
                    </div>

                    {a.paused_at && (
                      <div className="rounded p-2 mb-3 text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                        ⏸ Paused {relativeTime(a.paused_at)} — {a.pause_reason || 'agent paused'}
                      </div>
                    )}

                    {/* usage bars */}
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
                      {ACTIONS.map((k) => {
                        const used = a.today[k] || 0; const cap = a.caps[k] || 0;
                        const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
                        const col = pct >= 90 ? '#ef4444' : pct >= 70 ? 'var(--yellow)' : 'var(--accent)';
                        return (
                          <div key={k}>
                            <div className="flex justify-between text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>
                              <span>{LABEL[k]}</span>
                              <span className="font-mono" style={{ color: pct >= 90 ? '#ef4444' : 'var(--text)' }}>{used}/{cap || '∞'}</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 7-day trend */}
                    {a.trend.length > 0 && (
                      <div className="mt-3 flex items-end gap-1 h-10">
                        {a.trend.map((t) => (
                          <div key={t.day} title={`${t.day}: ${t.n} calls`}
                            className="flex-1 rounded-t" style={{ height: `${Math.max(6, (t.n / maxTrend) * 100)}%`, background: 'var(--accent)', opacity: 0.5 }} />
                        ))}
                        <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>7-day</span>
                      </div>
                    )}
                    {anyHot && !a.paused_at && (
                      <div className="mt-2 text-[10px]" style={{ color: 'var(--yellow)' }}>⚠ Approaching a daily cap — the agent will pace/back off automatically.</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
