/**
 * Read a teammate's Google Calendar for meetings with leads (funnel Phase D gap: meetings were never recorded).
 *
 * Server only. Needs the `calendar.readonly` permission on the person's ONE Google connection (lib/google-oauth.ts);
 * a connection made before 2026-10-26 lacks it until the person reconnects on Profile → Google. Only events with at
 * least one other attendee are returned, with the attendees' emails — the kernel (commands/meetings.py) matches them
 * to leads. Nothing else of the calendar is stored.
 */
import pool from '@/lib/db';
import { getValidAccessToken, listGoogleAccounts } from '@/lib/google-oauth';

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees: string[];
  meet_link: string | null;
}

export async function hasCalendar(userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM oauth_tokens WHERE user_id = $1 AND provider = 'google' AND 'calendar.readonly' = ANY(scopes)`, [userId]);
  return rows.length > 0;
}

/** Meetings from every connected Google account with calendar access (core 102), one row per event id. */
export async function listMeetings(userId: string, daysBack = 14, daysAhead = 30): Promise<{ events?: CalendarEvent[]; error?: string; needs?: string }> {
  if (!(await hasCalendar(userId))) {
    return { error: 'Calendar access is not granted: reconnect Google on Profile → Google', needs: 'calendar' };
  }
  const accounts = (await listGoogleAccounts(userId)).filter((a) => a.scopes.includes('calendar.readonly')).map((a) => a.email);
  const seen = new Map<string, CalendarEvent>();
  let firstError: { error?: string; needs?: string } | null = null;
  for (const mailbox of accounts) {
    const one = await listAccountMeetings(userId, mailbox, daysBack, daysAhead);
    if (one.error) { firstError = firstError ?? one; continue; }
    for (const ev of one.events || []) if (!seen.has(ev.id)) seen.set(ev.id, ev);
  }
  if (!seen.size && firstError) return firstError;
  return { events: Array.from(seen.values()) };
}

async function listAccountMeetings(userId: string, mailbox: string, daysBack: number, daysAhead: number): Promise<{ events?: CalendarEvent[]; error?: string; needs?: string }> {
  const tok = await getValidAccessToken(userId, 'google', mailbox);
  if (!tok) return { error: 'Google is not connected (or needs reconnecting)', needs: 'google' };
  const me = (tok.email || '').toLowerCase();
  const now = Date.now();
  const params = new URLSearchParams({
    timeMin: new Date(now - daysBack * 86400000).toISOString(),
    timeMax: new Date(now + daysAhead * 86400000).toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
  });
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 4; page++) {
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${tok.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 403 && /accessNotConfigured|has not been used|is disabled/i.test(body)) {
        return { error: 'The Google Calendar API is not enabled in the Google Cloud project', needs: 'calendar_api' };
      }
      return { error: `Google Calendar: ${res.status} ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { items?: Record<string, unknown>[]; nextPageToken?: string };
    for (const ev of data.items ?? []) {
      if (ev.status === 'cancelled') continue;
      const attendees = ((ev.attendees as { email?: string; self?: boolean; resource?: boolean; responseStatus?: string }[]) ?? [])
        .filter((a) => a.email && !a.self && !a.resource && a.responseStatus !== 'declined')
        .map((a) => a.email!.toLowerCase())
        .filter((e) => e !== me);
      if (!attendees.length) continue;
      const s = ev.start as { dateTime?: string; date?: string } | undefined;
      const e = ev.end as { dateTime?: string; date?: string } | undefined;
      out.push({
        id: String(ev.id), summary: String(ev.summary ?? '(no title)').slice(0, 200),
        start: s?.dateTime ?? s?.date ?? '', end: e?.dateTime ?? e?.date ?? '',
        attendees, meet_link: (ev.hangoutLink as string) ?? null,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return { events: out };
}

export interface FreeWindow { day: string; from: string; to: string; label: string }

/**
 * Free time in the person's calendar for the next working days (Mateo, 2026-11-11: the drafter proposed "11:00"
 * without looking). Busy time from Google's freeBusy over every connected account with calendar access, in the
 * calendar's own time zone; working hours 09:00 to 18:00, Monday to Friday, from two hours from now; windows of at
 * least 30 minutes. Nothing is stored.
 */
export async function freeTimes(userId: string, days = 5): Promise<{ free?: FreeWindow[]; time_zone?: string; error?: string; needs?: string }> {
  if (!(await hasCalendar(userId))) return { error: 'Calendar access is not granted: reconnect Google on Profile → Google', needs: 'calendar' };
  const accounts = (await listGoogleAccounts(userId)).filter((a) => a.scopes.includes('calendar.readonly')).map((a) => a.email);
  const start = Date.now() + 2 * 3600_000;
  const end = start + Math.min(14, Math.max(1, days)) * 2 * 86400_000;   // calendar days enough to hold the working days
  const busy: [number, number][] = [];
  let tz: string | null = null;
  let got = false;
  for (const mailbox of accounts) {
    const tok = await getValidAccessToken(userId, 'google', mailbox);
    if (!tok) continue;
    const auth = { Authorization: `Bearer ${tok.accessToken}` };
    if (!tz) {
      const c = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', { headers: auth });
      if (c.ok) tz = ((await c.json()) as { timeZone?: string }).timeZone || null;
    }
    const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), items: [{ id: 'primary' }] }),
    });
    if (!r.ok) continue;
    got = true;
    const j = await r.json() as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };
    for (const cal of Object.values(j.calendars || {})) for (const b of cal.busy || []) busy.push([Date.parse(b.start), Date.parse(b.end)]);
  }
  if (!got) return { error: 'The calendar could not be read (reconnect Google on Profile → Google)', needs: 'google' };
  const zone = tz || 'Europe/Berlin';
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = (t: number) => Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value])) as Record<string, string>;
  const step = 30 * 60_000;
  const first = Math.ceil(start / step) * step;
  const windows: { day: string; label: string; from: string; to: string; endT: number }[] = [];
  const workDays = new Set<string>();
  for (let t = first; t < end; t += step) {
    const p = parts(t);
    if (p.weekday === 'Sat' || p.weekday === 'Sun') continue;
    const mins = Number(p.hour) * 60 + Number(p.minute);
    if (mins < 9 * 60 || mins + 30 > 18 * 60) continue;
    const day = `${p.year}-${p.month}-${p.day}`;
    if (!workDays.has(day)) { if (workDays.size >= days) break; workDays.add(day); }
    if (busy.some(([a, b]) => a < t + step && b > t)) continue;
    const hm = `${p.hour}:${p.minute}`;
    const endP = parts(t + step);
    const endHm = `${endP.hour}:${endP.minute}`;
    const last = windows[windows.length - 1];
    if (last && last.day === day && last.endT === t) { last.to = endHm; last.endT = t + step; continue; }
    windows.push({ day, label: `${p.weekday} ${p.day} ${p.month}`, from: hm, to: endHm, endT: t + step });
  }
  return {
    time_zone: zone,
    free: windows.map((w) => ({ day: w.day, from: w.from, to: w.to, label: `${w.label}, ${w.from} to ${w.to}` })),
  };
}
