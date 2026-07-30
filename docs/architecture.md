# SalesBrain — Architecture

A one-page map of the system: the stack, the data model, the layers, how the surfaces (Web / Telegram / MCP) share the same tool executors, and the patterns to keep in mind when extending it.

## Stack

- **Framework**: Next.js 14 (App Router, TypeScript, SSR + API routes)
- **DB**: Postgres via Supabase (`pg` pool in `lib/db.ts`)
- **Runtime**: single Node process on a VM, PM2 as supervisor (`pm2 restart salesbrain`)
- **Deploy**: GitHub Actions on push to `Production` → SSH into `/srv/salesbrain`, `git pull`, `npm install && next build`, PM2 restart. Env vars land in `.env.production` from GitHub secrets.
- **LLM**: Anthropic Claude (Opus 4.6, via `@anthropic-ai/sdk`) — one central `MODEL` constant in `lib/llm.ts`. Hosted `web_search` tool wired into the same call sites.
- **Email**: Resend (`lib/email.ts`)
- **Messaging**: Telegram Bot API (webhook mode)
- **Auth (web)**: `iron-session` cookies (`lib/auth.ts`)
- **Auth (agents)**: per-user MCP tokens (SHA-256 hashed), Telegram user linking

## Data model — key tables

```
users ─┬─ deals ─┬─ conversations       # chat history per deal
       │         ├─ gate_events         # every gate move
       │         ├─ board_decisions ─── board_votes
       │         ├─ followups
       │         ├─ file_attachments
       │         ├─ client_onboardings  # post-G9 delivery kanban
       │         ├─ lessons_learned     # losses with root cause
       │         └─ pricing_quotes
       ├─ sales_leads                    # zeami.io form + Calendly bookings
       ├─ mcp_tokens ── mcp_audit_log   # per-user MCP tokens + audit
       ├─ telegram_user_links           # SalesBrain ↔ Telegram identity
       └─ (memory files on disk: memory/org.md, memory/users/*.md, tracked in git)
```

Soft-delete: `deals.deleted_at` is honored in every hot-path query.

Board decision state machine: `pending → approved | rejected | amended | superseded`. Superseded is set automatically when a deal advances past a gate that still had a stale pending row.

## Layered architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ SURFACES (external entry points)                                         │
├──────────────────────────────────────────────────────────────────────────┤
│ Web UI (App Router pages)   │  Telegram Bot     │  MCP server            │
│ ── /pipeline, /deals/[id],  │  @MateSalesCRMBot │  /api/mcp              │
│    /reports, /lessons,      │  ── DM agent      │  Streamable HTTP       │
│    /sales-leads,            │  ── group @mention│  bearer token per user │
│    /settings/{mcp,telegram} │  ── board vote    │  (Hermes, Claude       │
│                             │    reply parsing  │   Desktop, etc.)       │
│                             │  ── nudge cron    │                        │
│ Public form (zeami.io) ─────┘                                             │
│ Calendly webhook ───────────                                              │
│ Onboarding public form (token) ─                                          │
│ Cron endpoints (bearer) ─────                                             │
└─────────────┬──────────────────┬──────────────┬───────────────────────────┘
              │                  │              │
              ▼                  ▼              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ APPLICATION LAYER                                                        │
