/**
 * Verify an OIDC ID token Google signed — how a Pub/Sub push subscription proves a call is really Google delivering
 * our subscription (Authorization: Bearer <jwt>). Server-only, no library: Google's public keys (JWK) are fetched and
 * cached, the RS256 signature is checked with node:crypto, then issuer, audience, expiry and the signing service
 * account. The account check matters: ANY Google service account can mint a token for any audience, so a token is
 * only trusted when it comes from the account named on our subscription.
 */
import { createPublicKey, verify } from 'crypto';

const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string; use?: string };
let cache: { keys: Jwk[]; at: number } | null = null;

async function googleKeys(force = false): Promise<Jwk[]> {
  if (!force && cache && Date.now() - cache.at < 3600_000) return cache.keys;
  const res = await fetch(CERTS);
  if (!res.ok) throw new Error(`could not fetch Google's keys (${res.status})`);
  const body = await res.json() as { keys: Jwk[] };
  cache = { keys: body.keys || [], at: Date.now() };
  return cache.keys;
}

function b64urlJson<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

export interface GoogleIdClaims { iss: string; aud: string; exp: number; email?: string; email_verified?: boolean; sub: string }

/** The claims when the token is Google's, unexpired, for `audience` and signed by `email`; otherwise it throws.
 *  `keys` lets a test supply its own key set. */
export async function verifyGoogleIdToken(token: string, want: { audience: string; email: string }, keys?: Jwk[]): Promise<GoogleIdClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('not a JWT');
  const header = b64urlJson<{ alg: string; kid?: string }>(parts[0]);
  if (header.alg !== 'RS256') throw new Error(`unexpected algorithm ${header.alg}`);
  let set = keys ?? await googleKeys();
  let jwk = set.find((k) => k.kid === header.kid);
  if (!jwk && !keys) { set = await googleKeys(true); jwk = set.find((k) => k.kid === header.kid); }   // Google rotated
  if (!jwk) throw new Error('unknown signing key');
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' } as Parameters<typeof createPublicKey>[0]),
    Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('bad signature');
  const c = b64urlJson<GoogleIdClaims>(parts[1]);
  if (!ISSUERS.has(c.iss)) throw new Error('not issued by Google');
  if (c.aud !== want.audience) throw new Error('wrong audience');
  if (!c.exp || c.exp * 1000 < Date.now() - 60_000) throw new Error('expired');
  if (!want.email || c.email !== want.email || c.email_verified === false) throw new Error('not signed by our push account');
  return c;
}
