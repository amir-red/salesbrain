/**
 * ICP control panel — the client-safe contract between the two read endpoints
 * (`GET /api/icp/overview`, `GET /api/icp/[id]/panel`) and the pages that
 * render them. Pure types and helpers; no DB, no server imports.
 */
import type { AgentRun, IcpAgentState, IcpProfile } from '@/lib/icp';
import { PROSPECT_STAGES } from '@/lib/prospecting';
import type { ProspectStage } from '@/lib/prospecting';

export interface Budget { used: number; cap: number }

/** One owner's spend against today's ceilings — the kernel's linkedin_quota, ported to SQL. */
export interface OwnerQuota {
  owner_user_id: string;
  connected: boolean;
  tier: 'free' | 'sales_navigator';
  unipile_account_id: string | null;
  display_name: string | null;
  paused_at: string | null;
  pause_reason: string | null;
  /** Leads Finder searches (agent_runs) vs agents.leads_finder.searches_per_account_per_day. */
  search: Budget;
  /** Enricher profile fetches (prospect_enrichment employer/unipile) vs agents.enricher.profile_fetches_per_account_per_day. */
  profile: Budget;
  /** Email-provider credits spent vs agents.enricher.email_credits_per_day. */
  email_credits: Budget;
  /** Raw LinkedIn calls by action class vs the tier's safe-rate caps. */
  linkedin: Partial<Record<'search' | 'profile_view' | 'message' | 'relations', Budget>>;
  errors_24h: number;
  blocks_24h: number;
}

export type StageCounts = Partial<Record<ProspectStage, number>>;

export interface Coverage {
  total: number; scored: number; matched: number; eligible: number;
  employer: number; research: number; email: number; warm: number;
  routed: number; route_available: number; engaged: number; deals: number;
}

export interface OverviewIcp extends IcpProfile {
  owner_user_id: string;
  owner_name: string;
  owner_can_source: boolean;
  stages: StageCounts;
  coverage: Coverage;
  approvals: { pending: number; sent: number };
  queued: { leads_finder: number; enricher: number };
}

export interface OverviewPayload {
  is_admin: boolean;
  scope: 'mine' | 'all';
  viewer_user_id: string;
  icps: OverviewIcp[];
  quota_by_owner: Record<string, OwnerQuota>;
  /** Per-person agent holds (migration 044), owner → agent → human label. Absent = running. */
  holds_by_owner?: Record<string, Record<string, string>>;
}

export interface AgentDef {
  name: string; label: string; description: string | null; kind: 'timer' | 'routine'; schedule: string | null;
  policy_key: string; enabled: boolean; config: Record<string, unknown>;
  last_run: (AgentRun & { icp_name?: string | null }) | null;
  last_24h: { runs: number; errors: number; skipped: number; analyzed: number; matched: number; created: number; researched: number };
}
export interface PausedAccount {
  unipile_account_id: string; display_name: string | null; owner_name: string; owner_user_id: string;
  agent_paused_at: string; agent_pause_reason: string | null; agent_consecutive_errors: number;
}
/** Shape of GET /api/agents — the fleet strip's source. */
export interface FleetPayload { is_admin: boolean; kill_switch: boolean; agents: AgentDef[]; paused_accounts: PausedAccount[] }

export interface PanelApproval {
  id: string; status: string; kind: string | null; channel: string; subject: string | null; message: string;
  rationale: string | null; created_at: string; decided_at: string | null; sent_at: string | null; expires_at: string;
  person_name: string | null; intro_lead_name: string | null; owner_name: string | null; lead_prospect_id: string | null;
}

export interface PanelPayload {
  viewer: { user_id: string; role: string };
  icp: IcpProfile & { owner_user_id: string; owner_name: string };
  is_owner: boolean;
  blockers: string[];
  quota: OwnerQuota;
  policy: {
    kill_switch: boolean;
    enabled: Record<string, boolean>;
    leads_finder: Record<string, unknown>;
    enricher: Record<string, unknown>;
  };
  fit: { strong: number; proceed: number; weak: number; do_not_pursue: number; unscored: number };
  stages: StageCounts;
  coverage: Coverage;
  finder: {
    state: (IcpAgentState & { page_cursor: string | null }) | null;
    queued: number;
    runs: AgentRun[];
    daily: { day: string; runs: number; analyzed: number; matched: number; created: number }[];
  };
  enricher: {
    attempts_7d: { kind: string; result: string; n: number; credits: number }[];
    failures: { prospect_id: string; full_name: string | null; kind: string; source: string | null; result: string; created_at: string; detail: Record<string, unknown> | null }[];
    runs: AgentRun[];
    queued: number;
  };
  graph: {
    totals: { edges: number; people: number };
    sync: { phase: string; relations_pages_done: number; relations_seen: number; mirror_completed_at: string | null; last_run_at: string | null; last_error: string | null } | null;
    last_run: AgentRun | null;
    degrees: { d1: number; d2: number; d3: number; unknown: number };
    hops: { hops: number; n: number }[];
    top_routed: { prospect_id: string; full_name: string | null; company_name: string | null; icp_score: number | null; hops: number; computed_at: string | null }[];
  };
  outreach: {
    pending: PanelApproval[];
    by_status: Record<string, number>;
    intros: {
      by_state: Record<string, number>;
      open: { id: string; state: string; connector_name: string | null; lead_name: string | null; prospect_id: string; sent_at: string | null; next_followup_at: string | null; created_at: string }[];
    };
    last_run: AgentRun | null;
  };
  activity: AgentRun[];
}

