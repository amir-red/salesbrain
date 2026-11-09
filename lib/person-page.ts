/**
 * The person page (redesign D, 2026-11-09): the short answers the Overview shows, derived from the lead brief
 * (lib/lead-brief.ts). Client-safe, pure. The full brief stays on its own tab; this file only decides what one glance
 * should say: where they are on the journey, one sentence on where we stand, and at most three talking points.
 */
import type { LeadBrief } from '@/lib/lead-brief';
import { agoLabel, dayLabel } from '@/lib/lead-brief';

export interface JourneyStep {
  key: 'met' | 'listed' | 'connected' | 'messaged' | 'reply' | 'meeting' | 'opportunity';
  label: string;
  done: boolean;
  /** a short date / place under the label, when known */
  note: string | null;
}

const CHAT_WORD: Record<string, string> = {
  linkedin: 'LinkedIn', email: 'email', whatsapp: 'WhatsApp', imessage: 'iMessage', telegram: 'Telegram', sms: 'SMS', meeting: 'in person',
};

export function firstName(name: string | null | undefined): string {
  return (name || 'They').trim().split(/\s+/)[0];
}

/** The first sentence of a paragraph (research text runs long; the page shows one). */
export function firstSentence(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
  return (m ? m[1] : t).trim();
}

/** Met (or "On a list") → Connected → First message → Reply → Meeting → Opportunity. */
export function journeySteps(b: LeadBrief, convertedDealId: string | null): JourneyStep[] {
  const meeting = b.stand.channels.find((c) => c.kind === 'meeting' || c.channel === 'meeting');
  const conn = b.who_in.connected.find((c) => c.status === 'connected');
  const pending = b.who_in.connected.find((c) => c.status === 'pending');
  const written = b.stand.channels.filter((c) => c.channel !== 'meeting');
  const replied = !!b.stand.last_reply_at || written.some((c) => c.last_from_them);
  const messaged = b.stand.sent_count > 0 || written.some((c) => !c.last_from_them) || replied;
  const booked = !!b.next_step.booked_at && b.next_step.booking_status !== 'cancelled';
  const steps: JourneyStep[] = [
    meeting
      ? { key: 'met', label: 'Met', done: true, note: [dayLabel(meeting.last_at), firstPlace(meeting.text)].filter(Boolean).join(' · ') || null }
      : { key: 'listed', label: 'On a list', done: true, note: b.list.name ? clip(b.list.name, 22) : null },
    { key: 'connected', label: 'Connected', done: !!conn || written.some((c) => c.channel === 'linkedin'),
      note: conn ? `${dayLabel(conn.since)} · LinkedIn` : pending ? 'request pending' : null },
    { key: 'messaged', label: 'First message', done: messaged,
      // several messages: say how many (the last send's date would read as the first one's)
      note: !messaged ? null : b.stand.sent_count > 1 ? `${b.stand.sent_count} sent` : b.stand.last_sent_at ? dayLabel(b.stand.last_sent_at) : null },
    { key: 'reply', label: 'Reply', done: replied, note: b.stand.last_reply_at ? dayLabel(b.stand.last_reply_at) : null },
    { key: 'meeting', label: 'Meeting', done: booked, note: booked ? dayLabel(b.next_step.booked_at) : null },
    { key: 'opportunity', label: 'Opportunity', done: !!convertedDealId || !!b.converted_deal_id, note: null },
  ];
  // a later step done means the earlier ones happened, even when nothing recorded them
  let later = false;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].done) later = true; else if (later) steps[i] = { ...steps[i], done: true };
  }
  return steps;
}

/** Index of the step the person is at now (the first not done), or -1 when the journey is complete. */
export function currentStep(steps: JourneyStep[]): number {
  return steps.findIndex((s) => !s.done);
}

/** "PEI Napa" from "Mateo talked with Miten Marvania at PEI Napa 2026". */
function firstPlace(text: string | null | undefined): string | null {
  const m = (text || '').match(/\bat ([A-Z][\w&.\- ]{2,40}?)(?: \d{4})?$/);
  return m ? m[1].trim() : null;
}

