# SalesBrain MCP Server — Integration Guide

*Regenerated 2026-10-15 against the deployed ring (core/hermes 0.47.x). Replaces the July 2026 version, which described a hand-written 19-tool catalogue that no longer exists.*

**Audience:** anyone connecting an MCP client — Claude Code, Claude Desktop, Cursor / VS Code, a Hermes agent, a custom agent — to SalesBrain as **themselves**.
**Endpoint:** `POST https://salescrm.chipchip.social/api/mcp`
**Transport:** MCP over Streamable HTTP — one JSON-RPC 2.0 request in, one response out (no SSE, no sessions)
**MCP version:** `2024-11-05`
**Auth:** personal bearer token minted at `/profile` → **MCP** tab

> **Two MCP surfaces exist. Pick the right one.**
>
> | | `/api/mcp` (this doc) | `/api/service-mcp` |
> |---|---|---|
> | Who | A **person** on the team, from their own tools | A **sibling app** we own (e.g. Zeami Omni), acting for its employees |
> | Token | `mcp_…`, minted by the user on `/profile → MCP` | `svc_…`, minted by an admin on `/profile → Service API` |
> | Identity | The token owner | App token + `X-On-Behalf-Of: <employee_id>` |
> | Catalogue | Everything the ring exposes (126 tools) | Curated outreach pipeline (49 tools; 39 shared with this surface, plus `register_user`, `suggest_icp`, `list_leads`, `get_run_status`, `marketing_overview`, the LinkedIn onboarding trio and the two draft-filing tools `crm_outreach_propose` / `crm_propose_intro`) |
> | Docs | here | `docs/service-mcp.md` |

---

## 1. What this exposes

The SalesBrain kernel's `crm_*` tools — deals and gates, grants, prospecting (ICPs, Leads Finder, Enricher), people and the relationship graph, LinkedIn inbox and connection tracking, outreach approvals, background-agent control, KPIs — plus three app-owned memory tools.

**Every call runs as the token owner** with exactly the visibility the web UI gives that person: deals they created or lead (admins: all), their own prospects and ICPs, their own LinkedIn account and graph. The kernel enforces this on every call; the app does not keep a second copy of the rules.

**Nothing on this surface messages anyone outside the CRM.** Every send tool (`crm_send_outreach`, `crm_linkedin_send`, `crm_send_followup`, the connect / first-message batch tools, `crm_outreach_propose`, `crm_propose_intro`, `crm_notify*`) is withheld, and the ring additionally refuses to advertise any tool whose name contains `_send`. Sends in SalesBrain happen only through an owner-approved draft decided on Telegram or `/agents`. The one exception you *can* do here is `crm_outreach_decide` — approving a draft that already waits for you, which is the same click as the Telegram 👍.

Board reviews (`crm_request_board_review`, `crm_remind_board`) post to the internal board group, not to customers, so they are available and rate-limited.

## 2. Getting a token

1. Log in at `https://salescrm.chipchip.social`.
2. Sidebar → **Profile** → **MCP** tab (`/profile?tab=mcp`).
3. Name the token for the device or client ("Claude Code laptop", "Hermes on droplet") → **Generate**.
4. **Copy it immediately.** It is shown once; only its SHA-256 and the first 8 characters are stored.
5. Put it in the client config (§4).

Format: `mcp_` + 43 base64url characters (32 bytes of entropy). Revoke from the same tab; revocation is immediate and soft (audit rows keep resolving the token). Tokens are per user — the only way to mint one for X is to be logged in as X.

## 3. Protocol

Single POST. Every request carries `Authorization: Bearer <token>` and `Content-Type: application/json`. Notifications (no `id`) are accepted with `204` and ignored.

### 3.1 initialize

```bash
curl -s -X POST https://salescrm.chipchip.social/api/mcp \
  -H "Authorization: Bearer $SALESBRAIN_MCP_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
       "params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```
→ `{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"salesbrain","version":"1.0.0"}}`

### 3.2 ping

`{"jsonrpc":"2.0","id":2,"method":"ping"}` → `{"result":{}}`. The cheapest way to check a token.

### 3.3 tools/list

`{"jsonrpc":"2.0","id":3,"method":"tools/list"}` → `name`, `description`, `inputSchema` per tool.

The list is **fetched from the deployed ring** (`python -m salesbrain_hermes.rpc` → `__catalog__`) and cached for 5 minutes per app process. A tool added to the ring appears here with no app change. If the ring is unreachable the last good catalogue is served; before any fetch succeeds, the legacy unprefixed names (§5.3) are served so a client never sees an empty list.

