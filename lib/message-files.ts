/**
 * Files in the Inbox (core 104), server-only: uploads kept in `message_files` until they go out with a message, and
 * the same limits the kernel enforces (salesbrain_core/policy/message_files.py — change both).
 *
 * The bytes live in Postgres because two processes read them: the app (it builds the Gmail message) and the Hermes
 * ring (it hands LinkedIn / WhatsApp files to Unipile). Received files are not stored: they are fetched from Gmail /
 * Unipile when someone opens one (app/api/inbox/attachment/...).
 */
import crypto from 'crypto';
import pool from '@/lib/db';

export const MAX_FILES = 5;
export const MAX_FILE = 15 * 1024 * 1024;
export const MAX_TOTAL = 15 * 1024 * 1024;

const BLOCKED_EXT = new Set(['ade', 'adp', 'apk', 'appx', 'bat', 'cab', 'chm', 'cmd', 'com', 'cpl', 'dll', 'dmg', 'exe', 'hta',
  'ins', 'isp', 'jar', 'js', 'jse', 'lib', 'lnk', 'mde', 'msc', 'msi', 'msp', 'mst', 'nsh', 'pif', 'ps1', 'scr', 'sct', 'shb',
  'sys', 'vb', 'vbe', 'vbs', 'vxd', 'wsc', 'wsf', 'wsh']);

export function humanSize(n: number | null | undefined): string {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

export function safeName(name: string | null | undefined, fallback = 'file'): string {
  // eslint-disable-next-line no-control-regex
  let n = String(name || '').replace(/\\/g, '/').split('/').pop()!.replace(/[\x00-\x1f\x7f]+/g, '').trim().replace(/^\.+|\.+$/g, '');
  if (!n) n = fallback;
  if (n.length > 180) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 ? n.slice(dot + 1) : '';
    n = ext && ext.length <= 8 ? `${n.slice(0, 170 - ext.length)}.${ext}` : n.slice(0, 180);
  }
  return n;
}

export function refuseFile(name: string, size: number): string | null {
  if (size <= 0) return `${name} is empty.`;
  if (size > MAX_FILE) return `${name} is ${humanSize(size)} — a file can be at most ${humanSize(MAX_FILE)}.`;
  const dot = name.lastIndexOf('.');
  if (dot > 0 && BLOCKED_EXT.has(name.slice(dot + 1).toLowerCase())) return `${name}: programs and scripts cannot be sent.`;
  return null;
}

export interface StoredFile { id: string; name: string; mime: string; size: number }

/** Keep one upload of `userId`; unsent uploads older than a day are cleared on the way. */
export async function storeUpload(userId: string, name: string, mime: string | null, content: Buffer): Promise<StoredFile | { error: string }> {
  const clean = safeName(name);
  const why = refuseFile(clean, content.length);
  if (why) return { error: why };
  const type = (mime || '').trim() || 'application/octet-stream';
  const sha = crypto.createHash('sha256').update(content).digest('hex');
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM message_files WHERE approval_id IS NULL AND owner_user_id = $1 AND created_at < now() - interval '1 day'`, [userId]);
    const { rows } = await client.query(
      `INSERT INTO message_files (owner_user_id, file_name, mime_type, size_bytes, sha256, content)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`, [userId, clean, type.slice(0, 120), content.length, sha, content]);
    return { id: rows[0].id, name: clean, mime: type, size: content.length };
  } finally {
    client.release();
  }
}

/** Remove one of your own uploads that has not been sent. */
export async function dropUpload(userId: string, id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM message_files WHERE id = $1 AND owner_user_id = $2 AND approval_id IS NULL`, [id, userId]);
  return (r.rowCount || 0) > 0;
}

/** One stored file with its bytes, for its uploader (or an administrator: they can read every conversation). */
export async function readFile(id: string, viewer: { userId: string; admin: boolean }):
  Promise<{ name: string; mime: string; content: Buffer } | null> {
  const { rows } = await pool.query(
    `SELECT file_name, mime_type, content, owner_user_id::text AS owner FROM message_files WHERE id = $1`, [id]);
  const r = rows[0];
  if (!r || (r.owner !== viewer.userId && !viewer.admin)) return null;
  return { name: r.file_name, mime: r.mime_type, content: r.content as Buffer };
}

/** The files a Gmail send carries: the sender's own uploads, in the order given. */
export async function filesForSend(userId: string, ids: string[]): Promise<{ name: string; mime: string; content: Buffer }[] | { error: string }> {
  const want = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_FILES);
  if (!want.length) return [];
  const { rows } = await pool.query(
    `SELECT id::text, file_name, mime_type, content FROM message_files WHERE id = ANY($1::uuid[]) AND owner_user_id = $2`, [want, userId]);
  const by = new Map(rows.map((r) => [r.id as string, r]));
  if (want.some((id) => !by.has(id))) return { error: 'a file to send is missing (or belongs to someone else)' };
  return want.map((id) => { const r = by.get(id)!; return { name: r.file_name, mime: r.mime_type, content: r.content as Buffer }; });
}

/**
 * Headers for a file going to the browser. Only real images are shown inline; everything else downloads, and nothing
 * is sniffed (an uploaded .html must never run on our origin).
 */
export function fileHeaders(name: string, mime: string | null, size: number, inline: boolean): Record<string, string> {
  const type = (mime || 'application/octet-stream').toLowerCase();
  const showable = inline && /^image\/(png|jpe?g|gif|webp|heic|heif)$/.test(type);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, "'");
  return {
    'Content-Type': showable ? type : (type.startsWith('text/html') || type.includes('svg') || type.includes('xml') ? 'application/octet-stream' : type),
    'Content-Length': String(size),
    'Content-Disposition': `${showable ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; sandbox",
    'Cache-Control': 'private, max-age=3600',
  };
}
