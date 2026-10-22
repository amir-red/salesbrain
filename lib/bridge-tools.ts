/**
 * What the bridge can do for a person. Each tool re-checks visibility itself (the builders already scope
 * exports to the person); nothing here trusts an argument for identity. Server-only.
 *
 * Deliberately NOT here: creating an MCP token. Its raw value would travel through the model provider and the
 * chat transcript; creation stays on the Profile → MCP page. Listing and revoking carry no secret and are here.
 */
import pool from '@/lib/db';
import { getValidAccessToken } from '@/lib/google-oauth';
import { runGoogleSync } from '@/lib/google-sync';
import { importContactsText, MAX_CSV_BYTES } from '@/lib/imports/contacts';
import { buildExport, cleanArgs } from '@/lib/export/build';
import { EXPORT_KINDS, exportUrl, signExport, type ExportKind } from '@/lib/export/sign';
import { listUserTokens, revokeToken } from '@/lib/mcp/tokens';
import { sendTelegram } from '@/lib/tg-notify';
import { syncZeamiDealEvents } from '@/lib/zeami-sync';
import { readThreads, sendGmail, watchMailbox } from '@/lib/gmail-send';

export interface Who { userId: string; role: string }
const MAX_XLSX_BYTES = 20 * 1024 * 1024;

type Args = Record<string, unknown>;

async function googleSync(who: Who, args: Args) {
  if (!(await getValidAccessToken(who.userId))) {
    return { error: 'Google is not connected for this person. Connect it first (crm_connect_start with provider google).' };
  }
  const mode = ['contacts', 'messages', 'both'].includes(String(args.mode)) ? String(args.mode) : 'contacts';
  const chat = args.chat_id ? String(args.chat_id) : null;
  // A big address book takes minutes: answer now, report in the chat when it is done.
  void runGoogleSync(who.userId, { mode, max: Number(args.max) || undefined })
    .then((out) => sendTelegram(chat, 'error' in out ? `⚠️ The Google sync did not run: ${out.error}`
      : `📇 Google ${mode} sync finished: ${out.contacts_imported} new contact(s), ${out.messages_imported} message(s)`
        + `${out.replies_recorded ? `, ${out.replies_recorded} reply(ies) recorded` : ''}`
        + `${out.errors ? `. ${out.errors} problem(s), e.g. ${out.error_messages[0] ?? ''}` : '.'}`))
    .catch(() => undefined);
  return { started: true, mode, reports_to_chat: Boolean(chat),
           note: 'Running in the background. The result is sent to the chat when it finishes.' };
}

async function importContacts(who: Who, args: Args) {
  const filename = String(args.filename || 'contacts.csv');
  if (!/\.(csv|txt)$/i.test(filename)) return { error: 'Send a .csv file (the Connections.csv from a LinkedIn data export).' };
  const bytes = Buffer.from(String(args.content_b64 || ''), 'base64');
  if (bytes.length === 0) return { error: 'The file is empty.' };
  if (bytes.length > MAX_CSV_BYTES) return { error: `The file is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is 10 MB.` };
  const text = bytes.toString('utf8').replace(/^﻿/, '');
  const source = args.source === 'generic_csv' ? 'generic_csv' : 'linkedin_csv';
  const { status, body } = await importContactsText(who.userId, text, source);
  return status === 200 ? { ok: true, ...body } : { ok: false, ...body };
}

async function exportFile(who: Who, args: Args) {
  const kind = String(args.kind || '') as ExportKind;
  if (!EXPORT_KINDS.includes(kind)) return { error: `kind must be one of ${EXPORT_KINDS.join(', ')}` };
  const clean = cleanArgs(kind, (args.filters as Args) || {});
  const built = await buildExport({ kind, args: clean }, who);
  if (built.buffer.length > MAX_XLSX_BYTES) return { error: 'That export is too large to send in chat. Narrow it with a filter, or use the download link.' };
  const { token, expires_at } = signExport(who.userId, { kind, args: clean });
  return { filename: built.filename, rows: built.rows, sheets: built.sheets, file_b64: built.buffer.toString('base64'),
           download_url: exportUrl(token), expires_at };
}

async function mcpTokens(who: Who, args: Args) {
  if (args.action === 'revoke') {
    const ok = await revokeToken(String(args.id || ''), who.userId);
    return ok ? { revoked: true } : { error: 'No such token of yours.' };
  }
  const rows = await listUserTokens(who.userId);
  return { tokens: rows.map((t) => ({ id: t.id, name: t.name, prefix: t.token_prefix, last_used_at: t.last_used_at, created_at: t.created_at })),
           note: 'Creating a token is done on Profile → MCP: its secret is shown once and must not pass through a chat.' };
}

/** The `zeami-deal-sync` cron job: tell Zeami about won sales deals and sales-rep changes (lib/zeami-sync.ts).
 *  Org-wide, so admins (and the service user the job runs as) only. */
async function zeamiDealSync(who: Who, args: Args) {
  if (who.role !== 'admin') return { error: 'Only an administrator can run the Zeami deal sync.' };
  return { ...(await syncZeamiDealEvents({ dryRun: Boolean(args.dry_run) })) };
}

// Email waves (core 076): the ring's outbox has already passed the kernel send gate for this email; this only delivers
// it from the person's own Gmail. The person is the bridge actor, so nobody can send from someone else's mailbox.
async function gmailSendTool(who: Who, args: Args) {
  return sendGmail(who.userId, {
    to: String(args.to || ''), subject: String(args.subject || ''), body: String(args.body || ''),
    threadId: args.thread_id ? String(args.thread_id) : null, inReplyTo: args.in_reply_to ? String(args.in_reply_to) : null,
  });
}

async function gmailThreadsTool(who: Who, args: Args) {
  const ids = Array.isArray(args.thread_ids) ? args.thread_ids.map(String).filter(Boolean) : [];
  if (!ids.length) return { threads: [] };
  return readThreads(who.userId, ids);
}

/** Start / renew Gmail push for this person's mailbox (the reply job calls it for every sender). */
async function gmailWatchTool(who: Who) {
  return watchMailbox(who.userId);
}

const TOOLS: Record<string, (who: Who, args: Args) => Promise<Record<string, unknown>>> = {
  google_sync: googleSync,
  import_contacts: importContacts,
  export: exportFile,
  mcp_tokens: mcpTokens,
  zeami_deal_sync: zeamiDealSync,
  gmail_send: gmailSendTool,
  gmail_threads: gmailThreadsTool,
  gmail_watch: gmailWatchTool,
};

export async function runBridgeTool(tool: string, args: Args, userId: string): Promise<Record<string, unknown>> {
  const fn = TOOLS[tool];
  if (!fn) return { error: `unknown bridge tool '${tool}'` };
  const { rows } = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return { error: 'unknown user' };
  try {
    return await fn({ userId, role: rows[0].role }, args);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'bridge tool failed' };
  }
}