### 3.4 tools/call

```bash
curl -s -X POST https://salescrm.chipchip.social/api/mcp \
  -H "Authorization: Bearer $SALESBRAIN_MCP_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call",
       "params":{"name":"crm_list_my_deals","arguments":{"deal_type":"sales","limit":5}}}'
```

Success:
```json
{"jsonrpc":"2.0","id":4,"result":{
  "content":[{"type":"text","text":"{\"deals\":[…]}"}],
  "_meta":{"data":{"deals":[…]},"duration_ms":412}}}
```
- `content[0].text` is the tool output as a JSON string (MCP spec).
- `_meta.data` is the same output already parsed, for clients that read it.
- A **tool error** (refused by the kernel, bad arguments, not visible) comes back as `result.isError: true` with the reason in `content[0].text` — the JSON-RPC layer stays healthy so the model can read and react.
- A **rate limit** comes back as a JSON-RPC error with HTTP `429`.
- Auth failures are HTTP `401` with `{"error":{"code":-32600,"message":"Missing bearer token" | "Invalid or revoked token"}}`.

Argument names are the kernel's own — what `tools/list` shows is what the kernel takes; the app does not reshape `crm_*` arguments.

## 4. Client configuration

### 4.1 Claude Code

```bash
claude mcp add --transport http salesbrain https://salescrm.chipchip.social/api/mcp \
  --header "Authorization: Bearer mcp_your_token_here"
```
Add `--scope user` to make it available in every project. `/mcp` inside a session shows connection state and the tool list.

### 4.2 Claude Desktop

Claude Desktop's own "custom connector" flow expects OAuth; this server uses a static bearer token, so bridge it over stdio with `mcp-remote`. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "salesbrain": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://salescrm.chipchip.social/api/mcp",
               "--header", "Authorization: Bearer ${SALESBRAIN_MCP_TOKEN}"],
      "env": { "SALESBRAIN_MCP_TOKEN": "mcp_your_token_here" }
    }
  }
}
```
Restart Claude Desktop. Node 18+ is required for `npx`.

### 4.3 Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):
```json
{ "mcpServers": { "salesbrain": {
    "url": "https://salescrm.chipchip.social/api/mcp",
    "headers": { "Authorization": "Bearer mcp_your_token_here" } } } }
```

### 4.4 VS Code (Copilot agent mode)

`.vscode/mcp.json`:
```json
{ "servers": { "salesbrain": {
    "type": "http",
    "url": "https://salescrm.chipchip.social/api/mcp",
    "headers": { "Authorization": "Bearer ${input:salesbrain-token}" } } },
  "inputs": [ { "id": "salesbrain-token", "type": "promptString", "password": true,
                "description": "SalesBrain MCP token" } ] }
