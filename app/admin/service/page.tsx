'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { relativeTime } from '@/lib/time';

interface AppRollup {
  app_key: string; employees: number; icps: number; leads: number; pending: number; sent: number; last_activity: string | null;
}
interface EmployeeRow {
  app_key: string; employee_id: string; display_name: string | null; email: string | null;
  salesbrain_user_id: string; created_at: string; last_seen_at: string | null;
  icps: number; leads: number; researched: number; pending: number; sent: number; last_activity: string | null;
}
interface Lead {
  id: string; stage: string; icp_score: number | null; fit_label: string | null; research_summary: string | null;
  network_degree: string | null; created_at: string; icp_name: string | null;
  full_name: string | null; title: string | null; email: string | null; linkedin_url: string | null;
  company_name: string | null; industry: string | null;
}
interface Icp {
  id: string; name: string; product: string | null; description: string | null;
  search_keywords: string | null; is_active: boolean; prospects: number;
  filters: Record<string, unknown> | null;
  criteria: {
    titles?: string[]; seniority?: string[]; locations?: string[]; industries?: string[];
    company_sizes?: string[]; exclude_titles?: string[]; exclude_companies?: string[];
    weights?: Record<string, number>;
  } | null;
}
interface Approval {
  id: string; status: string; channel: string; subject: string | null; message: string; rationale: string | null;
  created_at: string; sent_at: string | null; decided_at: string | null;
  person_name: string | null; title: string | null; company: string | null; icp_score: number | null;
}

const fmt = (t: string | null) => (t ? relativeTime(t) : '—');

