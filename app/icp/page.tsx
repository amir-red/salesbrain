'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import IcpBuilder from '@/components/icp/IcpBuilder';
import { PRODUCTS, summarizeCriteria } from '@/lib/icp';
import type { IcpProfile } from '@/lib/icp';
import { relativeTime } from '@/lib/time';

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; profile: IcpProfile };

interface SearchOutcome {
  icp?: string; matched_total?: number | null; fetched?: number; new_prospects?: number;
  already_known?: number; filter_notes?: string[]; error?: string;
}

/**
 * /icp — the list of ideal-customer profiles and the builder. An ICP is what
 * crm_prospect_search sources against and what every prospect is scored by;
 * until now it could only be defined through the agent (crm_icp_define).
 */
export default function IcpPage() {
  const [profiles, setProfiles] = useState<IcpProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; res: SearchOutcome } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/icp');
      if (res.ok) setProfiles(await res.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const archive = async (p: IcpProfile) => {
    if (!confirm(`Archive "${p.name}"? Its prospects keep their link; re-creating the same name revives it.`)) return;
    setBusy(p.id);
    try {
      const res = await fetch(`/api/icp/${p.id}`, { method: 'DELETE' });
      if (res.ok) await load();
    } finally { setBusy(null); }
  };

  const source = async (p: IcpProfile) => {
    if (!confirm(`Search Sales Navigator for "${p.name}" now?\n\nThis spends LinkedIn search quota (account-level, ~20 searches/day) and lands up to 25 scored prospects.`)) return;
    setBusy(p.id); setOutcome(null);
    try {
      const res = await fetch(`/api/icp/${p.id}/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 25 }),
      });
      const data = await res.json();
      setOutcome({ id: p.id, res: res.ok ? data : { error: data.error || 'Search failed' } });
      if (res.ok) load();
    } catch (e) {
      setOutcome({ id: p.id, res: { error: e instanceof Error ? e.message : 'Search failed' } });
    } finally { setBusy(null); }
  };

  const productLabel = (k: string | null) => PRODUCTS.find((p) => p.key === k)?.label ?? k ?? '—';

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              {mode.kind !== 'list' && (
                <button onClick={() => setMode({ kind: 'list' })} className="text-sm" style={{ color: 'var(--text-muted)' }} title="Back">←</button>
              )}
              {mode.kind === 'list' ? 'Ideal Customer Profiles' : mode.kind === 'new' ? 'New ICP' : `Edit · ${mode.profile.name}`}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {mode.kind === 'list'
                ? `${profiles.length} active · who to look for on LinkedIn, and what makes them a fit`
                : 'Every prospect sourced or imported is scored against this profile, with reasons.'}
            </p>
          </div>
          {mode.kind === 'list' && (
            <div className="flex items-center gap-3">
              <Link href="/prospecting" className="text-xs underline" style={{ color: 'var(--text-muted)' }}>Prospects →</Link>
              <button onClick={() => setMode({ kind: 'new' })} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
                + New ICP
              </button>
            </div>
          )}
        </div>

        {mode.kind !== 'list' && (
          <IcpBuilder
            initial={mode.kind === 'edit' ? mode.profile : null}
            onSaved={() => { setMode({ kind: 'list' }); load(); }}
            onCancel={() => setMode({ kind: 'list' })}
          />
        )}

        {mode.kind === 'list' && (
          <div className="p-4">
            {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
            {!loading && profiles.length === 0 && (
              <div className="text-center py-16 space-y-2" style={{ color: 'var(--text-muted)' }}>
                <p className="text-sm">No ICP yet.</p>
                <p className="text-xs">Describe who you sell to — or paste your website and let AI draft the first one.</p>
                <button onClick={() => setMode({ kind: 'new' })} className="mt-2 px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
                  Create your first ICP
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
              {profiles.map((p) => (
                <div key={p.id} className="rounded-xl p-4 space-y-3 flex flex-col" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {productLabel(p.product)} · updated {relativeTime(p.updated_at)}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
                      {p.prospects ?? 0} prospects
                    </span>
                  </div>
                  {p.description && <p className="text-xs line-clamp-2" style={{ color: 'var(--text-muted)' }}>{p.description}</p>}
                  <p className="text-xs">{summarizeCriteria(p.criteria)}</p>
                  <div className="flex flex-wrap gap-1">
                    {p.criteria.titles.slice(0, 5).map((t) => <Chip key={t} text={t} />)}
                    {p.criteria.titles.length > 5 && <Chip text={`+${p.criteria.titles.length - 5}`} />}
                  </div>
                  {(p.criteria.exclude_companies.length > 0) && (
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Avoids: {p.criteria.exclude_companies.join(', ')}
                    </div>
                  )}

                  {outcome?.id === p.id && (
                    <div className="text-[11px] rounded-lg p-2 space-y-1" style={{ background: 'var(--bg-input)', color: outcome.res.error ? 'var(--red)' : 'var(--text)' }}>
                      {outcome.res.error ? outcome.res.error : (
                        <>
                          <div>LinkedIn matched {outcome.res.matched_total ?? '?'} · fetched {outcome.res.fetched} · <b>{outcome.res.new_prospects} new</b> · {outcome.res.already_known} already known</div>
                          {outcome.res.filter_notes?.map((n, i) => <div key={i} style={{ color: 'var(--text-muted)' }}>· {n}</div>)}
                          <Link href="/prospecting" className="underline" style={{ color: 'var(--accent)' }}>See prospects →</Link>
                        </>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex gap-2 pt-1">
                    <button onClick={() => setMode({ kind: 'edit', profile: p })} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Edit</button>
                    <button onClick={() => source(p)} disabled={busy === p.id} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }} title="Run crm_prospect_search for this ICP (uses LinkedIn quota)">
                      {busy === p.id ? 'Working…' : 'Source from LinkedIn'}
                    </button>
                    <button onClick={() => archive(p)} disabled={busy === p.id} className="ml-auto px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>Archive</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ text }: { text: string }) {
  return <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{text}</span>;
}
