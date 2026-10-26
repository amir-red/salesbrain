/**
 * Read a teammate's Google Calendar for meetings with leads (funnel Phase D gap: meetings were never recorded).
 *
 * Server only. Needs the `calendar.readonly` permission on the person's ONE Google connection (lib/google-oauth.ts);
 * a connection made before 2026-10-26 lacks it until the person reconnects on Profile → Google. Only events with at
 * least one other attendee are returned, with the attendees' emails — the kernel (commands/meetings.py) matches them
 * to leads. Nothing else of the calendar is stored.
 */
import pool from '@/lib/db';
import { getValidAccessToken } from '@/lib/google-oauth';

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

export async function listMeetings(userId: string, daysBack = 14, daysAhead = 30): Promise<{ events?: CalendarEvent[]; error?: string; needs?: string }> {
  if (!(await hasCalendar(userId))) {
    return { error: 'Calendar access is not granted: reconnect Google on Profile → Google', needs: 'calendar' };
  }
  const tok = await getValidAccessToken(userId);
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
