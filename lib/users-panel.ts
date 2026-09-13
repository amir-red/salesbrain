/**
 * Admin "Users" page — the client-safe contract between GET /api/admin/users/
 * overview and the page that renders it. Pure types and helpers; no DB, no
 * server imports (mirrors lib/icp-panel.ts).
 *
 * One row per person: who registered them (internal, or a sibling app through
 * the service MCP), their LinkedIn and MCP activity, and one cell per background
 * agent with its per-person hold (migration 044: running / paused / stopped).
 */
import type { AgentRun } from '@/lib/icp';
import type { OwnerQuota } from '@/lib/icp-panel';

export const AGENTS = ['leads_finder', 'enricher', 'graph_sync', 'outreach'] as const;
export type AgentName = typeof AGENTS[number];
export const AGENT_LABELS: Record<AgentName, string> = {
  leads_finder: 'Leads Finder', enricher: 'Enricher', graph_sync: 'Relationship Graph', outreach: 'Outreach',
};

export type HoldState = 'running' | 'paused' | 'stopped';
export const HOLD_STATES: HoldState[] = ['running', 'paused', 'stopped'];

export interface UserHold {
  state: HoldState; reason: string | null; by_admin: boolean;
  changed_by_name: string | null; changed_at: string;
}

/** One agent for one person. `hold` is null when no row exists; a row with state
 *  'running' is a lifted hold and records who continued it. */
export interface AgentCell {
  state: HoldState; hold: UserHold | null;
  last_run: AgentRun | null;
  runs_24h: number; errors_24h: number; skipped_24h: number;
  running_now: number; queued: number;
}

/** Outreach runs belong to the service user, so the per-person view is derived from approvals. */
export interface OutreachCell { pending: number; drafted_24h: number; sent_24h: number; last_draft_at: string | null }

export interface UserIcp {
  id: string; name: string; state: 'running' | 'paused';
  paused_at: string | null; paused_reason: string | null; paused_by_admin: boolean;
  prospects: number; pending: number; updated_at: string;
}

export interface UserRowData {
  id: string; name: string | null; email: string; role: string; created_at: string;
  /** 'internal', or the sibling app's app_key that registered them through the service MCP. */
  registered_by: string;
  employee_id: string | null;
  last_seen_at: string | null;
  telegram_username: string | null;
  quota: OwnerQuota | null;
  mcp: { calls_24h: number; last_tool: string | null; last_at: string | null };
  agents: Record<AgentName, AgentCell>;
  outreach: OutreachCell;
  icps: UserIcp[];
}

export interface UsersOverviewPayload {
  users: UserRowData[];
  total: number;
  apps: string[];
  agents: { name: AgentName; label: string; enabled: boolean }[];
  kill_switch: boolean;
}

export interface UsersFilter {
  q: string;                       // server-side: name / email / employee id
  app: string;                     // server-side: 'all' | 'internal' | <app_key>
  agent: 'any' | AgentName;        // client-side from here on
  state: 'any' | 'held' | HoldState;
  linkedin: boolean;
  runningNow: boolean;
  errors24h: boolean;
}
export const EMPTY_FILTER: UsersFilter = {
  q: '', app: 'all', agent: 'any', state: 'any', linkedin: false, runningNow: false, errors24h: false,
};

export function holdLabel(h: UserHold | null): string {
  if (!h) return 'running';
  if (h.state === 'running') return `continued by ${h.changed_by_name || (h.by_admin ? 'an administrator' : 'the owner')}`;
  const who = h.by_admin ? 'an administrator' : 'the owner';
  const by = h.changed_by_name ? ` (${h.changed_by_name})` : '';
  return `${h.state} by ${who}${by}${h.reason ? ` — ${h.reason}` : ''}`;
}

function cellMatches(c: AgentCell, state: UsersFilter['state']): boolean {
  if (state === 'any') return true;
  if (state === 'held') return c.state !== 'running';
  return c.state === state;
}

/** The filters that do not change the row set, applied over the fetched page. */
export function applyClientFilters(rows: UserRowData[], f: UsersFilter): UserRowData[] {
  return rows.filter((u) => {
    const cells = f.agent === 'any' ? AGENTS.map((a) => u.agents[a]) : [u.agents[f.agent]];
    if (f.state !== 'any' && !cells.some((c) => cellMatches(c, f.state))) return false;
    if (f.linkedin && !u.quota?.connected) return false;
    if (f.runningNow && !cells.some((c) => c.running_now > 0)) return false;
    if (f.errors24h && !cells.some((c) => c.errors_24h > 0)) return false;
    return true;
  });
}
