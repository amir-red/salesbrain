/**
 * MCP audit logging — one row per tool invocation.
 *
 * Fire-and-forget: caller passes what it knows and moves on. If the
 * insert fails we log a warning but never crash the request path.
 *
 * The `input` payload is stored verbatim except:
 *   - String fields longer than 1000 chars get truncated (long notes,
 *     descriptions, meeting transcripts don't need to live twice in DB)
 *   - We don't strip anything else — names, emails, deal contents are
 *     already what the tool operates on, so hiding them here provides
 *     no meaningful privacy while making debugging harder.
 */

import pool from '../db';

const MAX_STRING_LEN = 1000;

export type AuditStatus = 'success' | 'error' | 'unauthorized' | 'rate_limited';

export interface AuditEntry {
  user_id: string | null;
  token_id: string | null;
  tool_name: string;
  input: unknown;
  output_status: AuditStatus;
  output_size_bytes?: number;
  duration_ms?: number;
  error_message?: string;
}

/** Truncate long string values in an object graph (shallow — no deep clone). */
function truncateStrings(v: unknown): unknown {
  if (typeof v === 'string') {
    return v.length > MAX_STRING_LEN ? v.slice(0, MAX_STRING_LEN) + `…[truncated ${v.length - MAX_STRING_LEN} chars]` : v;
  }
  if (Array.isArray(v)) return v.map(truncateStrings);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = truncateStrings(val);
    return out;
  }
  return v;
}

/**
 * Insert an audit row. Never awaits — even the caller's error path
 * shouldn't have to.
 */
export function recordAudit(entry: AuditEntry): void {
  const inputJson = entry.input === undefined ? null : truncateStrings(entry.input);

  pool.query(
    `INSERT INTO mcp_audit_log
       (user_id, token_id, tool_name, input, output_status,
        output_size_bytes, duration_ms, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.user_id,
      entry.token_id,
      entry.tool_name,
      inputJson === null ? null : JSON.stringify(inputJson),
      entry.output_status,
      entry.output_size_bytes ?? null,
      entry.duration_ms ?? null,
      entry.error_message ?? null,
    ],
  ).catch((err) => {
    console.warn('[mcp/audit] insert failed (non-fatal):', err.message);
  });
}