```

### 4.5 Hermes Agent (any Hermes that is NOT the SalesBrain gateway)

The SalesBrain Hermes on the production box loads `salesbrain-hermes` as a native plugin and must **not** be pointed at this endpoint (it would get every tool twice). This section is for other Hermes instances — the personal assistant on the droplet, a teammate's own Hermes.

1. Put the token in `~/.hermes/.env`: `SALESBRAIN_MCP_TOKEN=mcp_your_token_here`
2. In `~/.hermes/config.yaml`:
   ```yaml
   mcp_servers:
     salesbrain:
       url: "https://salescrm.chipchip.social/api/mcp"
       headers:
         Authorization: "Bearer ${SALESBRAIN_MCP_TOKEN}"
   ```
   `${VAR}` placeholders in `url` and `headers` resolve from the environment and `~/.hermes/.env` at connect time, so the token never sits in the YAML.
3. `hermes mcp test salesbrain` to check the handshake; `/reload-mcp` inside a running session, or restart the gateway, to pick up config changes.
4. Tools register as **`mcp_salesbrain_<tool>`** — e.g. `mcp_salesbrain_crm_get_deal`, `mcp_salesbrain_crm_lead_lookup`. (Hermes rewrites `-` and `.` in server and tool names to `_`.)
5. 126 tools is a lot of prompt; `hermes mcp configure salesbrain` lets you enable a subset (for a personal assistant, the `crm_lead_lookup` / `crm_pipeline_summary` / `crm_outreach_kpis` / `crm_followups_due` / `crm_lead_note` set covers the stand-up questions).

## 5. Tool catalogue

126 tools advertised as of 2026-10-15: 123 `crm_*` from the ring + 3 app-owned. Counts per family are what the ring exposes over MCP; the family also holds tools that are withheld (§1).

Access column: **read** = never writes · **write** = writes within the caller's own scope · **admin** = rejected for non-admin tokens before dispatch (and again by the kernel).

### 5.1 Ring tools by family

**crm_deals (27)** — the pipeline.
`crm_list_my_deals` `crm_search_deals` `crm_get_deal` `crm_deal_timeline` `crm_read_deal_files` `crm_pipeline_overview` `crm_stalled_deals` `crm_relevant_lessons` `crm_network_insights` `crm_research_company` `crm_board_status` `crm_list_followups` `crm_list_sales_leads` `crm_get_sales_lead` (read) ·
`crm_create_deal` `crm_update_deal` `crm_add_note` `crm_assess_deal` `crm_advance_gate` `crm_mark_deal_lost` `crm_delete_deal` `crm_schedule_followup` `crm_convert_lead` `crm_update_sales_lead` `crm_request_board_review` `crm_remind_board` (write) · `crm_restore_deal` (admin)

**crm_grants (17)** — ChipChip funding, Stage 2 money tracking.
`crm_list_won_grants` `crm_list_active_credits` `crm_grants_at_risk` `crm_grants_reports_due` `crm_grant_signals` `crm_grant_resource_list` `crm_grant_report_list` (read) ·
`crm_mark_grant_won` `crm_sign_grant_agreement` `crm_mark_deal_cancelled` `crm_add_ai_credit` `crm_grant_resource_add/update/delete` `crm_grant_report_add/update/delete` (write)

**crm_prospecting (19)** — ICPs and leads.
`crm_icp_list` `crm_icp_preview` `crm_prospect_queue` `crm_prospect_get` `crm_lead_lookup` `crm_followups_due` (read) ·
`crm_icp_define` `crm_icp_rescore` `crm_icp_set_first_message` `crm_icp_set_state` `crm_icp_archive` `crm_prospect_search` `crm_prospect_auto_qualify` `crm_prospect_qualify` `crm_prospect_add` `crm_prospect_engage` `crm_prospect_convert` `crm_prospect_archive` `crm_lead_note` (write)

**crm_agents (15)** — the background agents and the stand-up numbers.
`crm_agent_status` `crm_agent_activity` `crm_linkedin_quota` `crm_outreach_pending` `crm_outreach_kpis` `crm_team_kpis` `crm_pipeline_summary` (read) ·
`crm_leads_finder_run` `crm_enrich_prospect` `crm_agent_request_run` `crm_agent_set_user_state` `crm_agent_resume_account` `crm_outreach_decide` (write) · `crm_agent_set_enabled` `crm_linkedin_health` (admin)

**crm_linkedin (14)** — the caller's own connected account.
`crm_linkedin_status` `crm_linkedin_inbox` `crm_linkedin_thread` `crm_linkedin_draft_reply` `crm_linkedin_find_person` `crm_linkedin_connect_status` `crm_linkedin_pending_followups` (read) ·
`crm_linkedin_link_account` `crm_linkedin_revoke` `crm_linkedin_backfill` `crm_linkedin_link_person` `crm_linkedin_link_prospect` `crm_linkedin_set_state` `crm_linkedin_set_followup` (write)

**crm_people (12)** — the relationship layer.
`crm_whoami` `crm_person_lookup` `crm_person_dossier` `crm_list_commitments` (read) ·
`crm_person_ensure` `crm_link_deal_person` `crm_record_fact` `crm_record_interaction` `crm_record_commitment` `crm_resolve_commitment` `crm_reschedule_commitment` `crm_record_value_event` (write)

**crm_graph (7)** — warm paths.
`crm_graph_status` `crm_graph_edges` `crm_graph_reach` `crm_who_can_reach` `crm_path_find` (read) · `crm_graph_sync` `crm_route_expand` (write)

**crm_outreach (7)** — policy and bookkeeping, never delivery.
`crm_attention_queue` `crm_judge_actions` `crm_check_outreach_policy` (read) · `crm_objective_set` `crm_objective_resolve` `crm_record_outreach` (logs a call / meeting made outside the system) `crm_record_reply` (write)

**crm_delivery (4)** — deal ↔ PM-tool links: `crm_delivery_status` `crm_delivery_pending_links` (read) · `crm_delivery_link` `crm_delivery_unlink` (write)

**crm_memory (0 of 5)** — per-person memory is deliberately not on MCP (it needs an attended Hermes session to know who is talking). Use `/profile → Memory`.

### 5.2 App-owned tools (3)

| Tool | Access | Purpose |
|---|---|---|
| `get_memories` | read | Org + personal agent memories (`scope`: org / user / both) |
| `remember` | write | Persist a durable lesson (org or user scope) |
| `forget` | write | Remove a memory by short id |

### 5.3 Legacy names (dispatchable, not advertised)

Clients that still call the July-2026 unprefixed names keep working, but `tools/list` no longer shows them. Migrate when convenient:

`get_deal→crm_get_deal` · `list_deals→crm_list_my_deals` · `get_pipeline_overview→crm_pipeline_overview` · `get_relevant_lessons→crm_relevant_lessons` · `list_sales_leads→crm_list_sales_leads` · `get_sales_lead→crm_get_sales_lead` · `list_pending_board_decisions→crm_board_status` · `update_deal→crm_update_deal` · `add_deal_note→crm_add_note` · `create_deal→crm_create_deal` · `mark_deal_lost→crm_mark_deal_lost` · `assess_deal→crm_assess_deal` · `schedule_followup→crm_schedule_followup` · `send_telegram→crm_request_board_review` · `advance_gate→crm_advance_gate` · `convert_lead_to_deal→crm_convert_lead` · `delete_deal→crm_delete_deal` · `restore_deal→crm_restore_deal` · `nudge_pending_votes→crm_remind_board`

`send_email` is **withheld** (returns `Unknown tool`): it mailed an external party with no human reading the words first.

## 6. Visibility and roles

- **Deals**: non-admins see and change deals where they are creator (`user_id`) or lead (`lead_id`); admins see all. Outside that scope a read returns null / empty and a write returns a not-found error — the same as the web UI.
- **Prospects, ICPs, LinkedIn, graph, approvals**: scoped to the owner. An admin may pass `owner` / `owner_user_id` on the tools that document it (acting as a teammate is audited as `act_as`).
- **Sales leads, pipeline summaries, KPIs, lead lookup**: org-wide by design, aggregates or journey state only.
- **Admin-only tools**: `crm_agent_set_enabled`, `crm_linkedin_health`, `crm_restore_deal`.
- **Background-agent holds** apply here too: a person whose Leads Finder / Enricher is paused on `/admin/users` gets a refusal from `crm_leads_finder_run` / `crm_enrich_prospect`, not a run.

The role is read from the DB on every request — no session cache.

## 7. Limits and timeouts

| Limit | Value |
|---|---|
| Per token, all tools | 100 requests per rolling 60 s |
| `crm_request_board_review`, `crm_remind_board` (legacy `send_telegram`) | 10 / min |
| `crm_prospect_search`, `crm_linkedin_backfill`, `crm_prospect_auto_qualify` | 5 / min (LinkedIn quota — the account is the thing at risk) |
| `crm_linkedin_find_person`, `crm_research_company` | 10 / min |
| `crm_linkedin_inbox`, `crm_prospect_qualify`, `crm_linkedin_draft_reply` | 20 / min |
| `crm_linkedin_thread` | 30 / min |

Rate limits are in-process per token (reset on app restart). Over the limit → HTTP `429`; wait ~60 s.

On top of these, the **kernel's own daily budgets** apply (LinkedIn searches and profile fetches per account per day, connection-request caps, quiet hours); those refusals arrive as `isError` tool results with the reason, and `crm_linkedin_quota` shows where you stand.

Each call runs the kernel out of process with a **30 s** ceiling, raised to **180 s** for `crm_leads_finder_run`, `crm_enrich_prospect`, `crm_route_expand`, `crm_prospect_search`, `crm_research_company`, `crm_prospect_auto_qualify`, `crm_icp_rescore`, `crm_graph_sync`. A timeout surfaces as an error naming the tool and "killed after Ns". Prefer `crm_agent_request_run` (queue it for the next tick) for anything that may run long.

## 8. Audit

Every call — including rejected auth — lands in `mcp_audit_log` (`db/migrations/015_mcp_tokens_and_audit.sql`): `user_id`, `token_id`, `tool_name`, `input` (JSONB, strings truncated at 1000 chars), `output_status` (`success` / `error` / `unauthorized` / `rate_limited`), `output_size_bytes`, `duration_ms`, `error_message`. Kernel-side, each `crm_*` call also writes its own row to `agent_audit_log`.

```sql
SELECT u.email, ma.tool_name, ma.output_status, ma.duration_ms, ma.created_at
FROM mcp_audit_log ma LEFT JOIN users u ON u.id = ma.user_id
WHERE ma.created_at > now() - interval '24 hours'
ORDER BY ma.created_at DESC;
```

## 9. Prompts → tools (examples)

| Prompt | Tool(s) |
|---|---|
| "Who am I logged in as here?" | `crm_whoami` |
| "What's on my sales pipeline?" | `crm_list_my_deals {deal_type:"sales"}` or `crm_pipeline_overview` |
| "Stand-up numbers for the team this week" | `crm_pipeline_summary {period:"week"}` + `crm_team_kpis {period:"week"}` |
| "Where are we with Stefan Ickler?" | `crm_lead_lookup {query:"Stefan Ickler"}` |
| "Log that I called him, he wants a demo in November" | `crm_lead_note {query:…, kind:"call", text:…}` |
| "Who needs a follow-up today?" | `crm_followups_due` |
| "Add a note to the Acme deal: CFO wants on-prem" | `crm_search_deals` → `crm_add_note` |
| "Move Acme to G4" | `crm_advance_gate` (same guards as the Advance button) |
| "Mark it lost, cheaper competitor; lesson: ask budget at G2" | `crm_mark_deal_lost` |
| "Any drafts waiting for me? Approve the first one" | `crm_outreach_pending` → `crm_outreach_decide {approval_id, decision:"approve"}` |
| "Did anyone accept my connection requests?" | `crm_linkedin_pending_followups` |
| "Find more leads for the NRW list now" | `crm_leads_finder_run {icp_id}` (or `crm_agent_request_run` to queue) |
| "Remember: on-prem quotes always include the 20% security premium" | `remember {scope:"org"}` |

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Missing bearer token` | Header absent or not `Bearer <token>` | Check the header; `${VAR}` placeholders must resolve |
| `401 Invalid or revoked token` | Typo, revoked, or a `svc_` token used here | Mint a fresh one at `/profile?tab=mcp`; service tokens go to `/api/service-mcp` |
| `429` | 100/min or a per-tool cap | Back off 60 s; batch work through `crm_agent_request_run` |
| `Unknown tool: X` | Typo, a withheld send tool, or a `crm_memory_*` tool | `tools/list` is authoritative |
| `This tool requires admin access` | admin tool, non-admin token | Ask an admin |
| `isError` with "not visible" / "not found" | Deal or lead outside your scope | Ask the owner to add you as lead |
| `kernel RPC failed … killed after 30s` | Long tool on the 30 s path, or ring restarting during a deploy | Retry; use the queueing tool for long runs |
| `tools/list` shows the old unprefixed names | Ring unreachable from the app and no catalogue cached yet | Transient; retry in a minute, check `pm2 logs salesbrain` for `[mcp] ring catalogue unavailable` |
| Hermes shows no `mcp_salesbrain_*` tools | Config not reloaded or token unresolved | `hermes mcp test salesbrain`, then `/reload-mcp` |

