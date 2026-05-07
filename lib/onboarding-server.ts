/**
 * Server-only onboarding orchestration. This file is the only onboarding
 * helper that touches the DB or email service — keep it out of any client
 * component import path so webpack doesn't try to bundle `pg` for the
 * browser.
 */
import crypto from 'crypto';
import pool from './db';
import { sendEmail } from './email';
import { buildFormUrl, composeOnboardingKickoffEmail } from './onboarding';

const TOKEN_TTL_DAYS = 30;

/**
 * Issues a single-use Stage-2 form-link token for this onboarding. Returns
 * the **raw** token (URL-safe). Stores only the SHA-256 hash in the DB so
 * leaks of the DB cannot recover the token.
 */
export async function issueFormToken(onboardingId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000);
  await pool.query(
    `INSERT INTO onboarding_form_links (onboarding_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [onboardingId, hash, expiresAt]
  );
  return raw;
}

export interface KickoffEmailResult {
  sent: boolean;
  recipient: string | null;
  formUrl: string;
  error?: string;
}

/**
 * Sends the welcome / kickoff email for an onboarding row to the deal's
 * client contact. Generates a fresh form token, composes the email, and
 * fires it via Resend.
 *
 * Best-effort: returns `{sent: false, error}` instead of throwing so
 * callers (G9 hook, manual create) don't fail the surrounding operation
 * if Resend is unavailable. The token row is still persisted on email
 * failure — the PM can copy the URL manually.
 */
export async function sendOnboardingKickoffEmail(args: {
  onboardingId: string;
  companyName: string;
  recipient: string | null;
  pmName?: string | null;
  pmEmail?: string | null;
}): Promise<KickoffEmailResult> {
  const { onboardingId, companyName, recipient, pmName, pmEmail } = args;

  let rawToken: string;
  try {
    rawToken = await issueFormToken(onboardingId);
  } catch (err) {
    console.error('[onboarding] failed to issue form token:', err);
    return { sent: false, recipient, formUrl: '', error: 'Could not issue form token' };
  }

  const formUrl = buildFormUrl(rawToken);

  if (!recipient || !recipient.trim()) {
    console.warn('[onboarding] no client email on file, skipping kickoff email send');
    return { sent: false, recipient: null, formUrl };
  }

  const { subject, body } = composeOnboardingKickoffEmail({ companyName, formUrl, pmName, pmEmail });
  try {
    await sendEmail({ to: recipient.trim(), subject, body });
    return { sent: true, recipient: recipient.trim(), formUrl };
  } catch (err) {
    console.error('[onboarding] kickoff email send failed:', err);
    return {
      sent: false,
      recipient: recipient.trim(),
      formUrl,
      error: err instanceof Error ? err.message : 'send failed',
    };
  }
}
