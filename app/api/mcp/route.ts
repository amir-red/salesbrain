/**
 * POST /api/mcp — Model Context Protocol endpoint (Streamable HTTP transport).
 *
 * Speaks JSON-RPC 2.0 as defined by the MCP spec. Supported methods:
 *   - initialize            → returns server info + capabilities
 *   - tools/list            → returns the 19-tool catalog
 *   - tools/call            → dispatches to lib/mcp/tool-dispatch
 *   - ping                  → health check
 *
 * Everything else returns a JSON-RPC "method not found" error. Notifications
 * (JSON-RPC messages without an `id`) are acknowledged but ignored — we're
 * a single-response server, not a persistent session.
 *
 * Auth: `Authorization: Bearer <token>` on every request. Missing/invalid →
 * 401 with a JSON-RPC error body.
 *
 * Why a hand-rolled JSON-RPC dispatcher instead of the SDK's server class:
 * Next.js route handlers are request-scoped. The SDK's `Server` is a
 * long-lived stateful object designed for stdio / SSE transports. For
 * Streamable HTTP, one request in → one response out — the SDK
 * doesn't buy us much and adds cross-transport complexity we don't need.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/mcp/auth';
import { dispatchTool } from '@/lib/mcp/tool-dispatch';
import { getMcpTools } from '@/lib/mcp/tool-definitions';
import { recordAudit } from '@/lib/mcp/audit';

// ─── Constants ──────────────────────────────────────────────────────

const SERVER_NAME = 'salesbrain';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';    // MCP spec version we implement

// ─── JSON-RPC error codes (matches MCP spec) ────────────────────────

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;

// ─── Response helpers ───────────────────────────────────────────────

function rpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  // Per JSON-RPC spec, most errors go back with HTTP 200; only auth uses 401.
  return NextResponse.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status },
  );
}

// ─── Health check ──────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    ok: true,
    name: SERVER_NAME,
    version: SERVER_VERSION,
    protocol: PROTOCOL_VERSION,
    method: 'POST expected — MCP over Streamable HTTP',
  });
}

// ─── Main POST handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth first — no method dispatch without a valid token.
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    // Best-effort audit even for rejected requests. We don't have a token_id
    // for invalid tokens, so pass nulls.
    recordAudit({
      user_id: null,
      token_id: null,
      tool_name: '__auth__',
      input: null,
      output_status: auth.status === 429 ? 'rate_limited' : 'unauthorized',
      error_message: auth.error,
    });
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: RPC_INVALID_REQUEST, message: auth.error } },
      { status: auth.status },
    );
  }

  const ctx = auth.ctx;

  // Parse the request body as JSON-RPC.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, RPC_PARSE_ERROR, 'Invalid JSON body');
  }

  if (!body || typeof body !== 'object') {
    return rpcError(null, RPC_INVALID_REQUEST, 'Body must be a JSON-RPC object');
  }

  const rpc = body as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };

  if (rpc.jsonrpc !== '2.0') {
    return rpcError(rpc.id ?? null, RPC_INVALID_REQUEST, 'jsonrpc must be "2.0"');
  }

  const method = rpc.method;
  if (typeof method !== 'string') {
    return rpcError(rpc.id ?? null, RPC_INVALID_REQUEST, 'method must be a string');
  }

  // Notifications (no id) are one-way — we accept but return no body.
  const isNotification = rpc.id === undefined;
  if (isNotification) {
    return new NextResponse(null, { status: 204 });
  }

  // ── Method dispatch ────────────────────────────────────────────
  switch (method) {
    case 'initialize':
      return rpcResult(rpc.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });

    case 'ping':
      return rpcResult(rpc.id, {});

    case 'tools/list': {
      // Fetched from the ring, so this list is whatever the DEPLOYED kernel
      // exposes — the app keeps no copy to fall out of date. Degrades to the
      // app-owned tools if the ring is unreachable; never returns empty.
      const tools = await getMcpTools();
      return rpcResult(rpc.id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }

    case 'tools/call': {
      const params = (rpc.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const toolName = params.name;
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      if (!toolName || typeof toolName !== 'string') {
        return rpcError(rpc.id, RPC_INVALID_PARAMS, 'tools/call requires string "name"');
      }

      const startedAt = Date.now();
      const result = await dispatchTool(toolName, toolArgs, ctx);
      const duration = Date.now() - startedAt;

      // Fire-and-forget audit — reflects the actual outcome from dispatch.
      const outputJson = JSON.stringify(result.data ?? null);
      recordAudit({
        user_id: ctx.user_id,
        token_id: ctx.token_id,
        tool_name: toolName,
        input: toolArgs,
        output_status:
          result.status === 'rate_limited'
            ? 'rate_limited'
            : result.status === 'error'
              ? 'error'
              : 'success',
        output_size_bytes: outputJson.length,
        duration_ms: duration,
        error_message: result.error,
      });

      if (result.status === 'success') {
        // MCP tools/call result shape: `content` is a list of blocks.
        return rpcResult(rpc.id, {
          content: [
            {
              type: 'text',
              text: outputJson,
            },
          ],
          // Structured data for clients that support it (like Hermes).
          _meta: { data: result.data ?? null, duration_ms: duration },
        });
      }

      if (result.status === 'rate_limited') {
        return rpcError(rpc.id, RPC_INTERNAL_ERROR, result.error || 'Rate limit', 429);
      }

      // MCP convention: tool errors return content with isError: true rather
      // than a JSON-RPC error, so the client's LLM can see + reason about it.
      return rpcResult(rpc.id, {
        content: [{ type: 'text', text: result.error || 'Tool error' }],
        isError: true,
      });
    }

    default:
      return rpcError(rpc.id, RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}
