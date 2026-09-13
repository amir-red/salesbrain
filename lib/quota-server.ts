/**
 * Server-only: one owner's spend against today's ceilings, computed straight
 * from Postgres for the control panel's polled reads (no kernel subprocess).
 *
 * Mirrors the kernel exactly — salesbrain-core commands/agents.py::searches_today,
 * commands/enrichment.py::profile_fetches_today / email_credits_today and
 * policy/linkedin_limits.py::tier / caps_for / DEFAULTS. If the kernel's
 * predicates change, change them here too; the panel's bars must agree with
 * what crm_linkedin_quota tells the agent.
 */
import pool from '@/lib/db';
import type { Budget, OwnerQuota } from '@/lib/icp-panel';

/** Anything with pg's query(): the shared pool, or one checked-out client. */
export interface Queryable { query: typeof pool.query }

type Tier = 'free' | 'sales_navigator';
const LINKEDIN_ACTIONS = ['search', 'profile_view', 'message', 'relations'] as const;

// policy/linkedin_limits.py DEFAULTS — merged UNDER the agents.linkedin_limits row.
const LINKEDIN_DEFAULTS: Record<Tier, Record<string, number>> = {
  free: { search: 20, profile_view: 80, message: 25, relations: 60, inbox_read: 400, params: 120 },
  sales_navigator: { search: 40, profile_view: 300, message: 40, relations: 120, inbox_read: 800, params: 240 },
};
const SEARCHES_PER_ACCOUNT_PER_DAY = 12;   // agents.leads_finder seed
const PROFILE_FETCHES_PER_ACCOUNT_PER_DAY = 30; // agents.enricher seed
const EMAIL_CREDITS_PER_DAY = 20;          // agents.enricher seed

function tierOf(premiumFeatures: unknown): Tier {
  const feats: string[] = Array.isArray(premiumFeatures)
    ? premiumFeatures.map((f) => String(f).toLowerCase())
    : typeof premiumFeatures === 'string' ? [premiumFeatures.toLowerCase()] : [];
  return feats.some((f) => f.includes('sales_navigator') || f.includes('sales navigator')) ? 'sales_navigator' : 'free';
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== undefined && v !== '' ? n : fallback;
}

interface AccountRow {
  owner_user_id: string; unipile_account_id: string; display_name: string | null;
  premium_features: unknown; agent_paused_at: string | null; agent_pause_reason: string | null;
}

/**
 * Quotas for a set of owners, in five grouped queries regardless of how many
 * owners. Runs them SEQUENTIALLY on `db` (default: the pool): the Supabase
 * pooler is in session mode with 15 clients shared with production, so a
 * polled read must never fan out — pass the request's checked-out client.
 */
