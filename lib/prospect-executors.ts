import Anthropic from '@anthropic-ai/sdk';
import pool from './db';
import { sendEmail } from './email';
import { normalizeDomain, normalizeCompanyName, fitLabelFromScore, type ProspectStage } from './prospecting';
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

async function getProspectRow(prospectId: string) {
  const { rows } = await pool.query(`SELECT * FROM prospects WHERE id = $1`, [prospectId]);
  return rows[0] || null;
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

  const { rows: pRows } = await pool.query(
    `INSERT INTO prospects (account_id, contact_id, campaign_id, stage, source_type, source_detail)
     VALUES ($1, $2, $3, 'P0_IMPORTED', $4, $5) RETURNING *`,
    [account.id, contact.id, input.campaign_id || null, input.source_type || 'manual', input.source_detail || null]
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

// ─── enrich_prospect ────────────────────────────────────────────

export async function exec_enrich_prospect(input: {
  prospect_id: string;
  account_updates?: Record<string, unknown>;
  contact_updates?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const prospect = await getProspectRow(input.prospect_id);
  if (!prospect) return { error: 'Prospect not found' };

  const ACCOUNT_COLS = new Set(['industry', 'subindustry', 'company_size', 'hq_location', 'geography', 'linkedin_url', 'website', 'fit_status', 'notes']);
  const CONTACT_COLS = new Set(['title', 'department', 'seniority', 'linkedin_url', 'phone', 'persona_type', 'notes', 'email']);

  if (input.account_updates && prospect.account_id) {
    const entries = Object.entries(input.account_updates).filter(([k]) => ACCOUNT_COLS.has(k));
    if (entries.length > 0) {
      const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      const values = entries.map(([, v]) => v);
      await pool.query(`UPDATE accounts SET ${sets} WHERE id = $1`, [prospect.account_id, ...values]);
    }
  }

  if (input.contact_updates && prospect.contact_id) {
    const entries = Object.entries(input.contact_updates).filter(([k]) => CONTACT_COLS.has(k));
    if (entries.length > 0) {
      const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      const values = entries.map(([, v]) => v);
      await pool.query(`UPDATE contacts SET ${sets} WHERE id = $1`, [prospect.contact_id, ...values]);
    }
  }

  await advanceStage(prospect.id, prospect.stage, 'P1_ENRICHED', 'Enrichment data captured');

  return { enriched: true, prospect_id: prospect.id, stage: 'P1_ENRICHED' };
}

// ─── score_prospect_fit ─────────────────────────────────────────

export async function exec_score_prospect_fit(input: {
  prospect_id: string;
  score: number;
  verdict: string;
  reason_codes?: string[];
  disqualifiers?: string[];
  qualification_reason: string;
  criteria?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const prospect = await getProspectRow(input.prospect_id);
  if (!prospect) return { error: 'Prospect not found' };

  await pool.query(
    `INSERT INTO qualification_scores (prospect_id, total_score, verdict, criteria_json, reason_codes, disqualifiers)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.prospect_id,
      input.score,
      input.verdict,
      input.criteria ? JSON.stringify(input.criteria) : null,
      input.reason_codes || [],
      input.disqualifiers || [],
    ]
  );

  await pool.query(
    `UPDATE prospects SET icp_score = $1, fit_label = $2, qualification_reason = $3 WHERE id = $4`,
    [input.score, fitLabelFromScore(input.score), input.qualification_reason, input.prospect_id]
  );

  await advanceStage(prospect.id, prospect.stage, 'P2_ICP_CHECKED', `Scored ${input.score}/100 (${input.verdict})`);

  return {
    scored: true,
    prospect_id: input.prospect_id,
    score: input.score,
    verdict: input.verdict,
    stage: 'P2_ICP_CHECKED',
  };
}

// ─── generate_research_brief ────────────────────────────────────

export async function exec_generate_research_brief(input: {
  prospect_id: string;
  summary: string;
  pain_hypotheses?: string;
  why_now_signals?: string;
  outreach_angle: string;
  talking_points?: string;
  risks?: string;
}): Promise<Record<string, unknown>> {
  const prospect = await getProspectRow(input.prospect_id);
  if (!prospect) return { error: 'Prospect not found' };

  const { rows } = await pool.query(
    `INSERT INTO research_briefs (prospect_id, account_id, contact_id, summary, pain_hypotheses, why_now_signals, outreach_angle, talking_points, risks, created_by_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) RETURNING id`,
    [
      input.prospect_id,
      prospect.account_id,
      prospect.contact_id,
      input.summary,
      input.pain_hypotheses || null,
      input.why_now_signals || null,
      input.outreach_angle,
      input.talking_points || null,
      input.risks || null,
    ]
  );

  await pool.query(`UPDATE prospects SET research_summary = $1 WHERE id = $2`, [input.summary, input.prospect_id]);
  await advanceStage(prospect.id, prospect.stage, 'P3_RESEARCH_READY', 'Research brief generated');

  return { brief_id: rows[0].id, prospect_id: input.prospect_id, stage: 'P3_RESEARCH_READY' };
}

// ─── draft_outreach_message ─────────────────────────────────────

export async function exec_draft_outreach_message(input: {
  prospect_id: string;
  step_type: string;
  subject: string;
  body: string;
  sequence_step_id?: string;
}): Promise<Record<string, unknown>> {
  const prospect = await getProspectRow(input.prospect_id);
  if (!prospect) return { error: 'Prospect not found' };

  // Get to_email from contact
  const { rows: contactRows } = await pool.query(`SELECT email FROM contacts WHERE id = $1`, [prospect.contact_id]);
  const toEmail = contactRows[0]?.email || null;

  const { rows } = await pool.query(
    `INSERT INTO outreach_messages (prospect_id, campaign_id, sequence_step_id, direction, status, subject, body, to_email, ai_generated)
     VALUES ($1, $2, $3, 'outbound', 'draft', $4, $5, $6, true) RETURNING id`,
    [input.prospect_id, prospect.campaign_id, input.sequence_step_id || null, input.subject, input.body, toEmail]
  );

  await advanceStage(prospect.id, prospect.stage, 'P4_OUTREACH_DRAFTED', `${input.step_type} drafted`);

  return {
    message_id: rows[0].id,
    status: 'draft',
    step_type: input.step_type,
    prospect_id: input.prospect_id,
    stage: 'P4_OUTREACH_DRAFTED',
  };
}

// ─── approve_outreach_message ───────────────────────────────────

export async function exec_approve_outreach_message(input: { message_id: string }): Promise<Record<string, unknown>> {
  const { rowCount } = await pool.query(
    `UPDATE outreach_messages SET status = 'approved' WHERE id = $1 AND status = 'draft'`,
    [input.message_id]
  );
  if (!rowCount) return { error: 'Message not found or not in draft state' };
  return { approved: true, message_id: input.message_id };
}

// ─── schedule_outreach_step ─────────────────────────────────────

export async function exec_schedule_outreach_step(input: { message_id: string; send_in_hours: number }): Promise<Record<string, unknown>> {
  const scheduledFor = new Date(Date.now() + input.send_in_hours * 3600 * 1000).toISOString();
  const { rowCount } = await pool.query(
    `UPDATE outreach_messages SET status = 'scheduled', scheduled_for = $1 WHERE id = $2 AND status IN ('draft', 'approved')`,
    [scheduledFor, input.message_id]
  );
  if (!rowCount) return { error: 'Message not found or in invalid state' };
  return { scheduled: true, message_id: input.message_id, scheduled_for: scheduledFor };
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

// ─── classify_outreach_reply ────────────────────────────────────

export async function exec_classify_outreach_reply(input: {
  prospect_id: string;
  reply_body: string;
  classification: string;
  objection_summary?: string;
  next_action_recommendation?: string;
  should_convert_to_deal?: boolean;
}): Promise<Record<string, unknown>> {
  const prospect = await getProspectRow(input.prospect_id);
  if (!prospect) return { error: 'Prospect not found' };

  // Record inbound message
  await pool.query(
    `INSERT INTO outreach_messages (prospect_id, direction, status, body, to_email, ai_generated)
     VALUES ($1, 'inbound', 'replied', $2, NULL, false)`,
    [input.prospect_id, input.reply_body]
  );

  // If unsubscribe, add to suppression and archive
  if (input.classification === 'unsubscribe') {
    const { rows: contactRows } = await pool.query(`SELECT email FROM contacts WHERE id = $1`, [prospect.contact_id]);
    if (contactRows[0]?.email) {
      await pool.query(
        `INSERT INTO suppression_list (email, reason, source, contact_id) VALUES ($1, 'unsubscribe', 'reply', $2)`,
        [contactRows[0].email, prospect.contact_id]
      );
    }
  }

  await pool.query(
    `UPDATE prospects SET last_replied_at = now(), reply_status = $1 WHERE id = $2`,
    [input.classification, input.prospect_id]
  );

  await advanceStage(prospect.id, prospect.stage, 'P6_REPLIED', `Reply classified: ${input.classification}`);

  await recordProspectEvent(input.prospect_id, 'reply_classified', null, null, input.classification, 'agent', {
    classification: input.classification,
    objection_summary: input.objection_summary,
    next_action_recommendation: input.next_action_recommendation,
  });

  return {
    classified: true,
    prospect_id: input.prospect_id,
    classification: input.classification,
    should_convert_to_deal: input.should_convert_to_deal || false,
    stage: 'P6_REPLIED',
  };
}

// ─── recommend_prospect_next_step ──────────────────────────────

export async function exec_recommend_prospect_next_step(input: {
  prospect_id: string;
  recommendation: string;
  next_action_at?: string;
}): Promise<Record<string, unknown>> {
  if (input.next_action_at) {
    await pool.query(`UPDATE prospects SET next_action_at = $1 WHERE id = $2`, [input.next_action_at, input.prospect_id]);
  }
  await recordProspectEvent(input.prospect_id, 'recommendation', null, null, input.recommendation, 'agent', {
    next_action_at: input.next_action_at,
  });
  return { recommended: true, prospect_id: input.prospect_id };
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
    `INSERT INTO deals (name, company, contact_name, contact_email, contact_phone, value, currency, fields, notes, user_id, deal_type, gate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'sales', 1)
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

// ─── archive_prospect ──────────────────────────────────────────

export async function exec_archive_prospect(input: {
  prospect_id: string;
  reason: string;
  disqualified?: boolean;
}): Promise<Record<string, unknown>> {
  const prospect = await getProspectRow(input.prospect_id);
  if (!prospect) return { error: 'Prospect not found' };

  const newStage: ProspectStage = input.disqualified ? 'P8_DISQUALIFIED' : 'P9_ARCHIVED';
  await pool.query(
    `UPDATE prospects SET stage = $1, archived_reason = $2 WHERE id = $3`,
    [newStage, input.reason, input.prospect_id]
  );
  await recordProspectEvent(input.prospect_id, 'archived', prospect.stage, newStage, input.reason, 'agent');
  return { archived: true, prospect_id: input.prospect_id, stage: newStage };
}

// ─── analyze_communication_style ────────────────────────────────

export async function exec_analyze_communication_style(
  input: { contact_id: string },
  context?: { userId?: string }
): Promise<Record<string, unknown>> {
  const { rows: contactRows } = await pool.query(
    `SELECT c.*, a.name as company_name FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
    [input.contact_id]
  );
  if (contactRows.length === 0) return { error: 'Contact not found' };
  const contact = contactRows[0];

  // Only analyze messages belonging to the calling user. Each user trains their own profile.
  const userFilter = context?.userId ? 'AND user_id = $2' : '';
  const values = context?.userId ? [input.contact_id, context.userId] : [input.contact_id];

  const { rows: msgs } = await pool.query(
    `SELECT source, direction, sent_at, subject, LEFT(body, 2000) as body
     FROM imported_messages WHERE contact_id = $1 ${userFilter}
     ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 30`,
    values
  );
  if (msgs.length === 0) return { error: 'No imported messages for this contact. Import Gmail, WhatsApp, or paste messages first.' };

  const prompt = `Analyze the communication style between the user and ${contact.full_name}${contact.title ? ' (' + contact.title + ')' : ''}${contact.company_name ? ' at ' + contact.company_name : ''}.

"sent" = written by the user. "received" = written by the contact.

Return ONLY this JSON (no preamble):
{
  "relationship_type": "peer | subordinate | senior | client | vendor | friend | unknown",
  "formality": "formal | semi_formal | casual",
  "typical_length": "short | medium | long",
  "tone_patterns": ["direct","warm","consultative","transactional","..."],
  "greeting_style": "how the user opens with this person",
  "sign_off": "how the user signs off",
  "common_topics": ["..."],
  "quirks": ["..."],
  "language": "en | es | fr | ...",
  "sample_openers": ["...","..."],
  "summary": "2-3 sentence description of communication style"
}

Be specific and grounded in the actual messages. Don't invent patterns.

Messages:
${msgs.map((m, i) => `--- ${i + 1} (${m.direction}${m.sent_at ? ', ' + new Date(m.sent_at).toISOString().slice(0, 10) : ''}) ---\n${m.subject ? 'Subject: ' + m.subject + '\n' : ''}${m.body}`).join('\n\n')}`;

  // Communication-style analysis is purely about the messages we already
  // have — but we pass web_search anyway for consistency with the rest of
  // the LLM call sites. Anthropic executes server tools inline, so the
  // final response.content still contains text we can extract; the model
  // almost certainly won't call web_search for this prompt.
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [...webSearchTools],
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('');

  let profile: Record<string, unknown>;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    profile = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
  } catch {
    profile = { raw: text, parse_error: true };
  }
  profile.generated_at = new Date().toISOString();
  profile.message_sample_size = msgs.length;

  await pool.query(
    `UPDATE contacts SET communication_profile = $1 WHERE id = $2`,
    [JSON.stringify(profile), input.contact_id]
  );

  return { analyzed: true, contact_id: input.contact_id, profile, messages_analyzed: msgs.length };
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

// ─── Dispatcher ────────────────────────────────────────────────

export async function executeProspectTool(name: string, input: Record<string, unknown>, context?: { userId?: string }): Promise<Record<string, unknown>> {
  switch (name) {
    case 'create_or_import_prospect':
      return exec_create_or_import_prospect(input as Parameters<typeof exec_create_or_import_prospect>[0], context);
    case 'enrich_prospect':
      return exec_enrich_prospect(input as Parameters<typeof exec_enrich_prospect>[0]);
    case 'score_prospect_fit':
      return exec_score_prospect_fit(input as Parameters<typeof exec_score_prospect_fit>[0]);
    case 'generate_research_brief':
      return exec_generate_research_brief(input as Parameters<typeof exec_generate_research_brief>[0]);
    case 'draft_outreach_message':
      return exec_draft_outreach_message(input as Parameters<typeof exec_draft_outreach_message>[0]);
    case 'approve_outreach_message':
      return exec_approve_outreach_message(input as Parameters<typeof exec_approve_outreach_message>[0]);
    case 'schedule_outreach_step':
      return exec_schedule_outreach_step(input as Parameters<typeof exec_schedule_outreach_step>[0]);
    case 'send_outreach_message':
      return exec_send_outreach_message(input as Parameters<typeof exec_send_outreach_message>[0]);
    case 'classify_outreach_reply':
      return exec_classify_outreach_reply(input as Parameters<typeof exec_classify_outreach_reply>[0]);
    case 'recommend_prospect_next_step':
      return exec_recommend_prospect_next_step(input as Parameters<typeof exec_recommend_prospect_next_step>[0]);
    case 'convert_prospect_to_deal':
      return exec_convert_prospect_to_deal(input as Parameters<typeof exec_convert_prospect_to_deal>[0], context);
    case 'archive_prospect':
      return exec_archive_prospect(input as Parameters<typeof exec_archive_prospect>[0]);
    case 'analyze_communication_style':
      return exec_analyze_communication_style(input as Parameters<typeof exec_analyze_communication_style>[0], context);
    case 'research_company_from_url':
      return exec_research_company_from_url(input as Parameters<typeof exec_research_company_from_url>[0]);
    default:
      return { error: `Unknown prospect tool: ${name}` };
  }
}

export const PROSPECT_TOOL_NAMES = new Set([
  'create_or_import_prospect',
  'enrich_prospect',
  'score_prospect_fit',
  'generate_research_brief',
  'draft_outreach_message',
  'approve_outreach_message',
  'schedule_outreach_step',
  'send_outreach_message',
  'classify_outreach_reply',
  'recommend_prospect_next_step',
  'convert_prospect_to_deal',
  'archive_prospect',
  'analyze_communication_style',
  'research_company_from_url',
]);
