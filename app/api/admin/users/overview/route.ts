import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ownerQuotas } from '@/lib/quota-server';
import { AGENTS, AGENT_LABELS } from '@/lib/users-panel';
import type {
  AgentCell, AgentName, HoldState, OutreachCell, UserHold, UserIcp, UserRowData, UsersOverviewPayload,
} from '@/lib/users-panel';
import type { AgentRun } from '@/lib/icp';

/**
 * GET /api/admin/users/overview?q=&app= — every person the agents can act for,
 * with what each agent is doing for them right now and their per-person holds.
 * Admin only: it reads across owners on purpose.
 *
 * Direct SQL, polled every 45 s. ONE checked-out client, queries strictly in
 * sequence: the Supabase pooler is in session mode (15 clients, shared with
 * production) and a fan-out here 500s with EMAXCONNSESSION. `q` and `app`
 * bound the row set server-side; every other filter is applied on the client.
 */
export const dynamic = 'force-dynamic';

const SERVICE_UID = '00000000-0000-0000-0000-000000000000';
const key = (owner: string, agent: string) => `${owner}|${agent}`;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const latest = (...vals: (string | null | undefined)[]): string | null =>
  vals.filter((v): v is string => Boolean(v)).sort().pop() ?? null;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  const app = (req.nextUrl.searchParams.get('app') || 'all').trim();

  const client = await pool.connect();
  try {
    const users = await client.query(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
              e.app_key, e.employee_id, e.display_name AS ext_name, e.last_seen_at AS ext_last_seen,
              tl.telegram_username
         FROM users u
         LEFT JOIN LATERAL (
           SELECT app_key, employee_id, display_name, last_seen_at FROM external_employees
            WHERE salesbrain_user_id = u.id ORDER BY last_seen_at DESC NULLS LAST LIMIT 1) e ON true
         LEFT JOIN LATERAL (
           SELECT telegram_username FROM telegram_user_links
            WHERE user_id = u.id AND revoked_at IS NULL ORDER BY linked_at DESC LIMIT 1) tl ON true
        WHERE u.id <> $3
          AND ($1::text IS NULL OR u.name ILIKE $1 OR u.email ILIKE $1
               OR e.employee_id ILIKE $1 OR e.display_name ILIKE $1)
          AND ($2::text IS NULL OR ($2 = 'internal' AND e.app_key IS NULL) OR e.app_key = $2)
        ORDER BY e.last_seen_at DESC NULLS LAST, u.name
        LIMIT 300`,
      [q ? `%${q}%` : null, app === 'all' ? null : app, SERVICE_UID],
    );
    const ids = users.rows.map((r) => r.id as string);

    const apps = await client.query(`SELECT DISTINCT app_key FROM external_employees ORDER BY 1`);
    const defs = await client.query(`SELECT name, label FROM agent_definitions ORDER BY name`);
    const rules = await client.query(`SELECT key, value FROM policy_rules WHERE key LIKE 'agents.%'`);
    const rule: Record<string, Record<string, unknown>> = Object.fromEntries(rules.rows.map((r) => [r.key, r.value ?? {}]));
    const killSwitch = rule['agents.kill_switch']?.enabled !== false;
    const agentsMeta = AGENTS.map((name) => ({
      name,
      label: (defs.rows.find((d) => d.name === name)?.label as string | undefined) || AGENT_LABELS[name],
      enabled: Boolean(rule[`agents.${name}`]?.enabled),
    }));

    const none = { rows: [] as Record<string, never>[] };
    const holds = ids.length === 0 ? none : await client.query(
      `SELECT s.owner_user_id, s.agent, s.state, s.reason, s.by_admin, s.changed_at, cu.name AS changed_by_name
         FROM user_agent_state s LEFT JOIN users cu ON cu.id = s.changed_by
        WHERE s.owner_user_id = ANY($1::uuid[])`, [ids]);
    const rollup = ids.length === 0 ? none : await client.query(
      `SELECT owner_user_id, agent,
              count(*) FILTER (WHERE started_at > now() - interval '24 hours' AND status IN ('success','partial'))::int AS runs_24h,
              count(*) FILTER (WHERE started_at > now() - interval '24 hours' AND status = 'error')::int AS errors_24h,
              count(*) FILTER (WHERE started_at > now() - interval '24 hours' AND status = 'skipped')::int AS skipped_24h,
              count(*) FILTER (WHERE status = 'running' AND started_at > now() - interval '6 hours')::int AS running_now,
              count(*) FILTER (WHERE status = 'requested')::int AS queued
         FROM agent_runs
        WHERE owner_user_id = ANY($1::uuid[])
          AND (started_at > now() - interval '24 hours' OR status IN ('running','requested'))
        GROUP BY 1, 2`, [ids]);
    const last = ids.length === 0 ? none : await client.query(
      `SELECT DISTINCT ON (r.owner_user_id, r.agent)
              r.owner_user_id, r.agent, r.id, r.status, r.trigger, r.source, r.started_at, r.finished_at,
              r.analyzed, r.matched, r.created, r.researched, r.error, r.detail, i.name AS icp_name
         FROM agent_runs r LEFT JOIN icp_profiles i ON i.id = r.icp_profile_id
        WHERE r.owner_user_id = ANY($1::uuid[]) AND r.status <> 'requested'
        ORDER BY r.owner_user_id, r.agent, r.started_at DESC`, [ids]);
    const outreach = ids.length === 0 ? none : await client.query(
      `SELECT owner_user_id,
              count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS drafted_24h,
              count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '24 hours')::int AS sent_24h,
              max(created_at) AS last_draft_at
         FROM outreach_approvals WHERE owner_user_id = ANY($1::uuid[]) GROUP BY 1`, [ids]);
    const icps = ids.length === 0 ? none : await client.query(
      `SELECT i.id, i.owner_user_id, i.name, i.paused_at, i.paused_reason, i.paused_by_admin, i.updated_at,
              CASE WHEN i.paused_at IS NOT NULL THEN 'paused' ELSE 'running' END AS state,
              (SELECT count(*)::int FROM prospects p WHERE p.icp_profile_id = i.id) AS prospects,
              (SELECT count(*)::int FROM outreach_approvals oa
                 JOIN prospects p ON p.id = COALESCE(oa.intro_for_prospect_id, oa.prospect_id)
                WHERE p.icp_profile_id = i.id AND oa.status = 'pending') AS pending
         FROM icp_profiles i
        WHERE i.is_active AND i.owner_user_id = ANY($1::uuid[])
        ORDER BY i.owner_user_id, i.updated_at DESC`, [ids]);
    const mcpLast = ids.length === 0 ? none : await client.query(
      `SELECT DISTINCT ON (user_id) user_id, tool_name, created_at FROM mcp_audit_log
        WHERE user_id = ANY($1::uuid[]) ORDER BY user_id, created_at DESC`, [ids]);
    const mcpCount = ids.length === 0 ? none : await client.query(
      `SELECT user_id, count(*)::int AS n FROM mcp_audit_log
        WHERE user_id = ANY($1::uuid[]) AND created_at > now() - interval '24 hours' GROUP BY 1`, [ids]);
    const quota = await ownerQuotas(ids, client);

    const holdBy = new Map<string, UserHold>();
    for (const r of holds.rows) holdBy.set(key(r.owner_user_id, r.agent), {
      state: r.state as HoldState, reason: r.reason ?? null, by_admin: Boolean(r.by_admin),
      changed_by_name: r.changed_by_name ?? null, changed_at: iso(r.changed_at) as string,
    });
    const rollupBy = new Map<string, Record<string, number>>();
    for (const r of rollup.rows) rollupBy.set(key(r.owner_user_id, r.agent), r);
    const lastBy = new Map<string, AgentRun>();
    for (const r of last.rows) lastBy.set(key(r.owner_user_id, r.agent), r as AgentRun);
    const outreachBy = new Map<string, OutreachCell>();
    for (const r of outreach.rows) outreachBy.set(r.owner_user_id, {
      pending: r.pending, drafted_24h: r.drafted_24h, sent_24h: r.sent_24h, last_draft_at: iso(r.last_draft_at),
    });
    const icpsBy = new Map<string, UserIcp[]>();
    for (const r of icps.rows) {
      const list = icpsBy.get(r.owner_user_id) ?? [];
      list.push({ id: r.id, name: r.name, state: r.state, paused_at: iso(r.paused_at), paused_reason: r.paused_reason ?? null,
                  paused_by_admin: Boolean(r.paused_by_admin), prospects: r.prospects, pending: r.pending, updated_at: iso(r.updated_at) as string });
      icpsBy.set(r.owner_user_id, list);
    }
    const mcpLastBy = new Map<string, { tool: string; at: string }>();
    for (const r of mcpLast.rows) mcpLastBy.set(r.user_id, { tool: r.tool_name, at: iso(r.created_at) as string });
    const mcpCountBy = new Map<string, number>();
    for (const r of mcpCount.rows) mcpCountBy.set(r.user_id, r.n);

    const zero: OutreachCell = { pending: 0, drafted_24h: 0, sent_24h: 0, last_draft_at: null };
    const rows: UserRowData[] = users.rows.map((u) => {
      const agents = {} as Record<AgentName, AgentCell>;
      let lastRunAt: string | null = null;
      for (const a of AGENTS) {
        const hold = holdBy.get(key(u.id, a)) ?? null;
        const ru = rollupBy.get(key(u.id, a));
        const lr = lastBy.get(key(u.id, a)) ?? null;
        if (lr) lastRunAt = latest(lastRunAt, iso(lr.started_at));
        agents[a] = {
          state: hold?.state ?? 'running', hold, last_run: lr,
          runs_24h: ru?.runs_24h ?? 0, errors_24h: ru?.errors_24h ?? 0, skipped_24h: ru?.skipped_24h ?? 0,
          running_now: ru?.running_now ?? 0, queued: ru?.queued ?? 0,
        };
      }
      const mcp = mcpLastBy.get(u.id);
      return {
        id: u.id, name: u.name ?? u.ext_name ?? null, email: u.email, role: u.role, created_at: iso(u.created_at) as string,
        registered_by: u.app_key ?? 'internal', employee_id: u.employee_id ?? null,
        last_seen_at: iso(u.ext_last_seen) ?? latest(mcp?.at ?? null, lastRunAt),
        telegram_username: u.telegram_username ?? null,
        quota: quota[u.id] ?? null,
        mcp: { calls_24h: mcpCountBy.get(u.id) ?? 0, last_tool: mcp?.tool ?? null, last_at: mcp?.at ?? null },
        agents, outreach: outreachBy.get(u.id) ?? zero, icps: icpsBy.get(u.id) ?? [],
      };
    });
    rows.sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '') || (a.name ?? a.email).localeCompare(b.name ?? b.email));

    const payload: UsersOverviewPayload = {
      users: rows, total: rows.length,
      apps: apps.rows.map((r) => r.app_key as string),
      agents: agentsMeta, kill_switch: killSwitch,
    };
    return NextResponse.json(payload);
  } finally { client.release(); }
}