export async function ownerQuotas(ownerIds: string[], db: Queryable = pool): Promise<Record<string, OwnerQuota>> {
  const ids = Array.from(new Set(ownerIds.filter(Boolean)));
  if (ids.length === 0) return {};

  const rules = await db.query(`SELECT key, value FROM policy_rules WHERE key IN ('agents.leads_finder','agents.enricher','agents.linkedin_limits')`);
  const accounts = await db.query<AccountRow>(
      `SELECT owner_user_id, unipile_account_id, display_name, premium_features, agent_paused_at, agent_pause_reason
         FROM linkedin_accounts WHERE owner_user_id = ANY($1::uuid[]) AND revoked_at IS NULL
        ORDER BY connected_at ASC`, [ids]);
  const searches = await db.query(
      `SELECT owner_user_id, count(*)::int AS n FROM agent_runs
        WHERE agent = 'leads_finder' AND owner_user_id = ANY($1::uuid[])
          AND status IN ('running','success','partial','error')
          AND started_at > now() - interval '24 hours'
        GROUP BY 1`, [ids]);
  const enrich = await db.query(
      `SELECT owner_user_id,
              count(*) FILTER (WHERE kind = 'employer' AND source = 'unipile')::int AS fetches,
              coalesce(sum(credits) FILTER (WHERE kind = 'email'), 0)::int AS credits
         FROM prospect_enrichment
        WHERE owner_user_id = ANY($1::uuid[]) AND created_at > now() - interval '24 hours'
        GROUP BY 1`, [ids]);
  const requests = await db.query(
      `SELECT la.owner_user_id, lr.action, count(*)::int AS n,
              count(*) FILTER (WHERE NOT lr.ok)::int AS errors,
              count(*) FILTER (WHERE lr.blocked)::int AS blocks
         FROM linkedin_requests lr
         JOIN linkedin_accounts la ON la.unipile_account_id = lr.unipile_account_id AND la.revoked_at IS NULL
        WHERE la.owner_user_id = ANY($1::uuid[]) AND lr.created_at > now() - interval '24 hours'
        GROUP BY 1, 2`, [ids]);

  const rule = Object.fromEntries(rules.rows.map((r) => [r.key, (r.value ?? {}) as Record<string, unknown>]));
  const finder = rule['agents.leads_finder'] ?? {};
  const enricher = rule['agents.enricher'] ?? {};
  const limits = rule['agents.linkedin_limits'] ?? {};
  const searchCap = num(finder.searches_per_account_per_day, SEARCHES_PER_ACCOUNT_PER_DAY);
  const profileCap = num(enricher.profile_fetches_per_account_per_day, PROFILE_FETCHES_PER_ACCOUNT_PER_DAY);
  const creditCap = num(enricher.email_credits_per_day, EMAIL_CREDITS_PER_DAY);
  const capsFor = (tier: Tier): Record<string, number> => ({
    ...LINKEDIN_DEFAULTS[tier], ...((limits[tier] as Record<string, number> | undefined) ?? {}),
  });

  // First non-revoked account per owner (the kernel picks one the same way).
  const accountByOwner = new Map<string, AccountRow>();
  for (const a of accounts.rows) if (!accountByOwner.has(a.owner_user_id)) accountByOwner.set(a.owner_user_id, a);
  const searchesByOwner = new Map(searches.rows.map((r) => [r.owner_user_id as string, r.n as number]));
  const enrichByOwner = new Map(enrich.rows.map((r) => [r.owner_user_id as string, r]));
  const reqByOwner = new Map<string, { action: string; n: number; errors: number; blocks: number }[]>();
  for (const r of requests.rows) {
    const list = reqByOwner.get(r.owner_user_id) ?? [];
    list.push(r);
    reqByOwner.set(r.owner_user_id, list);
  }

  const out: Record<string, OwnerQuota> = {};
  for (const owner of ids) {
    const acct = accountByOwner.get(owner) ?? null;
    const tier = tierOf(acct?.premium_features);
    const caps = capsFor(tier);
    const reqs = reqByOwner.get(owner) ?? [];
    const linkedin: OwnerQuota['linkedin'] = {};
    for (const action of LINKEDIN_ACTIONS) {
      const used = reqs.find((r) => r.action === action)?.n ?? 0;
      linkedin[action] = { used, cap: caps[action] ?? 0 } satisfies Budget;
    }
    const e = enrichByOwner.get(owner);
    out[owner] = {
      owner_user_id: owner,
      connected: Boolean(acct),
      tier,
      unipile_account_id: acct?.unipile_account_id ?? null,
      display_name: acct?.display_name ?? null,
      paused_at: acct?.agent_paused_at ?? null,
      pause_reason: acct?.agent_pause_reason ?? null,
      search: { used: searchesByOwner.get(owner) ?? 0, cap: searchCap },
      profile: { used: Number(e?.fetches ?? 0), cap: profileCap },
      email_credits: { used: Number(e?.credits ?? 0), cap: creditCap },
      linkedin,
      errors_24h: reqs.reduce((a, r) => a + r.errors, 0),
      blocks_24h: reqs.reduce((a, r) => a + r.blocks, 0),
    };
  }
  return out;
}
