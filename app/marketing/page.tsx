'use client';

/**
 * /marketing — paid-ads performance, the CRM's view of acquisition spend.
 *
 * Reads GET /api/marketing/overview?since&until (live from Google Ads / LinkedIn Ads,
 * cached 10 min server-side) for the range in the URL (?range=last_7 or
 * ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD — shareable). A campaign name opens
 * CampaignModal: ad groups and ads for the same range. Spend, impressions and clicks are platform truth; leads,
 * pipeline and cost per lead wait for the touchpoint capture in round 2, so
 * those tiles stay "—" rather than showing a platform number under a CRM label.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import SectionCard from '@/components/panel/SectionCard';
import StatTile from '@/components/panel/StatTile';
import DateRangePicker, { type RangeValue } from '@/components/marketing/DateRangePicker';
import CampaignModal from '@/components/marketing/CampaignModal';
import {
  DEFAULT_PRESET, PROVIDER_META, isYmd, presetRange, rangeLabel, ymd,
  type AdProvider, type AdsOverview, type CampaignRow, type ConnectorStatus, type RangePreset,
} from '@/lib/marketing';

const NAMED: RangePreset[] = ['today', 'yesterday', 'last_7', 'this_month', 'last_month', 'this_year', 'last_year'];
const CHANNEL_COLOR: Record<AdProvider, string> = { google_ads: 'var(--cat-blue)', linkedin_ads: 'var(--cat-teal)' };

/** The range in the URL, else the default. A named preset is recomputed on load, so "Today" stays today. */
function rangeFromUrl(q: URLSearchParams): RangeValue {
  const r = q.get('range') as RangePreset | null;
  if (r === 'custom') {
    const from = q.get('from'), to = q.get('to');
    if (isYmd(from) && isYmd(to) && from <= to && to <= ymd(new Date())) return { preset: 'custom', since: from, until: to };
  } else if (r && NAMED.includes(r)) {
    return { preset: r, ...presetRange(r as Exclude<RangePreset, 'custom'>) };
  }
  return { preset: DEFAULT_PRESET, ...presetRange(DEFAULT_PRESET as Exclude<RangePreset, 'custom'>) };
}

const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtMoney = (n: number, ccy: string) => `${ccy} ${n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;
const pct = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(2)}%` : '—');

export default function MarketingPage() {
  return <Suspense fallback={null}><Marketing /></Suspense>;
}

function Marketing() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [range, setRangeState] = useState<RangeValue>(() => rangeFromUrl(new URLSearchParams(params.toString())));
  const [open, setOpen] = useState<CampaignRow | null>(null);
  const setRange = useCallback((v: RangeValue) => {
    setRangeState(v);
    const q = new URLSearchParams(params.toString());
    q.set('range', v.preset);
    if (v.preset === 'custom') { q.set('from', v.since); q.set('to', v.until); } else { q.delete('from'); q.delete('to'); }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }, [params, pathname, router]);
  const closeModal = useCallback(() => setOpen(null), []);
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
    fetch(`/api/marketing/overview?${new URLSearchParams({ since: range.since, until: range.until })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setOverview(d); })
      .catch(() => { if (alive) setOverview(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range.since, range.until, connected.length]);

  const okProviders = overview?.providers.filter((p) => p.ok) ?? [];
  const campaigns: CampaignRow[] = okProviders.flatMap((p) => p.campaigns).sort((a, b) => b.spend - a.spend);
  const currencies = [...new Set(okProviders.map((p) => p.currency).filter((c): c is string => !!c))];
  const singleCcy = currencies.length === 1 ? currencies[0] : null;
  const totals = campaigns.reduce((t, c) => ({ spend: t.spend + c.spend, imp: t.imp + c.impressions, clk: t.clk + c.clicks, conv: t.conv + c.platform_conversions, leads: t.leads + c.platform_leads }), { spend: 0, imp: 0, clk: 0, conv: 0, leads: 0 });
  const hasData = campaigns.length > 0;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Marketing</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {connectors === null ? 'Loading…'
                : connected.length ? `${connected.map((c) => PROVIDER_META[c.provider].label).join(' · ')} · ${rangeLabel(range.since, range.until)}`
                : 'No ad account connected yet'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangePicker value={range} onChange={setRange} />
            <Link href="/marketing/connectors" title="Settings: connect Google Ads and LinkedIn Ads"
              className="px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Ad connectors
            </Link>
          </div>
        </div>

        <div className="p-4 space-y-4 max-w-6xl">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatTile label="Spend" value={hasData ? (singleCcy ? fmtMoney(totals.spend, singleCcy) : `${fmtInt(totals.spend)} (mixed ccy)`) : '—'} sub={rangeLabel(range.since, range.until)} title="Platform-reported cost, summed over the range" />
            <StatTile label="Impressions" value={hasData ? fmtInt(totals.imp) : '—'} sub={hasData ? `CTR ${pct(totals.clk, totals.imp)}` : rangeLabel(range.since, range.until)} />
            <StatTile label="Clicks" value={hasData ? fmtInt(totals.clk) : '—'} sub={hasData && totals.clk ? `CPC ${fmtMoney(totals.spend / totals.clk, singleCcy ?? '')}` : rangeLabel(range.since, range.until)} />
            <StatTile label="Leads" value="—" sub={hasData ? `${fmtInt(totals.conv + totals.leads)} as reported` : 'needs form tracking'} title="CRM-attributed leads (round 2). Platform conversions shown as reported, never as leads." />
            <StatTile label="Cost / lead" value="—" sub="needs form tracking" title="Spend ÷ CRM-attributed leads" />
            <StatTile label="Pipeline" value="—" sub="needs form tracking" title="Value of deals whose first touch was a paid ad" />
          </div>

          {connectors !== null && connected.length === 0 && (
            <SectionCard title="Connect an ad account to start" subtitle="Performance data is read-only and org-wide, like the pipeline board.">
              <Link href="/marketing/connectors" className="inline-block px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Connect an ad account →</Link>
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
              subtitle={loading ? 'Fetching from the platforms…' : hasData ? undefined : 'No campaign activity in this range.'}
            >
              {hasData && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        <th className="py-1.5 pr-3 font-medium">Channel</th>
                        <th className="py-1.5 pr-3 font-medium">Campaign</th>
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
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-2 font-medium">
                              <span className="w-2 h-2 rounded-full" style={{ background: CHANNEL_COLOR[c.provider] }} />{PROVIDER_META[c.provider].label}
                            </span>
                            {c.channel && <div className="text-[11px] pl-4" style={{ color: 'var(--text-muted)' }}>{c.channel.toLowerCase().replace(/_/g, ' ')}</div>}
                          </td>
                          <td className="py-1.5 pr-3">
                            <button type="button" onClick={() => setOpen(c)} title="Open ad groups and ads"
                              className="font-medium text-left truncate max-w-[32ch] hover:underline" style={{ color: 'var(--accent)' }}>{c.campaign_name}</button>
                            {c.status && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{c.status.toLowerCase()}</div>}
                          </td>
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

          {open && (
            <CampaignModal provider={open.provider} campaignId={open.campaign_id} campaignName={open.campaign_name}
              since={range.since} until={range.until} onClose={closeModal} />
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
