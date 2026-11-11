/**
 * Send from a person's own Gmail and read the threads we sent (email waves, core 076). Server-only.
 *
 * The ring decides WHAT and WHEN (kernel send gate, outbox pacing) and reaches this through the signed bridge
 * (lib/bridge-tools.ts: gmail_send, gmail_threads); only the app holds the OAuth tokens. Plain text, UTF-8, the
 * person's display name in From, follow-ups threaded (threadId + In-Reply-To / References) so the recipient sees one
 * conversation. Never logs a body or a token.
 */
import pool from '@/lib/db';
import { getValidAccessToken } from '@/lib/google-oauth';
import { filesForSend } from '@/lib/message-files';
import { buildMime, type MimeFile } from '@/lib/gmail-mime';

export { buildMime };

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** One of the person's sending mailboxes (core 102): `mailbox` when given, else their default. */
async function sender(userId: string, mailbox?: string | null) {
  const { rows } = await pool.query(
    mailbox
      ? `SELECT address, display_name FROM email_senders WHERE user_id = $1 AND lower(address) = lower($2) AND revoked_at IS NULL`
      : `SELECT address, display_name FROM email_senders WHERE user_id = $1 AND revoked_at IS NULL
          ORDER BY is_default DESC, connected_at LIMIT 1`,
    mailbox ? [userId, mailbox] : [userId]);
  return rows[0] as { address: string; display_name: string | null } | undefined;
}

