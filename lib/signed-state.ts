/**
 * HMAC-signed, expiring state for OAuth round trips (Google) and hosted-auth returns (LinkedIn).
 *
 * The Google `state` parameter used to be the bare user id compared with the session's user id: forgeable
 * by anyone who knows an id, and useless when there is no browser session (a link opened from Telegram on a
 * phone). Now it is `base64url(json).hmac` with an expiry; the callback verifies it, and (for the Telegram
 * flow) the `t` field must name a still-open row in `connect_tokens`, so even a validly signed state cannot
 * complete a flow that was already finished or never existed. Server-only.
 */
import crypto from 'crypto';

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  // Domain separation: this key is not the cookie-sealing key itself.
  return crypto.createHash('sha256').update(`oauth-state:${secret}`).digest();
}

export function signState(payload: Record<string, unknown>, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', key()).update(body).digest('base64url')}`;
}

export function verifyState<T extends Record<string, unknown> = Record<string, unknown>>(
  state: string | null | undefined
): (T & { exp: number }) | null {
  if (!state || state.length > 2000) return null;
  const [body, sig, extra] = state.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = crypto.createHmac('sha256', key()).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
