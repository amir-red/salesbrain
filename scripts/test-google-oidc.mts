/**
 * Run: node --experimental-strip-types --no-warnings scripts/test-google-oidc.mts
 * The check that decides whether a call to /api/gmail/push really is Google delivering OUR Pub/Sub subscription
 * (lib/google-oidc.ts). Signs tokens with a throwaway RSA key; exits non-zero on failure.
 */
import { generateKeyPairSync, sign } from 'crypto';
import { verifyGoogleIdToken } from '../lib/google-oidc.ts';

let failed = 0;
const ok = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed++; };

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', alg: 'RS256', use: 'sig' };
const KEYS = [jwk];
const WANT = { audience: 'https://crm.test/api/gmail/push', email: 'gmail-push@proj.iam.gserviceaccount.com' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function token(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: typeof privateKey } = {}) {
  const head = b64({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' });
  const body = b64({ iss: 'https://accounts.google.com', aud: WANT.audience, exp: Math.floor(Date.now() / 1000) + 600,
    sub: '1', email: WANT.email, email_verified: true, ...claims });
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
async function accepts(t: string) { try { await verifyGoogleIdToken(t, WANT, KEYS); return true; } catch { return false; } }

ok('a token from our push account is accepted', await accepts(token({})));
ok('another service account is rejected', !await accepts(token({ email: 'someone@evil.iam.gserviceaccount.com' })));
ok('another audience is rejected', !await accepts(token({ aud: 'https://evil.test/' })));
ok('another issuer is rejected', !await accepts(token({ iss: 'https://evil.test' })));
ok('an expired token is rejected', !await accepts(token({ exp: Math.floor(Date.now() / 1000) - 3600 })));
ok('an unverified email is rejected', !await accepts(token({ email_verified: false })));
ok('a token signed with another key is rejected', !await accepts(token({}, { key: other.privateKey })));
ok('an unknown key id is rejected', !await accepts(token({}, { kid: 'k2' })));
ok('alg none / HS256 is rejected', !await accepts(token({}, { alg: 'HS256' })));
const t = token({}); const [h, , s] = t.split('.');
ok('a body swapped under a valid signature is rejected', !await accepts(`${h}.${b64({ iss: 'https://accounts.google.com', aud: WANT.audience, exp: 9_999_999_999, sub: '1', email: WANT.email })}.${s}`));
ok('garbage is rejected', !await accepts('nope') && !await accepts(''));
ok('no expected account configured = rejected', await verifyGoogleIdToken(token({}), { ...WANT, email: '' }, KEYS).then(() => false, () => true));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
