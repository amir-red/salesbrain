/** SQL fragments shared by the /sales-leads list route and the Excel export (+ one cached schema check). */
import pool from '@/lib/db';
import { QUIET_WARN_DAYS, type LeadSort } from '@/lib/sales-leads';

export const SORTS: Record<LeadSort, string> = {
  // Order numbers are per list (each import brought its own), so within a priority the list comes before the order.
  // A person with no priority of their own sorts as their list's (092; `ip` = the prospect's list).
  priority: 'COALESCE(l.priority, ip.priority) NULLS LAST, l.source NULLS LAST, l.rank NULLS LAST, l.must_talk DESC, l.next_contact_at NULLS LAST, l.last_contact_at DESC NULLS LAST, l.created_at DESC',
  contact: 'COALESCE(l.last_contact_at, l.created_at) ASC, COALESCE(l.priority, ip.priority) NULLS LAST, l.rank NULLS LAST',
  newest: 'l.created_at DESC',
  // needs the `warmth` output column (the /sales-leads list selects it; the export falls back to priority)
  warmth: 'warmth DESC NULLS LAST, COALESCE(l.priority, ip.priority) NULLS LAST, l.rank NULLS LAST, l.created_at DESC',
};

/** Teammates for the back / front office pickers: real logins, no service stubs. */
export const TEAM_USERS_SQL = `SELECT id, name, email FROM users
  WHERE email NOT LIKE '%.service.salesbrain' AND email NOT LIKE '%@salesbrain.internal'
    AND email NOT LIKE '%@example.com' AND name NOT ILIKE 'HAW %'
  ORDER BY name`;

export const OPEN = "l.status NOT IN ('converted', 'archived')";
/** Leads where a person must act (the Lead Conductor's verdict, core 068). Mirrors commands/conductor.needs_you. */
export const NEEDS_YOU = `${OPEN} AND l.lifecycle_actor = 'you' AND COALESCE(l.lifecycle_stage, '') NOT IN ('paused', 'in_conversation', 'call_set')`;
// Mirrors the kernel's ONE due predicate (commands/sales_leads.py::due_sql — change both): ping-by date reached, or
// quiet for 14+ days but only for leads that are starred, high priority, or were contacted at least once.
export const DUE = `${OPEN} AND (l.next_contact_at <= current_date OR (l.next_contact_at IS NULL AND (l.must_talk OR l.priority <= 2 OR l.last_contact_at IS NOT NULL) AND COALESCE(l.last_contact_at, l.created_at) < now() - interval '${QUIET_WARN_DAYS} days'))`;


/**
 * A card whose person is still a PROSPECT in the stored funnel (person_funnel, core 086): nobody has contacted them
 * yet — an agent find, a hand-picked import, an exhibitor list. A lead starts only at contact (Amir 2026-10-26), so
 * /sales-leads hides these unless the viewer asks for them. A card the funnel has not evaluated yet shows.
 */
export const NOT_CONTACTED = `EXISTS (SELECT 1 FROM person_funnel pf WHERE pf.lead_id = l.id AND pf.stage LIKE 'prospect\\_%')`;

let storedAt = 0;
let stored = false;
/** Is the stored funnel there (core migration 086)? Checked at most once a minute per process. */
let warmAt = 0;
let warm = false;
/** Is person_warmth there (core migration 089)? Checked at most once a minute per process. */
export async function warmthStored(): Promise<boolean> {
  if (warm) return true;
  if (Date.now() - warmAt < 60_000) return warm;
  try {
    const { rows } = await pool.query("SELECT to_regclass('public.person_warmth') IS NOT NULL AS ok");
    warm = !!rows[0]?.ok;
  } catch { warm = false; }
  warmAt = Date.now();
  return warm;
}

export async function funnelStored(): Promise<boolean> {
  if (stored) return true;
  if (Date.now() - storedAt < 60_000) return stored;
  try {
    const { rows } = await pool.query("SELECT to_regclass('public.person_funnel') IS NOT NULL AS ok");
    stored = !!rows[0]?.ok;
  } catch { stored = false; }
  storedAt = Date.now();
  return stored;
}
