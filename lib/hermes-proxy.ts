/**
 * Hermes web-chat proxy — bridges the existing Chat UI to the Hermes
 * api_server (Relationship OS, Phase 1b).
 *
 * Server-only. Holds API_SERVER_KEY; the browser never talks to Hermes.
 * Contracts verified against the pinned Hermes v2026.7.20 source
 * (gateway/platforms/api_server.py):
 *   POST /api/sessions                     {id?, title?}    → 201 (409 = exists)
 *   POST /api/sessions/{id}/chat/stream    {message}        → SSE `event:`/`data:` frames:
 *        assistant.delta{delta} · tool.started{tool_name,args,preview} ·
 *        tool.completed{tool_name,preview} · tool.failed · error{message} · done
 *   GET  /api/sessions/{id}/messages                        → {data:[{role,content,...}]}
 *
 * Session identity: one Hermes session per (user, deal), recorded in
 * agent_sessions (migration 020) — the ring's tool_request middleware reads
 * that table to thread acting identity (RBAC) into every crm_* tool call.
 */

import pool from './db';

const HERMES_URL = process.env.HERMES_API_URL || 'http://127.0.0.1:8642';
const HERMES_KEY = process.env.HERMES_API_KEY || '';

function authHeaders(): Record<string, string> {
  return HERMES_KEY ? { Authorization: `Bearer ${HERMES_KEY}` } : {};
}

/** Find-or-create the Hermes session for (user, deal); record the mapping. */
export async function ensureAgentSession(userId: string, dealId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT hermes_session_id FROM agent_sessions
     WHERE user_id = $1 AND deal_id = $2 AND channel = 'web'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, dealId]
  );
  if (rows[0]) {
    void pool.query(
      `UPDATE agent_sessions SET last_seen_at = now() WHERE hermes_session_id = $1`,
      [rows[0].hermes_session_id]
    );
    return rows[0].hermes_session_id;
  }

  const sessionId = `web_${userId.slice(0, 8)}_${dealId.slice(0, 8)}_${Date.now().toString(36)}`;
  const res = await fetch(`${HERMES_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ id: sessionId, title: `web chat ${sessionId}` }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`Hermes session create failed: HTTP ${res.status}`);
  }
  await pool.query(
    `INSERT INTO agent_sessions (hermes_session_id, user_id, deal_id, channel)
     VALUES ($1, $2, $3, 'web')
     ON CONFLICT (hermes_session_id) DO NOTHING`,
    [sessionId, userId, dealId]
  );
  return sessionId;
}

/** Legacy NDJSON event union the Chat UI consumes (components/Chat.tsx). */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; tool: string; tool_input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; tool_output: Record<string, unknown> }
  | { type: 'error'; error: string }
  | { type: 'done' };

/** Load extracted text for attachments (Phase 1 text-only parity). */
export async function attachmentTextBlock(attachmentIds: string[] | undefined, dealId: string): Promise<string> {
  if (!attachmentIds?.length) return '';
  const { rows } = await pool.query(
    `SELECT filename, extracted_text FROM file_attachments
     WHERE id = ANY($1::uuid[]) AND deal_id = $2`,
    [attachmentIds, dealId]
  );
  const parts = rows
    .filter((r) => r.extracted_text)
    .map((r) => `--- Attachment: ${r.filename} ---\n${String(r.extracted_text).slice(0, 30000)}`);
  const skipped = rows.filter((r) => !r.extracted_text).map((r) => r.filename);
  let block = parts.length ? `\n\n${parts.join('\n\n')}` : '';
  if (skipped.length) {
    block += `\n\n[Note: ${skipped.join(', ')} attached but not text-extractable — image/PDF passthrough lands in a later phase.]`;
  }
  return block;
}

/** Run one turn against Hermes and translate its SSE into ChatEvents. */
export async function* streamHermesTurn(sessionId: string, message: string): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${HERMES_URL}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ message }),
  });
  if (!res.ok || !res.body) {
    yield { type: 'error', error: `Hermes chat failed: HTTP ${res.status}` };
    return;
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const event = parseSseFrame(frame);
        if (!event) continue; // keepalive comment or empty
        const mapped = translate(event.name, event.data);
        if (mapped) yield mapped;
        if (event.name === 'done') return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame(frame: string): { name: string; data: Record<string, unknown> } | null {
  let name = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // keepalive
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { name, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

function translate(name: string, d: Record<string, unknown>): ChatEvent | null {
  switch (name) {
    case 'assistant.delta':
      return d.delta ? { type: 'text', text: String(d.delta) } : null;
    case 'tool.started':
      return {
        type: 'tool_start',
        tool: String(d.tool_name || 'tool'),
        tool_input: (d.args as Record<string, unknown>) ?? (d.preview ? { preview: d.preview } : {}),
      };
    case 'tool.completed':
      return {
        type: 'tool_result',
        tool: String(d.tool_name || 'tool'),
        tool_output: d.preview !== undefined && d.preview !== null ? { preview: d.preview } : {},
      };
    case 'tool.failed':
      return {
        type: 'tool_result',
        tool: String(d.tool_name || 'tool'),
        tool_output: { error: String(d.preview || 'tool failed') },
      };
    case 'error':
      return { type: 'error', error: String(d.message || 'Hermes error') };
    case 'done':
      return { type: 'done' };
    default:
      return null; // run.started / message.started / tool.progress / assistant.completed / run.completed
  }
}

/** Hydration: map Hermes session messages to the legacy conversations shape. */
export async function fetchHermesHistory(
  sessionId: string
): Promise<Array<{ role: string; content: string; tool_name: null; created_at: null }>> {
  const res = await fetch(`${HERMES_URL}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
  return (body.data || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
    .map((m) => ({ role: String(m.role), content: String(m.content), tool_name: null, created_at: null }));
}
