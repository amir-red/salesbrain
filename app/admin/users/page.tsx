'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import UsersFilterBar from '@/components/users/UsersFilterBar';
import UserRow from '@/components/users/UserRow';
import { AGENT_LABELS, EMPTY_FILTER, applyClientFilters } from '@/lib/users-panel';
import type { AgentName, HoldState, UserIcp, UserRowData, UsersFilter, UsersOverviewPayload } from '@/lib/users-panel';
import { usePoll } from '@/lib/use-poll';
import { relativeTime } from '@/lib/time';

/**
 * /admin/users — every person the agents act for, one row each: who registered
 * them, LinkedIn + MCP activity, and one chip per agent with pause / stop /
 * continue. Delete on an ICP archives it through the kernel. Polls every 45 s.
 */
export default function UsersAdminPage() {
  const [data, setData] = useState<UsersOverviewPayload | null>(null);
  const [filter, setFilter] = useState<UsersFilter>(EMPTY_FILTER);
  const [server, setServer] = useState({ q: '', app: 'all' });   // debounced copy of the server-side filters
  const [busy, setBusy] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setServer({ q: filter.q.trim(), app: filter.app }), 300);
    return () => clearTimeout(t);
  }, [filter.q, filter.app]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (server.q) params.set('q', server.q);
    if (server.app !== 'all') params.set('app', server.app);
    const res = await fetch(`/api/admin/users/overview?${params.toString()}`);
    if (res.status === 403) { setForbidden(true); return; }
    if (!res.ok) throw new Error('Failed to load users');
    setData(await res.json());
  }, [server]);
  const { refresh, loading, lastAt, error } = usePoll(load, 45_000);

  const setAgentState = async (user: UserRowData, agent: AgentName, state: HoldState) => {
    let reason: string | undefined;
    const who = user.name || user.email;
    if (state !== 'running') {
      const answer = prompt(`${state === 'paused' ? 'Pause' : 'Stop'} ${AGENT_LABELS[agent]} for ${who}?\n\n${AGENT_LABELS[agent]} will not plan ${who} again until you continue it. Nothing in flight is cancelled; queued requests wait.\n\nReason (optional):`);
      if (answer === null) return;
      reason = answer.trim() || undefined;
    }
    setBusy(user.id);
    try {
      const res = await fetch('/api/admin/users/agent-state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_user_id: user.id, agent, state, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) alert(json.error || 'Could not change the agent state');
      await refresh();
    } finally { setBusy(null); }
  };
  const deleteIcp = async (user: UserRowData, icp: UserIcp) => {
    if (!confirm(`Delete "${icp.name}"?\n\nThis archives the ICP and stops sourcing, enrichment and drafting for it. Its ${icp.prospects} leads keep their link; re-creating the same name revives it.`)) return;
    setBusy(user.id);
    try {
      const res = await fetch(`/api/icp/${icp.id}/state`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'stopped', reason: 'deleted from /admin/users' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) alert(json.error || 'Could not delete the ICP');
      await refresh();
    } finally { setBusy(null); }
  };

  const shown = data ? applyClientFilters(data.users, filter) : [];
  const live = data?.kill_switch ?? true;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Users</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Every person the agents act for, what each agent is doing for them, and the per-person switches
              {lastAt && <> · updated {relativeTime(lastAt.toISOString())} · <button onClick={() => refresh()} className="underline">refresh</button></>}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            {data && <span style={{ color: live ? 'var(--green)' : 'var(--red)' }}>● {live ? 'agents live' : 'KILL SWITCH — all agents stopped'}</span>}
            <Link href="/agents" className="underline" style={{ color: 'var(--text-muted)' }}>Agents →</Link>
            <Link href="/icp" className="underline" style={{ color: 'var(--text-muted)' }}>ICP lists →</Link>
            <Link href="/admin/service" className="underline" style={{ color: 'var(--text-muted)' }}>Service integrations →</Link>
            <Link href="/admin/linkedin" className="underline" style={{ color: 'var(--text-muted)' }}>LinkedIn health →</Link>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {forbidden && <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>Admin only — sign in as an administrator to manage users.</div>}
          {error && <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>Last refresh failed ({error}){data ? '; showing the previous data.' : '.'}</div>}
          {!forbidden && (
            <UsersFilterBar filter={filter} apps={data?.apps ?? []} shown={shown.length} total={data?.total ?? 0} onChange={setFilter} />
          )}
          {loading && !data && !forbidden && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
          {data && shown.length === 0 && <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>No users match.</p>}
          <div className="space-y-3">
            {shown.map((u) => (
              <UserRow key={u.id} user={u} agentsMeta={data?.agents ?? []} killSwitch={live} busy={busy === u.id}
                       onSetState={(agent, state) => setAgentState(u, agent, state)}
                       onDeleteIcp={(icp) => deleteIcp(u, icp)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