/** Stage colours: grey while raw, blue while the machinery works it, green once a human is in the loop, muted when terminal. */
export const STAGE_COLORS: Record<ProspectStage, string> = {
  P0_IMPORTED: '#6b7280',
  P1_ENRICHED: '#60a5fa',
  P2_ICP_CHECKED: '#3b82f6',
  P3_RESEARCH_READY: '#2563eb',
  P4_OUTREACH_DRAFTED: '#a78bfa',
  P5_SENT: '#f59e0b',
  P6_REPLIED: '#22c55e',
  P7_QUALIFIED: '#16a34a',
  P8_DISQUALIFIED: '#3f3f46',
  P9_ARCHIVED: '#27272a',
};

/** Percentage 0–100, or null when there is nothing to divide by (rendered as "—"). */
export function pct(n: number, d: number): number | null {
  if (!d) return null;
  return Math.round((n / d) * 100);
}

export function funnelSegments(stages: StageCounts): { stage: ProspectStage; label: string; n: number; color: string }[] {
  return PROSPECT_STAGES
    .map((s) => ({ stage: s.stage, label: s.label, n: stages[s.stage] ?? 0, color: STAGE_COLORS[s.stage] }))
    .filter((s) => s.n > 0);
}

/** Sum of a stage-count map (the ICP's list size). */
export function stageTotal(stages: StageCounts): number {
  return Object.values(stages).reduce((a, b) => a + (b ?? 0), 0);
}

/**
 * Why the Leads Finder will NOT run for this ICP right now, in the order the
 * scheduler checks (policy/leads_finder.should_run): kill switch → agent
 * enabled → held for this person → ICP held → LinkedIn present → account
 * paused → search budget → exhausted → backoff. Empty means "eligible on the
 * next tick".
 */
export function blockersFor(
  icp: { paused_at?: string | null; paused_reason?: string | null; paused_by_admin?: boolean },
  quota: OwnerQuota | null,
  policy: { kill_switch: boolean; leads_finder_enabled: boolean; user_hold?: string | null },
  state: IcpAgentState | null,
  now: Date = new Date(),
): string[] {
  const out: string[] = [];
  if (!policy.kill_switch) out.push('Kill switch is on — every agent is stopped');
  if (!policy.leads_finder_enabled) out.push('Leads Finder is disabled on /agents');
  if (policy.user_hold) out.push(`Leads Finder is held for this user — ${policy.user_hold}`);
  if (icp.paused_at) out.push(`ICP is paused${icp.paused_reason ? ` — ${icp.paused_reason}` : ''}${icp.paused_by_admin ? ' (by an administrator)' : ''}`);
  if (quota && !quota.connected) out.push('Owner has no LinkedIn connected — nothing can source');
  if (quota?.paused_at) out.push(`LinkedIn account paused — ${quota.pause_reason || 'provider errors'}`);
  if (quota && quota.search.cap > 0 && quota.search.used >= quota.search.cap) out.push(`Daily search budget spent (${quota.search.used}/${quota.search.cap})`);
  if (state?.exhausted_at) out.push('Every search variant is exhausted — retries after the cool-off');
  if (state?.next_eligible_at && new Date(state.next_eligible_at) > now) out.push(`Backing off until ${new Date(state.next_eligible_at).toLocaleString()}`);
  return out;
}

export const FIT_COLORS = {
  strong: 'var(--green)', proceed: 'var(--yellow)', weak: 'var(--orange)', do_not_pursue: 'var(--red)', unscored: 'var(--text-muted)',
} as const;

export const ENRICH_KINDS = ['employer', 'research', 'email', 'warm', 'domain'] as const;
export const ENRICH_RESULTS = ['found', 'no_match', 'low_confidence', 'conflict', 'suppressed', 'error', 'skipped'] as const;
