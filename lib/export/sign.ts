import crypto from 'crypto';

/**
 * Signed, short-lived download links. An MCP tool cannot return a file, so it returns a URL; the URL carries
 * who asked, what they asked for and an expiry, signed with SESSION_SECRET. Nothing is stored — the workbook is
 * built when the link is opened. Whoever holds the link can download it until it expires (15 minutes by default).
 */
export type ExportKind = 'sales-leads' | 'prospects' | 'icp';
export const EXPORT_KINDS: ExportKind[] = ['sales-leads', 'prospects', 'icp'];

export interface ExportRequest { kind: ExportKind; args: Record<string, string> }
interface Payload { u: string; k: ExportKind; a: Record<string, string>; e: number }

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
function mac(body: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

export function signExport(userId: string, req: ExportRequest, ttlSeconds = 900): { token: string; expires_at: string } {
  const e = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = b64(JSON.stringify({ u: userId, k: req.kind, a: req.args, e } satisfies Payload));
  return { token: `${body}.${mac(body)}`, expires_at: new Date(e * 1000).toISOString() };
}

export function verifyExport(token: string): { userId: string; req: ExportRequest } | null {
  const [body, sig] = (token || '').split('.');
  if (!body || !sig) return null;
  const want = mac(body);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    if (!p.u || !EXPORT_KINDS.includes(p.k) || p.e < Math.floor(Date.now() / 1000)) return null;
    return { userId: p.u, req: { kind: p.k, args: p.a || {} } };
  } catch { return null; }
}

export function exportUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://salescrm.chipchip.social').replace(/\/$/, '');
  return `${base}/api/export/download?t=${token}`;
}
