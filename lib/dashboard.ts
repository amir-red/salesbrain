/**
 * /dashboard (was /funnel; design 1 of canvas RVn4piTh8uZYW66fnzTuyG, 2026-10-28): the shape of GET /api/dashboard and
 * the period rules it uses. Client-safe (no server imports).
 *
 * Periods compare like with like: "this month so far" against the same number of days at the start of last month,
 * so a comparison on the 3rd is not against a whole month. UTC, like the kernel's kpis.period_bounds.
 */

export const DASH_PERIODS = { today: 'Today', week: 'Week', month: 'Month', quarter: 'Quarter' } as const;
export type DashPeriod = keyof typeof DASH_PERIODS;

/** Stages whose dated entries (funnel_events, core 086) the dashboard counts. */
export const DASH_STAGES = ['lead_contacted', 'lead_engaged', 'lead_meeting', 'opportunity', 'client'] as const;
export type DashStage = (typeof DASH_STAGES)[number];

export interface DashWeek { week: string; counts: Record<DashStage, number> }
export interface DashList { id: string; name: string; owner_name: string; found: number; contacted: number; answered: number; opportunity: number }
export interface DashReply { channel: 'linkedin' | 'email'; snippet: string | null; at: string; full_name: string | null; company: string | null; owner_name: string; lead_id: string | null }

export interface DashboardPayload {
  period: { key: DashPeriod; start: string; end: string; prev_start: string; prev_end: string };
  /** People who ENTERED each stage in the period and in the comparison window. */
  current: Record<DashStage, number>;
  previous: Record<DashStage, number>;
  /** The last 12 weeks (Monday starts, oldest first), people entering each stage per week. */
  weeks: DashWeek[];
  lists: DashList[];
  replies: DashReply[];
  /** False before migration 086 (person_funnel / funnel_events): the page then shows the funnel only. */
  history: boolean;
}

export function periodBounds(key: DashPeriod, now = new Date()) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let start: Date; let prevStart: Date;
  if (key === 'today') {
    start = day; prevStart = new Date(day.getTime() - 86400000);
  } else if (key === 'week') {
    start = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400000);
    prevStart = new Date(start.getTime() - 7 * 86400000);
  } else if (key === 'month') {
    start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    prevStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 1, 1));
  } else {
    const q = Math.floor(day.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(day.getUTCFullYear(), q, 1));
    prevStart = new Date(Date.UTC(day.getUTCFullYear(), q - 3, 1));
  }
  const elapsed = now.getTime() - start.getTime();
  // never let the comparison window run into the current period (a 31-day month after a 30-day one)
  const prevEnd = new Date(Math.min(prevStart.getTime() + elapsed, start.getTime()));
  return { start, end: now, prevStart, prevEnd };
}

/** "▲ 17", "▼ 3", "same" — the change against the comparison window. */
export function delta(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'same' } {
  if (cur === prev) return { text: 'same', dir: 'same' };
  return cur > prev ? { text: `▲ ${cur - prev}`, dir: 'up' } : { text: `▼ ${prev - cur}`, dir: 'down' };
}

export const COMPARE_LABEL: Record<DashPeriod, string> = {
  today: 'vs yesterday at this time', week: 'vs this point last week', month: 'vs this point last month', quarter: 'vs this point last quarter',
};
