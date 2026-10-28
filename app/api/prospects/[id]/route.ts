import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canSource, parseActAs, resolveActingUser } from '@/lib/act-as';
import { cohortsStored } from '@/lib/cohorts-server';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.role === 'admin';

  // A prospect, its profile and its LinkedIn link are shared with the whole team (2026-10-27, Amir), like the lists and
  // /sales-leads. Changing one stays with its owner or an admin (PATCH and the action routes). The owner's drafts and
  // intro asks below are the sending account's and stay with its owner (admins see all).
  const ownerValues = isAdmin ? [params.id] : [params.id, session.userId];

  // Cohorts (090): the rank and why, and the company in two sentences + facts, for the page's header.
  const cohorts = await cohortsStored();
  const cohortCols = cohorts
    ? `, cs.score AS cohort_score, cs.why AS cohort_why, cs.signals AS cohort_signals, cs.warm_via,
         COALESCE(ap.profile ->> 'summary', cs.verdict ->> 'summary') AS company_summary,
         COALESCE(ap.profile -> 'facts', cs.verdict -> 'facts') AS company_facts`
    : '';
  const cohortJoin = cohorts
    ? `LEFT JOIN cohort_scores cs ON cs.prospect_id = p.id
       LEFT JOIN account_profiles ap ON ap.account_id = p.account_id AND ap.kind = 'company'`
    : '';
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT p.*, a.name as company_name, a.domain, a.industry, a.company_size, a.hq_location, a.website,
              c.full_name, c.email, c.title, c.seniority, c.persona_type, c.phone, c.linkedin_url,
              u.name as owner_name, i.name AS list_name ${cohortCols}
       FROM prospects p
       LEFT JOIN accounts a ON a.id = p.account_id
       LEFT JOIN contacts c ON c.id = p.contact_id
       LEFT JOIN users u ON u.id = p.owner_user_id
       LEFT JOIN icp_profiles i ON i.id = p.icp_profile_id
       ${cohortJoin}
       WHERE p.id = $1`,
      [params.id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Who the route/enrich/intro actions would run as (no audit on a read).
    const acting = await resolveActingUser(session, params.id, parseActAs(req.nextUrl.searchParams.get('as')), undefined, false);
    const actingUserId = 'error' in acting ? session.userId : acting.actingUserId;

    const briefs = await client.query(`SELECT * FROM research_briefs WHERE prospect_id = $1 ORDER BY created_at DESC`, [params.id]);
    const scores = await client.query(`SELECT * FROM qualification_scores WHERE prospect_id = $1 ORDER BY created_at DESC`, [params.id]);
    const events = await client.query(`SELECT * FROM prospect_events WHERE prospect_id = $1 ORDER BY created_at DESC LIMIT 50`, [params.id]);
    // Kernel-side drafts for this lead: cold drafts (prospect_id) and intro
    // asks to a connector on the lead's behalf (intro_for_prospect_id).
    const approvals = await client.query(
        `SELECT oa.id, oa.status, oa.kind, oa.channel, oa.subject, oa.message, oa.rationale, oa.created_at,
                oa.decided_at, oa.sent_at, oa.expires_at, oa.person_id, oa.owner_user_id,
                pe.full_name AS person_name, lc.full_name AS intro_lead_name, u.name AS owner_name,
                oa.company_conflict, oa.company_override_at, oa.check_flags, oa.edited_at, oa.rating
           FROM outreach_approvals oa
           LEFT JOIN people pe ON pe.id = oa.person_id
           LEFT JOIN prospects ip ON ip.id = oa.intro_for_prospect_id
           LEFT JOIN contacts lc ON lc.id = ip.contact_id
           LEFT JOIN users u ON u.id = oa.owner_user_id
          WHERE (oa.prospect_id = $1 OR oa.intro_for_prospect_id = $1)
            ${isAdmin ? '' : 'AND oa.owner_user_id = $2'}
          ORDER BY oa.created_at DESC LIMIT 30`, ownerValues);
    const intros = await client.query(
        `SELECT ir.id, ir.state, ir.channel, ir.path_id, ir.forwardable_blurb, ir.created_at, ir.sent_at,
                ir.replied_at, ir.approval_id, ir.connector_person_id, pe.full_name AS connector_name
           FROM intro_requests ir JOIN people pe ON pe.id = ir.connector_person_id
          WHERE ir.prospect_id = $1 ${isAdmin ? '' : 'AND ir.owner_user_id = $2'}
          ORDER BY ir.created_at DESC`, ownerValues);
    const teammates = await client.query(
        `SELECT count(*)::int AS n FROM linkedin_accounts la
          WHERE la.revoked_at IS NULL AND la.owner_user_id <> $1`, [actingUserId]);
    const ownerCan = await canSource(rows[0].owner_user_id);
    const viewerCan = await canSource(session.userId);

    return NextResponse.json({
      prospect: rows[0],
      briefs: briefs.rows,
      scores: scores.rows,
      events: events.rows,
      approvals: approvals.rows,
      intro_requests: intros.rows,
      teammates_with_linkedin: teammates.rows[0]?.n ?? 0,
      acting_user_id: actingUserId,
      owner_can_source: ownerCan,
      viewer_can_source: viewerCan,
      viewer: { user_id: session.userId, role: session.role, name: session.name },
    });
  } finally { client.release(); }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ALLOWED = new Set(['owner_user_id', 'campaign_id', 'next_action_at', 'archived_reason', 'research_summary']);
  const entries = Object.entries(body).filter(([k]) => ALLOWED.has(k));
  if (entries.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

  // Owner or admin only — a lead's owner_user_id is tenancy, not a preference.
  const sets = entries.map(([k], i) => `${k} = $${i + 3}`).join(', ');
  const values = entries.map(([, v]) => v);
  const { rows } = await pool.query(
    `UPDATE prospects SET ${sets} WHERE id = $1 AND (owner_user_id = $2 OR $${entries.length + 3}) RETURNING *`,
    [params.id, session.userId, ...values, session.role === 'admin']
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
