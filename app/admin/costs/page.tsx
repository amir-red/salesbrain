'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import SectionCard from '@/components/panel/SectionCard';
import StatTile from '@/components/panel/StatTile';
import Sparkline from '@/components/panel/Sparkline';
import { SURFACE_LABELS, WINDOWS, tokens, usd } from '@/lib/costs-panel';
import type { CostBucket, CostReport } from '@/lib/costs-panel';

/**
 * /admin/costs — what the system costs to run: LLM tokens, Unipile, email
 * credits and the flat monthly items, over 7 / 30 / 90 days. One kernel call
 * per load (`cost_report`, app-only); refreshed by hand, not polled.
 */
export default function CostsAdminPage() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<CostReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/costs?days=${days}`);
      if (res.status === 403) { setForbidden(true); return; }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load costs');
      setData(json as CostReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const u = data?.unit_costs;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Costs</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              What the system costs to run — a tracked estimate; reconcile LLM spend with the AWS invoice
              {' · '}<button onClick={() => load()} className="underline" disabled={loading}>{loading ? 'loading…' : 'refresh'}</button>
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {WINDOWS.map((w) => (
                <button key={w} onClick={() => setDays(w)} className="px-2.5 py-1"
                        style={{ background: days === w ? 'var(--accent)' : 'transparent', color: days === w ? '#fff' : 'var(--text-muted)' }}>
                  {w}d
                </button>
              ))}
            </div>
            <Link href="/agents" className="underline" style={{ color: 'var(--text-muted)' }}>Agents →</Link>
            <Link href="/admin/users" className="underline" style={{ color: 'var(--text-muted)' }}>Users →</Link>
            <Link href="/admin/linkedin" className="underline" style={{ color: 'var(--text-muted)' }}>LinkedIn health →</Link>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {forbidden && <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>Admin only — sign in as an administrator to see costs.</div>}
          {error && <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>{error}{data ? ' — showing the previous data.' : ''}</div>}
          {loading && !data && !forbidden && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}

          {data && (
            <>
              {data.gaps.length > 0 && (
                <SectionCard title="Not counted yet" subtitle="The total below is low by whatever is listed here." tone="warn">
                  <ul className="text-xs space-y-1 list-disc pl-4">
                    {data.gaps.map((g) => <li key={g}>{g}</li>)}
                  </ul>
                </SectionCard>
              )}

              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                <StatTile label={`Total · ${data.window.days} days`} value={usd(data.total_usd)} />
                <StatTile label="Monthly run rate" value={usd(data.monthly_run_rate_usd)} sub="this window scaled to a month" />
                {data.categories.map((c) => (
                  <StatTile key={c.name} label={c.name} value={usd(c.usd)}
                            sub={data.total_usd > 0 ? `${Math.round((c.usd / data.total_usd) * 100)}% of total` : undefined} />
                ))}
              </div>

              <SectionCard title="Cost per outcome" subtitle={u?.note}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <StatTile label="Per lead created" value={usd(u?.per_lead_usd)} sub={`${u?.leads_created ?? 0} leads`} />
                  <StatTile label="Per approved draft" value={usd(u?.per_approved_draft_usd)} sub={`${u?.drafts_approved ?? 0} drafts`} />
                  <StatTile label="Per reply" value={usd(u?.per_reply_usd)} sub={`${u?.replies ?? 0} replies`} />
                </div>
              </SectionCard>

              <SectionCard title="LLM" subtitle={`${usd(data.llm.usd)} · ${tokens(data.llm.tokens)} tokens · ${data.llm.calls.toLocaleString()} calls`}>
                <div>
                  <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Spend per day</div>
                  {data.llm.by_day.length === 0
                    ? <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>no usage recorded in this window</div>
                    : <Sparkline height={48} points={data.llm.by_day.map((d) => ({ day: d.day, n: d.usd, title: `${d.day}: ${usd(d.usd)} · ${tokens(d.tokens)} tokens` }))} />}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Breakdown title="By surface" rows={data.llm.by_surface.map((r) => ({ ...r, name: SURFACE_LABELS[r.surface] ?? r.surface }))} total={data.llm.usd} />
                  <Breakdown title="By model" rows={data.llm.by_model.map((r) => ({ ...r, name: r.model }))} total={data.llm.usd} />
                  <Breakdown title="By agent / feature" rows={data.llm.by_feature.map((r) => ({ ...r, name: r.feature }))} total={data.llm.usd} />
                  <Breakdown title="By person" rows={data.llm.by_owner.map((r) => ({ ...r, name: r.owner }))} total={data.llm.usd} />
                </div>
              </SectionCard>

              <SectionCard title="Unipile (LinkedIn)"
                           subtitle={`${usd(data.unipile.usd)} · ${usd(data.unipile.monthly_fee_usd)} per connected account per month, charged for the days connected`}>
                <Table head={['Account', 'Owner', 'State', 'Days in window', 'Cost']}
                       rows={data.unipile.accounts.map((a) => [
                         a.display_name || a.unipile_account_id, a.owner_name || '—',
                         a.active ? 'connected' : 'disconnected', a.days, usd(a.usd)])}
                       empty="no LinkedIn account was connected in this window" />
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Calls in this window (volume does not change the fee; it matters for account safety):{' '}
                  {Object.keys(data.unipile.calls).length === 0 ? 'none'
                    : Object.entries(data.unipile.calls).map(([k, n]) => `${k} ${n.toLocaleString()}`).join(' · ')}
                </p>
              </SectionCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <SectionCard title="Email finder credits" subtitle={usd(data.email_credits.usd)}>
                  <Table head={['Provider', 'Credits', 'Cost']}
                         rows={data.email_credits.by_source.map((s) => [s.source, s.credits, usd(s.usd)])}
                         empty="no paid credits used in this window" />
                </SectionCard>
                <SectionCard title="Fixed monthly items" subtitle={`${usd(data.fixed.usd)} for this window`}>
                  <Table head={['Item', 'Per month', 'This window']}
                         rows={data.fixed.items.map((i) => [i.name, i.monthly_usd > 0 ? usd(i.monthly_usd) : 'not set', usd(i.usd)])}
                         empty="none configured" />
                </SectionCard>
              </div>

              <SectionCard title="Agent runs" subtitle="What the spend bought, per background agent. Created is each agent's own unit: leads, employers, graph edges.">
                <Table head={['Agent', 'Runs', 'Created', 'Research calls']}
                       rows={data.agents.map((a) => [a.agent, a.runs, a.created, a.researched])}
                       empty="no agent ran in this window" />
              </SectionCard>

              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Rates are the policy row <code>costs.rates</code> (edited in SQL). Tokens are stored and priced when
                this page loads, so correcting a rate re-prices the whole window.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: (CostBucket & { name: string })[]; total: number }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{title}</div>
      {rows.length === 0 && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>nothing recorded</div>}
      <div className="space-y-1.5">
        {rows.slice(0, 12).map((r) => (
          <div key={r.name} className="min-w-0">
            <div className="flex justify-between gap-2 text-[11px]">
              <span className="truncate" title={r.name}>{r.name}</span>
              <span className="shrink-0 font-mono tabular-nums">
                {usd(r.usd)}
                <span style={{ color: 'var(--text-muted)' }}> · {tokens(r.tokens)}</span>
                {r.unpriced_tokens > 0 && <span style={{ color: 'var(--yellow)' }} title="tokens with no rate — not in the dollar figure"> · {tokens(r.unpriced_tokens)} unpriced</span>}
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
              <div className="h-full rounded-full" style={{ width: `${total > 0 ? Math.min(100, (r.usd / total) * 100) : 0}%`, background: 'var(--accent)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            {head.map((h, i) => <th key={h} className={`font-normal pb-1 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
              {r.map((c, j) => <td key={j} className={`py-1 ${j === 0 ? 'text-left' : 'text-right tabular-nums'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
