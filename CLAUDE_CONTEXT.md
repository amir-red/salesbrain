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
| AI | **`@anthropic-ai/sdk`** with Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`) | Tool-use loop in `lib/agent.ts`. Adaptive thinking, prompt caching on the system prefix. |
| Email | **Resend** via `lib/email.ts` → `sendEmail({to, subject, body})` | `RESEND_API_KEY` + `EMAIL_FROM` |
| Telegram | Bot API for board reviews | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOARD_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` |
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

### 5.1 The agent loop (`lib/agent.ts`, `lib/tool-executors.ts`, `lib/tools.ts`)

- `POST /api/agent` streams NDJSON events of types `text`, `tool_start`, `tool_result`, `done`, `error`.
- Per-turn flow: `loadHistory(dealId)` → append new user msg → loop `anthropic.messages.create` → for each `tool_use` block, execute, persist `tool_result` to `conversations`, push back → repeat until `stop_reason === 'end_turn'`.
- **History sanitization** in `loadHistory()` has 5 phases. THIS IS THE TRICKY PART:
  - **Phase 0:** Fetch `LIMIT 200` rows DESC, reverse to ASC, then trim leading non-`user` rows so the window starts at a cycle boundary.
  - **Phase 1:** Reconstruct Anthropic message format from flat rows. Tool IDs are `hist_1`, `hist_2`, … (FIFO matched).
  - **Phase 2:** Validate `tool_use`/`tool_result` pairing. Broken pairs → strip the tool_use, keep text-only.
  - **Phase 3:** Ensure role alternation. Never drop a message containing structured blocks — merge content arrays if needed.
  - **Phase 4a:** Strip orphan `tool_use` blocks (no matching tool_result after).
  - **Phase 4b:** Strip orphan `tool_result` blocks (no matching tool_use before).
  - **Phase 5:** Final shift loop — drop leading non-`user` rows AND leading `user` rows whose content is all `tool_result` blocks.

This complexity exists because Anthropic 400s with `messages.0.content.0: unexpected tool_use_id` or `tool_use ids were found without tool_result blocks` if the array is malformed. Every line of this loader is fighting one specific failure mode we've actually hit in production. **Don't simplify it without strong reason.**

- **Prompt caching:** `buildSystemPrompt()` returns `{ stable, dynamic }`. The `system` arg passed to Anthropic is a 2-element array where the stable region has `cache_control: { type: 'ephemeral' }`. Repeat calls within 5 min hit the cache. Verify via `response.usage.cache_read_input_tokens`.

### 5.2 9-gate sales + 10-gate grant pipelines (`lib/gates.ts`)

- Sales board gates: **G3** + **G7** (moved from G5 in May 2026 — see plan history).
- Grant board gates: G3, G7, G9.
- `requiredFields` per gate; `getMissingFields(gate, fields, dealType)` drives the agent's prompts.
- **Money-first discipline for grants:** at G1, `GRANT_MONEY_FIELDS` (`grant_amount_min/max`, `our_contribution`, `our_contribution_type`, `cofunding_split`) are required AND cross-gate enforced — even an existing grant past G1 is BLOCKED from advancement until those are filled. Implemented in `exec_update_deal`.
- **Deployment plan** is required at G7 (sales). Values: `'on_premise'` or `'saas_cloud'`. Carried into the onboarding row at G9.

### 5.3 Board review (Telegram, multi-voter)

- At G3/G7 (sales) or G3/G7/G9 (grant), agent calls `send_telegram` with a structured board summary.
- `board_decisions` row created with `votes_required: 5`, `votes_to_block: 4`, `total_voters: 8`.
- Telegram callbacks (`/api/telegram` webhook) post to `board_votes`. When 5 proceed → status flips to `approved`. Status visible on `/approvals`.
- Flag `board_sent_g${N}` on the deal prevents duplicate sends.
- G7 board summaries MUST include `deployment_plan` — enforced in the system prompt.

### 5.4 Pre-deal prospecting (`lib/prospect-tools.ts`, `lib/prospect-executors.ts`)

10-stage pipeline P0–P9. 12 AI tools — `create_or_import_prospect`, `enrich_prospect`, `score_prospect_fit`, `research_company_from_url` (fetches website + Claude analyzes), `generate_research_brief`, `draft_outreach_message`, `send_outreach_message` (Resend + daily-cap + 3-min per-domain throttle + auto unsubscribe footer), `classify_outreach_reply`, `convert_prospect_to_deal`, `archive_prospect`, `analyze_communication_style` (per-user scoped), `import_messages_from_user_text`.

### 5.5 Look-alike from won deals (planned only, not built)

Plan exists but no code. Skip unless asked.

### 5.6 Voice input + mobile + activity timeline + daily digest + decay monitor + meeting prep

All shipped. Voice input uses `webkitSpeechRecognition`. Daily digest cron runs at `/api/cron/daily-digest`. Decay monitor at `lib/decay.ts`. Meeting prep is an agent tool (`prep_meeting`) that produces a structured brief.

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
- **Tools** (`lib/service-mcp/`, 21 as of 2026-09-05): `register_user`, `suggest_icp` (partial input → scored ICP candidates, LLM, saves nothing), `crm_icp_define`/`crm_icp_preview`/`crm_icp_list`, `crm_leads_finder_run`/`crm_agent_request_run` (+ observability: `get_run_status` poll loop, `crm_agent_activity`, `crm_agent_status`, `crm_linkedin_quota`; the spending tools are budget-guarded and attach the fresh quota + near-limit warnings), `crm_enrich_prospect`, `list_leads` (direct SQL, owner-scoped), `crm_outreach_propose`, `crm_outreach_pending`, `crm_outreach_decide`, and LinkedIn onboarding (`linkedin_connect_start`/`linkedin_unbound_accounts`/`linkedin_link_account`/`crm_linkedin_status`/`crm_linkedin_revoke` — revoke added 2026-09-05: kernel passthrough that unbinds AND deletes the Unipile account via the ring's `linkedin_disconnect` event). Kernel tools pass straight through `kernelCall`; audit → `mcp_audit_log` with `{app_key, employee_id}` in `input`.
- **Decisions**: approvals render in the OTHER app's UI (`crm_outreach_pending` → `crm_outreach_decide`, not Telegram); each employee connects their OWN LinkedIn + email; **shared data pool** — external rows live in the same `prospects`/`accounts` tables, owned by the mapped user (recoverable as external-origin via `external_employees`). Reachability caveat: fresh LinkedIn leads with no existing thread are email-only (no cold invites).
- **Admin**: mint tokens in the UI at `/profile → Service API` tab (admin-only, `components/profile/ServiceTokenPanel.tsx`) or `POST /api/admin/service-tokens {app_key,name}` (shown once); `lib/service-mcp/tokens.ts`. Rate limits: 120/min per app token + per-tool sub-limits (`lib/service-mcp/auth.ts`). Full contract for the other app's dev: `docs/service-mcp.md`.

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
TELEGRAM_WEBHOOK_SECRET=...

# Cron
CRON_SECRET=...                # bearer token for /api/cron/* endpoints

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://salescrm.chipchip.social/api/integrations/google/callback

# External API (zeami.io integration)
PUBLIC_FORM_BASE_URL=https://zeami.io/onboarding
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
