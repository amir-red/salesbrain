/**
 * Run: node --experimental-strip-types --no-warnings scripts/test-signing.mts
 * The two pieces of the Telegram connect flow that decide who may do what: the HMAC-signed OAuth `state`
 * (lib/signed-state.ts) and the signed internal bridge (lib/bridge.ts). No framework: it exits non-zero on failure.
 */
import { signState, verifyState } from '../lib/signed-state.ts';
import { bridgeSign, verifyBridge } from '../lib/bridge.ts';

let failed = 0;
const ok = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed++; };
const hdr = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

process.env.SESSION_SECRET = 'a'.repeat(40);
// ── signed state ─────────────────────────────────────────────────────────────
const st = signState({ uid: 'u1', t: 't1' });
ok('state: round trip', verifyState<{ uid: string }>(st)?.uid === 'u1');
const [body, sig] = st.split('.');
const forged = Buffer.from(JSON.stringify({ uid: 'victim', t: 't1', exp: 9_999_999_999 })).toString('base64url');
ok('state: a forged body with the old signature is rejected', verifyState(`${forged}.${sig}`) === null);
ok('state: a flipped signature is rejected', verifyState(`${body}.${sig.slice(0, -2)}AA`) === null);
ok('state: expired is rejected', verifyState(signState({ uid: 'u1' }, -5)) === null);
ok('state: garbage / empty / oversized / extra dots', !verifyState('nope') && !verifyState('') && !verifyState(null) && !verifyState('x'.repeat(3000)) && !verifyState(`${st}.extra`));
process.env.SESSION_SECRET = 'b'.repeat(40);
ok('state: signed under another secret is rejected', verifyState(st) === null);
process.env.SESSION_SECRET = 'a'.repeat(40);
ok('state: the bare user id the old flow used is rejected', verifyState('u1') === null);

// ── bridge ───────────────────────────────────────────────────────────────────
const SECRET = 'k'.repeat(48);
const raw = JSON.stringify({ tool: 'export', args: { kind: 'prospects' }, actor_user_id: '00000000-0000-0000-0000-000000000001' });
const now = Date.now();
const good = (ts = String(now), b = raw, s = SECRET) => hdr({ 'x-bridge-ts': ts, 'x-bridge-sig': bridgeSign(s, ts, b) });

delete process.env.BRIDGE_SECRET;
ok('bridge: no secret configured → 503, never open', (verifyBridge(good(), raw, now) as { status: number }).status === 503);
process.env.BRIDGE_SECRET = 'short';
ok('bridge: a short secret counts as not configured', (verifyBridge(good(), raw, now) as { status: number }).status === 503);
process.env.BRIDGE_SECRET = SECRET;
ok('bridge: a correct signed request passes', verifyBridge(good(), raw, now).ok === true);
ok('bridge: the same signature again is a replay', (verifyBridge(good(), raw, now) as { reason: string }).reason === 'replayed request');
ok('bridge: tampered body rejected', !verifyBridge(good(String(now + 1), raw), raw.replace('prospects', 'icp'), now + 1).ok);
ok('bridge: wrong secret rejected', !verifyBridge(good(String(now + 2), raw, 'x'.repeat(48)), raw, now + 2).ok);
ok('bridge: stale timestamp rejected', !verifyBridge(good(String(now - 6 * 60_000)), raw, now).ok);
ok('bridge: future timestamp rejected', !verifyBridge(good(String(now + 6 * 60_000)), raw, now).ok);
ok('bridge: missing headers rejected', !verifyBridge(hdr({}), raw, now).ok);
ok('bridge: a non-hex signature is rejected, not thrown', !verifyBridge(hdr({ 'x-bridge-ts': String(now + 3), 'x-bridge-sig': 'zz' }), raw, now + 3).ok);
const withXff = (xff: string, n: number) => hdr({ 'x-bridge-ts': String(now + n), 'x-bridge-sig': bridgeSign(SECRET, String(now + n), raw), 'x-forwarded-for': xff, 'x-forwarded-host': '127.0.0.1:3002', 'x-forwarded-proto': 'http' });
ok('bridge: a public visitor address is refused even if the request is signed', (verifyBridge(withXff('1.2.3.4', 4), raw, now + 4) as { status: number }).status === 403);
ok('bridge: a public address behind a loopback hop is still refused (the FIRST entry is the visitor)', (verifyBridge(withXff('203.0.113.9, 127.0.0.1', 5), raw, now + 5) as { status: number }).status === 403);
ok('bridge: Next adds loopback forwarding headers to a direct call; that is accepted', verifyBridge(withXff('::ffff:127.0.0.1', 6), raw, now + 6).ok === true);
ok('bridge: 127.0.0.1 and ::1 are loopback too', verifyBridge(withXff('127.0.0.1', 7), raw, now + 7).ok === true && verifyBridge(withXff('::1', 8), raw, now + 8).ok === true);

if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
