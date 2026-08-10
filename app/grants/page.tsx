'use client';

/**
 * /grants — post-award dashboard, two tabs.
 *
 *   Active (default) — Resources at Risk + Reports Due in 30 Days for
 *     currently-active grants. RBAC-scoped kernel-side; non-admins see only
 *     grants they lead or created.
 *   Awarded — Table of won grants with per-deal aggregates (funder, won_at,
 *     total received, committed-vs-utilized bar, lead). Also RBAC-scoped.
 *
 * Tab state lives in ?tab=active|awarded so links are shareable and refresh
 * doesn't lose the view. Data is fetched lazily per tab — the first click on
 * Awarded triggers /api/grants/awarded once and caches the result.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

// ─── types ────────────────────────────────────────────────────────────

interface ResourceRow {
  id: string;
  deal_id: string;
  deal_name: string;
  deal_company: string;
  lead_id: string | null;
  lead_name: string | null;
  resource_type: string;
  status: string;
  committed_amount: number | null;
  received_amount: number | null;
  utilized_amount: number | null;
  currency: string;
  expected_at: string | null;
  expires_at: string | null;
  risk_kind: 'overdue_receipt' | 'expiring_soon' | 'unutilized_60d' | null;
}

interface ReportRow {
  id: string;
  deal_id: string;
  deal_name: string;
  deal_company: string;
  lead_id: string | null;
  lead_name: string | null;
  report_type: string;
  title: string;
  due_at: string;
  status: string;
  days_until_due: number;
}

interface WonGrant {
  deal_id: string;
  name: string;
  company: string;
  deal_value: number | null;
  currency: string;
  won_at: string | null;
  contract_signed_at: string | null;
  funder: string | null;
  lead_id: string | null;
  lead_name: string | null;
  total_committed: number;
  total_received: number;
  total_utilized: number;
  resource_count: number;
  report_count: number;
}

// ─── helpers ──────────────────────────────────────────────────────────

const RISK_LABEL: Record<string, { label: string; color: string }> = {
  overdue_receipt: { label: 'Receipt overdue', color: 'var(--red)' },
  expiring_soon: { label: 'Expiring <30d', color: 'var(--orange)' },
  unutilized_60d: { label: 'Unused 60d+', color: 'var(--yellow)' },
};

function fmtMoney(n: number | null, ccy: string) {
  if (n === null || n === undefined) return '—';
  return `${ccy} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function pill(text: string, color: string) {
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}44`,
      borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 500,
    }}>{text}</span>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

function dueBucket(d: number): string {
  if (d < 0) return 'Overdue';
  if (d <= 7) return 'This week';
  return 'Next 30 days';
}

function relative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── page ─────────────────────────────────────────────────────────────

type Tab = 'active' | 'awarded';

// Outer wrapper — `useSearchParams()` reads client-side navigation state, so
// Next requires it inside a Suspense boundary or the /grants prerender bails.
export default function GrantsDashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    }>
      <GrantsDashboardInner />
    </Suspense>
  );
}

function GrantsDashboardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = params.get('tab') === 'awarded' ? 'awarded' : 'active';

  const [activeLoading, setActiveLoading] = useState(true);
  const [awardedLoading, setAwardedLoading] = useState(false);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [awarded, setAwarded] = useState<WonGrant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Active feed loads on mount (default tab).
  useEffect(() => {
    fetch('/api/grants/dashboard?days=30')
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setResources(j.resources_at_risk?.resources || []);
        setReports(j.reports_due?.reports || []);
      })
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setActiveLoading(false));
  }, []);

  // Awarded loads lazily on first visit + never re-fetches within the session.
  useEffect(() => {
    if (tab !== 'awarded' || awarded !== null || awardedLoading) return;
    setAwardedLoading(true);
    fetch('/api/grants/awarded?limit=100')
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setAwarded(j.grants || []);
      })
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setAwardedLoading(false));
  }, [tab, awarded, awardedLoading]);

  function selectTab(t: Tab) {
    const q = new URLSearchParams(params.toString());
    if (t === 'awarded') q.set('tab', 'awarded'); else q.delete('tab');
    router.replace(`/grants${q.toString() ? `?${q}` : ''}`);
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-6">
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Grants</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {tab === 'active'
              ? 'Track disbursement, delivery, and reporting for grants after signature so every $ gets used.'
              : 'Grants closed as won — resources fully utilized and all reports accepted.'}
          </p>
        </div>

        <TabStrip tab={tab} onSelect={selectTab} />

        {err && (
          <div style={{ padding: 12, background: 'var(--red)22', color: 'var(--red)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            Error: {err}
          </div>
        )}

        {tab === 'active' ? (
          <ActiveView loading={activeLoading} resources={resources} reports={reports} />
        ) : (
          <AwardedView loading={awardedLoading} grants={awarded} />
        )}
      </div>
    </div>
  );
}

// ─── tab strip ────────────────────────────────────────────────────────

function TabStrip({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }) {
  const tabStyle = (active: boolean) => ({
    padding: '8px 16px', fontSize: 13, fontWeight: 500,
    color: active ? 'var(--text)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    cursor: 'pointer', background: 'transparent', border: 'none',
    borderRadius: 0,
  } as const);
  return (
    <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 20, display: 'flex' }}>
      <button style={tabStyle(tab === 'active')} onClick={() => onSelect('active')}>Active</button>
      <button style={tabStyle(tab === 'awarded')} onClick={() => onSelect('awarded')}>Awarded</button>
    </div>
  );
}

// ─── Active tab ───────────────────────────────────────────────────────

function ActiveView({ loading, resources, reports }: {
  loading: boolean; resources: ResourceRow[]; reports: ReportRow[];
}) {
  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading dashboard…</div>;

  const riskByOwner = groupBy(resources, (r) => r.lead_name || 'Unassigned');
  const dueByBucket = groupBy(reports, (r) => dueBucket(r.days_until_due));

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <MetricCard label="Resources at risk" value={String(resources.length)}
          tone={resources.length > 0 ? 'var(--red)' : 'var(--green)'} />
        <MetricCard label="Reports due (30d)" value={String(reports.length)}
          tone={reports.some((r) => r.days_until_due < 0) ? 'var(--red)' : reports.length > 0 ? 'var(--yellow)' : 'var(--green)'} />
        <MetricCard label="Overdue reports" value={String(reports.filter((r) => r.days_until_due < 0).length)}
          tone={reports.some((r) => r.days_until_due < 0) ? 'var(--red)' : 'var(--green)'} />
      </div>

      <Section title="Resources at Risk">
        {resources.length === 0 ? (
          <Empty text="Nothing at risk — every resource is on track." />
        ) : (
          [...riskByOwner.entries()].map(([owner, rows]) => (
            <div key={owner} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {owner} · {rows.length}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                      <th style={{ padding: 6 }}>Deal</th>
                      <th style={{ padding: 6 }}>Type</th>
                      <th style={{ padding: 6 }}>Risk</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>Committed</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>Received</th>
                      <th style={{ padding: 6 }}>Expected</th>
                      <th style={{ padding: 6 }}>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const risk = r.risk_kind ? RISK_LABEL[r.risk_kind] : null;
                      return (
                        <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 6 }}>
                            <Link href={`/deals/${r.deal_id}`} style={{ color: 'var(--accent)' }}>{r.deal_name}</Link>
                            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.deal_company}</div>
                          </td>
                          <td style={{ padding: 6 }}>{r.resource_type}</td>
                          <td style={{ padding: 6 }}>{risk ? pill(risk.label, risk.color) : '—'}</td>
                          <td style={{ padding: 6, textAlign: 'right' }}>{fmtMoney(r.committed_amount, r.currency)}</td>
                          <td style={{ padding: 6, textAlign: 'right' }}>{fmtMoney(r.received_amount, r.currency)}</td>
                          <td style={{ padding: 6 }}>{r.expected_at || '—'}</td>
                          <td style={{ padding: 6 }}>{r.expires_at || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </Section>

      <Section title="Reports Due in 30 Days">
        {reports.length === 0 ? (
          <Empty text="No reports due in the next 30 days." />
        ) : (
          (['Overdue', 'This week', 'Next 30 days'] as const).map((bucket) => {
            const rows = dueByBucket.get(bucket) || [];
            if (rows.length === 0) return null;
            return (
              <div key={bucket} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {bucket} · {rows.length}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                        <th style={{ padding: 6 }}>Deal</th>
                        <th style={{ padding: 6 }}>Type</th>
                        <th style={{ padding: 6 }}>Report</th>
                        <th style={{ padding: 6 }}>Status</th>
                        <th style={{ padding: 6 }}>Due</th>
                        <th style={{ padding: 6 }}>Lead</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 6 }}>
                            <Link href={`/deals/${r.deal_id}`} style={{ color: 'var(--accent)' }}>{r.deal_name}</Link>
                            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.deal_company}</div>
                          </td>
                          <td style={{ padding: 6 }}>{r.report_type}</td>
                          <td style={{ padding: 6 }}>{r.title}</td>
                          <td style={{ padding: 6 }}>{pill(r.status, r.days_until_due < 0 ? 'var(--red)' : 'var(--yellow)')}</td>
                          <td style={{ padding: 6, color: r.days_until_due < 0 ? 'var(--red)' : 'var(--text)' }}>
                            {r.due_at} ({r.days_until_due > 0 ? `in ${r.days_until_due}d` : r.days_until_due === 0 ? 'today' : `${-r.days_until_due}d ago`})
                          </td>
                          <td style={{ padding: 6, color: 'var(--text-muted)' }}>{r.lead_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </Section>
    </>
  );
}

// ─── Awarded tab ──────────────────────────────────────────────────────

function AwardedView({ loading, grants }: { loading: boolean; grants: WonGrant[] | null }) {
  const stats = useMemo(() => {
    if (!grants) return { count: 0, totalReceivedByCcy: new Map<string, number>(), ytdCount: 0 };
    const byCcy = new Map<string, number>();
    let ytd = 0;
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    for (const g of grants) {
      byCcy.set(g.currency, (byCcy.get(g.currency) || 0) + Number(g.total_received || 0));
      if (g.won_at && new Date(g.won_at) >= yearStart) ytd++;
    }
    return { count: grants.length, totalReceivedByCcy: byCcy, ytdCount: ytd };
  }, [grants]);

  if (loading || grants === null) return <div style={{ color: 'var(--text-muted)' }}>Loading awarded grants…</div>;

  const receivedSummary = stats.totalReceivedByCcy.size === 0
    ? '—'
    : [...stats.totalReceivedByCcy.entries()]
        .map(([ccy, amt]) => `${ccy} ${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
        .join(' · ');

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <MetricCard label="Awarded (total)" value={String(stats.count)} tone="var(--green)" />
        <MetricCard label="Awarded this year" value={String(stats.ytdCount)} tone="var(--green)" />
        <MetricCard label="Received (all-time)" value={receivedSummary} tone="var(--text)" />
      </div>

      <Section title="Awarded Grants">
        {grants.length === 0 ? (
          <Empty text="No awarded grants yet. Grants close with crm_mark_grant_won once all resources are terminal and all reports accepted." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                  <th style={{ padding: 6 }}>Deal</th>
                  <th style={{ padding: 6 }}>Funder</th>
                  <th style={{ padding: 6 }}>Won</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Received</th>
                  <th style={{ padding: 6 }}>Utilized / Committed</th>
                  <th style={{ padding: 6 }}>Lead</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => {
                  const committed = Number(g.total_committed || 0);
                  const utilized = Number(g.total_utilized || 0);
                  const ratio = committed > 0 ? Math.min(1, utilized / committed) : 0;
                  return (
                    <tr key={g.deal_id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6 }}>
                        <Link href={`/deals/${g.deal_id}`} style={{ color: 'var(--accent)' }}>{g.name}</Link>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{g.company}</div>
                      </td>
                      <td style={{ padding: 6, color: g.funder ? 'var(--text)' : 'var(--text-muted)' }}>
                        {g.funder || '—'}
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                        {g.won_at ? g.won_at.slice(0, 10) : '—'}
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{relative(g.won_at)}</div>
                      </td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{fmtMoney(Number(g.total_received || 0), g.currency)}</td>
                      <td style={{ padding: 6, minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${ratio * 100}%`, height: '100%', background: 'var(--green)' }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {fmtMoney(utilized, g.currency)} / {fmtMoney(committed, g.currency)}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: 6, color: 'var(--text-muted)' }}>{g.lead_name || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

// ─── shared bits ──────────────────────────────────────────────────────

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: tone }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>{text}</div>;
}
