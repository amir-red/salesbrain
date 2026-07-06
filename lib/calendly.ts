/**
 * Calendly webhook helpers.
 *
 * Two responsibilities:
 *   1. HMAC-SHA256 signature verification (Calendly-Webhook-Signature header).
 *      We MUST verify against the exact raw request bytes — parsed JSON is a
 *      different string with different whitespace, so the route handler reads
 *      the body via `req.text()` and passes it here verbatim.
 *   2. Payload parsing: pluck the fields the CRM cares about from Calendly's
 *      verbose event shape. We don't validate the entire schema — just the
 *      subset we persist. Anything unexpected is logged in the route handler.
 *
 * Reference:
 *   - Signature format: https://developer.calendly.com/api-docs/ZG9jOjM2MzE2MDM4-webhook-signatures
 *     Header value looks like: `t=<unix_ts>,v1=<hex_hmac>`
 *   - Event types we care about: `invitee.created`, `invitee.canceled`
 *   - The webhook payload wraps an `event` type + a `payload` blob; we
 *     tolerate small shape drift so a future Calendly change doesn't crash
 *     the handler outright.
 */

import crypto from 'crypto';

// ─── Signature verification ───────────────────────────────────────

/**
 * Verify Calendly's HMAC-SHA256 webhook signature.
 *
 * @param rawBody   Exact request body bytes as received (do NOT JSON.parse first)
 * @param header    Contents of the `Calendly-Webhook-Signature` header
 * @param secret    The signing secret configured in Calendly's webhook UI
 * @param maxSkewMs Reject signatures older than this (default 5 min) to blunt
 *                  replay attacks. Set to Infinity to disable during testing.
 */
export function verifyCalendlyWebhook(
  rawBody: string,
  header: string | null,
  secret: string,
  maxSkewMs = 5 * 60 * 1000,
): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: 'missing signature header' };
  if (!secret) return { ok: false, reason: 'CALENDLY_WEBHOOK_SECRET not configured' };

  // Header format: `t=1234567890,v1=abcdef...` (may include multiple v1s in future).
  const parts = header.split(',').map((p) => p.trim());
  const tPart = parts.find((p) => p.startsWith('t='));
  const v1Part = parts.find((p) => p.startsWith('v1='));
  if (!tPart || !v1Part) return { ok: false, reason: 'malformed signature header' };

  const timestamp = tPart.slice(2);
  const providedHex = v1Part.slice(3);

  // Skew check — protects against captured-signature replays.
  const tsMs = Number(timestamp) * 1000;
  if (Number.isFinite(tsMs) && Number.isFinite(maxSkewMs)) {
    const nowMs = Date.now();
    if (Math.abs(nowMs - tsMs) > maxSkewMs) {
      return { ok: false, reason: `timestamp outside acceptable skew (${Math.abs(nowMs - tsMs)}ms)` };
    }
  }

  // Signed string is literally `<timestamp>.<rawBody>`.
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  // Constant-time compare to defeat timing attacks.
  try {
    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(providedHex, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'signature length mismatch' };
    return crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
  } catch {
    return { ok: false, reason: 'signature not valid hex' };
  }
}

// ─── Payload parsing ──────────────────────────────────────────────

export interface CalendlyCreatedEvent {
  event_uuid: string;          // Calendly scheduled_event uuid — unique per booking
  invitee_uuid: string;         // Calendly invitee uuid
  email: string;                // Prospect's email (matches sales_leads.email)
  name: string;                 // Prospect's name (fallback if the row was created cold)
  company?: string;             // From a custom question, if configured
  meet_link?: string;           // Google Meet URL from `location.join_url`
  reschedule_url: string;       // Full URL prospect can hit to reschedule
  cancel_url: string;           // Full URL prospect can hit to cancel
  start_time: string;           // ISO 8601 UTC — when the demo IS
  end_time?: string;            // ISO 8601 UTC — end of the slot (optional)
}

export interface CalendlyCanceledEvent {
  event_uuid: string;
  invitee_uuid: string;
  email: string;                // For matching if event_uuid isn't in DB yet
}

/**
 * Extract a stable UUID from a Calendly URI. Calendly returns full URIs
 * like `https://api.calendly.com/scheduled_events/UUID` — we want just the
 * UUID as a stable identifier.
 */
function uuidFromUri(uri?: string): string {
  if (!uri) return '';
  const parts = uri.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * Pull the fields we persist from a `invitee.created` payload.
 *
 * The Calendly payload shape (verified against Nov 2024 docs):
 *   {
 *     event: "invitee.created",
 *     payload: {
 *       uri, name, email,
 *       questions_and_answers: [{question, answer, position}],
 *       scheduled_event: {
 *         uri, start_time, end_time,
 *         location: { type, join_url, ... }
 *       },
 *       reschedule_url, cancel_url,
 *     }
 *   }
 *
 * We're tolerant of missing sub-fields — a change on Calendly's side that
 * moves the Meet URL shouldn't crash the whole handler. Callers see the
 * `event_uuid` even if peripheral fields are absent.
 */
export function parseCreatedEvent(body: Record<string, unknown>): CalendlyCreatedEvent {
  const payload = (body?.payload ?? {}) as Record<string, unknown>;
  const scheduledEvent = (payload?.scheduled_event ?? {}) as Record<string, unknown>;
  const location = (scheduledEvent?.location ?? {}) as Record<string, unknown>;

  const inviteeUri = String(payload?.uri ?? '');
  const scheduledEventUri = String(scheduledEvent?.uri ?? '');

  // Custom questions — the sales form on zeami.io is expected to have
  // "Company" as one of the questions Calendly asks. We match on the
  // literal question text (case-insensitive) so setup changes are
  // low-risk. If the answer isn't present we leave company undefined
  // (the sales_leads row already has it from the form submit).
  const qa = Array.isArray(payload?.questions_and_answers)
    ? (payload.questions_and_answers as Array<Record<string, unknown>>)
    : [];
  const companyAnswer = qa.find(
    (q) => String(q?.question ?? '').toLowerCase().includes('company'),
  );

  return {
    event_uuid: uuidFromUri(scheduledEventUri),
    invitee_uuid: uuidFromUri(inviteeUri),
    email: String(payload?.email ?? '').toLowerCase(),
    name: String(payload?.name ?? ''),
    company: companyAnswer ? String(companyAnswer.answer ?? '') || undefined : undefined,
    meet_link: location?.join_url ? String(location.join_url) : undefined,
    reschedule_url: String(payload?.reschedule_url ?? ''),
    cancel_url: String(payload?.cancel_url ?? ''),
    start_time: String(scheduledEvent?.start_time ?? ''),
    end_time: scheduledEvent?.end_time ? String(scheduledEvent.end_time) : undefined,
  };
}

/**
 * Pull the fields we care about from a `invitee.canceled` payload.
 * Same shape as invitee.created but we only look at identifiers.
 */
export function parseCanceledEvent(body: Record<string, unknown>): CalendlyCanceledEvent {
  const payload = (body?.payload ?? {}) as Record<string, unknown>;
  const scheduledEvent = (payload?.scheduled_event ?? {}) as Record<string, unknown>;
  return {
    event_uuid: uuidFromUri(String(scheduledEvent?.uri ?? '')),
    invitee_uuid: uuidFromUri(String(payload?.uri ?? '')),
    email: String(payload?.email ?? '').toLowerCase(),
  };
}
