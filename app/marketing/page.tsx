'use client';

/**
 * /marketing — paid-ads performance, the CRM's view of acquisition spend.
 *
 * Round 1: the page frame and the honest empty state. Metrics appear once an
 * ad connector is connected and the daily pull has run (round 2 writes
 * ad_metrics_daily — see docs/marketing-ads.md). Until then the tiles show the
 * KPI set we commit to, so the team knows what they will get, and the page
 * points at /marketing/connectors.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import SectionCard from '@/components/panel/SectionCard';
import StatTile from '@/components/panel/StatTile';
import { PROVIDER_META, type ConnectorStatus } from '@/lib/marketing';

const RANGES = [7, 30, 90] as const;

// The KPI ladder, in the order a marketer reads it: money in → attention →
// intent → leads → pipeline. Every tile has a definition so nobody argues
// about what "lead" means on this page.
const KPIS: { label: string; title: string }[] = [
  { label: 'Spend', title: 'Platform-reported cost in account currency, summed over the range' },
  { label: 'Impressions', title: 'Ad views, all channels' },
  { label: 'Clicks', title: 'Ad clicks, all channels' },
  { label: 'Leads', title: 'Form submissions (zeami.io demo form, LinkedIn Lead Gen) attributed to an ad touch' },
  { label: 'Cost / lead', title: 'Spend ÷ leads' },
  { label: 'Pipeline', title: 'Value of deals whose first touch was a paid ad' },
];

export default function MarketingPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);

  useEffect(() => {
    fetch('/api/marketing/connectors')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setConnectors(d?.connectors ?? []))
      .catch(() => setConnectors([]));
  }, []);

  const connected = (connectors ?? []).filter((c) => c.connected);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between gap-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Marketing</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {connectors === null
                ? 'Loading…'
                : connected.length
                  ? `${connected.map((c) => PROVIDER_META[c.provider].label).join(' · ')} connected`
                  : 'No ad account connected yet'}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs" role="tablist" aria-label="Date range">
            {RANGES.map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={range === d}
                onClick={() => setRange(d)}
                className="px-2.5 py-1 rounded-full"
                style={{
                  background: range === d ? 'var(--accent-glow)' : 'transparent',
                  color: range === d ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: range === d ? 600 : 400,
                }}
              >
                {d} d
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 space-y-4 max-w-6xl">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {KPIS.map((k) => (
              <StatTile key={k.label} label={k.label} value="—" title={k.title} sub={`last ${range} d`} />
            ))}
          </div>

          {connectors !== null && connected.length === 0 && (
            <SectionCard title="Connect an ad account to start" subtitle="Performance data is pulled read-only, once a day, per connected account.">
              <div className="grid gap-3 sm:grid-cols-2">
                {(connectors ?? []).map((c) => {
                  const meta = PROVIDER_META[c.provider];
                  return (
                    <div key={c.provider} className="rounded-xl p-3" style={{ background: 'var(--bg-input)' }}>
                      <div className="text-sm font-medium">{meta.label}</div>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{meta.blurb}</p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3">
                <Link href="/marketing/connectors" className="inline-block px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                  Go to Ad Connectors →
                </Link>
              </div>
            </SectionCard>
          )}

          {connected.length > 0 && (
            <SectionCard title="Campaign performance" subtitle="By channel and campaign over the selected range.">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Connected, but no data has been pulled yet. The daily pull (round 2) fills this table from <code>ad_metrics_daily</code>.
              </p>
            </SectionCard>
          )}

          <SectionCard title="How attribution works here" subtitle="What this page will count, so the numbers mean the same thing to everyone.">
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
