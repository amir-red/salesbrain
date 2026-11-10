/**
 * Minimal Unipile client for the app's connection flow.
 *
 * The app only needs the two calls the browser drives: mint a hosted-auth link,
 * and list accounts so a freshly-connected one can be claimed by the session
 * user. Everything else LinkedIn-related runs in the Hermes ring, which owns
 * the sync, policy, and sending paths.
 */

type UnipileResult = Record<string, unknown> & { error?: string };

function base(): string | null {
  const dsn = (process.env.UNIPILE_DSN || '').trim();
  if (!dsn) return null;
  return (dsn.startsWith('http') ? dsn : `https://${dsn}`).replace(/\/$/, '');
}

export async function unipileFetch(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<UnipileResult> {
  const root = base();
  const key = process.env.UNIPILE_API_KEY;
  if (!root || !key) return { error: 'UNIPILE_DSN / UNIPILE_API_KEY not configured' };

  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : '';
  const headers: Record<string, string> = { 'X-API-KEY': key, accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  try {
    const res = await fetch(`${root}/api/v1/${path.replace(/^\//, '')}${qs}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) return { error: `unipile ${res.status}: ${text.slice(0, 200)}` };
    return data;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unipile request failed' };
  }
}

export interface UnipileAccount {
  id: string;
  type?: string;
  name?: string;
  created_at?: string;
  connection_params?: { im?: Record<string, unknown> };
}

async function listAccounts(type: 'LINKEDIN' | 'WHATSAPP'): Promise<UnipileAccount[] | { error: string }> {
  const res = await unipileFetch('accounts');
  if (res.error) return { error: res.error };
  const items = (res.items as UnipileAccount[]) || [];
  return items.filter((a) => a.type === type);
}

export function listLinkedInAccounts(): Promise<UnipileAccount[] | { error: string }> {
  return listAccounts('LINKEDIN');
}

/** WhatsApp accounts connected through Unipile's hosted auth (core 100: replies from the Inbox). */
export function listWhatsAppAccounts(): Promise<UnipileAccount[] | { error: string }> {
  return listAccounts('WHATSAPP');
}

/**
 * The bytes of one file on a LinkedIn / WhatsApp message (core 104: the Inbox keeps only the reference). Unipile
 * serves it from the account that holds the conversation, on its message id.
 */
export async function unipileFile(messageId: string, attachmentId: string):
  Promise<{ mime: string; content: Buffer } | { error: string }> {
  const root = base();
  const key = process.env.UNIPILE_API_KEY;
  if (!root || !key) return { error: 'UNIPILE_DSN / UNIPILE_API_KEY not configured' };
  try {
    const res = await fetch(`${root}/api/v1/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      headers: { 'X-API-KEY': key, accept: '*/*' }, cache: 'no-store', signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { error: `unipile ${res.status}: ${(await res.text()).slice(0, 160)}` };
    return { mime: res.headers.get('content-type') || 'application/octet-stream', content: Buffer.from(await res.arrayBuffer()) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unipile request failed' };
  }
}
