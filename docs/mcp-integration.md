# SalesBrain MCP Server — Integration Guide

**Audience:** anyone connecting an MCP client (Hermes, Claude Desktop, Cursor, VS Code, custom agents) to SalesBrain.
**Endpoint:** `https://salescrm.chipchip.social/api/mcp`
**Transport:** Streamable HTTP (single POST endpoint, JSON-RPC 2.0)
**Auth:** Bearer token issued at `/settings/mcp`

---

## 1. What this exposes

SalesBrain's CRM data + workflow tools as an MCP (Model Context Protocol) server. Any MCP-compatible agent can:

- Read the pipeline, deals, sales leads, memories, and past lessons
- Update deals, add notes, mark lost, create new deals, schedule followups
- Admin users can also send Telegram, send email, advance gates

**Every action runs with the token owner's identity and inherits their web-UI visibility rules.** Mateo's Hermes only sees Mateo's deals. Amir's admin token sees everything.

## 2. Getting a token

1. Log into SalesBrain as yourself (`https://salescrm.chipchip.social`)
2. Sidebar → **MCP** (or visit `/settings/mcp`)
3. Enter a name (e.g. "Hermes production") → **Generate**
4. **Copy the token immediately.** It's shown once and never again.
5. Store it in your MCP client's config (see section 4)

The token format is `mcp_` + 43 base64url characters (32 bytes of entropy). Example:
```
mcp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6789012345
```

Revoke any time from the same settings page — takes effect immediately.

## 3. Protocol reference

Single POST endpoint. All requests use JSON-RPC 2.0.

### 3.1 Initialize (handshake)

```bash
curl -X POST https://salescrm.chipchip.social/api/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "hermes", "version": "1.0.0" }
    }
  }'
```

Response includes server info + protocol version + supported capabilities.

### 3.2 List tools

```bash
curl -X POST https://salescrm.chipchip.social/api/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Returns 19 tool definitions with JSON schemas — see section 5 for the full catalog.

### 3.3 Call a tool

```bash
curl -X POST https://salescrm.chipchip.social/api/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "list_deals",
      "arguments": { "deal_type": "sales", "status": "active", "limit": 5 }
    }
  }'
```

Response shape:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      { "type": "text", "text": "{\"deals\":[…],\"count\":5}" }
    ],
    "_meta": { "data": { "deals": [], "count": 5 }, "duration_ms": 24 }
  }
}
```

- `content[0].text` is the tool's output as JSON string (per MCP spec)
- `_meta.data` is the same output as structured data (convenience for clients that want to skip JSON.parse)
- Tool errors return `isError: true` alongside `content` — the JSON-RPC layer stays healthy

## 4. Configuring specific clients

### 4.1 Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "salesbrain": {
      "url": "https://salescrm.chipchip.social/api/mcp",
      "headers": {
        "Authorization": "Bearer mcp_your_token_here"
      }
    }
  }
}
```

Restart Claude Desktop. The 19 tools appear in the tool panel.

### 4.2 Hermes (hermes-agent.org)

Configure the MCP server in Hermes's tool integration UI:

- **Server URL**: `https://salescrm.chipchip.social/api/mcp`
- **Transport**: Streamable HTTP
- **Auth**: Bearer token in `Authorization` header
- **Token value**: your `mcp_...` token from `/settings/mcp`

Hermes should discover all 19 tools on first connection.

### 4.3 Cursor / VS Code (via MCP extension)

Same shape as Claude Desktop — add the server to `settings.json`:

```json
{
  "mcp.servers": {
    "salesbrain": {
      "url": "https://salescrm.chipchip.social/api/mcp",
      "auth": { "type": "bearer", "token": "mcp_your_token_here" }
    }
  }
}
```

## 5. Tool catalog (19 tools)

Grouped by access level. Every tool respects your visibility scope.

### Read tools — always safe

| Tool | Purpose |
|---|---|
| `get_deal` | Full context of one deal (fields, gate metadata, missing fields) |
| `list_deals` | Browse the pipeline with filters (deal_type, gate, status, limit) |
| `get_pipeline_overview` | Deal counts by gate for both pipelines |
| `get_relevant_lessons` | Past losses similar to a given deal — cross-deal pattern warning |
| `get_memories` | Org + your personal agent memories |
| `list_sales_leads` | Recent demo-request submissions |
| `get_sales_lead` | Full context on one sales lead (Calendly booking included) |

### Write tools — modify data you can see

