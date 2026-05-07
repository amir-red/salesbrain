import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { canMutate, composeClientFormEmail, type OnboardingRow } from '@/lib/onboarding';

const TOKEN_TTL_DAYS = 30;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getAppUrl(req: NextRequest): string {
  // Same reverse-proxy-aware helper as forgot-password — Caddy adds X-Forwarded-* headers.
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host') || req.nextUrl.host;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || req.nextUrl.protocol.replace(':', '') || 'https';
  return process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;
}

/**
 * POST /api/onboardings/[id]/form-link
 * Generates a single-use, 30-day token + emails the link to the deal's
 * contact_email so the client can fill the Stage-2 contacts.
 *
 * Returns { url } so the PM can also copy/share the link manually.
 * If `to` is provided in the body, send to that address instead of the deal contact.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let bodyJson: { to?: string } = {};
  try { bodyJson = await req.json(); } catch { /* body is optional */ }

  const { rows } = await pool.query<OnboardingRow & { deal_contact_email: string | null }>(
    `SELECT o.*, d.contact_email as deal_contact_email
     FROM client_onboardings o LEFT JOIN deals d ON d.id = o.deal_id
     WHERE o.id = $1`,
    [params.id]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canMutate(session, row)) {
    return NextResponse.json({ error: 'You are not the assigned PM' }, { status: 403 });
  }

  const recipient = (bodyJson.to?.trim()) || row.deal_contact_email;
  if (!recipient) {
    return NextResponse.json({ error: 'No recipient email — pass { to } or set the deal contact_email' }, { status: 400 });
  }

  // Generate a fresh raw token + hash. We allow multiple active links per
  // onboarding (e.g. PM resends because the client lost the email), but each
  // is single-use independently. The first one to submit wins.
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000);

  await pool.query(
    `INSERT INTO onboarding_form_links (onboarding_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [params.id, tokenHash, expiresAt]
  );

  const appUrl = getAppUrl(req);
  const formUrl = `${appUrl}/forms/onboarding-contacts/${rawToken}`;

  const { subject, body } = composeClientFormEmail(formUrl, row.company_name);
  try {
    await sendEmail({ to: recipient, subject, body });
  } catch (err) {
    // Even if email send fails, the token is in the DB — the PM can copy/share the URL manually.
    console.warn('[onboarding form-link] Email send failed, token still issued:', err);
    return NextResponse.json({ url: formUrl, email_sent: false, error: 'Email failed but link is valid' });
  }

  return NextResponse.json({ url: formUrl, email_sent: true, recipient });
}
