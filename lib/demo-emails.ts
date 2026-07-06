/**
 * Demo-request transactional emails (fires when a row lands in `sales_leads`
 * via the public POST endpoint at /api/public/sales-leads).
 *
 * Two messages, both via Resend:
 *   1) Lead confirmation  → the prospect       ("Thanks for requesting a Zeami demo")
 *   2) Team notification  → internal recipients ("New demo request: <co> — <name>")
 *
 * Fire-and-forget by design — the lead save MUST succeed even when Resend is
 * down or the API key is missing. The wrapper never throws; failures are
 * logged so the lead still persists and the public API still returns 201.
 *
 * Templates lifted verbatim from the Zeami marketing site's previous server
 * implementation (see docs / DEMO_EMAILS_BACKEND.md). Brand tokens kept
 * exact: paper #FAFAFA, card #FFFFFF, border #E2E8F0, text #0F172A/#475569,
 * accent #00E5FF on obsidian #0D0D14, Poppins, hosted logo URL.
 *
 * Recipient policy:
 *   - Lead-confirmation reply-to: tesfa@zeami.io (monitored).
 *   - Team-notification reply-to: the lead's own email (so anyone on the team
 *     can hit Reply and respond directly to the prospect).
 *   - Team notification TO: tesfa@zeami.io (overridable via LEAD_NOTIFY_TO).
 *     CC: osman@zeami.io, mateo@zeami.io, beck@zeami.io (overridable via
 *     LEAD_NOTIFY_CC). Either env var, if set, replaces the default entirely.
 */

import { Resend } from 'resend';

export interface DemoForm {
  fullName: string;
  workEmail: string;
  company: string;
  preferredDate?: string;
  preferredTime?: string;
  timeZone?: string;
  details?: string;

  // Optional booking-confirmation extras. Present when the Calendly webhook
  // fires; absent for legacy "lead capture only" flows. When set, the team
  // notification renders extra rows for Meet link + reschedule URL.
  bookedSlotLabel?: string;    // Pre-formatted human-readable slot, e.g.
                               // "Thu, Jul 2 2026 · 9:00 AM · Africa/Nairobi"
  meetLink?: string;           // Google Meet URL from Calendly's payload
  rescheduleUrl?: string;      // Prospect's self-serve reschedule link
  cancelUrl?: string;          // Prospect's self-serve cancel link
}

// Escape user-supplied values before interpolating into HTML.
const esc = (s: unknown) =>
  String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

const leadConfirmationHtml = ({
  firstName,
  preferredDate,
  preferredTime,
  timeZone,
  logoUrl,
}: {
  firstName: string;
  preferredDate?: string;
  preferredTime?: string;
  timeZone?: string;
  logoUrl: string;
}) => {
  const slot =
    preferredDate || preferredTime
      ? `<p style="margin:16px 0 0;font-size:14px;line-height:22px;color:#475569;">You asked for <strong style="color:#0F172A;">${esc(
          [preferredDate, preferredTime].filter(Boolean).join(' at '),
        )}${timeZone ? ' (' + esc(timeZone) + ')' : ''}</strong>. We'll confirm the exact slot in our reply.</p>`
      : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:'Poppins','Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:40px 0;"><tr><td align="center" style="padding:0 16px;">
    <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">
      <tr><td style="height:4px;background:#00E5FF;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:32px 40px 0;">
        <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
          <td style="vertical-align:middle;padding-right:10px;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;background:#0D0D14;border-radius:10px;">
                <a href="https://zeami.io" target="_blank" style="text-decoration:none;display:block;"><img src="${logoUrl}" alt="Zeami" width="26" height="26" style="display:block;border:0;"/></a>
              </td>
            </tr></table>
          </td>
          <td style="vertical-align:middle;"><a href="https://zeami.io" target="_blank" style="text-decoration:none;"><span style="font-size:18px;font-weight:700;color:#0F172A;letter-spacing:-0.3px;">Zeami</span></a></td>
        </tr></table>
        <p style="margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#64748B;">Demo requested</p>
        <h1 style="margin:0;font-size:24px;line-height:32px;font-weight:600;color:#0F172A;">Thanks, ${esc(firstName)} — we're on it!</h1>
      </td></tr>
      <tr><td style="padding:20px 40px 36px;color:#475569;">
        <p style="margin:0;font-size:15px;line-height:24px;">We got your request for a Zeami demo. Our team will reach out to confirm your time slot and show you how Zeami turns repetitive work into automation.</p>
        ${slot}
        <p style="margin:16px 0 0;font-size:14px;line-height:22px;color:#475569;">Have a question in the meantime? Just reply to this email.</p>
      </td></tr>
      <tr><td style="padding:20px 40px;border-top:1px solid #E2E8F0;"><p style="margin:0;font-size:12px;color:#94A3B8;">© 2026 Zeami</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
};

