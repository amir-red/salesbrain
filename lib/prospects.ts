/**
 * Shared prospect ("lead") types + the journey model. Client-safe: no DB, no IO.
 *
 * The lead is the unit of the outreach pipeline. Every stage is a surface on
 * the lead, and the relationship graph appears exactly once — step 5, "how do
 * I reach this person" — as a route drawn red → blue → … → green.
 */

export interface Prospect {
  id: string;
  stage: string;
  icp_score: number | null;
  fit_label: string | null;
  qualification_reason: string | null;
  research_summary: string | null;
  reply_status: string | null;
  next_action_at: string | null;
  last_contacted_at: string | null;
  last_replied_at: string | null;
  converted_deal_id: string | null;
  archived_reason: string | null;
  source_type: string | null;
  source_detail: string | null;
  created_at: string;
  scored_at?: string | null;
  engaged_at?: string | null;
  person_id?: string | null;
  linkedin_public_id?: string | null;
  linkedin_member_id?: string | null;
  network_degree: string | null;
  warm_paths: WarmPath[] | null;
  // joined
  company_name: string | null;
  domain?: string | null;
  industry: string | null;
  company_size: string | null;
  hq_location?: string | null;
  website?: string | null;
  full_name: string | null;
  email: string | null;
  title: string | null;
  seniority?: string | null;
  persona_type?: string | null;
  phone?: string | null;
  linkedin_url: string | null;
  owner_name?: string | null;
  owner_user_id?: string | null;
}

/** One entry of prospects.warm_paths. Angles (employer/school/colleague) are
 *  what the enricher writes; the single `route` entry is what step 5 writes. */
export interface WarmPath {
  type: string;            // 'employer' | 'school' | 'colleague' | 'route' | …
  value?: string;
  note?: string;
  [k: string]: unknown;
}

export type RouteColor = 'red' | 'blue' | 'yellow' | 'green' | 'grey';
export type RouteRole = 'owner' | 'colleague' | 'connection' | 'target';

export interface RoutePerson { person_id: string; name: string; role: RouteRole }
export interface RouteHop {
  from: RoutePerson;
  to: RoutePerson;
  channel: 'linkedin' | 'email' | null;
  confidence: number;
  source: string;
  evidence: string;
  why_this_person: string | null;
  actionable_now: boolean;
}
export interface RoutePath { path_id: string; score: number; hops: RouteHop[] }
export interface BridgeCandidate {
  person_id: string; name: string; headline: string | null; org: string | null;
  connector_score: number; evidence: string; source: string; is_blue: boolean; known: boolean;
}
export interface RouteGraphNode {
  id: string; label: string; color: RouteColor; role: RouteRole; hop: number;
  headline?: string | null; org?: string | null; is_blue?: boolean;
}
export interface RouteGraphEdge {
  from: string; to: string; strength: number; channel: string | null; source: string | null; path_ids: string[];
}
export interface RouteEntry extends WarmPath {
  type: 'route';
  target: { person_id: string; name: string; prospect_id: string | null; org?: string | null;
            network_degree?: string | null; is_blue?: boolean; channel?: string | null };
  best_path_hops: number | null;
  path_available: boolean;
  computed_at: string;
  paths: RoutePath[];
  bridge_candidates: BridgeCandidate[];
  graph: { nodes: RouteGraphNode[]; edges: RouteGraphEdge[] };
  note?: string;
  expand?: Record<string, unknown>;
}

/** What crm_route_expand spent and found — shown verbatim so a skipped step is never silent. */
export interface RouteExpand {
  profile?: { fetched: boolean; error?: string; cached?: boolean; degree?: string | null; shared_connections_count?: number | null; employers?: number };
  mutual?: { searched: boolean; skipped?: string; found?: number; pages?: number; mode?: string; edges?: number; error?: string | null; budget?: { used_today: number; cap: number } };
  probe?: { accounts_checked: number; hits: number };
  notes?: string[];
}
export type ActAs = 'owner' | 'me';
export interface ActedAs { user_id: string; name: string; on_behalf: boolean }

