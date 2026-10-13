'use client';

/**
 * /marketing — paid-ads performance, the CRM's view of acquisition spend.
 *
 * Reads GET /api/marketing/overview (live from Google Ads / LinkedIn Ads, cached
 * 10 min server-side). Spend, impressions and clicks are platform truth; leads,
 * pipeline and cost per lead wait for the touchpoint capture in round 2, so
 * those tiles stay "—" rather than showing a platform number under a CRM label.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import SectionCard from '@/components/panel/SectionCard';
import StatTile from '@/components/panel/StatTile';
import Sparkline from '@/components/panel/Sparkline';
import { PROVIDER_META, type AdsOverview, type CampaignRow, type ConnectorStatus } from '@/lib/marketing';

const RANGES = [7, 30, 90] as const;

const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtMoney = (n: number, ccy: string) => `${ccy} ${n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;
const pct = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(2)}%` : '—');

export default function MarketingPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [overview, setOverview] = useState<AdsOverview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/marketing/connectors').then((r) => (r.ok ? r.json() : null)).then((d) => setConnectors(d?.connectors ?? [])).catch(() => setConnectors([]));
  }, []);

  const connected = useMemo(() => (connectors ?? []).filter((c) => c.connected), [connectors]);

  useEffect(() => {
    if (!connected.length) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/marketing/overview?days=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setOverview(d); })
      .catch(() => { if (alive) setOverview(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range, connected.length]);

  const okProviders = overview?.providers.filter((p) => p.ok) ?? [];
  const campaigns: CampaignRow[] = okProviders.flatMap((p) => p.campaigns).sort((a, b) => b.spend - a.spend);
  const currencies = [...new Set(okProviders.map((p) => p.currency).filter((c): c is string => !!c))];
  const singleCcy = currencies.length === 1 ? currencies[0] : null;
  const totals = campaigns.reduce((t, c) => ({ spend: t.spend + c.spend, imp: t.imp + c.impressions, clk: t.clk + c.clicks, conv: t.conv + c.platform_conversions, leads: t.leads + c.platform_leads }), { spend: 0, imp: 0, clk: 0, conv: 0, leads: 0 });
  const spendByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of okProviders) for (const d of p.days) m.set(d.day, (m.get(d.day) ?? 0) + d.spend);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, n: Math.round(v), title: `${day}: ${fmtInt(v)}` }));
  }, [okProviders]);
  const hasData = campaigns.length > 0;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between gap-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Marketing</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {connectors === null ? 'Loading…'
                : connected.length ? `${connected.map((c) => PROVIDER_META[c.provider].label).join(' · ')} · ${overview ? `${overview.since} → ${overview.until}` : 'fetching…'}`
                : 'No ad account connected yet'}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs" role="tablist" aria-label="Date range">
            {RANGES.map((d) => (
              <button key={d} role="tab" aria-selected={range === d} onClick={() => setRange(d)} className="px-2.5 py-1 rounded-full"
                style={{ background: range === d ? 'var(--accent-glow)' : 'transparent', color: range === d ? 'var(--accent)' : 'var(--text-muted)', fontWeight: range === d ? 600 : 400 }}>
                {d} d
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 space-y-4 max-w-6xl">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatTile label="Spend" value={hasData ? (singleCcy ? fmtMoney(totals.spend, singleCcy) : `${fmtInt(totals.spend)} (mixed ccy)`) : '—'} sub={`last ${range} d`} title="Platform-reported cost, summed over the range" />
            <StatTile label="Impressions" value={hasData ? fmtInt(totals.imp) : '—'} sub={hasData ? `CTR ${pct(totals.clk, totals.imp)}` : `last ${range} d`} />
            <StatTile label="Clicks" value={hasData ? fmtInt(totals.clk) : '—'} sub={hasData && totals.clk ? `CPC ${fmtMoney(totals.spend / totals.clk, singleCcy ?? '')}` : `last ${range} d`} />
            <StatTile label="Leads" value="—" sub={hasData ? `${fmtInt(totals.conv + totals.leads)} as reported` : 'needs form tracking'} title="CRM-attributed leads (round 2). Platform conversions shown as reported, never as leads." />
            <StatTile label="Cost / lead" value="—" sub="needs form tracking" title="Spend ÷ CRM-attributed leads" />
            <StatTile label="Pipeline" value="—" sub="needs form tracking" title="Value of deals whose first touch was a paid ad" />
          </div>

          {connectors !== null && connected.length === 0 && (
            <SectionCard title="Connect an ad account to start" subtitle="Performance data is read-only and org-wide, like the pipeline board.">
              <Link href="/marketing/connectors" className="inline-block px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Go to Ad Connectors →</Link>
            </SectionCard>
          )}

          {overview?.providers.filter((p) => !p.ok && p.error !== 'not configured').map((p) => (
            <SectionCard key={p.provider} tone="warn" title={`${PROVIDER_META[p.provider].label}: could not read`} subtitle={p.error ?? 'unknown error'}>
              <Link href="/marketing/connectors" className="text-sm underline" style={{ color: 'var(--accent)' }}>Check the connector →</Link>
            </SectionCard>
          ))}

          {connected.length > 0 && (
            <SectionCard
              title="Campaign performance"
              subtitle={loading ? 'Fetching from the platforms…' : hasData ? `${campaigns.length} campaigns with activity · spend per day →` : 'No campaign activity in this range.'}
              right={spendByDay.length > 1 ? <Sparkline points={spendByDay} label="spend / day" /> : undefined}
            >
              {hasData && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        <th className="py-1.5 pr-3 font-medium">Campaign</th>
                        <th className="py-1.5 pr-3 font-medium">Channel</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Spend</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Impr.</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Clicks</th>
                        <th className="py-1.5 pr-3 font-medium text-right">CTR</th>
                        <th className="py-1.5 pr-3 font-medium text-right">CPC</th>
                        <th className="py-1.5 font-medium text-right" title="Platform-reported conversions / Lead Gen leads — not CRM leads">Conv. (reported)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr key={`${c.provider}:${c.campaign_id}`} className="border-t" style={{ borderColor: 'var(--border)' }}>
                          <td className="py-1.5 pr-3">
                            <div className="font-medium truncate max-w-[28ch]" title={c.campaign_name}>{c.campaign_name}</div>
                            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{PROVIDER_META[c.provider].label}{c.status ? ` · ${c.status.toLowerCase()}` : ''}</div>
                          </td>
                          <td className="py-1.5 pr-3 text-xs" style={{ color: 'var(--text-muted)' }}>{c.channel?.toLowerCase().replace(/_/g, ' ') ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmtMoney(c.spend, c.currency)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmtInt(c.impressions)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmtInt(c.clicks)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{pct(c.clicks, c.impressions)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{c.clicks ? fmtMoney(c.spend / c.clicks, c.currency) : '—'}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmtInt(c.platform_conversions + c.platform_leads)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}

          <SectionCard title="How attribution will work here" subtitle="What this page counts, so the numbers mean the same thing to everyone.">
            <ol className="text-sm space-y-1.5 list-decimal pl-5" style={{ color: 'var(--text-muted)' }}>
              <li>Every ad link carries UTM parameters plus the platform click id (<code>gclid</code> / <code>li_fat_id</code>).</li>
              <li>The zeami.io demo form and LinkedIn Lead Gen Forms post those values with the lead; they land on the Sales Lead as its <em>first touch</em>.</li>
              <li>A lead converted to a deal keeps the touch, so pipeline and won revenue roll back up to the campaign that paid for them.</li>
              <li>Spend, impressions and clicks come from the platforms; leads, pipeline and revenue come from this CRM. Cost per lead and ROAS are computed here, never trusted from the platform.</li>
            </ol>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