| Tool | Purpose |
|---|---|
| `update_deal` | Persist deal field changes (name, contact, gate, notes, JSONB fields, etc.) |
| `add_deal_note` | Append a note with a "HERMES <ISO date>" header — fastest way to record a conclusion |
| `create_deal` | Create a new sales or grant deal at G1 (you become owner + lead) |
| `mark_deal_lost` | Full loss capture: reason + root_cause + competitor + lesson-for-next-time |
| `assess_deal` | Score + risk + verdict + risk_signals |
| `schedule_followup` | Draft or schedule an email/reminder followup |
| `remember` | Persist a durable cross-conversation lesson (org or user scope) |
| `forget` | Remove a memory by short id |
| `convert_lead_to_deal` | Turn a sales_leads row into a G1 sales deal |

### Admin tools — require admin role

| Tool | Purpose |
|---|---|
| `send_telegram` | Board review request to executive Telegram group |
| `send_email` | Send email now via Resend, or draft as followup |
| `advance_gate` | Advance to a specific gate (sugar over update_deal + guards) |

## 6. Visibility rules (the important part)

**Non-admins**: every deal query runs with `WHERE user_id = <you> OR lead_id = <you>`. You can't see, update, or comment on someone else's deals through MCP — same as when you log into the web UI.

**Admins**: no scope filter. Full access to every deal.

The check happens on **every request** — role changes take effect immediately, no session cache.

If you try to access a deal outside your scope:
- Read tools return `null` / empty results (as if the deal doesn't exist)
- Write tools return `"Deal not found or not accessible"`
- Admin-only tools called by non-admins return `"This tool requires admin access"`

## 7. Rate limits

- **Per token**: 100 requests per rolling 60-second window
- **`send_telegram`**: 10 per rolling 60-second window (extra guard against Telegram spam)
- **`send_email`**: 20 per rolling 60-second window

Exceeding a limit returns `429 Too Many Requests` with a JSON-RPC error body. Retry after ~60 seconds.

## 8. Audit log

Every tool call is logged to `mcp_audit_log` with:
- `user_id` (who owns the token)
- `token_id` (which specific token)
- `tool_name`
- `input` (JSONB, string fields truncated at 1000 chars)
- `output_status` (`success` / `error` / `unauthorized` / `rate_limited`)
- `duration_ms`

Query recent activity:
```sql
SELECT u.email, ma.tool_name, ma.output_status, ma.created_at
FROM mcp_audit_log ma
JOIN users u ON u.id = ma.user_id
WHERE ma.created_at > now() - interval '24 hours'
ORDER BY ma.created_at DESC;
```

## 9. Common Hermes prompts

Examples of how a natural-language Hermes prompt turns into MCP tool calls:

| Prompt | Tool calls |
|---|---|
| "What's on my sales pipeline right now?" | `list_deals` (deal_type=sales, status=active) |
| "Show me the Acme Corp deal" | `list_deals` (search by name) → `get_deal` (with id) |
| "Any lessons from similar losses I should know?" | `get_relevant_lessons` (deal_id from context) |
| "Add a note: talked to their CFO, they want on-prem" | `add_deal_note` |
| "Advance this deal to G4 with the offer strategy locked in" | `advance_gate` (admin only) |
| "Mark this lost — they went with a cheaper competitor. Lesson: ask budget at G2" | `mark_deal_lost` |
| "Remember: we always include the 20% security premium for on-prem" | `remember` (scope=org) |

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Missing bearer token` | Missing / malformed `Authorization` header | Check the header — must be `Bearer <token>` with a space |
| `401 Invalid or revoked token` | Token doesn't exist, was revoked, or has a typo | Verify at `/settings/mcp`; regenerate if needed |
| `429 Rate limit exceeded` | Too many requests in 60s | Backoff for ~60s; consider batching requests |
| `Tool not found: X` | Typo in tool name | Call `tools/list` to see the exact names |
| `This tool requires admin access` | Non-admin called `send_telegram` / `send_email` / `advance_gate` | Ask an admin, or add the change via the web UI |
| `Deal not found or not accessible` | The deal doesn't exist OR isn't in your visibility scope | If the deal exists but you're not on it, ask its owner to add you as `lead_id` |
| Tool succeeds but nothing happens in the web UI | Browser cache | Reload — the DB row is definitely updated (check `mcp_audit_log`) |

## 11. Security considerations

- **Tokens are full-power within your scope.** Anyone with the raw token can act as you. Store like a password.
- **Rotate on suspicion.** Revoke old tokens from `/settings/mcp` and generate new ones. Old ones stop working instantly.
- **Per-device tokens recommended.** Don't share one token across multiple MCP clients — makes revocation surgical.
- **Never commit tokens to git.** They start with `mcp_` — easy to spot in leaked repos.

## 12. Reference

- MCP spec: https://spec.modelcontextprotocol.io
- JSON-RPC 2.0: https://www.jsonrpc.org/specification
- SalesBrain source: `lib/mcp/*` in the repo
- Audit table schema: `db/migrations/015_mcp_tokens_and_audit.sql`