export const ROUTE_COLORS: Record<RouteColor, string> = {
  red: '#ef4444', blue: '#3b82f6', yellow: '#eab308', green: '#22c55e', grey: '#64748b',
};
export const ROUTE_LEGEND: { color: RouteColor; label: string }[] = [
  { color: 'red', label: 'you / a teammate' },
  { color: 'blue', label: 'you can message now' },
  { color: 'yellow', label: 'knows the lead, not reachable yet' },
  { color: 'green', label: 'the lead' },
];

export function routeEntry(warm: WarmPath[] | null | undefined): RouteEntry | null {
  const r = (warm || []).find((w) => w && w.type === 'route');
  return (r as RouteEntry | undefined) ?? null;
}
/** The angles the enricher wrote — everything that is not the route. */
export function warmAngles(warm: WarmPath[] | null | undefined): WarmPath[] {
  return (warm || []).filter((w) => w && w.type !== 'route');
}

// ─── The journey ────────────────────────────────────────────────────

export type JourneyKey =
  | 'imported' | 'icp_fit' | 'enriched' | 'route' | 'drafted' | 'sent' | 'replied' | 'qualified' | 'deal';

export interface JourneyStep { key: JourneyKey; label: string; hint: string }

export const JOURNEY: JourneyStep[] = [
  { key: 'imported', label: 'Imported', hint: 'Sourced from LinkedIn, CSV or by hand' },
  { key: 'icp_fit', label: 'ICP fit', hint: 'Scored against the ICP' },
  { key: 'enriched', label: 'Enriched', hint: 'Employer, company research, email' },
  { key: 'route', label: 'Route', hint: 'How to reach them: a warm route or cold' },
  { key: 'drafted', label: 'Drafted', hint: 'A first message or an intro ask awaits approval' },
  { key: 'sent', label: 'Sent', hint: 'Delivered through the policy gate' },
  { key: 'replied', label: 'Replied', hint: 'They wrote back' },
  { key: 'qualified', label: 'Qualified', hint: 'Worth a deal' },
  { key: 'deal', label: 'Deal', hint: 'In the pipeline' },
];

export interface ApprovalLite { id: string; status: string; kind?: string | null; sent_at?: string | null }
export interface IntroRequestLite { id: string; state: string; connector_name?: string | null; sent_at?: string | null }

export type StepState = 'done' | 'current' | 'todo';

/** Which journey steps are done, from the stage + the fields the stages don't
 *  cover (route entry, pending approvals, intro asks). Pure. */
export function journeyState(
  p: Pick<Prospect, 'stage' | 'icp_score' | 'research_summary' | 'email' | 'company_name' | 'converted_deal_id' | 'warm_paths' | 'last_contacted_at' | 'last_replied_at'>,
  approvals: ApprovalLite[] = [],
  intros: IntroRequestLite[] = [],
): Record<JourneyKey, StepState> {
  const stageOrder = ['P0_IMPORTED', 'P1_ENRICHED', 'P2_ICP_CHECKED', 'P3_RESEARCH_READY', 'P4_OUTREACH_DRAFTED',
    'P5_SENT', 'P6_REPLIED', 'P7_QUALIFIED'];
  const idx = stageOrder.indexOf(p.stage);
  const route = routeEntry(p.warm_paths);
  const anyApproval = approvals.length > 0;
  const anySent = approvals.some((a) => a.status === 'sent') || intros.some((i) => ['awaiting_reply', 'sent', 'replied', 'forwarded'].includes(i.state)) || !!p.last_contacted_at;
  const done: Record<JourneyKey, boolean> = {
    imported: true,
    icp_fit: p.icp_score !== null && p.icp_score !== undefined,
    enriched: !!(p.research_summary || p.email) && !!p.company_name,
    route: !!route,
    drafted: anyApproval || intros.length > 0 || idx >= stageOrder.indexOf('P4_OUTREACH_DRAFTED'),
    sent: anySent || idx >= stageOrder.indexOf('P5_SENT'),
    replied: !!p.last_replied_at || idx >= stageOrder.indexOf('P6_REPLIED'),
    qualified: idx >= stageOrder.indexOf('P7_QUALIFIED'),
    deal: !!p.converted_deal_id,
  };
  const out = {} as Record<JourneyKey, StepState>;
  let currentSet = false;
  for (const s of JOURNEY) {
    if (done[s.key]) out[s.key] = 'done';
    else if (!currentSet) { out[s.key] = 'current'; currentSet = true; }
    else out[s.key] = 'todo';
  }
  return out;
}
