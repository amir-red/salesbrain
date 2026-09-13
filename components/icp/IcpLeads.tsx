'use client';

import { RUN_STATUS_COLOR } from '@/lib/icp';
import type { AgentRun, IcpAgentState } from '@/lib/icp';
import { relativeTime } from '@/lib/time';

/**
 * Pieces shared by the ICP pages and /agents: the run pill, the activity feed
 * and the degree/warm badge. The in-place leads view that used to live here
 * became /icp/[id] (components/icp/LeadsTable.tsx renders the table).
 */

export function RunPill({ run, queued, state }: { run: AgentRun | null; queued: number; state: IcpAgentState | null }) {
  if (!run && !queued) {
    return <span className="text-[11px] px-2 py-1 rounded-full" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>agent hasn&apos;t run yet</span>;
  }
  const color = run ? RUN_STATUS_COLOR[run.status] : 'var(--accent)';
  const label = !run ? 'queued' : run.status === 'skipped' ? `skipped · ${run.detail?.reason || ''}`
    : run.status === 'error' ? `error · ${(run.error || '').slice(0, 60)}`
    : `ran ${relativeTime(run.started_at)} · ${run.analyzed} analyzed · ${run.matched} matched · ${run.created} new`;
  return (
    <span className="text-[11px] px-2 py-1 rounded-full inline-flex items-center gap-1.5" style={{ background: `${color}18`, color }} title={run?.source || ''}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
      {queued > 0 && <span style={{ color: 'var(--text-muted)' }}>· {queued} queued</span>}
      {state?.exhausted_at && <span style={{ color: 'var(--text-muted)' }}>· exhausted</span>}
    </span>
  );
}

export function ActivityList({ runs, showIcp = false }: { runs: AgentRun[]; showIcp?: boolean }) {
  if (runs.length === 0) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No agent activity yet.</p>;
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {runs.map((r) => {
        const color = RUN_STATUS_COLOR[r.status];
        return (
          <div key={r.id} className="p-3 grid grid-cols-[150px_1fr_220px] gap-3 items-start" style={{ borderTop: '1px solid var(--border)' }}>
            <div>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${color}22`, color }}>{r.status}</span>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{relativeTime(r.started_at)} · {r.trigger}</div>
              {showIcp && r.icp_name && <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{r.icp_name}</div>}
            </div>
            <div className="text-xs min-w-0">
              <div className="truncate">{r.source || (r.agent === 'leads_finder' ? 'Lead discovery' : r.agent)}</div>
              {r.status === 'skipped' && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.detail?.reason}</div>}
              {r.status !== 'skipped' && typeof r.detail?.note === 'string' && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.detail.note}</div>}
              {r.error && <div className="text-[11px]" style={{ color: 'var(--red)' }}>{r.error}</div>}
              {r.detail?.top && r.detail.top.length > 0 && (
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {r.detail.top.slice(0, 3).map((t, i) => <div key={i} className="truncate">· {t.name} — {t.headline} ({t.icp_score})</div>)}
                </div>
              )}
              {r.detail?.filter_notes && r.detail.filter_notes.length > 0 && (
                <div className="text-[10px] mt-1" style={{ color: 'var(--orange)' }}>{r.detail.filter_notes.join(' · ')}</div>
              )}
            </div>
            <div className="text-xs text-right" style={{ color: 'var(--text-muted)' }}>
              {r.status !== 'skipped' && (<>{r.analyzed} analyzed · <span style={{ color: r.matched ? 'var(--green)' : undefined }}>{r.matched} matched</span> · {r.created} new{r.researched ? ` · ${r.researched} researched` : ''}</>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DegreeWarm({ degree, paths }: { degree: string | null; paths: { type: string; value?: string; note: string }[] | null }) {
  // The single `route` entry is step 5's stored result, not an angle — it gets
  // its own badge below and must not inflate the angle count.
  const warm = (paths || []).filter((w) => w.type !== 'route');
  const route = (paths || []).find((w) => w.type === 'route') as { best_path_hops?: number | null; path_available?: boolean; bridge_candidates?: unknown[] } | undefined;
  const colleague = warm.find((w) => w.type === 'colleague');
  const label = degree === '1' ? '1st' : degree === '2' ? '2nd' : degree === '3' ? '3rd' : null;
  const color = degree === '1' ? 'var(--green)' : degree === '2' ? 'var(--yellow)' : 'var(--text-muted)';
  if (!label && warm.length === 0 && !route) return null;
  const tip = warm.map((w) => w.note).join(' \u00b7 ') || (label ? `${label} degree connection` : '');
  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle" title={tip}>
      {label && <span className="text-[9px] px-1 rounded" style={{ background: `${color}22`, color }}>{label}</span>}
      {warm.length > 0 && <span className="text-[9px]" style={{ color: colleague ? 'var(--accent)' : 'var(--green)' }}>{colleague ? '\ud83e\udd1d intro' : `\ud83d\udd25 ${warm.length}`}</span>}
      {route && (
        route.path_available
          ? <span className="text-[9px] px-1 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)' }} title="a warm route exists">route \u00b7 {route.best_path_hops} hop{route.best_path_hops === 1 ? '' : 's'}</span>
          : <span className="text-[9px] px-1 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }} title={(route.bridge_candidates?.length || 0) > 0 ? 'no route yet — bridge candidates exist' : 'no route yet'}>{(route.bridge_candidates?.length || 0) > 0 ? 'bridge' : 'cold'}</span>
      )}
    </span>
  );
}
