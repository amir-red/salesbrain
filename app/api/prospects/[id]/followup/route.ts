import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import { parseActAs, resolveActingUser } from '@/lib/act-as';
import { cleanStamp, draftInVoice } from '@/lib/voice-context';

/**
 * Step 8 — the follow-up to someone we messaged who has not answered.
 *   {action:'draft'}   the model writes touch N+1 in the owner's voice (Brand & Voice context + checks);
 *                      saves nothing; returns `voice`, which the page sends back with propose so the
 *                      owner's edit can be learned from
 *   {action:'propose'} files it through the kernel as a kind='followup' approval
 *                      (card to the owner's Telegram / /agents) — the send gate
 *                      consumes that approval; nothing goes out from here
 *   {action:'skip'}    clears the cadence timer: no more follow-ups to this person
 *                      until we message them again
 * Runs as the lead's OWNER for an admin (lib/act-as), like the intro ask.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: 'draft' | 'propose' | 'skip'; as?: string; message?: string; voice?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.action || !['draft', 'propose', 'skip'].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'draft' | 'propose' | 'skip'" }, { status: 400 });
  }
  const acting = await resolveActingUser(session, params.id, parseActAs(body.as),
    body.action === 'propose' ? 'crm_outreach_propose' : `followup_${body.action}`, body.action !== 'draft');
  if ('error' in acting) return NextResponse.json({ error: acting.error }, { status: acting.status });

  const { rows } = await pool.query(
    `SELECT p.person_id, p.touch_count, p.last_contacted_at, p.research_summary,
            c.full_name, c.title, a.name AS company, i.criteria->>'product' AS product,
            (SELECT t.id FROM linkedin_threads t
               JOIN linkedin_accounts la ON la.id = t.account_id
              WHERE la.owner_user_id = p.owner_user_id AND la.revoked_at IS NULL
                AND p.person_id IS NOT NULL AND t.person_id = p.person_id
              ORDER BY t.last_message_at DESC NULLS LAST LIMIT 1) AS thread_id,
            (SELECT jsonb_build_object('message', oa.message, 'sent_at', oa.sent_at)
               FROM outreach_approvals oa
              WHERE oa.prospect_id = p.id AND oa.status = 'sent' AND oa.kind <> 'connect'
              ORDER BY oa.sent_at DESC LIMIT 1) AS last_sent
       FROM prospects p
       JOIN contacts c ON c.id = p.contact_id
       LEFT JOIN accounts a ON a.id = p.account_id
       LEFT JOIN icp_profiles i ON i.id = p.icp_profile_id
      WHERE p.id = $1`, [params.id]);
  const r = rows[0];
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.action === 'skip') {
    await pool.query('UPDATE prospects SET next_followup_at = NULL, updated_at = now() WHERE id = $1', [params.id]);
    return NextResponse.json({ skipped: true });
  }

  if (body.action === 'draft') {
    const last = (r.last_sent ?? {}) as { message?: string; sent_at?: string };
    const days = last.sent_at ? Math.max(1, Math.round((Date.now() - new Date(last.sent_at).getTime()) / 86400000)) : null;
    const prompt = `You write short LinkedIn follow-up messages for B2B sales. Write in the first person as ${acting.actingName || 'me'}.

Recipient: ${r.full_name}${r.title ? `, ${r.title}` : ''}${r.company ? ` at ${r.company}` : ''}.
This is touch ${(r.touch_count ?? 1) + 1}: they have not answered the previous message${days ? `, sent ${days} days ago` : ''}.
Previous message (write the follow-up in the SAME language and register as this):
"""
${last.message || '(not on file)'}
"""
${r.product ? `What we offer: ${r.product}.` : ''}
${r.research_summary ? `About their company: ${r.research_summary}` : ''}

Rules: shorter than the previous message (at most ~60 words), no apology for following up, no pressure, one new useful thing (a concrete observation about their company, an offer to send a two-line summary, or a specific time to talk), end with one easy question. Do not repeat the previous message. Do not invent facts. Plain text, no subject line, no signature block beyond the first name.`;
    try {
      const out = await draftInVoice({ prompt, feature: 'followup_draft', userId: acting.actingUserId,
        prospectId: params.id, channel: 'linkedin', step: 'followup', maxTokens: 400 });
      if ('error' in out) return NextResponse.json({ error: out.error }, { status: 502 });
      return NextResponse.json(out);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

  // propose
  if (!body.message?.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 });
  if (!r.person_id) return NextResponse.json({ error: 'This lead has no person record yet' }, { status: 409 });
  if (!r.thread_id) return NextResponse.json({ error: 'No LinkedIn conversation with this person on the owner\'s account — the follow-up has nowhere to go' }, { status: 409 });
  try {
    const out = await kernelCall('crm_outreach_propose', {
      person_id: r.person_id, prospect_id: params.id, channel: 'linkedin', kind: 'followup',
      linkedin_thread_id: r.thread_id, message: body.message.trim(),
      rationale: `Follow-up (touch ${(r.touch_count ?? 1) + 1}) from /followups — no reply to the previous message.`,
      ...(cleanStamp(body.voice) ? { voice: cleanStamp(body.voice) } : {}),
    }, acting.actingUserId) as Record<string, unknown>;
    return NextResponse.json({ ...out, acted_as: { user_id: acting.actingUserId, name: acting.actingName, on_behalf: acting.onBehalf } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