export default function ServiceAdminPage() {
  const [apps, setApps] = useState<AppRollup[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ emp: EmployeeRow; icps: Icp[]; leads: Lead[]; approvals: Approval[] } | null>(null);
  const [drillBusy, setDrillBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/service-activity');
      if (res.status === 403) throw new Error('Admin only — sign in as an admin to view service activity.');
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
      const data = await res.json();
      setApps(data.apps || []); setEmployees(data.employees || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function openDrill(emp: EmployeeRow) {
    setDrillBusy(true);
    try {
      const res = await fetch(`/api/admin/service-activity?user_id=${encodeURIComponent(emp.salesbrain_user_id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setDrill({ emp, icps: data.icps || [], leads: data.leads || [], approvals: data.approvals || [] });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally { setDrillBusy(false); }
  }

  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)' } as const;
  const stat = (n: number, label: string, color?: string) => (
    <div className="text-center px-2">
      <div className="text-lg font-bold" style={{ color: color || 'var(--text)' }}>{n}</div>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Service integrations</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              What each connected app is doing through <span className="font-mono">/api/service-mcp</span>, per employee.
              These pipelines are owned by provisioned users, so they don&apos;t appear on your own <span className="font-mono">/icp</span>.
            </p>
          </div>
          <button onClick={load} className="px-3 py-1.5 rounded text-xs" style={{ ...card, color: 'var(--text-muted)' }}>Refresh</button>
        </div>

        <div className="p-4 max-w-5xl">
          {error && (
            <div className="rounded p-3 mb-4 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>
          )}
          {loading ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : employees.length === 0 && !error ? (
            <div className="rounded-lg p-8 text-center text-xs" style={{ ...card, color: 'var(--text-muted)' }}>
              No service activity yet. Issue a token in <a href="/profile?tab=service" style={{ color: 'var(--accent)' }}>Profile → Service API</a>,
              then the connected app registers employees and runs the pipeline.
            </div>
          ) : (
            <>
              {/* Per-app rollup */}
              <section className="mb-6">
                <h2 className="text-sm font-semibold mb-2">Connected apps</h2>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
                  {apps.map((a) => (
                    <div key={a.app_key} className="rounded-lg p-4" style={card}>
                      <div className="font-mono text-sm font-semibold mb-3">{a.app_key}</div>
                      <div className="flex justify-between">
                        {stat(a.employees, 'employees')}
                        {stat(a.icps, 'ICPs')}
                        {stat(a.leads, 'leads')}
                        {stat(a.pending, 'pending', a.pending ? 'var(--accent)' : undefined)}
                        {stat(a.sent, 'sent', a.sent ? 'var(--green)' : undefined)}
                      </div>
                      <div className="text-[10px] mt-3" style={{ color: 'var(--text-muted)' }}>
                        last activity {fmt(a.last_activity)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Per-employee table */}
              <section>
                <h2 className="text-sm font-semibold mb-2">Employees</h2>
                <div className="rounded-lg overflow-hidden" style={card}>
                  <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        {['Employee', 'App', 'ICPs', 'Leads', 'Researched', 'Pending', 'Sent', 'Last activity', ''].map((h, i) => (
                          <th key={h} className="text-left font-medium px-3 py-2"
                            style={{ borderBottom: '1px solid var(--border)', textAlign: i >= 2 && i <= 6 ? 'center' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((e) => (
                        <tr key={e.salesbrain_user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{e.display_name || e.employee_id}</div>
                            <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{e.employee_id}</div>
                          </td>
                          <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-muted)' }}>{e.app_key}</td>
                          <td className="px-3 py-2 text-center">{e.icps}</td>
                          <td className="px-3 py-2 text-center">{e.leads}</td>
                          <td className="px-3 py-2 text-center">{e.researched}</td>
                          <td className="px-3 py-2 text-center" style={{ color: e.pending ? 'var(--accent)' : 'inherit' }}>{e.pending}</td>
                          <td className="px-3 py-2 text-center" style={{ color: e.sent ? 'var(--green)' : 'inherit' }}>{e.sent}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{fmt(e.last_activity)}</td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => openDrill(e)} disabled={drillBusy}
                              className="px-2 py-1 rounded text-[11px]" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* Drill-down drawer */}
      {drill && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setDrill(null)}>
          <div className="w-full max-w-2xl h-full overflow-y-auto" style={{ background: 'var(--bg)', borderLeft: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b sticky top-0" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold">{drill.emp.display_name || drill.emp.employee_id}</h2>
                  <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{drill.emp.app_key} · {drill.emp.employee_id}</p>
                </div>
                <button onClick={() => setDrill(null)} className="px-3 py-1.5 rounded text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>Close</button>
              </div>
            </div>

            <div className="p-4">
              <h3 className="text-sm font-semibold mb-2">ICPs <span style={{ color: 'var(--text-muted)' }}>({drill.icps.length})</span></h3>
              {drill.icps.length === 0 ? (
                <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>No ICP defined yet.</p>
              ) : (
                <div className="space-y-2 mb-6">
                  {drill.icps.map((icp) => <IcpCard key={icp.id} icp={icp} />)}
                </div>
              )}

              <h3 className="text-sm font-semibold mb-2">Pending & recent drafts <span style={{ color: 'var(--text-muted)' }}>({drill.approvals.length})</span></h3>
              {drill.approvals.length === 0 ? (
                <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>No outreach drafts yet.</p>
              ) : (
                <div className="space-y-2 mb-6">
                  {drill.approvals.map((a) => (
                    <div key={a.id} className="rounded p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{a.person_name || '—'} <span className="font-normal text-[11px]" style={{ color: 'var(--text-muted)' }}>{[a.title, a.company].filter(Boolean).join(' · ')}</span></div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                          style={{ background: 'var(--bg-input)', color: a.status === 'sent' ? 'var(--green)' : a.status === 'pending' ? 'var(--accent)' : 'var(--text-muted)' }}>
                          {a.status} · {a.channel}
                        </span>
                      </div>
                      <p className="text-[12px] mt-2 whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>{a.message}</p>
                      <div className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>{fmt(a.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="text-sm font-semibold mb-2">Leads <span style={{ color: 'var(--text-muted)' }}>({drill.leads.length})</span></h3>
              {drill.leads.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No leads yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {drill.leads.map((l) => (
                    <div key={l.id} className="rounded p-2.5 flex items-center gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{l.full_name || '—'} <span className="font-normal text-[11px]" style={{ color: 'var(--text-muted)' }}>{[l.title, l.company_name].filter(Boolean).join(' · ')}</span></div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{l.icp_name || '—'} · {l.stage}{l.email ? ' · ✉' : ''}</div>
                      </div>
                      {l.icp_score != null && (
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--bg-input)', color: l.fit_label === 'strong_fit' ? 'var(--green)' : 'var(--text-muted)' }}>{l.icp_score}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chips({ label, items, tone }: { label: string; items?: string[]; tone?: 'exclude' }) {
  if (!items || items.length === 0) return null;
  const bg = tone === 'exclude' ? 'rgba(239,68,68,0.10)' : 'var(--bg-input)';
  const fg = tone === 'exclude' ? '#ef4444' : 'var(--text)';
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 mb-1.5">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)', minWidth: 74 }}>{label}</span>
      {items.map((it, i) => (
        <span key={i} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: bg, color: fg, border: '1px solid var(--border)' }}>{it}</span>
      ))}
    </div>
  );
}

function IcpCard({ icp }: { icp: Icp }) {
  const c = icp.criteria || {};
  const w = c.weights || {};
  const f = (icp.filters || {}) as Record<string, unknown>;
  const filterList = (k: string): string[] => {
    const v = f[k];
    return Array.isArray(v) ? v.map(String) : [];
  };
  return (
    <div className="rounded p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">
          {icp.name}
          {!icp.is_active && <span className="ml-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>(archived)</span>}
        </div>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{icp.prospects} leads</span>
      </div>
      {icp.search_keywords && (
        <p className="text-[11px] mb-2 font-mono" style={{ color: 'var(--text-muted)' }}>&ldquo;{icp.search_keywords}&rdquo;</p>
      )}

      <div className="text-[10px] uppercase tracking-wider mt-2 mb-1" style={{ color: 'var(--accent)' }}>Scoring criteria</div>
      <Chips label="Titles" items={c.titles} />
      <Chips label="Seniority" items={c.seniority} />
      <Chips label="Industries" items={c.industries} />
      <Chips label="Locations" items={c.locations} />
      <Chips label="Sizes" items={c.company_sizes} />
      <Chips label="Exclude" items={c.exclude_titles} tone="exclude" />
      <Chips label="Exclude co." items={c.exclude_companies} tone="exclude" />

      {(filterList('location').length || filterList('industry').length || filterList('function').length || filterList('company').length) > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wider mt-3 mb-1" style={{ color: 'var(--accent)' }}>LinkedIn search filters</div>
          <Chips label="Location" items={filterList('location')} />
          <Chips label="Industry" items={filterList('industry')} />
          <Chips label="Function" items={filterList('function')} />
          <Chips label="Company" items={filterList('company')} />
        </>
      )}

      {Object.keys(w).length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-2 text-[10px]" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <span className="uppercase tracking-wider">Weights</span>
          {Object.entries(w).map(([k, v]) => (
            <span key={k} className="font-mono">{k} {v}</span>
          ))}
        </div>
      )}
    </div>
  );
}
