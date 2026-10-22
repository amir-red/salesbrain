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

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 2047 for a header with non-ASCII text (umlauts in a subject or a name). */
function encodeHeader(v: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

function cleanHeader(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').trim();
}

export function buildMime(o: { from: string; fromName?: string | null; to: string; subject: string; body: string; inReplyTo?: string | null }): string {
  const from = o.fromName ? `${encodeHeader(cleanHeader(o.fromName))} <${cleanHeader(o.from)}>` : cleanHeader(o.from);
  const lines = [
    `From: ${from}`,
    `To: ${cleanHeader(o.to)}`,
    `Subject: ${encodeHeader(cleanHeader(o.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (o.inReplyTo) lines.push(`In-Reply-To: ${cleanHeader(o.inReplyTo)}`, `References: ${cleanHeader(o.inReplyTo)}`);
  const body = Buffer.from(o.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return `${lines.join('\r\n')}\r\n\r\n${body}`;
}

async function sender(userId: string) {
  const { rows } = await pool.query(
    `SELECT address, display_name FROM email_senders WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  return rows[0] as { address: string; display_name: string | null } | undefined;
}

export async function sendGmail(userId: string, msg: { to: string; subject: string; body: string; threadId?: string | null; inReplyTo?: string | null }):
  Promise<{ message_id: string; thread_id: string; rfc_id: string | null } | { error: string }> {
  const s = await sender(userId);
  if (!s) return { error: 'Google is not connected for sending (Profile → Google, allow sending email).' };
  const tok = await getValidAccessToken(userId);
  if (!tok) return { error: 'The Google connection stopped working (permission revoked or expired). Reconnect on Profile → Google.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.to)) return { error: `not an email address: ${msg.to}` };
  const raw = b64url(buildMime({ from: s.address, fromName: s.display_name, to: msg.to, subject: msg.subject, body: msg.body, inReplyTo: msg.inReplyTo }));
  const res = await fetch(`${GMAIL}/messages/send`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(msg.threadId ? { raw, threadId: msg.threadId } : { raw }),
  });
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

export interface ThreadMessage { id: string; from: string; subject: string; snippet: string; date: string | null; from_me: boolean }

/** The messages of the given threads (metadata + snippet only), marked whether this mailbox sent them. */
export async function readThreads(userId: string, threadIds: string[]): Promise<{ threads: { thread_id: string; messages: ThreadMessage[] }[] } | { error: string }> {
  const tok = await getValidAccessToken(userId);
  if (!tok) return { error: 'The Google connection stopped working (permission revoked or expired). Reconnect on Profile → Google.' };
  const s = await sender(userId);
  const me = (s?.address || tok.email || '').toLowerCase();
  const out: { thread_id: string; messages: ThreadMessage[] }[] = [];
  for (const id of threadIds.slice(0, 50)) {   // sequential: no fan-out against Gmail's per-user rate limit
    const r = await fetch(`${GMAIL}/threads/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${tok.accessToken}` } });
    if (r.status === 404) { out.push({ thread_id: id, messages: [] }); continue; }
    if (!r.ok) return { error: `Gmail refused reading a thread (${r.status})` };
    const t = await r.json() as { messages?: { id: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } }[] };
    out.push({
      thread_id: id,
      messages: (t.messages || []).map((m) => {
        const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
        const from = h('from');
        return {
          id: m.id, from, subject: h('subject'), snippet: unescapeHtml(m.snippet || '').slice(0, 500),
          date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
          from_me: (m.labelIds || []).includes('SENT') || (!!me && from.toLowerCase().includes(me)),
        };
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
export async function watchMailbox(userId: string): Promise<{ history_id?: string; expires_at?: string; skipped?: string } | { error: string }> {
  const topic = process.env.GMAIL_PUSH_TOPIC;
  if (!topic) return { skipped: 'GMAIL_PUSH_TOPIC is not set' };
  const tok = await getValidAccessToken(userId);
  if (!tok) return { error: 'Google is not connected (or the connection stopped working). Reconnect on Profile → Google.' };
  const res = await fetch(`${GMAIL}/watch`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicName: topic, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' }),
  });
  if (!res.ok) return { error: `Gmail refused the watch (${res.status}): ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}` };
  const out = await res.json() as { historyId?: string; expiration?: string };
  return { history_id: out.historyId, expires_at: out.expiration ? new Date(Number(out.expiration)).toISOString() : undefined };
}
