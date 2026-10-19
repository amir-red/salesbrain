/** SQL fragments shared by the /sales-leads list route and the Excel export. Pure strings. */
import { QUIET_WARN_DAYS, type LeadSort } from '@/lib/sales-leads';

export const SORTS: Record<LeadSort, string> = {
  // Order numbers are per list (each import brought its own), so within a priority the list comes before the order.
  priority: 'l.priority NULLS LAST, l.source NULLS LAST, l.rank NULLS LAST, l.must_talk DESC, l.next_contact_at NULLS LAST, l.last_contact_at DESC NULLS LAST, l.created_at DESC',
  contact: 'COALESCE(l.last_contact_at, l.created_at) ASC, l.priority NULLS LAST, l.rank NULLS LAST',
  newest: 'l.created_at DESC',
};

export const OPEN = "l.status NOT IN ('converted', 'archived')";
/** Leads where a person must act (the Lead Conductor's verdict, core 068). Mirrors commands/conductor.needs_you. */
export const NEEDS_YOU = `${OPEN} AND l.lifecycle_actor = 'you' AND COALESCE(l.lifecycle_stage, '') NOT IN ('paused', 'in_conversation', 'call_set')`;
// Mirrors the kernel's ONE due predicate (commands/sales_leads.py::due_sql — change both): ping-by date reached, or
// quiet for 14+ days but only for leads that are starred, high priority, or were contacted at least once.
export const DUE = `${OPEN} AND (l.next_contact_at <= current_date OR (l.next_contact_at IS NULL AND (l.must_talk OR l.priority <= 2 OR l.last_contact_at IS NOT NULL) AND COALESCE(l.last_contact_at, l.created_at) < now() - interval '${QUIET_WARN_DAYS} days'))`;