export async function sendGmail(userId: string, msg: { to: string; subject: string; body: string; threadId?: string | null; inReplyTo?: string | null; mailbox?: string | null; attachments?: string[] }):
  Promise<{ message_id: string; thread_id: string; rfc_id: string | null } | { error: string }> {
  const s = await sender(userId, msg.mailbox);
  if (!s) return { error: msg.mailbox ? `${msg.mailbox} is not connected for sending (Profile → Google, allow sending email).`
    : 'Google is not connected for sending (Profile → Google, allow sending email).' };
  const tok = await getValidAccessToken(userId, 'google', s.address);
  if (!tok) return { error: 'The Google connection stopped working (permission revoked or expired). Reconnect on Profile → Google.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.to)) return { error: `not an email address: ${msg.to}` };
  let files: MimeFile[] = [];
  if (msg.attachments?.length) {
    const got = await filesForSend(userId, msg.attachments);
    if ('error' in got) return { error: got.error };
    files = got;
  }
  const mime = buildMime({ from: s.address, fromName: s.display_name, to: msg.to, subject: msg.subject, body: msg.body, inReplyTo: msg.inReplyTo, files });
  let res: Response;
  if (!files.length) {
    const raw = b64url(mime);
    res = await fetch(`${GMAIL}/messages/send`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.threadId ? { raw, threadId: msg.threadId } : { raw }),
    });
  } else {
    // A message with files goes through Gmail's upload endpoint (up to 35 MB; the JSON form is meant for small mail):
    // multipart/related = the metadata (thread) + the message itself.
    const b = `sbup_${Date.now().toString(36)}`;
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(msg.threadId ? { threadId: msg.threadId } : {})}\r\n`
        + `--${b}\r\nContent-Type: message/rfc822\r\n\r\n`),
      Buffer.from(mime, 'utf8'),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    res = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', {
      method: 'POST', headers: { Authorization: `Bearer ${tok.accessToken}`, 'Content-Type': `multipart/related; boundary=${b}` },
      body,
    });
  }
  if (!res.ok) {
    const detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
    return { error: `Gmail refused the send (${res.status}): ${detail}` };
  }
  const sent = await res.json() as { id: string; threadId: string };
  // The Message-ID header Gmail assigned: a follow-up's In-Reply-To.
  let rfc: string | null = null;
  try {
    const m = await fetch(`${GMAIL}/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`, { headers: { Authorization: `Bearer ${tok.accessToken}` } });
    if (m.ok) {
      const j = await m.json() as { payload?: { headers?: { name: string; value: string }[] } };
      rfc = j.payload?.headers?.find((h) => h.name.toLowerCase() === 'message-id')?.value ?? null;
    }
  } catch { /* threading still works through threadId */ }
  return { message_id: sent.id, thread_id: sent.threadId, rfc_id: rfc };
}

function unescapeHtml(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export interface ThreadMessage {
  id: string; from: string; subject: string; snippet: string; date: string | null; from_me: boolean;
  /** with `full`: the plain-text body (quoted history cut off), To and the Message-ID header */
  body?: string; to?: string; cc?: string; rfc_id?: string | null;
  /** with `full`: the message's files (core 104) — Gmail part ids, fetched on download */
  attachments?: { part_id: string; name: string; mime: string | null; size: number | null }[];
  /** with `full`: the headers mail systems set on an automatic reply (out of office) — the kernel reads them */
  auto_headers?: Record<string, string>;
}

import { htmlToText, stripQuoted } from '@/lib/email-text';

type GmailPart = {
  partId?: string; mimeType?: string; filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[];
};

/**
 * The files of one Gmail message: every part with a file name. An inline image with a Content-ID (a logo in a
 * signature) is left out — it is part of the mail's look, not something someone sent.
 */
export function fileParts(p: GmailPart | undefined, out: { part_id: string; name: string; mime: string | null; size: number | null }[] = []) {
  if (!p) return out;
  if (p.filename && p.partId && (p.body?.attachmentId || p.body?.data)) {
    const h = (n: string) => p.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
    const inlineLogo = /^inline/i.test(h('content-disposition')) && !!h('content-id') && /^image\//i.test(p.mimeType || '');
    if (!inlineLogo) out.push({ part_id: p.partId, name: p.filename, mime: p.mimeType || null, size: p.body?.size ?? null });
  }
  for (const c of p.parts || []) fileParts(c, out);
  return out;
}

function findById(p: GmailPart | undefined, partId: string): GmailPart | null {
  if (!p) return null;
  if (p.partId === partId) return p;
  for (const c of p.parts || []) { const hit = findById(c, partId); if (hit) return hit; }
  return null;
}

/** The bytes of one file of a Gmail message (the part is found again: Gmail's attachment ids change between reads). */
export async function gmailFile(userId: string, mailbox: string | null, gmailMessageId: string, partId: string):
  Promise<{ name: string; mime: string; content: Buffer } | { error: string }> {
  const tok = await getValidAccessToken(userId, 'google', mailbox);
  if (!tok) return { error: 'The Google connection for this mailbox stopped working. Reconnect it on Profile → Google.' };
  const auth = { headers: { Authorization: `Bearer ${tok.accessToken}` } };
  const r = await fetch(`${GMAIL}/messages/${encodeURIComponent(gmailMessageId)}?format=full`, auth);
  if (!r.ok) return { error: `Gmail refused reading the message (${r.status})` };
  const m = await r.json() as { payload?: GmailPart };
  const part = findById(m.payload, partId);
  if (!part) return { error: 'This file is no longer in the message.' };
  let data = part.body?.data;
  if (!data && part.body?.attachmentId) {
    const a = await fetch(`${GMAIL}/messages/${encodeURIComponent(gmailMessageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, auth);
    if (!a.ok) return { error: `Gmail refused the file (${a.status})` };
    data = ((await a.json()) as { data?: string }).data;
  }
  if (!data) return { error: 'Gmail returned no file.' };
  return { name: part.filename || 'file', mime: part.mimeType || 'application/octet-stream', content: Buffer.from(data, 'base64url') };
}