/**
 * `subjectPrefix` differentiates the two email variants:
 *   'New demo request'   — legacy lead-capture path (no Calendly booking yet)
 *   'Demo booked'        — post-Calendly-webhook confirmation with Meet link
 *
 * When bookedSlotLabel / meetLink / rescheduleUrl are set, the template
 * renders additional rows so the recipient team gets a click-to-join card
 * instead of a generic "someone submitted the form" message.
 */
const teamNotificationHtml = (f: DemoForm, headline: string) => {
  const row = (label: string, val?: string) =>
    val
      ? `<tr><td style="padding:6px 16px 6px 0;font-size:12px;font-weight:600;color:#64748B;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:14px;color:#0F172A;">${esc(
          val,
        )}</td></tr>`
      : '';
  // Row variant for URL fields — renders as a truncated hyperlink so the
  // team notification is scannable without a wall of URL text.
  const linkRow = (label: string, url?: string, linkText?: string) =>
    url
      ? `<tr><td style="padding:6px 16px 6px 0;font-size:12px;font-weight:600;color:#64748B;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:14px;color:#0F172A;"><a href="${esc(url)}" style="color:#00A3B8;text-decoration:underline;">${esc(linkText || url)}</a></td></tr>`
      : '';
  // Fallback slot label from preferred-time fields when no booking has
  // happened yet (legacy path).
  const legacySlot =
    [f.preferredDate, f.preferredTime].filter(Boolean).join(' at ') +
    (f.timeZone ? ` (${esc(f.timeZone)})` : '');
  const displaySlot = f.bookedSlotLabel || (legacySlot.trim() || undefined);
  const slotLabel = f.bookedSlotLabel ? 'Booked time' : 'Preferred time';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:'Poppins','Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:40px 0;"><tr><td align="center" style="padding:0 16px;">
    <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">
      <tr><td style="height:4px;background:#00E5FF;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 40px 8px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#64748B;">${esc(headline)}</p>
        <h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600;color:#0F172A;">${esc(f.company)} — ${esc(f.fullName)}</h1>
      </td></tr>
      <tr><td style="padding:12px 40px 32px;">
        <table cellpadding="0" cellspacing="0">
          ${row('Name', f.fullName)}
          ${row('Work email', f.workEmail)}
          ${row('Company', f.company)}
          ${displaySlot ? row(slotLabel, displaySlot) : ''}
          ${linkRow('Meet link', f.meetLink, 'Join the demo')}
          ${linkRow('Reschedule', f.rescheduleUrl, 'Prospect reschedule link')}
          ${row('Details', f.details)}
        </table>
        <p style="margin:20px 0 0;font-size:13px;line-height:20px;color:#64748B;">Reply to this email to respond to the lead directly.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
};

// Reuse a single Resend client. lib/email.ts also has one; we keep a
// dedicated instance here so this module is self-contained and never
// imports application email helpers (which would couple lib/email.ts
// to the demo flow).
let resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

/**
 * Read the team recipient list from env (with defaults).
 * TO defaults to tesfa@zeami.io; CC defaults to osman, mateo, beck.
 * Setting either LEAD_NOTIFY_TO / LEAD_NOTIFY_CC replaces the default entirely.
 */
function teamRecipients(): { to: string[]; cc: string[] } {
  const to = (process.env.LEAD_NOTIFY_TO || 'tesfa@zeami.io')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const cc = (process.env.LEAD_NOTIFY_CC || 'osman@zeami.io,mateo@zeami.io,beck@zeami.io')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return { to, cc };
}

