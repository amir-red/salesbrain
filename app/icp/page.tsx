'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import IcpBuilder from '@/components/icp/IcpBuilder';
import IcpLeads, { RunPill } from '@/components/icp/IcpLeads';
import { PRODUCTS, OBJECTIVES, summarizeCriteria } from '@/lib/icp';
import type { IcpProfile } from '@/lib/icp';
import { relativeTime } from '@/lib/time';

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; profile: IcpProfile } | { kind: 'leads'; profile: IcpProfile };

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/icp');
      if (res.ok) setProfiles(await res.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** running | paused | stopped — the per-ICP switch. Pause is the reversible
   *  one: it holds sourcing, enrichment, drafting AND sending for this profile
   *  alone, without touching any other ICP or anyone else's agents. */
  const setState = async (p: IcpProfile, state: 'running' | 'paused' | 'stopped') => {
    let reason: string | undefined;
    if (state === 'paused') {
      const answer = prompt(`Pause "${p.name}"?\n\nSourcing, enrichment, drafting and sending stop for this ICP only. Its leads and history are untouched, and Resume puts it straight back.\n\nReason (optional):`);
      if (answer === null) return;
      reason = answer.trim() || undefined;
    }
    setBusy(p.id);
    try {
      const res = await fetch(`/api/icp/${p.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) alert(json.error || 'Could not change the state');
      await load();
    } finally { setBusy(null); }
  };

  const archive = async (p: IcpProfile) => {
    if (!confirm(`Archive "${p.name}"? Its prospects keep their link; re-creating the same name revives it.`)) return;
    setBusy(p.id);
    try {
      const res = await fetch(`/api/icp/${p.id}`, { method: 'DELETE' });
      if (res.ok) await load();
    } finally { setBusy(null); }
  };

  const runAgent = (p: IcpProfile) => async (mode: 'now' | 'queue' | 'enrich') => {
    const res = await fetch(`/api/icp/${p.id}/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    });
    const out = await res.json();
    load();
    return out;
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
              {mode.kind === 'list' ? 'Ideal Customer Profiles' : mode.kind === 'new' ? 'New ICP' : mode.kind === 'leads' ? mode.profile.name : `Edit · ${mode.profile.name}`}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {mode.kind === 'list'
                ? `${profiles.length} active · who to look for on LinkedIn, and what makes them a fit`
                : mode.kind === 'leads'
                  ? 'The list the Leads Finder fills for this ICP, and what it did on each tick.'
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

        {mode.kind === 'leads' && <IcpLeads profile={mode.profile} onRun={runAgent(mode.profile)} />}
        {mode.kind === 'leads' && (
          <div className="px-4 pb-4">
            <button onClick={() => setMode({ kind: 'edit', profile: mode.profile })} className="text-xs underline" style={{ color: 'var(--text-muted)' }}>Edit this ICP</button>
          </div>
        )}

        {(mode.kind === 'new' || mode.kind === 'edit') && (
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
                      <div className="text-[11px] flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                        {productLabel(p.product)} · updated {relativeTime(p.updated_at)}
                        {p.objective && (
                          <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text)' }}>
                            ⌾ {OBJECTIVES.find((o) => o.key === p.objective)?.label ?? p.objective}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
                      {p.prospects ?? 0} on list · {p.matched_prospects ?? 0} matched
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

                  {p.paused_at && (
                    <div className="rounded-lg px-2 py-1 text-xs" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                      ⏸ Paused {relativeTime(p.paused_at)}
                      {p.paused_reason ? ` — ${p.paused_reason}` : ''}
                      {p.paused_by_admin ? ' · by an administrator' : ''}
                    </div>
                  )}

                  <div><RunPill run={p.last_run ?? null} queued={p.queued_runs ?? 0} state={p.agent_state ?? null} /></div>

                  <div className="mt-auto flex gap-2 pt-1">
                    <button onClick={() => setMode({ kind: 'edit', profile: p })} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Edit</button>
                    <button onClick={() => setMode({ kind: 'leads', profile: p })} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--accent)', color: '#fff' }} title="The list the Leads Finder fills, and its activity">
                      Leads →
                    </button>
                    {p.paused_at ? (
                      <button onClick={() => setState(p, 'running')} disabled={busy === p.id} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }} title="Resume sourcing, enrichment, drafting and sending for this ICP">
                        Resume
                      </button>
                    ) : (
                      <button onClick={() => setState(p, 'paused')} disabled={busy === p.id} className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} title="Hold this ICP only — reversible, nothing is lost">
                        Pause
                      </button>
                    )}
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