function decodePart(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function findPart(p: GmailPart | undefined, mime: string): string | null {
  if (!p) return null;
  if (p.mimeType === mime && p.body?.data) return decodePart(p.body.data);
  for (const c of p.parts || []) {
    const hit = findPart(c, mime);
    if (hit != null) return hit;
  }
  return null;
}

type GmailMessage = {
  id: string; labelIds?: string[]; snippet?: string; internalDate?: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
};

/**
 * The messages of the given threads, marked whether this mailbox sent them. Metadata + snippet by default; with
 * `full` also the plain-text body (from text/plain, else the HTML part flattened), To and Message-ID — what the
 * Inbox stores (core 082).
 */
export async function readThreads(userId: string, threadIds: string[], opts: { full?: boolean; mailbox?: string | null } = {}):
  Promise<{ threads: { thread_id: string; messages: ThreadMessage[] }[] } | { error: string }> {
  const tok = await getValidAccessToken(userId, 'google', opts.mailbox);
  if (!tok) return { error: 'The Google connection stopped working (permission revoked or expired). Reconnect on Profile → Google.' };
  const me = (opts.mailbox || tok.email || (await sender(userId))?.address || '').toLowerCase();
  const out: { thread_id: string; messages: ThreadMessage[] }[] = [];
  const q = opts.full ? 'format=full'
    : 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
  for (const id of threadIds.slice(0, 50)) {   // sequential: no fan-out against Gmail's per-user rate limit
    let r = await fetch(`${GMAIL}/threads/${encodeURIComponent(id)}?${q}`,
      { headers: { Authorization: `Bearer ${tok.accessToken}` } });
    // Gmail's per-user, per-minute quota (403 rateLimitExceeded / 429): wait once, then give up for this run.
    if (r.status === 429 || r.status === 403) {
      const body = await r.text();
      if (r.status === 429 || /rateLimitExceeded|userRateLimitExceeded|Quota exceeded/i.test(body)) {
        await new Promise((ok) => setTimeout(ok, 20_000));
        r = await fetch(`${GMAIL}/threads/${encodeURIComponent(id)}?${q}`, { headers: { Authorization: `Bearer ${tok.accessToken}` } });
      } else {
        return { error: `Gmail refused reading a thread (${r.status}): ${body.replace(/\s+/g, ' ').slice(0, 160)}` };
      }
    }
    if (r.status === 404) { out.push({ thread_id: id, messages: [] }); continue; }
    if (!r.ok) return { error: `Gmail refused reading a thread (${r.status}${r.status === 403 || r.status === 429 ? ', rate limit' : ''})` };
    const t = await r.json() as { messages?: GmailMessage[] };
    out.push({
      thread_id: id,
      messages: (t.messages || []).map((m) => {
        const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
        const from = h('from');
        const msg: ThreadMessage = {
          id: m.id, from, subject: h('subject'), snippet: unescapeHtml(m.snippet || '').slice(0, 500),
          date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
          from_me: (m.labelIds || []).includes('SENT') || (!!me && from.toLowerCase().includes(me)),
        };
        if (opts.full) {
          const plain = findPart(m.payload, 'text/plain');
          const html = plain == null ? findPart(m.payload, 'text/html') : null;
          msg.body = stripQuoted(plain ?? (html != null ? htmlToText(html) : msg.snippet)).slice(0, 20000);
          msg.to = h('to');
          msg.cc = h('cc');
          msg.rfc_id = h('message-id') || null;
          msg.attachments = fileParts(m.payload).slice(0, 20);
          const auto: Record<string, string> = {};
          for (const name of ['auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence', 'x-auto-response-suppress']) {
            const v = h(name);
            if (v) auto[name] = v;
          }
          msg.auto_headers = auto;
        }
        return msg;
      }),
    });
  }
  return { threads: out };
}

/**
 * Ask Gmail to tell us (Cloud Pub/Sub topic GMAIL_PUSH_TOPIC) whenever this mailbox's inbox changes — near-instant reply
 * detection (/api/gmail/push). Google ends a watch after 7 days; calling again renews it, so the reply job and a new
 * Google connection simply call this. `{ skipped }` when no topic is configured.
 */
/** Delete (to Gmail's Bin) or Mark as spam (to Gmail's Spam folder) one thread, from the Inbox (core 107). Needs the
 *  `gmail.modify` permission: a connection made before 2026-11-11 lacks it and gets `needs_reconnect`. */
export async function moveGmailThread(userId: string, mailbox: string | null, threadId: string, to: 'trash' | 'spam'):
  Promise<{ ok: true } | { needs_reconnect: true; mailbox: string | null } | { error: string }> {
  const { rows } = await pool.query<{ scopes: string[] | null }>(
    `SELECT scopes FROM oauth_tokens WHERE user_id = $1 AND provider = 'google'
       AND ($2::text IS NULL OR lower(account_email) = lower($2)) ORDER BY created_at LIMIT 1`, [userId, mailbox]);
  if (!rows[0]?.scopes?.includes('gmail.modify')) return { needs_reconnect: true, mailbox };
  const tok = await getValidAccessToken(userId, 'google', mailbox);
  if (!tok) return { error: 'Google is not connected (or the connection stopped working). Reconnect on Profile → Google.' };
  const url = to === 'trash' ? `${GMAIL}/threads/${encodeURIComponent(threadId)}/trash` : `${GMAIL}/threads/${encodeURIComponent(threadId)}/modify`;
  const res = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${tok.accessToken}`, 'Content-Type': 'application/json' },
    body: to === 'trash' ? undefined : JSON.stringify({ addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] }),
  });
  if (res.status === 403) return { needs_reconnect: true, mailbox };
  if (!res.ok) return { error: `Gmail refused (${res.status}): ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}` };
  return { ok: true };
}

export async function watchMailbox(userId: string, mailbox?: string | null): Promise<{ history_id?: string; expires_at?: string; skipped?: string } | { error: string }> {
  const topic = process.env.GMAIL_PUSH_TOPIC;
  if (!topic) return { skipped: 'GMAIL_PUSH_TOPIC is not set' };
  const tok = await getValidAccessToken(userId, 'google', mailbox);
  if (!tok) return { error: 'Google is not connected (or the connection stopped working). Reconnect on Profile → Google.' };
  const res = await fetch(`${GMAIL}/watch`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicName: topic, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' }),
  });
  if (!res.ok) return { error: `Gmail refused the watch (${res.status}): ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}` };
  const out = await res.json() as { historyId?: string; expiration?: string };
  return { history_id: out.historyId, expires_at: out.expiration ? new Date(Number(out.expiration)).toISOString() : undefined };
}

/**
 * Everything in one account's Primary inbox since `since` (core 102, "everything in those inboxes"): the threads with a
 * message newer than that, each with ALL its messages (bodies as readThreads `full`). Promotions / Social / Updates
 * stay out (the other categories are excluded). `newest` = the newest message time seen — where the next read starts. Sequential reads,
 * at most `max` threads.
 */
export async function listInboxThreads(userId: string, mailbox: string, since: string, max = 50):
  Promise<{ threads: { thread_id: string; messages: ThreadMessage[] }[]; newest: string | null; partial?: boolean; error?: string } | { error: string }> {
  const tok = await getValidAccessToken(userId, 'google', mailbox);
  if (!tok) return { error: `The Google connection for ${mailbox} stopped working. Reconnect it on Profile → Google.` };
  const after = Math.max(0, Math.floor(new Date(since).getTime() / 1000) - 60);
  // Not `category:primary`: a Workspace mailbox without inbox tabs never carries that label (live 2026-11-06: 0 threads
  // for both accounts). Leaving out the other categories works with tabs on or off.
  const q = `in:inbox -category:promotions -category:social -category:updates -category:forums after:${after}`;
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${GMAIL}/threads?q=${encodeURIComponent(q)}&maxResults=${Math.min(100, max)}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok.accessToken}` } });
    if (!r.ok) return { error: `Gmail refused listing the inbox (${r.status})` };
    const j = await r.json() as { threads?: { id: string }[]; nextPageToken?: string };
    for (const t of j.threads || []) if (ids.length < max) ids.push(t.id);
    pageToken = ids.length < max ? j.nextPageToken : undefined;
  } while (pageToken);
  if (!ids.length) return { threads: [], newest: null };
  // readThreads reads at most 50 threads a call: batches, so a first read of up to 200 loses none.
  const threads: { thread_id: string; messages: ThreadMessage[] }[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const read = await readThreads(userId, ids.slice(i, i + 50), { full: true, mailbox });
    if ('error' in read) {
      if (!threads.length) return read;
      // Stopped partway (usually Gmail's per-minute limit): keep what was read; `partial` tells the caller NOT to move
      // its cursor, so the next run reads the rest (what is stored already is not stored twice).
      return { threads, newest: null, partial: true, error: read.error };
    }
    threads.push(...read.threads);
  }
  let newest: string | null = null;
  for (const t of threads) for (const m of t.messages) if (m.date && (!newest || m.date > newest)) newest = m.date;
  return { threads, newest };
}
