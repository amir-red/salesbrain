# SalesBrain — Developer Guide

A first-day orientation for a new developer. It explains what the product is, how the
three repos fit together, how a request flows through them, where each kind of code
lives, and how to run, test and ship. It is deliberately short on feature history — the
feature-by-feature log is in `CLAUDE_CONTEXT.md` (repo root) and the design rationale
in `docs/relationship-os-architecture.md`.

Last verified: 2026-09-05, lockstep version 0.27.0.

---

## 1. What the product is

SalesBrain is an internal B2B sales + grants CRM with AI agents at its core. Two
products share it:

- **Zeami** — work-intelligence platform. 9-gate *sales* pipeline.
- **ChipChip** — Ethiopian agri-commerce. 10-gate *grant* pipeline.

Users are our own sales / grants / PM team. They work in three places, all backed by the
same Postgres database:

1. **Web app** at `https://salescrm.chipchip.social` — pipeline, deals, ICP builder,
   prospecting, network graph, pricing, agents dashboard.
2. **Telegram** — `@MateSalesCRMBot` for chat-with-the-CRM and the board-review group.
3. **Background agents** — Leads Finder, Enricher, Outreach, Attention allocator — that
   run on a schedule on the server and DM people when they need a decision.

A fourth consumer is another internal app of ours that drives the outreach pipeline
for its own users over an MCP endpoint (`docs/service-mcp.md`).

---

## 2. The three repos

The workspace folder `Sales CRM/` holds three git repos that are versioned and merged
in lockstep. One feature normally touches all three.

```
Sales CRM/
├── salesbrain-core/     Python  — domain kernel (rules + persistence)      "the kernel"
├── salesbrain-hermes/   Python  — Hermes plugin exposing kernel as tools  "the ring"
├── salesbrain/          Next.js — web app + HTTP surfaces                 "the app"
└── ws.sh                parallel feature workspaces (see §9)
```

Dependency direction is strict and one-way:

```
salesbrain-core  ──►  salesbrain-hermes  ──►  salesbrain (runtime only, no source import)
```

### 2.1 `salesbrain-core` — the kernel

*Business rules, entities and persistence. Zero agent-runtime imports.* Runs and tests
with Hermes absent. Every rule that decides what the CRM is allowed to do lives here,
once.

```
src/salesbrain_core/
├── domain/      entities & value objects — Actor, gates (SALES/GRANT), delivery
├── policy/      PURE decision functions, no I/O — rbac, deal_rules, icp scoring,
│                leads_finder, outreach, enricher, linkedin_limits
├── commands/    application services: take an Actor, read/write Postgres, audit,
│                return a dict (may carry `events`) — deals, board, prospecting,
│                outreach, agents, people, network, linkedin, grants, ...
├── store/       psycopg pool (db.py), migration runner, backfills
├── audit/       AuditRecord
└── identity/    Telegram ⇄ user linking
migrations/      the ONLY place new schema goes (020_ onward, plain idempotent SQL)
tests/           pytest — policy tests are pure, command tests need DATABASE_URL
```

Key ideas:

- **`Actor`** (`domain/__init__.py`) is the acting SalesBrain user. Every command
  takes one. RBAC derives from it and nowhere else.
- **`policy.rbac.deal_visibility(actor)`** is the single visibility rule: non-admins
  see deals they created or lead; admins see all; soft-deleted rows hidden. Compose it
  into every deal query rather than re-implementing it.
- **Commands return side-effect *requests*, not side effects.** A command that should
  notify Telegram returns `{"...": ..., "events": [...]}`. The kernel never talks to
  Telegram, email or LinkedIn. The caller (the ring) delivers.
- **Policy is data.** Budgets, kill switches, enable flags for the background agents
  are rows in a policy table, read by `policy/*.py` functions that are pure and unit
  tested (`should_run`, `next_query`, `backoff_until`, ...).

### 2.2 `salesbrain-hermes` — the ring

