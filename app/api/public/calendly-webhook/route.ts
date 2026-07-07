/**
 * POST /api/public/calendly-webhook
 *
 * Receives event notifications from Calendly for `invitee.created` and
 * `invitee.canceled` events. Authenticated via HMAC signature only (no
 * API key) — Calendly's UI configures the signing secret and posts to
 * this URL.
 *
 * Behavior:
 *   1. Read RAW body (before JSON.parse) — required for signature verify.
 *   2. Verify Calendly-Webhook-Signature. Bad sig → 401 with no side effects.
 *   3. Handle by event type:
 *      - invitee.created:  UPDATE sales_leads row (match by email + no prior
 *        booking, or by calendly_event_uuid if this is a resend) with the
 *        booked_at + meet_link + reschedule_url + cancel_url + event uuid.
 *        Then fire the team notification email.
 *      - invitee.canceled: UPDATE the row's booking_status='canceled'.
 *        Fire cancellation notification.
 *   4. Return 200 to Calendly so retries don't stack up.
 *
 * Idempotency: Calendly retries webhooks with exponential backoff on any
 * non-2xx. We use UPSERT-style logic keyed on calendly_event_uuid — a
 * re-delivered created event is a no-op UPDATE, and a re-delivered cancel
 * won't stack duplicate cancel-notification emails because we short-circuit
 * when booking_status is already 'canceled'.
 *
 * NOTE: on Calendly Free plan, webhooks are gated — this handler will
 * simply never fire until the workspace is upgraded to Standard. Zero code
 * changes needed on upgrade; just set CALENDLY_WEBHOOK_SECRET in env.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  verifyCalendlyWebhook,
  parseCreatedEvent,
  parseCanceledEvent,
} from '@/lib/calendly';
import {
  sendTeamBookingNotification,
  sendTeamCancellationNotification,
} from '@/lib/demo-emails';

/**
 * Format a Calendly `start_time` (ISO 8601 UTC) as a human-readable slot
 * label rendered in the prospect's timezone.
 *
 * Example output: "Thu, Jul 2 2026 · 9:00 AM · Africa/Nairobi"
 *
 * Returns null if the timestamp can't be parsed — the caller falls back to
 * omitting the slot line.
 */
function formatBookedSlot(startTimeIso: string, timezone?: string | null): string | null {
  if (!startTimeIso) return null;
  const d = new Date(startTimeIso);
  if (isNaN(d.getTime())) return null;
  const tz = timezone || 'UTC';
  try {
    const dateFmt = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: tz,
    });
    const timeFmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: tz,
    });
    return `${dateFmt.format(d)} · ${timeFmt.format(d)} · ${tz}`;
  } catch {
    return startTimeIso;
  }
}

/**
 * Health-check GET so someone can hit the URL in a browser and confirm the
 * route is deployed without leaking secret info.
 */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'calendly-webhook', method: 'POST expected' });
}

