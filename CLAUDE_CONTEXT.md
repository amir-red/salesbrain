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
| Deploy | **GitHub Actions** on push to `Production` branch | `.github/workflows/deploy.yml` SSHes to the server, writes `.env.production` from secrets, runs `npm install && npm run build && pm2 restart`. |
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
- Disconnecting LinkedIn purges that owner's LinkedIn-derived edges.

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
  34 tools). Cadence: `mark_approval_result` bumps `touch_count` and arms `next_followup_at` from
  `agents.followup` (`spacing_days [4,7,10]`, `max_touches 3`, ships **disabled**); `followup_queue` feeds the
  outreach routine's new `followups` list (skill §2b: touch N+1, shorter, one new useful thing,
  `kind='followup'` → same card, same gate). `list_leads` returns the contact/reply columns.
- **Known debt kept on purpose**: the app still writes `policy_rules` (kill switch), `icp_profiles`, `prospects`,
  `deals` directly; `lib/quota-server.ts` re-ports `policy/linkedin_limits.py`; 6 app-side LLM call sites remain.

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
AWS_BEARER_TOKEN_BEDROCK=...   # shared with Hermes; lib/llm.ts uses Bedrock when set

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
