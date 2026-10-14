#!/usr/bin/env node
/**
 * One-off: Mateo's PEI Operating Partners Forum (Napa, June 2026) contacts →
 * /sales-leads, with his priorities, notes and correspondence as the track record.
 *
 *   node scripts/import-napa-leads.mjs <PEI_Napa_Contacts_and_Notes.json> [--apply] [--all]
 *        [--owner mateo@chipchip.social] [--front mateo@chipchip.social]
 *
 * Dry run by default (prints what it would do). Needs DATABASE_URL and core
 * migration 056 applied. Idempotent: a contact already imported (raw_payload
 * napa_id) is skipped.
 *
 * Default = the engaged subset: anyone with a priority, a star, notes, a message
 * either way, a LinkedIn connection or an email on file (~100). `--all` imports
 * every resolvable attendee (~440) as unranked 'new' leads — Mateo wanted them
 * kept ("the highest value contacts I have anywhere"), Amir decides whether they
 * belong on the working list or only in the JSON.
 */
import fs from 'node:fs';
import pg from 'pg';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
if (!file) { console.error('usage: import-napa-leads.mjs <json> [--apply] [--all] [--owner email] [--front email]'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }

const APPLY = flag('apply');
const ALL = flag('all');
const OWNER = opt('owner', 'mateo@chipchip.social');
const FRONT = opt('front', OWNER);
const MET_AT = 'PEI Napa 2026';
const SOURCE = 'event:pei-napa-2026';

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const attendees = data.attendees || [];

const SKIP_NOTE = /OCR artifact|not a resolvable|not a person|^self$|skip per rules/i;
function resolvable(a) {
  if (!a.name || a.name === 'Mateo Klemmayer') return false;
  if (SKIP_NOTE.test(a.notes || '') || SKIP_NOTE.test(a.crm?.notes || '')) return false;
  if (!a.title && !a.firm && !(a.crm?.notes || '').trim()) return false;   // "Five Arrows", "Sixth Street": firms, not people
  return true;
}
function engaged(c) {
  return Boolean(c.priority || c.must_talk || (c.notes || '').trim() || c.talked_to || c.messaged || c.last_message_text
    || c.last_inbound_text || c.linkedin_connected || c.email || c.follow_up);
}
const DATED = /^\[?(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?(?:[^\]:]*)\]?:?\s*(.+)$/;
function noteEvents(notes) {
  const out = [];
  for (const raw of (notes || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(DATED);
    if (m) out.push({ when: m[1], text: m[2].trim() });
    else if (out.length) out[out.length - 1].text += ' ' + line;
    else out.push({ when: null, text: line });
  }
  return out;
}
const chan = (c) => { const v = (c || '').toLowerCase(); return ['linkedin', 'email', 'phone', 'in_person', 'telegram', 'whatsapp'].includes(v) ? v : null; };
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
const li = (u) => (u && /linkedin\.com\/in\//.test(u) ? u.replace(/ \(.*$/, '').trim() : null);

function build(a) {
  const c = a.crm || {};
  const status = c.last_inbound_text ? 'replied' : (c.messaged || c.last_message_text || /message_sent|replied_by/.test(c.connection_status || '')) ? 'contacted' : 'new';
  const events = [];
  const push = (when, kind, text, channel, ref) => text && events.push({ when: when || null, kind, text: String(text).slice(0, 2000), channel: channel || null, ref: ref || null });
  if (c.talked_to) push('2026-06-24', 'met', `Mateo talked with ${a.name} at ${MET_AT}`, 'in_person');
  for (const n of noteEvents(c.notes)) {
    const isSent = /^Mateo sent|^Mateo (followed up|emailed|replied)/i.test(n.text) && !/DISCREPANCY|NOT visible|never sent/i.test(n.text);
    const isReply = /replied|answered/i.test(n.text) && /^\w[^.]{0,40}(replied|answered)/i.test(n.text) && !/^Mateo/i.test(n.text);
    push(n.when, isSent ? 'sent' : isReply ? 'reply' : 'note', n.text, isSent || isReply ? chan(c.last_message_channel) : null);
  }
  for (const t of c.thread_history || []) push(t.date, t.direction === 'outbound' ? 'sent' : 'reply', t.text, 'linkedin');
  if (c.last_message_text && !(c.thread_history || []).some((t) => t.text === c.last_message_text)) {
    push(day(c.last_message_date), 'sent', `sent via ${c.last_message_channel || 'unknown'} — ${c.last_message_text}`, chan(c.last_message_channel));
  }
  if (c.last_inbound_text) push(day(c.last_inbound_date), 'reply', c.last_inbound_text, chan(c.last_inbound_channel));
  push('2026-10-13', 'import', `Imported from Mateo's PEI Napa CRM (tier ${a.tier}${a.speaker ? ', speaker' : ''})`);

  const dossier = {
    tier: a.tier, speaker: Boolean(a.speaker), talking_points: a.talking_points || [], relevance: a.relevance || null,
    firm_summary: a.firm_summary || null, chronology: a.chronology || [], interesting: a.interesting || null,
    sources: a.sources || [], confidence: a.confidence || null,
  };
  const notes = [c.next_action && `Next: ${c.next_action}`, c.relationship_context].filter(Boolean).join('\n');
  const raw = {
    napa_id: a.id, created_by: 'import:napa', title: a.title, linkedin_url: li(a.linkedin),
    email_source: c.email_source, phone: c.phone, personal_email: c.personal_email, scheduler_email: c.scheduler_email,
    connection_status: c.connection_status, met_status: c.met_status, linkedin_connected: c.linkedin_connected,
    linkedin_connected_date: c.linkedin_connected_date, follow_up: c.follow_up,
  };
  return {
    full_name: a.name.replace(/\s*\(.*?(OCR|garble|a\.k\.a|full:).*\)\s*/gi, '').trim() || a.name,
    title: a.title || null, company: a.firm || 'Unknown', email: c.email || '', linkedin_url: li(a.linkedin),
    description: `${a.title ? a.title + ' at ' : ''}${a.firm || '?'}. ${MET_AT} contact${a.tier ? ` (fit: ${a.tier})` : ''}.`,
    status, priority: c.priority && c.priority >= 1 && c.priority <= 10 ? c.priority : null, must_talk: Boolean(c.must_talk),
    met_at: c.talked_to ? MET_AT : (a.id.startsWith('external-') ? null : `${MET_AT} (attendee)`),
    notes: notes || null, dossier, raw, events,
  };
}

const rows = attendees.filter(resolvable).filter((a) => ALL || engaged(a.crm || {})).map(build);
console.log(`${attendees.length} attendees → ${rows.length} to import (${ALL ? 'all' : 'engaged only'}); ` +
  `${rows.filter((r) => r.priority).length} ranked, ${rows.filter((r) => r.must_talk).length} starred, ` +
  `${rows.filter((r) => r.status === 'replied').length} replied, ${rows.filter((r) => r.status === 'contacted').length} contacted`);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const u = async (email) => (await client.query('SELECT id, name FROM users WHERE lower(email) = lower($1)', [email])).rows[0];
  const owner = await u(OWNER); const front = await u(FRONT);
  if (!owner) throw new Error(`owner ${OWNER} is not a user`);
  if (!front) throw new Error(`front ${FRONT} is not a user`);
  const { rows: done } = await client.query(`SELECT raw_payload->>'napa_id' AS id FROM sales_leads WHERE raw_payload->>'created_by' = 'import:napa'`);
  const seen = new Set(done.map((r) => r.id));
  let n = 0, skipped = 0;
  for (const r of rows) {
    if (seen.has(r.raw.napa_id)) { skipped++; continue; }
    if (!APPLY) { console.log(`  + ${r.full_name} · ${r.company} · ${r.status}${r.priority ? ` P${r.priority}` : ''}${r.must_talk ? ' ★' : ''} · ${r.events.length} events`); n++; continue; }
    await client.query('BEGIN');
    try {
      const { rows: ins } = await client.query(
        `INSERT INTO sales_leads (full_name, title, company, email, linkedin_url, description, source, status, priority, must_talk,
                                  responsible_user_id, front_user_id, met_at, notes, dossier, raw_payload, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,'2026-06-23') RETURNING id`,
        [r.full_name, r.title, r.company, r.email, r.linkedin_url, r.description, SOURCE, r.status, r.priority, r.must_talk,
         owner.id, front.id, r.met_at, r.notes, JSON.stringify(r.dossier), JSON.stringify(r.raw)]);
      const id = ins[0].id;
      for (const e of r.events) {
        await client.query(
          `INSERT INTO sales_lead_events (lead_id, occurred_at, kind, channel, actor_user_id, text, ref)
           VALUES ($1, COALESCE($2::date::timestamptz + interval '12 hours', now()), $3, $4, $5, $6, $7::jsonb)`,
          [id, e.when, e.kind, e.channel, e.kind === 'import' ? null : owner.id, e.text, e.ref ? JSON.stringify(e.ref) : null]);
      }
      await client.query(
        `UPDATE sales_leads SET last_contact_at = (SELECT max(occurred_at) FROM sales_lead_events
            WHERE lead_id = $1 AND kind IN ('met','sent','reply','call','meeting')) WHERE id = $1`, [id]);
      await client.query('COMMIT'); n++;
    } catch (err) { await client.query('ROLLBACK'); throw err; }
  }
  console.log(`${APPLY ? 'imported' : 'would import'} ${n}, skipped ${skipped} already present (owner ${owner.name}, front ${front.name})`);
} finally {
  client.release(); await pool.end();
}
