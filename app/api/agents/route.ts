import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * The agent registry with live status. Reads are direct SQL (registry rows,
 * policy_rules, last run per agent); switches go through the kernel so they
 * are audited and RBAC-checked in one place.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';
  const ownerScope = isAdmin ? '' : 'AND (r.owner_user_id = $1 OR r.owner_user_id IS NULL)';
  const args = isAdmin ? [] : [session.userId];

  const [defs, rules, last, day, paused, ks] = await Promise.all([
    pool.query(`SELECT * FROM agent_definitions ORDER BY name`),
    pool.query(`SELECT key, value, updated_at FROM policy_rules WHERE key LIKE 'agents.%'`),
    pool.query(
      `SELECT DISTINCT ON (r.agent) r.agent, r.id, r.status, r.trigger, r.source, r.started_at, r.finished_at,
              r.analyzed, r.matched, r.created, r.researched, r.error, i.name AS icp_name
       FROM agent_runs r LEFT JOIN icp_profiles i ON i.id = r.icp_profile_id
       WHERE r.status <> 'requested' ${ownerScope}
       ORDER BY r.agent, r.started_at DESC`, args),
    pool.query(
      `SELECT r.agent,
              count(*) FILTER (WHERE r.status IN ('success','partial'))::int AS runs,
              count(*) FILTER (WHERE r.status = 'error')::int AS errors,
              count(*) FILTER (WHERE r.status = 'skipped')::int AS skipped,
              coalesce(sum(r.analyzed), 0)::int AS analyzed, coalesce(sum(r.matched), 0)::int AS matched,
              coalesce(sum(r.created), 0)::int AS created, coalesce(sum(r.researched), 0)::int AS researched
       FROM agent_runs r WHERE r.started_at > now() - interval '24 hours' ${ownerScope}
       GROUP BY r.agent`, args),
    pool.query(
      `SELECT la.unipile_account_id, la.display_name, la.owner_user_id, u.name AS owner_name,
              la.agent_paused_at, la.agent_pause_reason, la.agent_consecutive_errors
       FROM linkedin_accounts la JOIN users u ON u.id = la.owner_user_id
       WHERE la.revoked_at IS NULL AND la.agent_paused_at IS NOT NULL ${isAdmin ? '' : 'AND la.owner_user_id = $1'}`, args),
    pool.query(`SELECT value FROM policy_rules WHERE key = 'agents.kill_switch'`),
  ]);
  const ruleByKey = Object.fromEntries(rules.rows.map((r) => [r.key, r]));
  const lastByAgent = Object.fromEntries(last.rows.map((r) => [r.agent, r]));
  const dayByAgent = Object.fromEntries(day.rows.map((r) => [r.agent, r]));
  return NextResponse.json({
    is_admin: isAdmin,
    kill_switch: ks.rows[0]?.value?.enabled !== false,
    agents: defs.rows.map((d) => ({
      ...d,
      enabled: Boolean(ruleByKey[d.policy_key]?.value?.enabled),
      config: ruleByKey[d.policy_key]?.value ?? {},
      last_run: lastByAgent[d.name] ?? null,
      last_24h: dayByAgent[d.name] ?? { runs: 0, errors: 0, skipped: 0, analyzed: 0, matched: 0, created: 0, researched: 0 },
    })),
    paused_accounts: paused.rows,
  });
}

/** Admin switches: { agent, enabled } or { kill_switch: boolean }. */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let body: { agent?: string; enabled?: boolean; kill_switch?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    if (typeof body.kill_switch === 'boolean') {
      // Kill switch has no ring tool on purpose (it is an emergency lever, not
      // something the chat agent should be able to flip); audited here.
      await pool.query(
        `UPDATE policy_rules SET value = jsonb_set(value, '{enabled}', $1::jsonb), updated_at = now(), updated_by = $2
         WHERE key = 'agents.kill_switch'`, [body.kill_switch ? 'true' : 'false', session.userId]);
      await pool.query(
        `INSERT INTO agent_audit_log (actor_user_id, command, input, status, detail) VALUES ($1, 'agents_kill_switch', $2, 'success', 'web')`,
        [session.userId, JSON.stringify({ enabled: body.kill_switch })]);
      return NextResponse.json({ kill_switch: body.kill_switch });
    }
    if (body.agent && typeof body.enabled === 'boolean') {
      const out = await kernelCall('crm_agent_set_enabled', { agent: body.agent, enabled: body.enabled }, session.userId);
      return NextResponse.json(out);
    }
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
