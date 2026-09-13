'use client';

import { useState } from 'react';
import Link from 'next/link';
import { OBJECTIVES, PRODUCTS, summarizeCriteria } from '@/lib/icp';
import { blockersFor, pct } from '@/lib/icp-panel';
import type { OverviewIcp, OwnerQuota } from '@/lib/icp-panel';
import type { IcpAgentState } from '@/lib/icp';
import { relativeTime } from '@/lib/time';
import { RunPill } from '@/components/icp/IcpLeads';
import FunnelBar from '@/components/panel/FunnelBar';

export type RunMode = 'now' | 'queue' | 'enrich';

/**
 * One ICP on the overview: identity, the run pill and what blocks the next
 * tick, the stage funnel, coverage, and the actions the owner already had on
 * the old cards. Actions that run with the owner's LinkedIn stay with the
 * owner — an admin gets a hold on a colleague's ICP, not its budget.
 */
export default function IcpRow({ icp, quota, viewerUserId, isAdmin, fleet, hold, busy, onRun, onState, onArchive }: {
  icp: OverviewIcp; quota: OwnerQuota | null; viewerUserId: string; isAdmin: boolean;
  fleet: { kill_switch: boolean; leads_finder_enabled: boolean };
  /** The owner's per-person Leads Finder hold, as a label (migration 044); null = running. */
  hold?: string | null;
  busy: boolean;
  onRun: (mode: RunMode) => Promise<Record<string, unknown>>;
  onState: (state: 'running' | 'paused') => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [running, setRunning] = useState<RunMode | null>(null);
  const isOwner = icp.owner_user_id === viewerUserId;
  const blockers = blockersFor(icp, quota, { ...fleet, user_hold: hold ?? null }, (icp.agent_state as IcpAgentState | null) ?? null);
  const cov = icp.coverage;
  const run = async (mode: RunMode) => {
    setRunning(mode); setNote(null);
    try {
      const out = await onRun(mode);
      if (out?.error) setNote(String(out.error));
      else if (mode === 'enrich') setNote(String(out?.note || 'Queued for the Enricher’s next tick.'));
      else if (mode === 'queue') setNote(String(out?.note || 'Queued for the next tick.'));
      else setNote(`Analyzed ${out?.analyzed ?? 0} · matched ${out?.matched ?? 0} · new ${out?.new ?? 0} · researched ${out?.researched ?? 0}${out?.more_pages ? ' · more pages remain' : ''}`);
    } finally { setRunning(null); }
  };
  const disabledTitle = !isOwner ? 'Runs with the owner’s LinkedIn — only the owner can start it' : blockers[0];
  const canRun = isOwner && blockers.length === 0;
  const btn = (label: string, mode: RunMode, primary = false) => (
    <button onClick={() => run(mode)} disabled={!canRun || !!running || busy} title={canRun ? undefined : disabledTitle}
            className="px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-40"
            style={primary ? { background: 'var(--accent)', color: '#fff' } : { border: '1px solid var(--border)', color: 'var(--text)' }}>
      {running === mode ? '…' : label}
    </button>
  );
  const coverageLine = [
    ['emp', cov.employer], ['res', cov.research], ['email', cov.email], ['warm', cov.warm], ['route', cov.route_available],
  ].map(([k, n]) => { const p = pct(n as number, cov.total); return `${k} ${p === null ? '—' : `${p}%`}`; }).join(' · ');

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/icp/${icp.id}`} className="font-semibold hover:underline truncate">{icp.name}</Link>
            {icp.paused_at && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }} title={`${icp.paused_reason || 'paused'}${icp.paused_by_admin ? ' · by an administrator' : ''}`}>⏸ paused {relativeTime(icp.paused_at)}</span>}
            {icp.approvals.pending > 0 && <Link href={`/icp/${icp.id}#outreach`} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)' }}>{icp.approvals.pending} to approve</Link>}
          </div>
          <div className="text-[11px] flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-muted)' }}>
            {PRODUCTS.find((p) => p.key === icp.product)?.label ?? icp.product ?? '—'}
            {icp.objective && <span>· ⌾ {OBJECTIVES.find((o) => o.key === icp.objective)?.label ?? icp.objective}</span>}
            {!isOwner && <span>· <span style={{ color: 'var(--text)' }}>{icp.owner_name}</span>{icp.owner_can_source ? '' : ' · inert (no LinkedIn)'}</span>}
            <span>· {summarizeCriteria(icp.criteria)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <RunPill run={icp.last_run ?? null} queued={icp.queued_runs ?? 0} state={icp.agent_state ?? null} />
          {blockers.length > 0
            ? <span className="text-[10px]" style={{ color: 'var(--yellow)' }} title={blockers.join('\n')}>won&apos;t run: {blockers[0]}{blockers.length > 1 ? ` (+${blockers.length - 1})` : ''}</span>
            : icp.agent_state?.next_eligible_at && new Date(icp.agent_state.next_eligible_at) > new Date()
              ? <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>next {relativeTime(icp.agent_state.next_eligible_at)}</span>
              : <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>eligible on the next tick</span>}
        </div>
      </div>

      <div className="grid gap-3 items-center" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
        <FunnelBar stages={icp.stages} />
        <div className="text-[11px] text-right whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
          <b style={{ color: 'var(--text)' }}>{cov.total}</b> on list · <b style={{ color: 'var(--green)' }}>{cov.matched}</b> matched
          {cov.engaged > 0 && <> · {cov.engaged} engaged</>}
          {cov.deals > 0 && <> · <span style={{ color: 'var(--accent)' }}>{cov.deals} deals</span></>}
        </div>
      </div>
      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>coverage · {coverageLine}</div>

      <div className="flex flex-wrap gap-2 items-center">
        <Link href={`/icp/${icp.id}`} className="px-2.5 py-1 rounded-lg text-[11px] font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>Open →</Link>
        {btn('Find more now', 'now')}
        {btn('Queue a pass', 'queue')}
        {btn('Enrich now', 'enrich')}
        {icp.paused_at
          ? <button onClick={() => onState('running')} disabled={busy} className="px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-40" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>Resume</button>
          : <button onClick={() => onState('paused')} disabled={busy} className="px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} title="Hold this ICP only — reversible">Pause</button>}
        {isOwner && !isAdmin && null}
        {isOwner && <button onClick={onArchive} disabled={busy} className="ml-auto px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>Archive</button>}
        {note && <span className="w-full text-[11px]" style={{ color: note.toLowerCase().includes('error') || note.startsWith('Leads Finder can') ? 'var(--red)' : 'var(--text-muted)' }}>{note}</span>}
      </div>
    </div>
  );
}