*The adapter ring — a plugin for [Hermes](https://github.com/NousResearch/hermes-agent)
(pinned `v2026.7.20`) that exposes the kernel as `crm_*` tools.* Also everything that
needs an LLM, a schedule, or an external provider. **No business rules live here.**

```
src/salesbrain_hermes/
├── __init__.py          register(ctx): the Hermes entry point; identity middleware
│                        that injects the acting user into every crm_* call
├── tools/               one file per toolset: deals, board/grants, people,
│                        prospecting, outreach, agents, linkedin, delivery, ping
│                        each TOOLS = [dict(name, mcp, schema, handler)]
├── identity.py          Hermes session / Telegram sender → Actor (resolve_actor)
├── deliver.py           delivers kernel `events` (Telegram DM, board card, email)
├── rpc.py               subprocess RPC entry the web app spawns per call (§3.3)
├── prospecting_core.py  the ONE search step used by chat, manual and timer paths
├── outreach_agent.py    propose → owner card → decision → send orchestration
├── research.py, llm.py  web fetch + model calls
├── unipile.py, linkedin_guard.py, email_sources.py   provider adapters
├── memory_provider.py, distill.py, pmi.py, board_hook.py
assets/
├── skills/salesbrain-*  markdown that steers the LLM per task (deal updates,
│                        prospecting, outreach agent, leads finder, ...)
├── scripts/*.py         daemons run by systemd timers / Hermes cron:
│                        leads_finder, enricher, outreach_queue, attention_queue,
│                        board_callbacks, board_nudge, linkedin_sync, grant_signals
├── routines/*.txt       prompts for Hermes cron routines (outreach, attention)
├── systemd/             .service/.timer units (installed by deploy, enabled by hand)
├── profiles/            Workspace "assistant" cards (SOUL.md + description)
└── memory-plugin/       RelationshipMemory provider shim
scripts/deploy-server.sh manual full deploy (build wheels, ship assets, restart)
tests/                   L0 shape tests always; L1 contract tests with HERMES_SRC set
```

Handler contract (verified against Hermes): `handler(args: dict, **kwargs) -> str`
returning JSON. Every handler follows the same four steps —
`resolve_actor(args)` → kernel command → `deliver_events(result["events"])` → JSON.
See `tools/deals.py::_run` for the canonical wrapper.

The `mcp` key on a tool (`"read"`, `"write"`, `"admin"` or `None`) decides whether the
public MCP endpoint advertises it. `None` hides it from `tools/list` but it stays
callable by name through the RPC — that is how the service MCP reaches send/spend
tools the public MCP hides.

### 2.3 `salesbrain` — the app

*Next.js 14 App Router, TypeScript strict, Tailwind v4, `pg` with no ORM.* The human UI
plus every HTTP surface. It calls the kernel at runtime (§3) but imports none of its
source.

```
app/
├── <route>/page.tsx      pages: / pipeline deals/[id] icp prospecting agents
│                         network pricing grants relationships sales-leads ...
├── api/                  REST routes, one folder per resource
│   ├── agent/            deal chat → Hermes api_server (SSE → NDJSON)
│   ├── mcp/              public MCP endpoint (per-user bearer token)
│   ├── service-mcp/      partner-app MCP endpoint (per-app token + on-behalf-of)
│   ├── public/           zeami.io-facing API (API key)
│   ├── telegram/         bot webhook
│   ├── cron/             bearer-protected scheduled endpoints
│   └── deals, icp, agents, outreach, prospects, linkedin, pricing, ...
components/               React; Sidebar, Chat, icp/*, profile/*, Network*, Pricing*
lib/
├── db.ts                 pg Pool — always parametrised `$1` queries
├── auth.ts               iron-session `getSession()` → {userId,email,name,role}
├── hermes-proxy.ts       chat bridge to Hermes api_server (§3.2)
├── mcp/kernel-rpc.ts     `kernelCall(tool, args, userId)` (§3.3)
├── mcp/                  public MCP: auth, tokens, dispatch, audit
├── service-mcp/          partner MCP: identity map, curated catalog, rate limits
├── gates.ts, icp.ts      client-safe pure helpers mirrored from the kernel
├── icp-server.ts, pricing/engine.ts, google-oauth.ts, telegram*.ts, unipile.ts
middleware.ts             session gate with whitelist (login, public, forms, MCP)
db/migrations/            LEGACY stream 001–019 (frozen) + a few app-only files
docs/                     this guide, external-api, service-mcp, mcp-integration,
                          user-guide, relationship-os-architecture
.github/workflows/deploy.yml   push `Production` → SSH → build → pm2 restart
```

Two split rules matter for the build:

- **Server/client split.** Anything importing `pg` (`lib/db.ts` and everything above
  it) must never be imported from a client component, or webpack bundles Postgres for
  the browser. Pattern: `lib/onboarding.ts` (client-safe) vs `lib/onboarding-server.ts`.
- **Route files export only handlers.** Shared zod schemas go in `lib/*-server.ts`.

---

## 3. How a request flows

### 3.1 Telegram or Hermes web chat → kernel (in-process)

```
user message → Hermes gateway → LLM picks crm_update_deal
  → ring identity middleware injects _actor_user_id from agent_sessions / telegram link
  → tools/deals.py handler: resolve_actor → salesbrain_core.commands.deals.update_deal
  → kernel: deal_visibility ∧ deal_rules → UPDATE deals, INSERT gate_events + audit
  → returns {deal, events:[board_review_requested]}
  → ring deliver_events posts the Telegram board card → JSON back to the LLM
```

### 3.2 Web deal chat → Hermes api_server

`POST /api/agent` (`app/api/agent/route.ts`) does not run its own LLM loop any more.
`lib/hermes-proxy.ts` finds or creates one Hermes session per (user, deal) in the
`agent_sessions` table, streams the turn from the Hermes api_server on
`127.0.0.1:8642` as SSE, and re-emits the legacy NDJSON events the `Chat.tsx`
component understands. The ring's middleware reads `agent_sessions` to know who is
acting. (Older docs describing `lib/agent.ts` / `lib/tool-executors.ts` are historical —
those files are gone.)

### 3.3 Web routes and MCP endpoints → kernel (subprocess RPC)

The Node process cannot import Python, so `lib/mcp/kernel-rpc.ts::kernelCall` spawns
`python -m salesbrain_hermes.rpc` once per call with a base64 JSON request
`{tool, args, actor_user_id}` in an env var. `rpc.py` dispatches to the **same**
registered handler the chat agents use, so RBAC, rules and audit live only in the
kernel. One process per call = zero idle RAM on the small box. Long-running tools
(Leads Finder step, enrichment) get a longer timeout via `LONG_RUNNING_TOOLS`.

The same channel serves `__catalog__`, so `/api/mcp` never keeps its own copy of the
tool list — a tool added to the ring is live over MCP with no app change.

### 3.4 Background agents

```
systemd timer / Hermes cron → assets/scripts/<agent>.py
  → kernel policy: should_run? (kill switch, enabled, paused, budget, backoff)
  → start_run (agent_runs row) → work step (ring helper e.g. prospecting_core)
  → kernel writes results → finish_run → deliver.notify_user (Telegram digest)
```

Anything needing a human decision files a row (`outreach_approvals`) and posts a
card to the *owner's* Telegram; the tap comes back through `board_callbacks.py`, or
the decision is made on `/agents` in the web app, or by the partner app over the
service MCP. Postgres is the mailbox between agents — Hermes has no agent-to-agent
messaging.

---

## 4. Where does X live? (rule of thumb)

| If it is… | Put it in | Example |
|---|---|---|
| A rule, a query, a state transition, a budget check | **core** `policy/` (pure) or `commands/` (DB) | gate advancement, ICP scoring, outreach queue |
| A tool the LLM calls, a Telegram/LinkedIn/email side effect, a prompt, a schedule | **hermes** `tools/`, `deliver.py`, `assets/` | `crm_outreach_propose`, daily outreach cron |
| A page, a REST route, an MCP endpoint, anything a human or another app clicks | **app** `app/`, `components/`, `lib/` | `/agents` page, `/api/service-mcp` |
| New schema | **core** `migrations/0NN_*.sql` | `032_agents.sql` |

Worked example — the **Outreach agent**:

- core: `policy/outreach.py` (rules), `commands/outreach.py` (queue, approvals,
  decide, mark result), `commands/agents.py` (shared registry, runs, budgets).
- hermes: `outreach_agent.py`, `tools/outreach.py`, `assets/scripts/outreach_queue.py`,
  `assets/routines/outreach-prompt.txt`, `assets/skills/salesbrain-outreach-agent/`.
- app: `app/agents/` + `app/api/agents/` (enable, kill switch, approvals),
  `app/api/outreach/`, `lib/service-mcp/` (partner-app access).

---

## 5. Adding a feature end to end

Order matters because of the dependency direction. Land in core, then hermes, then app.

1. **Schema** — `salesbrain-core/migrations/0NN_name.sql`, idempotent, additive only.
   Also append to `salesbrain/db/schema.sql` for fresh installs.
2. **Kernel** — pure decision in `policy/`, with a test in `tests/`. DB work in
   `commands/`: take `Actor`, compose `deal_visibility` where deals are touched,
   write an audit row, return a dict (+ `events` if something should be sent).
3. **Ring** — add a `dict(name="crm_…", mcp=…, schema=…, handler=…)` to the right
   `tools/*.py` `TOOLS` list, wrapping the command with the `_run` pattern. Update the
   roster count in the `test_*_tools_shape.py` test. If the LLM needs guidance, edit
   the skill under `assets/skills/`.
4. **App** — call it with `kernelCall('crm_…', args, session.userId)` from a route, or
   direct SQL for simple owner-scoped reads (see `/api/prospects`). UI in `app/` +
   `components/`. If the partner app should get it, add it to `SERVICE_TOOLS` in
   `lib/service-mcp/dispatch.ts` and regenerate `docs/service-mcp.md`.
5. **Docs** — add a dated entry to `CLAUDE_CONTEXT.md` §5; keep `docs/external-api.md`
   / `docs/service-mcp.md` in sync if a public surface changed.

---

## 6. Local setup

Prereqs: Node 20+, Python 3.11+, [`uv`](https://docs.astral.sh/uv/), access to the
shared Supabase `DATABASE_URL` (there is **one** database for dev and prod — treat every
write as live).

```bash
cd "Sales CRM"

# kernel
cd salesbrain-core && uv venv && uv pip install -e ".[dev]" && uv run pytest && cd ..

# ring (installs core editable from the sibling folder)
cd salesbrain-hermes && uv venv && uv pip install -e ../salesbrain-core -e ".[dev]" \
  && uv run pytest && cd ..           # L1 contract tests need HERMES_SRC=/path/to/hermes-agent

# app
cd salesbrain && npm install && cp .env.example .env.local   # ask for the real values
npm run dev                            # http://localhost:3000
```

Definition of "done" before you say a change is finished:

```bash
# app
npx tsc --noEmit && npx next build
# kernel + ring
(cd salesbrain-core && uv run pytest) && (cd salesbrain-hermes && uv run pytest)
```

Kernel commands that hit the DB need `DATABASE_URL` (or `SALESBRAIN_DATABASE_URL`) in
the environment; pure policy tests run without it. The app's `kernelCall` needs
`HERMES_VENV_PYTHON` pointing at a venv that has both packages installed (locally: the
hermes workspace venv); without it those routes fail while the pages still render.

Env vars for the app are listed in `CLAUDE_CONTEXT.md` §6. Server-side agent env lives in
`/root/.hermes/.env` on the box (never in the repos).

---

## 7. Database

- One Supabase Postgres, `pg` in the app, `psycopg` in the kernel, no ORM anywhere.
- Migrations are **two streams**: legacy `salesbrain/db/migrations/001–019` (frozen
  history) and `salesbrain-core/migrations/020+` (the live stream). A few later
  app-only files also exist under `salesbrain/db/migrations/` (030–032); their numbers
  collide with core's — always look in *both* folders before picking a number, and
  prefer the core stream for anything new.
- Applied by hand from the integration session (`python -m salesbrain_core.store.migrations`
  or the `node -e` snippet in `CLAUDE_CONTEXT.md` §7). CI never applies migrations.
- Key tables: `users`, `deals` (+ `gate_events`, `conversations`), `board_decisions` /
  `board_votes`, `accounts`, `contacts`, `prospects`, `icp_profiles`,
  `linkedin_accounts`, `agent_definitions` / `agent_runs` / `icp_agent_state`,
  `outreach_approvals`, `prospect_enrichment`, `agent_sessions`, `agent_audit_log`,
  `mcp_tokens` / `service_tokens` / `external_employees`.
- Ownership grain is the **user**: `owner_user_id` on prospects/contacts, `user_id` +
  `lead_id` on deals. There is no org/tenant layer.

---

## 8. Shipping

Everything ships from the `Production` branch of each repo; `main` is integration.

| Repo | Trigger | What happens |
|---|---|---|
| salesbrain | push `Production` | `.github/workflows/deploy.yml` SSHes to the EC2 box, writes `.env.production` from secrets, `npm install && npm run build`, `pm2 restart salesbrain` (port 3002 behind Caddy) |
| salesbrain-hermes (+ core) | push `Production` on hermes | One pipeline for both: checks `pyproject.toml` versions match, builds both wheels, installs into the Hermes venv, ships skills/scripts/units, restarts the gateway. **Never** edits `config.yaml`, **never** enables timers |
| manual full deploy | `bash scripts/deploy-server.sh` from the hermes repo | Same plus config and cron routine setup; used when a new agent's schedule must be created |

Rules that have bitten us, so they are hard rules:

- Core and ring versions in `pyproject.toml` must be equal or the deploy fails.
  (The `__version__` strings inside the packages lag and are not checked.)
- Enabling a systemd timer or a cron routine is a deliberate manual act on the box,
  never a side effect of a deploy.
- Production is `root@13.63.148.158`. The old DigitalOcean droplet hosts an unrelated
  project — never deploy or SSH there from this codebase.

---

## 9. Working in parallel

`Sales CRM/ws.sh` creates a feature workspace `ws-<feature>/` containing worktrees of all
three repos on `feat/<feature>`, with its own `node_modules` and venvs (hermes installs
core editable from the sibling worktree, so imports follow the branch).

```bash
./ws.sh new my-feature 3001    # create; run the app on PORT=3001
./ws.sh sync my-feature        # merge main into the feature after main moves
./ws.sh rm my-feature          # after merge
```

Feature branches: commit only on `feat/*`, never bump versions, never apply migrations,
never deploy. The root repos on `main` are the integration session that merges, bumps
the lockstep version, applies migrations and deploys. Two features that edit the same
kernel module or table should run one after the other, not in parallel.

---

## 10. Conventions and gotchas

- TypeScript strict; `npx tsc --noEmit` is the typecheck. Parametrised SQL only.
- Every route starts with `const session = await getSession(); if (!session) 401`.
- Deal visibility: non-admins see `user_id = me OR lead_id = me`. Any new deal query
  copies this. In the kernel use `deal_visibility(actor)`.
- CSS variables: `--bg`, `--bg-card`, `--bg-input`, `--border`, `--text`,
  `--text-muted`, `--accent`. (`--card` in old code is wrong.)
- The ring identity middleware never elevates `crm_linkedin_*` tools to org-wide in the
  board group: LinkedIn inboxes are personal.
- `_send` tools are never exposed over the public MCP (`rpc.py::_NEVER_EXPOSE`);
  approval-gated sending is the only path out.
- LinkedIn (Unipile) has daily budgets and a safe-rate guard; every spending tool
  counts against them whether triggered by chat, UI, timer or the partner app.
- The Amir user has two accounts (`amir@test.com` admin web login vs
  `amir@chipchip.social`); check row ownership before concluding "it doesn't show".

## 11. Further reading

| Doc | Read it when |
|---|---|
| `CLAUDE_CONTEXT.md` (repo root) | You need the feature-by-feature history, env vars, test data |
| `docs/relationship-os-architecture.md` | You want the "why" behind kernel / ring / app |
| `docs/service-mcp.md`, `docs/mcp-integration.md` | You touch either MCP endpoint |
| `docs/external-api.md` | You touch `/api/public/*` (zeami.io) |
| `docs/user-guide.md` | You want to see the product the way the team uses it |
| `docs/telegram-bot.md` | You touch the bot or board voting |
| `salesbrain-core/migrations/README.md` | Before writing a migration |
