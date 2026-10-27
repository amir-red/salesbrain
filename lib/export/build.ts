import * as XLSX from 'xlsx';
import pool from '@/lib/db';
import { JOURNEY_STAGES, LIFECYCLE_LABELS, type LeadSort, type LeadView, type LifecycleStage } from '@/lib/sales-leads';
import { DUE, NEEDS_YOU, OPEN, SORTS } from '@/lib/sales-leads-sql';
import { visibleIcp } from '@/lib/icp-server';
import type { ExportKind, ExportRequest } from '@/lib/export/sign';
import { kernelCall } from '@/lib/mcp/kernel-rpc';
import type { WarmPeople, WarmPerson } from '@/lib/warm';
import { FUNNEL_LABELS, type FunnelStage } from '@/lib/funnel';

/**
 * Excel exports — the data behind /sales-leads, the prospect lists and a full ICP. Server only (pg + SheetJS).
 *
 * One checked-out client, queries run in sequence: the Supabase pooler is session-mode with a small shared client
 * budget (CLAUDE_CONTEXT §5.ad), so no Promise.all fan-out.
 *
 * Visibility is the screen's own rule, enforced here and not trusted from the caller:
 *   sales leads  — org-wide inbox (everyone sees it, like the page);
 *   prospects    — the whole team's (like /api/prospects); mine=1 narrows to your own;
 *   ICP          — any teammate (every list is visible to everyone since 2026-10-26; visibleIcp);
 *   warm people  — team-wide, like the page (relationships the TEAM has, as on the shared /network map).
 */

export interface Who { userId: string; role: string }
export interface Built { filename: string; buffer: Buffer; rows: number; sheets: { name: string; rows: number }[] }

type Col<T> = { h: string; w: number; v: (r: T) => string | number | null | undefined };

const SHEET_ROW_CAP = 20000;

function ts(d: unknown): string {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(x.getTime()) ? '' : x.toISOString().slice(0, 16).replace('T', ' ');
}
function day(d: unknown): string { return ts(d).slice(0, 10); }
const yn = (b: unknown) => (b ? 'yes' : '');
const clean = (s: unknown) => (s == null ? '' : String(s).replace(/\u0000/g, ''));

function sheetOf<T>(cols: Col<T>[], rows: T[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [cols.map((c) => c.h)];
  for (const r of rows) aoa.push(cols.map((c) => { const v = c.v(r); return v == null ? '' : typeof v === 'number' ? v : clean(v).slice(0, 32000); }));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map((c) => ({ wch: c.w }));
  if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: cols.length - 1 } }) };
  return ws;
}

