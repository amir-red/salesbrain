'use client';

/**
 * /grants — post-award dashboard.
 *
 * Two tables at a glance:
 *   * Resources at Risk — grouped by owner (Lead). Rows tagged
 *     overdue_receipt / expiring_soon / unutilized_60d.
 *   * Reports Due in 30 Days — grouped by due window (Overdue / This Week /
 *     Next 30 Days). Reuses the visual grouping pattern from /followups.
 *
 * RBAC is enforced kernel-side. Non-admin users see only grants they lead
 * or created. Data comes from a single /api/grants/dashboard call that
 * runs the two kernel queries in parallel.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

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

export default function GrantsDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/grants/dashboard?days=30')
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setResources(j.resources_at_risk?.resources || []);
        setReports(j.reports_due?.reports || []);
      })
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Loading grants dashboard…</div>
      </div>
    );
  }

  const riskByOwner = groupBy(resources, (r) => r.lead_name || 'Unassigned');
  const dueByBucket = groupBy(reports, (r) => dueBucket(r.days_until_due));

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-6">
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Grants — post-award</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Track disbursement, delivery, and reporting for grants after signature so every $ gets used.
          </p>
        </div>
        {err && (
          <div style={{ padding: 12, background: 'var(--red)22', color: 'var(--red)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            Error loading dashboard: {err}
          </div>
        )}

        {/* Metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
          <MetricCard label="Resources at risk" value={String(resources.length)} tone={resources.length > 0 ? 'var(--red)' : 'var(--green)'} />
          <MetricCard label="Reports due (30d)" value={String(reports.length)} tone={reports.some((r) => r.days_until_due < 0) ? 'var(--red)' : reports.length > 0 ? 'var(--yellow)' : 'var(--green)'} />
          <MetricCard label="Overdue reports" value={String(reports.filter((r) => r.days_until_due < 0).length)} tone={reports.some((r) => r.days_until_due < 0) ? 'var(--red)' : 'var(--green)'} />
        </div>

        {/* Resources at risk */}
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

        {/* Reports due */}
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
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color: tone }}>{value}</div>
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
