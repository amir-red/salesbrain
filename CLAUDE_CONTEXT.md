# SalesBrain — Project Context for Claude

This file is a self-contained briefing for a fresh Claude session (e.g. moving from one machine/IDE to another). Read it first; it'll bring you up to speed on the project, the architecture, what's shipped, what's broken, and the conventions we follow.

Long-term plan history lives in `~/.claude/plans/lazy-orbiting-sky.md` — every major feature has a plan entry there. Skim it if you want the design rationale for a specific feature.

---

## 1. What this is

**SalesBrain** is a B2B sales + grants CRM with an AI agent at its core. The agent (Claude Sonnet 4.5) chats with the user about each deal, captures structured info into the DB via tools, advances deals through a gate-based pipeline, sends board-review messages via Telegram, drafts outreach emails via Resend, and triggers a post-sale client onboarding workflow.

**Two products live in the same CRM:**
- **Zeami** (formerly "Mate") — a work-intelligence + automation-readiness platform. SALES pipeline.
- **ChipChip** — Ethiopian agri-commerce platform. GRANT-funding pipeline (donor-facing, money-first discipline).

**Users:** internal sales/grants/PM team. There's no customer-facing product surface inside this CRM (clients hit a public form at zeami.io only).

**Production URL:** `https://salescrm.chipchip.social` (Caddy → PM2 → Next.js on port 3002, server `root@13.63.148.158`, project at `/srv/salesbrain`). Hosted on AWS EC2 (eu-north-1, Elastic IP) since the 2026-08-23 cutover. The old DO droplet `104.248.139.55` was rebuilt 2026-08-24 and now hosts the unrelated personal-assistant project — never deploy or SSH there from this project.

**Local dev:** `npm run dev` on port 3000. `.env.local` has the same env vars listed below.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 14 (App Router)** with TypeScript strict mode | All API routes under `app/api/*` |
| DB | **PostgreSQL via Supabase** (`pg` driver, no ORM) | Connection string in `DATABASE_URL`. Pooler endpoint. |
| Auth | **`iron-session` + `bcryptjs`** | Session cookie `salesbrain_session`; sealed with `SESSION_SECRET`. Helper: `getSession()` in `lib/auth.ts`. |
| AI / agent | **Hermes Agent** (Nous Research) on the server runs every agent turn; the app has NO agent loop. Web chat = a Hermes api_server session (`lib/hermes-proxy.ts`). App-side one-shot model calls share `lib/llm.ts` (`MODEL` = Bedrock `claude-sonnet-4-6`; CI forbids literal ids). | Kernel = `salesbrain-core` (Python), plugin = `salesbrain-hermes`. See `docs/architecture.md` and §5.af. |
| Email | **Resend** via `lib/email.ts` → `sendEmail({to, subject, body})` | `RESEND_API_KEY` + `EMAIL_FROM` |
| Telegram | The **Hermes gateway** owns the bot(s): chat, `/start LINK`, board votes, approval buttons. App only mints link codes and can nudge the board. | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOARD_CHAT_ID` (app); gateway tokens live in the Hermes `.env` on the box. |
| Styling | **Tailwind v4** + CSS variables for dark theme | Vars: `--bg`, `--bg-card`, `--bg-input`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-glow`. Defined in `app/globals.css`. **Note:** old code may use `var(--card)` — the correct var is `var(--bg-card)`. |
| Process mgr | **PM2** | `ecosystem.config.cjs` runs port 3002 |
| Reverse proxy | **Caddy** | Adds `X-Forwarded-Host` / `X-Forwarded-Proto` |
| Deploy | **GitHub Actions** on push to `Production` branch | `.github/workflows/deploy.yml` SSHes to the server, writes `.env.production` from secrets, runs `npm install && npm run build && pm2 restart`. Kernel + ring: `salesbrain-hermes/scripts/deploy-server.sh` ONLY — core/hermes have no `Production` branch and no deploy workflow (retired 2026-10-24: their branches were frozen at 2026-09-08, so a stray run would have rolled the box back ~30 versions). |
| Excel | **`xlsx` (SheetJS) + `hyperformula`** | For pricing tool. Server-side only. |
| Graph viz | **`cytoscape` + `cytoscape-fcose` + `react-cytoscapejs`** | For `/network` page. Lazy-loaded. |

---

## 3. Code layout

```
salesbrain/
├── app/                              # Next.js App Router
│   ├── api/                          # All HTTP endpoints
│   │   ├── agent/route.ts            # Stream NDJSON from the chat agent
│   │   ├── deals/                    # Deal CRUD + sub-resources
│   │   ├── onboardings/              # Client onboarding workflow
│   │   ├── pricing/                  # Pricing tool + quote endpoints
│   │   ├── public/                   # zeami.io-facing (API-key auth)
│   │   ├── auth/                     # Login, signup, password reset
│   │   ├── telegram/                 # Bot webhook
│   │   └── cron/                     # SLA decay, daily digest
│   ├── (page routes)/                # /, /pipeline, /deals/[id], /onboarding, /pricing, /network, /clients, ...
│   ├── admin/pricing-tool/           # Versioned pricing-tool upload UI
│   └── forms/onboarding/[token]/     # PUBLIC client form (dev fallback)
├── components/                       # Shared React components
│   ├── Sidebar.tsx                   # Nav (Deals, Pipeline, Reports, Followups, Clients, Discovery, Prospects, Campaigns, Approvals, Pricing, Onboarding, Network, Imports, Inbox)
│   ├── Chat.tsx                      # Deal chat UI streaming from /api/agent
│   ├── DealPricingPanel.tsx, PricingForm.tsx, PricingResult.tsx
│   ├── NetworkGraph.tsx, NetworkFilters.tsx, NetworkDetailPanel.tsx, NetworkInsights.tsx
│   └── (more)
├── lib/                              # Server-side helpers, pure utilities, types
│   ├── agent.ts                      # AI agent loop + history loader + system prompt
│   ├── tool-executors.ts             # exec_update_deal, exec_send_telegram, exec_send_email, ... (the agent's tools)
│   ├── tools.ts                      # TOOLS array passed to Claude
│   ├── gates.ts                      # SALES_GATES (9) + GRANT_GATES (10) + helpers
│   ├── db.ts                         # pg Pool
│   ├── auth.ts                       # iron-session helpers
│   ├── email.ts                      # Resend wrapper
│   ├── telegram.ts                   # Telegram bot client + message formatter
│   ├── onboarding.ts                 # PURE helpers (client-safe). STAGES, prefillFromDeal, composeKickoffEmail, etc.
│   ├── onboarding-server.ts          # Server-only helpers (DB + email). issueFormToken, sendOnboardingKickoffEmail
│   ├── pricing/inputs.ts             # Pricing Zod schema, defaults, CELL_FALLBACKS map
│   ├── pricing/engine.ts             # SheetJS + HyperFormula engine
│   ├── public-api.ts                 # Shared auth/CORS helpers for /api/public/*
│   ├── network-graph.ts              # buildGraphFromData
│   ├── prospect-tools.ts             # 12+ AI tools for prospecting/outreach
│   ├── prospect-executors.ts         # Implementations of the prospect tools
│   ├── google-oauth.ts               # Gmail + Google Contacts integration
│   ├── grant-pipeline-rank.ts        # Opportunity-cost ranking for grants
│   ├── decay.ts                      # SLA-decay metrics
│   └── file-extractor.ts             # mammoth (DOCX) + PDF/image classifier
├── db/
│   ├── schema.sql                    # Full schema for fresh installs
│   └── migrations/                   # 001..008 — incremental migrations
├── docs/
│   ├── CLAUDE_CONTEXT.md             # ← this file
│   └── external-api.md               # zeami.io integration spec
├── middleware.ts                     # iron-session auth gate, with whitelist for /login, /api/public, /forms, etc.
├── ecosystem.config.cjs              # PM2 config
└── .github/workflows/deploy.yml      # SSH-deploy to server
```

---

## 4. DB schema (current state)

All migrations have been **applied to Supabase**. `db/schema.sql` is the canonical "fresh install" reference. Tables:

| Table | Purpose |
|---|---|
| `users` | name, email, password_hash, role (`'admin'` or `'user'`) |
| `deals` | The CRM root. `gate` 1–10, `deal_type` `'sales'`/`'grant'`, `fields` JSONB, `lead_id` (project lead), `user_id` (creator), `value`, `currency`, `notes`, `flags[]`, `missing[]` |
| `conversations` | Per-deal chat log — flat rows by role. Roles: `'user'`, `'assistant'`, `'tool_use'`, `'tool_result'` |
| `gate_events` | Audit trail of every gate transition |
| `followups` | Scheduled emails + reminders |
| `board_decisions` | Telegram board review state machine. Multi-voter (5/8 threshold). |
| `board_votes` | Individual executive votes |
| `password_resets` | Token table (SHA-256 hashed, 1h expiry) |
| `file_attachments` | Per-deal chat file uploads (mammoth-extracted text + PDF/image base64) |
| **`accounts`** | Companies (org-wide). `name`, `domain`, `website`, `industry`, `company_size`, `hq_location` |
| **`contacts`** | Per-user (privacy-scoped) people. `owner_user_id`, `account_id`, `communication_profile` JSONB |
| **`prospects`** | Pre-deal pipeline. Stages P0_IMPORTED → P9_ARCHIVED. `owner_user_id`. |
| **`imported_messages`** | Per-user inbound emails / LinkedIn messages (Gmail sync + paste) |
| **`oauth_tokens`** | Google OAuth refresh tokens per user |
| **`client_onboardings`** | Post-G9 onboarding rows. Stages 1–8. `pm_user_id`, all stage-specific fields, `deployment_plan`, `primary_contact_email` |
| **`onboarding_form_links`** | Token table for the public Stage-2 client form (mirrors `password_resets` shape) |
| **`pricing_tools`** | Versioned Excel uploads. Partial unique index on `is_active`. |
| **`pricing_quotes`** | Per-deal (or what-if) calculated quote snapshots. `inputs`/`outputs`/`pnl` JSONB. |

### Migration files (run in order, all applied):
1. `001_password_resets.sql`
2. `002_file_attachments.sql`
3. `003_client_onboardings.sql`
4. `004_deployment_plan.sql` — adds `deployment_plan` to onboardings
5. `005_grandfather_g7_board.sql` — flag backfill for G5→G7 board move
6. `006_*` — (skipped — no number 6)
7. `007_onboarding_primary_contact.sql` — adds `primary_contact_email`
8. `008_pricing.sql` — pricing_tools + pricing_quotes tables

---

## 5. Major features (chronological, with key files)

### 5.1 The agent runtime — Hermes (Phase 5, 2026-07; `lib/agent.ts` et al. deleted)

- `POST /api/agent` (`app/api/agent/route.ts`) checks deal visibility, then `lib/hermes-proxy.ts` opens/reuses a
  Hermes **api_server** session (`HERMES_API_URL`, `HERMES_API_KEY`; mapping in `agent_sessions`), streams
  the turn (SSE → the legacy NDJSON union `text|tool_start|tool_result|done|error`), and appends
  `[context] deal_id=…`. History hydrates from `GET /api/sessions/{id}/messages`.
- Tools, identity (`tool_request` middleware reading `agent_sessions` / Telegram links), memory (custom
  `MemoryProvider`) and skills live in `salesbrain-hermes`. The 5-phase history sanitizer, `buildSystemPrompt`
  and prompt caching described in earlier versions of this file no longer exist in this repo.
- `lib/mcp/kernel-rpc.ts::kernelCall(tool, args, userId)` reaches the same Python handlers out of process
  (`python -m salesbrain_hermes.rpc`, request in env, 30 s / 180 s timeouts) for UI routes and both MCP endpoints.

### 5.2 9-gate sales + 10-gate grant pipelines (`lib/gates.ts`)

- Sales board gates: **G3** + **G7** (moved from G5 in May 2026 — see plan history).
- Grant board gates: G3, G7, G9.
- `requiredFields` per gate; `getMissingFields(gate, fields, dealType)` drives the agent's prompts.
- **Money-first discipline for grants:** at G1, `GRANT_MONEY_FIELDS` (`grant_amount_min/max`, `our_contribution`, `our_contribution_type`, `cofunding_split`) are required AND cross-gate enforced — even an existing grant past G1 is BLOCKED from advancement until those are filled. Implemented in `exec_update_deal`.
- **Deployment plan** is required at G7 (sales). Values: `'on_premise'` or `'saas_cloud'`. Carried into the onboarding row at G9.

### 5.3 Board review (Telegram, multi-voter)

- At G3/G7 (sales) or G3/G7/G9 (grant), agent calls `send_telegram` with a structured board summary.
- `board_decisions` row created with `votes_required: 5`, `votes_to_block: 4`, `total_voters: 8`.
- Votes arrive as replies in the board group and are counted by the ring's `pre_gateway_dispatch` hook (`salesbrain-hermes/src/salesbrain_hermes/board_hook.py`, no LLM in the vote path); button taps by the ring's callback handler. When 5 proceed → status flips to `approved`. Status visible on `/agents` and the deal page.
- Flag `board_sent_g${N}` on the deal prevents duplicate sends.
- G7 board summaries MUST include `deployment_plan` — enforced in the system prompt.

### 5.4 Pre-deal prospecting — now kernel + ring (`crm_prospect_*`, `crm_icp_*`)

10-stage pipeline P0–P9 (`salesbrain-core/.../commands/prospecting.py`). The app keeps three executors in
`lib/prospect-executors.ts` (create/import, convert to deal, research from URL); everything else — scoring,
sourcing, enrichment, drafting, sending — is kernel/ring (§5.x–§5.af). The old `send_outreach_message` path
and the `outreach_messages` table it read are gone (2026-09-23): every send is an approved
`outreach_approvals` row.

### 5.5 Look-alike from won deals (planned only, not built)

Plan exists but no code. Skip unless asked.

### 5.6 Voice input + mobile + activity timeline + daily digest + decay monitor + meeting prep

Voice input (`webkitSpeechRecognition`), mobile layout and the activity timeline shipped and remain. The daily digest, decay monitor and `prep_meeting` were part of the deleted in-app runtime; their successors are the ring's attention digest (§5.af) and `crm_*` tools.

### 5.7 Google integration (`lib/google-oauth.ts`)

- Gmail + Google Contacts read-only sync.
- OAuth scopes: `userinfo.email`, `contacts.readonly`, `gmail.readonly`.
- Reverse-proxy-aware redirect via `publicUrl()` helper that respects `X-Forwarded-Host/Proto` and `NEXT_PUBLIC_APP_URL`.
- Sync endpoint returns `error_messages: string[]` array with `[where] message` for each error so the UI can debug.

### 5.8 File upload in chat

- DB: `file_attachments` table.
- `mammoth` extracts DOCX text. PDF/image go as native content blocks to Claude.
- `POST /api/deals/[id]/files` accepts multipart upload.
- Agent route accepts `attachment_ids[]` in the request body.

### 5.9 LinkedIn CSV import via file upload

`POST /api/imports/contacts` — multipart, 10 MB cap, parses `parseLinkedInContactsCsv` from `lib/message-parsers.ts`. Creates accounts (org-wide) + contacts (per-user) with dedup.

### 5.10 Network graph `/network`

- Cytoscape force-directed (`fcose` layout) graph of LinkedIn contacts.
- 5 layouts: Industry cluster, Company cluster, Location cluster, Lead-stage, Relationship strength.
- Filters: industry, company, location, title contains, has email/phone/linkedin, last contacted, has prospect, has deal.
- Search dims non-matching nodes.
- **AI Insights** panel has TWO modes:
  - **Chat** (default): user types "find me people in Tech who…", Claude calls `highlight_contacts` / `filter_graph` / `clear_view` tools to drive the graph. Results render as clickable cards.
  - **One-shot insights**: original "Generate insights" report with 5 categories.
- Performance: `textureOnViewport`, `hideEdgesOnViewport`, `hideLabelsOnViewport`, haystack edges, `min-zoomed-font-size: 8`.

### 5.11 Client onboarding kanban `/onboarding` (post-G9)

- 8 stages: Company Info → Contacts → Access & Communication → Briefing → Employee Setup → Deploy Zeami → Audit → P&L Report.
- **Auto-created** when a sales deal hits G9 via the agent (hook in `exec_update_deal`). Manual fallback: "Start onboarding" button on `/onboarding`.
- PM assignment: per-onboarding, defaults to the deal's `lead_id`. Admin-only reassignment via dropdown on `/onboarding/[id]`.
- **Welcome email** fires automatically on creation: combined welcome + Stage-2 form-link CTA via Resend.
- **Stage 2 public form** at `https://zeami.io/onboarding/<token>` (hosted on zeami.io; salesbrain provides the API at `/api/public/onboarding/[token]`). Token-based auth + API key (`ONBOARDING_API_KEY`). After submission, the same URL renders a live progress timeline polling every 30s.
- **Stage 3 IT-Admin email**: PM enters download URL + temp credentials, clicks Send. Credentials cleared from DB after send. Auto-advances to Stage 4.
- **Deployment plan** carried from G7 (`'on_premise'` or `'saas_cloud'`). Shown on Stage 1.
- **Primary contact email** seeded from `deals.contact_email`, editable.
- **Company profile** (website, size, description) seeded from `deal.fields` (with website inferred from email domain if absent) — see `prefillFromDeal()` in `lib/onboarding.ts`.

### 5.12 External API for zeami.io (`/api/public/*`)

- **Auth:** shared `ONBOARDING_API_KEY` via `X-API-Key` header OR `Authorization: Bearer …`. Same-origin requests bypass (in-app dev fallback). CORS via `PUBLIC_FORM_ALLOWED_ORIGIN`.
- **`GET /api/public/onboarding/<token>`** — prefill + live progress (form view if `submitted_at == null`, timeline view if not).
- **`POST /api/public/onboarding/<token>`** — submit form. Single-use enforced via `used_at`. Atomic.
- **`GET /api/public/deals`** — list deals with filters (`deal_type`, `gate`, `status=won|active|all`, `updated_since`, `q`, `limit`, `offset`). Returns slim summaries.
- **`GET /api/public/deals/[id]`** — full single-deal context: `deal`, `company`, `contact`, `insights` (curated subset of `deal.fields` + `raw`), `onboarding` (full onboarding state including all stage-specific data, `pm` name/email, `contacts`, `access`, `briefing`, `employees`, `deployment`, `audit`, `pnl`, `stage_completions`).
- **`OPTIONS`** for CORS preflight.
- Shared helpers in `lib/public-api.ts`.

Full spec: `docs/external-api.md`. Send to zeami.io's developer.

### 5.13 Pricing tool integration (Excel-as-engine)

- **Approach:** Excel stays source of truth. Server loads the `.xlsx` from disk, writes inputs by named range or fallback cell coord, evaluates via HyperFormula, reads outputs.
- **Tables:** `pricing_tools` (versioned uploads, one active), `pricing_quotes` (snapshots per deal).
- **Engine:** `lib/pricing/engine.ts` uses `XLSX.read` + `HyperFormula.buildFromSheets`. Critical: `sheetToArray()` forces range to start at A1 so HyperFormula's 0-indexed columns match (the Excel uses column B onward, so the original SheetJS range starts at B → would shift everything left by one). Bug we already hit and fixed.
- **Inputs:** ~25 fields. Schema in `lib/pricing/inputs.ts`. 8 visible in the form, rest in Advanced expander.
- **Outputs:** 15 named outputs (pilot_price, year_1_total, ROI, payback, etc.) plus 2 P&L outputs (year_1_revenue, year_1_gross_profit).
- **Cell fallback map:** `CELL_FALLBACKS` in `lib/pricing/inputs.ts` covers every name with the literal cell coord for the user's current Excel. Lets the system work today, even before named ranges are added. Once user adds named ranges in Excel, those are preferred.
- **UIs:** `/pricing` (standalone what-if), `/admin/pricing-tool` (upload + activate), `DealPricingPanel` (on `/deals/[id]`).
- **Permissions:** Originally admin-only for upload/activate; **changed in May 2026 — any authenticated user can now upload + activate**. Audit trail via `uploaded_by`.
- **Access:** "Manage versions →" link in the top-right of `/pricing` goes to `/admin/pricing-tool`. Sidebar has a "Pricing" nav item.
- **One-time Excel hygiene:** user should add named ranges to make cell mapping robust to row inserts. List of names in the plan doc.

### 5.14 Visibility model

Standardized after May 2026 cleanup:

| Surface | Who sees | Rule |
|---|---|---|
| `/` home deal list (`GET /api/deals`) | Creator + assigned lead, admins see all | `user_id = me OR lead_id = me` |
| `/pipeline` kanban | Org-wide | Intentionally open — team transparency |
| `/deals/[id]` detail page | Org-wide | Cards on pipeline stay clickable |
| Agent chat (`runAgent`) | Creator + assigned lead | Same rule as deal list |
| Chat history (`/api/conversations/[dealId]`) | Creator + assigned lead | Same rule |
| Timeline (`/api/deals/[id]/timeline`) | Creator + lead + admin can see conversation entries; gate events / board / followups visible to all | Mixed |
| Write operations (file upload, etc.) | Creator + admin only | Conservative |

### 5.15 Sales board review move (G5 → G7) — done

- G5 renamed to **"Internal Sign-off"** (no longer a board gate).
- G7 (Negotiation) flipped to board gate.
- `lib/tool-executors.ts` `isBoardPass` check updated.
- `app/pipeline/page.tsx` `SALES_GATE_COLORS` swapped.
- `lib/agent.ts` system prompt updated (`sales: G3/G7`).
- Migration `005_grandfather_g7_board.sql` backfills `board_sent_g7` on all sales deals at G7+.

### 5.16 Rename Mate → Zeami — done

All product-name references renamed. Old conversations in DB may still say "Mate" (historical text — not rewritten).

---

### 5.x ICP builder (`/icp`, 2026-08-28) — Gojiberry-inspired

Web UI for the `icp_profiles` row that `crm_prospect_search` sources against and every prospect is scored by. Before this, ICPs could only be defined through the agent (`crm_icp_define`).

- **Page** `app/icp/page.tsx` — list cards (prospect count, summary, "Source from LinkedIn" → `crm_prospect_search`, Archive) + `components/icp/IcpBuilder.tsx` (5 numbered sections: product/website → roles + seniority → industries/locations/sizes → exclusions → weights) with a sticky right rail showing the derived Sales Navigator ask and a **Preview matches** dry run.
- **Vocabulary + bridge** `lib/icp.ts` — role groups (with LinkedIn `function` mapping), industries, location groups, size buckets, exclusion presets; `buildSalesNavFilters(criteria)` derives `filters` + `search_keywords` from the same chips, so sourcing and scoring can't drift. `components/icp/ChipSelect.tsx` is the reusable chip picker.
- **API** `app/api/icp` (GET list / POST upsert, direct SQL like `/api/prospects`, audits to `agent_audit_log` as `icp_define`), `[id]` (GET/PUT/DELETE=soft archive), `preview` (→ kernel `crm_icp_preview`, scoring stays in Python), `[id]/search` (→ `crm_prospect_search`), `suggest` (website → draft ICP via `lib/llm.ts`; nothing persisted). Shared zod schema in `lib/icp-server.ts` (route files may only export handlers).
- **Scorer additions** (core 0.20.0, `policy/icp.py`): `company_sizes[]` scored under a new `size` weight (default 0 → legacy profiles unchanged; builder sets 10 when sizes are chosen), `exclude_companies[]` = hard disqualification on word boundary, `size_bucket()` snaps "201-500 employees" / "1,000+" to LinkedIn's ladder. `company_size` now flows into `qualify` and `auto_qualify_contacts`.
- **Ring** (hermes 0.20.0): `crm_icp_preview` (read, no writes/quota) and `crm_icp_archive`; roster tests updated (`crm_prospect_*`/`crm_icp_*` = 12).
- Not done: company *type* (private/public/non-profit) — no data column and no Unipile filter for it; intent signals (job change, funding, competitor followers) remain the known gap vs Gojiberry.

### 5.y Background agents: Leads Finder (`/agents`, 2026-08-29) — core/hermes 0.21.0

The first agent that runs UNATTENDED. Gojiberry-style: for every active ICP, four times a day, take one Sales Navigator page, score + store, research the best new ones, advance a per-ICP query cursor, log the tick, DM the owner a digest. Amir chose "fully autonomous" — the guard rails are policy-as-data, not a human in the loop.

- **Registry + run log** (`salesbrain-core/migrations/032_agents.sql`): `agent_definitions` (name, kind timer|routine, schedule, policy_key), `agent_runs` (trigger timer|manual|chat|requested, status, source, analyzed/matched/created/researched, detail) = the Activity feed, `icp_agent_state` (variant_index, page_cursor, backoff, exhausted_at), `linkedin_accounts.agent_*` (auto-pause after N provider errors), `outreach_approvals` (phase 2), policy rows `agents.kill_switch`, `agents.leads_finder` (searches_per_account_per_day 12, results_per_run 40, research_per_run 5, backoff ladder), `agents.outreach` (disabled).
- **Decisions are pure** (`policy/leads_finder.py`): `search_variants` (ICP keywords → title chunks → chunk×location, ≤12), `next_query` (page on cursor, else next variant; wrap = exhausted), `backoff_until`, `should_run` (kill switch → enabled → paused → budget → exhausted → backoff, with the reason). `commands/agents.py` holds state: `leads_finder_plan` (SERVICE actor spans owners), `start_run/finish_run/skip_run/request_run/claim_requested`, `searches_today` (manual + chat + timer all count), `advance_icp_state`, account error/pause/resume, `activity_feed`, `agent_status`, `set_agent_enabled`.
- **One search step for every path**: `salesbrain-hermes/src/salesbrain_hermes/prospecting_core.py::run_icp_search` (+ `research_top`). `crm_prospect_search` now runs through it as `trigger='manual'` and refuses when the daily budget is spent.
- **Daemon**: `assets/scripts/leads_finder.py` (systemd `leads-finder.timer` 07/11/15/19:20 + 30 min jitter; NOT enabled by CI — dry-run then `systemctl --user enable --now leads-finder.timer`, see deploy-server.sh NOTES). Chat delegation = `crm_agent_request_run` leaves a `requested` row the next tick drains first.
- **Tools** (`tools/agents.py`): `crm_agent_status`, `crm_agent_activity`, `crm_leads_finder_run` (one step now), `crm_agent_request_run`, `crm_agent_set_enabled` (admin), `crm_agent_resume_account`. Skill `salesbrain-prospecting` §2 rewritten ("you steer it, you don't loop it").
- **App**: `/icp` cards show a run pill + "Leads →" → `components/icp/IcpLeads.tsx` (list + Activity tabs, "Find more now" / "Queue a pass" → `POST /api/icp/[id]/run {mode}`); `/agents` page (registry, enable/disable, kill switch, paused accounts + Resume, global feed) over `/api/agents`, `/api/agents/runs`, `/api/agents/resume`; `/api/icp/[id]/{leads,activity}`.
- **Outreach agent (phase 2, 2026-08-29, ships DISABLED)** — a Hermes cron routine (`assets/routines/outreach-prompt.txt`, `--script outreach_queue.py`, daily 10:00, created by `deploy-server.sh`). The script gates (kill switch, `agents.outreach.enabled`, `runs_per_day`), expires stale drafts, opens an `agent_runs` row and prints the queue (kernel `agents.outreach_queue`: researched, `icp_score >= min_score`, never contacted, reachable = email handle OR existing LinkedIn thread on the owner's account). The routine engages → dossier → judge → policy → drafts → **`crm_outreach_propose`** (files an `outreach_approvals` row + posts a 👍 Send / 👎 Skip card to the OWNER's private Telegram; no supervisor fallback) → `crm_agent_finish_run`. Decisions: button tap → `board_callbacks.py` `oa:` namespace → `outreach_agent.handle_decision` (kernel `decide_outreach` checks the tapper is the owner via `telegram_user_links`); or `/agents → Pending approvals` / `crm_outreach_decide`. **Approve = send now** through the same gate a human uses (`record_outreach` / `linkedin.send_message` → `deliver_outreach`), outcome written back onto the card (`mark_approval_result`, prospect → P5_SENT). Enable after a dry run: `python scripts/outreach_queue.py` on the box, then flip `agents.outreach.enabled` on `/agents`.
- **Hermes Workspace "Assistants" (2026-08-30)** — a Workspace assistant = a Hermes **profile** (`/root/.hermes/profiles/<name>/`). Our agents are cards there for identity + chat only: `assets/profiles/{outreach,leads-finder}/{SOUL.md,description.txt}` applied by `deploy-server.sh` (`hermes profile create`, SOUL.md copy, `config set model.*` so the card isn't "needs setup"; NO .env / plugin / clone). Two hard facts drive this: the multiplexing gateway only fires the **default** profile's cron (a schedule inside a profile never runs), and card chat opens `agent:main:ops-<profile>` on the default gateway (SOUL.md is ignored there). So the schedule is the default-profile cron **`ops:outreach:daily`** (the `ops:<profile>:` name is what binds the job to the card — "1 scheduled job"), and the persona lives in skills that load in both places: `salesbrain-outreach-agent`, `salesbrain-leads-finder`. The Leads Finder card stays "Manual only" (it's a systemd timer, not a cron). Never create jobs from the Workspace card form — it sends no prompt/profile.
- **First live pages (2026-08-30, 0.21.1–0.21.5)** — lessons baked into the scorer: ICP regions expand to countries (`REGIONS`), rank abbreviations normalise both ways (`_PHRASES`: CFO ⇄ Chief Financial Officer), single-word titles are demoted by prefixes ("Finance Business Partner" ≠ Partner), partner = founder band, `qualify` never lets a researched HQ override the person's own location. `crm_icp_rescore` re-scores a list (the ICP editor calls it on save). Sales Navigator gives no company: `prospecting_core.research_top` now fetches the profile (`unipile.get_profile(sections="experience")` → `current_company`) for the top new people and attaches the employer (`set_prospect_company`) before research — that's what turns a 72 into an 86 with industry/size. Unipile instance moved to `api58.unipile.com:18822` (key in both `.env`s + the GitHub secret; the hermes deploy does NOT manage UNIPILE_*).
- **Enricher agent (2026-08-30, 0.22.0, ships DISABLED)** — third agent: employer (LinkedIn profile fetch, budgeted), company research + website/domain, email. Email sources are pluggable (`email_sources.py`: hunter/apollo/fullenrich ready, keys manual in `/root/.hermes/.env`); live source at launch = free in-DB google_contacts match only (`agents.enricher.email_provider: "none"`). Every attempt logs to `prospect_enrichment` (retry_days, credit counters, GDPR source disclosure); low-confidence addresses are logged but written NOWHERE; suppression_list honored and adopted in migration 033. `crm_enrich_prospect` runs one prospect from chat; "Enrich now" on the ICP Leads view queues it. Scorer's `reachable` weight (default 0) lets an ICP credit "email on file".
- **Pattern for the next agent**: registry row + policy row + script (+ routine prompt + skill for LLM work) + timer or `hermes cron create`; act as the owner via `_actor_by`; write `agent_runs`; notify via `deliver.notify_user`. Hermes has `delegate_task` and a kanban queue but NO agent-to-agent messaging — Postgres is the mailbox.

### 5.z Outreach-as-a-Service — dedicated service MCP for a sibling app (2026-08-31, app-only, migration 032)

Exposes the FULL outreach pipeline (ICP → Leads Finder → Enricher → draft → approve → send) to **another internal app we own**, so its own employees run outreach for their own clients. **App-only, no core/hermes change, no version bump** — the kernel is already multi-tenant on `owner_user_id` and `kernelCall(tool, args, ownerId)` already reaches the `mcp=None` outreach tools (ring `rpc.py` dispatches by name; the `mcp` flag only hides from `tools/list`).

- **Surface** `POST /api/service-mcp` — a SECOND MCP endpoint (JSON-RPC 2.0), separate from `/api/mcp`. Whitelisted in `middleware.ts` (`api/service-mcp$`, bearer-authed). Own curated catalog in `lib/service-mcp/dispatch.ts` (`SERVICE_TOOLS`) that deliberately includes the send/spend tools the public MCP hides.
- **Two-layer identity**: (1) `Authorization: Bearer svc_…` = which APP (one token per app, table `service_tokens`, hashed like `mcp_tokens`); (2) `X-On-Behalf-Of: <employee_id>` = which of its users. The other app **registers each employee up front** (`register_user`), which provisions an un-loginable SalesBrain `users` row (migration-022 sentinel hash) and stores the map in `external_employees(app_key, employee_id → salesbrain_user_id)`. Every later call resolves the employee → owner; **unregistered employee = rejected** (register-then-use). One SalesBrain user per employee is the grain (no org/tenant layer exists).
- **Tools** (`lib/service-mcp/`, 33 as of 2026-09-13): `register_user`, `suggest_icp` (partial input → scored ICP candidates, LLM, saves nothing), `crm_icp_define`/`crm_icp_preview`/`crm_icp_list`/`crm_icp_archive`/`crm_icp_rescore` (full ICP management; archive = standby, re-define same name revives; rescore after edits), `crm_leads_finder_run`/`crm_agent_request_run` (+ observability: `get_run_status` poll loop, `crm_agent_activity`, `crm_agent_status`, `crm_linkedin_quota`; the spending tools are budget-guarded and attach the fresh quota + near-limit warnings), `crm_enrich_prospect`, `list_leads` (direct SQL, owner-scoped), `crm_outreach_propose`, `crm_outreach_pending`, `crm_outreach_decide`, and LinkedIn onboarding (`linkedin_connect_start`/`linkedin_unbound_accounts`/`linkedin_link_account`/`crm_linkedin_status`/`crm_linkedin_revoke` — revoke added 2026-09-05: kernel passthrough that unbinds AND deletes the Unipile account via the ring's `linkedin_disconnect` event). Kernel tools pass straight through `kernelCall`; audit → `mcp_audit_log` with `{app_key, employee_id}` in `input`.
- **Decisions**: approvals render in the OTHER app's UI (`crm_outreach_pending` → `crm_outreach_decide`, not Telegram); each employee connects their OWN LinkedIn + email; **shared data pool** — external rows live in the same `prospects`/`accounts` tables, owned by the mapped user (recoverable as external-origin via `external_employees`). Reachability caveat: fresh LinkedIn leads with no existing thread are email-only (no cold invites).
- **Admin**: mint tokens in the UI at `/profile → Service API` tab (admin-only, `components/profile/ServiceTokenPanel.tsx`) or `POST /api/admin/service-tokens {app_key,name}` (shown once); `lib/service-mcp/tokens.ts`. Rate limits: 120/min per app token + per-tool sub-limits (`lib/service-mcp/auth.ts`). Full contract for the other app's dev: `docs/service-mcp.md`.

### 5.aa Relationship graph — warm-intro Phase 1 (2026-09-06, core/hermes 0.28.0, migration 038)

The ingestion foundation for warm introductions. Design of record:
`docs/research/03-warm-intro-spec.md` (§1-2 = this; §3-9 = later phases). **No pathfinding, no intro
campaigns, no reply detection yet.**

The problem it fixes: nothing in the schema recorded "A knows B". `relationships.person_id` is UNIQUE so it
models person↔us, not a pair, and `linkedin_relations` is a change detector that skips every row on its first
run by design — so an established account's existing connections were never stored anywhere.

- **`person_edges`** (migration 038) — owner-scoped, `src_person_id NULL` = the owner (the red node),
  `source` + `direction` + `strength` 0-1 + `evidence` jsonb. Unique on
  `(owner, COALESCE(src, sentinel), dst, source)` — a plain unique index would not dedupe the owner's own
  edges, since NULLs are distinct (the hole 037 closed for `agent_runs`). Structural overlaps (same employer,
  same school) are deliberately NOT stored — they get derived at query time in Phase 2.
- **`graph_sync_state`** — per owner. `relations_page_cursor` is Unipile's opaque pagination cursor and is a
  DIFFERENT thing from `linkedin_accounts.relations_cursor`, which is a timestamp high-water mark.
- **The contacts→people bridge** — `contacts.person_id / linkedin_slug / connected_on`. These were two
  disconnected identity spaces with no FK between them; imported CSV contacts are the cheapest 1st-degree
  ring there is. NOTE: the "12,932 contacts" figure repeated across this repo is STALE — as of 2026-09-06 the
  live table holds 850 rows, only 230 of them from the LinkedIn CSV import, so the free sources yield a much
  thinner graph than the design assumed. `identity.ensure_people_bulk` promotes them set-based and writes NO `relationships` row (13k
  `stage='stranger'` rows would flood `network_insights` and the attention allocator).
- **`policy/graph.py`** (pure) — `strength = base[source] x 0.5 ^ (days/half_life)`. An undated signal scores
  `undated_recency` (0.5), NOT 1.0: pre-existing CSV contacts have no date, and scoring them as fresh would
  rank a 2014 acquaintance above last month's conversation. All constants in `policy_rules['agents.graph_sync']`.
- **`commands/graph.py`** — four zero-cost sources (contacts / threads / email / relations) plus
  `record_relations_page`, which advances the cursor only AFTER a page commits, so a rate-limit refusal or a
  crash re-fetches at worst one page. Owner-scoped with no admin bypass; `graph_plan` is SERVICE-gated like
  `list_connected_accounts`.
- **`graph_sync` timer agent** (ships DISABLED) — `assets/scripts/graph_sync.py` + `graph-sync.timer`
  (02:10/14:10 Addis, away from every other sweep — two sweeps on one account collide on the guard's 6s
  min-gap). `--probe` prints a real `users/relations` response shape: **Unipile's max page size and cursor key
  are unverified**, so probe before enabling. `relations_reserve` holds back budget for the hourly
  `linkedin_sync` poll, which spends ~24/day of the free 60 on the same action class.
- **Ring tools** `crm_graph_sync` / `crm_graph_status` / `crm_graph_edges`; all three on the service MCP
  surface. `crm_agent_request_run` now takes `graph_sync` with no `icp_id` (owner-scoped dedupe index in 038),
  and the service surface no longer refuses to queue it for an employee without LinkedIn.
- **App** — `/network` gets a status strip + browsable strongest-edges list (`components/network/GraphPanel.tsx`,
  `/api/graph`, `/api/graph/sync`). The contacts CSV import now persists `connected_on`, batches its inserts
  (was ~35k queries for a 13k-row file), and queues a graph sync.
- **Fixed on the way:** `normalize_handle('linkedin', ...)` now strips `?query` strings (a mis-normalized handle
  mints a duplicate person nothing merges); `resolve_or_promote` matches an indexed slug column instead of
  `LIKE '%slug%'`, which was a 13k-row seq scan AND a correctness bug (`%amir%` matches `amir-hassan`);
  `deploy-server.sh` had `VERSION=0.22.0` against pyproject 0.27.0 and never scp'd `leads_finder.py`,
  `enricher.py`, `outreach_queue.py` or `grant_signals.py` — their systemd units pointed at absent files.
- ~~Disconnecting LinkedIn purges that owner's LinkedIn-derived edges.~~ Reversed 2026-10-18 (0.52.1, §5.ar): a disconnect
  keeps the graph and the whole mirror; a reconnect adopts them.

### 5.ab Warm-intro Phase 2 — colleague identity + the second hop (2026-09-08, core/hermes 0.31.0, migration 040)

Spec §3-4 first half: the Phase 1 star (owner → 1st-degree) becomes a traversable 2-hop graph by making each
colleague a person node. NO ranking, NO target expansion, NO intro campaigns yet (Phase 3).

- **`users.person_id`** (migration 040, partial unique) — `commands/graph.py::ensure_owner_person` mints the node
  from the user's LinkedIn identity (email fallback; service-account addresses excluded). `graph_sync.py` calls it
  per owner before syncing. No new edge rows: a colleague's own owner-scoped `person_edges(src IS NULL, dst=X)`
  read as their outbound edges in someone else's search — the second hop is a join, always current.
- **`graph_reach`** (direct ring, 2-hop union, what each teammate adds) and **`who_can_reach`** (the traversal
  primitive Phase 3 ranks on). Ring tools `crm_graph_reach` / `crm_who_can_reach` (read-only), both on the
  service MCP surface (29 tools). `/network` strip: "+N within 2 hops via teammates" + invite nudge for
  teammates without LinkedIn.
- **Privacy, load-bearing**: crossing an owner boundary happens only inside the kernel and returns
  reachability + evidence for one tie. A colleague's contact list is never returned. Aggregate counts only.
- **Phase 1 silent failure fixed**: every mirrored thread had `attendee_public_identifier = NULL` (LinkedIn
  builds profile URLs on the opaque member id; `thread_payload` nulls the slug rather than corrupt the slug
  index), so `edges_from_threads`, the strongest source, produced zero edges. Member ids now live in a new
  `channel_handles.channel = 'linkedin_id'`; threads fall back to them and the relations mirror registers both
  handles so the same human converges on one row. Live: identifiable thread attendees 0 → 48.
- **LIVE since 2026-09-08 20:18 Addis (0.31.2)**: `graph-sync.timer` enabled (02:10/14:10 + jitter),
  `agents.graph_sync.enabled=true` (flipped from `/agents`). Probe verified Unipile's shape: cursor at
  top-level `cursor`, items carry `public_identifier` / `member_id` / `created_at` / `headline`. Both
  connected accounts mirrored to completion in one page (99 + 96 relations — small networks). Live edges:
  230 csv, 195 relation, 42 thread, 4 email. All five users now have a `person_id`.
  Two bugs the first run exposed, both fixed: (1) `upsert_edges` batches held the same (src,dst,source)
  twice — two threads with one person — and Postgres refuses `ON CONFLICT DO UPDATE` touching a row twice;
  `policy/graph.py::merge_duplicate_edges` collapses a batch first (0.31.1). (2) `runs_per_day` counted
  `agent_runs` ROWS, one per owner, so one sweep over five owners spent 2.5 days of budget; it now counts
  the max per-owner runs = sweeps (0.31.2). The `/agents` toggle covers only `enabled`; the other 13
  policy keys are still SQL-only — a `/admin/policies` editor was proposed, not built.
  (3) **The digest flood (fixed 0.32.3, 2026-09-12)**: once the sibling app had registered ~6 employees
  with LinkedIn, every 14:10 sweep posted one "⚠️ routed to you — Relationship graph — <owner>" digest per
  owner into the board group. Two causes: the gate compared `digest_min_edges` against `upserted`, which is
  the size of the ring (a sweep refreshes every edge), not its growth; and `deliver.notify_user` forwards an
  unlinked owner's message to the supervisor chat. Now `upsert_edges` also returns `inserted` (via
  `RETURNING (xmax = 0)`), `graph_sync.should_digest` gates on new edges only, and the digest is sent with
  `notify_user(..., fallback=False)` — the owner's own DM or nothing. Keep `fallback=True` (the default) for
  escalations; use `fallback=False` for any routine per-owner progress note.
  **Two Telegram destinations, by rule** (fixed on the box the same day): board content (reviews, votes,
  nudges) goes to the group via `TELEGRAM_BOARD_CHAT_ID`; supervision digests (`notify_owner` / `crm_notify`)
  and every unlinked-owner fallback go to Amir's admin DM via `SALESBRAIN_DIGEST_CHAT_ID=7666216888`.
  The box had it set to the group id; `deploy-server.sh` now resets it if it ever equals the board id again.
  Why 7666216888 and not 379316691 (`TELEGRAM_HOME_CHANNEL`, the account that votes): the supervisor path
  sends from @MateSalesCRMBot (`SALESBRAIN_BOARD_BOT_TOKEN`), and the 379316691 account has BLOCKED that bot
  (403 "bot was blocked by the user", verified 2026-09-12 — which is also why its `telegram_user_links` row
  was revoked 2026-09-08). 7666216888 is Amir's active link and receives. To move the supervisor chat back
  to 379316691: unblock @MateSalesCRMBot from that account, then change the env + `AMIR_DM` in the deploy
  script. The Hermes gateway bot (@SalesBrainZeamiBot, `TELEGRAM_BOT_TOKEN`) is the reverse: it reaches
  379316691 and not 7666216888.
  (4) **The flood came back (fixed 0.40.5, 2026-10-11)** — "⚠️ routed to you" graph / Leads Finder digests in the
  board group again. Cause: `_supervisor_chat()` fell back to `TELEGRAM_BOARD_CHAT_ID`, and the `crm` profile's
  `.env` (`/root/.hermes/profiles/crm/.env`, a COPY cloned 2026-09-23 from a main `.env` that still said
  `SALESBRAIN_DIGEST_CHAT_ID=<board id>`) is what the cron scripts resolved the digest chat from — the deploy
  guard only ever corrected the main `.env`. Now: the ring never uses the board id as the supervisor chat (unset or
  equal to the board id → the message is dropped, not posted), every routine per-owner digest (leads_finder,
  enricher, grant_signals per-owner, graph_sync) is `fallback=False` — owner's DM or nothing — and the deploy guard
  loops over `profiles/*/.env`. Only escalations keep the fallback (paused LinkedIn account, unowned grant signals,
  the attention routine's `crm_notify_user`). Rule: profile `.env` files are copies, not links — a fix to the main
  `.env` must be applied to each.
  Chat ids as of 2026-10-11 (DB, not the older note above): `7666216888` has been linked to the **Matthias** user
  since 2026-10-01 (Amir reads that account for the NRW campaign) and stays `SALESBRAIN_DIGEST_CHAT_ID`; Amir's own
  user re-linked `379316691` the same day, and @MateSalesCRMBot reaches BOTH (sendChatAction ok) — the 09-12 block
  is gone. Moving the supervisor chat to 379316691 is now a one-line env change if Amir wants it.
- **Still open from spec Phase A**: `person_facets`, automatic reply detection (`P6_REPLIED` is a stage nothing
  writes from inbound threads). Then Phase 3 = `crm_target_expand`, `crm_path_find`, `intro_campaigns`.

### 5.ac Route to a lead — warm-intro Phase 3a (2026-09-08, feat/warm-intro-route, migration 043)

Amir's reframe: the graph is a STEP in the lead's journey, not a map. Pipeline of record (mature outbound
standard, Amir's 1–6 verbatim): 1 ICP → 2 improve ICP → 3 find leads → 4 enrich → **5 route** → **6 draft**
(intro ask when a route exists, cold otherwise) → 7 approve/send → 8 follow-up → 9 reply detection → 10 deal.
This feature = steps 5–6 + the lead page as the journey. Steps 8–9 are NEXT (nothing writes P6_REPLIED yet).
Plan: `~/.claude/plans/but-let-s-step-back-buzzing-dongarra.md`.

- **The picture**: red = owner/teammate, blue = a person the owner can message NOW (email handle or an
  existing LinkedIn thread — `commands/warm_paths.blue_map`, which finally matches threads by member id),
  yellow = knows the lead but not reachable yet, green = the lead. **Hop one must be blue.**
- **Intermediary = ANY person in the graph**, not just a teammate. "B knows T" evidence, cheapest first:
  `linkedin_mutual` (**LinkedIn's own Connections-of search** — Unipile `connections_of` + `network_distance`
  filters, verified 2026-09-08; the 01-current-state note "not found" was WRONG), `email_cothread` (both on
  one Gmail thread; the Gmail sync now stores `participants`), same org, shared employer/school (from
  `people.facets`), a teammate's ring, a teammate's LinkedIn degree. First two are STORED non-star edges
  (`src_person_id IS NOT NULL`); structural overlaps are derived at query time, never stored.
- **Kernel**: `policy/warm_paths.py` (pure: beam search, `score = Π strength × hop_penalty^(hops−1)`,
  Yen-style diversity, bridge ranking, evidence text, `to_drawable` with a `hop` column per node),
  `commands/warm_paths.py` (`load_subgraph` — owner ring + teammates' edges INTO the target only + stored
  B→T + target-org people + derived overlaps; `path_find`; `edges_from_email_cothreads`; `intro_requests`
  helpers). Policy row `agents.warm_intro` (hop_penalty 0.5, base per source, `mutual_searches_per_day` 5 =
  a sub-budget of the search cap so route lookups never starve the Leads Finder, `intro_ttl_hours` 168).
- **Identity**: `prospects.linkedin_member_id` captured at upsert; `ensure_prospect_person` resolves member
  id → slug → email and attaches every handle WITHOUT engaging (`engage()` keys "already" on `engaged_at`).
- **Intro state**: table `intro_requests` (single-hop flattening of spec §6; `replied_at`/`next_followup_at`
  reserved for steps 8–9). `mark_approval_result` is kind-aware: a sent `intro_request` → `awaiting_reply`,
  never `P5_SENT` on the lead. `crm_propose_intro` fixed: recipient = connector, channel from `blue_map`,
  `prospect_id=None` + `intro_for_prospect_id=lead`, `forwardable_blurb` appended (double opt-in).
- **Ring**: `crm_path_find` (read), `crm_route_expand` (write: profile → facets, Connections-of search when
  2nd degree + shared count > 0, teammate probe, then path_find; `route_core.py`), `unipile.search(url=)`
  fallback for the raw LinkedIn URL form. `probe_cross_account_degree` shared by enricher + route.
- **App**: `/prospects/[id]` rebuilt as the journey (`JourneyStepper`, `RoutePanel` + `RouteGraph`
  (cytoscape preset layout, x = hop), `ApprovalsPanel`, intro-ask modal with AI draft via
  `lib/intro-draft.ts`), shared `lib/prospects.ts`, API `/api/prospects/[id]/{route-find,enrich,intro}`,
  IcpLeads "route · N hops / bridge / cold" badge. Service MCP (`docs/service-mcp.md` §8 "Route to a
  lead"): `crm_path_find`, `crm_route_expand` (guarded), `crm_propose_intro`; `list_leads` +
  `best_path_hops`/`path_available`.
- **Merged + deployed 2026-09-08 (0.32.1, migration 043 applied).** Live walk on Lesya Hendrix (2nd degree,
  fit 85, owner = the Zeami service user holding `amir-redwan`): `path_find` → no route (graph had nothing);
  `route_expand` → profile fetched (degree 2, `shared_connections_count` 1, 10 employers), the STRUCTURED
  `connections_of` filter worked first time (`mode: filters`, no URL fallback), 1 mutual found and stored as
  `linkedin_mutual` (+ the owner→B `linkedin_relation`), teammate probe 1 account / 0 hits. Result: **Yan
  Kwizera** named as the bridge — YELLOW, not blue, because we hold no thread/email with him.
- **Known gap surfaced by that walk — "1st degree but no thread" is yellow.** The blue predicate requires an
  existing LinkedIn thread or an email; a plain 1st-degree connection cannot be messaged by the ring because
  `send_message` only replies into an existing chat (Unipile has a start-chat endpoint we deliberately never
  used). Messaging a 1st-degree connection is normal human behaviour and NOT an invitation — allowing
  "start a chat with a 1st-degree connection" as a blue channel would have turned that route actionable.
  Decision for Amir; not built.
- 0.32.1 fixed a pre-existing `set_warm_paths` bug (owner-scope alias `p.` on an un-aliased UPDATE — admins
  never hit it, the first regular-user route lookup did).
- **Routes run as the LEAD'S OWNER (0.32.2, 2026-09-08).** The first lookup on a colleague's lead
  (Alemayehu, Yasin's) found nothing because the route ran as the CLICKING user (amir@test.com: no LinkedIn,
  empty graph) and the panel hid the skip reason. Now `lib/act-as.ts::resolveActingUser` makes an admin's
  Find route / Look up LinkedIn / Enrich / intro ask run as the lead's owner by default (toggle "run as
  <owner> | me"), audited as `act_as` next to the kernel's rows; the owner is derived from the prospect row,
  never a client uuid; non-admins always act as themselves. RoutePanel shows `expand.notes[]` and
  `profile.error`, and warns with a Connect-LinkedIn link when the acting user cannot source. Prospect GET
  returns `owner_can_source`, `viewer_can_source`, `acting_user_id`, `viewer`.
- **ONE AMIR (2026-09-08).** `store/merge_users.py` (dry-run default, `--apply` = one transaction, FK-catalogue
  driven, preflight-guarded, reusable) folded `amir@test.com` (admin login) and the Zeami service employee
  "Amir Redwan" (held the live `amir-redwan` LinkedIn, 340 prospects, 2 ICPs, 126 edges) into
  **`amir@chipchip.social`** — now admin, name "Amir Redwan", test.com's password, person `ae407bcb` with all
  three handles, Telegram 7666216888 kept (379316691 revoked), Zeami `external_employees` row re-pointed.
  Backup CSVs: `~/.cache/salesbrain/backups/pre-merge-20260908_230827/`. Amir logs in as
  amir@chipchip.social now. Yasin is ALSO a real user + a Zeami employee — merge later with the same script
  (needs a `--keep-linkedin` flag: both hold active accounts).
- **Still to verify live**: the member-id key on Sales Navigator people items (`_member_id` tries
  provider_id/id/member_id) — the profile fetch now backfills `linkedin_member_id` regardless.
  Not built: 3rd-degree yellows, posts engagement, reply detection, follow-up cadence.

### 5.ad ICP control panel (`/icp` overview + `/icp/[id]` drill-down, 2026-09-13, app-only)

One place to see how everything is happening for an ICP. `/icp` is now a **fleet overview**: `FleetStrip`
(kill switch, one chip per agent with last run + 24 h counters and admin enable/disable, the viewer's
quota bars, paused LinkedIn accounts + Resume) over one `IcpRow` per ICP (stage `FunnelBar`, coverage
emp/res/email/warm/route, `RunPill`, "won't run: <reason>", pending-approval badge, the old actions).
Each row opens **`/icp/[id]`**, the journey for that list in pipeline order: 2 · list funnel → 1 ·
Definition (criteria + fit distribution) → 3 · Leads Finder (variant, cursor, empty runs, backoff,
searches-today bar, 7-day sparkline, top finds, last runs) → 4 · Enricher (coverage over eligible leads,
7-day attempts kind × result, credits/profile-fetch bars, failures) → 5 · Graph & routes (owner graph
totals, mirror phase, degree split, hops histogram, shortest routes, Rebuild) → 6 · Outreach & intros
(pending via `ApprovalsPanel`, decided counts, intro asks in flight) → Leads (`LeadsTable`, stage/score/warm
filters, per-lead coverage dots) → Activity. The old in-place `IcpLeads` view is gone; `IcpLeads.tsx` keeps
`RunPill`, `ActivityList`, `DegreeWarm`.

- **Reads are direct SQL, polled** (`lib/use-poll.ts`: 45 s overview / 30 s drill-down, paused while the
  tab is hidden, one request at a time): `GET /api/icp/overview` (`?scope=all` admin) and
  `GET /api/icp/[id]/panel`; contract in `lib/icp-panel.ts`; quota port of the kernel's `linkedin_quota`
  in `lib/quota-server.ts` (searches = `agent_runs`, profile fetches + email credits = `prospect_enrichment`,
  LinkedIn action caps from `agents.linkedin_limits` over the Python DEFAULTS).
- **LOAD-BEARING: never `Promise.all` a fan-out of queries on a polled route.** The Supabase pooler runs in
  session mode with 15 clients shared with production; the first version of the panel route fired 22
  queries at once and 500'd with `EMAXCONNSESSION`. Both panel reads check out ONE client
  (`pool.connect()`), run their (merged) queries in sequence, and `ownerQuotas(ids, client)` takes it too.
- **Visibility**: `visibleIcp(id, session)` in `lib/icp-server.ts` = owner OR admin, and returns
  `owner_user_id` so prospects are scoped by the ICP's owner. This also fixed `GET /api/icp/[id]/leads`
  and `/activity`, which filtered prospects by the SESSION user, so an admin could never see a colleague's
  list. Write routes are unchanged: run/archive stay owner-only (buttons disabled with a tooltip for an
  admin on a colleague's ICP), pause/resume goes through the kernel, approve/skip only renders for the
  owner, Rebuild graph only for the owner (it is the session's own graph).
- Shared primitives for this and future panels: `components/panel/{SectionCard,StatTile,ProgressBar,
  FunnelBar,Sparkline}.tsx`. Other pages' private `MetricCard`/`Stat` copies were left alone.
- Not built: policy editor (`/admin/policies`), an `icp_id` filter on `/api/agents/approvals` (the panel
  embeds them), SSE. Latency from a laptop is ~2–4 s per panel load (30 sequential round trips to
  eu-west-1); from the EC2 box it is well under a second.

### 5.ae Users admin page + per-person agent holds (2026-09-13, core/hermes 0.33.0, migration 044)

Amir, from `/icp`: "for each user, what are the MCP, what is running for them, manage (pause / stop / continue /
delete) each agent, and add a filter." Decisions: **stop = hard off, no in-flight cancel**; **delete = archive an
ICP** (not the user); a **new admin page `/admin/users`**.

- **`user_agent_state`** (core migration 044) — `(owner_user_id, agent)` → `state` running | paused | stopped,
  `reason`, `changed_by`, `by_admin`, `changed_at`. No row = running. Both held states mean "the agent never
  plans this person until continued"; nothing in flight is cancelled and their queued `requested` rows wait.
  `by_admin` mirrors 039's `paused_by_admin`: the partner app acts AS the employee and must not lift an
  operator's hold. Pure rules in `policy/user_agent.py` (`hold_reason`, `refusal`, `can_lift`).
- **Kernel** (`commands/agents.py`): `set_user_agent_state` (owner or admin; admin may hold anyone),
  `user_hold`. `leads_finder_plan` LEFT JOINs the hold and returns held items under `held[]` — NOT `skipped[]`,
  so a hold writes no skip row per ICP per tick; `enricher_plan` / `outreach_queue` filter in SQL and report
  `held`; `graph_plan` exposes `hold_*` per owner and the script leaves them out. `request_run` /
  `_request_owner_run` refuse with the icp_paused shape: `{error, refused: true, status: "user_paused" |
  "user_stopped", agent, reason, by_admin}` — **a refusal, never a deferral** (no `resume_at`).
  **`claim_requested` excludes held owners in SQL**: the scripts claim before they plan and close unmatched
  claims as "nothing to do", which would have swallowed a held person's request. `agent_status` carries
  `user_states`. `policy/leads_finder.should_run` gained the `user_hold` rung right after "agent disabled" (an
  operator's hold is a decision, a paused account is a symptom).
- **Ring**: `crm_agent_set_user_state {agent, state, reason?, owner_user_id?}` (`owner_user_id` honoured for
  admins only). `holds.refuse_if_held` gates the four synchronous tools that bypass the planners
  (`crm_leads_finder_run`, `crm_enrich_prospect`, `crm_route_expand` as an enricher run, `crm_graph_sync`).
  Fixed on the way: `leads_finder.py` rebound `items` inside `for item in items`, so a paused account never
  short-circuited the rest of its ICPs (now a `skip_accounts` set).
- **App**: `/admin/users` (`lib/users-panel.ts` contract; `components/users/{UsersFilterBar,UserRow,AgentChip}`)
  over `GET /api/admin/users/overview?q=&app=` — admin only, ONE checked-out client, 13 sequential queries,
  `LIMIT 300`; `q`/`app` are server-side, agent/state/LinkedIn/running-now/errors filters are client-side
  (`applyClientFilters`). **Per-person outreach is derived from `outreach_approvals`**: the outreach run row is
  owned by the SERVICE user, so it never appears on an owner's feed. "Running now" is bounded to 6 h because
  stranded `running` rows exist. Writes: `POST /api/admin/users/agent-state` → `crm_agent_set_user_state`;
  Delete on an ICP = `POST /api/icp/[id]/state {state:'stopped'}` (admin-capable; `DELETE /api/icp/[id]` is
  owner-only). `GET /api/agents/runs?owner=` (admin) feeds the expanded row. `/icp` and `/icp/[id]` list a held
  owner in the blocker ladder ("Leads Finder is held for this user — …"). Sidebar gets its first role-gated
  item (`Users`, via `/api/auth/me`); links from FleetStrip and `/agents`.
- **Service MCP**: `crm_agent_set_user_state` passthrough (`owner_user_id` stripped — an app holds only its own
  employee); **fixed** `crm_agent_request_run` decorating a kernel refusal as `status: "requested"` (it now
  returns refusals unmodified — this also corrects today's `icp_paused` response). `docs/service-mcp.md`
  §8 + changelog; 33 tools.
- Not built: cancel-in-flight (the owner chose hard-off), deregistering an employee (no `revoked_at` on
  `external_employees`; `contacts`/`prospects` FKs would block a hard delete anyway), a policy editor.

### 5.af Move the agent layer into Hermes (2026-09-23, feat/hermes-native, migrations 045 + 046)

The 2026-09-21 audit (`Sales CRM/AUDIT.md`, artifact "SalesBrain on Hermes") found the product running *beside*
Hermes: 8/10 workers on systemd with no agent turn, 119 tools in one toolset, our own LLM client / delivery /
approvals / mailbox, four private Hermes seams, pin 11 releases behind, and human approval enforced by prompt
text. Decision: keep the kernel (tenancy, RBAC, budgets, approvals-as-rows, **the send gate**); move triggers,
fan-out, aux LLM, delivery and the learning loop into Hermes. Plan: `~/.claude/plans/salesbrain-hermes-logical-toast.md`.

- **Phase A — the floor.** (1) **Kernel send gate** (core 045, `commands/outreach.py::send_gate`): a touch
  that will be delivered (`record_outreach(..., for_delivery=True)`, `linkedin.send_message`) must consume an
  approved, owner-decided `outreach_approvals` row (`consumed_at` set atomically — one send per approval) or,
  only when `policy_rules['outreach.gate'].mode == 'policy_lanes'`, pass a kernel-evaluated `autonomy.*` lane
  (`policy/autonomy.py`: non-commercial, listed channel, value ceiling; unknown value fails closed). Ships in
  `approval_required` mode; `autonomy.searchfunder` finally has a reader. `outreach_approvals.commercial` is
  recorded at propose time, shown on the card, and is what the commercial gate runs on at send —
  `approve_and_send` used to omit it, so approved cold drafts skipped that gate. `crm_send_followup` (the only
  un-gated customer email lane) now files a `kind='followup'` approval; the app's follow-up Send button
  proposes + decides in one request (a click is the decision). `crm_record_outreach` (logging a call/meeting)
  is not a delivery and needs no approval. The attention routine's "autonomous send" paragraph is gone; it files
  drafts. App: `app/api/outreach/**`, `exec_send_outreach_message` and every `outreach_messages` reader deleted
  (the table had no schema anywhere); `PATCH /api/prospects/[id]` scoped to owner/admin. The three `_rule()`
  copies collapsed onto `policy/outreach._rule`. (2) **Toolset split**: each `tools/*.py` declares its family
  (`crm_deals` 27, `crm_grants` 17, `crm_agents` 15+ping, `crm_prospecting` 14, `crm_linkedin` 13, `crm_people` 12,
  `crm_outreach` 9, `crm_graph` 7, `crm_delivery` 4; `salesbrain_hermes.ALL_TOOLSETS`); `crm_core` no longer
  exists — configs list families. (3) `__version__` reads the installed distribution; `docs/architecture.md`
  and `docs/telegram-bot.md` rewritten for the post-Phase-5 system; dead `CRON_SECRET` /
  `TELEGRAM_WEBHOOK_SECRET` / `PUBLIC_FORM_BASE_URL` dropped from deploy; dead notify helpers removed.
- **Phase B — scheduling into Hermes.** The seven deterministic sweeps (leads_finder, enricher, graph_sync,
  linkedin_sync, grant_signals, board_nudge, pmi_sync) are `hermes cron --no-agent --script` jobs, created by
  `deploy-server.sh` by name and **hard-replacing** the systemd timers (units deleted). Shared contract
  `assets/scripts/_cron.py`: detail JSON → stderr (run log), ONE delivered line on stdout only when work
  happened, `{"wakeAgent": false}` otherwise, exit 1 on failure (they used to `sys.exit(0)` on every error).
  Config is written with `hermes config set` (no regex); `platform_toolsets.cron` = the five families the
  routines need. App `lib/service-mcp/schedule.ts` follows the cron expressions.
- **Phase C — Hermes 0.21.4 (v2026.9.21), public seams only.** `identity.py` reads the turn's task-local
  session vars (`gateway.session_context.get_session_env`: platform / user id / chat id) — no more `state.db`
  reads. `board_hook.py` replies via `ctx.dispatch_tool("send_message")` (the private
  `gateway._adapter_for_source` is gone upstream) and pairs a linked user via `PairingStore.generate_code →
  list_pending → approve_request`. `llm.py` routes aux calls through `ctx.llm` under the registered
  `salesbrain_aux` auxiliary task (model in `auxiliary.salesbrain_aux.*`); the urllib Bedrock client remains
  only as the out-of-process fallback for cron scripts. **`telegram_buttons.py`** handles `bv:`/`oa:` inline
  taps inside the gateway (`ctx.register_telegram_handler`, pattern-scoped, early group) — `board_callbacks.py`
  and its unit are deleted; no second poller on the CRM bot. `deploy-server.sh` runs the box upgrade only with
  `UPGRADE_HERMES=1` (pre-flight, HERMES_HOME tarball, checkout tag, deps, `config migrate`); CI pins v2026.9.21
  and `test_contract_registry.py` asserts every public seam we rely on (fails on 0.19.0, as it should).
- **Phase D — senses (core 046).** `commands/replies.py::record_reply` is the one writer of "they answered":
  `P6_REPLIED` (from P4/P5 only), `last_replied_at`, `reply_status`, `next_followup_at = NULL`, an INBOUND
  `interactions` row (caps finally see both directions), `intro_requests.replied_at`, pending follow-up drafts
  expired, `reply_events` ledger (idempotent on provider message id), owner DM. Sources: `sync_thread` emits
  `reply_received` for a new `is_sender=false` message on a thread matched to a prospect (member id → handle →
  slug; `linkedin_sync.py` and `crm_linkedin_sync` record them via `salesbrain_hermes.replies`), and the app's
  Gmail sync calls **`crm_record_reply`** for a received mail from a P4/P5 prospect (also on the service MCP —
  34 tools). **`/sales-leads` mirrors every conversation (0.42.1, 2026-10-13, core migration 054,
  `commands/sales_leads.py`)**: a sent message (`mark_approval_result`, kinds outreach/followup — never `connect`)
  creates the prospect's row as `contacted`; a reply (`record_reply`) creates it as `replied` or lifts it. One row per
  prospect keyed on `raw_payload.prospect_id`, each event appends a dated line, the ladder new → contacted → replied
  only moves forward (converted/archived untouched), written in a savepoint so the mirror never costs the caller's own
  write. No Telegram post. The page shows summary cards + per-tab counts (`GET /api/sales-leads` returns `counts`)
  and a Replied tab; Contacted = everyone we messaged (replied ⊂ contacted) in the list, the counts and `crm_list_sales_leads`. Cadence: `mark_approval_result` bumps `touch_count` and arms `next_followup_at` from
  `agents.followup` (`spacing_days [4,7,10]`, `max_touches 3`, ships **disabled**); `followup_queue` feeds the
  outreach routine's new `followups` list (skill §2b: touch N+1, shorter, one new useful thing,
  `kind='followup'` → same card, same gate). `list_leads` returns the contact/reply columns.
- **Phase E — L4 (core 047).** (1) **Supervisor** — the first agent that NOTICES: `commands/supervisor.py::
  supervisor_queue` builds a per-owner dossier (per-ICP coverage, searches vs empty searches, funnel, approve/skip
  counts, replies, stalled leads) and raises deterministic SIGNALS (`thin_list`, `search_exhausted`,
  `searches_mostly_empty`, `low_approval_rate`, `no_replies`, `stalled_leads`); the routine
  `ops:supervisor:daily` (08:30, skill `salesbrain-supervisor`) reasons over them and files **proposals** —
  `outreach_approvals` rows of `kind='proposal'` with a whitelisted `proposal.action` (`queue_search`,
  `queue_enrich`, `queue_graph_sync`, `followup_now`, `archive_prospect`, `note`). Same card, same 👍/👎;
  approving runs `apply_proposal` (kernel commands a human could have issued — never a send). Capped per owner
  (`agents.supervisor.proposals_per_owner`), ships disabled. (2) **Learn** — `ops:learn:weekly` (Sun 07:00) reads
  the week's approved vs rejected drafts and replies (`learn_queue.py`) and may propose ONE `skill_manage` patch
  to `salesbrain-outreach-agent`; `skills.write_approval: true` stages it for `/skills approve` — it is never
  applied alone. Our skills are git-deployed READ-ONLY into `skills.external_dirs`
  (`/root/.hermes/skills-salesbrain`); agent-authored ones go to `skills.create_dir` (`skills-agent`). Ships
  disabled (`agents.learn`). (3) **Delegation** — `platform_toolsets.cron` gains `delegation` (+ `skills`); the
  attention and outreach prompts fan out one `delegate_task` per person when a queue has >2 items (children
  inherit the crm_* families and cannot send). (4) **Real profiles** — `deploy-server.sh::routine` creates a
  routine's cron INSIDE its profile (`hermes -p outreach cron create`) when the operator has provisioned
  `/root/.hermes/profiles/<p>/.env` (per-profile cron ticks since Hermes 0.21); otherwise it stays in the
  default profile under the `ops:<profile>:` name the Workspace card binds to. `/agents` renders proposal /
  follow-up / "contains an ask" badges; `AGENTS` now includes `supervisor` and `learn`.
- **Hook replies bypass Hermes (0.35.1, 2026-10-01).** `send_message` is intentionally NOT a registered tool in
  v2026.9.21 (`tools/send_message_tool.py`), so `ctx.dispatch_tool("send_message")` returned "Unknown tool" and
  every `/start LINK-…` confirmation and board-vote reply was silently dropped from the 2026-09-23 upgrade on (the
  link / vote itself was recorded). `board_hook._send` now uses `deliver._send_telegram` (CRM bot), falling back to
  the gateway token. The tests stubbed `_send`; they now cover it. Never route a plugin reply through
  `dispatch_tool("send_message")`.
- **Known debt kept on purpose**: the app still writes `policy_rules` (kill switch), `icp_profiles`, `prospects`,
  `deals` directly; `lib/quota-server.ts` re-ports `policy/linkedin_limits.py`; 6 app-side LLM call sites remain.

### 5.ag Running costs — usage ledger + `/admin/costs` (2026-09-29, core/hermes 0.35.0, migration 048)

Amir: "is there a way to get how much it's costing us running?" Before this nothing in Postgres held a token or
a dollar: Hermes kept its own ledger for agent turns (`state.db`, `hermes insights`), and every other model call
threw the response's usage block away. Plan: `~/.claude/plans/on-the-agents-running-elegant-spring.md`.

- **`llm_usage`** (core 048) — daily buckets `(day, surface, feature, model, owner, hermes_session_id)` of
  calls + input / output / cache-read / cache-write tokens. **Tokens are stored, never money**: prices live in
  `policy_rules['costs.rates']` and are applied at read time, so correcting a rate re-prices history. The unique
  index COALESCEs owner to an all-`f` sentinel (all-zero is the service user's real id).
- **Four writers, one per call path** (`surface`): `hermes_turn` — the ring's `post_api_request` hook
  (`usage_hook.py`: every model call of web chat, Telegram, the cron routines and delegated children; worker
  thread, fail-open, feature = `cron:<job name>` or the platform); `hermes_aux` — `llm.py::_host_complete` reads
  `res.usage` (plus `post_auxiliary_call` for Hermes' own titling/compression, registered ONLY when the host
  has it — the pinned v2026.9.21 does not); `ring_fallback` — `llm.py::_bedrock_converse`, i.e. the model calls
  of the `--no-agent` cron scripts that no ledger saw; `app` — `lib/llm-usage.ts::createMessage`, which all 7
  app call sites now use instead of `anthropic.messages.create`. New call sites: use `createMessage(params,
  { feature, userId })` in the app and `converse(..., feature=)` in the ring.
- **Report** — kernel `commands/costs.py::cost_report(actor, days)` (admin), pricing in `policy/costs.py`
  (pure). LLM priced by model-name substring, an unknown model is reported as `unpriced_tokens`, never guessed.
  Unipile = connected `linkedin_accounts` x `unipile_account_month_usd`, prorated on `connected_at`/`revoked_at`
  (call volume does not change the fee). Email credits = `prospect_enrichment.credits` x `email_credit_usd`.
  Fixed items = `fixed_monthly_usd[]`. Plus monthly run rate and cost per lead (Leads Finder `created` only) /
  approved draft / reply. **`gaps[]` names everything not priced or not recorded** — quote it with the total.
- **One surface, internal management only**: `/admin/costs` (`GET /api/admin/costs?days=` →
  `kernelCall('cost_report')`, loaded on demand, not polled; 7/30/90 d). Sidebar `Costs` (admin), links from
  `/agents` and FleetStrip. **There is deliberately NO agent tool** (Amir, 2026-09-29): `cost_report` is an
  app-only RPC in `rpc.py::_internal()` — not registered with Hermes, not in the MCP catalogue, not on the
  service MCP. Put future admin-only kernel reads there, not in a `tools/*.py` list.
- **Rates are seeded as estimates and SQL-edited**: LLM = Anthropic list prices per MTok (Sonnet 4.6 3/15,
  Haiku 4.5 1/5, Opus 4.6 5/25; Bedrock bills separately — reconcile with the AWS invoice); Unipile 55 USD
  (from "~EUR 49", unconfirmed); email credit prices and EC2 / Supabase / Resend are seeded at 0 = "not set".
- Live numbers at build time (30 d, read-only check): 5 connected LinkedIn accounts (6 in window), 36 FullEnrich
  credits, Unipile calls 30.5k inbox_read / 4.0k profile_view / 1.7k relations / 295 search.
- **LIVE since 2026-09-29 (0.35.0)**: migration 048 applied, ring + app deployed, first agent turn recorded the
  same day. LLM history before that date is only in `hermes insights` and the AWS invoice.
- Not built: a rates editor, budget alerts / spend caps, backfill from `state.db` (history before the deploy
  stays in `hermes insights`), `agent_runs` ↔ usage join (no run id reaches the hook).

### 5.ah LinkedIn connection requests — approved, capped, tracked (2026-10-03, core/hermes 0.36.0, migration 049)

Amir, for the NRW campaign on Matthias Poschmann's account: "use Unipile to connect to people and track who we
sent to, who accepted, who did not, whom we never asked." This reverses "connecting stays a human gesture"
(unipile-trial-results §7) — under the product's one rule for sends: **a request is a draft the owner approves.**

- **Approval kind `connect`** (`outreach_approvals`, channel `linkedin`, message = the optional note, may be
  empty). Filed by `commands/invitations.py::propose_connect` (one lead) or `propose_connect_batch` (one ICP:
  best fit first, one person per company before a second, never more than the cap still allows). Same card,
  same 👍/👎, same `decide_outreach`. `mark_approval_result` leaves the prospect alone for this kind — a request
  is not a message: no `P5_SENT`, no touch, no cadence — and `outreach_queue` / `followup_queue` ignore it.
- **Gate** `consume_connect`: caps checked first (`policy/invitations.py`, `policy_rules['agents.linkedin_connect']`:
  `per_day` 5, `per_week` 25, `note_max_chars` 200, `no_answer_after_days` 21), then the approval is consumed
  atomically (one send per approval). Requests sent by hand count toward the caps. The Unipile guard has an
  `invite` class as a backstop only (`policy/linkedin_limits.py`; `users/invite` must classify above `users/`).
- **Send** (ring `outreach_agent._send_connect`): resolves the member id with one profile fetch when the lead
  only has a slug, skips the send if the profile says 1st degree, then `unipile.send_invitation`, then
  `record_invitation` writes the ledger. Never call `send_invitation` from anywhere else.
- **Ledger `linkedin_invitations`** (one row per account + member): `pending | accepted | not_accepted | failed`,
  `source` salesbrain | linkedin. The hourly `linkedin_sync.py` passes LinkedIn's sent list and the newest
  connections to `reconcile_invitations`: a pending row that left the sent list is `accepted` if the member is
  now a connection, else `not_accepted` (LinkedIn never reports a decline); a member who shows up later is
  corrected to `accepted`; a paginated (incomplete) sent list closes nothing; a row sent less than 12 h ago and
  never seen in the list is left alone. Accepting sets `prospects.network_degree = '1'`.
- **Lead state** is derived, never stored: `connected` (1st degree OR accepted) · `pending` · `no_answer`
  (pending ≥ 21 d) · `not_accepted` · `failed` · `not_invited` · `no_profile`. Kernel: `pi.lead_state`; the app
  ports it in `lib/connect.ts` (adds `awaiting_approval`) because the leads list is direct SQL — change both.
- **Tools**: `crm_linkedin_connect_propose`, `crm_linkedin_connect_batch` (both `mcp=None`),
  `crm_linkedin_connect_status` (read). 125 tools. Not on the service MCP.
- **App**: `/icp/[id]` Leads table gets a LinkedIn column + filter + totals strip, **Connect** per lead
  (`POST /api/prospects/[id]/connect`, runs as the lead's owner for an admin) and **Queue next N for approval**
  (`POST /api/icp/[id]/connect`, runs as the list owner). `ApprovalsPanel` labels the kind.
- **Fixed on the way**: `unipile._request` percent-encodes the path — a slug with ö/é raised
  `UnicodeEncodeError` on every profile fetch (8 NRW leads; their `warm_paths = []` rows still need a re-run).
- **UNVERIFIED against a live account**: the `users/invite` body and the `users/invite/sent` item keys
  (`unipile.sent_invitation` takes several spellings). Probe one real sent-list response before trusting the
  hand-sent tracking; the first approved request tells you whether the send shape is right.
- **0.36.2 (2026-10-03)**: `prospects.priority_rank` (migration 050, backfilled from `source_detail` "rank N") — the
  leads list and the connect queue follow the owner's own order first, fit second. **0.37.0 (2026-10-07)**: Amir:
  "ten taps for ten requests is not fast enough" → `crm_linkedin_connect_send_batch {limit, icp_id?, owner?}`
  (`connect_batch.py`): the owner's ONE chat instruction ("send the next 10") is the decision for the batch —
  each request is still filed, decided (`decide_outreach` by the owner), consumed by `consume_connect` and
  recorded; same caps. Paced ~8–16 s per person in a worker thread on the gateway (inline under the one-shot
  RPC process), one summary DM when done. Admin may pass `owner` (email), audited as `act_as`. Caps raised by
  Amir 2026-10-06 to 15/day, 75/week (`agents.linkedin_connect`) and the guard's `free.invite` to 15
  (`agents.linkedin_limits` row, now exists).
- Not built: withdrawing a pending request, an AI-drafted note, a first message after acceptance to a
  1st-degree connection with no thread (the gap in §5.ac), a policy editor for the caps.
### 5.ah.1 Find a lead's LinkedIn profile by name (2026-10-09, feat/linkedin-find, core/hermes 0.38.2, migrations 051 + 052)

Amir, on Stefan Ickler (NRW rank 54) showing "No profile" while Google finds him instantly: "how is that?".
Cause: the NRW list was imported as name + company + title; 129 of its 204 leads carried no LinkedIn URL, and
`prospects.linkedin_public_id` was only ever written at INSERT (`upsert_candidate`). Every LinkedIn step
(Enricher employer/warm, `route_expand`, `propose_connect`) starts from that slug and skipped them — **a missing
step, not a failure**: 0 of the 129 had ever been searched. Plan: `~/.claude/plans/you-said-there-s-not-splendid-toast.md`.

- **Pure rule** `policy/linkedin_find.py::pick(candidates, full_name, company, location)`: a candidate is STRONG
  when its name equals the lead's (titles, punctuation, diacritics stripped: "Prof. Dr.-Ing. Robert Gröning" =
  "robert groning") AND its headline names the company (legal forms dropped) OR its location shares a city/region
  (country words dropped). Exactly one strong → `found`; several → `ambiguous`; none → `no_match`. Amir's
  decision: auto-save only one strong match; everything else waits for a person.
- **Kernel** `commands/prospecting.py::set_prospect_linkedin` — the first writer of a slug after landing (also
  `contacts.linkedin_url/linkedin_slug`, then `ensure_prospect_person` for the handles). Refuses to overwrite; on
  the `(owner, lower(slug))` unique index it returns `duplicate_of` + `duplicate_rank` instead of failing — the
  same human sits on the NRW list twice (#54 JUMBO-Textil, #60 vombaur). Attempts land in `prospect_enrichment`
  **`kind='linkedin'`** (migration 051 extends the CHECK): result found | ambiguous | no_match | duplicate | error
  | candidates, `detail` = query, candidates (≤5), strong[], reason — so the UI offers the pick without a second
  search and `retry_days` keeps a miss from being searched daily. `enricher_plan` gains the kind (first in
  pipeline order, `linkedin_finds_per_run` 10, needs an unpaused Unipile account).
- **Ring** `linkedin_find.py::find_profile(actor, prospect_id, account_id, auto=True)` — one classic people
  search (`search_terms` drops legal forms), guard-bound to the owner's account (one `search` on
  `agents.linkedin_limits`), `pick`, write, log. Callers: `route_expand` step 0 (runs BEFORE the person node is
  minted so handles land on the right row; `expand.find`), `enrich_one` first step (default kinds now start with
  `linkedin`), the Enricher sweep (`profiles` / `ambiguous` counters, digest line), `crm_linkedin_find_person
  {prospect_id}` (auto=False: candidates + strong, writes nothing) and NEW **`crm_linkedin_link_prospect`**
  (the explicit pick; 127 tools). Both on the service MCP (36 tools).
- **App**: `lib/connect.ts` gains `awaiting_pick` (newest `kind='linkedin'` row is ambiguous/candidates) and
  `describeLookup`; `/api/icp/[id]/leads` joins that row as `profile_lookup`; `LeadsTable` gets **Find on
  LinkedIn** per no-profile lead, an inline **Pick (N)** candidate chooser ("likely" = strong, open ↗, Use this),
  and **Find next N on LinkedIn** on the totals strip (`POST /api/icp/[id]/find-linkedin`, ≤10 per click,
  sequential as the list owner, skips leads searched in the last 14 days, stops on the first refusal).
  `POST /api/prospects/[id]/find-linkedin {}` = `crm_enrich_prospect kinds=['linkedin']`;
  `{public_identifier, member_id?}` = `crm_linkedin_link_prospect`. Both run as the lead's owner for an admin.
- **Budget reality**: classic search is capped at 20/day/account by the guard (`free.search`), so the 129 NRW
  leads take ~7 sweeps unless Amir raises that cap for the push. Each lookup = 1 search.
- **LIVE 2026-10-09 (0.38.2, both migrations applied, box + Production deployed).** First walk on rank 54 as
  Matthias: search found exactly one Stefan Ickler but `no_match` — LinkedIn's search item says `location:
  "Ruhr Region"` (a metro label), the list says "Sprockhövel, North Rhine-Westphalia"; no literal word in common.
  **0.38.1**: `place_tokens` collapses multi-word states to one token, maps LinkedIn's German metro labels /
  known cities to their state (`_LI_REGIONS`) and drops directional words, so "Rhine" alone never ties Frankfurt
  to NRW. Rerun: `found` ("same place (nordrheinwestfalen)"), slug + member id + contact URL + two handles
  written. Rank 60 (vombaur): `duplicate` → "already lead #54" as designed — but its log row was silently refused:
  033 has a SECOND check, on `result`. **Migration 052** adds `ambiguous | candidates | duplicate`. Lesson: when
  adding an enrichment outcome, check BOTH constraints, and don't trust a best-effort logger to tell you.
- Not built: Sales Navigator search for the lookup (the `api` arg exists), re-running the 9 warm lookups that
  failed on the ö/é bug on 2026-10-03 (eligible again 2026-10-17), Matthias's failing `graph_sync` runs
  (`phase:mirror_pending` since 2026-10-05 — separate issue, not touched).

### 5.ah.1b Deep-dive profile discovery: web first, then LinkedIn, then company-first (2026-10-10, 0.40.0)

Amir found Mike Böing-Meßing on Google in one query while the product said "No profile". Of the first 14 lookups,
10 missed: 5 got ZERO LinkedIn candidates when name + company were searched together, 3 failed on name variants
(middle name / initial / double surname), 1 was "ambiguous" because five Thomas Fischers sit in NRW though only one
headline said "Owner, Fischer Elektronik". The LinkedIn classic people search rejects the `company` filter (400).
- **Ladder** (`salesbrain-hermes/linkedin_find.py::find_profile`, rungs `web → linkedin_name → linkedin_name_only →
  company_web`, stop at the first write): **web** = `web_find.py`, keyless DuckDuckGo (`ddgs`, the package
  `research.py` already used) `"<name>" <company words> site:linkedin.com/in`, parsed by
  `policy.linkedin_find.parse_web_hit` ("Name – Headline | LinkedIn"; posts skipped; slug URL-decoded, **lower() not
  casefold()** — casefold turns ß into ss and the slug stops resolving; `prospecting._slug` had the same bug, fixed).
  A web hit is **never written unverified**: one `get_profile` (profile_view class) re-runs the pick on the real
  name/headline/location. `linkedin_name_only` runs only when the fuller query returned nobody. **company_web** =
  `"<company>" (Geschäftsführer OR Inhaber OR CEO) site:linkedin.com/in`: the lead's own name there is a candidate;
  other people with a `leader_title` headline naming the company are verified and landed as NEW leads via
  `commands/prospecting.land_discovered_leader` (`source_type='company_discovery'`, `source_detail="found via <co> ·
  for lead #N <name> · company_web"`, same account + ICP, ≤2 per lead per run). Amir's decision: add them, don't
  just report. Every rung's candidates accumulate into `prospect_enrichment.detail` (`rung`, `queries`,
  `candidates[].source/rung`, `discovered[]`).
- **Rule changes** (`policy/linkedin_find.py`): `same_person_name` = same first name + a shared surname part
  (middle names/initials ignored, double surnames match on either half); tiers — company named in the headline
  (tier 1) beats a shared TOWN (tier 2); exactly one tier-1 wins even with tier-2 namesakes; the person's OWN
  surname is excluded from company evidence ("Fischer" in "T.Fischer-Technik" ≠ Fischer Elektronik). **Same state
  only is tier 3 = "possible"**: never written, shown in the picker with a yellow badge (0.40.1 — the first live
  batch auto-wrote a "Siegfried Schulte, Geschäftsführer, Cologne Bonn Region" for Schulte Elektrotechnik in
  Lüdenscheid; reverted). This also means Stefan Ickler's 2026-10-09 match ("Ruhr Region" vs Sprockhövel) would
  now wait for a pick — it was right, and stays.
- **App**: Find next **25** per click (web rungs are free; LinkedIn rung still guard-bounded), strong fits first;
  picker shows each candidate's rung; "via company: …" under the lead; a `via company` badge on discovered leads.
  `agents.enricher.linkedin_finds_per_run` default 25.
- **First live batch (26 leads, 2026-10-10)**: 10 found (5 web-verified, 5 LinkedIn), 3 → picker, 15 no match;
  NRW no-profile 127 → 120. Three ladder bugs found and fixed in 0.40.2/0.40.3: the LinkedIn search cap (20/day,
  hit mid-batch) also disabled profile verification and leader landing (budgets are now separate: `search_ok` /
  `profile_ok`); an unverified strong candidate was logged `found` without a write (now `candidates` with a
  "not written — confirm" reason; 4 rows relabelled); dedupe by slug dropped the company query's richer title
  ("Geschäftsführer bei …") when the person query had already listed the same slug with a truncated one
  (candidates now MERGE, richer headline wins, discovery runs over the company query's full result). One-word
  company names ("Kaiser") skip leader discovery — the web pads them with namesakes. The guard's search counter
  keeps counting REFUSED attempts (shows 45/20 after a batch) — cosmetic, not fixed. 0.40.4: DuckDuckGo's result set varies per call, so `search_company_leaders` runs a plainer second query (`"<company>" Geschäftsführer`) when the first returns no leader title. Verified: Jörg Deutz (CEO STAUFF) landed via Walter Stauffenberg; Waldminghaus found for Schulte Elektrotechnik but was already a lead; an assistant was correctly refused.
- DuckDuckGo is rate-limited (1.5 s pace, occasional empty answers); a paid web backend (Exa/Tavily key in the
  Hermes `.env` — none configured) is the upgrade path. Not built: Sales Navigator rung (no entitlement on
  Matthias's account), the classic `company` filter (schema unread).

### 5.ah.2 First message to a 1st-degree connection — the new-chat lane (2026-10-09, core/hermes 0.39.1)

Amir: "start sending a message to all the connected ones" (Fakuma, 12–16 Oct 2026, Friedrichshafen). This closes the
gap §5.ac named: the ring only ever replied into existing chats, so a connection with no thread could not be messaged.
Decision (Amir, by instruction): build it under the one rule for sends.

- **Kernel** (`commands/linkedin.py`): `propose_first_message(actor, prospect_id, text)` files a normal `outreach`
  approval on channel linkedin with **`linkedin_thread_id NULL`** — refuses no profile, not 1st-degree (degree '1' or an
  accepted request on this account), or an existing thread ("reply there"); `send_first_message(actor, approval_id)` =
  `record_outreach(..., for_delivery=True)` (send gate consumes the approval once + every outreach policy check) →
  `linkedin_start_chat` event; `record_chat_started` mirrors the new chat via `sync_thread` (state waiting, person
  linked, our message as the first row) so the hourly sync and reply detection see it at once.
  `policy/linkedin_limits.classify`: `POST chats` = `message` (was inbox_read).
- **Ring**: `unipile.start_chat` (POST /chats, JSON first, multipart fallback — Unipile documents multipart; the JSON
  form worked live), `outreach_agent._send_first_message` (profile fetch for a member id when only a slug; refuses if
  the profile is not degree 1), `approve_and_send` routes a linkedin approval WITHOUT a thread there, so the Telegram /
  /agents card works too. `message_batch.py` = the connect-batch pattern (file → decide → gated send → record, paced
  8–16 s, one summary). Tools `crm_linkedin_first_message_propose` (card) and **`crm_linkedin_first_message_send_batch
  {prospect_ids[], text, owner?}`** (the owner's one instruction decides the batch; admin may name the owner). Both
  `mcp=None`. 129 tools. `mark_approval_result` moves the lead to P5_SENT + touch (plain `outreach` kind).
- **Live 2026-10-09 ~14:00 Addis**: 21 NRW connections messaged from Matthias's account, each exactly once (audited:
  approvals + mirrored threads). The first batch was interrupted client-side after 11 but **the RPC process kept running
  on the box** and finished the list; the second run (text without "Hallo,") was refused per person by the thread check /
  the once-only gate — no duplicate went out. 18 got the "Hallo," text, 3 (Niedhart, Schmolke, Barlog) the
  greeting-free one. Lesson: an inline batch over ssh is not cancelled by killing the client; prefer the gateway
  (background thread) or `kill` on the box.
- **The connections dig (same day)**: `linkedin/search` classic with `network_distance: [1]` + ICP terms
  (Geschäftsführer, Kunststoff, …; 10 items/page, 9 searches) over Matthias's 1st degree → 35 people, 25 not on the
  list; 10 landed as `source_type='connections'` (research + a profile fetch for title-less headlines, `rescore_icp`).
  Matthias's `graph_sync` still errors every tick (`phase:mirror_pending`, error "0") — the full relations mirror would
  make this a query instead of searches. Not fixed.
- **Replies, live 2026-10-09/10**: five NRW leads answered within a day (Lob confirmed a Fakuma slot; two are not
  attending; Jannack on holiday). Detection + owner DM worked. Approving the agent's drafted LinkedIn reply on the
  Telegram card then failed twice, two bugs: (1) **0.39.2** `approve_and_send` sent every `kind='followup'` row down
  the EMAIL follow-up lane (`consume_followup`: channel email, no person) — the agent files LinkedIn replies as
  `followup` + `linkedin_thread_id`; the lane now requires `followup_id`, a LinkedIn follow-up is a reply
  (`kl.send_message`). The gate's refusal text also named the channel mismatch before the person one. (2) **0.39.3**
  `policy/outreach.check_frequency_cap` counted yesterday's first message as "1/1 in 24h" against a next-day reply;
  it now counts only outbound touches since the person's latest inbound. Rule of thumb: every send lane must be
  exercised once from the Telegram card, not only from the batch tool.
- **"Not yet messaged" was wrong (0.39.4, 2026-10-10).** `crm_linkedin_pending_followups` listed 12 connections as
  never messaged the day after 11 of them got the first message: it read `linkedin_relations.followup_state`, a flag
  only the manual `crm_linkedin_set_followup` ever wrote. The bot then looped the single propose tool, hit three
  "conversation already exists" refusals + Hermes's repeated-tool guard, and declared "all 12 already sent" with an
  invented explanation (two were truly unmessaged). Now: the queue is DERIVED (`_RELATION_MESSAGED`: a mirrored
  conversation holding a message from us — product or hand-sent — or an outbound LinkedIn interaction since
  detection); `_mark_relation_messaged` runs from `sync_thread` and `send_message`; a filed first-message draft marks
  `drafted`; the historic mirror (`graph.record_relations_page`) inserts `skipped`; `connect_status` carries
  `messaged_at` / `messaged` / `stage` + `connected_(not_)messaged` counts and names the per-lead `invite_error`
  (Hermes logged a per-lead `error` key as a tool failure). Tool text + `salesbrain-prospecting` SKILL §LinkedIn:
  connect_status answers both questions, several people = ONE batch call, never generalise from a refusal.
  One-off backfill set `sent` on every messaged relation. Lesson: any "did we do X" list must be derived from
  the record of X, never from a flag a separate tool is supposed to set.
- **Second false "already sent" (2026-10-11 19:41)**: the bot was mid-"send to the 7 new connections" when
  `deploy-server.sh` (0.40.4) restarted the gateway ("Hermes is shutting down"). On resume it made NO tool call
  (audit: nothing after `connect_status` 19:33) and repeated the earlier invented story from its session history
  ("the background agent sent it; threads exist") — all 7 had no thread. Nothing was sent. Two fixes: the default
  profile's `SOUL.md` now has a **Tool truth** section (claims only from this turn's tool results; re-run tools
  after an interruption; refusals are per person; several people = one batch call) and `deploy-server.sh`
  installs `assets/profiles/default/SOUL.md` to `/root/.hermes/SOUL.md` (it was a hand copy from August). Rules:
  **a deploy restarts the gateway and kills in-flight Telegram turns** — check the bot is idle (or warn Amir)
  before deploying; a session that has carried a false narrative should be reset (`/new` in the chat).
- **0.40.5 (same evening)**: after `/new` the bot answered "newly accepted?" with `crm_linkedin_pending_followups`
  → "39 accepted connections not messaged", counting the owner's June connections as fresh acceptances.
  `pending_followups` now defaults to `scope='requests'` (acceptances of requests WE sent, `linkedin_invitations`
  accepted, newest first, with company + rank; live answer: 4) and takes `scope='all'` for every older unmessaged
  connection (39); the tool text and SOUL say which question each answers.
- Not built: an app button for the first message (LeadsTable), withdrawing, a per-ICP "message all connected".

### 5.ah.3 Telegram "I can't view the image" + the two failing routines = one Hermes Bedrock bug (2026-10-10)

The bot DID receive the photo; `vision_analyze` died with `could not resolve credentials from session`
(`anthropic/lib/bedrock/_auth.py:65`). Same error has failed `attention-allocator` and `ops:outreach:daily` on every
run since 2026-09-24 ("16 failures in a row"). Cause, in Hermes v2026.9.21: the box authenticates to Bedrock with a
**Bedrock API key** (`AWS_BEARER_TOKEN_BEDROCK`); the main runtime knows "AnthropicBedrock is SigV4-only, bearer
users go through Converse" (`hermes_cli/runtime_provider_backends.py::_resolve_bedrock_runtime`), but (1) the
**auxiliary** client builder `agent/auxiliary_client.py::_build_bedrock_client` sends every Claude model to
`build_anthropic_bedrock_client` without that bearer check → SigV4 → `AWS_PROFILE=hermes` has no credentials
(`~/.aws/config` is region-only, no `credentials` file, no instance role) → every aux call (vision, compression,
titles, our `salesbrain_aux`) fails; (2) `_resolve_bedrock_runtime` reads the bearer from `os.environ`, which the
gateway scrubs into the profile secret scope after start, so a cron job's main runtime resolved later sees no
bearer and takes the SigV4 path too — interactive chats resolved at start-up still work. The OpenAI-compatible
`…/openai/v1` endpoint in `model.base_url` does NOT serve `us.anthropic.claude-sonnet-4-6` at all
("model_not_found", probed 2026-10-10) — it is dead config; the working path is Converse + bearer.
**Fix = two one-line patches on the box** (originals kept as `*.orig-2026.9.21`; re-apply after any
`UPGRADE_HERMES=1`, or add real IAM credentials / an EC2 instance role with `bedrock:InvokeModel*` instead,
which makes the SigV4 path work and needs no patch):
  `agent/auxiliary_client.py`: `if is_anthropic_bedrock_model(final_model) and not resolve_bedrock_bearer_token():`
  `hermes_cli/runtime_provider_backends.py`: `has_bearer_token = bool(resolve_bedrock_bearer_token())`
then `systemctl --user restart hermes-gateway`. Converse converts `data:` image URLs to image blocks, so vision
works through it. **Applied by Amir 2026-10-10 17:00 Addis and verified**: an aux `vision` call answered "Red" on a test image; `hermes cron run attention-allocator` succeeded after 16 failures. Check `ops:outreach:daily` at its next 10:00 tick.

### 5.ah.4 The acceptance loop: accepted request → first-message card (2026-10-11, core/hermes 0.41.0, migration 053)

Amir: "if we are connected to a new person, we need to know and aim for outreach." Before: the hourly sync's digest
said only "N new connections accepted", no names, no next step; the loop closed only when someone asked the bot.
- **`icp_profiles.first_message_template`** (053) — what a list sends once a connection request is accepted;
  placeholders `{first_name} {full_name} {company}` (`commands/prospecting.render_first_message`, pure). Set in the
  ICP builder ("First message after they accept"), via `crm_icp_define` / `crm_icp_set_first_message`, or the
  service MCP `crm_icp_define`. `prospect_first_message(actor, prospect_id)` renders it for one lead.
- **Hook**: `reconcile_invitations` now returns `accepted_leads[]` (prospect ids) next to the names;
  `assets/scripts/linkedin_sync.py` passes them to **`accept_followup.file_cards_for_accepted`** → one
  `propose_first_message` per person (the normal first-message lane: approval card to the owner's Telegram, 👍 =
  `approve_and_send` → `start_chat`, 👎 skip). Nothing is sent by itself; a list without a template files nothing and
  the digest says why. The digest now names who accepted and how many cards wait; it also fires on acceptances
  alone (it used to need inbox activity).
- The NRW list's template was seeded with the "Diese Woche" Fakuma text (change it after the fair); the four
  acceptances that pre-dated the hook (Ickler, Dachrodt, Schwarzkopf, Th. Poschmann) got their cards filed by hand
  through the same helper on 2026-10-11.
- Not built: a per-list toggle to skip cards for people the owner excluded (today: 👎 on the card), a reminder
  when a card sits unanswered, and the same loop for email-only leads.

### 5.ah.4b NRW persona list → merged into one NRW ICP (2026-10-12/13, data only)

The 537 NRW member firms were scored on Amir's persona (network / desktop-heavy / tech-positive / growing / outside 100k+
cities; banks, insurers, law firms, publishers, software vendors, investors excluded) — sheet
`Sales CRM/reports/NRW member companies - persona.xlsx` ("Persona fit" tab). 389 people at 217 firms (names from each
firm's Impressum + the Excel, `source_type='kimw_persona'`, no LinkedIn URLs) were imported under Matthias as a second
ICP, then on Amir's "they are one" **merged into the Top 100 ICP**, which is now **"NRW Kunststoff-Netzwerk"**
(`2e2c3cf8-9717-4cf5-8bd9-0c7d85d214cd`, 607 leads): the original 100 keep ranks 1–100, persona leads follow at
101–465 in persona order. The persona ICP row is archived (`is_active=false`, 0 leads). The known twin-account bug
(`upsert_candidate` matches by stripped name, stores the full one) made ~123 account rows for the 86 first-wave firms.

### 5.ah.5 `/followups` = the LinkedIn follow-up board (2026-10-13, 0.42.3, app + one kernel line)

Amir: "delete all of the previous ones and add a follow-up from LinkedIn automatically." The 113 stale deal reminders /
SLA alerts (Apr–Sep) were deleted (backup `~/.cache/salesbrain/backups/followups-2026-10-13144118.json`); the deal
follow-up form/table stay for manual use.
- **Kernel**: `mark_approval_result` now arms `prospects.next_followup_at` on EVERY sent message (was: only when
  `agents.followup.enabled`). The flag still gates the outreach routine's auto-drafting (`outreach_queue.py` reads it
  before `followup_queue`), so with it off the page is the only driver. Backfilled for the 18 unanswered NRW leads.
- **App**: `GET /api/followups/linkedin` (direct SQL, one client; admin = all owners, else own) = P5_SENT, not
  converted, timer set or a pending `kind='followup'` draft; carries last sent message, thread id, owner, touch N of
  max. `components/followups/LinkedInFollowups.tsx` groups by due label ("Awaiting approval" first) with **Draft
  follow-up** → `POST /api/prospects/[id]/followup {action:'draft'}` (model, same language as the last message, ≤60
  words, one new useful thing; feature `followup_draft`) → editable → **Queue for approval** (`{action:'propose'}` →
  `crm_outreach_propose kind='followup' linkedin_thread_id` as the lead's OWNER via `lib/act-as`; the card goes to the
  owner's Telegram / `/agents`, the send gate consumes it) and **Skip** (`{action:'skip'}` clears the timer). A reply
  clears the timer (`record_reply`), so answered people drop off by themselves.
- Not built: email follow-ups on the board (`followup_queue` covers them; the page is LinkedIn-only), a reminder when
  a card sits unapproved, enabling the agent to draft by itself (`agents.followup.enabled`).

### 5.aj Self-improvement on every surface: per-person memory + Hermes skills (2026-10-13/14, feat/self-improvement, core 055)

Amir: "the self-improvement skill is really important, use it everywhere … memory tailored for each person AND
shareable across members — not one Hermes as a provider for all." Plan (v1 + v2): `~/.claude/plans/hermes-self-improvement.md`.
**What Hermes ships** (v2026.9.21): the `memory` tool (MEMORY.md + USER.md, ONE FILE PER PROFILE, USER.md single-user),
`skill_manage` (procedural memory), a post-turn **background review** fork (`agent/turn_finalizer.py`; memory half fires
only when the built-in `memory` tool is in the toolset and its prompt is hard-wired to that tool; skill half on
`skills.creation_nudge_interval`; never for cron), `skills.write_approval` (non-CLI writes STAGED to
`$HERMES_HOME/pending/skills/<id>.json`, per profile), the curator, `/learn`, `/refine`. Memory-provider tools are
dispatched WITHOUT the tool_request middleware (`tool_executor._resolve_sequential_dispatch`) → a provider tool never
knows who is talking; `crm_*` tools do. MEMORY.md is loaded once per cached agent → stale across gateway sessions.
- **Found live (2026-10-13)**: built-in memory off since 08-31 (no memory tool anywhere, review never ran); web chat
  (`api_server=[crm_core]`) and the team bot (`crm` profile `telegram=[crm_core, web]`) had no `skills`; `crm_core` is a
  dead name since 0.34.0; the crm profile had **no `skills.external_dirs`** → the team bot never loaded a `salesbrain-*`
  skill; one background-review skill write (`pending/skills/9e58e6a1.json`) had waited unreviewed since 2026-09-24. Our
  RelationshipMemory provider keys on the DEAL'S CONTACT, not the operator — nobody had personal memory.
- **Decision**: Hermes built-in memory stays OFF on both profiles (per-profile file, single-user USER.md, stale cache,
  review cannot target a person). **Per-person memory = core `agent_memories`** (055): `owner_user_id`, `scope`
  personal|team, `kind` preference|fact|rule|procedure, `content` ≤300, `status` active|proposed|superseded|archived,
  `source` conversation|review|promotion|app, `supersedes_id`, `shared_from_id`; partial unique on active text per
  owner (personal) / globally (team); policy row `agents.memory` (personal_chars 1500, team_chars 1000,
  review_every_turns 8, review_max_candidates 3). Rows are superseded, never deleted.
  `policy/memory.py` (pure): `refuse_shape` (passwords, API keys/tokens, AWS keys, private keys, IBAN, card numbers,
  pay/salary with amounts — the sibling repo saw a password and a salary land in MEMORY.md), `normalize`, `validate`,
  `render` (rules first, newest first, "… and N older notes not shown"). `commands/memory.py`: `remember` (personal →
  active; team → proposed unless admin), `forget` (supersede), `share` (personal → team proposal, admin → active),
  `decide` (admin), `review_candidates`, `prefetch_block(user_id)`, `recall`, `list_memories`, `team_overview`,
  `settings`. **Attended-turn rule**: writes need a human actor from the session or an app click; the SERVICE actor is
  refused — routines, digests and the learn pass can never write memory. Visibility: personal = owner (admin may list,
  read-only); team active = everyone.
- **Ring**: family **`crm_memory`** (`tools/memory.py`, 137 tools / 10 families): `crm_memory_save` (attended =
  `_actor_user_id` came from the session, read before `resolve_actor` pops it; passes `hermes_session_id`),
  `crm_memory_recall`, `crm_memory_forget`, `crm_memory_share`, `crm_memory_decide` (admin). All `mcp=None`; not on the
  service MCP. **Provider** (`memory_provider.py`): `prefetch` now resolves the OPERATOR (`identity.actor_for_session`:
  agent_sessions → telegram_user_links) and injects "Your notes / Team notes" ABOVE the deal dossier (user-message side,
  cache-safe); `sync_turn` runs **`memory_review.review_operator`** every `review_every_turns` turns per session: one
  Haiku call (`converse(feature='memory_review', owner_user_id)` → `llm_usage`) extracting ≤3 notes about the person we
  talk to (never prospects — distill.py does those) → `review_candidates` (personal → active with source review, team →
  proposed). Unmapped sessions never review. `learning.py::loop_status` reports a surface's memory as `crm_memory`
  present; `pyyaml` is a declared ring dependency.
- **deploy-server.sh**: `memory.memory_enabled false` / `user_profile_enabled false` / `nudge_interval 0` on both
  profiles (verify block REFUSES a deploy with built-in memory on or a chat surface missing `skills` + `crm_memory`);
  `skills.creation_nudge_interval 10`; skill review routed to Haiku 4.5 (`auxiliary.background_review`,
  `max_input_tokens 48000` via `--force`); `display.memory_notifications verbose`. **`ensure_toolsets`** MERGES `skills`
  + all ten crm_* families into `platform_toolsets.telegram` / `api_server` (default) and `telegram` (crm), drops
  `crm_core` and Hermes' `memory`, keeps everything else; cron gets `crm_memory` (recall only — writes refused). The crm
  profile gets `skills.external_dirs` + the shared `skills.create_dir /root/.hermes/skills-agent`. New `--no-agent` job
  **`learning-digest`** (09:15) DMs the operator while Hermes-staged writes wait.
- **Staged-skill review**: ring `learning.py` (+ `rpc._internal`: `learning_pending`, `learning_decide`,
  `memory_list`, `memory_team_overview` — app-only) lists Hermes-staged writes across profiles from the files, diffs via
  Hermes' `skill_pending_diff`, flags a patch to a git-deployed skill (`targets_repo_skill`: applies on approve, root
  ignores `a-w`, overwritten by the next deploy → port to `assets/skills/`); approve replays through
  `hermes_cli.write_approval_commands.handle_pending_subcommand` under `set_hermes_home_override`.
- **App**: `/profile → Memory` (`components/profile/MemoryPanel.tsx`: add a note, your notes with Forget / Share with
  team, proposals, team notes, forgotten; `GET/POST /api/memory`, `POST /api/memory/[id] {forget|share}`);
  `/admin/learning` (`Team memory` section: proposals → Approve for everyone / Archive, per-user counts, active team
  notes; `GET/POST /api/admin/memory`) + per profile: surfaces with skills / crm_memory pills, loop settings, issues,
  Hermes-staged skill cards with diff + Approve / Reject, agent-written skills, MEMORY.md/USER.md (empty by design).
  Sidebar Admin → Learning. `lib/memory-panel.ts`, `lib/learning-panel.ts`.
- **SOULs** (default + crm): "Learn" section — corrections / preferences / rules / facts about the person →
  `crm_memory_save` at once, say what you saved; "forget that" / "share with the team"; procedures → `skill_manage`
  (staged); never rewrite git-deployed skills; never secrets or pay data.
- **To verify after deploy** (integration session; migration 055 first): `hermes tools --summary` (+ `-p crm`) shows
  `skills` + `crm_memory`; Telegram as Amir "remember I prefer batch calls" → row active, next turn's prefetch carries
  it, a teammate's turn does not; "share that with the team" → proposal → approve on /admin/learning → teammate sees
  it; 8 turns → one `memory_review` row in `llm_usage`, ≤3 candidates on /profile → Memory; a cron run writes no memory;
  `grep "Background review complete" logs/agent.log` after a skill-worthy turn; `/admin/learning` lists 9e58e6a1.
- **Live 2026-10-14 (0.46.0, 055 applied).** 2026-10-16, Amir: "I still don't see self-improvements" with a screenshot of
  **Zeami Omni** (Mateo's bot, the OTHER repo) saying "Self-improvement review: User profile updated" after Mateo corrected
  the value proposition — that is Hermes' built-in USER.md on THAT bot's profile, shared across its users, and it never
  reaches SalesBrain. Our side: 48 chat model calls since the deploy, zero `memory_review` rows — no session had reached 8
  turns and every gateway restart resets the per-session counter; the loop itself works (a direct `review_operator` run
  with Mateo's correction wrote `[rule] Value proposition: observe and analyze overall business to identify biggest
  profit/efficiency levers for AI …` for Amir on the first pass). Hermes logs "provider tools and system-prompt block are
  both withheld" because the `memory` toolset is off — that gate only hides provider TOOLS; prefetch / sync_turn still
  run (`_memory_turn_start_and_prefetch` needs only `_memory_manager`), and we expose no provider tools anyway.
  **Fix for Zeami Omni (app-only, same day)**: `crm_memory_recall` / `save` / `forget` / `share` on the service MCP
  (68 tools; identity = `X-On-Behalf-Of`, so each employee's notes are their own; `decide` stays admin-only in the
  app). The other bot must RECALL BEFORE IT DRAFTS and SAVE after a correction — that is a prompt change on Mateo's side;
  `docs/service-mcp.md` changelog says so.
- Not built: `curator.consolidate`, `/learn` from the app, team-proposal count in the learning digest, backfilling
  conversations before the deploy, a lower review threshold (8 turns is long for Telegram; `agents.memory.review_every_turns`
  is a policy row — set 4 if the loop should fire sooner).
Mateo's Zeami Omni bot said "Captured and added to the CRM" for two KIMW business cards (Marius Fedler, Jan-Ole Maras)
— nothing landed: the service MCP (token "Zeami AppnMCP") had 36 tools and none could create a person, so the bot wrote
to its own Notion database and called it the CRM. The audit log showed only reads + `register_user`.
- **Kernel** `commands/prospecting.py::add_lead(actor, full_name, company?, title?, email?, phone?, linkedin_url?,
  website?, location?, address?, notes?, icp_id?, source_detail?)` — guards first (name, `@` in email, member id is not a
  slug), then the dedup ladder on the owner's leads (slug → email → name at company; returns `matched_by`, never a
  duplicate), else `upsert_candidate(source_type='manual')` so there is still ONE landing path; then COALESCE-fills
  `contacts.phone/title/email/linkedin_url` and `accounts.website/domain/hq_location` (domain with qualify()'s unique
  guard), `ensure_prospect_person` for the handles, and `notes` → `people.record_fact(source='manual')` — a dossier fact,
  not `contacts.notes` (which nothing reads). ICP: explicit, else the owner's single active one, else unscored P0_IMPORTED
  (the response's `note` says which). Audit `lead_added`.
- **Ring** `crm_prospect_add` (`mcp="write"`, family `crm_prospecting`, 131 tools); **service MCP** passthrough
  (37 tools, `docs/service-mcp.md` "Sourcing & enrichment" + changelog). Not on the public MCP withheld list — it sends
  nothing.
- **0.43.1 (same evening)**: a hand-added lead is also mirrored into **`/sales-leads` as `new`** (`sales_leads.py`
  gained the `new` rung and an "Added by hand to <owner>'s leads" head; response carries `sales_lead_id`) — Amir: "we
  should have them in the sales-leads". The bot's first four calls (Fedler, Maras, Volkenrath, Barlog) ran as
  **EMP-0092 = Osman** although Mateo sent the Telegram message — the service MCP's owner is whatever
  `X-On-Behalf-Of` the app sends, so the Zeami side must map the Telegram sender to the employee id itself; the four
  rows were re-owned to Mateo by hand, my two stand-ins deleted, all four mirrored. There is deliberately no
  "reassign owner" tool on the service surface (an app acts only as its own employee).
- Not built: an "Add lead" form in the app (the ICP leads table has no manual entry either), a second phone column
  (goes in `notes`).

### 5.ai.2 Stand-up KPIs by teammate name — `crm_outreach_kpis` (2026-10-14, feat/kpis, core/hermes 0.44.0, no migration)

Zeami Omni's daily rundown asks "Amir: connection requests sent + accounts researched?" and Amir runs Matthias's
account. Nothing on the service MCP took a name or returned numbers. Amir's rule: **the MCP resolves the person** —
"KPIs of Matthias" must work whoever asks, with no employee-id gymnastics on the bot side.
- **Kernel** `commands/kpis.py`: `resolve_owner(conn, query, actor)` — name / email / LinkedIn handle, ILIKE; real users
  rank above `…@<app>.service.salesbrain` stubs (a partner app's provisioned twin must never shadow the teammate), exact
  name beats substring; one hit → owner, several → `candidates[]` (never a guess), none → error; `None`/"me" = the actor.
  `outreach_kpis(actor, owner?, period)` counts over `[start, end)` (`period_bounds`: today · yesterday · week Mon→now ·
  last_week · month · 7d · 30d) from the existing ledgers: `linkedin_invitations` (sent / accepted in period; pending,
  accepted, not_accepted as current state), `outreach_approvals` (sent_at in period by kind + channel, awaiting_decision,
  skipped), `reply_events`, `prospects` (new, contacted, replied, P5 awaiting reply, follow-ups due, converted),
  `prospect_enrichment` (researched / emails / profiles / employers found), `agent_runs` (Leads Finder searches, found),
  `sales_leads` (calls booked, converted — matched on `raw_payload.owner` name, the only link that table has),
  `linkedin_accounts`. **Aggregates only, open to every user** — nothing names a lead (same reasoning as org-wide
  /pipeline). Audit `outreach_kpis`.
- **Ring** `crm_outreach_kpis {owner?, period?}` (read, family crm_agents, 132 tools); **service MCP** passthrough
  (38 tools; `docs/service-mcp.md` "Run visibility" + changelog).
- Live check 2026-10-14 as Mateo's plain user: "Matthias" → week = 3 requests sent, 10 accepted, 3 follow-ups, 3
  replies, 7 awaiting decision, 74 pending; "Mateo" → the real Mateo user (exact name) not the three stubs.
- Known soft spots: `leads.contacted` reads `prospects.last_contacted_at`, which the follow-up lane does not bump
  (showed 0 against 3 follow-ups) — `messages_sent` is the reliable send count; `calls` only sees Calendly/sales-leads
  bookings. Not built: a KPI panel in the app (`/admin/users` shows agents, not these numbers), plan-vs-actual.

### 5.ai.3 The assistant batch — ten service-MCP tools (2026-10-14, feat/mcp-tools, core/hermes 0.45.0, no migration)

Amir: "develop them" (the list proposed after `crm_outreach_kpis`). Kernel: `kpis.py` +`pipeline_summary` (org-wide like
/pipeline: by gate, created/moved/won/lost/signed in period, board pending with vote counts, deal follow-ups overdue) and
`team_kpis` (outreach_kpis for every user with a LinkedIn account or 30-day activity); NEW `commands/lookup.py` —
`lead_lookup` (org-wide, journey + `_next_step` ladder: deal → cards awaiting → replied → follow-up due → sent → request
pending → 1st-degree unmessaged → nothing to reach → draft), `record_note` (dated `person_facts` row via
`ensure_prospect_person`; kinds meeting/call/email/linkedin also `record_interaction` outbound; `query` must resolve to
ONE lead; appended to the sales-leads row only if one exists — `sales_leads.append_if_mirrored`, never creates),
`followups_due` (cadence timer + `draft_pending` + deal `followups`; owner name / me / all); `deals.update_sales_lead`
(status new/contacted/replied/archived + dated note; converted is final). Ring: `crm_pipeline_summary`, `crm_team_kpis`
(agents), `crm_lead_lookup`, `crm_lead_note`, `crm_followups_due` (prospecting), `crm_update_sales_lead` (deals) — 138
tools. Service MCP: those six + `crm_list_sales_leads`, `crm_get_sales_lead`, `crm_convert_lead`, `crm_prospect_convert`
exposed as passthroughs — 49 tools. Live check 2026-10-14: pipeline 51 active deals, Fedler → "not contacted yet",
"Barlog" → two candidates (Frank/Mateo, Peter/Matthias), Matthias 18 follow-ups due.

### 5.ai.4 /sales-leads = the lead dashboard (2026-10-14, feat/sales-leads-v2, core/hermes 0.47.0, migration 056)

Mateo + Amir call 2026-10-13 ("Sales / Fakuma follow-up"): the page was "a lot of text, not grippy". Design taken from
Mateo's PEI Napa CRM html (`~/Downloads/Telegram Desktop/PEI_Napa_CRM_for_Amir/`): one line per lead, an editable
priority (1 = top) and a ★ must-talk that SORT the list, a "N days since we last talked" ticker (amber ≥14 d, red ≥30 d)
and a "ping again on" date, who is responsible (**back office drives the lead, front office is the face in calls** —
Mateo's rule; Hannes = back office on Mateo's account), where we met, a short dossier so nobody opens LinkedIn mid-call,
and a dated **track record** per lead that people and the agent both read and append to. Dropped from Mateo's design on
his say-so: the "read" / "info requested" checkboxes.
- **Core 056**: `sales_leads` + `priority`, `must_talk`, `responsible_user_id`, `front_user_id`, `last_contact_at`,
  `next_contact_at`, `met_at`, `title`, `linkedin_url`, `notes` (free textarea), `dossier` JSONB (talking_points,
  relevance, firm_summary, chronology, interesting, sources, tier). NEW `sales_lead_events` (kind met | sent | reply |
  call | meeting = CONTACT kinds that move `last_contact_at` forward; note | status | priority | assign | import =
  bookkeeping; channel, actor, ref). The migration backfills: the dated paragraphs 054 appended to `description` →
  events; sends/replies from `outreach_approvals` / `reply_events` the mirror never saw; `responsible` = the prospect's
  owner; the ticker. Verified in a rolled-back transaction before merge: 51 events, 26 tickers, 40 owners.
- **Kernel** `commands/sales_leads.py`: `add_event` is the one writer; `upsert_sales_lead` / `append_if_mirrored` write
  events instead of description paragraphs (the callers' `line` contract is unchanged — the "YYYY-MM-DD: " prefix becomes
  the event date). `deals.update_sales_lead` takes every dashboard field (teammates resolved by name via
  `kpis.resolve_owner`; each change that matters is also a `status` / `priority` / `assign` event); `list_sales_leads`
  gains views `working` (open, ranked) and `due` (ping-by reached or quiet 14+ days); `get_sales_lead` returns
  `track_record`. `lookup.record_note` kinds meeting / call / email / linkedin are contact events now.
- **Ring + service MCP**: `crm_update_sales_lead` / `crm_list_sales_leads` schemas extended, tool counts unchanged.
- **App**: `GET /api/sales-leads?view=working|due|must|new|…&sort=priority|contact|newest&q=&mine=1` (one client, three
  sequential queries, returns `users` for the pickers); `GET/PATCH /api/sales-leads/[id]` — PATCH routes everything but
  the free `notes` through `crm_update_sales_lead` so UI and agent edits are audited and land on the track record the same
  way. `lib/sales-leads.ts` (contract + ticker/ping-by helpers), `components/sales-leads/{LeadRow,LeadDetail}.tsx`,
  `app/sales-leads/page.tsx` rewritten (summary strip, sticky search + view chips + Mine + sort, inline priority / ★ /
  LinkedIn, expand → talking points, who they are, why relevant, firm, track record + add-a-line, notes autosave, right
  rail with back/front office, ping-by + quick +1/3/7/14 d, where met, status / convert / archive).
- **Mateo's Napa contacts**: `scripts/import-napa-leads.mjs <PEI_Napa_Contacts_and_Notes.json> [--apply] [--all]`
  (dry run default; engaged subset = 125 of 453: 45 ranked, 43 starred, 9 replied, 28 contacted; `--all` = 447 as
  unranked new). Owner + front default `mateo@chipchip.social` (the real Mateo user), `source='event:pei-napa-2026'`,
  dossier from the research, track record from his notes / messages / replies, `met_at='PEI Napa 2026'`. Run by the
  integration session AFTER 056, then decide with Mateo on `--all`.
- **Live 2026-10-14 (0.47.0 → 0.47.1)**: 056 applied, 125 engaged Napa contacts imported (Hannes = back office, Mateo =
  front office, `source='event:pei-napa-2026'`), app on Production. 0.47.1 (core 057, same day, Amir): priority is FIVE
  labelled levels — 1 Very high · 2 High · 3 Medium · 4 Low · 5 Very low (`PRIORITY_LEVELS` in `lib/sales-leads.ts`,
  `PRIORITY_LABELS` in `commands/deals.py`), the owner pill shows first names ("Hannes → Mateo", not "HG/M"), research
  tiers A/B/C render as High/Medium/Lower fit, and the row summary line skips import/status/priority/assign events.
  The kernel migration runner (`store.migrations`) re-applies the whole stream and now trips on 051's
  `prospect_enrichment_kind_check`; apply new files one at a time with psycopg until that is fixed.
- **Redesign (same evening, app-only, 7b5a489)** — Amir: "you completely duplicated the inspiration ui design". The page now
  follows `docs/brand/zeami-brand-basics.md` instead of Mateo's HTML: `LeadRow` is one aligned grid line (`ROW_GRID`:
  rank + priority bar · lead · status dot + fit · last/next contact · "Hannes → Mateo" · priority pill-select / star /
  LinkedIn / chevron) under a column-header row; line SVG icons in `components/sales-leads/icons.tsx` (`EventIcon` for
  the track record — the emoji `EVENT_ICON` map is gone); toolbar = Working / Due / Must talk segment + a "By status…"
  select + Mine + search + sort; the six count tiles became a compact metric strip in the header; skeleton, empty and
  error states; `LeadDetail` is a calm briefing card (eyebrow headings, icon timeline) with the working rail on the right.
  Not screenshot-verified by Claude (the local login form carried saved production credentials, so it was not submitted).
- Not built: Hannes's LinkedIn (he connects it on /profile), the agent's morning digest listing `due` leads, a per-row
  "draft follow-up" button (the /followups board does that for P5 prospects), re-ordering by drag.

### 5.ai.5 Lead roles — back office / front office wired into every activity (2026-10-14, feat/lead-roles, core 058)

Amir, after "how do back office and front office work?": "it should also reflect the responsibilities and should be
wired to all activities." Before: the two seats were labels on the row (sorting, the Mine filter). Now one policy
module says who owns what and every activity follows it. **Back office** (`responsible`) drives the lead — research
and the dossier, drafts, follow-ups, the ping-by date, priority, the track record; hears the morning due digest,
reply notices, new leads. **Front office** (`front`) is the face — calls, demos, meetings; hears booking notices,
becomes the deal's project lead on convert. Empty front = the back office does both. **Amir's rule: an unassigned lead belongs to its OWNER in both seats** —
`apply_role_defaults` runs on every landing (prospect owner → `raw_payload.owner` name → team default email); 058
backfills existing rows; form / Calendly leads with no owner stay unassigned and the digest flags them. The LinkedIn
/ email **account owner** is deliberately a third thing: approving a send from their account stays theirs.
- **Core**: `policy/lead_roles.py` (pure: `ROLES` duties, `DEFAULT_NOTIFY` activity → roles, `recipients`,
  `due_reason`, `digest_text`); migration **058** (policy row `sales_leads.roles` — `notify` map, `quiet_days` 14,
  `digest_max`, `default_responsible` / `default_front` emails for leads that land with nobody; two indexes).
  `commands/sales_leads.py`: `apply_role_defaults` (called on every mirror + landing), `notify_events(lead, activity,
  text, exclude)` → `notify_user` events (ring delivers owner's-DM-or-nothing), `due_leads` + **`due_sql`** (THE due predicate — ping-by reached, or quiet 14+ d only for starred / P1–P2 / already-contacted leads; shared by the list view, followups_due, the digest and the KPIs; the app route mirrors it), `upcoming_bookings`, `roles_digest(actor)` (service/admin), `lead_landed`.
  `deals.list_sales_leads(owner, role)`; `get_sales_lead` → `roles`; `convert_lead_to_deal` → deal `user_id` = back
  office, `lead_id` = front office (both see it under creator-or-lead), full notes (booked demo, website, met at,
  message, our notes — the app route's own SQL copy is gone), a `status` event and a DM to both seats;
  `update_sales_lead` DMs a newly assigned person. `lookup.followups_due` → `sales_leads[]`; `lead_lookup` journey
  carries `sales_lead{responsible, front, …}`; `replies.record_reply` also tells the back office (excluding the account
  owner, who already got it); `kpis.outreach_kpis` counts bookings / conversions by seat, `working_as_back_office`,
  `working_as_front_office`, `due_now`, and `sales_lead_activity` (calls, meetings, notes the person logged) — the
  Napa rows finally count for someone.
- **Ring**: `assets/scripts/sales_leads_due.py` = Hermes cron **`sales-leads-due`** (07:45 Mon–Fri, `--no-agent`): one
  DM per back office with their due leads (reason per lead) and per front office with the day's demos;
  `fallback=False`; the operator line names due leads with NO back office. App-only RPC `sales_lead_landed` (public
  routes). Tool text for list / get / update / convert / followups_due; skill `salesbrain-sales-pipeline` §"/sales-leads:
  back office and front office are responsibilities" ("my leads" = `owner='me'`; several people = one call; never
  guess the seats).
- **App**: `lib/sales-leads.ts` `ROLES` (duties + what each hears), `myRole`; `/sales-leads` "Everyone / Mine / Mine ·
  back office / Mine · front office" select (`?mine=1&role=`), deep links `?view=due&mine=1` from the digest, a "Who
  does what" legend, a "you · back/front" pill on the row, unassigned in orange; `POST /api/sales-leads/[id]/convert`
  is a thin `crm_convert_lead` call; `lib/sales-lead-roles.ts::leadLanded` fires from the zeami.io form and the
  Calendly webhook (SERVICE actor, fire-and-forget). Service MCP: `crm_list_sales_leads {owner, role}`, texts;
  `docs/service-mcp.md` changelog. Tool counts unchanged.
- Not built: a per-team default front office in the UI (SQL on the policy row for now), reassigning in bulk, a
  reminder when a due lead stays untouched for N more days, the digest for email-only cadence prospects (that is the
  outreach routine's job).

### 5.ai.4 Matthias's graph sync had failed since 2026-10-05 — error "0" (fixed 0.49.1, 2026-10-15)

`graph.upsert_edges` read the `RETURNING (xmax = 0) AS inserted` row as `r[0]`; under the dict_row connection
`graph_core.sync_owner` hands it, that is `KeyError(0)`, whose `str()` is `"0"` — the one-character error every
`graph_sync` run logged for him (`phase: mirror_pending`, 0 edges, twice a day for ten days). Owners mirrored before
0.32.3 never hit the code path with new rows, which is why only Matthias stalled. Now read by name. Ran once by hand as
him through the RPC (`SALESBRAIN_RPC_REQUEST` with `actor_user_id`; note the box `.env` still carries a dead
`SALESBRAIN_ACTOR_EMAIL=amir@test.com` fallback): **mirror complete — 76 LinkedIn relations + 36 thread edges**. Unipile's
`users/relations` returned one page of 76 for his account, so that is the whole 1st degree Unipile exposes, not a cap.
His 615 `contacts` rows (NRW / Fakuma imports) carry no LinkedIn slug and bridge nothing. Search by name: `/network`
(graph panel), `crm_lead_lookup` (leads, org-wide), or `crm_graph_edges` / `crm_person_lookup` on the ring.

### 5.ai.5 `/network` is a list, graph on demand, team-wide (2026-10-15, feat/network-list, app-only)

Amir: "not to draw the graph — it's taking too much time; a button to show the graph; make it a list; the networks should
be shared across the team." `components/network/NetworkList.tsx` is the default view (sortable: name / title / company /
industry / location / held by / reach / last contact; search, filters and AI highlights apply through the same
`computeHidden`; 200 rows + Show more); **Show graph** mounts the cytoscape canvas (`NetworkGraph`, still dynamic-imported,
so the bundle is not even fetched until asked). `GET /api/network` is now **team-wide for every user** (was: own contacts
unless admin) and carries `owner_name` → node `metadata.owner` (`lib/network-graph.ts`); `GET /api/graph?scope=team|mine`
(default team) lists every owner's ring with `owner_name`, and `GraphPanel` has a Team / Mine toggle + holder column. Reach
and sync state in the panel stay personal. `/api/contacts` and the agent keep per-user privacy; this page is the shared map.

### 5.ai.6 One person, one node — alias resolution, headline → employer, graph-aware lookup (2026-10-16, feat/one-node, core 0.49.2)

Amir: "did we contact anyone from Aixtron?" → "no", while Matthias had a 2026-09-17 thread with AIXTRON's VP Michael
Heuken. Three defects, plan `~/.claude/plans/did-we-contact-anyone-purring-sunbeam.md`: (1) `identity.ensure_people_bulk`
resolved only on a row's key handle, so a human first met in a thread (member id) and later mirrored as a connection
(slug + member id) became two `people` rows — the alias insert hit `ON CONFLICT DO NOTHING`; now every handle (key +
`extra_handles` + email) is looked up (`hit()`), an alias match attaches the key handle to that row, and `organization`
is filled on existing rows when blank. (2) `edges_from_threads` never wrote `linkedin_threads.person_id` back — now it
does (`threads_linked`). (3) Nobody parsed the headline: `policy/graph.company_from_headline` ("VP bei AIXTRON" → AIXTRON;
bei / at / @ / chez; "Role | Company" only when the first part reads like a role; no separator → None) feeds
`organization` from both the thread sync and the relations mirror. `store/merge_people.py` (dry-run default, `--apply`,
FK-catalogue driven, pairs proven by `linkedin_relations.provider_id` + `public_identifier`) folded the existing splits.
`lead_lookup` now also searches the graph (name / organization / thread headline) and returns `people_without_lead[]` with
`connected_via[]` and `last_thread`; `record_note` accepts a query that resolves to exactly one graph person.

### 5.ai.7 Lead card: editable identity, journey bar, editable track record (2026-10-16, feat/lead-card, core/hermes 0.49.3, migration 060)

Amir, on `/sales-leads`: "how can I make edits to the name? add on the top a progress bar; is there a way to edit the
last post on the timeline?" — **Migration 060**: `sales_leads.journey_stage` 0–5, `intro_quality` 1–5, `journey_outcome`
qualified | lost. The journey (Amir's sketch): 1 warm introduction (quality 1–5 dropdown) → 2 connected on LinkedIn →
3 connected on WhatsApp / email / phone → 4 call or meeting set → 5 qualified (→ Convert) or lost (→ archived). Hand-set,
not derived; every move is a `status` line on the track record. **Kernel** `update_sales_lead` takes `full_name / title /
company / email / linkedin_url` (logged as one `note` "edited …" line) and the three journey fields; NEW
`edit_sales_lead_event(event_id, text?, occurred_at?)` — hand-written kinds only, own lines unless admin, re-derives
`last_contact_at`. **Ring** `crm_edit_sales_lead_event`; `crm_update_sales_lead` gains the params. **App**: `LeadDetail`
header is click-to-edit (name · title · company, Enter saves), the journey bar sits above the talking points (click a step
to set it, click the current step to go back one; step 1 shows the quality select, step 5 the qualified / lost buttons),
and every hand-written track-record line the viewer wrote (or any, for an admin) shows an `edit` on hover → inline text +
date, `PATCH /api/sales-leads/[id]/events/[eventId]`. List API returns `viewer_is_admin`. Service MCP 50 tools.
- **2026-10-19 (app-only, becf572)**: the add-a-line box is a composer — kind pills, a growing text box (⌘/Ctrl+Enter), channel
  only for contact kinds, date starting at today, and the contact rule written under it. The free `notes` box is labelled
  **Background** ("standing context, not dated"), grows, and shows Saving / Saved / Not saved. The name shows a pencil and an
  inline "Not saved" on failure; the page's error toast stays 7 s. Checked: a name edit from the card reaches the kernel
  (`agent_audit_log` command `update_sales_lead` with `full_name`); no UI name edit had ever been logged before. A /sales-leads
  rename does NOT update the linked prospect/contact (the ICP list keeps the old name) — not built. The kernel still joins a
  line's newlines into one paragraph.
  Same day: the track record folds (localStorage `salesleads.trackOpen`, folded = one "Latest · …" line); channel is picked with
  buttons (`CHANNEL_LABELS` / `DEFAULT_CHANNEL` call→phone, meeting/met→in person / `CHANNEL_REQUIRED` sent + reply in
  `lib/sales-leads.ts`); email = "Sent a message" or "They replied" + Email, no separate kind. The kernel accepts only the six
  channels (`_NOTE_CHANNELS`) — a 'video' channel needs a kernel change.

### 5.ai.8 Edit capabilities on the service MCP (2026-10-16, feat/mcp-edits, core/hermes 0.49.4, no migration)

Amir: "add all the edit capabilities in our MCP tools — sales leads, edit name, whatever we want to edit." Audit: the kernel
already took the card + journey fields on `update_sales_lead`, but the **service-MCP schema listed none of them** (clients
build calls from the schema, so the bot could not even see "edit the name"); `rank` was missing too. Now fixed, plus:
`commands/prospecting.py::update_prospect` / ring `crm_prospect_update` (name, title, company, email, phone, LinkedIn,
location, `priority_rank`; company = RE-POINT to the named account, never rename the org-wide row; a profile already on
another lead of the owner → `duplicate_of`; the old member id is cleared; the lead's `/sales-leads` row is mirrored with one
"edited …" line; owner scope as `prospect_get`); `edit_sales_lead_event(delete=true)`; and service-MCP exposure of
`crm_get_deal`, `crm_list_my_deals`, `crm_search_deals`, `crm_update_deal`, `crm_add_note`, `crm_mark_deal_lost`,
`crm_schedule_followup`, `crm_prospect_get`, `crm_prospect_archive`, `crm_icp_set_first_message` (entries generated from the
ring's own schemas). **`crm_update_deal` refuses a `gate` key on this surface** (the kernel does not enforce the G3 / G7
board check — the agent's prompt does — so a partner app must not move gates); `crm_advance_gate` is not exposed. Not built:
website / industry edits (org-wide account data), stage edits (system-owned), a delete for leads, an edit UI for prospects.

### 5.ai.9 Excel exports — sales leads, prospects, a full ICP (2026-10-16, feat/excel-export, app-only)

Amir: "export options for sales leads, full ICP and prospects in Excel — in the UI and in the tools." `lib/export/build.ts`
(server only, SheetJS + ONE checked-out pg client, sequential): `salesLeads` = sheets *Sales leads* (27 cols incl. journey,
roles, ping date, dossier) + *Track record*; `prospects` = *Prospects* (29 cols: fit + why, LinkedIn request state, messages
sent, replies, research, owner, source); `icp` = *ICP* (definition + flattened criteria + counts) · *Leads* · *Funnel* ·
*Activity*. **Visibility = the screen's rule, re-enforced in the builder**: sales leads org-wide; prospects mine + unowned
(admin all); ICP via `visibleIcp` (owner or admin). `OPEN` / `DUE` / `SORTS` moved to `lib/sales-leads-sql.ts` so the list
route and the export share ONE due predicate. **UI**: `components/ExportButton.tsx` (fetch → blob, errors shown inline) on
/sales-leads (current view / search / Mine / sort), /prospecting (stage + Mine), /icp/[id]; `GET /api/export/{sales-leads|
prospects|icp}` (cookie). **Tools**: `export_sales_leads` / `export_prospects` / `export_icp` on BOTH MCP surfaces (public
`/api/mcp` as app-owned tools in `APP_ONLY`; service MCP 64 tools) — a tool cannot return a file, so each builds the workbook
once as the caller (validation + row counts) and returns `download_url` = `/api/export/download?t=<token>`: HMAC-SHA256
(`SESSION_SECRET`) over {user, kind, args, expiry}, **15 minutes**, stateless (nothing stored; rebuilt when opened; role
re-read from the DB), whitelisted in `middleware.ts`. Anyone holding the link can download until it expires. Verified live:
236 sales leads / 974 track-record lines, 617-lead ICP in 4 sheets, a plain user refused another owner's ICP, tampered and
expired tokens rejected. Not built: CSV, a scheduled / emailed export, column picker, exporting deals or the network list.

### 5.ai.10 Next step + LinkedIn connection state on the lead card (2026-10-16, feat/lead-next-step, core/hermes 0.49.6, migration 061)

Amir, on a Fakuma lead's card: "add connected on LinkedIn, and the next envisioned step after the ping date. If we have no
'in' to the contact we want to connect first; when connected, reach out." **Migration 061**: `sales_leads.next_step` (free
text ≤200). **Rule** (`policy/next_step.py`, ported to `lib/sales-leads.ts` — change both): an IN = a LinkedIn connection, a warm
introduction (journey 1), or a channel we hold (email, journey 3). No in → "Connect on LinkedIn"; request filed → "Approve the
connection request"; sent → "Wait for the connection request to be accepted"; connected → "Reach out: first message", then
"Follow up"; an unanswered reply → "Answer their reply"; a booked call → "Prepare for the call or meeting"; dead request with no
other way in → "Ask for a warm introduction"; no profile → "Find their LinkedIn profile". `linkedin_state` = the ledger's
`lead_state` + hand-set journey ≥ 2 counts as connected + a pending connect approval = `awaiting_approval`.
- **Kernel**: `sales_leads.lead_signals(conn, ids)` (one query: prospect degree + newest invitation + events + waiting approval
  → state + suggestion; used by `get_sales_lead`, the due list and the digest), hooks `note_linkedin_connected` (journey → 2,
  next step → first message) called from `invitations.reconcile_invitations` on every acceptance and from `record_invitation`
  for an already-connected result, `note_connect_request_sent` (next step → wait); both only touch a lead that already has a
  /sales-leads row, never overwrite a step a person typed (`SUPERSEDABLE`), never move the journey back, run in a savepoint.
  `update_sales_lead(next_step)` logs a `status` line; `get_sales_lead` returns `linkedin`, `next_step`, `suggested_next_step`;
  the morning digest line ends with `→ <next step>`. Ring: `crm_update_sales_lead` / `crm_get_sales_lead` text, skill §"Next step and
  LinkedIn". Service MCP schema lists `next_step` (clients build calls from the schema).
- **App**: the rail gets a **LinkedIn** block (status dot + "Connected · accepted 12 Oct" / "Request pending · sent …" /
  "Not connected", **Connect on LinkedIn** = `POST /api/prospects/[id]/connect`, which FILES an approval card for the lead's
  owner and sends nothing; **Mark as connected** sets journey 2 for leads with no prospect behind them) and a **Next step** field
  under "ping again on" (free text + preset list, "Suggested: … — why" with a Use button). The row shows `→ next step` under the
  title line when set, and its LinkedIn icon is blue connected / amber pending / muted otherwise. List SQL adds two laterals
  (newest invitation, event counts). Excel export has a "Next step" column.
- Not built: a "not connected" filter on the toolbar (the obvious connect-first queue), batch-connect from the list (the ICP page
  already queues N requests per list), a next-step line in the Telegram reply notices.

### 5.ai.11 Contact section + who is connected on LinkedIn (2026-10-16, feat/lead-contact, core/hermes 0.49.7, migration 062)

Amir, on the lead card: "top of the right section = contact details — website, email, phone, LinkedIn, whether we have them or not —
and on LinkedIn show who is connected: Mateo may not be, Matthias is." **062**: `sales_leads.phone` (backfilled from
`raw_payload.phone` / `contacts.phone`). `update_sales_lead` takes `phone` and `website` (card fields, logged as one "edited …" note;
`email` '' now stores '' — the column is NOT NULL, clearing used to error). `sales_leads.linkedin_links(conn, lead_id)` = every
ACTIVE LinkedIn account with this person as a 1st-degree relation or an open / accepted request (matched on slug or member id, from the
lead's URL and its prospect) → `get_sales_lead.linkedin.connections` and the app's `GET /api/sales-leads/[id]` (`lib/sales-lead-links.ts`
is the SQL port — change both). Live check: 32 of 236 open leads are linked to a teammate, all through Matthias (30 connected, 2
pending); several have a different back office. **App**: the rail opens with **Contact** (four always-visible rows, click to edit,
Enter saves), then a "Connected on LinkedIn" panel: one line per seat (back office / front office, front falls back to back) with
connected / request pending / not connected, plus teammates outside the seats and a hint when only they can reach the person;
Connect on LinkedIn (files the request for the OWNER's approval) and Mark as connected live there now. Export gains Phone; service MCP
schema lists `phone` / `website`. Not built: the next-step suggestion still looks only at the lead OWNER's account (a teammate's
connection is shown, not yet used as "an in"), phone edits do not write back to `contacts.phone`.

### 5.ai.12 Enrich button on the lead card (2026-10-18, feat/lead-enrich, core/hermes 0.53.2, no migration)

Amir: "add an Enrich button next to Contact and show a progress bar — phone, let's leave it." **Steps** (core `policy/lead_enrich.py`,
ring `lead_enrich.py`, tool `crm_enrich_lead {lead_id, step}`; 172 tools): LinkedIn profile → website → email, ONE server call per step
so the bar is real. Each reuses the Enricher's own parts (`linkedin_find.find_profile`, `research_prospect` / `research_company`,
`enrich_one(kinds=("email",))`) and runs as the PROSPECT'S OWNER (their LinkedIn account, their budgets) with an `agent_runs` row
like `crm_enrich_prospect`. Differences: the LinkedIn step also runs when the owner has NO LinkedIn account (free web search only,
a hit is offered as a candidate to confirm, never written unverified — Mateo has no account), the website step falls back to the
company email domain (free-mail excluded), and the email step honours `email_credits_per_day`. **Kernel**:
`sales_leads.prepare_enrichment` (authorises: admin / back office / front office / prospect owner; finds or CREATES the prospect for a
lead that came in without one — 39 open leads, 37 of them the PEI Napa import — unscored, owned by the back office, linked via
`raw_payload.prospect_id` so later sends mirror onto the same row) and `sync_enriched_contact` (copies contact email, profile and
company website back onto the card, FILLING ONLY EMPTY FIELDS, one "enriched …" track-record line). **App**:
`POST /api/sales-leads/[id]/enrich {step, public_identifier?}`, `components/sales-leads/EnrichPanel.tsx` (`useEnrich` + progress bar,
skips steps whose field is already filled, a candidate list with "Use this" for ambiguous LinkedIn hits, which then retries the
email); the button sits in the Contact header. Service MCP `crm_enrich_lead`. Phone is deliberately not a step: the only realistic
source is a switchboard number, and the NRW list is no-calls. Not built: bulk enrich from the list, writing a found phone, using a
teammate's LinkedIn account when the owner has none.

### 5.aj Marketing — paid ads inside the CRM (2026-10-13, feat/marketing, round 1 app-only)

Amir: "we are starting ads in Google Ads and LinkedIn Ads — add a marketing menu, connectors, pull our performance
data." Plan of record: `docs/marketing-ads.md` (two systems of record, closed loop via `gclid`/`li_fat_id` + UTMs on the
zeami.io form, daily restated metrics, offline conversions back to the platforms in round 4).
- **Round 1 (shipped)**: Sidebar group **Marketing** (`/marketing` overview frame with the six committed KPIs and an
  honest empty state; `/marketing/connectors` with one card per provider — status, scopes, prerequisites, live server
  env check). `lib/marketing.ts` = `AdProvider`, `PROVIDER_META`, `ConnectorStatus`. API:
  `GET /api/marketing/connectors` (reads `oauth_tokens` rows `provider in ('google_ads','linkedin_ads')`),
  `GET …/[provider]/connect` (501 + `missing_env[]` until round 2 adds the redirect/callback), `POST …/[provider]/disconnect`.
  Sidebar active state is now longest-prefix, so a parent item is not lit on its child route.
- **Round 1b (same day)**: the connectors work. Google Ads = **service account** (Amir has a Cloud project + service
  account; env `GOOGLE_ADS_SERVICE_ACCOUNT_JSON` / `_DEVELOPER_TOKEN` / `_CUSTOMER_ID` / optional `_LOGIN_CUSTOMER_ID`;
  RS256 JWT → `googleAds:searchStream` GAQL, `lib/ads/google.ts`; "Verify access" = one `FROM customer` query).
  LinkedIn Ads = OAuth (`LINKEDIN_ADS_CLIENT_ID` / `_CLIENT_SECRET` / `_ACCOUNT_ID`; scopes `r_ads r_ads_reporting`;
  callback `/api/marketing/connectors/linkedin_ads/callback`; token in `oauth_tokens` provider `linkedin_ads`, newest row
  used org-wide; `adAnalytics` pivot CAMPAIGN daily, `lib/ads/linkedin.ts`). `GET /api/marketing/overview?days=` reads
  both LIVE (10-min cache, per-provider `ok`/`error`) and `/marketing` shows spend / impressions / clicks / CTR / CPC per
  campaign + spend sparkline; Leads / Cost per lead / Pipeline stay "—" until touchpoints exist (platform conversions are
  shown greyed "as reported"). API versions pinned by env (`GOOGLE_ADS_API_VERSION` v21, `LINKEDIN_API_VERSION`, default 202609 — 202509 was already retired on 2026-10-14; LinkedIn keeps ~12 months active)
  — bump when a platform retires one. `deploy.yml` writes the seven new secrets. **Unverified against live accounts**:
  both request/response shapes were written from the API docs; the first "Verify access" / Connect tells.
- **Round 1c (2026-10-14, feat/mcp-marketing, app-only)**: the overview loader moved to `lib/ads/overview.ts`
  (`adsOverview(days)` + `providerTotals`), the route is a thin wrapper, and the service MCP gained **`marketing_overview`**
  (39 tools) — per-provider totals (spend, impressions, clicks, CTR, CPC, platform conversions / Lead Gen leads, spend on
  the last closed day and the day before), every campaign, optional daily rows — so the Zeami Omni stand-up bot can
  answer "ad spend yesterday / today + inquiries" (inquiries stay "as reported" until touchpoints exist).
- **Round 1d (2026-10-18, app-only)** — Amir: any period via a calendar, quick ranges, channel-first table, a campaign
  popup. `components/marketing/DateRangePicker.tsx` = Today · Yesterday · Last 7 days (the 7 closed days before today,
  the default) · More ▾ (This / Last month, This / Last year) · a calendar popover (two date inputs + Apply); presets in
  `lib/marketing.ts` (`presetRange`, `rangeLabel`, local dates). The range lives in the URL (`?range=last_7`, or
  `?range=custom&from=&to=`), so a view is shareable; named presets recompute on load. `GET /api/marketing/overview` takes
  `since&until` (≤ 1,100 days; `days=` still works) via `adsOverviewRange`. Table: Channel first (Google Ads / LinkedIn
  Ads by name + campaign type), Campaign second; the "N campaigns · spend per day" line and its sparkline are gone. A
  campaign name opens `components/marketing/CampaignModal.tsx` ← `GET /api/marketing/campaign?provider&id&since&until`
  (`googleCampaignDetail` / `linkedInCampaignDetail`, 10-min cache): setup, budget, LinkedIn campaign group, 7 KPIs
  (spend, impressions, clicks, CTR, CPC, results, cost per result), daily spend sparkline, tabs Ad groups (Google only —
  LinkedIn has no ad-set level: group → campaign → ads) and Ads, filters All / Active / Not active + "with activity
  only", sortable columns, ad group → its ads. "Active" = would serve now (the ad AND its parents on). LinkedIn ads are
  sponsored posts without names: labelled "Sponsored post …<id>", linked to the post. Closes on ×, Escape, outside click.
  Verified against both live accounts the same day (Search-DE: 3 ad groups / 3 RSAs; LinkedIn: 2 campaigns, 6 ads).
- **Rounds 2–4 (planned, not built)**: core migrations 055 (`ad_accounts`, `ad_campaigns`, `ad_metrics_daily`),
  056 (`lead_touchpoints`), 057 (`agents.ads_sync` policy + `ad_conversion_outbox`); OAuth flows (Google: existing client
  + `adwords` scope + developer token + MCC id; LinkedIn: new app, Advertising API approval, `r_ads_reporting`);
  `ads_sync` Hermes `--no-agent` cron at 05:30 with 3-day lookback; `commands/ads.py` + `policy/ads.py` +
  `crm_ads_summary/_campaigns/_sync_now` (family `crm_marketing`); public sales-leads form takes UTM + click ids;
  LinkedIn Lead Gen Forms → `/sales-leads`; reporting; offline conversion upload. Outside-code lead times to start now:
  LinkedIn Advertising API approval, Google developer token, zeami.io form change.

### 5.ak /sales-leads priority 1–10 + order, and Mateo's Fakuma 2026 master list (2026-10-15, feat/lead-priority, core/hermes 0.49.0, migration 059)

Amir: "put the priority from 1-10 and add a reordering column — some leads will have the same priority so I will
put numbers", plus Mateo's 70-company Fakuma master list (PDF of a Telegram message) to import, enrich and find
LinkedIn + emails for. **This reverses 057** (five labelled levels, decided the day before).
- **059**: `sales_leads.priority` CHECK 1..10 again (1 = top; labels are the number, `P3`), NEW `sales_leads.rank`
  INT = the order INSIDE a priority (NULL = unordered, sorts last). Every order (`list_sales_leads` working/due,
  `due_leads`, the page's priority/contact sorts) is `priority, rank, must_talk`. `update_sales_lead` takes
  `rank` (0 clears), writes an `order → N` event of kind `priority`; `crm_update_sales_lead` and the service MCP
  text say 1–10 + rank. Page: the priority pill is a 1–10 select, a small number box next to it is the order
  (commit on blur / Enter); the `#` column stays the list position.
- **Mateo's list**: `salesbrain-hermes/scripts/data/mateo_fakuma_2026.json` (54 of 70 entries — #55–69 were
  missing from the PDF export, #70 is a corporate tail) + `scripts/import_mateo_fakuma.py` (run on the box:
  `import` → ICP "Fakuma 2026 — polymer distributors & PE platforms (Mateo)" under mateo@chipchip.social,
  `upsert_candidate` per named person (`source_type='event_list'`, `priority_rank` = list number), a PLACEHOLDER
  prospect "<Company> — decision maker (to identify)" for the 22 companies named without a person, every row
  mirrored to `/sales-leads` with `source='event:fakuma-2026'`, priority = the list's priority group (1–4), rank =
  position inside the group, `met_at='Fakuma 2026'` for the "Met Onsite" ones, dossier = owner/structure + pitch;
  `enrich` → `find_profile` (web → LinkedIn search → verified) per named person and company-first leader discovery
  for placeholders (discovered leaders replace the placeholder, inherit its priority/rank), company research;
  `emails` → FullEnrich, capped; `sync` → copies found profiles/emails/research onto the mirror rows). Mateo has no
  LinkedIn connected, so the LinkedIn rungs run on Amir's Unipile account (`--account`), the web rung is keyless.

### 5.al Mateo = one account, mateo@zeami.io (2026-10-16, data only)

Amir: "the default email for Mateo should be mateo@zeami.io … merge everything." Mateo had four `users` rows: his login
(mateo@chipchip.social, April) and three made by the Zeami app's `register_user` — key "Zeami" (Sep, 22 empty ICPs),
"Zeami AppnMCP" EMP-0077 (mateo@zeami.io, the id the bot actually uses, 264 calls) and EMP-0001 (alumni address).
Done: Frank Barlog, a lead on both his login and the EMP-0077 account, folded into the Fakuma lead (phone, 2 dossier
facts, 10 track-record lines kept); `store/merge_users.py` folded the EMP-0077 and "Zeami" accounts into the login
(id `f8473946-d6be-455b-9c7d-c564c3ac79b3`); that row's email is now **mateo@zeami.io**, name "Mateo Klemmayer", same
password; both app mappings point at it. 68 imported sales leads had `raw_payload.owner` = "Mateo" → renamed
(`apply_role_defaults` matches the name, oldest user first). Backup: `~/.cache/salesbrain/backups/mateo-merge-20261016161429/`.
**Left alone on purpose: EMP-0001** (`267c648d…`, empty). The app registered it as Mateo, then 45 min later
re-registered it as "Amir Redwan, amir@zeami.io" and has used it since — it looks like Amir's employee id in the Zeami
app. Mapping it to Mateo would file Amir's bot activity under Mateo; waiting on Amir. Which id the bot SENDS is decided
in the Zeami app, not here.

**Hannes = one account too (same day).** His login hannes@chipchip.social absorbed both "Zeami"-key app accounts
(`1d74dcc5…`: 1,063 prospects, 4 Ethiopian-retail ICPs, LinkedIn `hannes-garben`; `4dc2cfc4…`: 2 funding ICPs). Amir:
"he uses the MCP mostly — merge all into one." Both app ids still work and now land on the login; his MCP token
"Hannes Codex" was already there. Before this his login showed no LinkedIn and none of those prospects. Backup:
`~/.cache/salesbrain/backups/hannes-merge-20261016164741/`. Open question for both: the service MCP has NO company field
(token = app, header = employee id, `register_user` takes id + name + email only), so if the Zeami app is multi-company,
equal employee ids from different companies share one account; options + a "refuse re-registration with a different
email" guard were proposed, not built.

### 5.al Gemini default, Bedrock fallback + Telegram onboarding + self-explaining notifications (2026-10-16, feat/telegram-one-bot, core 063/064)

Amir: one Telegram bot for every user (plan `~/.claude/plans/telegram-one-bot.md`; phases 1 and 5 built here, the cutover
and admin tools come later), "unless they send the code, don't respond", and "make Gemini the default and Bedrock a fallback".
- **Gemini default** (key in `/root/.hermes/.env` + every SalesBrain profile `.env` + GitHub secret `GEMINI_API_KEY` +
  `.env.local`; applied over stdin, never printed; backups `*.bak-gemini` on the box to delete after the deploy).
  Models tested live with a real tool call: main `gemini-3.1-pro-preview` ($2 / $12 per MTok, no free tier, so the key's
  project has billing), helpers `gemini-2.5-flash` ($0.30 / $2.50). `deploy-server.sh`: `model.provider gemini`,
  `fallback_providers [{bedrock, us.anthropic.claude-sonnet-4-6}]` (a real YAML list, PROVEN on the box in a scratch
  HERMES_HOME: broken Gemini model → "Fallback activated: … → us.anthropic.claude-sonnet-4-6 (bedrock)" and the answer
  came back), `auxiliary.salesbrain_aux` + `background_review` on Gemini 2.5 Flash (aux client verified), every profile card
  the same; the verify block REFUSES a deploy where the provider is not gemini, the fallback is not a list, the key is
  missing from the main or crm env, or `unauthorized_dm_behavior` is not `ignore`. Flip back = change `MAIN_PROVIDER`.
  Preview models can be retired: if 3.1 Pro goes, set `MAIN_MODEL=gemini-2.5-pro`.
- **The schema trap**: Gemini 400s the WHOLE request on one bad tool declaration, and a fallback would hide that the primary
  never worked. 144 of 145 tool schemas passed; `crm_update_sales_lead.journey_outcome` had an empty-string enum value (now
  `clear`; the kernel accepts both). `tests/test_gemini.py::test_every_tool_schema_is_gemini_safe` guards every future tool.
- **Ring** `llm.py`: outside Hermes (cron scripts, rpc) Gemini REST first, then Bedrock; the same order when the host call
  fails. 2.5 Flash gets `thinkingBudget 0`; other models get headroom (thinking counts against `maxOutputTokens`); usage
  records `provider='gemini'`, thinking tokens as output, cached tokens apart. **Core 063** adds Gemini price rows to
  `costs.rates` (3.1 Pro, 2.5 Pro, 2.5 Flash; cache_read an ESTIMATE; prompts over 200k are under-priced; `-lite` and 3.x flash
  show as `unpriced_tokens`).
- **App** `lib/gemini.ts` + `createMessage` (lib/llm-usage.ts): Gemini first, Claude on ANY failure (HTTP, timeout, blocked or
  empty answer). Facts found by testing, all in the file header: the 3.1 Pro model cannot disable thinking (a 60-token budget
  returned 10 characters, so +4096 headroom and `thinkingLevel: low`); Gemini 3 REQUIRES the `thoughtSignature` of a function
  call to come back with it (carried on the tool_use block as `thought_signature`; a Claude-made call replayed after a
  fallback uses Google's documented `skip_thought_signature_validator`); `web_search` maps to `googleSearch`; the Claude path
  strips Gemini-only fields and hosted search. `MODEL` is the Gemini id when the key is set, `BEDROCK_MODEL` the fallback;
  `webSearchTools` is non-empty on Gemini. 9/9 live adapter checks passed (text, JSON, tool round trip, replay, sanitizer,
  mapping, bad model, timeout). Not verified: a full browser session of /network chat on Gemini.
- **Phase 1, onboarding.** Strangers get NOTHING: both bots answered an unknown sender with a Hermes pairing code (default
  `unauthorized_dm_behavior: pair`, unset on the box); `ignore` is set globally and for telegram. The link hook runs BEFORE
  the gateway's authorization (verified, `gateway/run_inbound.py` line 225 vs 230), so `/start LINK-…` still works. A bad or
  expired code gets one failure line (copy now says Profile → Telegram). `board_hook._sync_access`: access follows
  `telegram_user_links` — an ACTIVE link is paired on the first message (the Hannes case: linked 08-09 before auto-pairing),
  a REVOKED link loses its pairing, someone who never had a link is untouched (manual `hermes pairing approve` stays valid);
  60 s cache. App: `generateLinkToken(userId, {ttlMs})`; admin `POST /api/admin/users/[id]/telegram-invite` (7-day single-use
  code, emails a one-tap `t.me/<bot>?start=LINK-…` through Resend, or returns it to copy; audited); `/admin/users` shows
  "on Telegram since …" / "not on Telegram", a filter, and email-invite / copy-link actions (the username column was null for
  everyone, so the state is `telegram_linked`); `components/TelegramNudge.tsx` on the home page (connect in one tap, snoozes a
  week). Not built: the one-bot token cutover, `/profile` redesign.
- **Phase 5, notifications that explain themselves** (core 064: `notification_log`, `notification_prefs`, policy
  `agents.linkedin_digest {max_age_days 14, max_items 8}`). The 2026-10-16 screenshots: the bot answered "that message came
  from me, in this conversation", then "that's outside my world". The digest is posted by `linkedin_sync.py` straight to the
  Bot API, outside any session. Now `deliver.notify_user(..., source=, reason=)` is the one sender for automatic messages: mute
  check, footer "— sent by the hourly LinkedIn inbox check · 3 new messages. Say "mute linkedin-sync" to stop these.", and a
  log row (with the Telegram message id). Callers without a source behave as before. Sources: linkedin-sync, leads-finder,
  enricher, graph-sync, grant-signals, sales-leads-due, reply-alert, crm-event. Tools `crm_notification_source` (find by quoted
  text or message id, the asker's own rows only) and `crm_notification_settings` (list / mute / unmute), family crm_agents,
  147 tools; both personas got an "Automatic messages — look them up, never guess" section and the team persona got the Tool
  truth rules it lacked. **LinkedIn digest age cap**: `inbox(max_age_days=)` filters IN SQL (the order is stalest-first, so a
  limit applied before an age filter fills the page with the oldest threads). Live: 15 threads → 5 listed + "10 older
  waiting"; acceptances alone now produce a digest (the old gate dropped them when no thread awaited a reply).
- **linkedin_sync.py now has an `if __name__ == "__main__"` guard** (it ran `main()` on import).
- Migrations 063 + 064 are files only; the integration session applies them. Deploying this = apply 063/064, lockstep bump,
  `deploy-server.sh` (restarts the gateway: check the bot is idle), merge to Production.
- Next in the plan: Phase 2 cutover to the single bot (needs Amir's tokens), Phase 3 admin tools, Phase 4 Google / LinkedIn /
  imports / exports from chat (migrations 065+).

### 5.am Phase 2 — the one-bot build: role policy, unified persona, slash gating, handover (2026-10-16, feat/telegram-one-bot, core 065)

Runbook: `salesbrain/docs/telegram-one-bot.md`. Code + checks are done and tested on the box; the cutover itself
is `ONE_BOT=1 bash scripts/deploy-server.sh` with Amir present.
- **`role_policy.py`** (`pre_tool_call`, Telegram only, fails closed): `crm_*` + a short harmless list (web search/extract,
  skills, vision, voice, todo, clarify) for everyone; EVERYTHING else (shell, files, code, scheduler `cronjob_manage`,
  browser, `delegate_task`, `session_search`, `memory`, …) only for an administrator, only in a private chat, only while
  policy `agents.telegram.admin_shell` is on (core 065, default on). It is an ALLOWlist because the composite gains tools
  every release. Proved through Hermes' real `handle_function_call` on the box with real identities: Amir private → ran;
  Amir in a group → "private chat only"; a linked teammate → "not an administrator"; web_search → allowed. In the agent
  loop the hook applies to inline tools too (`_dispatch_authorized_once`), and workers inherit the session context
  (`propagate_context_to_thread`). Known soft spot: a call with no platform in context is "not governed" (cron, CLI, web
  chat have their own toolsets); children of `delegate_task` are server-class, so only an admin DM can spawn them.
- **Unified persona** (`assets/profiles/default/SOUL.md`): one agent for the whole team, role-aware, with the Tool truth,
  Learn and Automatic-messages sections; the caged `crm` persona is retired with the second bot.
- **Slash commands** gated through `platforms.telegram.extra.allow_admin_from` (admin ids from the DATABASE at each deploy:
  role admin + active link; an EMPTY list would switch gating off, so the deploy stops) and `user_allowed_commands`
  (`new status retry undo title stop`; `/help` and `/whoami` always). Verified with Hermes' own `policy_for_source`: Amir
  can run /skills and /cron, a teammate cannot but can run /new /status /help.
- **Trap found: `allow_from: ['*']`** sat in the live config. Hermes consults it only when NO env allowlist has entries, so
  "make TELEGRAM_ALLOWED_USERS bootstrap-only" would have admitted every Telegram user. The deploy clears it and REFUSES a
  deploy where `*`, `GATEWAY_ALLOW_ALL_USERS` or `TELEGRAM_ALLOW_ALL_USERS` is present.
- **`ONE_BOT=1` handover**: the CRM bot's token is already on the box (`SALESBRAIN_BOARD_BOT_TOKEN`), so it is COPIED into the
  default profile's `TELEGRAM_BOT_TOKEN` (no secret travels), the union of both allowlists is kept, the crm adapter is
  retired (no 409), rollback copies `*.pre-onebot` (0600) are left. Tested on a scratch copy. Cost: teammates' Hermes chat
  history restarts (notes and all CRM data survive). Then Amir revokes the OLD bot's token in BotFather.
- Not built yet: Phase 3 admin tools (`crm_jobs_status`, `crm_job_control`, kill switch, policy editor, costs, learning
  review from chat) and Phase 4 (Google / LinkedIn / imports / exports from chat; migrations 066+).

### 5.an Phase 3 — administrator controls from chat, `crm_admin` family (2026-10-16, feat/telegram-one-bot, no migration)

The admin pages' controls, as eight tools on the one bot (family `crm_admin`, added to the Telegram toolset ONLY; web chat
and cron never get it; each tool is `mcp=None` and refuses a non-admin ITSELF, because `role_policy` deliberately lets every
`crm_*` tool through). 155 tools now.
- **Ring-only (`admin_ops.py`)**: `crm_jobs_status` reads `$HERMES_HOME/cron/jobs.json` (default profile + each profile's own:
  schedule, running/PAUSED, last run + result, next run, failure streak, last error ≤240 chars, `healthy`/`failing`/`paused`);
  `crm_job_control {name, run|pause|resume}` shells out to `hermes [-p profile] cron <action> <name>` as an ARGUMENT LIST, the name
  must exist in a jobs.json (an injection attempt never reaches a process), no create/edit/remove, audited. `run` queues for the
  next scheduler tick (said in the reply). Verified on the real box: pause then resume of `learning-digest` through the real CLI
  restored `next run 09:15`.
- **Kernel (`commands/admin.py`, `policy/admin_policy.py`)**: `master_switch` (status / halt / resume — the stored flag
  `agents.kill_switch.enabled` TRUE means agents are ALLOWED, which reads backwards, so the tool speaks in halt/resume and always
  reports `agents_running`); `policy_get` / `policy_set` over a WHITELIST of (row, field) pairs with a type and a range each,
  ~60 fields across `agents.leads_finder|enricher|outreach|followup|supervisor|learn|graph_sync|linkedin_connect|linkedin_digest|
  memory|telegram` and `prospecting.limits`; only a field that already exists on the row can be set (a typo cannot invent one) and a
  stored type is never silently changed; audited with old and new. **Never reachable from chat**: `outreach.*` (send gate, quiet hours,
  frequency caps, channel ladder, commercial gate), `autonomy.*`, `costs.rates`, `agents.linkedin_limits`, and `agents.kill_switch`
  (its own tool); a test asserts no whitelist entry overlaps the denylist. `users_overview` (name, role, on Telegram, LinkedIn
  connected, agents held, registering app; stubs excluded; `telegram=unlinked` = the invite list); `telegram_invite` (single-use
  `LINK-` code, 1-14 days, the same hash as `lib/telegram-links.ts`, refuses an already-linked person, an ambiguous name returns
  candidates instead of guessing). Ring wrappers: `crm_user_invite` builds the `t.me/<bot>?start=` link (env or one getMe) and can
  email it; `crm_learning_review` lists / decides staged skill and note writes and lists team-memory proposals.
- **Persona**: an "Administrator controls" section — read before changing and say old → new, ask before halting / pausing / switching
  an agent on / raising a LinkedIn cap, a `refused` result means "not an administrator", costs point to the Costs page.
  Behaviour confirmed with Gemini 3.1 Pro against the real persona and all 155 tools: "raise the cap to 12" → reads
  `crm_policy_get` first; "pause the enricher" → checks `crm_jobs_status`; "stop all agents" → asks "are you sure?". All 155
  declarations accepted by Gemini (~24.7k prompt tokens of tool definitions per model call, the admin family ~1.3k of it).
- **Costs deliberately have NO tool** (Amir, 2026-09-29: `/admin/costs` is the one surface, `cost_report` stays an app-only RPC).
  The plan listed one; the earlier explicit decision stands unless Amir reverses it.
- **Found while testing on the live scheduler (the tools' first real use)**: five jobs are failing. `attention-allocator` (6 in a
  row), `ops:outreach:daily` (23), `ops:supervisor:daily` (23), `ops:learn:weekly` (3): `RuntimeError: Unable to locate credentials` —
  the Bedrock bearer-token bug of §5.ah.3 in the cron runtime. They should recover once Gemini is the main model (deploy), then
  confirm with `crm_jobs_status`; the Bedrock fallback would hit the same bug if it ever triggers in cron. `pmi-sync` (21):
  `CERTIFICATE_VERIFY_FAILED` reaching the PM tool — a certificate problem on the PMI side, not ours.
- **Left for later**: Phase 4 (Google / LinkedIn connect links, CSV import, exports from chat; migrations 066+), inline approve
  buttons for team-memory proposals (the tool exists), a user-level "my jobs" view for non-admins.

### 5.ao Phase 4 — connect accounts and move files from the chat (2026-10-16, feat/telegram-one-bot, core 066)

Amir: "import my Google" must work through Telegram, and the other UI-only features too. Six `crm_connect` tools, Telegram-only
toolset (161 tools), each acts as the asking person and `mcp=None`:
`crm_connections_status`, `crm_connect_start` (google | linkedin), `crm_google_sync`, `crm_import_contacts`, `crm_export`,
`crm_mcp_tokens` (list / revoke only).
- **Connect links** (core 066 `connect_tokens`: hash only, 15 min, opened once, finished once, bound to the person AND the Telegram
  chat). `commands/connect.py::connect_start` (attended only; a newer link supersedes the older) and `connections_status`
  (Google account + last refresh, LinkedIn account / Sales Navigator / paused-for-agents, Telegram, contacts imported by source,
  links waiting). The bot returns `https://salescrm.chipchip.social/connect/<token>`; opening it needs NO login (the token is the
  identity for that one step): `app/connect/[token]/route.ts` consumes it and redirects to Google's consent screen or to a Unipile
  hosted-auth link (password typed on THEIR page). Returns: `/api/integrations/google/callback` (now serves both the browser and the
  Telegram flow; for Telegram `state.t` must name a still-open token) and `/api/connect/linkedin/claim?s=` (same claim safeguards as
  the browser: fresh, unbound, never two candidates). The app then says "✅ connected" IN THE CHAT through `lib/tg-notify.ts`
  (the app's token is the shared CRM bot) and, for Google, imports the contacts in the background and reports the count.
  `/connect/done` is the plain public landing page.
- **OAuth state is signed now** (`lib/signed-state.ts`, HMAC with a key derived from SESSION_SECRET, expiring). The Google `state` was
  the bare user id compared with the session's, forgeable by anyone who knew an id; the old value is rejected (tested).
- **The bridge** (`lib/bridge.ts`, `lib/bridge-tools.ts`, `POST /api/internal/bridge`; ring client `bridge.py`): how the Python ring
  reaches app-only features. HMAC over `timestamp.body` with `BRIDGE_SECRET` (GitHub secret + /root/.hermes/.env + crm .env, >=32
  chars, never printed), 5-minute freshness, each signature accepted once, and not from the internet. **Found by testing:** Next adds
  X-Forwarded-For/-Host/-Proto to EVERY request even a direct one, so "no forwarded headers" cannot mean "not proxied"; the check is the
  FIRST forwarded address being loopback (Caddy replaces it with the visitor's). Tools: `google_sync` (background, result reported to
  the chat), `import_contacts`, `export`, `mcp_tokens` (list / revoke). Python signature verified against the TypeScript verifier in
  a test; 18 signing / bridge checks in `scripts/test-signing.mts` (`node --experimental-strip-types --no-warnings`).
- **Refactors that make this possible** (behaviour unchanged, routes now thin): `lib/google-sync.ts::runGoogleSync`,
  `lib/imports/contacts.ts::importContactsText`, `lib/linkedin-claim.ts::claimLinkedInForUser`, `lib/google-connect.ts::storeGoogleTokens`.
- **Files in**: a CSV sent to the chat is imported only if its path resolves INSIDE a Hermes document cache (no traversal, a symlink out
  is refused), is a recent (6 h) .csv/.txt under 10 MB; read on the ring, handed to the app as base64. **Files out**: `crm_export` writes
  the xlsx under `<root>/cache/documents/salesbrain-exports/` (Hermes only delivers media from a document cache; cleaned after 1 h) and
  returns the line `MEDIA:<path>` for the reply, plus the 15-minute download link. Live check through the real client and a running app:
  252 sales leads as a 1.5 MB two-sheet workbook in 7.7 s, MCP token list, every error path correct.
- **Deliberately not built**: creating an MCP token from chat (its secret would pass through the model provider and the transcript;
  stays on Profile → MCP), `marketing_overview` and service-token minting (admin, high-value; say the word), and a real Google consent
  click was not exercised (needs a person); everything up to and after it was.
- Verified on a real database without touching it: the new table lived in a scratch schema, a second app instance saw only that, tokens
  were minted by the real kernel code and every route was walked (open, replay, signed + bogus code, forged state, legacy state, replay
  of a finished flow, garbage tokens, the LinkedIn path without Unipile env). Scratch schema dropped, the 4 test audit rows removed.
- **After publish, check once by hand**: apply 063-066; from Telegram say "connect my Google" and click through (consent → chat confirms
  → contacts import message); "connect my LinkedIn" (the first live use of the hosted-link return to `/api/connect/linkedin/claim`);
  send a Connections.csv and say "import this"; "export my due leads".

### 5.ap LIVE 2026-10-16 (lockstep 0.50.0, migrations 063-066 applied) — what to check next

Published in one batch: Gemini default + Bedrock fallback, the one-bot Phases 1-5 (all but the supervised `ONE_BOT=1` cutover), notification log,
connect tokens. Verified after the deploy: the ring answers as `gemini-3.1-pro-preview`; every deploy safety check passed; admin tools work through
the real kernel RPC as an admin and refuse a non-admin; `outreach.gate` cannot be edited from chat; the cron path runs on Gemini (the weekly learn
routine went from `Unable to locate credentials` to ok, streak 0 — the other three credential failures should clear at their next ticks, confirm
with `crm_jobs_status`); the public site serves `/connect/done`, refuses `/api/internal/bridge` from the internet (403, the loopback rule works
behind Caddy), redirects a forged Google state to login, and keeps normal API auth (401).
- **Still to do by a person**: a real Google consent click and a real LinkedIn hosted-login return (the code on both sides of those clicks is
  tested; the clicks are not); then the supervised cutover `ONE_BOT=1 bash scripts/deploy-server.sh` and revoking the old bot's token in BotFather
  (`docs/telegram-one-bot.md`). Until then both bots run, strangers get silence on both, and every admin tool works on both.
- **Side findings, not ours**: Hermes logs a warning that the linked SQLite 3.50.4 is vulnerable to the WAL-reset corruption bug (upstream; the
  interpreter's SQLite should be updated). `pmi-sync` still fails with `CERTIFICATE_VERIFY_FAILED` against the PM tool (their certificate).
  The profiles `gilfoyle` and `tesfa` have no Gemini key (not SalesBrain's).
- **2026-10-17 follow-ups.** **Duplicate accounts**: `mateo.klemmayer@alumni.ie.edu` (created 10-12 by the Zeami Omni bot's `register_user`, owned only
  24 MCP audit rows, a password-reset row and one employee mapping) was folded into `mateo@zeami.io` with `store/merge_users` (backup CSVs in
  `~/.cache/salesbrain/backups/pre-merge-mateo-20261017_151438/`); the three Zeami employee mappings (`e80f7ada…`, `EMP-0001`, `EMP-0077`) now point at
  one user, 31 deals / 122 prospects untouched. LEFT ALONE on purpose: the two Becks (`beck@chipchip.social`, `beck@zeami.io`) both have a real password
  and zero trace of use, so there is no way to tell which email Beck logs in with, and a merge deletes one login. ROOT CAUSE of the Mateo duplicate:
  the service MCP's `register_user` creates a new SalesBrain user per unknown employee instead of matching an existing real user by email; it recurs
  whenever the partner app registers a person under a different address. **PMI** = the delivery tool (`pmi.zeami.io`, "Zeami Ops Console", nginx on
  AWS, MCP server `zeami-customers`): delivery journey, cadence, daily reports, health, risks; `pmi_sync` reads it every 3 h so customers already in
  delivery are not flagged as stalled sales deals. **Why `pmi-sync` fails**: PMI's Let's Encrypt certificate EXPIRED 2026-10-14 06:08 GMT (issued
  07-16, 90 days; expired for every client, other zeami.io hosts are fine). The host's HTTP-01 validation path `/.well-known/acme-challenge/` answers
  401 (behind the console's Basic auth), the likely reason renewal failed. Fix is on the PMI host (`certbot renew --dry-run`, exempt the challenge path
  with `auth_basic off`, renew, reload nginx, make sure the certbot timer runs); the sync recovers by itself at the next 3-hourly tick. We do NOT
  disable TLS verification: the sync sends `PMI_MCP_TOKEN` as a bearer. While it is down nothing breaks: confirmed links keep suppressing false SLA
  alerts; only refreshes and new auto-links are stale.

### 5.al Lead Conductor — every sales lead is alive (2026-10-17, feat/lead-lifecycle, migration 068)

Amir: "when we import or add leads it is for us to outreach them, not just to list them — find the LinkedIn, make it
visible, connect, draft the first message when connected, follow up. Everything needs to be alive." Found on 2026-10-17:
the 68 Fakuma leads had been researched by hand but no agent ever touched them (owner Mateo has no LinkedIn and no
Telegram, so a connection request could not even be filed; the Enricher silently dropped him); the 125 Napa leads had no
prospect row so NO agent could see them; `sales_leads.next_step` was empty on all 252 rows; the outreach routine never
proposes a connection request and 26 `agent_runs` rows sat in `running` since August, each counting toward `runs_per_day`.

- **One rulebook** `policy/lifecycle.py` (pure): `decide(facts, cfg, now)` → stage (landed, finding_profile, needs_pick,
  no_linkedin, ready_to_connect, request_filed, request_pending, connected, first_message_waiting, messaged,
  followup_due, followup_waiting, email_path, stalled, replied, call_set, in_conversation, paused, done), `actor`
  (system | you | them | none), one sentence `step`, `blocker`, `next_at` and the ONE allowed `action`
  (ensure_prospect | connect | first_message | followup). Reuses `policy/next_step.linkedin_state`. `pick_sender` /
  `sender_candidates` = whose LinkedIn sends (history, back office, front office, prospect owner, `default_sender`).
  `batch_pick` = today's connect batch (the person's own order, one per company first, within the caps).
- **Kernel** `commands/conductor.py`: `load_facts` (one query over a dozen tables), `lifecycle_tick(actor, dry_run, hour)`
  stores the verdict on `sales_leads.lifecycle_*` (one `status` event per STAGE change, silent on first evaluation),
  creates the prospect behind an orphan lead (`ensure_prospect_for_lead`: links an existing person, else lands a new one
  in a static list `icp_profiles.objective='list'` that the Leads Finder never searches) and hands the prospect to the
  sending account (`hand_to_sender`; the account that already holds a conversation or request keeps it). Honest when off:
  system steps read "waiting for the Lead Conductor". `file_connect_batch` / `decide_connect_batch` /
  `expire_batches` = ONE daily approval card per sender (`connect_batches`, `outreach_approvals.batch_id`; one pending batch
  per person; only the sender can decide; a second tap changes nothing). `needs_you` = the daily "what needs you" DM,
  once per 20 h. `draft_context`, `conductor_status`, `set_lead_paused`.
- **Link**: `sales_leads.prospect_id` is a GENERATED column over `raw_payload->>'prospect_id'` (unique partial index), so every
  existing writer keeps working and joins finally use an index.
- **Sender rule** (Amir): the back office's own LinkedIn sends; Mateo (no account, no Telegram) falls through to front
  office / owner / `sales_leads.roles.default_sender` — and when nobody has an account the lead says so
  (`needs_sender_account`, shown to admins) instead of vanishing. The prospect's OWNER becomes the sender, so every
  existing gate (`propose_connect`, enricher plan, cards to the owner's Telegram) works unchanged.
- **Curated lists** (`event_list, manual, lead_import, kimw_persona, kimw_top100`) bypass `min_score` in the Enricher and
  Outreach plans (Fakuma averaged 54 against gates of 60 / 75). `enricher_plan` now returns `blocked` (owners without an
  account) instead of dropping them.
- **Housekeeping**: `sweep_stale_runs` (3 h TTL) runs first in every cron script; `outreach_queue.py` got a real
  `--dry-run` (the old "dry run" opened a run row nothing closed) and closes its run on error; `outreach_queue` /
  `followup_queue` rank AFTER the reachability filter (an owner's unreachable top scorers used to take every slot).
- **Ring**: Hermes cron `lead-conductor` (hourly 08:30-20:30) = `assets/scripts/lead_conductor.py` (no LLM routine): files
  the batch + posts ONE Telegram card (`cb:<batch>:approve|skip`, `telegram_buttons.py`, `connect_batch.run_filed_batch`
  paces ~10 s per request), drafts first messages (`lead_drafts.py`: the list's template, else a rule-checked model draft;
  a draft that breaks a rule is dropped, never "fixed") and follow-ups as cards (`oa:`), sends the daily digest. Tools
  `crm_lead_conductor_status`, `crm_lead_conductor_plan` (dry run), `crm_lead_automation_pause`. Policy `agents.conductor`
  (ships disabled; `scope` = `[]` | `["icp:<id>","source:<s>","lead:<id>"]`; admin-editable except `scope`).
- **App**: `/sales-leads` row = stage chip + one sentence (colour = who must act) under every lead; funnel strip (click a stage
  to filter, `?stage=`); **Needs you** tab = the viewer's own queue (back office, front office or sending account);
  `LifecyclePanel` at the top of the opened card (six-step path, blocker text, pick candidates, search again, paste a URL,
  Connect now, Pause automation); `GET /api/sales-leads/[id]/lookup`, `POST …/automation`; Excel export + service MCP
  `list_leads` + `crm_lead_lookup` carry the same fields; Users page gets the agent chip. Parity of the stage labels with
  the kernel is a test (`test_lifecycle_parity.py`).
- **Tests**: 38+ pure policy tests; `tests/test_conductor_db.py` runs the SQL for real when `SALESBRAIN_TEST_DATABASE_URL`
  points at a LOCAL scratch Postgres (schema.sql + migrations; skipped otherwise, refuses non-local URLs, wipes what it seeds).
- **Integration** (not done by the feature session): apply 068, then `salesbrain-hermes/scripts/lead_lifecycle_integration.sql`
  (restore connect caps 15/75 + quiet hours 20, mark the hand-made lists `objective='list'`, Fakuma back office → Hannes
  after Amir confirms, enable scoped to `source:event:fakuma-2026` + `source:event:pei-napa-2026`). Mateo needs Telegram
  linked before he can approve anything.
- Not built: Telegram buttons to pick among profile candidates (the page does it), an email-only drafting path of its own
  (the outreach routine still drafts email), per-list funnel conversion on `/icp/[id]`, hand-sent LinkedIn messages arming the
  follow-up timer (they only stop a duplicate first message).

### 5.aq Hermes abilities for every teammate — automations, live skills, memory (2026-10-17, core/hermes 0.51.0, migration 069)

Amir, after the team bot said "I'm caged to CRM tools" and could not set a one-minute reminder: every user gets the CRM tools PLUS the Hermes
user abilities (learning loop and skill creation, persistent memory, scheduled automations), never root. Plan `~/.claude/plans/glittery-watching-ember.md`.
Also this day: **main chat model = `gemini-3.8-flash`** (0.50.1, migration 067 price row; benchmark with all 161 tools: 3.1 Pro preview needed 33-85 s per
answer and stalled one Telegram turn 4 min, 3.8 Flash 2.5-15 s with correct tool calls) and `providers.gemini.stale_timeout_seconds 60` (a hung stream
falls to Bedrock within a minute; deploy verify refuses > 120). 3.8 Flash prices are promotional through 2026-12-31 (0.75 / 3.75 per MTok, doubling 2027-01-01).
- **Automations** (`crm_automations` family, 6 tools, Telegram only; `automations.py`, `tools/automations.py`): `crm_automation_create/list/pause/resume/remove/
  run_now` wrap Hermes' job store (`cron.jobs`). Job name `u-<userid8>-<slug>`, `origin` = the owner's linked Telegram DM, `deliver origin`,
  `enabled_toolsets` = crm families + web + skills only (never shell, files, code, scheduler). Ownership is ours: list/pause/remove touch your own jobs
  (an admin sees all); native `cronjob_manage` stays admin-only. Limits are data, policy `agents.automations` (core 069: enabled, per_user_max 10,
  min_interval_minutes 60, max_prompt_chars 1500; whitelisted in `admin_policy`, so an admin changes them from chat). A job needs an active Telegram link.
- **Identity inside a run** (the safety core): the `tool_request` middleware recognises session `cron_<jobid>_…` of a `u-` job (+ a Telegram origin
  stamp, so a lookalike name does nothing), resolves the owner from `telegram_user_links` on the origin chat, injects `_actor_user_id` and
  `_actor_unattended`; an unresolvable owner = `_actor_deny`, NEVER the env default actor. `role_policy.unattended_allowed` = allowlist on the verb in the
  tool name: READ tokens (list/get/search/status/summary/lookup/recall/kpis/due/…) and `_propose` (files a card a human still decides); any WRITE token
  (send/decide/set/save/update/create/run/…) and a deny list of read-sounding spenders (`crm_prospect_search`, `crm_linkedin_find_person`, enrich, graph sync,
  notification settings) are blocked; `skill_manage`, shell, files are blocked. Kernel: memory writes refuse an unattended actor. A scheduled prompt can
  draft; it cannot approve, send, decide or change a setting. Tests iterate every registered tool and assert no write tool leaks.
- **Skills live for everyone** (Amir's choice, with the risk stated): `skills.write_approval false` (deploy verify now REFUSES it being on). Guards in
  `role_policy.skill_guard` for non-admins: delete refused, git-deployed `salesbrain-*` skills (and anything in `skills-salesbrain`) cannot be patched,
  secret-shaped content refused (`refuse_shape`), 40k cap; routines (cron) get the same repo-skill guard, so the weekly learn pass can add skills but not
  rewrite deployed ones. Every non-admin write is audited (`agent_audit_log` command `skill_write`). `/admin/learning`: agent-written skills show their author
  and a **Remove** (ring RPC `skill_remove` MOVES the folder to `skills-agent/.removed/`, reversible); the learning digest reports "N skills written in the last day".
- **Memory**: unchanged and already per person (`crm_memory`, §5.aj). Hermes' native MEMORY.md/USER.md stays OFF: one file per profile = shared by every
  teammate. The persona now says automations, live skills and per-person memory explicitly.
- **CUTOVER DONE 2026-10-17 18:33 EAT.** `ONE_BOT=1` finally ran: @MateSalesCRMBot (the team bot) is now the default profile's ONE bot (full Hermes toolset
  for an administrator in a private chat, crm_* + web + skills + memory + automations for everyone), the crm profile's Telegram is disabled, one poller, no 409.
  Found on the way: `deploy-server.sh` never forwarded `ONE_BOT` to the remote shell (it runs `ssh … bash -s`), so the first attempt silently did nothing;
  fixed (the script now passes `ONE_BOT=${ONE_BOT:-0}`). @SalesBrainZeamiBot (the old admin bot) is no longer polled; Amir revokes its token in BotFather.
  **Regression found right after, fixed 18:55:** `platforms.telegram.extra.allow_from: []` (set by the 0.50.0 deploy) made the Telegram adapter block EVERY user
  ("Blocked unauthorized user"): any adapter-level allow_from, even empty, is the sole authority. The key is now removed (not set) and deploy verify refuses it being present.
  Rollback copies `/root/.hermes/.env.pre-onebot` and `profiles/crm/.env.pre-onebot` stay a day. Teammates' Hermes chat history started fresh.
  Live proof of the automation path: a 2-minute automation for Amir ran as him, unattended, read his due follow-ups (68), was refused `crm_outreach_decide`
  ("A scheduled automation can read and draft but not do that"), delivered without error. Hermes discovery tools (`tool_describe`, `tool_search`) are allowed in runs.
- Migration number: 068 is claimed by the lead-lifecycle workspace; this feature used 069.
- Not built: an Automations tab on /profile, per-person skill scopes (Hermes has one skills dir per profile), editing an automation's schedule in place
  (remove and create), web-chat automations (delivery is Telegram).

### 5.ar A LinkedIn reconnect keeps everything (2026-10-18, core/hermes 0.52.1, migration 070)

Matthias disconnected and reconnected (to pick up his new Sales Navigator subscription, then again to move the session
from FR to DE). Each reconnect made a NEW `linkedin_accounts` row, and the old one kept the request ledger (114, 85
pending), the connections (78), the sync state and the conversations (37), so the panel said "0 conversations synced",
every lead looked "not invited" again (duplicate requests risk) and the disconnect had purged the graph edges. Amir:
"remove that rule — and in such occasions add a label that it's from the old account."
- **Disconnect** (`commands/linkedin.revoke_account`) no longer purges `person_edges`; nothing is deleted.
- **Reconnect** (`link_account` → `_adopt_previous`): a revoked account of the same owner and the SAME LinkedIn member
  (provider_id or slug) hands its invitations, relations and `graph_sync_state` to the new row (keyed by member id, so they
  move as they are; a member already on the new row keeps the new one) and gets `replaced_by` (070, backfilled).
- **Conversations** carry the provider's chat id, which is NEW on a new provider account (same attendee, different id —
  verified on Matthias's). `adopt_previous_threads(actor, chats)` runs at the top of every `linkedin_sync.py` account pass:
  a thread moves when its attendee has a chat on the new account that is not mirrored yet, and takes the new chat id.
  Leftovers stay on the old row; `account_status.previous_threads` counts them and `/profile → LinkedIn` shows an
  **Old account** label ("N conversations from your previous connection").
- Matthias's data was moved by hand before the code shipped (backup `~/.cache/salesbrain/backups/matthias-reconnect-*`),
  and his edges were rebuilt from stored threads + relations with no LinkedIn calls (37 + 78).
- Tests: `salesbrain-core/tests/test_linkedin_reconnect_db.py` (real Postgres, opt-in).

### 5.as One tap approves all waiting connection requests, with a live progress card (2026-10-18, core/hermes 0.52.2)

Amir: "can I accept 15 connection requests at once in Telegram, you send them at human pace, and edit the message as a
progress bar 1/15 … 15/15". Before: "Queue next for approval" filed 15 single cards (15 taps); only the Conductor's daily
batch had one card, and its result came as a separate summary message.
- **Kernel** `conductor.bundle_pending_connects(owner)` groups every pending, unexpired, ungrouped `connect` approval of
  the owner under one `connect_batches` row (joins the one already waiting; the unique pending index allows one per
  person) and returns ONE `connect_batch_card` event. `invitations.propose_connect_batch` uses it whenever it files more
  than one, so the list page's button and the chat tool post a single card. Single cards keep working; each request is
  still its own approval, cap check and once-only gate. `decide_connect_batch` hands back the card's chat/message id.
- **Ring** `connect_batch.run_filed_batch(progress=(chat, msg))` edits the card after every person:
  `▰▰▰▱▱▱▱▱▱▱ 3/15` + ✅/⚠️ lines, pace 8–16 s, and the card ends as the summary (no second message; a failed edit falls back
  to the summary DM). Tool `crm_linkedin_connect_bundle` (mcp=None) for "approve all my requests"; persona rule. 171 tools.
- Tests: `salesbrain-core/tests/test_connect_bundle_db.py` (real Postgres), `salesbrain-hermes/tests/test_connect_progress.py`.

### 5.at One person per company for outreach (2026-10-18, core/hermes 0.52.3, migration 071)

Amir, on Matthias's batch of 15 requests with three KIRCHHOFF Automotive managing directors: "for connecting no problem,
but when outreaching DEFINITELY — flag that and confirm. Unless approved we never send to more than one person per company."
- **Rule** (`policy/one_per_company.py`, pure): applies to first-touch `outreach` drafts only — not connection requests,
  follow-ups, replies or intro asks. Same firm = same account, same domain, or the identifying words of one name inside the
  other's (legal forms dropped, so the twin-account rows "KIRCHHOFF Automotive" / "… GmbH" match). Team-wide: a colleague's
  delivered message counts. Writing again to someone we already messaged is a conversation, not a second person.
- **Kernel** `commands/company_guard.company_conflict` finds who at the firm got a delivered message (`outreach_approvals`
  sent outreach/followup, or an outbound non-web `interactions` row). `agents.flag_company_conflict` records it on the draft
  (071 `company_conflict`) when it is filed (`propose_outreach`, `linkedin.propose_first_message`) and **again in the send
  gate** (`outreach._company_hold`, before the approval is consumed), so a firm messaged after filing still holds the draft.
  The override is `decide_outreach(..., 'approve_anyway')` (sets `company_override_at/by`); it also revives a draft the gate
  held at send (status failed, never consumed). A plain approve never does.
- **Surfaces**: the Telegram card gets a ⚠️ line and "👍 Send anyway / 👎 Skip"; a draft held at send time gets that keyboard
  on the same card. `/agents` and the lead page list held drafts with the warning and a "Send anyway" (confirm prompt).
  `crm_outreach_decide` takes `approve_anyway`; the persona says ask first, never choose it alone.
- Tests: `salesbrain-core/tests/test_one_per_company{,_db}.py`, `salesbrain-hermes/tests/test_one_per_company_ring.py`.

### 5.au Smarter turns: "Recently" block, knowledge base, self-improvement, model per task (2026-10-18, feat/bot-knowledge, migration 072)

Amir, after "how many connection requests did I just receive" got three LinkedIn tools and the wrong meaning (he meant the 15
approval cards just posted), and "what is a graph sync" made the bot browse the server. Measured before: ~20k input tokens on a
turn's first call, median 6 model calls per turn (max 39), ~140k input tokens per turn, 79% cached. Plan
`~/.claude/plans/bot-context-knowledge-models.md`. Amir chose: live context, a knowledge base, the bot improves itself, Argon for deep work.
- **"Recently" block** (`commands/recent.py`, injected by `memory_provider.prefetch` above the person's notes, user-message side so the
  prompt cache holds): cards waiting by kind with first expiry, batches filed in the last day (with the list), decisions, the last 6
  automatic messages (`notification_log`), the person's automations, replies / follow-ups / due sales leads. Relative times, one pooled
  connection, never raises. Answers "what did I just get" with zero tools. Cards are read from `outreach_approvals` by owner.
- **Knowledge base** (core 072 `knowledge_entries`): concept | message | phrase | procedure, team or personal, `tool_hint` = the one tool
  that answers it. Retrieval = Postgres full-text (`simple` dictionary, OR of prefix terms; `policy/knowledge.terms` drops EN/DE stopwords and
  trims plurals), the person's own entries first, top 3 (`agents.knowledge.inject_max`) put into the turn as "Relevant knowledge"; no model
  call, no tool call. 57 seed entries (`knowledge_seed.py`, loaded insert-only by deploy, so edits stick). Eval: `knowledge_eval.py`, 30 real
  questions -> expected entry in top 3; 100% at build time. A ring test asserts every seed `tool_hint` is a registered tool.
- **Self-improvement, no approval** (Amir's rule; live at once, audited, archived not deleted): (1) in the turn, a correction of meaning ->
  `crm_knowledge_learn` (personal phrasing or team knowledge; persona "Learn"); (2) `agent_turn_log` (Hermes `post_llm_call` hook,
  `turn_log.py`: question, answer, the turn's tools, errors, model calls, injected entry ids); (3) nightly `knowledge-review` cron (03:30,
  `--no-agent`, `knowledge_review.py`): last day's misses (>3 model calls, a tool error, or a next message starting like a correction) ->
  Argon writes <= 5 team entries (`source='review'`, hints validated); housekeeping archives seed/review entries unused 60 days and trims the
  turn log (30 d); one operator line: learned N, model calls per turn (median/avg), eval hit rate. Tools `crm_knowledge_search` / `_learn` /
  `_forget` (family crm_memory); search works inside automations, learn/forget do not. Unattended and SERVICE writes are refused except the review's.
- **Model per task** (Hermes has no per-turn router; public seams used): chat = `gemini-3.8-flash`; helpers (`auxiliary.salesbrain_aux`) and plain
  reminders (`crm_automation_create reminder: true`, job pinned, no tools) = `gemini-3.1-flash-lite`; deep work = `gemini-4-argon` via
  `delegation.model` (persona: drafting, analysis, multi-step plans -> `delegate_task`), the routines `ops:outreach:daily` / `ops:supervisor:daily`
  / `ops:learn:weekly` (pinned with `hermes cron edit --model`), the nightly review (`converse(model=)`), and app drafts (`geminiModelFor`:
  intro / follow-up drafts, ICP suggest / optimize, account research; translate and contact style on Flash-Lite; a failure falls to Flash,
  then Claude). Admins can force one turn: `/model gemini-4-argon --once`. Prices in 072: Argon 2 / 10 per MTok until 2026-11-30, DOUBLING
  2026-12-01 (update the row); Flash-Lite 0.25 / 1.50.
- **App**: `/admin/learning` Knowledge section (search, add, edit, archive, author, uses) and `/profile -> Memory` own entries;
  `GET/POST /api/knowledge` -> app-only RPCs `knowledge_list` / `knowledge_save` / `knowledge_archive`.
- Not built: point 1 of the plan (fewer, question-shaped tools), embeddings (pgvector) if keyword retrieval weakens, a per-turn tool-call cap.

### 5.av /sales-leads "Needs you" made honest (2026-10-19, core/hermes 0.53.1, app)

Amir, on the Needs-you list: "how are they on top — what was the criteria?" Four things were misleading:
- **Counter vs table**: the tile counts only the viewer's own queue, but a deep link (`?view=needs_you`) opened the table on
  *Everyone* (184 vs 25). Needs you now opens as **Mine** unless the link says `mine=0`; on Everyone the count reads "· everyone's".
- **"You · …" meant "a person"**: the chip now names who must act (`lib/sales-leads.ts::whoActs`): for an approval card
  (`request_filed`, `first_message_waiting`, `followup_waiting`) the SENDER (the prospect's owner, `sender_user_id`), otherwise
  the back office, then the front office; "You" only for the viewer. Same on the lead's panel ("Needs Hannes · …").
- **Order numbers are per list**: each import brought its own ranks, so "order 4" from Fakuma and from NRW tied. The priority
  sort is now `priority, source, rank, …` (lists grouped inside a priority), and a **List** filter (`?list=<source>`, also on the
  Excel export) shows one list in its own order; the API returns `lists`.
- **A budget refusal paused an account**: three "daily search cap reached" refusals from our own guard counted as provider
  errors and auto-paused Hannes's LinkedIn on 2026-10-18 (every agent on it stopped). `policy/linkedin_limits.is_budget_refusal`
  + `agents.record_account_error` now ignore them; only real LinkedIn/Unipile failures count. His account was resumed.

### 5.at Lead card outreach + the whole LinkedIn conversation on the track record (2026-10-19, core/hermes 0.54.0, no migration)

Amir, on /sales-leads: "add the outreach activities to send connection request and draft message — sync replies in here also."
Before: a lead's track record only heard about sends that went through an approval card and the NEWEST reply of each sync;
messages typed by hand on LinkedIn (20 lines missing across 22 leads) and every connection request (16 leads, 0 lines) never
landed; the card could not draft a message.
- **Kernel** (`commands/sales_leads.py`): `log_conversation` — called by `linkedin.sync_thread` for every NEW message, both
  directions — writes a `sent` / `reply` line keyed on `ref.message_id`, stamped with the teammate whose account it went
  through, and lifts the status ladder. `lead_for_thread`: the account owner's prospect → ANY teammate's prospect for the same
  person / member id → the lead's LinkedIn URL slug (the list is org-wide: Fedler is Mateo's lead, his conversation is on
  another account). Never creates a lead. `_already_logged` dedupes the two writers that see one LinkedIn message (approval
  mirror without an id, thread sync with one; same kind + same first 80 normalised characters within 3 days; a message WITH an
  id only matches id-less lines, so two real "Danke!" stay two). `record_reply` passes `message_id`. A brand-new mirrored lead
  pulls its conversation history (`backfill_conversation`, every team account). `note_invitation` = `status` lines (never a
  contact, never moves "last talked") for request sent (product or by hand, with the note) / accepted / not accepted, once
  per invitation + state; called from `record_invitation` and `reconcile_invitations`. All savepointed; a lost connection
  re-raises instead of being swallowed per lead.
- **Backfill** `python -m salesbrain_core.store.backfill_track_record [--lead id] [--apply]` — same writers, one short
  transaction per lead (one long dry-run transaction outlived the pooler session: "connection is lost" on every later lead).
  Dry run 2026-10-19: 22 leads, +20 message lines, +32 request lines, 3.5 min from a laptop. Re-running adds nothing.
- **App**: `components/sales-leads/OutreachPanel.tsx` above the track record ← `GET/POST /api/sales-leads/[id]/outreach`
  (facts in `lib/sales-lead-outreach.ts`; read-only check `scripts/check-lead-outreach.mts`). Modes: no_prospect · no_profile ·
  no_sender (owner has no LinkedIn) · connect · request_pending · first_message · thread. Send connection request (+ note ≤200)
  → `crm_linkedin_connect_propose`; Draft → the list's first-message template, else a model draft (`lead_card_draft`: reply if
  they wrote last, follow-up if we did, first message for a new connection; same language as the conversation) → editable →
  Queue for <sender>'s approval → `crm_linkedin_first_message_propose` or `crm_outreach_propose kind=followup` with the
  thread. NOTHING SENDS from the card: the sender (prospect owner) decides on Telegram / /agents. Acts as the owner for an
  admin; anyone else only on their own leads (act-as rule unchanged). Waiting requests / drafts are listed and not re-offered.
  Live distribution at build: connect 93 · thread 26 · no_profile 73 · no_prospect 39 · no_sender 4.
- Not built: email drafting from the card, a teammate (non-owner) filing a draft for the owner's approval, logging emails sent
  from Gmail.

### 5.aw A LinkedIn URL on the lead card reaches its prospect (2026-10-19, core/hermes 0.54.1)

David Rowley's card showed `in/davidrowley` (Mateo's Napa import) while the line said "Finding LinkedIn": the URL lived on
`sales_leads.linkedin_url`, but every agent reads `prospects.linkedin_public_id`, which was only written when the Conductor
CREATED a prospect. A lead linked to an existing prospect never passed its URL on (30 open leads, 13 stuck in Finding / No
LinkedIn / Pick). Now `conductor.adopt_lead_linkedin` runs on every tick (prerequisite 1b) and `deals.update_sales_lead`
does the same when someone edits the URL on the card; both go through `prospecting.set_prospect_linkedin` (the one writer:
never overwrites a profile, reports `duplicate_of` when another lead holds it). Stat `profiles_from_lead` on the tick.

### 5.ax Every lead has a prospect behind it, always (2026-10-19, core/hermes 0.54.2)

Amir: "when you create a lead, also include the prospect, at all times: CSV upload, CRM tools, everywhere." Before, only the
Conductor created one, and only for leads in its scope with it switched on; a lead already in conversation never got one
(16 Napa leads), so no agent could see their email/LinkedIn. Now:
- `conductor.ensure_prospect_for_lead_id(lead_id)` = the one bridge for a single lead (owner = back office → front office
  → `sales_leads.roles.default_sender`; the tick hands it to the actual sender later). `sales_leads.lead_landed` (zeami.io
  form, Calendly) calls it at once; every Conductor tick runs "prerequisite 0" for ANY open lead without a prospect,
  independent of scope, the enabled switch and the stage (it is data, not outreach; dry runs change nothing). Leads created
  by imports or SQL (the Napa script) are therefore bridged within the hour. Kernel `upsert_sales_lead` already starts from
  a prospect; the bot tools create prospects first (`crm_prospect_add`).
- `ensure_prospect_for_lead` copies the conversation state: a lead `contacted` → prospect `P5_SENT`, `replied` →
  `P6_REPLIED`, `last_contacted_at` from the card — so the Outreach agent (queue = P2/P3, never contacted) never drafts a
  cold message to someone we already talk to. Stages never move backwards. The lead itself stays `in_conversation` (hands-off).
- Same day, data: 80 prospects with an email on the contact but no person node got one (`ensure_prospect_person`; email
  reachability 153), 19 cards filled from their records (never overwriting), duplicate people Frank Barlog and Ralf
  Schwarzkopf merged (`merge_people.merge_pair`). Backup `~/.cache/salesbrain/backups/lead-fill-20261019172642/`.

### 5.ay Add a lead and import a list on /sales-leads (2026-10-19, core/hermes 0.54.3, app)

Amir: "create a new lead add and import feature". **Add lead** (dialog: name, company, title, email, phone, LinkedIn,
website, where met, list, priority, back / front office, notes, must-talk) → `POST /api/sales-leads` → `crm_sales_lead_add`.
**Import a list** (dialog: CSV / XLSX / XLS ≤10 MB, ≤2,000 rows → columns matched by header in English and German AND by
their values — a column of `linkedin.com/in` links is the LinkedIn URL whatever it is called, LinkedIn's connections export
works as is; the header is the first row with two filled cells, so title lines are skipped → defaults for empty fields:
list name, where met, priority, back office, front office → **Check** (dry run: new / already a lead / cannot import per row)
→ **Import N new leads**) → `POST /api/sales-leads/import` (multipart = read the file; JSON = the rows, sent to
`crm_sales_leads_import` 100 per kernel call; `lib/lead-import.ts` holds the fields and guesses).
- **Kernel** `deals.add_sales_lead` / `import_sales_leads` share one path: `_clean_lead` (name required, email shape,
  LinkedIn normalised to `https://www.linkedin.com/in/<slug>`, priority 1–10), `_lead_duplicate` (same email → same
  LinkedIn → same name at the same company; never merged, the existing lead is named), the roles (back office = the person
  adding unless set), an `import` track-record line, source `import:<list-slug>` (manual adds: `manual:new`), and the prospect
  at once (`conductor.ensure_prospect_for_lead_id`, §5.ax). The import also catches the same person twice in one file. Audit
  `sales_lead_add` / `sales_leads_import`.
- **Ring** `crm_sales_lead_add`, `crm_sales_leads_import` (family crm_deals, both `mcp="write"`), persona rule (dry run
  first, counts, then import). **Service MCP**: both as passthroughs (`docs/service-mcp.md` changelog).
- **Template** (0.54.5): `GET /api/sales-leads/import/template?format=xlsx|csv`, buttons in the import dialog. Headers =
  `lib/lead-import.ts::TEMPLATE_COLUMNS`, each one maps to its own field by `guessField` (checked), example row, and an
  Excel sheet "How to fill it". **Linking keeps LinkedIn in step** (0.54.5): `conductor.ensure_prospect_for_lead` copies
  the card's profile onto an EXISTING prospect without one (`adopt_lead_linkedin`) and a prospect's profile onto an empty
  card, at link time, so an import never repeats the David Rowley case (§5.aw).
- Tests: `salesbrain-core/tests/test_lead_add_import_db.py` (real Postgres). Not built: a CSV of updates to existing leads
  (duplicates are skipped, not merged), column mappings remembered between imports.

### 5.az Connection-request caps by subscription, honest rolling counts (2026-10-19, core/hermes 0.54.4, migration 073)

Amir: "what is the cap for Matthias? have you checked his LinkedIn subscription?" — and the bot said "15 sent today" about
requests sent the evening before. Caps were one global 15/75 and the kernel's rolling counts were labelled "today" / "this week".
- **By subscription** (`linkedin_accounts.premium_features` via `policy/linkedin_limits.tier`): free `per_day`/`per_week` 15/75,
  Sales Navigator `per_day_sales_navigator`/`per_week_sales_navigator` 25/120 (+ note 300 chars). Unipile 2026: paid active accounts
  ~200 invitations a week enforced by LinkedIn, 80-100/day recommended; accounts under ~150 connections may see requests held —
  Matthias has 76, hence modest. Both fields chat-editable by an admin (`admin_policy`). Guard backstop `sales_navigator.invite` 20 -> 30.
  Matthias's Sales Navigator was only detected at the 2026-10-18 reconnect (the old account row said []).
- **Rolling, said so**: `policy/invitations.for_tier`, `next_free_at`; kernel `_quota` returns `window`, `subscription`, `sent_last_24h`,
  `sent_last_7d`, `remaining`, `next_request` ("in 2 h 10 min (18:05 UTC)"); refusals name the next time. `crm_linkedin_quota` now carries
  `connection_requests` (it only had searches / profile fetches). Lead Conductor batch card and the /icp list line say "in the last 24 h /
  last 7 days", the tier and the next request time. Persona "Counts and caps": never "today" for a rolling count; calendar periods come
  from `crm_outreach_kpis`; never invent a reason for a rule.
- Retired Matthias's bot-written workaround note ("verify with KPIs, sent_today is rolling"), superseded + audited.

### 5.az Acceptances are their own message (2026-10-20, core/hermes 0.54.6)

Amir asked whether he hears when someone accepts; he did not: acceptances rode inside the hourly LinkedIn inbox digest
(source `linkedin-sync`), which he had muted on 2026-10-17, so the 18 Oct acceptance was withheld with it. Now
`linkedin_sync.py::_accept_notice` sends ONE message per sync that saw acceptances, source **`linkedin-accepted`** (own mute
switch; `policy/notify.SOURCES`), owner's DM or nothing: name + headline + profile link (taken from the connection list,
because a request sent by hand often has no stored name; the member id is never shown), the count of first-message cards
filed for leads, or "say 'add them as leads'" when none is a lead. The inbox digest no longer carries acceptances and no
longer fires for them. Knowledge entry "Message: X accepted your connection request". Amir's linkedin-sync mute was lifted.

### 5.ba Hermes-native agents, pilot: Outreach + Leads Finder are real profiles (2026-10-20, core/hermes 0.55.0-0.55.1)

Amir: "reuse Hermes's agent infrastructure; the Workspace should show the real things", and every script agent becomes an AI
agent (graph sync may stay light). Plan `~/.claude/plans/hermes-native-agents.md`; this is §6 (pilot). Rollout order next:
Enricher → Lead Conductor → Attention / Supervisor / Learn / Knowledge review → Graph sync (light) → retire `crm`.
- **One folder per agent** `salesbrain-hermes/agents/<agent>/`: SOUL.md, AGENTS.md (Run + Review sections), agent.yaml (model,
  toolsets, memory, skills, jobs, `replaces`), run_queue.py (deterministic gate + dossier; NOT `queue.py` — that name shadows the
  stdlib `queue` module and broke psycopg), review_queue.py. `_shared/env.keys` (secrets an agent gets; never
  SALESBRAIN_ACTOR_EMAIL or the bot token) and `_shared/base-rules.md` (prepended to every AGENTS.md).
- **Renderer** `scripts/render_agents.py` (deploy step, on the box, idempotent): profile `/root/.hermes/profiles/<agent>/` with SOUL,
  config.yaml (main config + agent model / `platform_toolsets.cron` / memory ON / no Telegram), .env (0600), workdir/AGENTS.md,
  scripts, cron jobs `agent:<agent>:<run|review>` (own model, `--workdir`, deliver local) created or edited in place; jobs the agent
  `replaces` in the main profile are PAUSED (rollback; delete after a week: `leads-finder`, `ops:outreach:daily`). Deploy verify
  refuses an agent profile with SALESBRAIN_ACTOR_EMAIL or missing / duplicated jobs. Spikes proved: `--workdir` injects AGENTS.md;
  a profile's job runs once in its own profile.
- **Identity** (`agents_runtime.py` + the `tool_request` middleware, checked BEFORE the chat-user lookup): an agent run acts as the
  SERVICE identity, or as the owner set with **`crm_agent_act_as`** (audited `agent_act_as`; refused when the agent is held for that
  owner); `crm_agent_finish_run` always as the service. **Found on the way: the old outreach routine had filed 0 drafts in 30 days** —
  its tool calls fell back to SALESBRAIN_ACTOR_EMAIL=amir@test.com (no such user) and every run was reaped as error; the attention
  routine has the same fallback (still on the main profile until its rollout).
- **Role policy for agent runs**: CRM tools, web search, skills; blocked = any decide / send / approve / policy / invite / delete /
  import / export / share / forget / save / learn / set / connect tool and all server tools; the Hermes `memory` tool only in the
  `review` job (MEMORY.md = the agent's job knowledge; the working run reads it, never writes it — injection guard).
- **AI Leads Finder** (Flash): run_queue.py = kernel `leads_finder_plan` (budgets, holds, backoff, requested runs) + per-ICP dossier
  (stored variants, cursor state, `ka.leads_finder_history` = what each query produced in 30 days); the model chooses a stored
  variant or writes its own query and calls **`crm_leads_finder_search`** (one search per ICP; same budget; an own query is a probe that
  does not move the cursor), then **`crm_leads_finder_report`** per owner (digest, nothing when no new leads). `leads_agent.search_step`
  is now the one search step (the chat tool `crm_leads_finder_run` uses it too). First live run: continued variant 1, 40 analyzed,
  27 new, 5 researched, digest sent, run owned by Matthias with the agent's reason in `detail.reason`.
- **Outreach** (Argon): own profile, AGENTS.md from the old routine prompt + act-as per owner + no delegation; review_queue.py = last
  week's drafts sent / skipped / expired + replies. Its queue was empty at launch (no researched strong fit reachable by email or an
  existing thread; follow-up drafting off), so its first real drafts wait for leads that qualify.
- **Fixed 0.55.1: the LinkedIn guard counted its own refusals as usage.** 38 real searches + 166 refused retries read as "203/40" and
  locked searching all afternoon (and indefinitely while callers retry). `linkedin_health.budget` now counts only requests that reached
  LinkedIn (rows `refused:` with no status code are excluded).
- **Fixed 0.55.2: agent profiles' scheduled runs had no DATABASE_URL.** In the multiplexing gateway a profile's `.env` is NOT in
  `os.environ` — it lives in a context-local secret scope (`agent.secret_scope.get_secret`). Manual `cron run` from the CLI worked,
  the scheduler's workers did not ("No database configured"; both Leads Finder ticks on 2026-10-21 morning). Every kernel / ring
  setting read now goes through `salesbrain_core.env.get` (os.environ first, then the Hermes scope). Proven with a scheduled probe
  in the leads-finder profile. Lesson: validate an agent through the SCHEDULER, not `hermes cron run` from a shell.
- **Rollout done 2026-10-21 (0.56.0): every SalesBrain agent is a Hermes-native profile** (8): outreach, leads-finder, enricher,
  lead-conductor, graph-sync, attention, supervisor, knowledge-review. Enricher (Flash) decides who and what per owner and
  calls `crm_enrich_batch` (closes the owner's run, sends the digest; "needs a pick" stays a person's job — Amir's 2026-10-09
  rule); Lead Conductor (Flash, hourly) and Graph sync (Flash-Lite) call `crm_agent_run_step` (the proven script as a tool)
  and report only problems via `crm_agent_report`; Attention (Flash) and Supervisor (Argon) moved as they were, with act-as
  per owner (the old attention prompt named `crm_get_person_dossier`, a tool that no longer exists, and ran with the dead
  identity — it had done nothing for weeks); Knowledge review (Argon) writes its entries with `crm_knowledge_review_write` and
  closes with `crm_knowledge_review_finish`. Review jobs (MEMORY.md) for outreach, leads-finder, enricher. **Learn retired**
  (`agents/_shared/retired.txt`; its skill patch could never apply to a git-deployed skill; the Outreach review replaces it).
  **`crm` profile deleted** (backup `/root/backups/profile-crm-*.tgz`); deploy no longer recreates it. Paused main-profile jobs
  to delete after 2026-10-28: attention-allocator, enricher, graph-sync, knowledge-review, lead-conductor, ops:supervisor:daily,
  ops:learn:weekly (+ leads-finder, ops:outreach:daily after 2026-10-27). A test checks every `crm_*` named in a rulebook exists.
  First scheduled check: lead-conductor ran its tick (279 leads, nothing due) and stayed silent, ~10k input tokens per call.
- `/admin/learning` shows every profile's MEMORY.md already; the "built-in memory ON" warning now applies to chat profiles only.
- Not built yet: per-agent `/agents` link to its Workspace card, the remaining agents, deleting the paused main-profile jobs (after
  2026-10-27), cost per agent report (feature = cron job name in `llm_usage`).

### 5.bb Zeami handover — sales rep on deals + client setup status (2026-10-21, feat/zeami-onboarding, migration 074)

Zeami's platform console now gives every client a sales person and a project manager (+ optional backups). Their
handover (matebackend `docs/Api_integrations/SALESBRAIN_ONBOARDING_API.md`) asked for four parts; all four are built.
- **Sales rep rule** (`lib/zeami.ts::SALES_REP_JOIN`): the deal's assigned person (`lead_id`), else the creator;
  never a `…@<app>.service.salesbrain` stub or `agent@salesbrain.internal`. Sales deals only.
- **Part 1**: `GET /api/public/deals/[id]` returns `sales_rep {name, email}` or null (Zeami's wizard reads it; our
  `ONBOARDING_API_KEY`).
- **Part 2**: `lib/zeami-sync.ts::syncZeamiDealEvents` compares every won sales deal (G9 or status won) with
  `zeami_deal_sync` (core 074) and posts `deal.won` once, then `deal.sales_rep_changed` when the rep differs. One
  sweep covers every writer of gate / lead_id (app, kernel, agent, SQL), no hooks. event_id
  `sb:<deal>:<seq>:<type>:<rep>` (stable across retries; A→B→A stays distinct). Any 200 = told (including
  `no_company_for_deal`: part 1 covers the wizard later); 401/503/not configured stop the run; other failures retry next
  run; a 4xx rejection waits for the deal to change. Run by Hermes cron **`zeami-deal-sync`** (hourly :25,
  `--no-agent`, `assets/scripts/zeami_deal_sync.py`) through the signed bridge (tool `zeami_deal_sync`, admin/service
  only); stdout only when something was sent or Zeami refused our key. Dry run: `python zeami_deal_sync.py --dry-run`.
- **Parts 3 + 4**: `components/ZeamiOnboardingPanel.tsx` on `/deals/[id]` (sales) ← `GET /api/deals/[id]/zeami`
  (asks Zeami live on open; states found / not_onboarded / unavailable; renders Zeami's stage labels as given; footer =
  what we last told Zeami) and `PUT /api/deals/[id]/zeami/support-group` (creator / assigned person / admin; https only;
  409 = already set, changed in the Zeami console).
- **Env** (app only): `ZEAMI_API_URL` (base, without `/api/platform/v1`) + `ZEAMI_API_KEY` (= Zeami's
  `SALESBRAIN_INBOUND_API_KEY`); in deploy.yml, GitHub secrets to be set. Without them nothing is called.
- Tested against a local mock of Zeami's API (new table in a scratch schema, dropped after): part 1 on Kabana, the sweep
  (dry run, send, silent rerun, rep change, Zeami down), panel routes (no session 401, view-only, 404 → not onboarded,
  non-owner 403, http link 422, add, 409). Not tested: the real Zeami API, the panel in a browser.
- **LIVE 2026-10-22 (0.60.0)**: 074 applied, app on Production (run 39792603699), ring deployed (cron `zeami-deal-sync`
  created; its first :25 tick ran during the deploy). `ZEAMI_API_URL` = `https://app.zeami.io`, key accepted (404, not 401/503).
  Both won sales deals were told `deal.won`: Kabana (mateo@zeami.io) and ChipChip Pilot (amir@chipchip.social), both
  `no_company_for_deal` — no client is set up in Zeami for either yet, so their panels say "Not onboarded yet". Part 1 verified
  live (Kabana → Mateo Klemmayer). Not yet seen live: a found status, a support group added, a `sales_rep_changed`.

### 5.bc Firm outreach — firms on a list, investor research (2026-10-21, feat/firm-outreach, migration 075, phase 1 of 3)

Amir: "research the companies, know what they invest in, find their contact email, find the persons, mass outreach" —
first for the Zeami raise (563 VC funds, 44 named partners; Mateo's workbook). Plan `~/.claude/plans/vc-firm-outreach.md`.
Decisions: each sender's own Gmail, Gemini + Google Search for research, 50 emails/day per mailbox, 100 FullEnrich
credits/day, one tap per wave. Phases: 1 firms + research (this), 2 people at the firm, 3 email waves from Gmail.
- **Core 075**: `account_profiles` (org-wide research per account + kind `investor`, sources per claim),
  `list_firms` (a firm ON a list: rank, priority, status new→researched→people_found→contacted→replied→meeting,
  eligibility go|later|out|unknown + reasons, `eligibility_override`, contact_email/route, research queue flag),
  `icp_profiles.firm_brief` (stage, round, entity country, geographies, sectors, exclusions, pitch), policy
  `agents.firm_research`. `policy/firms.py` (pure: `eligibility`, `pick_contact` — never legal@/privacy@/press@/
  careers@/investors@, `domain_of` + `site_matches` — a research link to sec.gov / prnewswire / a parent company is NOT
  the firm's site, it is kept as `source_row.source_url`), `commands/firms.py` (import, list, get, save research →
  re-judges every list holding the firm, update incl. verdict override, brief, queue, sweep plan).
- **Ring**: `llm.grounded()` (Gemini REST + `google_search` tool → text + sources; grounding redirect links are
  resolved to the article URL), `llm.converse(json_mode=True)` (Gemini strict JSON — the long team lists truncated
  plain JSON at 3k tokens), `firm_research.py` (site pages home/about/team/people/portfolio/contact + one grounded call
  + one extraction; an email is kept ONLY if it appears literally in the fetched text), tools `crm_firm_import/list/
  get/research/update/brief_set` (family crm_prospecting, 6 new), sweep `assets/scripts/firm_research.py` = Hermes cron
  `firm-research` `*/15 7-22 * * *` — researches ONLY queued firms, DMs the list owner (`firm-research` source), silent
  in the operator chat.
- **App**: `/icp/[id]` Firms section at the top (`components/firms/{FirmsSection,FirmCard,FirmBriefEditor,
  ImportFirmsModal}.tsx`, slim one-liner on a people-only list), `lib/firms.ts`, routes `GET/POST /api/icp/[id]/firms`
  (import: multipart parse + 100-row kernel chunks), `/api/icp/[id]/firms/{research,brief}`, `GET/PATCH /api/firms/[id]`,
  `POST /api/firms/[id]/research` (now, ~20-30 s). Export: a Firms sheet in the ICP workbook.
- **Verified locally (scratch Postgres, real Gemini key)**: the ranked VC file imports as 562 firms in ~1.5 s (6
  investor+customer twins and two Viola vehicles merged; 42 research links rejected as websites); Point Nine, Seedcamp,
  Bain Capital Ventures, firstminute, Frontline, Fly and Notion Capital researched in 20-30 s each, all "go", Notion with
  14 investment-team members and "Notion Capital V · €300M · 2023".
- **Phase 2 — people at the firm (same branch)**: `policy/firms.investor_rank` (1 partner/GP/MD/founder · 2 principal/
  director · 3 venture partner · 4 VP/investment manager · 5 associate · 6 analyst · None = advisor/ops/finance/legal/
  platform — VC titles only, `leader_title` for NRW untouched) + `pick_people` (best rank, then focus on the brief's
  sectors). `commands/firms.land_firm_people` → prospects owned by the LIST owner, `source_type='firm_team'` (added to
  CURATED_SOURCE_TYPES and to the stored `agents.conductor.curated_source_types` in 075), tied to the firm's own account
  (not a same-name twin), priority_rank = firm rank, a /sales-leads card each; never twice (slug, else name at the firm).
  Queue `list_firms.people_requested_at` + `request_firm_people` / `firm_people_plan`; the same 15-min sweep runs it
  after research. Ring `firm_people.find_people`: research first if needed → team from the site (Google-grounded search
  when the site lists nobody) → land → per person `find_profile` WITHOUT the company_web rung + `enrich_one(email)`
  guarded by `email_credits_per_day` (enrich_one itself does not check the cap). Tool `crm_firm_find_people`
  (firm_id now / icp_id queue / names = pick). 075 also raises `agents.enricher.email_credits_per_day` to 100.
  App: "Find people for next 10", card "Find people now" / "add as lead" per team member. Live (scratch): Point Nine
  researched + 2 partners landed in 46 s.
- **Fixed on the way (bug on main since 0.49.7, 2026-10-16)**: `sales_leads.upsert_sales_lead` INSERT listed 12 columns
  with 11 placeholders, so every NEW /sales-leads card from the mirror failed silently (mirror_safely swallows it):
  hand-added leads (crm_prospect_add / Zeami Omni), first sends and replies of people without a card. Production
  2026-10-21: 3 hand-added leads, 1 messaged prospect, 1 reply without a card — backfill after the fix ships.
- **Phase 3 — email waves from each sender's own Gmail (migration 076)**. Decisions (Amir 2026-10-21): each teammate's
  own mailbox; one tap per wave; 50/day per mailbox; an APPROVED wave counts as the human decision to ask, so the
  commercial gate does not block its emails (it still blocks asks in drafts agents file alone).
  - **Core 076**: `email_senders` (address, From name, signature, own daily_cap ≤ policy), `outreach_waves` (one card for
    N drafts; one pending wave per sender+list+step), `outreach_approvals` + `wave_id`, `sequence_step`, `sender_address`,
    `email_thread_id` / `email_message_id` / `email_rfc_id`, `icp_profiles.email_sequence`, policy `outreach.email`
    (per_sender_per_day 50, per_tick 3, gap 90–240 s, wave_size 20, ttl 72 h, followup_hour 9, opt-out line, stop words),
    `outreach.channel_caps.email` 50/250. `policy/waves.py` (pure: sequence validation — unknown placeholders refused —,
    render/compose with signature + opt-out, stop-reply + bounce detection, pacing). `commands/waves.py`: sequence get/set,
    mailboxes, `wave_propose` (step 0 = one person per Go firm, nobody at the firm contacted or with a draft in flight,
    email known, not suppressed; step N = follow-up in the same thread after the sequence's gap, no reply), decide (ONLY
    the sender — their mailbox), edit/drop drafts while pending, `outbox` (per mailbox within its cap; closes drafts whose
    address got suppressed), `record_email_sent` (Gmail ids, firm → contacted, prospect `next_followup_at` NULL so the
    generic agents.followup routine never sends a second, uncoordinated follow-up), `followups_due`, `threads_to_check`,
    `record_email_inbound` (bounce → suppression; reply → record_reply, firm → replied; short stop-reply → suppression),
    `release_for_retry` (a mailbox problem returns the email to the outbox). Send gate (`commands/outreach.py`): approved
    wave → `ask_approved`, commercial gate skipped; email sends check `suppression_list` (address or domain) and release
    the approval on refusal.
  - **Ring**: tools `crm_email_sequence_get/set`, `crm_email_mailboxes`, `crm_email_mailbox_update`,
    `crm_email_wave_propose`, `crm_email_waves_list`, `crm_email_wave_get`, `crm_email_wave_edit`, `crm_email_wave_decide`
    (mcp=None; family crm_outreach). Event `email_wave_card` → the SENDER's DM with ✅ Approve all / 👎 Skip / Review
    (`ew:` taps in telegram_buttons.py). Crons (deploy-server.sh): `email-outbox` `*/10 8-19` (gate → bridge `gmail_send`
    → mark sent; follow-up waves filed at followup_hour) and `email-replies` `20,50 7-23` (bridge `gmail_threads`).
    Mailbox tools are NOT named "*send*": role_policy treats any tool name with "send" as a sending tool.
  - **App**: the app holds the Gmail tokens. `lib/gmail-send.ts` (RFC 2822 plain text UTF-8, From name, threadId +
    In-Reply-To/References, Message-ID read back; threads read sequentially, snippets unescaped). Bridge tools
    `gmail_send` / `gmail_threads` in `lib/bridge-tools.ts` (actor = the sender, so nobody can send from another mailbox).
    Connect for sending = a SEPARATE consent (`GMAIL_SEND_SCOPES`: userinfo.email + gmail.send + gmail.readonly) stored as
    `oauth_tokens` provider `gmail_send` + an `email_senders` row; same callback URL (state `p: 'send'`). Routes
    `/api/email/{connect,disconnect,mailboxes}`, `/api/icp/[id]/email/{sequence,waves}`, `/api/waves/[id]` (GET, POST
    decision), `/api/waves/drafts/[id]` (PATCH). UI: Profile → Email tab, `/icp/[id]` Email outreach section (sequence
    editor with a starter text, sender, "Queue next 20 for approval", waves table), `/waves/[id]` review page.
  - **Before the first real email**: (1) add the `gmail.send` scope to the Google OAuth consent screen (Cloud console) —
    sensitive scope: a published external app needs Google verification; marking the app Internal for the zeami.io
    Workspace avoids it; (2) a sender connects on Profile → Email and sets From name + signature; (3) write the sequence;
    (4) research + find people for the Go firms; (5) queue a wave and approve it.
  - Verified locally: the full chain wave → approve → outbox → kernel gate → signed bridge → app → Gmail call (refused
    cleanly: no token) → email returned to the outbox and the mailbox marked. No real Gmail send has been made.
  - **Merged 2026-10-21 as 0.57.0**: migrations 075 + 076 APPLIED to production; ring deployed (crons firm-research,
    email-outbox, email-replies created; smoke-tested, nothing queued); app on Production the same day (deploy run
    39585333626 green; /waves, /api/email/*, /api/firms/* answer). Mirror-bug backfill done: Friedrich
    Fries-Henrich's /sales-leads card recreated (send + reply); the 3 other "missing" rows were archived KIMW stand-ins.
  - **Automatic firm lists (0.57.1, migration 077, same day; starts only once the list has a brief)** — Amir: "why is there a button for research next 25 —
    shouldn't it be automated?". `icp_profiles.firm_auto` (default true): the 15-minute sweep fills its batch (after
    queued firms) with never-researched firms of automatic, active, unpaused lists in rank order (a failed firm retried
    after 7 days), and finds people at researched Go firms with nobody on the list that have not come up empty
    (`_AUTO_LIST`, `_PEOPLE_DUE` in commands/firms.py). Automatic work is NOT announced by DM (only hand-queued work is).
    `set_firm_auto` / `crm_firm_auto_set`, `POST /api/icp/[id]/firms/auto`. The Firms section shows the switch and what
    it is doing instead of the two bulk buttons, and pages the table 10 / 50 / 100 / all (default 10).
  - **Progress view (0.57.2, migration 078)** — `firm_research` is a registered agent (agent_definitions, AGENTS, LABELS),
    so the sweep logs ONE agent_runs row per list per batch: opened with the firms it is about to research
    (`note_sweep_run` keeps detail.firms current → "Now"), closed with a one-line summary ("researched 25 · 9 go · …
    · people at 3 firm(s): +6 people, 4 with email"). `firm_progress` / `crm_firm_progress` / `GET /api/icp/[id]/firms/
    progress` (light, polled 30 s): counts per stage, running batch, last batches, `next_sweep_at` (pure: */15 07:00-22:45
    Addis), sweep-time ETA, blockers (Automatic off, paused, no brief, sweep disabled) and notes (email lookups used up,
    owner has no LinkedIn). `components/firms/FirmProgress.tsx` reloads the table when the counts move.
  - Not built: an email-only-to-firm-inbox lane (people with an email only), the bot persona's guidance for waves,
    service-MCP exposure of the wave tools, open/click tracking (deliberately none).

### 5.bf Campaign wizard + /campaigns and /brand in the house style (2026-10-22, feat/campaign-wizard, no migration)

**LIVE 2026-10-22 (0.61.0)** together with §5.bg: ring deployed (smoke 0.61.0, one gateway), app on Production (run 39806274692).

Amir, after the first try: the dialog opened an EMPTY canvas with a red "sends nothing" error, there was no email /
LinkedIn choice, and /campaigns + /brand looked unlike the other pages ("you copied Guhan; it is an inspiration").
- **Wizard** `/campaigns/new` (`components/campaigns/CampaignWizard.tsx`, the ICP builder's shape): 1 what it is for
  (name, goal, hook, language, product) · 2 who (lists + sales-lead sources with people / with email / on LinkedIn) ·
  3 channel (Email only · LinkedIn only · LinkedIn first, then email) · 4 what we send (connection note + acceptance
  wait, how many messages 1–4, days to wait for a reply after each, how the first and the follow-ups are written) ·
  5 when they reply (hand to whom, note, drafts per step per day — default 10). Sticky right column: the sequence as
  lines (`lib/campaigns.ts::describeSpec`), "Sent from" with each list owner's Gmail / LinkedIn state, what is still
  missing, Create campaign. "Or draw it yourself on an empty canvas" stays as a link.
- **Kernel** `policy/campaigns.py::normalize_spec` + `graph_from_spec` (pure, laid out top to bottom; every answer
  combination validates — test matrix) and `create_campaign(spec=, daily_max_per_step=)`; the answers are kept in
  `campaigns.settings.wizard` (`update_campaign` now MERGES settings). `launch_check` blocks an email-only campaign
  when nobody who would send it has Gmail (it only warned before). The TS side only describes the plan; the graph is
  built once, in Python.
- **Canvas**: the campaign opens with "Your sequence is drawn from your answers…"; an empty canvas shows a neutral
  how-to instead of the red error; a palette click attaches the new step to the selected step or the last open exit
  ("then", a wait's "no / timed out", an If's "yes").
- **House style**: shared `components/panel/PageHeader.tsx` (+ `Pill`) and `components/panel/Button.tsx`; `.z-panel`
  in globals.css (the flat bordered 12px card of /icp). /campaigns, /campaigns/[id], /campaigns/cards/[id] and /brand
  use them; z-btn pills and uppercase eyebrows are gone from those pages. Use PageHeader/Button for new pages.
- Tested: 624 core / 347 ring tests, build; the wizard clicked through in Chrome (email-only VC example → drawn,
  valid, "Ready to run"). Not tested live: nothing new is sent by this change.

### 5.bg One Google connection (2026-10-22, feat/campaign-wizard, app-only)

Amir: "Connect Gmail for sending" (Profile → Email) and "Connect Google" (Profile → Imports) "should be one thing". Also
the same day SalesBrain moved to a NEW Google Cloud project under the heyyazz.com / zeami.io Workspace (client
469029590871-…; the old one was 587155655985-…) — GitHub secrets GOOGLE_CLIENT_ID / _SECRET replaced, deploy rerun.
- **One consent, one row**: `GOOGLE_SCOPES` = userinfo.email + contacts.readonly + gmail.readonly + gmail.send, stored
  as oauth_tokens provider `google`; `scopes` now holds what Google REALLY granted (`grantedScopes(tokens.scope)` — a
  person can untick a box). `storeGoogleTokens(userId, code)` registers `email_senders` only when gmail.send was granted
  (else revokes it) and deletes any old `gmail_send` row; `disconnectGoogle` drops both. `lib/gmail-send.ts` sends and
  reads threads with the `google` token. `/api/email/connect|disconnect` are kept as aliases.
- **Dead connections say so**: `getValidAccessToken` forgets a refresh token Google refuses for good (400/401 with
  invalid_grant / unauthorized_client / invalid_client — revoked, or issued by the old project) so every screen shows
  "Reconnect" instead of "Connected". `/api/integrations/status` returns `google.needs_reconnect` (checked with the
  same refresh the syncs use) and `google.can {contacts, read_mail, send}`; `connected_at` = `created_at`, reset on
  every (re)connect.
- **UI**: Profile tab "Email" → **Google** (`components/profile/GooglePanel.tsx`: account, permission pills, sync
  buttons, Reconnect / Disconnect, the sending settings — From name, signature, daily cap — and team mailboxes);
  `?tab=email` lands there; the Imports tab's Google card is a link to it. EmailSendingPanel is gone. Every
  "Profile → Email" text (wave/campaign errors, tool descriptions) now says Profile → Google.
- After deploy: amir@chipchip.social's connection (from the old project) shows "Needs reconnecting"; with Audience
  Internal only Workspace accounts (zeami.io / heyyazz.com) can connect.

### 5.bh Test run writes the real drafts; messages on the canvas; campaign emails signed (2026-10-22, feat/campaign-preview)

**LIVE 2026-10-22 (0.62.0)**: ring deployed (smoke 0.62.0, one gateway), app on Production (run 39813504481).

Amir: "what does the test run do? show the drafted message in the test run and on the canvas, and make it editable."
- **Test run** (campaign page): pick who — the sample person or anyone in the campaign / on its lists
  (`campaigns.candidates`); the path is instant; **Write the drafts** = app-only RPC `campaign_preview` (180 s class in
  `kernel-rpc.ts`) → kernel `preview_plan` (the to-draft items along that person's path, same fields `campaign_tick`
  hands the ring, nothing filed) → ring `campaign_runner.preview` (the live `draft()` per step, each follow-up given the
  previous draft as `previous_text`). ~25 s for an email sequence of 3. Each draft is editable; **Use as this step's
  text** switches the step to exact text with the person's name / company / title turned back into placeholders
  (`lib/campaigns.ts::toTemplate`).
- **Canvas**: a message step shows the start of its text — its own exact text, or the latest sample ("sample · …",
  `messageOf`); the step panel shows the full sample with "Edit it and use it as this step's text". Wizard layout
  spacing 165 px for the taller steps.
- **Fixed on the way**: campaign emails went out WITHOUT the signature and opt-out line (only waves composed them) —
  `campaigns.compose_email` now appends the sender's signature (else their name) and `outreach.email.opt_out_line`
  in `file_step_draft`; the drafter is told not to sign off itself. The draft prompt forbids inventing numbers,
  results, customers, offers or claims (a live test had invented "15 hours per employee per month").

### 5.bi Campaign canvas for reading: saved samples on every card, compact steps, Tidy up (2026-10-22, feat/canvas-design)

**LIVE 2026-10-22 (0.63.0)**: ring deployed (smoke 0.63.0), app on Production (run 39842137712).

Amir: "the canvas still says 'Write it for me' — it should already show the drafted message; a summary on the card, the
full message on hover; the canvas is hard to see."
- **Samples are kept**: `campaigns.settings.samples {node_id: {text, subject, person, cfg, at}}` (kernel `save_samples` —
  outside the graph, so never published, undone or sent). `preview_plan(all_steps=True)` covers every message step
  (`policy.message_steps`: breadth-first, follow-up = an earlier message of the same channel upstream); ring
  `preview(all_steps, save)` writes them (each follow-up given the last message of its channel) and saves; app action
  `samples`. The campaign page writes missing samples once on open (owner/admin), marks a card "out of date" when the
  step's mode / instructions / text / subject changed since (`sampleIsStale` against `cfg`), and offers Refresh.
- **Canvas** (`SequenceCanvas.tsx` rewritten): message steps are 270 px cards with a 2-line summary (fields as chips);
  hover = the whole message in a fixed popover drawn outside the zoomed pane (readable at any zoom); every other step
  is a slim pill; opens readable (fit if >= 80 %, else 85 % top-aligned) with `panOnScroll` (wheel scrolls, pinch /
  ⌘-scroll zooms); "Ready to run" / "N to fix · show" and the samples state are badges on the canvas; the right panel
  appears only while a step is selected; palette 176 px; **Tidy up** = `tidyLayout` (rows by longest path from Start,
  the main path straight down: a reply-wait's timeout, an acceptance's yes, an If's yes).
- **Drafts**: email drafts lose a closing the model wrote anyway (`_strip_signoff`: "Best regards, Amir Redwan" — the
  signature is added at send); a draft opening with "hope this … finds you well" is dropped.

### 5.bk Side menu cleanup: Clients retired, People off the menu, Prospects fixed (2026-10-24, feat/menu-cleanup, app-only)

**LIVE 2026-10-24 (0.64.0)** with §5.bk–§5.bm: 082 applied (5 sent emails backfilled), ring deployed (smoke 0.64.0), app on Production (run 40109339138). Sidebar notes of both other branches applied at merge (Clients, People, Discovery off the menu).

Amir: "what do /relationships, /prospecting and Clients do — do they need their own menu entry and page?"
- **Clients retired**: deals grouped by company name, everything on it already on Deals / Pipeline, its "View deals" link never
  filtered anything. `/clients` redirects to `/pipeline`; `/api/clients` deleted; the /network mobile stub lost its wrong
  "Open contacts list → /clients" link.
- **People (`/relationships`) = a dossier you open from a person**, not a menu page: "Dossier" on the /network detail panel
  (`metadata.person_id` from `contacts.person_id`, 4,727 of 5,563 contacts) and "Dossier: what the agent knows →" on the
  /sales-leads card (`person_id` = prospect's, else its contact's, on `GET /api/sales-leads/[id]`). `?person=<id>` opens one
  dossier (list switches to Everyone; on a phone the dossier replaces the list). `GET /api/relationships/[id]` now answers
  for ANY person (LEFT JOIN relationships, no row = stranger; was 404 for 5,100 of 5,784 people) and runs its 7 queries on
  one client in sequence. Stage chips removed (all 649 rows are "stranger"); the stage badge shows only when it is not.
- **Prospects (`/prospecting`) fixed**: `GET /api/prospects` returns `{rows, total, counts, limit, offset}` (counts per stage
  over every filter but stage, from one GROUP BY; limit ≤500, default 100; `q` searches name / company / email / title,
  LIKE wildcards escaped; one client, sequential). The page shows true counts (was: counts of the 200 rows loaded), a search
  box and "Show N more". Its only caller is the page. Heading "Prospects" like the menu.
- **Sidebar not touched in this branch** (ws-inbox owns `components/Sidebar.tsx`): remove `/relationships` and `/clients`
  from the Relationships group (and their NAV_ITEMS) when merging, after ws-inbox.

### 5.bn Deals = one page: list + board, the deal page holds the chat (2026-10-24, feat/deals-merge, core 083)

**LIVE 2026-10-24 (0.65.0)**: 083 applied (Kabana won_at 2026-07-17, ChipChip Pilot 2026-05-07, both still active), app on
Production (run 40110352501), ring deployed (smoke 0.65.0). Deploy note: this Mac's DNS was failing for pypi.org that day, so
`deploy-server.sh` ran with `UV_OFFLINE=1` (the local wheel build uses uv's cache; the box installs over its own network).

Amir: "are /deals and /pipeline up to date with our sales process, and merge them into one" → "as it is now, and develop it"
(the list shows MY deals like the old home page, the board shows EVERYONE's like the old /pipeline).
- **`/` = Deals** (`app/page.tsx`, server; `components/deals/DealsView.tsx`; data `lib/deals-board.ts::loadDeals`, ONE query with
  laterals: lead, creator, sales rep (`lib/zeami` SALES_REP_JOIN), confirmed `delivery_links`, the pending `board_decisions` row
  + vote tally). List / Board switch; tabs All (list only) / Sales / Grants / Credits; Mine / Everyone (list default Mine =
  creator or lead, board default Everyone); status Open & won / Won / Lost / Cancelled / All; flags Overdue / Board vote open /
  In delivery; search; grants board keeps the Stages / Gates toggle; a summary strip (open, weighted, won, in delivery, votes
  open, overdue, lost) whose tiles set the filter; + New deal (all three types) opens the new deal's chat. Every choice is in the
  URL. The board is called **Pipeline**: a **List | Pipeline** switch at the top right of Deals (`?view=pipeline`;
  `?view=board` still works); `/pipeline` → `/?view=pipeline`; old `/?deal=<id>[&prefill=]` links → `/deals/<id>?tab=chat[&prefill=]`.
- **Rules in one place** (`lib/deals-view.ts`, client-safe): won = status 'won' (grants) OR a sales deal at G9; in delivery =
  confirmed PMI link 'in-pilot' ('paused' = stalled) — same values as core `domain/delivery`; the gate SLA clock applies only to
  an open deal still in sales (`hasClock`: not won, not in/paused delivery, not a signed grant); vote open = a PENDING
  board_decisions row (the old "Board pending" meant "sits at G3/G7" and showed 2 deals with 0 open votes).
- **`/deals/[id]`**: Overview | Chat tabs (`?tab=chat`; Chat takes `prefill`); chat for creator / lead / admin (was creator /
  admin); `components/deals/LeadPicker.tsx` (moved from the deleted `components/DealPanel.tsx`) to change the lead; sales rep;
  Won / Cancelled / In delivery badges; "Board vote open" card (tally, thresholds) and "Delivery (PMI)" card (status, step, health
  + reasons, PM, last contact); **Mark won** for grants (existing kernel checks, blockers shown) and **Cancel deal** for any
  active or won deal (both routes existed with no button); back link ← Deals; `decay_` flag styling removed.
  `GET /api/deals/[id]` adds `rep_name/rep_email`, `delivery`, `board_vote`.
- **Core 083 + `update_deal`**: a sales deal reaching the final gate records `won_at` (cleared if it moves back); status stays
  'active' ON PURPOSE (pmi_sync auto-links, the attention digest and pipeline_overview read active deals, and a won sales deal is
  the one in delivery). 083 backfills `won_at = gate_entered_at` for sales deals already at G9. Grants still close via
  mark_grant_won. Test: `tests/test_sales_won_db.py` (real Postgres, opt-in).
- `lib/gates.ts` G9 text no longer promises the retired onboarding form.
- **Sidebar**: the separate Pipeline entry is gone; Deals (`/`) is the one entry (the menu group heading is still "Pipeline").


### 5.bo Lists (ICPs) are visible to everyone, with an owner who can hand them over (2026-10-26, feat/icp-sharing, no migration)

**LIVE 2026-10-26 (0.66.0)**: app on Production (run 40318035938), ring deployed (smoke 0.66.0). No hand-over made on live data yet.

Amir: "make all the ICPs visible for everyone, show who the owner is, and make it changeable." Decisions: the owner or an
admin changes the owner; the leads the OLD owner holds on the list move with it, ALSO those already in a conversation;
everyone views, only owner + admin edit.
- **Read for all, write for owner + admin** (`lib/icp-server.ts`): `visibleIcp` answers any list for any signed-in teammate and
  carries `can_edit`; `guardEditable(id, session)` gives write handlers 404 (missing) / 403 "Only the list's owner or an admin
  can change this list." Applied to PUT/DELETE `/api/icp/[id]` (were owner-only, now owner OR admin; a rename's clash check and
  the rescore run as the list's owner), and the POSTs of connect, find-linkedin, email/sequence, email/waves, firms (import),
  firms/auto|brief|people|research. run / search stay owner-only (they spend the owner's LinkedIn budget).
- **Leads are scoped by the LIST, not the owner**: `/api/icp/[id]/leads` used `owner = icp owner`, which hid leads held by the
  sending account (Fakuma showed 8 of 76). Panel and export already scoped by list.
- `/api/icp` + `/api/icp/overview`: `?scope=all` for everyone (was admin-only). `/icp` opens on **Everyone's lists** with a
  Mine only switch; every row says "owner <name|you>"; Pause / Resume / Archive only for owner + admin.
- **Hand-over**: kernel `commands/icp_owner.py::set_icp_owner(actor, icp_id, new_owner)` (owner or admin; new owner by id, name
  or email via `kpis.resolve_owner`, several → candidates; refuses service accounts and a name clash with the new owner's lists):
  moves the list, the old owner's leads on it (leads whose LinkedIn profile the new owner already holds stay — unique per owner),
  their contacts when no other lead of the old owner uses them; audit `icp_owner_change`; DMs the new owner (and the old one when
  an admin did it); reports `leads_moved`, `in_conversation` (their LinkedIn threads stay on the old account, and the Lead
  Conductor hands leads it runs back to the account holding the conversation), `kept_duplicates`. Ring tool `crm_icp_set_owner`
  (mcp=None). App `POST /api/icp/[id]/owner` + `components/icp/OwnerControl.tsx` ("Owner … · change owner") in the list header.
  Test `salesbrain-core/tests/test_icp_owner_db.py` (real Postgres, opt-in).
- Not built: the bot's `crm_icp_list` still lists only the asker's own lists; run / search for an admin as the owner.

### 5.bv LIVE 2026-10-26 (0.68.0): the whole funnel release

Merged feat/funnel (§5.bp–§5.bu) and deployed: app on Production (run 40351030168), kernel + ring by `deploy-server.sh`
(core/hermes 0.68.0, gateway active, new crons `funnel-digest` Mon 08:15 and `calendar-meetings` hourly 07:35–21:35).
Migrations 085, 086, 088, 089 were applied earlier the same day; **087 (six sales stages) applied right after the app
deploy**: 48 deals, 86 gate events, 29 board decisions, 15 flag sets moved. Production RPC checks as Amir: funnel by
company 190 contacted / 113 engaged / 12 open opportunities / 2 clients; 183 warm people; NRW tuning proposes company
size 15 → 20 (not applied).
**Still to do by people**: enable the Google Calendar API in Cloud project salesbrain-512414 and have teammates reconnect
Google on Profile → Google (until then `calendar-meetings` finds nobody); decide whether to apply the NRW weights.
**Later cleanup**: drop `sales_leads_pre088` after a week (≈ 2026-11-02) once nothing has needed it; moving code off the
`prospects` / `sales_leads` views is optional. `ws-agent-memory` must re-run `./ws.sh sync agent-memory` (a
CLAUDE_CONTEXT.md conflict; the attempted sync was aborted, its tree is untouched).

### 5.bp One funnel, Phase A — definitions, /funnel, list seats, Opportunities (2026-10-26, feat/funnel, migration 085)

Amir, after the team call with Mateo and Hannes: "redesign the whole flow as a funnel, one connected funnel; define when
something is a prospect, a lead, an opportunity." Plan + open decisions: `~/.claude/plans/funnel-redesign.md` (Phase B =
one row per person `funnel_leads`, Phase C = warm lane + outcome learning, Phase D = simpler gates — not built).
- **The words** (kernel `policy/funnel.py`, app `lib/funnel.ts`, parity test `test_funnel_parity.py` — change both):
  Prospect = on a list, nobody touched them (sourced → scored → ready to reach). Lead = the FIRST TOUCH OUT (connection
  request sent, message, email, intro ask) or put in on purpose by a person (own network, event, demo request, hand-picked
  import): new → contacted → engaged (answered) → meeting → qualified. Opportunity = a deal. Client = won. Exits: not a fit
  / lost / archived, counted at the furthest stage reached. A found profile or a draft is NOT a lead; an accepted request
  stays "contacted" until they answer. **An agent-sourced person (linkedin_search, sales_navigator, firm_team,
  company_discovery) with a /sales-leads card but no touch is still a prospect** — the 591 VC partners firm research
  carded as `manual:new` are prospects in the funnel. Channels are states, not stages (LinkedIn none/profile/pending/
  connected/declined; email none/known/sent). Lanes: own network, event, came to us, hand-picked list, found by agents,
  opportunity created directly.
- **Read model, nothing stored**: `commands/funnel.py::funnel_summary(icp_id, owner, lane, deal_type)` = ONE query over
  every prospect + every card without one (invitations by prospect / slug / member id, sent approvals, reply events,
  card events, deals), classified in Python, ONE verdict per person (person id → slug → email; furthest stage wins).
  Opportunities created directly are added to Opportunity/Client but never to a conversion rate. Aggregates only →
  any user, any slice (KPIs rule). ~2.4 s SQL from a laptop over 5,660 rows. Ring `crm_funnel` (read, on MCP).
  Live 2026-10-26: 378 ready to reach, 192 new, 255 contacted (155 request pending, 47 connected not messaged, 53
  messaged), 26 engaged, 1 meeting, 19 open opportunities, 2 clients. **Meetings are almost never recorded** (only the
  hand-set journey step 4 or a booking) — the Meeting stage reads ~0 until something writes it.
- **Seats on lists (085)**: `icp_profiles.responsible_user_id / front_user_id / sender_user_id`. `apply_role_defaults` takes
  the list's seats before the prospect owner; the Conductor's `sender_candidates` puts the list's sender right after the
  account holding the conversation. `icp_owner.set_icp_seats` (owner or admin; names/emails/ids; "" clears;
  `apply_to_leads` moves open leads that still had the list's previous default, never a seat set by hand; an `assign`
  line each) = ring `crm_icp_set_seats` (mcp=None) = `GET/POST /api/icp/[id]/seats` + `components/icp/SeatsControl.tsx`
  under the owner line on `/icp/[id]` (hidden when the read fails, e.g. before 085). 085 also adds **`deals.account_id`**
  (backfilled from the converted lead's prospect, else a UNIQUE name match: 13 of 65 live) and `convert_lead_to_deal`
  sets it.
- **App**: `/funnel` (filters list / teammate / lane in the URL; full strip, lanes, channels, exits, definitions);
  `components/panel/FunnelStrip.tsx` (`useFunnel`, `compact` row, or `data` passed in) on `/sales-leads`, `/prospecting`,
  `/icp/[id]` (that list). **Sidebar in funnel order**: Overview (Funnel, Inbox) · 1 Target (Lists (ICP), Brand & Voice) ·
  2 Reach (Campaigns, Marketing, Network) · 3 Prospects (Prospects, Agents) · 4 Leads (Leads, Follow-ups) · 5 Opportunities
  · Funding / Insights / Admin folded. **"Deals" is "Opportunities" in the UI** (DealsView, deal page); table, routes and
  `crm_*_deal` tools keep "deal" until Phase B.
- Knowledge seed: "The funnel: prospect, lead, opportunity, client", "Opportunity (deal)", "Who works a list" (insert-only).
- Tests: `test_funnel.py` (19 rules), `test_funnel_parity.py`, `test_funnel_db.py` (real Postgres: seats move defaults
  and keep hand-set ones, new lead inherits list seats, owner/admin only, request = contacted, agent card = prospect,
  twin rows count once). NOT done: `/sales-leads` still lists every card (agent-made ones included) — Phase B.

### 5.bq One funnel, Phase B — one stored row per person + dated history (2026-10-26, feat/funnel, migration 086)

Plan §12 ([funnel-redesign.md](~/.claude/plans/funnel-redesign.md)). Revised from §3: replacing `prospects` + `sales_leads`
with views was rejected (~60 writers, ~260 readers, ON CONFLICT upserts a view cannot serve). Instead a projection ON TOP:
- **086**: `person_funnel` (one row per person: person_key = person id → `li:<slug>` → `em:<email>` → row id; stage, exit,
  substage, lane, channels, stage_entered_at, lead_id, prospect_id, deal_id, account_id, `icp_ids[]`, `user_ids[]`,
  rows_merged) and `funnel_events` (person_key, from → to, exit, occurred_at, source backfill | refresh; one entry per
  person per stage). Never edit by hand: fix the source, refresh.
- **`commands/funnel.refresh()`**: facts query → classify → merge a person's rows (ids kept from whichever row has them,
  earliest time per stage) → COPY into a temp table → upsert + delete gone keys; events for every stage passed, dated by the
  ledgers (request sent, first message, first reply, booking, convert, deal created, won), else now. First run = backfill.
  Advisory lock (one at a time). Live dry run (rolled back): 5,615 people, 16,789 history rows, 5.7 s from a laptop;
  a no-change refresh 3.5 s, 0 events. Run by the hourly `lead_conductor.py` and on read when older than 10 min.
- **`funnel_summary`** reads the stored rows (a list slice stays live: membership is per list); `period` (kpis periods)
  adds `entered` per stage from the history; `view='companies'` = each account once at its furthest person (direct
  opportunities deduped by account). **Without 086 everything falls back to the live Phase A compute** (`stored()`),
  periods return an error, `refresh` skips.
- **/sales-leads hides agent finds nobody contacted** (`AGENT_FIND` in `lib/sales-leads-sql.ts`: the card's person is still
  `prospect_*` in person_funnel), in the list, counts, stage chips and list filter; a "Show agent finds not yet contacted
  (N)" switch (`finds=1`) brings them back. `funnelStored()` (cached schema check) disables the filter until 086 exists.
  The Excel export is unchanged (exports everything).
- **/funnel**: period select ("+N in period" on each tile), People | Companies switch, "updated HH:MM".
  `crm_funnel` takes `period` and `view`.
- 085 was applied to the shared DB on 2026-10-26 (Amir). **086 is NOT applied** (file only): apply it before or with the
  deploy, then the first refresh backfills the history.

### 5.br Funnel decisions applied: lead = contact, Resting, six sales stages (2026-10-26, feat/funnel, migration 087)

Amir's answers to the open questions (plan §13):
- **Lead only at contact.** `lead_new` is gone from `policy/funnel.py` STAGES (and `lib/funnel.ts`): hand-picked imports
  and exhibitor lists nobody contacted are `prospect_ready`. Contacted = request / message / email / intro ask; engaged =
  they answered, OR met in person (`sales_leads.met_at`), OR came to us (inbound sources). /sales-leads now hides EVERY
  card nobody contacted (`NOT_CONTACTED`, was `AGENT_FIND`), switch "Show not contacted yet (N)", remembered per browser
  (`localStorage salesleads.showNotContacted`) — Fakuma's untouched priority list sits behind that switch.
- **Resting (nurture)** = exit `nurture`: contacted or engaged, `last_activity_at` older than `NURTURE_DAYS` (30) and
  nothing planned (`followup_planned`: prospect next_followup_at, card next_contact_at today or later, a pending
  approval, an active campaign enrollment). Not lost; the next touch or reply clears it at the next refresh.
- **086 APPLIED** to the shared DB 2026-10-26 and refreshed: 214 contacted + 14 resting, 141 engaged + 45 resting, 1 meeting.
- **Six sales stages** (`domain/gates.py` + `lib/gates.ts`, parity-tested): 1 Discovery (old G1+G2, carries the demand
  fields, 13 d) · 2 Board review 1 (old G3) · 3 Offer (old G4+G5+G6, 26 d) · 4 Negotiation & board review 2 (old G7,
  deployment_plan) · 5 Close (old G8) · 6 Won · handover (old G9). Grants and credits unchanged. **Migration 087 moves the
  live data** (deals.gate, gate_events from/to with the old numbers kept in `reason`, board_decisions.gate,
  `board_sent_g<N>` flags, cached `missing`, the seed knowledge entry "Deals and gates" if untouched) and runs ONCE
  (`data_migrations` key `087_sales_six_stages`). Dry run on live (rolled back): 48 deals, 86 gate events, 29 board
  decisions, 15 flag sets. **087 is NOT applied: apply it in the same step as the deploy** — production code before this
  branch reads nine gates. Hard-coded nines fixed: reports (open / overdue per pipeline SLA / won this month, sales only),
  Chat starters, Zeami sync final stage, funnel SQL (`final_gate("sales")`), sales pipeline skill, KPI note.
- **Menu without numbers**: Overview · Target · Reach · Prospects · Leads · Opportunities · Funding / Insights / Admin.

### 5.bs ONE table: `leads` replaces `prospects` + `sales_leads` (2026-10-26, feat/funnel, migration 088)

Amir chose "replace both tables with a single new one". **`prospects` is renamed `leads`** (ids and the 12 FKs follow)
and the lead-card columns live on the same row (`card_id` = the old sales_leads.id, `card_created_at`, `lead_source`,
`lead_status`, `lead_payload`; `converted_deal_id` shared; the rest keep their names; card CHECKs + a "card fields
required when card_id is set" CHECK; card indexes recreated as partial indexes). **`prospects` and `sales_leads` are now
VIEWS with exactly the old columns**, so all existing code works unchanged:
- `prospects` = plain updatable view (INSERT … ON CONFLICT on the owner+LinkedIn index works through it, tested).
- `sales_leads` = view `WHERE card_id IS NOT NULL` + INSTEAD OF triggers (`sales_leads_view_insert/update/delete`):
  INSERT puts the card on its prospect's row (`raw_payload.prospect_id`; a second card on one prospect = unique
  violation), else on a **placeholder** row (`source_type='lead_card'`, no contact); UPDATE writes the card columns and,
  when `raw_payload.prospect_id` names another card-less row, **moves the card there** (card id kept, history and campaign
  links follow, placeholder deleted); DELETE removes the card and its track record (and a placeholder row), the prospect
  stays. `sales_leads.prospect_id` is never NULL any more; the Lead Conductor treats a placeholder as "no prospect yet"
  (conductor `_FACTS_SQL` join) and links / lands it exactly as before, which moves the card onto the real row.
- `sales_lead_events.lead_id` and `campaign_enrollments.sales_lead_id` reference `leads(card_id)` (DEFERRABLE, for the
  move). The old card table stays as `sales_leads_pre088` for one release (drop in 089).
- Runs once (data move skipped when `leads` exists; views / functions / triggers re-created on every run).
- Rehearsed on live data (rolled back, ~5 s): 902 cards → 902, **0 differing in any column**, 0 relinked, 17 placeholders
  (the cards that had no prospect), 0 orphaned history rows. **088 is backward-compatible with the code on main**
  (the views keep the old names). APPLIED 2026-10-26 (see §5.bt).
- Tests: `tests/test_one_table_db.py` (form card → placeholder, card on its prospect + second card refused, UPDATE …
  RETURNING / rowcount, card move keeps id + history, deletes, ON CONFLICT through the view); the whole DB suite runs on
  the views (700 pass; the 3 campaigns_r2 failures are the known clock bug on main).
- **Not done (Amir to decide): one row per person.** 41 people still have 2–6 rows (one per teammate who holds them).
  Merging them needs a person × list × owner membership table and changes ~90 list-scoped and ~124 owner-scoped queries
  in 43 files (visibility, whose LinkedIn sends, budgets). Moving code off the views onto `leads` directly is optional
  cleanup.

### 5.bt Funnel Phase C — warmth, Warm people, what converts (2026-10-26, feat/funnel, migration 089)

From the team call: "nobody opens cold outreach … everything that moved is people that are almost friends; who did I
talk to recently and how warm" (Mateo), and "this is what you proposed, this is what happened".
- **Warmth** (`policy/warmth.py`, pure, tested): per teammate × person, 0..1 = 1 − Π(1 − signal), each signal fading by
  half-life: they wrote to us (LinkedIn, email, interactions incl. Mateo's logged WhatsApp; 0.85, 120 d, + volume), met /
  call / meeting (0.9, 240 d), we wrote with no answer (0.15, 60 d), 1st-degree connection we did not request (0.25) or
  that accepted our request (0.10), saved contact (0.2). Bands hot ≥ .7 / warm ≥ .4 / cool ≥ .15 / cold. Reasons in words.
- **089**: `person_warmth (user_id, person_id, warmth, band, reasons, their/our_messages, last_two_way_at, last_touch_at)`
  and `funnel_cohorts` (one snapshot per person at FIRST contact: channel, lane, fit, warmth, list, sender, title,
  seniority, industry, size, location; `source` backfill | live). Both projections.
- `commands/warmth.py`: `refresh_warmth()` (one query over threads/messages, email, interactions, card events,
  relations, edges; ~6 s from a laptop, 1,309 pairs live: 78 hot, 137 warm), `warm_people()` (warm/hot, nobody working
  them — an open moving card or an opportunity hides them — including people on NO list, the AMD case),
  `add_warm_lead()` (card with source `warm:own-network` → lane "Own network", back office = warmest teammate),
  `prior_warmth()` (signals dated BEFORE a moment; an accepted request of ours does not count).
- **Funnel**: a two-way conversation anywhere (any teammate, any channel) = engaged; our messages = contacted; newest
  conversation counts for "resting". `refresh()` runs warmth first and writes cohorts for everyone newly in contact, with
  warmth rebuilt from before first contact (so a reply caused by the outreach never makes someone look warm before it).
- **What converts** (`policy/funnel_insights.py`, `funnel.funnel_insights`): ONLY people we reached out to (LinkedIn request,
  LinkedIn message, email — met in person / came to us / earlier conversations are left out and counted), per dimension
  contacted / answered / meeting, findings (≥ 1.5× or ≤ 0.5× the slice, groups ≥ 8), suggestions (does the fit score
  predict answers; warm vs cold). Nothing changes by itself. Live rehearsal: 251 reached out, 8 % answered; own network
  5/10, met at an event 6/19, first touch a LinkedIn message 14/37 vs a bare request 7/214; fit 70+ 7/138 vs below 70
  13/112 → "the fit score is not predicting answers". 0 meetings recorded (the meeting gap again).
- Ring: `crm_warm_people`, `crm_warm_add_lead` (write), `crm_funnel_insights`; knowledge "Warmth and warm people",
  "What converts". App: `/warm` (Reach → Warm people; band / teammate / include-worked filters, reasons, Add as lead),
  `/api/warm` (GET, POST), `/api/funnel/insights`, `components/funnel/Insights.tsx` on `/funnel`, Leads rows get a warmth
  chip and a "Warmest first" sort (`SORTS.warmth`; the export falls back to priority). Everything degrades to a clear
  "needs migration 089" message before 089.
- **088 + 089 APPLIED to the shared DB 2026-10-26** (Amir): 902 cards identical after the move; first refresh 18 s from a
  laptop (1,309 pairs: 78 hot, 137 warm; 435 snapshots). Excel: `GET /api/export/warm?band=&owner=&worked=1` (kind
  `warm`: sheets Warm people · Relationships · About), button on `/warm`. Company falls back to the prospect's account,
  the lead card, then the LinkedIn headline. **087 still waits for the deploy.**

### 5.bu One row per person, WhatsApp, Calendar meetings, Monday note, list tuning (2026-10-26, feat/funnel)

- **Twins cleaned (data, Amir's decisions)**: 40 people had two rows. Esmail+Hannes / Hannes+Osman / Amir+Hannes → keep
  Hannes; Mateo+Osman → keep Mateo; Bruk+Yasin and Esmail+Yasin → both deleted; Ralf Schwirten (Matthias twice) → one.
  52 rows deleted (8 cards, 51 unused contacts), 3 history records (approvals / invitation / email thread / enrollment)
  moved to the kept row. Backup `~/.cache/salesbrain/backups/twins-cleanup-20261026182122.json`, audit
  `twin_rows_cleanup`. Detlef / Mark Ehl were NOT twins (Mark imported with Detlef's address): Mark split into his own
  person (audit `person_split`). Esmail's 11 opportunities were NOT touched (needs an explicit yes).
- **No new twins**: `prospecting.upsert_candidate` returns a teammate's existing row (`held_by`, nothing created) when
  the LinkedIn slug or member id is already theirs (test in `test_one_table_db.py`).
- **WhatsApp import** (`policy/whatsapp.py` parser: iPhone + Android, day/month order from the file, continuation lines,
  media, system lines; `commands/whatsapp.py`: one-to-one only, person by id / name / file name ("WhatsApp Chat with X"),
  created when unknown, candidates when ambiguous; messages → `interactions` channel whatsapp inbound/outbound, dedup
  on (time, direction); warmth refreshed). Bot: `crm_whatsapp_import {file_path, contact?, my_name?}` (document-cache
  guard now takes .txt/.zip). App: "Import a WhatsApp chat" on `/warm` → `POST /api/warm/whatsapp` (file to
  tmpdir/salesbrain-uploads → internal RPC `whatsapp_import`, which accepts only that folder; file deleted after).
- **Meetings from Google Calendar**: `calendar.readonly` added to the ONE Google consent (existing connections must
  RECONNECT; the **Google Calendar API must be enabled in Cloud project salesbrain-512414**). `lib/google-calendar.ts`
  (events with other attendees, 14 d back / 30 d ahead) → bridge tool `calendar_events` → Hermes cron
  **`calendar-meetings`** (35 7-21) → `commands/meetings.record_calendar_meetings`: attendee email on a lead card → past =
  `meeting` track-record line (once per event, `ref.calendar_event_id`), future = card booked (booked_at, scheduled, Meet
  link); known person → `interactions` channel meeting (warmth "met"). Profile → Google shows "Calendar meetings".
- **Monday funnel note**: Hermes cron **`funnel-digest`** (15 8 * * 1) → `funnel.weekly_digest`: per teammate their warmest
  people nobody works (top 5 + reason), their last-7-days outreach and answers, the team's clearest 30-day learning; own
  DM or nothing (source `funnel-digest`, mutable); nobody gets a note with nothing personal in it.
- **List tuning** (`policy/icp_tuning.py`): per fit criterion, answer rate when matched vs not (outreach only); lift ≤ 0.8 →
  half weight, ≥ 1.5 → 1.5× (cap 60), rescaled to the same total; needs ≥ 8 per side, ≥ 3 answers, ≥ 2 on the better side.
  `commands/icp_tuning` (`icp_tuning` read for all, `apply_icp_tuning` owner/admin → weights + rescore, audited); tools
  `crm_icp_tuning`, `crm_icp_apply_tuning` (mcp None); `/api/icp/[id]/tuning`; `components/icp/TuningPanel.tsx` on
  `/icp/[id]`. NRW today: company size 7/109 vs 3/108 → size 15 → 20, title 40 → 35 (not applied).
- Warm people Excel: kind `warm` export + button on `/warm`.

### 5.bw /icp = lists as funnels (2026-10-27, app-only, no migration)

Amir: "rework the lists page: little text, really present the funnel results and conversion rates" → picked design E
(canvas https://claude.ai/artifact/5FM5qwvdQnVQddNrSx1Rfu). `/icp` is now a short header (Everyone / Mine, New list,
Agents link), a search + sort (most contacted / best conversion / most people), a plum **All lists** card (each person
once) and one card per list (`components/icp/ListFunnelCard.tsx`: owner, how most people came in, a small narrowing
funnel Found → Ready → Contacted → Answered → Meeting → Opportunity with each step's conversion from the step before
(the weakest step in orange), headline **conversion rate = contacted → opportunity** (Amir: "I need a conversion rate,
not an answer rate"; `conversion`, `stepRates`, `weakestStep` in lib/icp-panel.ts), "N to approve"; actions behind the ⋯ menu; lists with nobody on them are dashed cards at the end).
Steps are CUMULATIVE (everyone who got at least that far) from `person_funnel` (086), square-root widths.
`GET /api/icp/overview` returns `funnel` per list and `funnel_total` (two more queries on the same client).
FleetStrip and IcpFilterBar are deleted (the kill switch, agent switches and paused accounts live on /agents).
Local `npm run dev` shares the pooler's 15 session slots with production: expect occasional EMAXCONNSESSION 500s locally.
**New / edit list = a wizard (2026-10-27, Amir: "a bunch of forms; no one knows what to fill").** `components/icp/IcpWizard.tsx`
replaced IcpBuilder: Purpose (Customers / Investors cards + optional "Draft it" from a website via `/api/icp/optimize`) → Who →
Fund focus (investors) → Companies / Funds → Skip → Check and save (one line per step, tap to change; empty name = suggested).
Common choices are one-tap chips, the rest of the vocabulary is found by typing; long explanations sit behind ⓘ. The side panel
re-scores your contacts ~1.2 s after a change (`/api/icp/preview`). Edit opens on the last step; a hand-made list
(objective 'list') or an investor list with a fund focus saves without roles. Only WHO belongs on the list is asked: description,
pitch (product / hook / language), first message and scoring weights moved to the collapsible **Outreach settings** card on
`/icp/[id]` (`components/icp/ListSettings.tsx`) and pass through a wizard save unchanged. Icons: one shared line set in
`components/icons.tsx` (`components/sales-leads/icons.tsx` re-exports it).

### 5.bx Investor lists in the ICP builder (2026-10-27, feat/investor-icp, app-only, no migration)

A teammate on Telegram: "the ICP builder does not really work for investment — which rounds, what they target (SaaS or
consumer), and VC job roles are missing." `lib/icp.ts` gains a role group **Investors (VC)** (General / Managing /
Founding Partner, Partner, Venture Partner, Principal, Investment Director / Manager, VP, Associate, Analyst, Business
Angel; no LinkedIn function on purpose) and the investor vocabulary (`INVESTOR_STAGES`, `_SECTORS`, `_EXCLUDE_SECTORS`,
`_REGIONS`, `_TITLES`, `_INDUSTRIES`, `_EXCLUDES`, `isInvestorList` = the list has a `firm_brief`). `IcpBuilder` has a
**This list is for: Customers | Investors** switch; Investors fills empty roles / industries / exclusions with the VC
defaults, hides "Suggest ICPs", and adds section 3 **What should the fund invest in?** (rounds, investment focus, out if
only, regions, round size + currency, our country, latest fund year, pitch) = the firm brief (§5.bc), saved after the
list through `POST /api/icp/[id]/firms/brief` (re-judges every firm already on it). Opening a list with a brief shows it
as Investors. The kernel brief rules are unchanged (`policy/firms.eligibility`).

### 5.bx Lists = Mateo's 11 cohorts, sorted and ranked by AI (2026-10-28, feat/cohorts, migration 090)

From the 2026-10-27 call: lists mixed ICPs with events (PEI Napa, Fakuma) and nothing said who to work first. Mateo sent
the cohorts (10 customer + VC investors, each with "characteristics we want" and "person to contact"). Amir's calls:
AI sorts every live prospect into ONE cohort; NRW Kunststoff-Netzwerk IS cohort 5 (adopted, renamed); the VC raise list
IS cohort 11 (firms, brief, sequence kept); PE-firm partners go to the PE cohort of the fund's focus; full backup, then
clean start (old lists DELETED); rank = right person + company fit/early-adopter signals + warmth (bonus); seats later.
- **090**: `icp_profiles.cohort` jsonb {key, number, name, characteristics, person_to_contact, kind} (unique active key);
  `cohort_scores` (one row per prospect: list, cohort_key, guess_key, score 0-100 = person 50 + company 50 + warmth bonus
  15, confidence, why, signals, warm_via, verdict); policy `agents.cohorts`. Company verdicts + short summary/facts live
  on `account_profiles(kind='company')` (org-wide); a company-less person's verdict on their cohort_scores row.
- **Kernel** `policy/cohorts.py` (pure: the 11 cohorts as data, EN/DE role tiers per cohort, company fit, score, why,
  `clean_verdict`), `commands/cohorts.py`: `ensure_cohorts` (dry run) → `sort_plan` → `save_verdicts` → `score_people`
  (moves nobody) → `apply_sort` (dry run; only icp_profile_id changes, never owner/sender) → `cleanup_old_lists` (dry
  run; refuses while live people remain; re-points runs/approvals/waves, VC firms + voice rules to cohort 11, archived
  prospects lose the link) · `move_to_cohort` (owner or admin) · `sort_report`.
- **Ring** `cohort_sort.py`: batched Gemini JSON pass (10 per call), one Google-grounded lookup per unknown company
  (cap `grounded_per_run`), no LinkedIn calls; tool `crm_cohort_sort` (crm_admin: setup|plan|run|score|apply|cleanup|
  move); nightly cron `cohort-score` 02:40 (verdicts for new companies + re-rank, never moves); RPC `cohort_move`.
  Measured: 10 real companies in 7 s on gemini-2.5-flash; signals mostly empty without the web lookup.
- **App**: list page shows the cohort's two columns (`CohortHeader`); leads sorted by score with the why line, company
  summary + facts, click → signals/confidence/warm; Unsorted rows have guess + "Move to…" (`/api/prospects/[id]/cohort`);
  `/api/export/cohorts` = the dry-run sheet (admin); `lib/cohorts.ts` mirrors the kernel (parity test). The Leads Finder
  warning is hidden on hand-made lists (cohorts are objective 'list': sorted, not searched).
- **Warmth is thin** (2026-10-28: 43 of 3,418 live prospects warm/hot; only Amir has Google connected) — hence a bonus.
- **LIVE 2026-10-28 (0.69.0), rollout done**: backup `/root/backups/pre-cohorts-202610281407.dump` (19 MB, 133 tables);
  090 applied; setup (10 created, NRW + VC adopted); the sort ran in 12 batches of 300 (~1.5 h; batches run four at a time
  since 190a483 — `agents.cohorts.workers`; 570 Flash calls + 1,195 grounded lookups ≈ $2 tokens + ~$40 grounding); review
  sheet `~/Downloads/cohort-sort-review-2026-10-28.xlsx`; apply moved 1,192; cleanup deleted 80 old lists (2,601 archived
  prospects lost their list link, 2 draft campaigns lost a list). Result: NRW 1,768 · Unsorted 785 · VC 627 · PE growth 103
  · vertical software 102 · distributors 69 · admin services 41 · forwarders 12 · PE distress 12 · PE distributors 4 · PE exit 3.
  Unsorted is mostly honest (old Ethiopian / CTO / Ops-Hub lists) plus 108 of the 153 "M&A buyers" people the model read as
  advisors, not PE. Found on the way: the model answers "none/low" for a fixed cohort 5 (its menu lacked it) — cohort 5 now
  counts as certain membership and is scored on signals (a1b3d06); placeholder companies "Unknown" / "Independent" are
  judged person by person (4b74063). `/root/rpc.sh '<json>'` = run a kernel tool on the box as a given actor.

### 5.bz One person priority, everywhere + Lists grid | list (2026-10-28, feat/priority, migration 091)

Amir, on the ranked NRW list: "I can see a priority — but also let me prioritize a person from prospects, sales leads, from
an ICP, so prioritization goes all the way from outreach, focus, onboarding into clients; and filters on the leads."
- **One number**: `leads.priority` (1 = top … 10, NULL = not set; the 059 column, on the ONE table) is the person's
  priority as prospect and lead card alike; **091** adds `deals.priority` (copied from the lead at `convert_lead_to_deal`,
  then its own; `DIRECT_COLUMNS` so `update_deal` writes it). The AI cohort score stays separate: a set priority sorts
  first, the score orders the rest.
- **Kernel** `commands/priority.py::set_priority(actor, priority, prospect_id|deal_id)`: any teammate may set a lead's
  (lists are shared; audited `set_priority`; a card goes through `update_sales_lead` so the track record gets its line;
  the converted deal follows unless its own number was changed by hand); a deal follows the deal visibility rule; the
  service actor is refused. Ring tool `crm_set_priority` (family crm_prospecting, mcp write; on the MCP catalogue).
- **App**: `components/PriorityPicker.tsx` (coloured P-badge, click = select 1–10 / —, `POST /api/priority`) on the list's
  leads table (new Prio column + filter any / P1–P3 / any set / not set / P1…P10; order `priority NULLS LAST` first),
  `/prospecting` (column + filter, `?priority=`), the person page header, Opportunities (`DealItem.priority`, Prio column,
  filter select `?priority=`, `deals-board` orders by it) and the deal page header. `/sales-leads` already had it.
- **0.70.1 (same day)**: the list's leads, /prospecting and the person page 500'd (`column p.priority does not exist`) — they read
  through the `prospects` VIEW (088: the old 32 columns only); card columns such as `priority` live on the `leads` table. Rule:
  **a query that needs a card column reads `FROM leads`**, the `prospects` / `sales_leads` views keep only their old columns.
  Audit of every SQL in app + lib + core commands + ring (aliased and unaliased reads, UPDATE/INSERT column lists, qualified
  `view.column` refs): nothing else mismatched. Production logs since 088 showed one more real 500: the deal timeline failed for
  the creator/lead/admin since August (`$1` bound as uuid by `deal_id = $1`, then compared to `a.input->>'deal_id'`) — fixed
  with `$1::text`; no other route compares one `$N` both as jsonb text and as an id.
- **0.70.1 — teammates read every list's data (same day)**: Mateo's cohort page said "List not found or not yours." under
  Firms. The app routes already answer any teammate (`visibleIcp`, §5.bo) but the KERNEL still answered the owner/admin
  only: `firms._icp` / `_firm` and `waves._icp` gained `write` (default True = owner or admin; reads pass `write=False`:
  `list_firms`, `firm_progress`, `firm_get`, `email_sequence_get`, `waves_list`); `prospecting.icp_get` reads for anyone and
  returns `owner_name` + `can_edit`; `icp_list` lists EVERY teammate's lists with `owner_name` / `mine` (`mine=true` =
  own only; the service MCP forces `mine` so a partner app sees only its employee's lists). Spending stays owner/admin:
  `crm_prospect_search` and the Leads Finder step refuse on `can_edit=false`. Rule: **a kernel READ of a list is open
  to every signed-in teammate; a write or a spend checks owner-or-admin.**
- **Lists page**: Grid | List switch (grid default, remembered in `localStorage icp.layout`); the list view is one line
  per list with the six funnel numbers, step rates (weakest in orange), conversion and "N to approve" (`ListTableRow`).

### 5.ca A priority on the list itself (2026-10-28, feat/list-priority, core/hermes 0.71.0, migration 092)

**LIVE 2026-10-28 18:05 Addis (0.71.0)**: 092 applied (11 cohort lists renamed, no clashes), ring deployed (smoke 0.71.0),
app on Production. Checked: set + clear P1 on NRW through the kernel as Amir. No list has a priority yet — set them on /icp.

Amir, on the Lists grid: "how can we prioritise the ICP itself, what happens then, rank them in the UI, remove the numbers
behind every list." Options drawn on the real card (canvas https://claude.ai/artifact/UY2ZWrUVda1fto37XeHicy); Amir chose
**A — the same P-pill as on a person**, with the All-lists summary card kept.
- **092**: `icp_profiles.priority` 1 = top … 10, NULL = not set (same scale as `leads.priority`); the cohort number leaves the
  NAME ("5 · NRW …" → "NRW …", `cohorts._list_name` too) and stays in `cohort->>'number'`.
- **Set it**: `priority.set_priority(actor, p, icp_id=)` — owner or admin, audit `icp_priority` (a person's stays any
  teammate); ring `crm_set_priority {icp_id}`; `POST /api/priority {icp_id}`; `PriorityPicker icpId` on the list card, the
  list view line (new Prio column) and the list page header. `crm_icp_list` / `GET /api/icp/overview` carry `priority`.
- **What it changes, top-down everywhere**: Leads Finder plan (`i.priority` before `last_run_at` within an owner),
  Enricher plan, outreach + follow-up queues (`eff_priority = COALESCE(p.priority, i.priority)` before fit), the firm
  research / people sweeps (automatic batches take the top list first; hand-queued firms keep their queue order), the
  Lead Conductor's daily connect batch (`batch_pick`: a person's own priority, else `list_priority`), the due lists /
  Needs you / `/sales-leads` sorts and the Excel export (`COALESCE(l.priority, ip.priority)`), `/prospecting`, and
  `/api/agents/approvals` (list priority, then newest). **A person with no priority of their own sorts as their list's;
  a number set by hand on the person always wins; nothing is written to the person's row.**
- **Lists page**: sort "Priority first" (default; unset last, then most contacted), filter Any · P1–P3 · Any set · Not set.
- Not built: Parked / tiers (option C), drag ordering (B), the digests leading with the top list (the due digest follows
  the due order already), a knowledge entry.

### 5.by /icp/[id] = leads table + rail (2026-10-28, feat/icp-cockpit, app-only, no migration)

Amir picked design B of three (canvas https://claude.ai/artifact/4y5C8A6rZ7Xg7a5ZWkdDe3). The leads table is the page (left,
wide; Firms above it only on a firm list: `FirmsSection hideWhenEmpty onCount`); a rail on the right
(`components/icp/cockpit/Rail.tsx`): Funnel (cumulative reached from `/api/funnel?icp_id`, answered % and opportunity % of
contacted), Needs you (pending approvals by kind → Review), Agents on this list (one line each: Leads Finder with its blocker
or "hand-made list", Enricher coverage, Warm routes, Outreach), Campaigns using the list (`/api/campaigns` filtered by
`lists[].icp_id`), Who belongs (cohort / definition + fit counts). Each opens the old section unchanged in a `Drawer`;
header has a Settings drawer (ListSettings, Import firms on a people list, the old email waves folded as "older way").
Gone from the page: the duplicate "2 · The list" funnel bar, the numbered sections, the top blocker box.

### 5.ca /dashboard replaces /funnel (2026-10-28, feat/funnel-page, app-only, no migration)

Amir: the funnel page had "a lot of text and doesn't represent the title"; then "rename it Dashboard", deep-coloured
cards, no text cards like "Biggest leak". Picked design 1 of five (canvas https://claude.ai/artifact/RVn4piTh8uZYW66fnzTuyG:
1 deep cards + funnel, 2 bento, 3 night, 4 icon cards + tables, 5 goals + today). `/funnel` now redirects to `/dashboard`
(keeps icp_id / owner / lane / view; the old kernel period keys are dropped). Sidebar: "Dashboard" (grid icon) on top.
- **Deep cards** (`--deep-plum/blue/teal/violet` in globals.css: the same fill in both themes, white text >= 7:1): people
  who ENTERED Contacted / Answered or met (lead_engaged) / Meeting / Opportunity in the period, a delta against the SAME
  STRETCH of the previous period (`lib/dashboard.ts::periodBounds`, UTC like kernel `kpis.period_bounds`; periods Today /
  Week / Month (default) / Quarter, `?period=`), a 12-week sparkline, and a line from the funnel or the findings.
- **`GET /api/dashboard`** (direct SQL, ONE client, 4 queries; person_funnel + funnel_events from core 086, sliced by
  icp_id / owner (uuid or 'me') / lane): `current` / `previous` per stage, `weeks` (12 Monday buckets), `lists` (top 5 by
  contacted: found / contacted / answered / opportunity, cumulative like api/icp/overview), `replies` (newest
  reply_events, one per person, name + company + 160-char snippet, org-wide like the /sales-leads track record).
  Returns `history: false` before 086. ~0.2–0.5 s per query from a laptop. NOTE: funnel_events only dates what the
  ledgers date, so Sept and earlier weeks are thin (contacted entries total ~280 vs 479 reached).
- **Funnel card** (`components/funnel/FunnelChart.tsx`): stacked trapezoids (sqrt widths, color-mix ramp of `--accent`) +
  reached / step / % from the step before, weakest step orange (`weakestStep`: previous step >= 8 people), click a step for
  its meaning, sub-counts, exits and "See the people →"; footer = contacted → opportunity. Lane select and People |
  Companies live in its header. `lib/funnel.ts::drawnSteps` folds Scored into Sourced, Meeting/Qualified into Engaged.
- **Weekly chart** contacted vs answered-or-met (`--series-1/2`, validated both themes). **Lists**, **Latest answers**
  (→ `/sales-leads?q=&open=`), **What gets answers** (insights rows of first_channel + lane with enough people, bar per
  answer rate against the average line). "More" folds the full findings (`Insights`), channels / exits / definitions
  (`components/funnel/FunnelMore.tsx`).
- Not seen rendered by Claude (Chrome extension not connected). Not built: goals, today's meetings / follow-ups (design 5),
  an Export button.

### 5.cb /icp/[id] loads in seconds: slim rows, load once, skeletons (2026-10-28, feat/list-speed, app-only, no migration)

Amir, with a network tab: the list page took 15–25 s and showed "Loading…" boxes. Measured: the leads request was 1.1 MB
(research text 350 KB + profile-lookup candidates 290 KB for 300 rows), downloaded TWICE on open (the table loaded, then the
page's first 30-s poll bumped `tick` and the table loaded again) and again every 30 s; the DB part was only 0.8 s. The rail's
funnel went through `kernelCall` (a Python process per load, ~7 s); the list request fanned out 4 queries at once.
- **Slim rows** (`GET /api/icp/[id]/leads`): the row carries what the table draws — `researched` (bool) instead of the text,
  `profile_lookup` = verdict + `candidate_count` / `strong_count` / landed `discovered` names (`LookupSummary` in
  LeadsTable). The ranked page is picked FIRST (`WITH base AS (… ORDER BY … LIMIT 300)`), then the per-row laterals run over
  300 rows, not 1,769. ONE client, sequential. Measured on NRW: 1.1 MB → 487 KB raw (~100 KB gzipped), DB 824 → 164 ms.
  **`GET /api/icp/[id]/leads/[leadId]`** = the heavy part (qualification reasons, research text, full lookup with
  candidates), fetched when a row is expanded ("why" / Pick). `lib/connect.ts::connectState` accepts either shape.
- **Load once**: `LeadsTable` takes `signature` (coverage + stage counts + pending cards + `icp.updated_at` from the panel)
  instead of `tick`, so a poll reloads the list only when the list changed. Actions still reload after themselves.
- **50 rows at a time** ("Show 50 more · N of M"); filters reset the page.
- **Skeletons** (`components/panel/Skeleton.tsx`: `Skeleton`, `SkeletonRows`, `SkeletonCard`): the page draws its layout
  before the panel answers; the table shows grey rows; a hideable Firms section renders NOTHING while loading (no vanishing
  "Loading…" box on people lists).
- **Rail funnel from SQL**: the panel route adds one query over `person_funnel` (`lib/funnel-sql.ts::FUNNEL_COUNTS`, shared
  with /api/icp/overview) → `PanelPayload.funnel`; `RailFunnel` reads it, no kernel call. Not seen rendered (Chrome extension
  not connected). Not done: push updates instead of polling, transaction-mode pooling, a resident Python process.

### 5.cc /icp/[id] = "Next move": the list page as a journey, campaigns up front (2026-10-29, feat/icp-journey, app-only, no migration)

Amir, after a review of the list page from a seller's view (artifact PPVBdPekGPtSQbaq4o2p2N) and a plan for the journey
(1YQqmoBhZ99BhgGmFnvmXu): design A of three (canvas 4M96r1ZtXdfRzHBEpo7UrE: A Next move · B feed · C journey board), then
"add the campaigns to the front, and do it". The page now leads with what to do, not with a table.
- **Two views**, a segmented switch in the header: **Next move** (default; a badge = replies + drafts + requests waiting
  on a person) and **All people** (`?view=people`, the 2026-10-28 table + rail unchanged, Firms above it on a firm list).
  The machinery went behind **Agents ▾** (Leads Finder, Enricher, Warm routes, Outreach & intros, Activity, Who belongs
  → the old drawers) and **Settings** (seats, Export Excel, Edit who belongs, Pause / Resume, Archive, list settings,
  Firms on a people list, email waves). Nothing was deleted; the header lost its five buttons.
- **`GET /api/icp/[id]/journey`** (direct SQL, ONE client, ~12 sequential queries, ~3 s from a laptop, every lane
  capped at 50; contract `lib/icp-journey.ts`): lanes **answer** (LinkedIn thread `needs_reply` + `last_from_them` on an
  active account of the lead's owner, matched by person or member id, or an `email_threads` row in needs_reply; with the
  last line they wrote), **message** (accepted our request or 1st degree, has a profile, no conversation, not P5+; a
  pending LinkedIn `outreach` draft rides along), **send** (pending `connect` approvals), **follow** (P5_SENT with
  `next_followup_at` due or a pending `followup` draft; the thread id), **pick** (newest `kind='linkedin'` lookup
  ambiguous / candidates); counts (`send_ready` = profile, never asked, no request waiting; `fresh_profiles` = found in
  the last 5 h; no_profile, requests_pending, followups_timed, messaged_waiting); the connect cap left today
  (`lib/connect-quota-server.ts::connectQuota`, extracted from the leads route, which now uses it too); the last 24 h
  as events (replies, acceptances, messages one line each; requests / profile finds / runs folded into counts); the
  campaigns on the list (campaign_lists → enrolled, in sequence, sent, handed off, pending cards + the newest card id);
  the funnel (`FUNNEL_COUNTS`). Live on NRW at build: answer 1 (Jannik Bühring, replied today), message 50 (drafts
  ready), send 1, follow 17, pick 36; 23/25 requests used.
- **`heroFor()`** (pure, `lib/icp-journey.ts`) picks the ONE move: a reply → the people who accepted → requests waiting
  for a tap → queue today's requests (cap left, fresh profiles first) → follow-ups → picks → "owner has no LinkedIn"
  → "nothing waits on you" (with the next free request time). The hero card takes the lane's colour; "then: …" names
  the lane after it.
- **Queue** (`components/icp/journey/Queue.tsx`): one line per person with the one action. Approve / Skip / Send =
  `POST /api/agents/approvals` (the kernel gate; only the draft's owner — others see "<owner> decides"); **Send N now /
  Approve all N drafts** walk the lane one person at a time with an 8 s pause and a progress bar, stop on the first
  refusal or on "Stop after this one"; **Queue next N** = `POST /api/icp/[id]/connect` (files cards, sends nothing);
  Draft → `POST /api/sales-leads/[card]/outreach` (message lane, needs a card) or `POST /api/prospects/[id]/followup`
  (follow lane) → editable → Queue for the owner's approval; Skip clears the follow-up timer; Pick loads the candidates
  from `GET /api/icp/[id]/leads/[leadId]` and attaches one via `POST /api/prospects/[id]/find-linkedin`; Answer opens
  `/inbox?c=<channel>:<thread>`. Drafting / queueing / picking need owner-or-admin (act-as, audited, as before).
- **Right column, in this order: Campaigns on this list** (status pill, enrolled · in sequence · sent · handed off, "N
  cards wait for a tap →" to the card page, "New campaign" → `/campaigns/new?icp_id=` — the wizard pre-ticks that list),
  What happened since yesterday, In progress (requests waiting, profiles to find, messaged waiting, follow-ups timed,
  requests used in the last 24 h), Journey (one line, weakest step highlighted, "All N people ↓").
- **People under the journey** (Amir: "have some list in the page instead of clicking All people"): the same `LeadsTable`
  sits under the two columns with `pageSize={10}` (its footer has Show N more + a per-page select 10 / 25 / 50 / 100; the
  All-people view keeps 50) and reloads only on the panel's `leadsSignature`, like the full view.
- Lane colours are tokens (`--lane-answer/-message/-send/-follow/-pick` = the fill, same in both themes; `-text`
  variants pass 4.5:1 per theme). The old `CampaignsCard` in the rail is gone (the journey view holds campaigns).
- Not seen rendered by Claude: the Chrome check needed a local session cookie, which the permission classifier refused
  to materialise; the API was exercised against the real list, tsc + build are clean. Not built: design C (journey
  board) as a real view, a per-lane "snooze", email drafting in the message lane, the Telegram pick buttons.

### 5.cd Memory that carries over: agents that run, a shared chat MEMORY.md, a turn log that sees tools (2026-10-26, feat/agent-memory, no migration)

Amir, after "how many people accepted my LinkedIn request" took three tools and a muddled answer: "can we use Hermes built-in
memory? agents don't have memory which will use last run learnings." Plan `~/.claude/plans/glittery-watching-ember.md`.
- **The agents had not been running.** `outreach`, `attention`, `supervisor` `run_queue.py` and all three `review_queue.py`
  never loaded the env (a cron subprocess is sanitized), printed `{"error": "No database configured"}`, exited 0, and the
  model answered `[SILENT]` → Hermes recorded **ok**: Outreach 7/7 runs, Attention 5/5, Supervisor 5/5, every weekly review,
  2026-10-21..26. No agent profile had a MEMORY.md. Now every agent script's first call is `_cron.boot()` (profile `.env`,
  then the main one; `--check` = prove the DB is reachable), errors go through `_cron.agent_fail` (exit 1 → Hermes hands the
  model a "Script Error"), and `_shared/base-rules.md` says Script Error / `error` → `[CRON_FAILURE]`, never `[SILENT]`.
  `render_agents.py` runs every agent script with `--check` under `env -i` after rendering and **fails the deploy** if one
  cannot reach the database. Test `test_agent_scripts_load_env_first_and_fail_loudly` pins it.
- **Agent memory**: Leads Finder (20:45) and Enricher (17:30) review DAILY; Outreach weekly; Attention (Sun 08:00) and
  Supervisor (Sun 08:15) got memory + a review (`review_queue.py`: digest_state / commitments; proposals by action and
  outcome). Every run's work list carries `your_last_runs` (kernel `agents.last_runs`, last 3 `agent_runs`). Run jobs read
  MEMORY.md, only review jobs write it.
- **Chat bot MEMORY.md ON** (default profile; `memory_enabled true`, `user_profile_enabled false`, `nudge_interval 4`,
  `memory` in the telegram + api_server toolsets). ONE file for the whole team (Amir's decision): written only by Hermes'
  after-turn review fork and by an admin in a private chat — `role_policy.memory_guard` refuses everyone else (→ their own
  `crm_memory_save`), `target=user`, secrets (`refuse_shape`), entries > 600 chars and a teammate's personal preference
  (first name + prefer/always/never…). Fork detection `in_review_fork()` = thread "bg-review" + Hermes' thread tool whitelist
  (two Hermes internals; `test_contract_registry` asserts both). Every write audited `chat_memory_write`. `/admin/learning`
  lists MEMORY.md entries with **Remove** (`POST /api/admin/learning/memory-remove` → RPC `memory_entry_remove` → Hermes'
  own store). Deploy verify now REFUSES MEMORY.md off or USER.md on for the chat profile. MEMORY.md is frozen per session.
- **Turn log saw no tools**: Hermes wraps calls in a meta-tool `tool_call` (`arguments.calls[].name`); `turn_log.turn_shape`
  stored `["tool_call", …]` for every turn, so the nightly knowledge review could not see which tools a question took. Now
  unwrapped. `review_material` hands each miss the entries it was `given` (title + tool_hint); the reviewer rewrites a weak
  entry under the same title.
- **The screenshot's cause**: two seed entries pointed the question at different tools ("Who accepted" → pending_followups,
  "connection states" → connect_status). New entry **"How many accepted my requests" → `crm_outreach_kpis`** (`accepted` in
  the period, `accepted_total` overall incl. hand-sent); the other two now say what they are NOT for. Seeds are insert-only:
  the two edited bodies are updated by hand at deploy. Persona: one tool from the knowledge hint, a second only if its result
  lacks the answer, number first; MEMORY.md is the team's shared notebook, personal → crm_memory.

### 5.ce Sales-leads fresh start + campaign sender / approver of your choice (2026-10-30, feat/fresh-start, migration 093)

**LIVE 2026-10-30 (0.72.0, with §5.cd agent memory)**: 093 applied, ring + app deployed, cleanup applied: 780 cards removed, 28 lifted to
contacted, 112 open remain (75 contacted, 30 replied, 7 new). Backup on Amir's Mac: `~/.cache/salesbrain/backups/fresh-start-leads-20261030113932.json`.
Not yet seen live: a card sent to a named approver, a campaign sending from a chosen teammate.

Amir, after the meeting review: "yes, a fresh start of sales leads" (remove the cards nobody contacted, Fakuma's
included) and "campaign — make it flexible" (any chosen person approves, no consent step).
- **A sales lead = someone we contacted.** Cards come from a sent message / email, a reply, a person adding someone (Add
  lead, import, `crm_prospect_add`, Warm → Add as lead), the zeami.io form / Calendly. **A connection request is NOT contact
  and makes no card** (Amir); **firm research no longer makes cards** (`firms.land_firm_people`).
- **One-off** `python -m salesbrain_core.store.fresh_start_leads [--apply]`: removes every OPEN card with no evidence of
  contact (evidence = a met/sent/reply/call/meeting line, a sent non-connect approval, a reply, a booking, a demo request, a
  real meeting). `met_at` alone is not trusted: the VC import filled it with the list's name, "PEI Napa 2026 (attendee)" =
  only on the attendee list, "Did not meet". Puts the person's `priority` back (the delete trigger clears it), lifts statuses,
  refreshes the funnel; `--apply` writes a JSON backup to `~/.cache/salesbrain/backups/fresh-start-leads-*.json` first. Dry
  run 2026-10-30: 886 open → 780 removed (598 firm research, 80 Napa, 57 Fakuma, 44 VC import, 1 warm), 28 new → contacted.
  The Lead Conductor works from cards, so it has few left to send requests for.
- **Campaign `settings.send_from`** `{mode: owner | list_sender | back_office | front_office | person, user_id?}`
  (`policy/campaigns.pick_sender`): applied at enrollment; the owner keeps a person already written to or sent a
  request, and anyone whose chosen sender lacks EVERY channel the campaign uses (LinkedIn account / Gmail mailbox,
  `_can_send`); otherwise the person is handed over (`campaigns._hand_over`: prospect + contact owner, an `assign` line,
  unique clash = no move), so every gate works unchanged.
- **`settings.approve_by`** `{mode: sender | campaign_owner | person, user_id?}` → `campaign_cards.approver_user_id`
  (093, NULL = the sender) set when the day's card is filed. The approver sees it (`card`, `cards_waiting`), gets it on
  Telegram (`campaign_runner._post_or_update`) and may decide it; the sender can always decide their own; audit
  `campaign_card_decide` names the decider. No consent step from the account owner (Amir's decision). Card text adds
  "— they go out from X's account". App: Settings tab "Sends from" / "Approved by" (+ teammate picker with accounts,
  `GET /api/campaigns/options` → `teammates`), `SEND_FROM` / `APPROVE_BY` in `lib/campaigns.ts` mirror the policy.
- Tests: `tests/test_campaign_sender_db.py` (real Postgres), policy tests.

### 5.cf Funnel step "Connected": a request is not contact (2026-10-30, 0.73.0, app + core, no migration)

**LIVE 2026-10-30 (0.73.0)**: ring + app deployed, history corrected (265 entries removed, 17 re-dated, 66 Connected dated).

Amir: "if we didn't contact them, no; say Connected". `prospect_connected` sits between Ready to reach and Contacted
(`policy/funnel.py`, `lib/funnel.ts`, list cards, /dashboard): a 1st-degree connection (accepted request or existing)
nobody has written to. A pending or declined request stays `prospect_ready` with a substage. Contacted = a message, email
or intro ask. Steps are cumulative, so anyone contacted also counts as having reached Connected, even by email only.
Requests still join `funnel_cohorts` ("What converts" compares them), via `pf.requested`. One-off
`store/funnel_request_not_contact.py` corrected `funnel_events`. Demo-form people land on "Inbound: demo requests"
(`conductor.ensure_prospect_for_lead`), not a list named after the source. Conversion (contacted → opportunity) jumped
because the denominator shrank: earlier figures do not compare.

### 5.cd The daily LinkedIn connector — lists on the Lead Conductor's batch, warm paths first (2026-10-30, feat/daily-connector, core/hermes, migration 094)

Mateo on the 10-29 call: "every single day my agent goes into LinkedIn and connects 15 or 25 times with our target
market, mostly where there is already a connection — three mutual contacts and the person clicking yes is much more
likely." Amir: "let's start with 1". Before: the Conductor's daily batch drew only from /sales-leads cards; a list's
people were queued by hand ("Queue next N"); fit decided the order, never the path.
- **094**: `icp_profiles.daily_connect` off | card | auto; `connect_batches.mode` (card | auto, the 20-hour "already
  filed" guard is per mode, so a sender may have one of each a day) and `decided_by` (human | auto); policy
  `agents.conductor.list_connect` (default true, admin-editable from chat).
- **Order** (`policy/lifecycle.py::path_warmth`, used by `batch_pick`): a person's own priority → their list's (092) →
  a firm we already asked someone at waits → **mutual connections on record** (LinkedIn's `shared_connections_count`
  on `people.facets`, or stored `linkedin_mutual` edges of the sender) → **2nd degree** → 3rd / unknown → order →
  star → fit. A hand-set P1 still beats a warm 3rd. Caveat: `prospects.network_degree` was measured from the account
  that SEARCHED the person (often not the sender's); the send path now records the sender's own degree and shared
  count after its profile fetch (`invitations.note_profile_signal` from `outreach_agent._send_connect`), so the signal
  improves with every batch.
- **Kernel** `commands/conductor.py`: `list_connect_candidates` (ONE query over every active, unpaused list with
  `daily_connect` on: profile, not 1st degree, stage < P5, never touched, no request from the sender's or the holder's
  account, no card waiting, no thread, card not paused; reads `FROM leads` because `priority` is a card column) →
  `lifecycle_tick` fills the sender's `card` pool after the sales-lead cards (a person on a card is never picked
  twice) and an `auto` pool of its own; the card batch takes the day's room first. `file_connect_batch(owner, ids,
  mode)`: a person held by a teammate is **handed to the list's sender** first (`_hand_prospect`: prospect + contact,
  an `assign` line when a card exists; a unique clash leaves them), then `propose_connect` per person as before;
  `mode='auto'` inserts the batch as `approved / decided_by 'auto'`, decides every approval as the owner and returns no
  card event. `_batch_card_text` shows "· 3 mutual" / "· 2nd degree", the list, and "N of M share a connection with you".
  `icp_owner.set_daily_connect` (owner or admin, audit `icp_daily_connect`; answers who sends and whether they have
  LinkedIn / Telegram). `conductor_status.daily_connect_lists`.
- **Ring**: `lead_conductor.py` sends an auto batch inline, paced 8–16 s per person (the step is its own process with
  a 25-min budget; 25 requests ≈ 5 min), summary DM to the sender (own DM or nothing), `auto_sent` in the run detail;
  card batches unchanged. Tool `crm_icp_daily_connect {icp_id, mode}` (mcp=None, withheld from the catalogue; the
  persona confirms with the person before 'auto'). Knowledge entry "Daily LinkedIn connector". Sender = the list's
  sender seat, else back office, else owner — the journey page's "sender" now says the same.
- **App**: `components/icp/DailyConnectControl.tsx` (Off · Ask me each day · Send automatically; 'auto' asks once
  more and names whose account sends) in the list page's Settings drawer and inline in the journey's "In progress"
  card, with the sender's last batch ("card waiting for Mateo's tap (12)", "automatic: 15 sent 2 h ago");
  `POST /api/icp/[id]/daily-connect`; the journey payload carries `icp.daily_connect` + `sender.last_batch`.
- **Live facts at build (read-only check of the candidate query on production, standing in for the column)**:
  Mateo's ten cohort lists hold 1,071 people the connector could ask (715 of them 2nd degree, 1 with a stored mutual
  count); 636 are held by teammates / the Zeami service stub today and would move to Mateo as they are filed.
  Mateo's LinkedIn (Sales Navigator, connected 10-27, 93 pending requests on the ledger) → cap 25/day, 120/7 d. He has
  NO Telegram link: in 'card' mode his card waits on the list page / Agents; 'auto' needs no tap. Query 2.6 s from a
  laptop.
- **Rollout** (integration session): apply 094; deploy ring + app; then per list, on /icp/[id] → Settings (or
  `crm_icp_daily_connect`): Mateo decides card vs auto; set the list's sender seat where it is not Mateo. Nothing
  changes until a list is switched on. Tests: `test_lifecycle.py` (warmth order, P1 beats warm, touched firm waits),
  `test_conductor_db.py` (list fill warm-first + hand-over, auto batch approved + per-mode guard, setting is owner or
  admin) on a scratch Postgres.
- Not built: a per-list "how many a day" (the cap and `connect_batch_size` 10 decide; raise the size for Mateo's
  15–25), a note template per list (requests go without a note), Telegram buttons on the auto summary, a Workspace
  card line per list, the degree re-measured from the sender's account before sending (one profile fetch each).

### 5.cg Nobody new could link Telegram from 2026-10-16 to 10-30 (fixed 0.74.1, no migration)

Mateo sent `/start LINK-…` five times with no answer; the log said `Blocked unauthorized user 459013873`. The 0.50.0 setting
`unauthorized_dm_behavior: ignore` (strangers get silence) also makes the Telegram adapter's INTAKE FILTER
(`_is_user_authorized_from_message`) drop every unauthorized DM before `pre_gateway_dispatch`, so `_link_inner` and
`_sync_access` never ran for anyone not already allowed. §5.al's "the link hook runs before authorization" checked only the
later gate in `gateway/run_inbound.py`. Also locked out: Hannes (active link since 08-10, in neither the allowlist nor the
pairing store). Now the setting is `decline` (passes the filter; deploy verify refuses anything else) and
`board_hook._silence_stranger` drops strangers after linking + access sync, using the gateway's own
`_is_user_authorized_for_source`. If the hook fails, a stranger gets one decline line, never a pairing code. Lesson: test an
access change by sending a real message from an unknown account, not by reading one gate.

### 5.ch The trust score — one 100-point rank, and the trust-research agent (Mateo's "agent 2") (2026-10-31, feat/trust-scoring, migration 095)

From Mateo's playbook T1 and the 2026-10-30 call: "fit alone did not convert; the trust path and authority decided", "not
just business value but trust value, then a proper research on this person". What the data said on 31 Oct: 248 warm/hot
ties, all 45 warm people on lists already engaged; outreach answers only when warm (own network 5/10 answered, a bare
request 7/214); the fit score did not predict answers; 24 mutual edges, 0 intro requests ever. Amir's decisions: ONE rank
(the cohort score folds in as the fit part and is no longer shown); research = free sources for everyone + Gemini Google
grounding (~3.5 c each) only for warm / connected / prioritised people, ~150 a night; ✓ / ↓ moves the person at once, the
weekly review PROPOSES weights, a person applies; the P&L-owner / not-manufacturing rule applies to every list, NRW too.
Plan `~/.claude/plans/quirky-finding-lemon.md`.
- **The score** (`policy/trust_score.py`, pure; `lib/trust.ts` mirrors labels/bands, `test_trust_parity.py`):
  authority 30 (the cohort's role tiers via `cohorts.person_fit`; research may confirm `full` or demote `low`) ·
  warmth & trust path 30 (max of our own tie by `person_warmth` band hot 1.0 / warm 0.7 / cool 0.3, a route through a
  stored `linkedin_mutual` / `email_cothread` connector × how warm we are with them (cap 0.8), mutual connections 3+ 0.35
  / 1–2 0.25, a bare 1st degree 0.3) · market & P&L fit 20 (60 % the cohort company verdict `company_fit`, 40 % a
  P&L-owner role; a manufacturer not also distributor/forwarder/software/services keeps 40 % of the company part) ·
  openness & speed 20 (weighted signals, summed, capped: company verdict signals + person research signals new_in_role,
  entrepreneurial, interim_or_exit_mandate, posts_on_ai, modernisation_mandate). Also `value_to_us` (buyer | connector |
  both | none), `multiplier` = people on our active lists this person is connected to, `held` = Σ of each teammate's
  LATEST ✓ (+8) / ↓ (−15). A hand-set `leads.priority` still sorts first everywhere. Bands top ≥ 70 · good ≥ 50 · fair ≥ 30.
  Weights + limits in `policy_rules['agents.trust']` (admin-editable from chat, `admin_policy`); per-list overrides in
  `icp_profiles.criteria.trust_weights`.
- **095**: `trust_scores` (one row per lead: total, the four parts, held, why, trust_kind / via / hops, value_to_us,
  multiplier, signals, research jsonb + researched_at + research_tier), `score_feedback` (every click kept),
  agent_definitions `trust_research`. `cohort_scores` keeps the company verdict and the sort placement.
- **Kernel** `commands/trust.py`: `load_facts` (ONE query over leads / contacts / accounts / account_profiles /
  cohort_scores / people.facets / person_warmth / person_edges / linkedin_invitations / score_feedback), `rescore`
  (pure recompute + upsert; runs at the end of EVERY `funnel.refresh`, so hourly with the Lead Conductor, and after
  research / feedback / tuning), `trust_score` (one person, readable by every teammate), `feedback` (any teammate; the
  SERVICE actor refused; audited `score_feedback`), `tuning` / `apply_tuning` (`policy/trust_tuning.py`: per part,
  mean fraction of the ✓ people vs the ↓ people, lift ≥ 1.3 raises ×1.25, ≤ 0.77 lowers ×0.8, rescaled to 100; needs 6
  marks with 2 on each side; owner or admin applies, audited `trust_tuning_apply`), `research_plan` (per list sender:
  not researched in `restale_days`, list priority → person priority → warm / connected / 2nd degree → contacted → fit;
  `tier` grounded for warm / connected / prioritised / 2nd degree up to `grounded_per_run`), `save_research`
  (`clean_research` bounds everything; a tenure under 18 months infers `new_in_role`), `status`.
  **Blue fix** (`warm_paths.blue_map`): a 1st-degree connection on the owner's live account with no chat is reachable
  (channel linkedin, thread NULL, `first_message: true` — the new-chat lane sends it); Mateo's Marius Fiedler case.
  The Conductor's `_LIST_SQL` and card facts rank by `COALESCE(ts.total, icp_score)`. `AGENTS` gains `trust_research`.
- **Ring**: `trust_research.py` — per person: ONE `profile_view` on the sender's account (guard-bound, `profile_fetch_per_run`
  60, a safe-rate refusal stops fetching for the night; facets written like `route_expand`), one keyless DuckDuckGo
  search, for grounded people one `llm.grounded()` (feature `trust_research` → `llm_usage`), then one Flash `converse(json_mode)`
  per 8 people → research JSON → `save_research` → digest to the sender (source `trust-research`, own DM or nothing).
  **Agent profile `agents/trust-research/`** (Flash; `run` 01:30 nightly = `run_queue.py` gates kill switch /
  `agents.trust.enabled` / `runs_per_day` and opens one run per sender; `review` Sunday 08:30 = feedback vs parts,
  research outcomes → ≤ 5 MEMORY lessons). Tools: `crm_trust_research_batch` (agent-only), `crm_trust_score` (read,
  on MCP), `crm_score_feedback` (write; refused unattended and in agent runs — `role_policy`, `agents_runtime`),
  `crm_trust_tuning` (read), `crm_trust_apply_tuning` (owner/admin, mcp=None), `crm_trust_status`, `crm_trust_rescore`
  (admin). App-only RPC `trust_research_one` = "Research now" on the person page. Knowledge: "Trust score: how a person
  is ranked", "Rank X lower"; persona section "The rank". 178 tools.
- **App**: `components/ScoreBadge.tsx` (the pill; click = four bars + why + path + ✓ right / ↓ lower →
  `POST /api/prospects/[id]/score-feedback`) on the list's leads table (replaces the cohort pill), /prospecting (replaces
  the fit badge when scored), /sales-leads rows (+ sort "Best score first"), the journey queue (small number) and the
  person page header; `components/prospect/TrustCard.tsx` "Who they are to us" (parts, path, research facts with sources,
  feedback history, Research now → `POST /api/prospects/[id]/trust-research`, act-as the owner for an admin);
  `components/icp/TrustTuningPanel.tsx` under "Who belongs" on the list page (`GET/POST /api/icp/[id]/trust-tuning`).
  Every list / queue / export query joins `trust_scores` (`lib/trust-server.ts` TRUST_COLS; before 095 the old order
  stays) and orders `priority NULLS LAST, ts.total DESC NULLS LAST, …`; the Excel prospects / ICP sheets gain Score ·
  Authority · Trust path · Market fit · Openness · Why ranked · Via · Value to us · Knows on lists.
- **Rollout (integration session)**: apply 095; deploy ring (renders the profile) + app; `crm_trust_rescore` once
  (no cost) so every list re-sorts; check `llm_usage` feature `trust_research` and the guard after the first night.
- Not built: the agent 3 network value-matching (needs a financial data provider), a note template / sequence design,
  Telegram buttons for ✓ / ↓, learning the weights automatically (Amir chose propose + apply).

### 5.ai Zeami brand UI — foundation (2026-10-03, feat/ui-improvement, app-only)

The app now wears the Zeami brand basics (`docs/brand/zeami-brand-basics.md`): light product style by default,
obsidian as the dark theme, Poppins + JetBrains Mono (`next/font`, variables on `<body>` — `<html>`'s class belongs
to the theme script), the supplied H12 wordmark (`components/ZeamiLogo.tsx`, `ZeamiStar` for the rail; never retype it).

- **Tokens** (`app/globals.css`): same names as before (`--bg`, `--bg-card`, `--bg-input`, `--border`, `--text`,
  `--text-muted`, `--accent`, `--accent-glow`, `--green/--yellow/--red/--orange`) plus **`--accent-fg`** (text on a solid
  accent or status fill: white in light, obsidian in dark — never write `#fff` on `var(--accent)`), `--accent-soft`,
  `--highlight`, `--logo`, `--blue`. Status tints are `color-mix(in srgb, var(--red) 10%, transparent)`, not literal rgba.
  Primitives `.z-card`, `.z-input`, `.z-btn`, `.z-eyebrow` exist for the page-by-page pass.
- **Sidebar**: grouped, labelled nav (Pipeline / Prospecting / Relationships / Funding / Insights / Admin; Profile,
  theme and collapse at the foot). 224px on lg+, icon rail below lg or when collapsed (`salesbrain-nav-collapsed`).
- Gate fills: heather `#6C477D`, board gates deep plum `#691C47` (fixed hexes: white header text sits on them).
- **Contrast is computed, not eyeballed**: every status token (`--red/--green/--yellow/--orange`) and category token
  (`--cat-blue/-violet/-teal/-pink`) passes 4.5:1 as small text on `--bg`, `--bg-card`, `--bg-input` and on its own
  10–28% tint, in both themes. Badges tint with `color-mix(in srgb, ${color} 14%, transparent)` — never `${color}20`,
  which breaks on a `var()`. Decided by Amir 2026-10-03: product name stays SalesBrain; grants / ChipChip pages get
  the same Zeami look; errors must always be clearly visible.
- Not done yet: per-page layout/UX pass (shared page header, cards at 16px radius, pill buttons, empty/loading/error
  states), the cytoscape canvases (`NetworkGraph`, `RouteGraph` still use literal dark-theme colours); `LeadsTable` + `ApprovalsPanel` were left
  untouched for ws-linkedin-connect.

### 5.bj Gmail push — replies within seconds (2026-10-22, feat/gmail-push, no migration)

**LIVE 2026-10-22 (0.63.0)**: ring deployed (smoke 0.63.0), app on Production (run 39842137712). Watch registered for the one active sender (amir@zeami.io); the endpoint refuses calls without Google's token (401). Not yet seen live: a real Google push.


Amir: "can't we have a webhook listening to the inbox?" Before, replies to wave / campaign emails were found by the
`email-replies` cron (`20,50 7-23` Addis), so up to 30 minutes late and not at night. Now Gmail tells us.
- **Google side** (project `salesbrain-512414`, done by Amir 2026-10-22): Pub/Sub topic
  `projects/salesbrain-512414/topics/salesbrain-gmail-replies`, `gmail-api-push@system.gserviceaccount.com` = Pub/Sub
  Publisher on it (the zeami.io org's Domain Restricted Sharing policy blocks that grant: override it on the PROJECT,
  grant, then set it back to "Inherit parent's policy"), a push subscription to `https://salescrm.chipchip.social/api/gmail/push`
  with authentication = a service account of the project (audience = that URL).
- **App**: `lib/gmail-send.ts::watchMailbox(userId)` = Gmail `users.watch` (INBOX) on `GMAIL_PUSH_TOPIC` (skipped when
  unset); called after a sender connects (`lib/google-connect.ts`) and by bridge tool `gmail_watch`. `POST /api/gmail/push`
  (whitelisted in middleware) verifies the OIDC token (`lib/google-oidc.ts`: Google's JWKs, RS256, issuer, audience
  `GMAIL_PUSH_AUDIENCE` or `<APP_URL>/api/gmail/push`, AND email = `GMAIL_PUSH_SA` — any Google service account can mint a
  token, so the account check is what makes it ours), answers 204 at once, then runs app-only RPC `email_replies_check`
  for that mailbox (one run at a time per mailbox, one more if a notice came in during it). Env `GMAIL_PUSH_TOPIC`,
  `GMAIL_PUSH_SA` (GitHub secrets → deploy.yml).
- **Ring**: the cron's logic moved to `salesbrain_hermes/email_replies.py` (`check(only_sender)`, `renew_watches()`); the
  cron stays as the safety net and renews every mailbox's watch each run (Google ends a watch after 7 days).
  `record_email_inbound` is idempotent on the Gmail message id, so push + cron never double-count.
- Tests: `scripts/test-google-oidc.mts` (12 checks, throwaway RSA key), `salesbrain-hermes/tests/test_email_replies.py`.
- Not built: opens / clicks (emails stay plain text on purpose), a campaign Activity tab, out-of-office filtering.

### 5.bl The Inbox — every outreach conversation, email + LinkedIn, answered in one place (2026-10-24, feat/inbox, migration 082)

**LIVE 2026-10-24 (0.64.0)** with §5.bk–§5.bm: 082 applied (5 sent emails backfilled), ring deployed (smoke 0.64.0), app on Production (run 40109339138). Sidebar notes of both other branches applied at merge (Clients, People, Discovery off the menu).

Amir (after Guhan's Inbox): "sync the inbox in our sequencing activities — email and LinkedIn". Decisions: replying from
the Inbox SENDS (pressing Send is the sender's decision, like the follow-up Send button); email = only threads a
SalesBrain email started (no general Gmail).
- **Core 082**: `email_threads` (one per mailbox + Gmail thread: prospect, person, counterpart, subject, last message,
  `last_from_them`, `state` needs_reply | waiting | done, `inbox_seen_at`) + `email_messages` (every message, ours and
  theirs, plain-text body with the quoted history cut off; unique on the Gmail id); `linkedin_threads.inbox_seen_at`;
  backfill of every email already sent. LinkedIn needs no new store (the 024 mirror).
- **Kernel** `commands/inbox.py`: `store_email_thread` (idempotent; returns `new_inbound` = Gmail ids seen for the
  first time; a message from them reopens a thread marked done, our own does not), `prepare_reply` (ONLY the
  mailbox / LinkedIn account owner; files an APPROVED `followup` approval, `drafted_by='inbox'`, expires the person's
  pending drafts on that channel, email = same thread + `Re:` + In-Reply-To + the sender's signature),
  `pending_replies`, `mark`. `waves.record_email_sent` stores our message; `waves.threads_to_check` now keeps reading
  a thread after the first reply (activity in the last 45 days, inbox replies included) — the reply notice and
  stage logic only run for messages seen for the first time.
- **Ring**: `email_replies.check` reads threads with `full: true` and stores every message; `inbox_reply.py`
  (`reply` = prepare → send gate → Unipile / Gmail bridge → `mark_approval_result`; a LinkedIn send re-reads that chat
  so the message shows at once; a gate hold — quiet hours, a cap — leaves the approval approved and
  `send_pending` in the email-outbox cron sends it at the next window). App-only RPCs `inbox_reply`, `inbox_refresh`
  (180 s class).
- **App**: `/inbox` (`components/inbox/{ConversationList,ConversationView,ChannelIcon}.tsx`): search, All / Email /
  LinkedIn, All · Needs reply · Unread · Done, "Outreach only | All LinkedIn chats", admin "Mine | Whole team" (read-only
  for other people's accounts), bubbles by day, Mark done / Reopen / Refresh / Open lead / Profile, a reply box
  (⌘/Ctrl+Enter), polled every minute. Reads are direct SQL (`lib/inbox-server.ts`, one client): a LinkedIn chat is
  "outreach" when its member id or its person's slug matches a prospect, or a SalesBrain message went into it.
  `GET /api/inbox`, `/api/inbox/count` (sidebar badge), `GET|POST /api/inbox/{email|linkedin}/{id}`. Gmail bodies:
  `lib/gmail-send.ts::readThreads(…, {full})` + `lib/email-text.ts` (`stripQuoted`, tested by
  `scripts/test-email-text.mts`). `/sales-leads?q=<name>&open=<lead id>` opens a lead's card. Sidebar: an Inbox entry
  under Pipeline with the needs-reply count (a smaller sidebar was tried and reverted on Amir's word — size unchanged). Ad connectors left the sidebar (Amir): reached from the Marketing page's "Ad connectors" settings button; `/marketing/connectors` has a ← back to Marketing.
- Tests: `salesbrain-core/tests/test_inbox_db.py` (6, real Postgres), `salesbrain-hermes/tests/test_inbox_reply.py`,
  `test_email_replies.py`; the API was walked on a scratch database through a real login (lists, team view, open marks
  seen, a reply on someone else's account refused through the real ring process, done / reopen, 401).
- Not seen live yet: a real reply sent from the Inbox (LinkedIn and Gmail), the page in a browser. Not built: WhatsApp,
  attachments, a per-message read state, drafting a reply with the model from the Inbox.

### 5.bm /discovery retired; paste a list and add people to one prospect list (2026-10-24, feat/discovery-merge, no migration)

**LIVE 2026-10-24 (0.64.0)** with §5.bk–§5.bm: 082 applied (5 sent emails backfilled), ring deployed (smoke 0.64.0), app on Production (run 40109339138). Sidebar notes of both other branches applied at merge (Clients, People, Discovery off the menu).

Amir: "what does /discovery do — is it up to date — it doesn't need its own menu." It was the April 2026 paste box: rows went
straight into SQL as P0 prospects with no ICP, no score, no /sales-leads card (so the Lead Conductor never saw them), weak
dedup and a comma-split CSV parser; its footer promised guards that do not exist. Its jobs now live on existing pages.
- **Gone**: `app/discovery/`, `app/api/discovery/bulk-import`. The Sidebar line (`components/Sidebar.tsx`, owned by ws-inbox)
  is removed at merge time. `exec_create_or_import_prospect` stays (`POST /api/prospects` uses it).
- **/sales-leads → Import a list** has a **Paste rows** tab next to the file upload: rows copied from Excel / Sheets
  (tab), or comma / semicolon text, go through the same column matching, Check and kernel import
  (`POST /api/sales-leads/import` multipart field `text`).
- **/icp/[id] → Leads → Add people** opens the same dialog bound to the list: kernel `import_sales_leads(icp_id=)` checks
  owner-or-admin and an active list, uses the list's name as `list_name`, the list owner as default back office and as owner
  of the new prospects, which land on that list (`conductor.ensure_prospect_for_lead(icp_id=)`) and are scored against it.
  A person who is already a prospect stays on their list (`added_to_list` counts only the new ones). Ring
  `crm_sales_leads_import` + service MCP take `icp_id`. `GET /api/sales-leads/import` = the teammate pickers
  (`TEAM_USERS_SQL` in `lib/sales-leads-sql.ts`, shared with the list route).
- **Two bugs fixed on the way (both live before this)**: a UTF-8 CSV upload came out as Latin-1 ("JÃ¶rg MÃ¼ller") because
  SheetJS got bytes — .csv/.txt/.tsv and pasted text are now decoded as UTF-8 first (BOM stripped); and the dialog treated
  the summary's `error` COUNT as a failure, so any file with one unimportable row showed "1" and could not be imported.
- Tested: core 629 (scratch Postgres via the `@embedded-postgres/darwin-arm64` npm binaries in the scratchpad: no Postgres
  server is installed on Amir's Mac), ring 357, tsc + build, and the dialog clicked through on 127.0.0.1:3003 against that
  database (paste → map → check → import into a colleague's list as admin). Not done: bulk "Enrich selected" on /sales-leads.

### 5.bp Campaigns round 2 — deliverability, A/B variants, trusted auto-send (2026-10-26, feat/campaigns-r2, migration 084)

**LIVE 2026-10-26 (0.67.0)**: 084 applied (66 addresses seeded into `email_verifications`, connect caps 15/75), ring deployed
(smoke 0.67.0), app on Production (run 40332524948). `deploy-server.sh` used to leave an EXISTING cron job on its old schedule
(email-outbox stayed `*/10 8-19`); it now passes `--schedule` on every run, and email-outbox was edited to `*/10 5-23` by hand.
Not yet seen live: an auto-approved card, an OOO reply parking a sequence, an email held as unverified, the new UI in a browser.

The 2026-10-26 audit against Lemlist / Smartlead / Instantly / Outreach / Apollo (plan `~/.claude/plans/delegated-toasting-cookie.md`):
the approval model and one-person-per-company were ahead of the field; mailbox health, sequence design and four bugs
were behind. Amir chose all of: ramp-up + bounce pause, verify at send + out-of-office, recipient-timezone window
Mon–Fri + business-day waits, the bug fixes, A/B variants (manual winner), "trust after N approvals" per campaign.
- **Trusted auto-send** (per campaign, OFF by default; `campaigns.settings.auto_send {enabled, trust_after 1..10}`,
  Settings tab). `policy/campaigns.trust_state`: the step's cards for one sender, newest first — `trust_after`
  consecutive HUMAN approvals with no skipped card, no edited draft, no dropped draft = trusted; any of those is a
  reset; system-approved cards count as nothing. Kernel `auto_approve_cards` (service; runner calls it right after
  filing, before posting): card → approved, `campaign_cards.decided_by='auto'` (084), email drafts decided for the
  outbox, LinkedIn drafts sent in the same pass (`claim_card → send_card`); REFUSED when a draft has `check_flags`
  or an un-overridden `company_conflict` (a person decides), or the kill switch is off. Telegram: the card is posted
  as "🤖 sent without a tap" with ONE button `cg:<id>:pause` → `pause_auto_send` (owner / sender / admin). Results
  tab: per step "trusted" / "2 of 3 approvals · reset <date>" chips (`campaign_trust`). **`decide_outreach` now
  refuses a campaign-card draft unless `from_card=True`** (decide_card, auto_approve, send_card pass it): /agents and
  `crm_outreach_decide` can no longer approve one line of a card and bypass the card + the trust count; `/api/agents/
  approvals` leaves campaign drafts out of the pending list.
- **A/B variants** on message steps: `config.variants [{id a|b|c, label?, mode?, text?, subject?, instructions?}]`
  (2–3; each inherits what it does not set — `policy.variant_for`), `config.winner`. `validate` checks every variant
  like a message ("variant B: …"). `pick_variant(enrollment, node)` = winner, else sha1 split (stable per person).
  `outreach_approvals.campaign_variant` (084); `path` `sent` entries carry `variant`; `results()` gives
  `variants[] {sent, replied_after, reply_rate, winner}` per step and the "reply anywhere" hand-off now credits the
  last sent step (`outcome_kind: replied` + `after` + `variant`) — replies no longer vanish from the step counts;
  `totals.replied` counts each person once. `set_variant_winner` (owner/admin; live + draft graph, no publish needed).
  App: StepInspector "A/B test" section (Split into A/B, per-variant mode/text/subject/instructions, label, remove),
  canvas badge "A/B · 2" / "A/B · B", Results rows per variant with **Make winner** / **split again**; samples are
  keyed `<node>:<variant>` (`lib/campaigns.sampleSlots`); Test run writes one per variant.
- **Mailbox ramp-up + bounce pause** (`policy/mailbox.py`; `email_senders.ramp_started_at / ramp_skipped / paused_at /
  pause_reason`, `outreach_approvals.bounced_at`; `outreach.email.ramp [5,10,20]` per week, `bounce_pause_rate 0.05`,
  `bounce_min_sends 20`, `bounce_window_days 7`). `waves._health`: cap = min(own cap, policy, ramp cap); `outbox()`
  skips a paused mailbox and PAUSES one over the bounce rate (audit, DM `email-outbox`, `fallback=False`);
  `sender_resume` (owner / admin), `sender_update(ramp_skipped, user_id)` (admin). Profile → Google: ramp line,
  bounces (7 d), paused banner + Resume, admin "Skip the ramp"; team list shows ramping / bounced / paused.
  amir@zeami.io (connected 2026-10-22) is inside the ramp after the deploy — skip it if that mailbox is warm.
- **Verify at send** (`email_verifications` 084: deliverable | catch_all | invalid | unknown; seeded from verified
  handles, replies and bounces). Writers: `enrichment.set_prospect_email` (provider verdict), `waves.record_verification`
  (ring `email_verify.mx_check`: syntax + MX via dnspython or `dig`; no MX → invalid + suppression; a DNS error is
  never invalid), a reply → deliverable, a bounce → invalid. Gate in `email_outbox.py` before the send gate:
  `policy/waves.verification_verdict(status, allow_unverified, outreach.email.unverified)` → send / hold
  (`hold_unverified`: approval stays approved, enrollment "email not verified", looked at again tomorrow) / fail.
  Per campaign: `settings.allow_unverified` (Settings tab). Inbox replies are exempt (they answer someone who wrote).
- **Out-of-office** (`policy/replies.py`: RFC 3834 / X-Autoreply / Precedence headers — `gmail-send.ts` returns them
  as `auto_headers` on a full read — then EN/DE subject + body phrases, `return_date`). `record_email_inbound`:
  an auto-reply is stored (`email_messages.auto_reply`, the Inbox keeps the thread `waiting`), never `record_reply`;
  campaign enrollments are parked (`hold_for_auto_reply`, due = the day after the return date, else +7 d) and a wave
  cadence timer is pushed the same way.
- **Send window** (`policy/timezone.py`: `zone_for` over prospect location / account HQ — countries, US states/cities,
  DE cities and LinkedIn metro labels; `person_zone`; `send_window_ok`; `add_business_days`; `outreach.quiet_hours`
  + `recipient_local true`, `weekdays [1..5]`; `agents.campaigns.business_days true`). `check_quiet_hours(conn, now,
  zone)` is called with `policy/outreach.person_zone(person_id)` from `check_outreach`; campaign `wait` steps count
  business days (a `wait_for` "give up after N days" stays calendar days — the weekday window holds the next send
  until Monday) and the email-outbox follow-up hour uses the policy zone; the `email-outbox` cron now
  runs `*/10 5-23` so a Berlin or US-East morning is reachable from Addis (the kernel window decides).
- **Bugs fixed**: campaign email follow-ups carry `Re: <first subject>` (`_reply_subject`; were sent with an empty
  subject, unthreaded); email drafts keep their paragraphs (`lead_drafts.clean(keep_paragraphs)`); `wants_out` =
  word boundary, ≤160 chars, bare "stop" only as the request itself; free-account connect caps 15/75 everywhere
  (084 seed + `policy/invitations.DEFAULTS`, the 073 comment was right and the code wrong).
- Tests: `test_campaigns_r2_policy.py` (14), `test_campaigns_r2_db.py` (9, real Postgres), ring
  `test_campaigns_r2_ring.py` (6); all suites green. Not seen live: a real auto-approved card, a real OOO, a real
  held-unverified email, the pages in a browser. Not built: a People-tab "next send: Mon 09:00 Berlin" line, A/B
  auto-winner, warm-up, List-Unsubscribe, domain health, reply sentiment.

### 5.bd Brand & Voice, and learning from every correction (2026-10-21, feat/brand-voice, migration 079)

**LIVE 2026-10-21 20:25 Addis (0.58.0)**: 079 applied, ring deployed (crm_brand on telegram, api_server, cron; smoke OK), app on Production.
**One brand (2026-10-21, Amir: "we don't need ChipChip")**: migration 080 removed the seeded chipchip row (applied); every list writes under Zeami.

Amir, after the Guhan teardown (`docs/research/04-guhan-competitor-map.md`): "build the voice — how we intend to interact —
and whenever we correct it, learn from it." Decisions: (1) a learned rule lands in the writer's OWN voice and is live at once,
no admin approval (sharing with the team is live too; anyone can archive their own, admins anything); (2) every draft is rated
**1–10 with the reason why**; (3) edit and rate in Telegram AND on the web; (4) the whole of Brand & Voice in one round.
Plan: `~/.claude/plans/brand-voice-learning.md`.
- **Data (core 079)**: `brands` (zeami, chipchip: description, pain points, tone of 7, formality formal|informal|auto,
  language, `never_write[]`, word `limits`, `ai_drafted`), `products` (pain, case studies with a number, free resources with an
  optional URL, objection answers), `competitors`, `message_templates` (guided | fixed), `icp_profiles.product_id /
  writing_context / language`, **`voice_rules`** (scope sender | team | list, kind rule | never_write, channels/steps, source
  stated | edit | rating | shared | weekly | app, evidence {approval_id, before, after, rating, reason}, confirmations,
  superseded/archived, never deleted), `outreach_approvals` + `draft_original, drafted_by, voice_rule_ids, check_flags,
  edited_at/by, edit_ratio, rating 1–10, rating_reason, rated_by/at, learned_rule_ids`, `telegram_pending_inputs`, policy
  `agents.voice`. A list's brand: its product's brand → `icp_profiles.product` when it names a brand key → zeami.
- **Kernel**: `policy/voice.py` (pure: `check_draft` = never-write with umlaut folding, de/en language, du/Sie, word cap;
  `edit_ratio`; `classify_feedback` → learn | golden | none, "wrong person" is targeting not voice; `render_context` team →
  list → sender, "the sender's own rules win"). `commands/voice.py`: `writing_context`, `check`, `stamp` (every propose path:
  `propose_outreach`, `propose_first_message`, `propose_connect` take `voice={draft_original, drafted_by, voice_rule_ids}`),
  `edit_draft` (pending only; keeps the model's text), `record_feedback`, `learn` (twin → confirmations+1, `replaces_id` →
  supersede, cap 40/sender), rules add/forget/share/list, `stats`. `commands/brand.py`: brand/product/competitor/template CRUD
  (any user, audited; the service actor never writes), `set_list_voice`, and `criteria_plus_competitors` — every
  `score_and_label` call goes through `_score(conn, …)` so a competitor's employees are never prospects. Wave edits keep the
  original too. The approval card shows "⚠️ Check: …" and "✏️ Edited".
- **Ring**: cards get **✏️ Edit** (ForceReply; the reply is caught in `board_hook._voice_reply_inner` before any model turn,
  `edit_draft`, card re-rendered). After 👍/👎: **"Rate this draft 1–10"** → reason chips or a typed reply →
  `voice_feedback.feedback_and_learn`: one cheap `converse(feature='voice_learn', json_mode)` extracts ≤2 rules, kernel
  `learn` stores them in the SENDER's voice, "🧠 Learned for your voice: … [↩️ Undo]". callback_data `oa:<id>:edit`,
  `vr:<id>:<1-10>`, `vy:<id>:<reason>`, `vu:<rule>`. **Fixed on the way: `telegram_buttons.PATTERN` never allowed
  `approve_anyway`, so "Send anyway" (071) taps never reached the handler.** Family **`crm_brand`** (16 tools; five reads on
  the MCP catalogue) on telegram, api_server, cron and the Outreach agent. Drafters now write in the voice: lead conductor
  (a draft breaking a checked voice rule is dropped like any other broken rule), `crm_linkedin_draft_reply` (returns `voice`),
  Outreach skill / rulebook / routine prompt, prospecting skill, SOUL ("HOW messages are written is the VOICE, not memory").
  `role_policy._READ` gained context/rules/stats/check so a teammate's automation may read the voice.
- **App**: `/brand` (Sidebar → Prospecting): Brand (tiles + **Draft from website** — shows the suggestion, fills only empty
  fields, marks them AI-drafted), **Voice** (Your voice: sent-unchanged %, average rating, rules learned, each rule with
  "learned from your edit" + the before/after, Forget / Share with team; the team's tone, du/Sie, language, never-write chips,
  word limits; team rules), Products, Competitors, Templates. `lib/voice-context.ts::draftInVoice` = context → model →
  kernel check → one redraft → `{message, voice, flags}`; used by the follow-up, lead-card and intro drafters, whose panels
  send `voice` back on propose. `components/voice/{DraftEditor,DraftFeedback}` in ApprovalsPanel and /agents (✏️ Edit, rate
  after a decision, "Rate recent drafts" = `GET /api/agents/approvals?rate=1`). ICP builder: "What this list pitches"
  (product, hook, language → `PATCH /api/icp/[id]/voice`). Routes: `/api/brand`, `/api/brand/[key]` (+`/suggest`),
  `/api/drafts/[id]` (edit | feedback), `/api/voice/rules`, `/api/voice/rules/[id]`, `/api/voice/stats`.
- **Service MCP**: `crm_voice_context`, `crm_voice_check`, `crm_draft_feedback`, `crm_voice_rules`, `crm_voice_rule_add` (always
  the employee's OWN voice — scope/brand/icp are stripped).
- Verified: migration 079 + every new query ran on the live schema inside a transaction that was rolled back (2026-10-21).
- Not built: per-product fit rating in the research brief, a template picker on message steps (templates are listed and
  editable; the ICP first-message template stays as it was), the weekly tidy of rules (the retired learn routine was not
  revived — rules are deduped and superseded at write time), email-wave drafts stay template-only (edits are captured).

### 5.be Campaigns — sequences on a canvas, one approval card per step (2026-10-22, feat/campaigns, migration 081)

**LIVE 2026-10-22 (0.59.0)**: 081 applied, ring deployed (smoke 0.59.0, one gateway), app on Production (run 39785750255).
Five DRAFT default campaigns seeded (Fakuma 2026, PEI Napa 2026, NRW Kunststoff-Netzwerk (Matthias), LinkedIn ·
nrw matthias, LinkedIn · outreach); none launched, nobody enrolled. Deploy note: the network path from Amir's Mac to
the box dropped about half of NEW connections that day (site and SSH alike; the box itself was healthy), so
`deploy-server.sh` was run through ONE persistent SSH connection (ControlMaster wrappers on PATH; the ControlPath must
be under 104 characters, e.g. ~/.ssh/sbcm-%C).

Amir, from a Guhan video: "brainstorm /campaign". Decisions: (1) a campaign is SEPARATE from the lists it includes;
(2) one approval card per step = per (campaign, step, sender, day); (3) the Lead Conductor runs campaigns and leaves
enrolled people alone; (4) a free canvas; (5) LinkedIn + email in the first version. Plan `~/.claude/plans/campaigns.md`.
- **Core 081**: the legacy `campaigns` table (0 rows, unread) gains owner, status draft|live|paused|done|archived,
  product, goal, writing_context, language, `graph` (published) + `draft_graph` (edits), graph_version, settings
  {daily_max_per_step}; `campaign_lists` (icp list XOR /sales-leads source, include); `campaign_enrollments` (one ACTIVE
  or paused per prospect across all campaigns, once per campaign; node_id, due_at, approval_id, blocked_reason, path,
  exit_reason); `campaign_cards` (one pending per campaign+node+sender+Addis day; expires 30 h);
  `outreach_approvals.campaign_id / _node_id / _enrollment_id / _card_id`; policy `agents.campaigns`
  {enabled, per_card_max 25, card_ttl_hours 30, recheck_minutes 60, retry_hours 24}.
- **Graph** (`policy/campaigns.py`, pure; mirrored in `lib/campaigns.ts` — change both): nodes start, linkedin_connect,
  linkedin_message, email, wait, wait_for (accepted | replied | linkedin_replied | email_replied, exits yes/timeout),
  branch (rules on has_email, connected, fit_score, title, … — unknown is never yes; exits yes/no), handoff
  (back office | front office | sender), end. Message modes auto | guided (instructions) | fixed (text with
  {first_name} {full_name} {company} {title}; a missing value HOLDS the person, never a gap). `validate` blocks
  launches (one Start, every exit wired, wait_for needs a cause upstream, no loops, first email needs a subject, …).
  `default_graph` = today's conductor path (connect → acceptance 21 d → first message → 3 follow-ups 4/7/10 d, any reply
  → back office; not accepted → email if we have one).
- **Kernel** `commands/campaigns.py`: create (draft, default or blank graph; the list's first-message template becomes
  the first message), update, save_draft_graph (autosave; a draft equal to the live graph is dropped), launch_check /
  launch / pause / resume (= publish edits) / archive, `campaign_tick` (enroll from the lists; walk each DUE person or
  anyone with a reply since joining; a reply anywhere hands off unless they sit on a wait-for-reply; returns `to_draft`
  + hand-off events), `file_step_draft` (proposes through the normal lanes — propose_connect / propose_first_message /
  propose_outreach — and puts the approval on the day's card; email drafts get sender_address + thread), card,
  card_text, decide_card (ONLY the sender; skip = drafts expire, people redrafted in 20 h), claim_card (approved →
  sending, once), cards_to_send, drop_draft, people, results, test_run, cards_waiting.
  `mark_approval_result` wakes the enrollment so a sent step moves on at the next tick.
- **Safety lives in the send gate**: `outreach.send_gate` → `campaigns.send_allowed` refuses a campaign draft once the
  campaign is paused/archived, the person left it or replied (`permanent`, approval not consumed). An approved campaign
  card = `ask_approved` (the human decision), like an approved wave. Gmail: `waves.outbox` sends approved campaign
  emails within each sender's cap and marks the card sending/done; threads/replies as waves. The Lead Conductor shows
  "Campaign “X”: <step>" on enrolled leads and takes no action of its own; `outreach_queue` / `followup_queue` skip them.
- **Ring**: `campaign_runner.py` (called from `assets/scripts/lead_conductor.py` every hour after the conductor's tick):
  sends LinkedIn cards approved on the web since the last run, ticks, drafts each due step in the sender's voice (fixed
  text as is; guided/auto through `converse(json_mode)` + the writing context; a rule-breaking draft is dropped and
  retried next tick), files it, posts or EDITS the one Telegram card (`cg:<card>:approve|skip` + Review). A Telegram
  Approve all sends LinkedIn drafts in a gateway thread one every 8–16 s through `outreach_agent.handle_decision`, the
  card turning into a progress bar; the app's one-shot RPC cannot wait minutes, so a WEB approval leaves the card
  `approved` and the hourly run sends it. Tools (crm_outreach): `crm_campaigns_list`, `crm_campaign_get`,
  `crm_campaign_results`, `crm_campaign_people`, `crm_campaign_cards`, `crm_campaign_pause`, `crm_campaign_resume` and
  `crm_campaign_card_decide` (both withheld from MCP). App-only RPCs `campaign_*` (create, update, save_graph,
  discard_draft, launch_check, launch, archive, test_run, card, draft_drop). Persona + knowledge entries "Campaign" and
  "Message: Campaign card".
- **App**: `/campaigns` (list + New campaign: lists, sources, product, goal, usual path or blank), `/campaigns/[id]`
  (Sequence = `components/campaigns/SequenceCanvas.tsx` on `@xyflow/react` 12.11.6 + `StepInspector.tsx`; People;
  Results; Settings; Test run; Check & launch / Pause / Publish & resume / Discard edits / Archive),
  `/campaigns/cards/[id]` (edit via `/api/drafts/[id]`, drop, Approve all / Skip). Routes `/api/campaigns`, `/[id]`
  (GET, PATCH fields|lists|graph, POST action), `/[id]/people`, `/[id]/results`, `/cards/[id]`, `/options`.
  Gotchas found in the browser: a controlled React Flow must feed `dimensions` changes back or the minimap is blank;
  the canvas follows `<html class="dark">`, not the OS; SVG fills cannot read CSS variables.
- **Rollout** (integration session): apply 081; deploy ring + app; `python -m salesbrain_core.store.seed_default_campaigns`
  (dry run) then `--apply --owner <email>` gives every conductor-scoped list a DRAFT default campaign — nothing changes
  until someone launches one. Tested: 33 campaign tests (8 on a real Postgres), the runner end to end on a scratch DB,
  the canvas clicked through in Chrome. NOT tested: a real Telegram card, a real LinkedIn/Gmail send.
- Not built: A/B variants per step, per-step send windows, sending to a teammate's card for someone else's lead, a
  campaign view on the lead card, re-entering a finished campaign.

## 6. Env vars

All must be in `.env.local` (dev) and as GitHub repo secrets (prod — workflow writes them to `.env.production`).

```bash
# Core
ANTHROPIC_API_KEY=...
DATABASE_URL=postgresql://postgres.kfzkdpiesftbkjdkahdq:5vtdW%24%26uY-8i%29bq@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
SESSION_SECRET=...
NEXT_PUBLIC_APP_URL=https://salescrm.chipchip.social    # dev: http://localhost:3000

# Email
RESEND_API_KEY=re_...
EMAIL_FROM="SalesBrain <noreply@your-domain>"

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOARD_CHAT_ID=...

# Hermes (agent runtime + kernel RPC)
HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=...
HERMES_VENV_PYTHON=/usr/local/lib/hermes-agent/venv/bin/python   # kernelCall subprocess interpreter
BRIDGE_SECRET=...              # >=32 chars; the ring signs calls to /api/internal/bridge with it (same value in /root/.hermes/.env + profiles/crm/.env + GitHub secret)
ZEAMI_API_URL=...              # Zeami platform API base (client setup status, deal events), e.g. https://api.zeami.io
ZEAMI_API_KEY=...              # = Zeami's SALESBRAIN_INBOUND_API_KEY (different from ONBOARDING_API_KEY)
GEMINI_API_KEY=...             # DEFAULT model (Gemini) for the app AND every Hermes profile .env; GitHub secret + /root/.hermes/.env
AWS_BEARER_TOKEN_BEDROCK=...   # shared with Hermes; the FALLBACK model (Claude on Bedrock)

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://salescrm.chipchip.social/api/integrations/google/callback

# External API (zeami.io integration)
ONBOARDING_API_KEY=CUiGAYEzyQVabB-eOhLEaNro5lOwPCj5CNOKl_Bm8QA      # generated 2026-05-11; rotate via openssl rand -base64 32
PUBLIC_FORM_ALLOWED_ORIGIN=https://zeami.io                          # optional, CORS lockdown
```

Server-only deploy SSH secrets (in `.github/workflows/deploy.yml`): `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`.

---

## 7. Deployment

1. Push to `Production` branch on GitHub.
2. `.github/workflows/deploy.yml`:
   - SSH to `root@13.63.148.158`
   - `cd /srv/salesbrain && git pull origin Production`
   - Writes `.env.production` from secrets via `printf` (no leading spaces — `.env` is picky)
   - `npm install` (includes dev deps for build)
   - `npm run build`
   - `pm2 restart salesbrain || pm2 start ecosystem.config.cjs`
   - `pm2 save`

PM2 config (`ecosystem.config.cjs`): port 3002, cwd `/srv/salesbrain`. Caddy reverse-proxies `salescrm.chipchip.social` → `localhost:3002` with X-Forwarded-* headers.

To run migrations on Supabase from your machine:
```bash
DATABASE_URL='...' node -e "
const fs = require('fs');
const {Pool} = require('pg');
const sql = fs.readFileSync('db/migrations/008_pricing.sql','utf8');
const pool = new Pool({connectionString: process.env.DATABASE_URL});
pool.query(sql).then(() => { console.log('OK'); pool.end(); })
              .catch(e => { console.error(e.message); process.exit(1); });
"
```

---

## 8. Conventions / gotchas

- **TS strict mode is on.** `npx tsc --noEmit` is your typecheck. Always run it before claiming done. `npx next build` after that.
- **DB queries:** always use the `pool` from `lib/db.ts`. Parametrize via `$1`, `$2` placeholders. Never string-interpolate values into SQL.
- **Sessions:** `await getSession()` from `lib/auth.ts` returns `{userId, email, name, role}` or `null`. Always check at the top of every route.
- **Visibility rule on deals:** if you write a new endpoint that touches deals, mimic the existing pattern: regular users see `user_id = me OR lead_id = me`; admins see all.
- **Caching CSS var name:** `--bg-card` (not `--card` — old code may have the wrong name). Real list in `app/globals.css`.
- **lib/onboarding.ts** is client-safe (no DB/IO imports). `lib/onboarding-server.ts` is server-only. **Don't import server stuff into client components** — webpack will try to bundle `pg` for the browser and break the build.
- **`lib/pricing/engine.ts`** is server-only (it imports `pg` via `getActiveTool`/`getToolById`). Don't import from a client component.
- **Plan file:** `~/.claude/plans/lazy-orbiting-sky.md` has the design rationale for every major feature in chronological order. The first section is always the most recent plan.
- **`docs/external-api.md`** is what we send to zeami.io's developer when they ask "what API can we hit?". Keep it in sync if you add/change a public endpoint.

---

## 9. Active conversations / open threads

| Thread | Status |
|---|---|
| **Pricing tool — named ranges in Excel** | Engine works via `CELL_FALLBACKS` today. User should add named ranges in Excel (list in plan doc) for long-term robustness against row inserts. |
| **Pricing — PDF / share-link export** | V2. Use Puppeteer or server-rendered HTML template. |
| **Zeami.io onboarding form integration** | API + docs ready. Zeami.io's dev needs to implement the page at `https://zeami.io/onboarding/<token>` per `docs/external-api.md`. Until they do, the salesbrain in-app fallback at `/forms/onboarding/<token>` still works. |
| **Recurring `tool_use_id` 400** | Fixed via Phase 0 cycle-aware row cutoff + Phase 5 shift-aware orphan trim. Prompt caching shipped to offset the LIMIT 200 cost. |

---

## 10. Test data / live data points

- **ChipChip Pilot deal**: id `93c4386c-6120-42f3-a71e-488252a49f59`. Sales deal, at G9. Has onboarding row `bee03340-7e8b-4a24-b0a8-a04d8ce1e0d0`. Useful for end-to-end testing.
- **Pricing tool source Excel**: `/Users/amir/Downloads/Rob_ROI_Pricing_Tool_v2.xlsx`. 4 sheets, ~50 formulas, all HyperFormula-compatible. No named ranges yet. Sanity check: with Voyagerr/Denmark/25 seats/$5M rev/$1M labor/18% EBITDA/10% discount → pilot $9,558.90, impl $40,211.40, year-1 total $73,796.30, ROI 5.2×.
- **User context**: amir@chipchip.social — admin role.

---

## 11. Conventions for working with Claude in this codebase

1. **Plan mode first for non-trivial changes.** The plan file accumulates context across sessions — write a plan there before executing for anything touching >2 files or new DB tables.
2. **Read the plan file** (`~/.claude/plans/lazy-orbiting-sky.md`) when picking up a feature. Each section is a snapshot of design intent.
3. **Use the TodoWrite tool** for multi-step tasks. The system reminds you.
4. **Typecheck + build after any change.** `npx tsc --noEmit && npx next build`. Both must be clean.
5. **Don't add named exports to existing files without checking imports first.** Use `grep -rn "buildSystemPrompt"` (or whatever) to find call sites.
6. **For visibility-related changes**, always check the standardized rule in §5.14. Inconsistency leaks data.
7. **For the agent loop**, the 5-phase history sanitizer is delicate. Don't simplify without strong evidence.
8. **For DB changes**, always create a numbered migration file, also append to `db/schema.sql` for fresh installs, AND run the migration on Supabase via the `node -e` pattern above.
9. **For React components that import server libs** (anything pulling in `pg`), guard with a server-only split if needed — see `lib/onboarding.ts` vs `lib/onboarding-server.ts` for the pattern.

---

## 12. Quick-start commands

```bash
# Local dev
cd "/Users/amir/Documents/Programming /Sales CRM/salesbrain"
npm run dev          # localhost:3000

# Typecheck + build
npx tsc --noEmit && npx next build

# Run a migration locally against Supabase
DATABASE_URL='...' node -e "..."  # see §7

# SSH to production server
ssh root@13.63.148.158
cd /srv/salesbrain
pm2 logs salesbrain --lines 100
pm2 restart salesbrain

# Verify a production env var
ssh root@13.63.148.158 'grep RESEND_API_KEY /srv/salesbrain/.env.production'
```

## 13. Parallel sessions (feature workspaces)

Several Claude Code sessions can work on different features at the same time. The unit of parallelism is a
**feature**, not a repo — one feature usually touches `salesbrain` + `salesbrain-core` + `salesbrain-hermes`.

**Zero-touch for Amir**: he just opens a new chat and describes the feature. The SESSION creates and manages its
own workspace — the full startup protocol lives in `Sales CRM/CLAUDE.md` ("Startup protocol"). In short: check
`./ws.sh list` + every `ws-*/BRIEF.md` `## Scope` first; feature work → `./ws.sh new <slug> <port>` and work only
inside `ws-<slug>/`, declaring your scope in its BRIEF.md; trivial fixes/merges/deploys → root repos as the
integration session. A chat doesn't need its own VS Code window — working inside the `ws-<slug>/` subfolder from
the parent window isolates it just as well.

**Layout.** `Sales CRM/ws.sh` (parent folder) creates `Sales CRM/ws-<feature>/` containing git worktrees of all
three repos on branch `feat/<feature>`, plus `.env.local`, `node_modules`, and the two `uv` venvs (hermes installs
core editable from `../salesbrain-core` inside the workspace, so imports resolve to the feature branch). It also
writes `ws-<feature>/BRIEF.md` — paste that as the first message of the new session.

```bash
cd "/Users/amir/Documents/Programming /Sales CRM"
./ws.sh new <feature> [port]   # e.g. ./ws.sh new warm-intros-v2 3001  (~20 s)
./ws.sh list
./ws.sh sync <feature>         # merge main -> feat/<feature> in all 3 repos after main moves
./ws.sh rm <feature>           # after merge; refuses on unmerged/uncommitted work unless --force
```
Open `ws-<feature>/` itself as the VS Code / Claude Code folder — same three-folder layout as `Sales CRM/`. The
workspace gets a copy of `Sales CRM/CLAUDE.md` (which imports this file) and shares the main window's Claude memory dir.

**Which session am I?** If the folder path contains `/ws-<something>/`, this is a **feature session**. If it is the
plain `Sales CRM/` (the parent folder holding all three repos — the normal way to open this project), this is the
**integration session** on `main`.

**Feature session rules**
- Commit only on `feat/<feature>`. Never push `Production`, run `deploy-server.sh`, or SSH to the server.
- Never bump versions — the 0.x.y lockstep bump happens in the integration session at merge time.
- Postgres is one shared Supabase DB for every session. Writing a migration file is fine; **applying** it is not,
  unless the owner has said this feature owns the schema this round. List every migration in the final summary.
- `PORT=<port> npm run dev` (from `BRIEF.md`); 3000 belongs to the integration session.
- Stay inside the files the feature needs; other sessions are editing other areas concurrently.

**Integration session (`Sales CRM/`) owns**: merging `feat/*` into `main` in all three repos, the lockstep version bump,
`npx tsc --noEmit && npx next build` + `pytest` on `main`, applying migrations, deploying, and the live Telegram bot.
After merging, run `./ws.sh sync <other-feature>` for every workspace still open and tell that session `main` moved.

**Limits**: 2–3 concurrent features is the practical ceiling — everything funnels through one kernel and one DB.
Two features that must edit the same kernel module or the same table should run sequentially, not in parallel.

---

If anything in this doc is out of date, update it as you work — it's the canonical handoff between sessions.