function pairsSheet(pairs: [string, string | number | null][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([['Field', 'Value'], ...pairs.map(([k, v]) => [k, v == null ? '' : clean(v)])]);
  ws['!cols'] = [{ wch: 28 }, { wch: 90 }];
  return ws;
}

function finish(prefix: string, sheets: { name: string; ws: XLSX.WorkSheet; rows: number }[], primary: number): Built {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.name);
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    filename: `${prefix}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    buffer,
    rows: sheets[primary]?.rows ?? 0,
    sheets: sheets.map((s) => ({ name: s.name, rows: s.rows })),
  };
}

// ─── Sales leads ───────────────────────────────────────────────────

const VIEWS = new Set<LeadView>(['working', 'due', 'must', 'needs_you', 'new', 'contacted', 'replied', 'converted', 'archived', 'all']);

interface LeadRow {
  id: string; full_name: string; title: string | null; company: string; email: string; linkedin_url: string | null;
  website: string | null; status: string; priority: number | null; rank: number | null; must_talk: boolean;
  journey_stage: number; intro_quality: number | null; journey_outcome: string | null; met_at: string | null;
  source: string; created_at: string; last_contact_at: string | null; next_contact: string | null; next_step: string | null; phone: string | null; notes: string | null;
  dossier: { talking_points?: string[]; relevance?: string; firm_summary?: string; sources?: string[] } | null;
  responsible_name: string | null; front_name: string | null; days_since: number | null; last_note: string | null;
  lifecycle_stage: LifecycleStage | null; lifecycle_actor: string | null; lifecycle_step: string | null; lifecycle_blocker: string | null;
  sender_name: string | null;
}

async function salesLeads(args: Record<string, string>, who: Who): Promise<Built> {
  const view = (args.view || 'working') as LeadView;
  if (!VIEWS.has(view)) throw new Error(`Invalid view: ${view}`);
  // the export does not select warmth: a 'warmest first' view exports in priority order
  const sort = (args.sort === 'warmth' ? 'priority' : args.sort || 'priority') as LeadSort;
  if (!SORTS[sort]) throw new Error(`Invalid sort: ${sort}`);
  const role = args.role === 'responsible' ? 'responsible' : args.role === 'front' ? 'front' : 'any';
  const where: string[] = [];
  const vals: unknown[] = [];
  if (view === 'working') where.push(OPEN);
  else if (view === 'due') where.push(DUE);
  else if (view === 'must') where.push(`${OPEN} AND l.must_talk`);
  else if (view === 'needs_you') where.push(NEEDS_YOU);
  else if (view === 'contacted') where.push("l.status IN ('contacted', 'replied')");
  else if (view !== 'all') { vals.push(view); where.push(`l.status = $${vals.length}`); }
  if (args.mine === '1') {
    vals.push(who.userId);
    const n = vals.length;
    where.push(role === 'responsible' ? `l.responsible_user_id = $${n}` : role === 'front' ? `l.front_user_id = $${n}`
      : `(l.responsible_user_id = $${n} OR l.front_user_id = $${n})`);
  }
  if (args.list) { vals.push(args.list); where.push(`l.source = $${vals.length}`); }
  const q = (args.q || '').trim();
  if (q) {
    vals.push(`%${q}%`);
    const n = vals.length;
    where.push(`(l.full_name ILIKE $${n} OR l.company ILIKE $${n} OR l.title ILIKE $${n} OR l.met_at ILIKE $${n})`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const client = await pool.connect();
  try {
    const { rows: leads } = await client.query<LeadRow>(
      `SELECT l.id, l.full_name, l.title, l.company, l.email, l.linkedin_url, l.website, l.status, l.priority, l.rank,
              l.must_talk, l.journey_stage, l.intro_quality, l.journey_outcome, l.met_at, l.source, l.created_at,
              l.last_contact_at, to_char(l.next_contact_at, 'YYYY-MM-DD') AS next_contact, l.next_step, l.phone, l.notes, l.dossier,
              r.name AS responsible_name, f.name AS front_name,
              l.lifecycle_stage, l.lifecycle_actor, l.lifecycle_step, l.lifecycle_blocker, ou.name AS sender_name,
              EXTRACT(day FROM now() - COALESCE(l.last_contact_at, l.created_at))::int AS days_since,
              (SELECT e.text FROM sales_lead_events e WHERE e.lead_id = l.id
                  AND e.kind NOT IN ('status', 'priority', 'assign', 'import')
                ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 1) AS last_note
         FROM sales_leads l
         LEFT JOIN users r ON r.id = l.responsible_user_id
         LEFT JOIN users f ON f.id = l.front_user_id
         LEFT JOIN prospects p ON p.id = l.prospect_id
         LEFT JOIN users ou ON ou.id = p.owner_user_id
         ${clause}
        ORDER BY ${SORTS[sort]} LIMIT ${SHEET_ROW_CAP}`, vals);

    const ids = leads.map((l) => l.id);
    const { rows: events } = ids.length ? await client.query<{
      lead_id: string; occurred_at: string; kind: string; channel: string | null; text: string; actor_name: string | null;
    }>(
      `SELECT e.lead_id, e.occurred_at, e.kind, e.channel, e.text, u.name AS actor_name
         FROM sales_lead_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.lead_id = ANY($1::uuid[]) ORDER BY e.lead_id, e.occurred_at DESC, e.created_at DESC`, [ids]) : { rows: [] };

    const byId = new Map(leads.map((l) => [l.id, l]));
    let n = 0;
    const leadCols: Col<LeadRow>[] = [
      { h: '#', w: 5, v: () => ++n },
      { h: 'Name', w: 26, v: (l) => l.full_name },
      { h: 'Title', w: 30, v: (l) => l.title },
      { h: 'Company', w: 30, v: (l) => (l.company === 'Unknown' ? '' : l.company) },
      { h: 'Email', w: 30, v: (l) => l.email },
      { h: 'Phone', w: 18, v: (l) => l.phone },
      { h: 'LinkedIn', w: 36, v: (l) => l.linkedin_url },
      { h: 'Website', w: 26, v: (l) => l.website },
      { h: 'Status', w: 11, v: (l) => l.status },
      { h: 'Priority', w: 9, v: (l) => l.priority },
      { h: 'Order', w: 7, v: (l) => l.rank },
      { h: 'Must talk', w: 9, v: (l) => yn(l.must_talk) },
      { h: 'Back office', w: 16, v: (l) => l.responsible_name },
      { h: 'Front office', w: 16, v: (l) => l.front_name },
      { h: 'Stage', w: 20, v: (l) => (l.lifecycle_stage ? LIFECYCLE_LABELS[l.lifecycle_stage] : '') },
      { h: 'Who acts', w: 11, v: (l) => ({ system: 'automatic', you: 'a person', them: 'the contact', none: '' } as Record<string, string>)[l.lifecycle_actor ?? ''] ?? '' },
      { h: 'What happens next', w: 46, v: (l) => l.lifecycle_step },
      { h: 'Blocked by', w: 24, v: (l) => l.lifecycle_blocker },
      { h: 'Sends from', w: 16, v: (l) => l.sender_name },
      { h: 'Journey', w: 26, v: (l) => (l.journey_stage ? JOURNEY_STAGES[l.journey_stage - 1]?.label : '') },
      { h: 'Intro quality (1-5)', w: 12, v: (l) => l.intro_quality },
      { h: 'Outcome', w: 11, v: (l) => l.journey_outcome },
      { h: 'Where met', w: 22, v: (l) => l.met_at },
      { h: 'Last contact', w: 16, v: (l) => ts(l.last_contact_at) },
      { h: 'Days since contact', w: 11, v: (l) => l.days_since },
      { h: 'Ping again on', w: 13, v: (l) => l.next_contact },
      { h: 'Next step', w: 34, v: (l) => l.next_step },
      { h: 'Source', w: 22, v: (l) => l.source },
      { h: 'Added', w: 12, v: (l) => day(l.created_at) },
      { h: 'Latest note', w: 60, v: (l) => l.last_note },
      { h: 'Your notes', w: 50, v: (l) => l.notes },
      { h: 'Talking points', w: 60, v: (l) => (l.dossier?.talking_points || []).join('\n') },
      { h: 'Why relevant', w: 50, v: (l) => l.dossier?.relevance },
      { h: 'Firm & fund', w: 50, v: (l) => l.dossier?.firm_summary },
    ];
    const evCols: Col<(typeof events)[number]>[] = [
      { h: 'Lead', w: 26, v: (e) => byId.get(e.lead_id)?.full_name },
      { h: 'Company', w: 28, v: (e) => byId.get(e.lead_id)?.company },
      { h: 'Date', w: 16, v: (e) => ts(e.occurred_at) },
      { h: 'Kind', w: 10, v: (e) => e.kind },
      { h: 'Channel', w: 11, v: (e) => e.channel },
      { h: 'By', w: 16, v: (e) => e.actor_name || 'system' },
      { h: 'Text', w: 110, v: (e) => e.text },
    ];
    return finish('salesbrain-sales-leads', [
      { name: 'Sales leads', ws: sheetOf(leadCols, leads), rows: leads.length },
      { name: 'Track record', ws: sheetOf(evCols, events), rows: events.length },
    ], 0);
  } finally { client.release(); }
}

// ─── Prospects (shared by the prospect list and a full ICP) ────────

interface ProspectRow {
  id: string; stage: string; full_name: string | null; title: string | null; company: string | null;
  email: string | null; phone: string | null; linkedin_url: string | null; linkedin_public_id: string | null;
  candidate_location: string | null; network_degree: string | null; icp_name: string | null; icp_score: number | null;
  fit_label: string | null; qualification_reason: string | null; priority_rank: number | null;
  invitation_status: string | null; messages_sent: number; last_contacted_at: string | null; touch_count: number | null;
  last_replied_at: string | null; reply_status: string | null; next_followup_at: string | null; source_type: string | null;
  source_detail: string | null; owner_name: string | null; website: string | null; industry: string | null;
  company_size: string | null; hq_location: string | null; created_at: string; research_summary: string | null;
}

const PROSPECT_SELECT = `
  SELECT p.id, p.stage, c.full_name, c.title, a.name AS company, c.email, c.phone, c.linkedin_url, p.linkedin_public_id,
         p.candidate_location, p.network_degree, ip.name AS icp_name, p.icp_score, p.fit_label, p.qualification_reason,
         p.priority_rank,
         (SELECT li.status FROM linkedin_invitations li WHERE li.prospect_id = p.id ORDER BY li.sent_at DESC NULLS LAST LIMIT 1) AS invitation_status,
         (SELECT count(*)::int FROM outreach_approvals o WHERE o.prospect_id = p.id AND o.sent_at IS NOT NULL) AS messages_sent,
         p.last_contacted_at, p.touch_count, p.last_replied_at, p.reply_status, p.next_followup_at, p.source_type,
         p.source_detail, u.name AS owner_name, a.website, a.industry, a.company_size, a.hq_location, p.created_at,
         p.research_summary
    FROM prospects p
    LEFT JOIN contacts c ON c.id = p.contact_id
    LEFT JOIN accounts a ON a.id = p.account_id
    LEFT JOIN users u ON u.id = p.owner_user_id
    LEFT JOIN icp_profiles ip ON ip.id = p.icp_profile_id`;

function researchText(raw: string | null): string {
  if (!raw) return '';
  try {
    const j = JSON.parse(raw) as { summary?: string; angle?: string; why_now?: string[] | string };
    return [j.summary, j.angle ? `Angle: ${j.angle}` : ''].filter(Boolean).join('\n');
  } catch { return raw.slice(0, 2000); }
}

function prospectCols(): Col<ProspectRow>[] {
  let n = 0;
  return [
    { h: '#', w: 5, v: () => ++n },
    { h: 'Order', w: 7, v: (p) => p.priority_rank },
    { h: 'Name', w: 26, v: (p) => p.full_name },
    { h: 'Title', w: 32, v: (p) => p.title },
    { h: 'Company', w: 30, v: (p) => p.company },
    { h: 'Email', w: 30, v: (p) => p.email },
    { h: 'Phone', w: 18, v: (p) => p.phone },
    { h: 'LinkedIn', w: 36, v: (p) => p.linkedin_url || (p.linkedin_public_id ? `https://www.linkedin.com/in/${p.linkedin_public_id}/` : '') },
    { h: 'Location', w: 22, v: (p) => p.candidate_location },
    { h: 'Degree', w: 7, v: (p) => p.network_degree },
    { h: 'Stage', w: 20, v: (p) => p.stage },
    { h: 'Fit score', w: 9, v: (p) => p.icp_score },
    { h: 'Fit', w: 14, v: (p) => p.fit_label },
    { h: 'Why', w: 50, v: (p) => p.qualification_reason },
    { h: 'ICP', w: 26, v: (p) => p.icp_name },
    { h: 'LinkedIn request', w: 14, v: (p) => p.invitation_status },
    { h: 'Messages sent', w: 9, v: (p) => p.messages_sent },
    { h: 'Last contacted', w: 16, v: (p) => ts(p.last_contacted_at) },
    { h: 'Replied', w: 16, v: (p) => ts(p.last_replied_at) },
    { h: 'Next follow-up', w: 14, v: (p) => day(p.next_followup_at) },
    { h: 'Owner', w: 16, v: (p) => p.owner_name },
    { h: 'Industry', w: 20, v: (p) => p.industry },
    { h: 'Company size', w: 14, v: (p) => p.company_size },
    { h: 'HQ', w: 20, v: (p) => p.hq_location },
    { h: 'Website', w: 26, v: (p) => p.website },
    { h: 'Source', w: 18, v: (p) => p.source_type },
    { h: 'Source detail', w: 40, v: (p) => p.source_detail },
    { h: 'Added', w: 12, v: (p) => day(p.created_at) },
    { h: 'Research', w: 70, v: (p) => researchText(p.research_summary) },
  ];
}