│                                                                          │
│  Agent runtime (lib/agent.ts)                                            │
│  ── loads deal + history + memory + relevant lessons                     │
│  ── stable/dynamic prompt split for prompt-cache                         │
│  ── tool loop, MAX_ITERATIONS = 6                                        │
│                                                                          │
│  Tool executors (lib/tool-executors.ts, lib/prospect-executors.ts)       │
│  ── exec_update_deal, exec_send_telegram, exec_send_email,               │
│     exec_mark_deal_lost, exec_assess_deal, exec_remember/forget,         │
│     exec_schedule_followup, exec_generate_research_brief, ...            │
│                                                                          │
│  MCP layer (lib/mcp/*)                                                   │
│  ── tool-definitions.ts (19+ tool JSON schemas)                          │
│  ── tool-dispatch.ts (visibility scoping + admin/read-only guards)       │
│  ── auth.ts (SHA-256 token lookup + rate limits)                         │
│  ── audit.ts (per-tool call logging)                                     │
│                                                                          │
│  Telegram layer                                                          │
│  ── lib/telegram.ts (send/format helpers)                                │
│  ── lib/telegram-agent.ts (Claude+MCP bridge for DMs and group @mentions)│
│  ── lib/telegram-notifications.ts (SLA breach, deal-assigned, board nudge)│
│  ── lib/telegram-links.ts (link tokens, LinkedUser resolver)             │
│                                                                          │
│  Domain helpers                                                          │
│  ── lib/gates.ts (SALES_GATES + GRANT_GATES, board flags, SLA days)      │
│  ── lib/lessons.ts, lib/memory.ts (durable knowledge stores)             │
│  ── lib/calendly.ts (webhook signature + payload parsers)                │
│  ── lib/pricing/engine.ts (Excel-as-engine: SheetJS + HyperFormula)      │
│  ── lib/onboarding.ts                                                    │
└──────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ PERSISTENCE                                                              │
│  Postgres pool (lib/db.ts) · file-backed memory in memory/*.md · git     │
└──────────────────────────────────────────────────────────────────────────┘
```

## Two agent runtimes (both use Claude + the same tool executors)

- **Deal-chat agent** (`lib/agent.ts runAgent`) — used by the `/deals/[id]` chat UI, streams events over Server-Sent Events, uses per-deal conversation history, loads memories + lessons into the dynamic prompt.
- **Telegram bridge** (`lib/telegram-agent.ts processMessage`) — used by DMs and group @mentions, single-turn (no history), same 19+ MCP tools attached, group-mode system prompt is shorter and mobile-friendly.

## Auth model

- **Web UI**: iron-session cookie (`SESSION_SECRET`). Non-admin users see only deals where `user_id = me OR lead_id = me`; admins see everything.
- **MCP**: `Authorization: Bearer <mcp_...>` → SHA-256 lookup in `mcp_tokens` → resolves to a `user_id` + role → same visibility rules apply.
- **Telegram**: `telegram_user_links` binds a Telegram user to a SalesBrain user; DMs use that identity. Anonymous users in the allowlisted board group get **read-only, org-wide** scope (`AuthContext.read_only = true`, guarded in the tool dispatcher).

## Scheduled work (external triggers)

- **GitHub Actions cron** hits `/api/cron/*` endpoints, guarded by `CRON_SECRET`.
- `/api/cron` (daily-ish) — followups, SLA alerts, decay detection, autonomous prospecting.
- `/api/cron/daily-digest` (daily) — pipeline summary to the board group.
- `/api/cron/board-nudge` (Mon/Wed/Fri 11:00 EAT) — fresh board-vote reminders. Rewires `board_decisions.telegram_message_id` to the new message so replies still count as votes.

## The Telegram webhook interior — one file to know

`app/api/telegram/route.ts` orchestrates 4 routes based on message shape:

- **Route 1** — `/start LINK-XXXXXX` in a private DM (identity linking).
- **Route 2** — reply-to a pending board decision → parse vote → tally → resolve (5-of-8) → agent processes the outcome.
- **Route 3** — free-text DM from a linked user → agent bridge.
- **Route 4** — `@MateSalesCRMBot ...` in a group → agent bridge with `channel: 'group'`; unlinked users get read-only in the allowlisted board chat.
- Plus a **vote-miss fallback** in Route 2 that re-anchors when someone replies to the wrong message.

## Key patterns to keep in mind

- **Single source of truth for the LLM model** → `lib/llm.ts`, one edit swaps every call site.
- **Single source of truth for tools** → `MCP_TOOLS` in `lib/mcp/tool-definitions.ts`. The agent, MCP HTTP endpoint, and Telegram bridge all use the same list.
- **Visibility as a query filter, not a middleware** — `dealVisibility(ctx)` in `lib/mcp/tool-dispatch.ts` is composed into every deal-touching SQL. No hidden "auth middleware," everything is explicit at the query.
- **Fire-and-forget notifications** — every Telegram push uses `void ...` so a Telegram outage never blocks a DB write.
- **Soft-delete** — `deals.deleted_at` is checked in every hot-path query; deleted deals aren't visible anywhere except the admin restore path.
- **Board state machine** — `board_decisions.status`: `pending → approved | rejected | amended | superseded`. Superseded is set automatically when a deal advances past a gate that still had a stale pending row.
- **Prompt cache split** — `buildSystemPrompt` returns `{stable, dynamic}`. Stable half (product KB, personality, rules, tools) rides Anthropic's ephemeral cache. Dynamic half (current deal state, memory, lessons) is per-turn.
- **Migrations are additive + idempotent** — `db/migrations/NNN_*.sql` uses `IF NOT EXISTS` / `IF EXISTS`; `db/schema.sql` gets each migration appended, so fresh installs work from that file alone.

## Extending safely — a short checklist

1. New DB field? Write `db/migrations/NNN_*.sql`, append to `db/schema.sql`, apply to prod via the same `node -e` pool runner used before.
2. New agent capability? Add executor in `lib/tool-executors.ts`, register tool in `lib/mcp/tool-definitions.ts`, add dispatch case in `lib/mcp/tool-dispatch.ts`, run typecheck + build.
3. Touching deal queries? Filter by `d.deleted_at IS NULL` and compose `dealVisibility(ctx)` — do not hand-roll `WHERE user_id = ...`.
4. Adding a scheduled job? New route under `app/api/cron/*` with `CRON_SECRET` bearer guard, plus a GitHub Actions workflow to hit it.
5. Doing anything the user will notice? Update `docs/*.md` — future-you or the next dev will thank you.
