/**
 * POST /api/service-mcp — outreach-as-a-service MCP endpoint for a sibling app.
 *
 * JSON-RPC 2.0 (Streamable HTTP), same shape as /api/mcp, but a different
 * identity model:
 *   - Auth = one SERVICE token per consuming app (Authorization: Bearer svc_…).
 *   - Each tools/call acts on behalf of an employee (X-On-Behalf-Of header, or
 *     an employee_id arg) which resolves to a provisioned SalesBrain owner.
 *   - Its own curated catalog (SERVICE_TOOLS) — intentionally exposes the
 *     send/spend outreach tools the public /api/mcp catalog hides.
 *
 * Every call is audited into mcp_audit_log with the acting employee id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateService, extractOnBehalfOf, enforceToolLimit } from '@/lib/service-mcp/auth';
import { resolveOwner } from '@/lib/service-mcp/identity';
import { dispatchServiceTool, SERVICE_TOOLS } from '@/lib/service-mcp/dispatch';
import { recordAudit } from '@/lib/mcp/audit';

const SERVER_NAME = 'salesbrain-outreach-service';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;

function rpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}
function rpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    name: SERVER_NAME,
    version: SERVER_VERSION,
    protocol: PROTOCOL_VERSION,
    method: 'POST expected — MCP over Streamable HTTP',
  });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateService(req);
  if (!auth.ok) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: RPC_INVALID_REQUEST, message: auth.error } },
      { status: auth.status },
    );
  }
  const { app_key: appKey, token_id: tokenId } = auth.ctx;

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
  if (rpc.jsonrpc !== '2.0') return rpcError(rpc.id ?? null, RPC_INVALID_REQUEST, 'jsonrpc must be "2.0"');
  const method = rpc.method;
  if (typeof method !== 'string') return rpcError(rpc.id ?? null, RPC_INVALID_REQUEST, 'method must be a string');
  if (rpc.id === undefined) return new NextResponse(null, { status: 204 }); // notification

  switch (method) {
    case 'initialize':
      return rpcResult(rpc.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });

    case 'ping':
      return rpcResult(rpc.id, {});

    case 'tools/list':
      return rpcResult(rpc.id, {
        tools: SERVICE_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case 'tools/call': {
      const params = (rpc.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const toolName = params.name;
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      if (!toolName || typeof toolName !== 'string') {
        return rpcError(rpc.id, RPC_INVALID_PARAMS, 'tools/call requires string "name"');
      }

      // Per-tool provider-quota throttle.
      if (!enforceToolLimit(tokenId, toolName)) {
        return rpcError(rpc.id, RPC_INTERNAL_ERROR, `Rate limit exceeded for ${toolName}`, 429);
      }

      // Resolve the acting employee → owner (register_user is exempt).
      const employeeId = extractOnBehalfOf(req, toolArgs);
      let ownerUserId: string | null = null;
      if (toolName !== 'register_user') {
        if (!employeeId) {
          return rpcError(rpc.id, RPC_INVALID_PARAMS, 'X-On-Behalf-Of (employee_id) header is required');
        }
        try {
          ownerUserId = await resolveOwner(appKey, employeeId);
        } catch (err) {
          return rpcError(rpc.id, RPC_INVALID_PARAMS, err instanceof Error ? err.message : String(err));
        }
      }

      const startedAt = Date.now();
      const result = await dispatchServiceTool(toolName, toolArgs, { appKey, ownerUserId });
      const duration = Date.now() - startedAt;

      const outputJson = JSON.stringify(result.data ?? null);
      recordAudit({
        user_id: ownerUserId,
        token_id: null, // service tokens live in a different table; identity is in `input`
        tool_name: toolName,
        input: { app_key: appKey, employee_id: employeeId, args: toolArgs },
        output_status: result.status === 'error' ? 'error' : 'success',
        output_size_bytes: outputJson.length,
        duration_ms: duration,
        error_message: result.error,
      });

      if (result.status === 'success') {
        return rpcResult(rpc.id, {
          content: [{ type: 'text', text: outputJson }],
          _meta: { data: result.data ?? null, duration_ms: duration },
        });
      }
      return rpcResult(rpc.id, {
        content: [{ type: 'text', text: result.error || 'Tool error' }],
        isError: true,
      });
    }

    default:
      return rpcError(rpc.id, RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}