export async function POST(req: NextRequest) {
  const secret = process.env.CALENDLY_WEBHOOK_SECRET || '';
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('calendly-webhook-signature');

  const verified = verifyCalendlyWebhook(rawBody, signatureHeader, secret);
  if (!verified.ok) {
    console.warn('[calendly-webhook] signature verification failed:', verified.reason);
    return NextResponse.json({ error: 'Invalid signature', reason: verified.reason }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const eventType = String(body?.event ?? '');
  if (eventType !== 'invitee.created' && eventType !== 'invitee.canceled') {
    // Not one of our tracked events — 200 so Calendly doesn't retry.
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  try {
    if (eventType === 'invitee.created') {
      await handleCreated(body);
    } else if (eventType === 'invitee.canceled') {
      await handleCanceled(body);
    }
  } catch (err) {
    // Non-2xx would cause Calendly to retry. If our own logic errors, log
    // and still return 200 so we don't hammer the DB on transient issues.
    // Real recovery: someone eyeballs logs, patches, resends manually.
    console.error('[calendly-webhook] handler error:', err);
  }

  return NextResponse.json({ ok: true, event: eventType });
}

// ─── Handlers ────────────────────────────────────────────────────

async function handleCreated(body: Record<string, unknown>): Promise<void> {
  const e = parseCreatedEvent(body);
  if (!e.event_uuid || !e.email) {
    console.warn('[calendly-webhook] invitee.created missing required fields', e);
    return;
  }

  // Find the sales_leads row this booking corresponds to.
  //
  // Match order:
  //   1. Already-linked row (same calendly_event_uuid) — this is a re-delivery
  //      or a rescheduled event that kept the uuid. Update in place.
  //   2. Most recent NEW/CONTACTED row with matching email that hasn't been
  //      booked yet — the typical happy path (form submitted, then Calendly
  //      widget booked).
  //   3. If neither matches, insert a fresh row for this booking (cold-start
  //      / prospect skipped the form and went straight to a shared Calendly
  //      link). We seed with what Calendly told us.
  const { rows: existing } = await pool.query(
    `SELECT id FROM sales_leads
     WHERE calendly_event_uuid = $1
     UNION ALL
     SELECT id FROM sales_leads
     WHERE lower(email) = lower($2)
       AND calendly_event_uuid IS NULL
       AND status IN ('new', 'contacted')
     ORDER BY 1 IS NULL DESC
     LIMIT 1`,
    [e.event_uuid, e.email],
  );

  const bookedAt = e.start_time ? new Date(e.start_time) : null;

  let leadId: string;
  let companyForEmail: string;
  let fullNameForEmail: string;
  let timezone: string | null = null;

  if (existing[0]?.id) {
    leadId = existing[0].id as string;

    // Update the row with booking details. Preserve values captured earlier
    // via the zeami.io form (full_name, company, description) if they exist;
    // only backfill from Calendly if the existing field is empty. Website
    // was never captured by the zeami.io form, so straight write is fine.
    const { rows: updated } = await pool.query(
      `UPDATE sales_leads
       SET calendly_event_uuid   = $1,
           calendly_invitee_uuid = $2,
           meet_link             = $3,
           reschedule_url        = $4,
           cancel_url            = $5,
           booked_at             = $6,
           booking_status        = 'scheduled',
           -- Backfill any values Calendly gave us that our row is missing.
           company               = COALESCE(NULLIF(company, ''), $7),
           full_name             = COALESCE(NULLIF(full_name, ''), $8),
           description           = COALESCE(NULLIF(description, ''), $9),
           website               = COALESCE(NULLIF(website, ''), $10)
       WHERE id = $11
       RETURNING full_name, company, preferred_demo_timezone`,
      [
        e.event_uuid, e.invitee_uuid,
        e.meet_link || null,
        e.reschedule_url || null,
        e.cancel_url || null,
        bookedAt,
        e.company || 'Unknown',
        e.name,
        e.description || null,
        e.website || null,
        leadId,
      ],
    );
    fullNameForEmail = updated[0]?.full_name || e.name;
    companyForEmail = updated[0]?.company || e.company || 'Unknown';
    timezone = updated[0]?.preferred_demo_timezone ?? null;
  } else {
    // Cold-start: no form row, just Calendly. Seed a new sales_leads.
    const { rows: inserted } = await pool.query(
      `INSERT INTO sales_leads
         (full_name, company, email, website, description, source, status,
          calendly_event_uuid, calendly_invitee_uuid,
          meet_link, reschedule_url, cancel_url,
          booked_at, booking_status)
       VALUES ($1, $2, $3, $4, $5, 'zeami.io:calendly-direct', 'new',
               $6, $7, $8, $9, $10, $11, 'scheduled')
       RETURNING id`,
      [
        e.name || 'Unknown',
        e.company || 'Unknown',
        e.email,
        e.website || null,
        e.description || null,
        e.event_uuid, e.invitee_uuid,
        e.meet_link || null,
        e.reschedule_url || null,
        e.cancel_url || null,
        bookedAt,
      ],
    );
    leadId = inserted[0].id as string;
    fullNameForEmail = e.name;
    companyForEmail = e.company || 'Unknown';
  }

  // Team notification with click-to-join card.
  const bookedSlotLabel = formatBookedSlot(e.start_time, timezone) || undefined;
  void sendTeamBookingNotification({
    fullName: fullNameForEmail,
    workEmail: e.email,
    company: companyForEmail,
    bookedSlotLabel,
    meetLink: e.meet_link,
    rescheduleUrl: e.reschedule_url,
    cancelUrl: e.cancel_url,
  });

  console.log(`[calendly-webhook] booked lead ${leadId} for ${e.email} at ${e.start_time}`);
}

async function handleCanceled(body: Record<string, unknown>): Promise<void> {
  const e = parseCanceledEvent(body);
  if (!e.event_uuid && !e.email) {
    console.warn('[calendly-webhook] invitee.canceled missing identifiers', e);
    return;
  }

  // Match by event uuid (definitive) or fall back to email + scheduled status.
  const { rows } = await pool.query(
    `UPDATE sales_leads
     SET booking_status = 'canceled'
     WHERE (calendly_event_uuid = $1 OR (lower(email) = lower($2) AND booking_status = 'scheduled'))
       AND booking_status IS DISTINCT FROM 'canceled'   -- idempotent no-op
     RETURNING id, full_name, company, email`,
    [e.event_uuid, e.email],
  );

  if (rows.length === 0) {
    // Nothing matched or already canceled — either way, don't spam.
    console.log(`[calendly-webhook] canceled event ${e.event_uuid} — no lead update`);
    return;
  }

  const lead = rows[0];
  void sendTeamCancellationNotification({
    fullName: lead.full_name,
    workEmail: lead.email,
    company: lead.company,
  });

  console.log(`[calendly-webhook] canceled lead ${lead.id} for ${lead.email}`);
}