/**
 * Fire-and-forget: legacy dual-email path (prospect confirmation + team
 * notification). Kept for the pre-Calendly flow — a marketing campaign
 * that doesn't embed the Calendly widget still lands on the sales-leads
 * POST endpoint and can opt into this path explicitly.
 *
 * Under the Calendly flow this is NOT called — Calendly's own confirmation
 * email (with .ics + reschedule/cancel) covers the prospect, and the team
 * notification fires from the webhook once the slot is actually booked
 * (see `sendTeamBookingNotification` below).
 *
 * NEVER throws.
 */
export async function sendDemoEmails(form: DemoForm): Promise<void> {
  const client = getResend();
  if (!client) {
    console.warn('[demo-emails] RESEND_API_KEY unset — skipping (lead save unaffected).');
    return;
  }

  const firstName = (form.fullName || '').trim().split(/\s+/)[0] || 'there';
  const logoUrl = process.env.EMAIL_LOGO_URL || 'https://zeami.io/zeami-email-logo.png';
  const { to: teamTo, cc: teamCc } = teamRecipients();

  try {
    // (1) Lead confirmation → the prospect.
    await client.emails.send({
      from: 'Zeami <noreply@zeami.io>',
      to: [form.workEmail],
      replyTo: 'tesfa@zeami.io',
      subject: 'Thanks for requesting a Zeami demo',
      html: leadConfirmationHtml({
        firstName,
        preferredDate: form.preferredDate,
        preferredTime: form.preferredTime,
        timeZone: form.timeZone,
        logoUrl,
      }),
    });

    // (2) Internal team notification.
    await client.emails.send({
      from: 'Zeami <noreply@zeami.io>',
      to: teamTo,
      cc: teamCc.length ? teamCc : undefined,
      replyTo: form.workEmail,
      subject: `New demo request: ${form.company} — ${form.fullName}`,
      html: teamNotificationHtml(form, 'New demo request'),
    });
  } catch (err) {
    console.warn('[demo-emails] send failed (non-blocking):', err);
  }
}

/**
 * Fire-and-forget team notification for a CONFIRMED booking. Called from
 * the Calendly webhook after `invitee.created`. The prospect's own
 * confirmation email is sent by Calendly directly (native .ics + reschedule
 * + cancel links) — we don't duplicate it.
 *
 * The team gets a click-to-join card with the Meet link, the reschedule
 * URL, the booked slot rendered in the prospect's tz, and reply-to =
 * prospect so anyone can respond directly.
 *
 * NEVER throws.
 */
export async function sendTeamBookingNotification(form: DemoForm): Promise<void> {
  const client = getResend();
  if (!client) {
    console.warn('[demo-emails] RESEND_API_KEY unset — skipping team notification.');
    return;
  }

  const { to: teamTo, cc: teamCc } = teamRecipients();

  try {
    await client.emails.send({
      from: 'Zeami <noreply@zeami.io>',
      to: teamTo,
      cc: teamCc.length ? teamCc : undefined,
      replyTo: form.workEmail,
      subject: `Demo booked: ${form.company} — ${form.fullName}`,
      html: teamNotificationHtml(form, 'Demo booked'),
    });
  } catch (err) {
    console.warn('[demo-emails] booking notification failed (non-blocking):', err);
  }
}

/**
 * Fire-and-forget team notification when a prospect cancels via Calendly's
 * cancel link. Reuses the same template with a "Demo canceled" headline so
 * the team can react quickly.
 *
 * NEVER throws.
 */
export async function sendTeamCancellationNotification(form: DemoForm): Promise<void> {
  const client = getResend();
  if (!client) return;

  const { to: teamTo, cc: teamCc } = teamRecipients();

  try {
    await client.emails.send({
      from: 'Zeami <noreply@zeami.io>',
      to: teamTo,
      cc: teamCc.length ? teamCc : undefined,
      replyTo: form.workEmail,
      subject: `Demo canceled: ${form.company} — ${form.fullName}`,
      html: teamNotificationHtml(form, 'Demo canceled'),
    });
  } catch (err) {
    console.warn('[demo-emails] cancellation notification failed (non-blocking):', err);
  }
}
