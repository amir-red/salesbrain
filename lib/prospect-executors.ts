/**
 * The four prospect executors that still have callers.
 *
 * This file once held fourteen, written for the in-app agent runtime that was
 * deleted in dca686b. Ten of them — enrich, score, research-brief, draft,
 * approve, schedule, classify-reply, recommend-next-step, archive,
 * analyze-style — plus the `executeProspectTool` dispatcher and
 * `PROSPECT_TOOL_NAMES` had no importer left, and were removed on 2026-07-30.
 *
 * What replaced them: prospecting now lives in the kernel (salesbrain-core
 * `commands/prospecting.py` — ICP scoring, sourcing, qualification, engage,
 * convert), and outreach runs through the value-first path rather than a second
 * pipeline. Scoring in particular was never real here: `exec_score_prospect_fit`
 * took the score as an *input*.
 *
 * What remains is app-owned work the kernel does not do:
 *   - create_or_import_prospect  (the /prospects and Discovery forms)
 *   - send_outreach_message      (the email send + its deliverability guards)
 *   - convert_prospect_to_deal   (the UI's Convert button)
 *   - research_company_from_url  (the Discovery "research all" button)
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from './db';
import { sendEmail } from './email';
import { normalizeDomain, normalizeCompanyName, type ProspectStage } from './prospecting';
import { MODEL, anthropic, webSearchTools } from './llm';


// ─── Helper: record a prospect_events row ───────────────────────

async function recordProspectEvent(
  prospectId: string,
  eventType: string,
  fromStage: string | null,
  toStage: string | null,
  reason: string | null,
  triggeredBy: 'agent' | 'user' | 'cron' | 'system',
  payload?: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO prospect_events (prospect_id, event_type, from_stage, to_stage, reason, triggered_by, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [prospectId, eventType, fromStage, toStage, reason, triggeredBy, payload ? JSON.stringify(payload) : null]
  );
}

async function advanceStage(prospectId: string, fromStage: string, toStage: ProspectStage, reason: string, triggeredBy: 'agent' | 'user' | 'cron' | 'system' = 'agent') {
  if (fromStage === toStage) return;
  await pool.query(`UPDATE prospects SET stage = $1 WHERE id = $2`, [toStage, prospectId]);
  await recordProspectEvent(prospectId, 'stage_change', fromStage, toStage, reason, triggeredBy);
}

// ─── create_or_import_prospect ──────────────────────────────────

export async function exec_create_or_import_prospect(
  input: {
    company_name: string;
    domain?: string;
    full_name: string;
    email?: string;
    title?: string;
    source_type?: string;
    source_detail?: string;
    campaign_id?: string;
    notes?: string;
  },
  context?: { userId?: string }
): Promise<Record<string, unknown>> {
  const { company_name, full_name } = input;
  const normalizedDomain = normalizeDomain(input.domain);
  const normalizedName = normalizeCompanyName(company_name);
  const ownerId = context?.userId || null;

  // Find or create account (dedup by domain first, then normalized name)
  let account;
  if (normalizedDomain) {
    const { rows } = await pool.query(`SELECT * FROM accounts WHERE domain = $1 LIMIT 1`, [normalizedDomain]);
    account = rows[0];
  }
  if (!account && normalizedName) {
    const { rows } = await pool.query(`SELECT * FROM accounts WHERE LOWER(name) = $1 LIMIT 1`, [normalizedName]);
    account = rows[0];
  }
  if (!account) {
    const { rows } = await pool.query(
      `INSERT INTO accounts (name, domain, source, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
      [company_name, normalizedDomain, input.source_type || 'manual', input.notes || null]
    );
    account = rows[0];
  }

  // Find or create contact — SCOPED TO CURRENT USER.
  // Two users can each own their own contact for the same email/person.
  let contact;
  if (input.email && ownerId) {
    const { rows } = await pool.query(
      `SELECT * FROM contacts WHERE LOWER(email) = LOWER($1) AND owner_user_id = $2 LIMIT 1`,
      [input.email, ownerId]
    );
    contact = rows[0];
  }
  if (!contact) {
    const parts = full_name.trim().split(/\s+/);
    const firstName = parts[0] || null;
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
    const { rows } = await pool.query(
      `INSERT INTO contacts (account_id, full_name, first_name, last_name, email, title, source, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [account.id, full_name, firstName, lastName, input.email || null, input.title || null, input.source_type || 'manual', ownerId]
    );
    contact = rows[0];
  } else if (!contact.account_id) {
    await pool.query(`UPDATE contacts SET account_id = $1 WHERE id = $2`, [account.id, contact.id]);
  }

  // Check for existing prospect for this account+contact
  const { rows: existing } = await pool.query(
    `SELECT * FROM prospects WHERE account_id = $1 AND contact_id = $2 LIMIT 1`,
    [account.id, contact.id]
  );
  if (existing.length > 0) {
    return {
      created: false,
      prospect_id: existing[0].id,
      account_id: account.id,
      contact_id: contact.id,
      reason: 'Prospect already exists for this account+contact',
    };
  }

  // owner_user_id is set HERE rather than patched by the caller. It used to be
  // omitted, and only /api/prospects patched it afterwards — so every prospect
  // created through Discovery's bulk import was ownerless. That made them
  // visible to every user (the `OR owner_user_id IS NULL` scope) and silently
  // skipped the per-user daily send cap, which only applies when an owner is set.
  const { rows: pRows } = await pool.query(
    `INSERT INTO prospects (account_id, contact_id, owner_user_id, campaign_id, stage, source_type, source_detail)
     VALUES ($1, $2, $3, $4, 'P0_IMPORTED', $5, $6) RETURNING *`,
    [account.id, contact.id, ownerId, input.campaign_id || null,
     input.source_type || 'manual', input.source_detail || null]
  );
  const prospect = pRows[0];

  await recordProspectEvent(prospect.id, 'created', null, 'P0_IMPORTED', 'Initial import', 'agent', {
    company_name, full_name, source_type: input.source_type,
  });

  return {
    created: true,
    prospect_id: prospect.id,
    account_id: account.id,
    contact_id: contact.id,
    stage: 'P0_IMPORTED',
  };
}

// ─── send_outreach_message ──────────────────────────────────────

const DAILY_SEND_LIMIT_PER_USER = parseInt(process.env.OUTREACH_DAILY_LIMIT || '50', 10);
const MIN_MINUTES_BETWEEN_SAME_DOMAIN = 3;

function buildUnsubscribeFooter(prospectId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://salescrm.chipchip.social';
  return `\n\n---\nIf you'd rather not hear from me, reply "unsubscribe" or ignore this message.\n(${base}/u/${prospectId})`;
}

export async function exec_send_outreach_message(input: { message_id: string }): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT om.*, p.stage as prospect_stage, p.owner_user_id FROM outreach_messages om
     JOIN prospects p ON p.id = om.prospect_id WHERE om.id = $1`,
    [input.message_id]
  );
  const msg = rows[0];
  if (!msg) return { error: 'Message not found' };
  if (msg.status === 'sent') return { error: 'Already sent' };
  if (!msg.to_email) return { error: 'No recipient email on contact' };

  // Suppression check
  const domain = msg.to_email.includes('@') ? msg.to_email.split('@')[1].toLowerCase() : null;
  const { rows: suppressed } = await pool.query(
    `SELECT id FROM suppression_list WHERE (LOWER(email) = LOWER($1)) OR (domain IS NOT NULL AND LOWER(domain) = $2) LIMIT 1`,
    [msg.to_email, domain]
  );
  if (suppressed.length > 0) {
    await pool.query(`UPDATE outreach_messages SET status = 'canceled' WHERE id = $1`, [input.message_id]);
    return { error: 'Recipient on suppression list', suppressed: true };
  }

  // Daily send limit per user (protects domain reputation)
  if (msg.owner_user_id) {
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int as n FROM outreach_messages om
       JOIN prospects p ON p.id = om.prospect_id
       WHERE p.owner_user_id = $1 AND om.status = 'sent' AND om.sent_at >= date_trunc('day', now())`,
      [msg.owner_user_id]
    );
    if ((countRows[0]?.n || 0) >= DAILY_SEND_LIMIT_PER_USER) {
      return { error: `Daily send limit (${DAILY_SEND_LIMIT_PER_USER}) reached for this user. Resume tomorrow or raise OUTREACH_DAILY_LIMIT.` };
    }
  }

  // Per-domain throttle — space out sends to the same recipient domain
  if (domain) {
    const { rows: recent } = await pool.query(
      `SELECT om.sent_at FROM outreach_messages om
       WHERE om.status = 'sent' AND om.to_email LIKE '%@' || $1
         AND om.sent_at >= now() - interval '${MIN_MINUTES_BETWEEN_SAME_DOMAIN} minutes'
       ORDER BY om.sent_at DESC LIMIT 1`,
      [domain]
    );
    if (recent.length > 0) {
      return { error: `Throttled: another message to ${domain} was sent within the last ${MIN_MINUTES_BETWEEN_SAME_DOMAIN} minutes. Try again shortly.` };
    }
  }

  const bodyWithFooter = msg.body + buildUnsubscribeFooter(msg.prospect_id);

  try {
    await sendEmail({ to: msg.to_email, subject: msg.subject || 'Hello', body: bodyWithFooter });
    await pool.query(
      `UPDATE outreach_messages SET status = 'sent', sent_at = now() WHERE id = $1`,
      [input.message_id]
    );
    await pool.query(
      `UPDATE prospects SET last_contacted_at = now() WHERE id = $1`,
      [msg.prospect_id]
    );
    await advanceStage(msg.prospect_id, msg.prospect_stage, 'P5_SENT', 'Outreach sent');
    return { sent: true, message_id: input.message_id };
  } catch (err) {
    await pool.query(`UPDATE outreach_messages SET status = 'failed' WHERE id = $1`, [input.message_id]);
    return { error: err instanceof Error ? err.message : 'Send failed' };
  }
}

// ─── convert_prospect_to_deal ──────────────────────────────────

export async function exec_convert_prospect_to_deal(
  input: { prospect_id: string; deal_name?: string; initial_value?: number; currency?: string },
  context?: { userId?: string }
): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT p.*, a.name as company_name, a.industry, a.company_size,
            c.full_name, c.email, c.title, c.phone
     FROM prospects p
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN contacts c ON c.id = p.contact_id
     WHERE p.id = $1`,
    [input.prospect_id]
  );
  const prospect = rows[0];
  if (!prospect) return { error: 'Prospect not found' };
  if (prospect.converted_deal_id) {
    return { error: 'Prospect already converted', deal_id: prospect.converted_deal_id };
  }

  const dealName = input.deal_name || `${prospect.company_name} — ${prospect.full_name || 'Outreach'}`;
  const companyName = prospect.company_name || 'Unknown';
  const ownerId = context?.userId || prospect.owner_user_id || null;

  // Carry research/outreach context into deal notes
  const { rows: briefRows } = await pool.query(
    `SELECT summary, pain_hypotheses, outreach_angle, talking_points FROM research_briefs WHERE prospect_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [input.prospect_id]
  );
  const { rows: msgRows } = await pool.query(
    `SELECT direction, subject, body, sent_at FROM outreach_messages WHERE prospect_id = $1 ORDER BY created_at ASC`,
    [input.prospect_id]
  );

  const brief = briefRows[0];
  const notesParts: string[] = [];
  notesParts.push(`Converted from prospect ${input.prospect_id}`);
  if (brief) {
    notesParts.push('--- Research Brief ---');
    if (brief.summary) notesParts.push(`Summary: ${brief.summary}`);
    if (brief.pain_hypotheses) notesParts.push(`Pains: ${brief.pain_hypotheses}`);
    if (brief.outreach_angle) notesParts.push(`Angle: ${brief.outreach_angle}`);
    if (brief.talking_points) notesParts.push(`Talking points: ${brief.talking_points}`);
  }
  if (msgRows.length > 0) {
    notesParts.push('--- Outreach history ---');
    for (const m of msgRows) {
      notesParts.push(`[${m.direction}] ${m.subject || ''}\n${m.body?.slice(0, 200) || ''}`);
    }
  }
  const notes = notesParts.join('\n\n');

  // Create the sales deal at G1
  const initialFields: Record<string, unknown> = {
    prospect_source: prospect.source_type,
    icp_score_at_conversion: prospect.icp_score,
  };
  if (prospect.industry) initialFields.industry = prospect.industry;
  if (prospect.company_size) initialFields.company_size = prospect.company_size;

  const { rows: dealRows } = await pool.query(
    `INSERT INTO deals (name, company, contact_name, contact_email, contact_phone, value, currency, fields, notes, user_id, lead_id, deal_type, gate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, 'sales', 1)
     RETURNING id`,
    [
      dealName,
      companyName,
      prospect.full_name || null,
      prospect.email || null,
      prospect.phone || null,
      input.initial_value || null,
      input.currency || 'USD',
      JSON.stringify(initialFields),
      notes,
      ownerId,
    ]
  );
  const dealId = dealRows[0].id;

  // Link back + advance prospect
  await pool.query(
    `UPDATE prospects SET converted_deal_id = $1, stage = 'P7_QUALIFIED' WHERE id = $2`,
    [dealId, input.prospect_id]
  );
  await recordProspectEvent(input.prospect_id, 'converted_to_deal', prospect.stage, 'P7_QUALIFIED', `Converted to deal ${dealId}`, 'agent', { deal_id: dealId });

  // Audit: gate_events entry on the new deal
  await pool.query(
    `INSERT INTO gate_events (deal_id, from_gate, to_gate, reason, triggered_by)
     VALUES ($1, 0, 1, $2, 'agent')`,
    [dealId, `Converted from prospect ${input.prospect_id}`]
  );

  return { converted: true, prospect_id: input.prospect_id, deal_id: dealId, stage: 'P7_QUALIFIED' };
}

// ─── research_company_from_url ──────────────────────────────────

/**
 * Fetch the homepage + (optionally) the /about page of a company website,
 * strip HTML to plain text, then ask Claude to produce a structured research
 * profile. Updates the account record and attaches a research brief.
 */