async function prospects(args: Record<string, string>, who: Who): Promise<Built> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (args.mine === '1' || args.mine === 'true') { vals.push(who.userId); where.push(`p.owner_user_id = $${vals.length}`); }
  if (args.stage) { vals.push(args.stage); where.push(`p.stage = $${vals.length}`); }
  if (args.reply_status) { vals.push(args.reply_status); where.push(`p.reply_status = $${vals.length}`); }
  if (args.icp_id) { vals.push(args.icp_id); where.push(`p.icp_profile_id = $${vals.length}`); }
  const q = (args.q || '').trim();
  if (q) { vals.push(`%${q}%`); const n = vals.length; where.push(`(c.full_name ILIKE $${n} OR a.name ILIKE $${n} OR c.title ILIKE $${n})`); }
  const client = await pool.connect();
  try {
    const { rows } = await client.query<ProspectRow>(
      `${PROSPECT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY p.priority_rank NULLS LAST, p.icp_score DESC NULLS LAST, p.created_at DESC LIMIT ${SHEET_ROW_CAP}`, vals);
    return finish('salesbrain-prospects', [{ name: 'Prospects', ws: sheetOf(prospectCols(), rows), rows: rows.length }], 0);
  } finally { client.release(); }
}

// ─── A full ICP ────────────────────────────────────────────────────