## 11. Security

- A token is **full power within your scope**; whoever holds it is you. Store it like a password, one token per device or client, revoke on suspicion.
- Prefer env-var interpolation (`${SALESBRAIN_MCP_TOKEN}`) over pasting the token into config files that get synced or committed. Tokens start with `mcp_` and are easy to grep for in a leaked repo.
- This surface cannot send a customer-facing message. If a future tool must, it belongs on the approval path (`outreach_approvals`), not here — the ring's `_send` name backstop will refuse to advertise it anyway.

## 12. Where the code is

- Route: `app/api/mcp/route.ts` · auth + rate limits: `lib/mcp/auth.ts` · tokens: `lib/mcp/tokens.ts`, `app/api/mcp/tokens` · UI: `components/profile/McpPanel.tsx`
- Catalogue + legacy map: `lib/mcp/tool-definitions.ts` · dispatch: `lib/mcp/tool-dispatch.ts` · kernel bridge: `lib/mcp/kernel-rpc.ts`
- Ring side: `salesbrain-hermes/src/salesbrain_hermes/rpc.py` (`catalog()`, `is_exposed()`, `_NEVER_EXPOSE`); each `tools/*.py` declares `mcp="read" | "write" | "admin" | None` per tool — `None` or missing = not on MCP.
- History: `docs/mcp-tool-parity-plan.md` (why the catalogue is served from the ring), `docs/service-mcp.md` (the app-to-app surface).
- Spec: https://spec.modelcontextprotocol.io · JSON-RPC 2.0: https://www.jsonrpc.org/specification
