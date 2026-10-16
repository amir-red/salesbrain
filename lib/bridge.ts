/**
 * Signed internal bridge: how the Hermes ring (Python, on the same box) calls things only the app can do —
 * build an Excel export, import a CSV, run the Google sync. Server-only.
 *
 * Trust model: the caller proves it holds BRIDGE_SECRET (an HMAC over `timestamp.body`), names the person it
 * acts for, and the app trusts that identity exactly as it trusts the kernel RPC's actor id in the other
 * direction. Defence in depth: the request must not come from the public internet (below), it must be fresh
 * (5 minutes), and a signature is accepted once. Without BRIDGE_SECRET the route answers 503 and does nothing.
 *
 * "Not from the internet": Next.js itself adds X-Forwarded-For/-Host/-Proto to EVERY request, even a direct
 * one (found by testing: a header-presence check refused the ring's own local call), so the headers cannot say
 * "proxied". What does: the client address. A direct call carries a loopback address; Caddy replaces
 * X-Forwarded-For with the real visitor's address (it does not trust a client-supplied one). So the first
 * address must be loopback, or absent.
 */
import crypto from 'crypto';

const MAX_SKEW_MS = 5 * 60_000;
const seen = new Map<string, number>();

export function bridgeSign(secret: string, ts: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

export function verifyBridge(
  headers: { get(name: string): string | null },
  rawBody: string,
  now = Date.now()
): { ok: true } | { ok: false; status: number; reason: string } {
  const secret = process.env.BRIDGE_SECRET || '';
  if (secret.length < 32) return { ok: false, status: 503, reason: 'bridge not configured' };
  const client = (headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (client && !/^(::ffff:)?127\.0\.0\.1$|^::1$/.test(client)) {
    return { ok: false, status: 403, reason: 'internal only' };
  }
  const ts = headers.get('x-bridge-ts') || '';
  const sig = headers.get('x-bridge-sig') || '';
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > MAX_SKEW_MS) return { ok: false, status: 401, reason: 'stale or missing timestamp' };
  const expected = Buffer.from(bridgeSign(secret, ts, rawBody), 'hex');
  let given: Buffer;
  try { given = Buffer.from(sig, 'hex'); } catch { return { ok: false, status: 401, reason: 'bad signature' }; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, status: 401, reason: 'bad signature' };
  for (const [k, t] of seen) if (now - t > 2 * MAX_SKEW_MS) seen.delete(k);
  if (seen.has(sig)) return { ok: false, status: 401, reason: 'replayed request' };
  seen.set(sig, now);
  return { ok: true };
}