function flatten(v: unknown, prefix = ''): [string, string][] {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) {
    return v.every((x) => typeof x !== 'object' || x === null)
      ? [[prefix, v.map(String).join('; ')]] : v.flatMap((x, i) => flatten(x, `${prefix}[${i + 1}]`));
  }
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flatten(x, prefix ? `${prefix}.${k}` : k));
  return [[prefix, typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)]];
}

async function icp(args: Record<string, string>, who: Who): Promise<Built> {
  if (!args.icp_id) throw new Error('icp_id is required');
  const profile = await visibleIcp(args.icp_id, { userId: who.userId, role: who.role });
  if (!profile) throw new Error('ICP not found or not visible to you');
  const client = await pool.connect();
  try {
    const { rows: leads } = await client.query<ProspectRow>(
      `${PROSPECT_SELECT} WHERE p.icp_profile_id = $1
        ORDER BY p.priority_rank NULLS LAST, p.icp_score DESC NULLS LAST, p.created_at DESC LIMIT ${SHEET_ROW_CAP}`, [args.icp_id]);
    const { rows: funnel } = await client.query<{ stage: string; n: number; avg_score: number | null; with_email: number; with_profile: number }>(
      `SELECT p.stage, count(*)::int AS n, round(avg(p.icp_score))::int AS avg_score,
              count(c.email) FILTER (WHERE c.email <> '')::int AS with_email,
              count(p.linkedin_public_id)::int AS with_profile
         FROM prospects p LEFT JOIN contacts c ON c.id = p.contact_id
        WHERE p.icp_profile_id = $1 GROUP BY p.stage ORDER BY p.stage`, [args.icp_id]);
    const { rows: runs } = await client.query<{
      started_at: string; agent: string; trigger: string; status: string; analyzed: number | null; matched: number | null;
      created: number | null; researched: number | null; error: string | null;
    }>(
      `SELECT started_at, agent, trigger, status, analyzed, matched, created, researched, error
         FROM agent_runs WHERE icp_profile_id = $1 ORDER BY started_at DESC LIMIT 200`, [args.icp_id]);

    // Firms on the list (core 075) — one row each with the research summary; empty for a people-only list.
    const { rows: firms } = await client.query<Record<string, unknown>>(
      `SELECT f.rank, f.priority, a.name AS firm, a.domain, a.website, f.eligibility, f.eligibility_reasons, f.status,
              f.contact_email, f.contact_route, f.notes, f.researched_at, ap.profile, ap.confidence,
              (SELECT count(*)::int FROM prospects x WHERE x.icp_profile_id = f.icp_profile_id AND x.account_id = f.account_id) AS people
         FROM list_firms f JOIN accounts a ON a.id = f.account_id
         LEFT JOIN account_profiles ap ON ap.account_id = f.account_id AND ap.kind = 'investor'
        WHERE f.icp_profile_id = $1 ORDER BY f.priority NULLS LAST, f.rank NULLS LAST, a.name LIMIT ${SHEET_ROW_CAP}`, [args.icp_id]);
    const prof = (r: Record<string, unknown>) => (r.profile || {}) as Record<string, unknown>;
    const joinList = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'object' && x ? Object.values(x as object).filter(Boolean).join(' ') : String(x))).join('; ') : '');
    const firmCols: Col<Record<string, unknown>>[] = [
      { h: 'Rank', w: 6, v: (r) => r.rank as number }, { h: 'Priority', w: 8, v: (r) => r.priority as number },
      { h: 'Firm', w: 28, v: (r) => String(r.firm ?? '') }, { h: 'Website', w: 28, v: (r) => String(r.website ?? r.domain ?? '') },
      { h: 'Verdict', w: 10, v: (r) => String(r.eligibility ?? '') }, { h: 'Why', w: 60, v: (r) => joinList(r.eligibility_reasons) },
      { h: 'Status', w: 12, v: (r) => String(r.status ?? '') },
      { h: 'Invests in', w: 60, v: (r) => String(prof(r).thesis ?? '') }, { h: 'Stages', w: 20, v: (r) => joinList(prof(r).stages) },
      { h: 'Sectors', w: 30, v: (r) => joinList(prof(r).sectors) }, { h: 'Geographies', w: 20, v: (r) => joinList(prof(r).geographies) },
      { h: 'Cheque min', w: 12, v: (r) => prof(r).cheque_min as number }, { h: 'Cheque max', w: 12, v: (r) => prof(r).cheque_max as number },
      { h: 'Currency', w: 8, v: (r) => String(prof(r).currency ?? '') },
      { h: 'Latest fund', w: 30, v: (r) => joinList(prof(r).last_fund ? [prof(r).last_fund] : []) },
      { h: 'Investing now', w: 12, v: (r) => String(prof(r).actively_investing ?? '') },
      { h: 'Recent investments', w: 60, v: (r) => joinList(prof(r).recent_investments) },
      { h: 'Opening line', w: 60, v: (r) => String(prof(r).hook ?? '') },
      { h: 'Contact email', w: 28, v: (r) => String(r.contact_email ?? '') }, { h: 'Pitch form', w: 30, v: (r) => String(r.contact_route ?? '') },
      { h: 'Team on site', w: 60, v: (r) => joinList(((prof(r).team as { name?: string; title?: string }[]) || []).map((m) => `${m.name}${m.title ? ` (${m.title})` : ''}`)) },
      { h: 'People on list', w: 10, v: (r) => r.people as number }, { h: 'Confidence', w: 10, v: (r) => String(r.confidence ?? '') },
      { h: 'Researched', w: 16, v: (r) => ts(r.researched_at) }, { h: 'Notes', w: 40, v: (r) => String(r.notes ?? '') },
    ];

    const p = profile as Record<string, unknown>;
    const state = p.is_active === false ? 'stopped' : p.paused_at ? 'paused' : 'running';
    const overview: [string, string | number | null][] = [
      ['ICP', String(p.name ?? '')], ['Owner', String(p.owner_name ?? '')], ['State', state],
      ['Created', day(p.created_at)], ['Leads', leads.length],
      ['With email', leads.filter((l) => l.email).length], ['With LinkedIn profile', leads.filter((l) => l.linkedin_public_id).length],
      ['Contacted', leads.filter((l) => l.last_contacted_at).length], ['Replied', leads.filter((l) => l.last_replied_at).length],
      ['First message after accept', String(p.first_message_template ?? '')],
      ...flatten(p.criteria, 'criteria').map(([k, v]) => [k, v] as [string, string]),
    ];
    const funnelCols: Col<(typeof funnel)[number]>[] = [
      { h: 'Stage', w: 24, v: (f) => f.stage }, { h: 'Leads', w: 8, v: (f) => f.n },
      { h: 'Avg fit score', w: 12, v: (f) => f.avg_score }, { h: 'With email', w: 11, v: (f) => f.with_email },
      { h: 'With LinkedIn profile', w: 20, v: (f) => f.with_profile },
    ];
    const runCols: Col<(typeof runs)[number]>[] = [
      { h: 'When', w: 16, v: (r) => ts(r.started_at) }, { h: 'Agent', w: 14, v: (r) => r.agent }, { h: 'Trigger', w: 10, v: (r) => r.trigger },
      { h: 'Status', w: 10, v: (r) => r.status }, { h: 'Analysed', w: 9, v: (r) => r.analyzed }, { h: 'Matched', w: 9, v: (r) => r.matched },
      { h: 'Created', w: 9, v: (r) => r.created }, { h: 'Researched', w: 11, v: (r) => r.researched }, { h: 'Error', w: 60, v: (r) => r.error },
    ];
    const slug = String(p.name ?? 'icp').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'icp';
    return finish(`salesbrain-icp-${slug}`, [
      { name: 'ICP', ws: pairsSheet(overview), rows: overview.length },
      ...(firms.length ? [{ name: 'Firms', ws: sheetOf(firmCols, firms), rows: firms.length }] : []),
      { name: 'Leads', ws: sheetOf(prospectCols(), leads), rows: leads.length },
      { name: 'Funnel', ws: sheetOf(funnelCols, funnel), rows: funnel.length },
      { name: 'Activity', ws: sheetOf(runCols, runs), rows: runs.length },
    ], 1);
  } finally { client.release(); }
}