export async function exec_research_company_from_url(input: {
  account_id: string;
  website: string;
  prospect_id?: string;
}): Promise<Record<string, unknown>> {
  const normalized = input.website.startsWith('http') ? input.website : `https://${input.website}`;

  // Fetch homepage + try /about
  const pages: { url: string; content: string }[] = [];
  const urlsToTry = [normalized, normalized.replace(/\/$/, '') + '/about'];

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SalesBrain/1.0 (+https://salescrm.chipchip.social)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      // Strip HTML to plain text (basic, but adequate for research)
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8000);
      pages.push({ url, content: text });
    } catch {
      // Skip this page on any error (timeout, CORS, 404, etc.)
    }
  }

  if (pages.length === 0) {
    return { error: `Could not fetch content from ${normalized}. Site may block bots or be down.` };
  }

  // Load account for context
  const { rows: acctRows } = await pool.query(`SELECT * FROM accounts WHERE id = $1`, [input.account_id]);
  const account = acctRows[0];
  if (!account) return { error: 'Account not found' };

  const prompt = `You are a sales research assistant. Based on this company's public website content, produce a structured research profile. Be specific. Don't invent facts — if something is not evident, say "unknown" or skip.

Company: ${account.name}
Website: ${normalized}

Website content (stripped of HTML):
${pages.map((p) => `--- ${p.url} ---\n${p.content}`).join('\n\n')}

Return ONLY JSON (no preamble):
{
  "summary": "2-4 sentence description of what they do",
  "industry": "string or null",
  "subindustry": "string or null",
  "company_size": "1-10 | 11-50 | 51-200 | 201-1000 | 1000+ | unknown",
  "hq_location": "string or null",
  "products_or_services": ["..."],
  "pain_hypotheses": "likely operational pains relevant to the user's offering",
  "why_now_signals": "any recent triggers visible on the site (new hires, launches, press)",
  "outreach_angle": "recommended hook for first-touch cold email",
  "talking_points": "2-4 bullet points",
  "buyer_hypothesis": "likely title + seniority of the right buyer",
  "risks": "objections or disqualifiers"
}`;

  // Research-brief generation actively benefits from web search: the model
  // can pull recent press, leadership announcements, or product news beyond
  // what we scraped from the company's own site. Anthropic runs the search
  // server-side and returns the final text directly in response.content.
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [...webSearchTools],
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('');

  let profile: Record<string, unknown> = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    profile = m ? JSON.parse(m[0]) : { raw: text };
  } catch {
    profile = { raw: text, parse_error: true };
  }

  // Update account fields that are safe to overwrite/fill
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const accountFields: Array<[string, string]> = [
    ['industry', 'industry'],
    ['subindustry', 'subindustry'],
    ['company_size', 'company_size'],
    ['hq_location', 'hq_location'],
  ];
  for (const [profKey, col] of accountFields) {
    const val = profile[profKey];
    if (val && typeof val === 'string' && val !== 'unknown' && !account[col]) {
      updates.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }
  if (!account.website) {
    updates.push(`website = $${idx++}`);
    values.push(normalized);
  }

  if (updates.length > 0) {
    values.push(input.account_id);
    await pool.query(`UPDATE accounts SET ${updates.join(', ')} WHERE id = $${idx}`, values);
  }

  // Attach research brief if prospect_id supplied
  let briefId: string | null = null;
  if (input.prospect_id) {
    const { rows: briefRows } = await pool.query(
      `INSERT INTO research_briefs (prospect_id, account_id, summary, pain_hypotheses, why_now_signals, outreach_angle, talking_points, risks, sources_json, created_by_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) RETURNING id`,
      [
        input.prospect_id,
        input.account_id,
        String(profile.summary || ''),
        String(profile.pain_hypotheses || ''),
        String(profile.why_now_signals || ''),
        String(profile.outreach_angle || ''),
        String(profile.talking_points || ''),
        String(profile.risks || ''),
        JSON.stringify({ urls: pages.map((p) => p.url), buyer_hypothesis: profile.buyer_hypothesis }),
      ]
    );
    briefId = briefRows[0].id;

    // Advance prospect to P3_RESEARCH_READY if it's earlier
    await pool.query(
      `UPDATE prospects
       SET research_summary = $1,
           stage = CASE WHEN stage IN ('P0_IMPORTED','P1_ENRICHED','P2_ICP_CHECKED') THEN 'P3_RESEARCH_READY' ELSE stage END
       WHERE id = $2`,
      [String(profile.summary || ''), input.prospect_id]
    );
    await recordProspectEvent(input.prospect_id, 'research_completed', null, null, 'Website research generated', 'agent', { url: normalized });
  }

  return {
    researched: true,
    account_id: input.account_id,
    website: normalized,
    pages_fetched: pages.length,
    profile,
    brief_id: briefId,
    account_updated_fields: updates.map((u) => u.split(' = ')[0]),
  };
}