/** One plain sentence on where we stand with them, plus an optional quiet second line. */
export function standLine(b: LeadBrief): { line: string; sub: string | null } {
  const name = firstName(b.person.name);
  const written = b.stand.channels.filter((c) => c.channel !== 'meeting')
    .sort((a, c) => (c.last_at || '').localeCompare(a.last_at || ''));
  const waiting = written.find((c) => c.last_from_them && c.needs_reply);
  if (waiting) {
    return { line: `${name} wrote on ${CHAT_WORD[waiting.channel] ?? waiting.label} ${agoLabel(waiting.last_at)} and is waiting for our answer.`,
             sub: waiting.last_text ? `“${clip(waiting.last_text, 140)}”` : null };
  }
  const last = written[0];
  if (last && last.last_from_them) {
    return { line: `${name} answered on ${CHAT_WORD[last.channel] ?? last.label} ${agoLabel(last.last_at)}.`, sub: last.last_text ? `“${clip(last.last_text, 140)}”` : null };
  }
  if (b.stand.sent_count > 0 || last) {
    const n = b.stand.sent_count;
    const where = last ? ` on ${CHAT_WORD[last.channel] ?? last.label}` : '';
    const lastAt = b.stand.last_sent_at || last?.last_at;
    const line = b.stand.last_reply_at
      ? `${name} answered ${agoLabel(b.stand.last_reply_at)}; we wrote last, ${agoLabel(lastAt)}${where}.`
      : `We wrote ${n > 1 ? `${n} times` : 'once'}${where}, last ${agoLabel(lastAt)} — no answer yet.`;
    return { line, sub: last?.last_text ? `Our last message: “${clip(last.last_text, 120)}”` : null };
  }
  const meeting = b.stand.channels.find((c) => c.kind === 'meeting' || c.channel === 'meeting');
  const conn = b.who_in.connected.find((c) => c.status === 'connected');
  const parts: string[] = [];
  if (meeting) {
    const place = firstPlace(meeting.text);
    parts.push(`Met in person ${agoLabel(meeting.last_at)}${place ? ` at ${place}` : ''}.`);
  }
  if (conn) parts.push(`Connected on LinkedIn${conn.owner ? ` through ${firstName(conn.owner)}` : ''}, but nobody has written yet.`);
  if (!parts.length) parts.push('No contact yet.');
  return { line: parts.join(' '), sub: meeting?.text && meeting.owner_name ? `Logged by ${meeting.owner_name}: “${clip(meeting.text, 120)}”` : null };
}

export interface TalkingPoint { when: string | null; text: string; source?: string | null; sourceTitle?: string | null }

/** Dated facts first (each with a source); else the research's talking points. */
export function talkingPoints(b: LeadBrief): TalkingPoint[] {
  if (b.why_now.facts.length) {
    return b.why_now.facts.map((f) => ({
      when: f.date.length === 7 ? dayLabel(`${f.date}-01`).replace(/^\d+ /, '') : dayLabel(f.date),
      text: f.fact, source: f.source_url, sourceTitle: f.source_title ?? null,
    }));
  }
  const raw: unknown = b.gains.talking_points;
  const list = Array.isArray(raw) ? raw.map(String)
    : typeof raw === 'string' ? raw.split(/\n+/).map((s) => s.replace(/^\s*[•\-–*]\s*/, '').trim()) : [];
  return list.filter((s) => s.length > 3).map((text) => ({ when: null, text }));
}

/**
 * Why now: dated facts (each with a source) first; else, for a person the deep research has looked at, its talking
 * points (fresher); else the company research's signals ("active hiring"); else any talking points.
 */
export function whyNowLines(b: LeadBrief): TalkingPoint[] {
  const points = talkingPoints(b);
  if (b.why_now.facts.length) return points;
  if (b.research.at && points.length) return points;
  const notes = (b.why_now.notes ?? []).map((text) => ({ when: null, text }));
  return notes.length ? notes : points;
}

/**
 * The role from a LinkedIn-style title, before any research: "Geschäftsführer bei BARLOG Plastics GmbH
 * (Vorstandsvorsitzender kunststoffland NRW e.V.)" → role "Geschäftsführer", also "Vorstandsvorsitzender kunststoffland
 * NRW e.V.". Splits on " bei " / " at " / " @ " / " | " and takes a bracketed part as a second role.
 */
export function roleFromTitle(title: string | null | undefined): { role: string; also: string | null } | null {
  if (!title) return null;
  const t = title.replace(/\s+/g, ' ').trim();
  const bracket = t.match(/\(([^)]{3,})\)\s*$/);
  const head = bracket ? t.slice(0, bracket.index).trim() : t;
  const role = head.split(/\s+(?:bei|at|@|\|)\s+/i)[0].trim();
  const pipe = head.split(/\s+\|\s+/);
  const also = bracket ? bracket[1].trim() : pipe.length > 1 ? pipe.slice(1).join(' · ') : null;
  return role ? { role, also } : null;
}

/** "Large (154 employees as of 2023, with over 40 investment pro" → "154 employees". */
export function shortSize(size: string | null | undefined): string | null {
  if (!size) return null;
  const m = size.match(/(\d[\d,.]*\+?)\s*(employees|people|staff)/i);
  if (m) return `${m[1]} ${m[2].toLowerCase()}`;
  return clip(size.replace(/\s*\(.*$/, ''), 40);
}

export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

export function channelWord(c: string | null | undefined): string | null {
  return c ? CHAT_WORD[c] ?? c : null;
}
