# SalesBrain architecture — how the pieces fit (post-Phase-5)

**Audience:** engineers picking up this codebase. Rewritten 2026-09-23 after the Hermes audit
(`Sales CRM/AUDIT.md`); the previous version described the in-app agent runtime (`lib/agent.ts`, the Telegram
webhook, `/api/cron/*`) that was deleted in July 2026 and survives only in git history.

## The three repos

| Repo | Role | Talks to |
|---|---|---|
| `salesbrain-core/` | The **kernel**: `salesbrain_core.commands.*` (every state change, RBAC, audit), `policy/*` (pure rules — scoring, quiet hours, caps, the send gate), `migrations/`. Deterministic; no LLM; no Hermes import. | Postgres |
| `salesbrain-hermes/` | The **ring**: a Hermes Agent plugin. `register(ctx)` exposes the kernel as 119 `crm_*` tools in nine family toolsets, an identity middleware, a gateway hook and a relationship-memory provider. `assets/` holds the scripts Hermes cron runs, skills, routines, profiles. | Hermes runtime, Unipile, Bedrock, Telegram, Resend |
| `salesbrain/` (this repo) | The **app**: Next.js UI + two MCP endpoints (`/api/mcp` public, `/api/service-mcp` for a sibling app). No agent loop of its own. | Hermes api_server (chat), kernel (subprocess), Postgres |

Dependency direction: core → hermes → app. Contract changes land in core first.

## Where work happens

```
browser ──/api/agent──▶ lib/hermes-proxy.ts ──HTTP/SSE──▶ Hermes api_server ──▶ agent loop ──▶ crm_* tools ──▶ kernel ──▶ Postgres
browser ──/api/*──────▶ route handlers ──▶ lib/mcp/kernel-rpc.ts kernelCall() ──subprocess `python -m salesbrain_hermes.rpc`──▶ kernel
partner ──/api/service-mcp (Bearer svc_…, X-On-Behalf-Of)──▶ lib/service-mcp/dispatch.ts ──▶ kernelCall()
Telegram ──▶ Hermes gateway ──▶ ring hook (votes, /start LINK) or agent turn ──▶ crm_* tools
Hermes cron ──▶ assets/scripts/*.py (no LLM) or a routine (LLM turn + skill) ──▶ kernel
```

- **Web chat is a Hermes session.** `app/api/agent/route.ts` opens a session on the api_server and streams
  the turn; the app appends `[context] deal_id=…`. The ring's `tool_request` middleware threads the acting
  user from the shared `agent_sessions` table.
- **`kernelCall(tool, args, userId)`** runs the same Python handlers out of process. It bypasses Hermes (no
  middleware, no hooks): the route handler owns the session check, and the kernel re-checks RBAC on the
  user id it is handed.
- **Direct SQL** in the app is for reads and app-owned tables (`contacts`, `accounts`, `imported_messages`,
  `campaigns`, …). Kernel-owned tables (`prospects`, `deals`, `outreach_approvals`, `agent_runs`,
  `policy_rules`, `icp_profiles`) should be written through `kernelCall`; the remaining direct writes are
  listed in `CLAUDE_CONTEXT.md` §5.af as debt.

## Model calls

The app has one shared client, `lib/llm.ts` (`MODEL` = Bedrock `claude-sonnet-4-6`, Anthropic API fallback;
CI forbids literal model ids). Call sites: ICP suggest/optimize, intro-ask drafting, network insights and the
network chat tool loop, communication-style analysis, company research from a URL. Everything agentic
(routines, drafting outreach, classifying LinkedIn threads) runs inside Hermes.

## Human-in-the-loop — the one rule that is enforced in code

No outbound customer message leaves without an owner's decision the kernel can see. `crm_outreach_propose`
(or a follow-up, or an intro ask) files an `outreach_approvals` row; the owner decides on Telegram, on
`/agents`, on the prospect page, or through the service MCP; `crm_outreach_decide` → `approve_and_send`
consumes that row inside `salesbrain_core.commands.outreach.record_outreach` (one send per approval, atomic).
A send with no approval is refused by the kernel regardless of which tool or prompt asked. The policy row
`outreach.gate` can switch to `policy_lanes` mode, where a kernel-evaluated `autonomy.*` lane (non-commercial,
listed channel, value ceiling) may substitute for the approval; it ships in `approval_required` mode.

## Scheduling and events

All scheduling lives on the Hermes box. Deterministic sweeps (leads finder, enricher, graph sync, LinkedIn
sync, grant signals, board nudge, PMI sync) are `hermes cron --no-agent --script` jobs; two routines
(attention allocator, outreach drafter) are LLM turns with a skill. The app describes schedules from
`agent_definitions.schedule` and never runs anything on a timer. Inbound events the app receives: the
Calendly webhook and the zeami.io demo form; Telegram button taps and board votes arrive at the Hermes
gateway. Reply detection (`P6_REPLIED`) is written by the kernel from mirrored LinkedIn threads and from the
Gmail sync.

## Auth and visibility

`iron-session` cookie for the UI; `mcp_*` bearer tokens for `/api/mcp`; `svc_*` app tokens plus
`X-On-Behalf-Of` for `/api/service-mcp`. Deal visibility: creator or lead sees a deal, admins see all
(`CLAUDE_CONTEXT.md` §5.14); prospects and ICPs are owner-scoped, admins may view. The kernel applies the
same rules on its side (`policy/rbac.py`).

## Deploy

App: push `Production` → GitHub Actions → SSH → `npm run build` → PM2 (`ecosystem.config.cjs`, port 3002,
Caddy in front). Core + ring: `salesbrain-hermes/scripts/deploy-server.sh` (wheels, scripts, skills, cron
jobs, config via `hermes config set`, gateway restart) — integration session only. Migrations are numbered
SQL in `salesbrain-core/migrations/`, idempotent, applied by the integration session.

## Adding a capability — checklist

1. Kernel command in `salesbrain-core/src/salesbrain_core/commands/`, tests in `tests/`.
2. Ring tool in `salesbrain-hermes/src/salesbrain_hermes/tools/<family>.py` (declares `mcp` exposure and
   inherits the family `TOOLSET`); roster tests in `tests/test_mcp_catalog.py` pick it up.
3. App: call it through `kernelCall`; add to `lib/service-mcp/dispatch.ts` only if the sibling app needs it,
   and document it in `docs/service-mcp.md`.
4. If it can send anything to a customer, it must go through an approval row. No exceptions.
