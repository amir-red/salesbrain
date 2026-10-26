import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { auditBestEffort, guardEditable } from '@/lib/icp-server';

const MAX_PER_CLICK = 25;   // the web rungs are free; the LinkedIn rung is guard-bounded
const RETRY_DAYS = 14;

/**
 * Find the next N profiles by name on this list: the leads without a LinkedIn
 * identifier, in the list's own order, that no lookup touched within the retry
 * window. Each is one people search on the list OWNER's account (an admin on a
 * colleague's list acts as the owner, audited), run one after another so the
 * safe-rate guard paces them. Writes a slug only on exactly one strong match;
 * everything else is kept for a person to pick. Contacts no one.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const guard = await guardEditable(params.id, session);
  if (guard.denied) return guard.denied;
  const icp = guard.icp;
  let body: { limit?: number } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const limit = Number.isFinite(Number(body.limit)) && Number(body.limit) > 0
    ? Math.min(Math.floor(Number(body.limit)), MAX_PER_CLICK) : MAX_PER_CLICK;

  const { rows } = await pool.query(
    `SELECT p.id, c.full_name, a.name AS company
       FROM prospects p
       LEFT JOIN contacts c ON c.id = p.contact_id
       LEFT JOIN accounts a ON a.id = p.account_id
      WHERE p.icp_profile_id = $1 AND p.owner_user_id = $2
        AND p.linkedin_public_id IS NULL AND p.linkedin_member_id IS NULL
        AND p.stage IN ('P0_IMPORTED', 'P1_ENRICHED', 'P2_ICP_CHECKED', 'P3_RESEARCH_READY')
        AND NOT EXISTS (SELECT 1 FROM prospect_enrichment e
                         WHERE e.prospect_id = p.id AND e.kind = 'linkedin'
                           AND e.created_at > now() - ($3 || ' days')::interval)
      -- strong fits first, then the list's own order: the LinkedIn rung's budget should go to the best leads
      ORDER BY (p.icp_score >= 75) DESC, p.priority_rank NULLS LAST, p.icp_score DESC NULLS LAST, p.created_at
      LIMIT $4`,
    [icp.id, icp.owner_user_id, String(RETRY_DAYS), limit]);
  if (rows.length === 0) {
    return NextResponse.json({ attempted: 0, note: 'Nothing to look up: every lead without a profile was searched in the last two weeks.' });
  }
  const onBehalf = icp.owner_user_id !== session.userId;
  if (onBehalf) await auditBestEffort(session.userId, 'act_as', { icp_id: icp.id, as: icp.owner_user_id, command: 'crm_enrich_prospect:linkedin', count: rows.length });

  const results: { prospect_id: string; name: string | null; result: string; linkedin_public_id?: string | null; reason?: string | null; rung?: string | null; discovered?: number }[] = [];
  let discoveredTotal = 0;
  for (const r of rows) {
    try {
      const out = (await kernelCall('crm_enrich_prospect', { prospect_id: r.id, kinds: ['linkedin'] }, icp.owner_user_id)) as Record<string, unknown>;
      const li = out.linkedin as Record<string, unknown> | string | undefined;
      if (out.error || typeof li !== 'object' || !li) {
        results.push({ prospect_id: r.id, name: r.full_name, result: 'error', reason: String(out.error || li || 'no result') });
        // A refusal (hold, kill switch, no account, budget) applies to every lead: stop spending.
        if (out.error) break;
        continue;
      }
      const landed = Array.isArray(li.discovered) ? (li.discovered as { landed?: boolean }[]).filter((d) => d.landed).length : 0;
      discoveredTotal += landed;
      results.push({ prospect_id: r.id, name: r.full_name, result: String(li.result), linkedin_public_id: (li.linkedin_public_id as string | null) ?? null, reason: (li.reason as string | null) ?? null, rung: (li.rung as string | null) ?? null, discovered: landed });
      if (li.result === 'error' && /budget|cap reached|paused|no LinkedIn account/i.test(String(li.reason || ''))) break;
    } catch (err) {
      results.push({ prospect_id: r.id, name: r.full_name, result: 'error', reason: err instanceof Error ? err.message : String(err) });
      break;
    }
  }
  const n = (k: string) => results.filter((x) => x.result === k).length;
  const parts = [`${n('found')} found`];
  if (n('ambiguous')) parts.push(`${n('ambiguous')} need a pick`);
  if (n('no_match')) parts.push(`${n('no_match')} no match`);
  if (n('duplicate')) parts.push(`${n('duplicate')} already on the list`);
  if (n('error')) parts.push(`${n('error')} error${n('error') > 1 ? 's' : ''}`);
  if (discoveredTotal) parts.push(`${discoveredTotal} decision maker${discoveredTotal > 1 ? 's' : ''} found via company and added`);
  const stopped = results.length < rows.length ? ` Stopped after ${results.length} of ${rows.length}: ${results[results.length - 1]?.reason || 'refused'}.` : '';
  return NextResponse.json({
    attempted: results.length, results,
    note: `Looked up ${results.length}: ${parts.join(' · ')}.${stopped}`,
    acted_as: { user_id: icp.owner_user_id, name: icp.owner_name, on_behalf: onBehalf },
  });
}
