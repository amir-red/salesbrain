'use client';

import { RUN_STATUS_COLOR } from '@/lib/icp';
import { relativeTime } from '@/lib/time';
import { AGENT_LABELS, holdLabel } from '@/lib/users-panel';
import type { AgentCell, AgentName, HoldState, OutreachCell } from '@/lib/users-panel';

const STATE_COLOR: Record<HoldState, string> = { running: 'var(--green)', paused: 'var(--yellow)', stopped: 'var(--red)' };

/**
 * One agent for one person: the per-person state, what it last did for them,
 * and the three controls. Pause and Stop both stop planning (no cancel); the
 * difference is intent, and the reason travels with the hold.
 */
export default function AgentChip({ agent, cell, enabled, killSwitch, outreach, busy, onSetState }: {
  agent: AgentName; cell: AgentCell; enabled: boolean; killSwitch: boolean;
  outreach?: OutreachCell; busy: boolean;
  onSetState: (state: HoldState) => void;
}) {
  const color = STATE_COLOR[cell.state];
  const off = !killSwitch || !enabled;
  const btn = (label: string, state: HoldState, tone: 'primary' | 'danger' | 'plain' = 'plain') => (
    <button key={label} onClick={() => onSetState(state)} disabled={busy}
            className="px-2 py-0.5 rounded text-[10px] disabled:opacity-40"
            style={tone === 'primary' ? { background: 'var(--accent)', color: '#fff' }
                 : tone === 'danger' ? { border: '1px solid var(--red)', color: 'var(--red)' }
                 : { border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
      {label}
    </button>
  );
  const lr = cell.last_run;

  return (
    <div className="rounded-lg p-2 min-w-0"
         style={{ background: 'var(--bg-input)', border: `1px solid ${cell.state === 'running' ? 'var(--border)' : color}` }}
         title={cell.hold ? holdLabel(cell.hold) : undefined}>
      <div className="flex items-center gap-1.5 text-[11px] min-w-0">
        <span className="font-medium truncate">{AGENT_LABELS[agent]}</span>
        <span className="px-1 rounded text-[9px] uppercase shrink-0" style={{ background: `${color}22`, color }}>{cell.state}</span>
        {off && <span className="text-[9px] shrink-0" style={{ color: 'var(--text-muted)' }} title={!killSwitch ? 'Kill switch — every agent is stopped' : 'Disabled on /agents'}>off</span>}
      </div>
      {cell.hold && (
        <div className="text-[10px] truncate" style={{ color: cell.state === 'running' ? 'var(--text-muted)' : color }}>
          {holdLabel(cell.hold)} · {relativeTime(cell.hold.changed_at)}
        </div>
      )}
      {agent === 'outreach' && outreach ? (
        <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
          <span style={{ color: outreach.pending ? 'var(--accent)' : undefined }}>{outreach.pending} pending</span>
          {' · '}{outreach.drafted_24h} drafted · {outreach.sent_24h} sent (24h)
          {outreach.last_draft_at && <div>last draft {relativeTime(outreach.last_draft_at)}</div>}
        </div>
      ) : (
        <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
          {lr
            ? <><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: RUN_STATUS_COLOR[lr.status] }} />{lr.status} {relativeTime(lr.started_at)}{lr.icp_name ? ` · ${lr.icp_name}` : ''}</>
            : 'never ran for them'}
          <div>
            24h: {cell.runs_24h} runs
            {cell.errors_24h > 0 && <span style={{ color: 'var(--red)' }}> · {cell.errors_24h} errors</span>}
            {cell.skipped_24h > 0 && <> · {cell.skipped_24h} skipped</>}
            {cell.queued > 0 && <> · {cell.queued} queued</>}
            {cell.running_now > 0 && <span style={{ color: 'var(--accent)' }}> · running now</span>}
          </div>
        </div>
      )}
      <div className="flex gap-1 mt-1.5 flex-wrap">
        {cell.state === 'running' && <>{btn('Pause', 'paused')}{btn('Stop', 'stopped', 'danger')}</>}
        {cell.state === 'paused' && <>{btn('Continue', 'running', 'primary')}{btn('Stop', 'stopped', 'danger')}</>}
        {cell.state === 'stopped' && btn('Continue', 'running', 'primary')}
      </div>
    </div>
  );
}
