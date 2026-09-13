'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { relativeTime } from '@/lib/time';
import { AGENTS } from '@/lib/users-panel';
import type { AgentName, HoldState, UserIcp, UserRowData } from '@/lib/users-panel';
import type { AgentRun } from '@/lib/icp';
import ProgressBar from '@/components/panel/ProgressBar';
import AgentChip from '@/components/users/AgentChip';
import { ActivityList } from '@/components/icp/IcpLeads';

/**
 * One person on /admin/users: who they are and who registered them, their
 * LinkedIn and MCP activity, one chip per agent with the per-person controls,
 * and their ICPs (each deletable = archived through the kernel). Expanding the
 * row loads their recent runs.
 */
export default function UserRow({ user, agentsMeta, killSwitch, busy, onSetState, onDeleteIcp }: {
  user: UserRowData;
  agentsMeta: { name: AgentName; label: string; enabled: boolean }[];
  killSwitch: boolean;
  busy: boolean;
  onSetState: (agent: AgentName, state: HoldState) => Promise<void>;
  onDeleteIcp: (icp: UserIcp) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  useEffect(() => {
    if (!open || runs) return;
    fetch(`/api/agents/runs?owner=${encodeURIComponent(user.id)}&limit=30`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: AgentRun[]) => setRuns(rows))
      .catch(() => setRuns([]));
  }, [open, runs, user.id]);

  const q = user.quota;
  const external = user.registered_by !== 'internal';
  const held = AGENTS.filter((a) => user.agents[a].state !== 'running').length;

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: `1px solid ${held ? 'var(--yellow)' : 'var(--border)'}` }}>
      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(220px,1.4fr) minmax(180px,1fr) minmax(160px,0.9fr)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{user.name || user.email}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg-input)', color: external ? 'var(--accent)' : 'var(--text-muted)' }}
                  title={external ? 'Registered by this app through the service MCP' : 'Signs in to SalesBrain directly'}>
              {user.registered_by}
            </span>
            {user.role === 'admin' && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>admin</span>}
            {held > 0 && <span className="text-[10px]" style={{ color: 'var(--yellow)' }}>{held} agent{held > 1 ? 's' : ''} held</span>}
          </div>
          <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
            {external ? <span className="font-mono">{user.employee_id}</span> : user.email}
            {user.telegram_username && <> · @{user.telegram_username}</>}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            last seen {user.last_seen_at ? relativeTime(user.last_seen_at) : 'never'} · joined {relativeTime(user.created_at)}
          </div>
        </div>

        <div className="min-w-0 text-[11px]">
          {q?.connected ? (
            <>
              <div className="flex items-center gap-2">
                <span>LinkedIn · {q.tier === 'sales_navigator' ? 'Sales Nav' : 'free'}</span>
                {q.paused_at && <span style={{ color: 'var(--red)' }} title={q.pause_reason || 'paused for agents'}>⏸ paused</span>}
                {q.errors_24h > 0 && <span style={{ color: 'var(--red)' }}>{q.errors_24h} errors</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <ProgressBar used={q.search.used} cap={q.search.cap} label="searches" compact />
                <ProgressBar used={q.profile.used} cap={q.profile.cap} label="profile fetches" compact />
              </div>
            </>
          ) : <span style={{ color: 'var(--text-muted)' }}>LinkedIn · not connected</span>}
        </div>

        <div className="min-w-0 text-[11px]">
          <div>MCP · <b>{user.mcp.calls_24h}</b> calls (24h)</div>
          <div className="truncate" style={{ color: 'var(--text-muted)' }}>
            {user.mcp.last_tool ? <><span className="font-mono">{user.mcp.last_tool}</span> · {user.mcp.last_at ? relativeTime(user.mcp.last_at) : ''}</> : 'no MCP calls yet'}
          </div>
        </div>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        {AGENTS.map((a) => (
          <AgentChip key={a} agent={a} cell={user.agents[a]}
                     enabled={agentsMeta.find((m) => m.name === a)?.enabled ?? false} killSwitch={killSwitch}
                     outreach={a === 'outreach' ? user.outreach : undefined}
                     busy={busy} onSetState={(state) => { void onSetState(a, state); }} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span style={{ color: 'var(--text-muted)' }}>ICPs</span>
        {user.icps.length === 0 && <span style={{ color: 'var(--text-muted)' }}>none</span>}
        {user.icps.map((i) => (
          <span key={i.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <Link href={`/icp/${i.id}`} className="hover:underline truncate max-w-[220px]">{i.name}</Link>
            <span style={{ color: 'var(--text-muted)' }}>· {i.prospects}</span>
            {i.state === 'paused' && <span title={`${i.paused_reason || 'paused'}${i.paused_by_admin ? ' · by an administrator' : ''}`}>⏸</span>}
            {i.pending > 0 && <span style={{ color: 'var(--green)' }} title="drafts awaiting approval">{i.pending} to approve</span>}
            <button onClick={() => { void onDeleteIcp(i); }} disabled={busy} className="ml-1 disabled:opacity-40" style={{ color: 'var(--red)' }}
                    title="Delete this ICP: archives it and stops all work on it. Its leads stay.">✕</button>
          </span>
        ))}
        <button onClick={() => setOpen((v) => !v)} className="ml-auto underline" style={{ color: 'var(--text-muted)' }}>
          {open ? 'hide runs' : 'recent runs'}
        </button>
      </div>

      {open && (
        <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          {runs === null ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p> : <ActivityList runs={runs} showIcp />}
        </div>
      )}
    </div>
  );
}