// ─── Warm people (funnel Phase C) ──────────────────────────────────

async function warm(args: Record<string, string>, who: Who): Promise<Built> {
  const band = ['hot', 'warm', 'cool'].includes(args.band) ? args.band : 'warm';
  const kargs: Record<string, unknown> = { band, include_worked: args.worked === '1' || args.worked === 'true', limit: 500 };
  if (args.owner) kargs.owner = args.owner;
  const out = await kernelCall('crm_warm_people', kargs, who.userId) as unknown as WarmPeople & { error?: string };
  if (out.error) throw new Error(out.error);
  const li = (h: string | null) => (!h ? '' : h.startsWith('http') ? h : `https://www.linkedin.com/in/${h}`);
  const peopleCols: Col<WarmPerson>[] = [
    { h: 'Name', w: 26, v: (r) => r.name }, { h: 'Company', w: 26, v: (r) => r.company },
    { h: 'Headline', w: 40, v: (r) => r.headline }, { h: 'Band', w: 7, v: (r) => r.band },
    { h: 'Warmth (0-100)', w: 9, v: (r) => Math.round(r.warmth * 100) },
    { h: 'Why', w: 60, v: (r) => r.reasons.join(' · ') }, { h: 'Warmest relationship', w: 20, v: (r) => r.via.name },
    { h: 'They last wrote', w: 16, v: (r) => ts(r.last_two_way_at) }, { h: 'Last contact', w: 16, v: (r) => ts(r.last_touch_at) },
    { h: 'LinkedIn', w: 40, v: (r) => li(r.linkedin) }, { h: 'Email', w: 28, v: (r) => r.email },
    { h: 'On list', w: 28, v: (r) => r.list ?? 'not on any list' }, { h: 'Fit', w: 6, v: (r) => r.fit },
    { h: 'Funnel stage', w: 14, v: (r) => (r.stage ? FUNNEL_LABELS[r.stage as FunnelStage] ?? r.stage : '') },
    { h: 'Resting', w: 8, v: (r) => yn(r.resting) }, { h: 'Has lead card', w: 9, v: (r) => yn(r.has_card) },
    { h: 'Being worked', w: 9, v: (r) => yn(r.being_worked) },
  ];
  const client = await pool.connect();
  try {
    // every teammate × person pair in the band (the page shows each person once, at their warmest relationship)
    const bands = band === 'hot' ? ['hot'] : band === 'warm' ? ['hot', 'warm'] : ['hot', 'warm', 'cool'];
    const { rows: pairs } = await client.query(
      `SELECT pe.full_name, pe.organization, u.name AS teammate, w.band, round(w.warmth * 100)::int AS warmth,
              w.reasons, w.their_messages, w.our_messages, w.last_two_way_at, w.last_touch_at
         FROM person_warmth w JOIN people pe ON pe.id = w.person_id JOIN users u ON u.id = w.user_id
        WHERE w.band = ANY($1) ORDER BY w.warmth DESC LIMIT ${SHEET_ROW_CAP}`, [bands]);
    type P = (typeof pairs)[number];
    const pairCols: Col<P>[] = [
      { h: 'Name', w: 26, v: (r) => r.full_name }, { h: 'Company', w: 26, v: (r) => r.organization },
      { h: 'Teammate', w: 20, v: (r) => r.teammate }, { h: 'Band', w: 7, v: (r) => r.band },
      { h: 'Warmth (0-100)', w: 9, v: (r) => r.warmth }, { h: 'Why', w: 60, v: (r) => (r.reasons || []).join(' · ') },
      { h: 'Their messages', w: 9, v: (r) => r.their_messages }, { h: 'Our messages', w: 9, v: (r) => r.our_messages },
      { h: 'They last wrote', w: 16, v: (r) => ts(r.last_two_way_at) }, { h: 'Last contact', w: 16, v: (r) => ts(r.last_touch_at) },
    ];
    const about: [string, string | number | null][] = [
      ['What this is', 'People we already talk to, warmest first (funnel Phase C). One row per person on “Warm people”; one row per teammate × person on “Relationships”.'],
      ['Warmth', '0-100 from real signals that fade with time: they wrote to us (LinkedIn, email, logged WhatsApp or calls), we met, a LinkedIn connection, a saved contact. Hot ≥ 70, warm ≥ 40, cool ≥ 15.'],
      ['Band shown', band === 'hot' ? 'hot only' : band === 'warm' ? 'hot and warm' : 'hot, warm and cool'],
      ['People', out.people.length], ['Of them being worked already', out.people.filter((p) => p.being_worked).length],
      ['Relationships (pairs)', pairs.length], ['Made', new Date().toISOString().slice(0, 16).replace('T', ' ')],
    ];
    return finish(`salesbrain-warm-people-${band}`, [
      { name: 'Warm people', ws: sheetOf(peopleCols, out.people), rows: out.people.length },
      { name: 'Relationships', ws: sheetOf(pairCols, pairs), rows: pairs.length },
      { name: 'About', ws: pairsSheet(about), rows: about.length },
    ], 0);
  } finally { client.release(); }
}

// ─── Entry point ───────────────────────────────────────────────────

export async function buildExport(req: ExportRequest, who: Who): Promise<Built> {
  const kind: ExportKind = req.kind;
  if (kind === 'sales-leads') return salesLeads(req.args, who);
  if (kind === 'prospects') return prospects(req.args, who);
  if (kind === 'icp') return icp(req.args, who);
  if (kind === 'warm') return warm(req.args, who);
  throw new Error(`Unknown export: ${kind}`);
}

/** The args each export understands, as the plain strings that travel in a query string / signed link. */
export function cleanArgs(kind: ExportKind, raw: Record<string, unknown>): Record<string, string> {
  const allowed: Record<ExportKind, string[]> = {
    'sales-leads': ['view', 'sort', 'q', 'mine', 'role', 'list'],
    prospects: ['stage', 'mine', 'icp_id', 'reply_status', 'q'],
    icp: ['icp_id'],
    warm: ['band', 'owner', 'worked'],
  };
  const out: Record<string, string> = {};
  for (const k of allowed[kind]) {
    const v = raw[k];
    if (v === undefined || v === null || v === '' || v === false) continue;
    out[k] = v === true ? '1' : String(v).slice(0, 200);
  }
  return out;
}
