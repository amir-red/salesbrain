# Warm-intro research — 01: Current state (verified in code)

*Read time ≈ 7 min. Every claim about code cites `path:line`. **Inferred** and **unverified** are labelled as such. Paths: **core/** = `salesbrain-core`, **hermes/** = `salesbrain-hermes`, **app/** = `salesbrain`.*

## TL;DR — the four facts that shape the design

1. **There is no person↔person edge anywhere.** Every `people(id)` FK is a single column; the table called `relationships` is person↔*us* (`person_id UNIQUE`). The graph is a foundation to build, not a feature to extend.
2. **Reply detection does not exist as an event.** A thread we sent into is set to `'waiting'` and never leaves it. `P6_REPLIED`, `last_replied_at`, `reply_status` are declared and never written.
3. **Outreach is one-touch by construction.** The queue only ever picks `last_contacted_at IS NULL`. Nothing sequences a second message to anyone.
4. **The existing intro-request path is broken end-to-end and unreachable from the partner API.**

---

## 1. Data model and reachability

### People and the (absent) edge

Complete list of `REFERENCES people(id)` across both schemas — all single-column: `channel_handles.person_id` (`core/migrations/021_relationship_graph.sql:20`), `relationships.person_id` **UNIQUE** (`:32`), `interactions.person_id` (`:48`), `person_facts` (`:62`), `commitments` (`:75`), `value_events` (`:91`), `objectives` (`:103`), `deals.relationship_person_id` (`:115`), `linkedin_threads.person_id` (`core/migrations/024_linkedin.sql:48`), `linkedin_relations.person_id` (`:87`), `prospects.person_id` (`core/migrations/026_prospect_engage.sql:13`), `digest_state` (`029:23`), `outreach_approvals.person_id` (`032_agents.sql:82`). No table has two.

`relationships` (`021:30-42`) is "our standing with a person" — `stage`, `owner_user_id`, `preferred_channel`, `cadence_days`, one row per person (`:29`). The only *implied* A→B edge is a transient `outreach_approvals` row with `kind='intro_request'` + `intro_for_prospect_id` (`core/migrations/034_warm_intro.sql:27-30`), a draft with a 72h TTL that nothing reads as a relationship.

The `/network` page's `EdgeType` is `works_at | in_industry | based_in` (`app/lib/network-graph.ts:17`) — no contact↔contact edge.

### Owner scoping

`people` and `accounts` have **no owner column** (`021:6-14`, `025_prospecting.sql:21-37`). `contacts`, `prospects`, `relationships`, `outreach_approvals` carry `owner_user_id` (`025:61`, `025:85`, `021:35`, `032:81`). `linkedin_threads` is scoped via `account_id → linkedin_accounts.owner_user_id` with an explicit **no-admin-bypass** rule because the ring elevates board-group users to admin (`024:8-12`). `channel_handles` is globally unique on `(channel, lower(handle))` (`021:26`).

### Identity layer is empty

`channel_handles` holds email + phone only — **zero LinkedIn handles** (`app/docs/unipile-trial-results.md:71-73`), even though Unipile returns the stable keys (`member_id`/`member_urn`/`public_identifier`) that would populate it. `linkedin_relations.person_id` is matched through `channel_handles` (`core/src/salesbrain_core/commands/linkedin.py:288-292`), so today that match can never succeed for LinkedIn identities.

### Two definitions of "reachable" that don't talk to each other

- **Queue** — `commands/agents.py::outreach_queue:628-688`: a prospect is reachable iff `email IS NOT NULL OR linkedin_thread_id IS NOT NULL` (`:671`), where the thread must be on the owner's non-revoked account and match by `person_id` or `attendee_public_identifier` (`:646-652`). `warm_paths`/`network_degree` are selected (`:643`) but **neither gate nor rank** — ordering is `icp_score DESC` (`:653`).
- **Send-time ladder** — `policy/outreach.py::pick_channel:105-127`: reachable = presence of a `channel_handles` row (`:116-120`). It knows nothing about threads; a `linkedin` handle counts as reachable with no thread — the opposite of the queue.

### Warm-intro data that exists (from the earlier warm-intro feature)

`prospects.network_degree` + `warm_paths JSONB` (`034:14-17`); documented shape `[{"type":"employer|school|city|industry|customer|colleague", value, note, via_account_id, connector_user_id}]` (`034:10-13`). `linkedin_accounts.owner_profile` caches the owner's facets (`034:21`) — the comment promises `fetched_at`, the writer never sets it (`hermes/src/salesbrain_hermes/prospecting_core.py:225`), so there is no cache invalidation. **`set_warm_paths` writes `[]` on no-match** (`core/src/salesbrain_core/commands/prospecting.py:824`) while the enricher re-queues only `warm_paths IS NULL` (`commands/enrichment.py:122`) — a lead scored once with no angle is never re-scored, even after a teammate connects.

`warm_angles` (`policy/icp.py:317-346`) emits `customer > employer > school > city > industry`, all lead↔owner. The `industry` branch is dead — `profile_facets` never returns an `industry` key (`prospecting_core.py:206-225`). **`colleague` is emitted only by `compute_warm_paths`** (`prospecting_core.py:289-308`) and only when: a second non-revoked `linkedin_accounts` row exists (`:293`), that colleague's Unipile session returns a profile for the lead (`:297`), the colleague's degree is 1 or 2 (`:303`) and strictly closer than ours. The connector is therefore always **another SalesBrain user with a connected account** — never a third person. Dormant with one account (docstring `:258-260`).

## 2. Unipile integration

### What we call (all through one choke point)

Every call funnels through `_request` (`hermes/src/salesbrain_hermes/unipile.py:58`), which is also the safe-rate guard hook (`:65-76`, `:100-105`). Read calls: `list_chats`/`list_attendees`/`list_messages` (`:124-133`), `get_profile` (`:136-143`; `sections="*"` yields `work_experience`/`education`/`location`), `list_relations` (`:146-150`), `search` (`:153-174`, returns `network_distance`), `search_parameters` (`:177-186`). **The only write is `send_message`** (`:191-195`) — "there is deliberately no invitation call" (`:192-194`; decision at `app/docs/unipile-trial-results.md:102,106-114`). Action classes: `policy/linkedin_limits.py:50-69`.

### The relations gap (key finding)

`linkedin_relations` exists (`024:80-96`) but is a **change detector, not a mirror**: the only caller fetches one page of 30 with no cursor (`hermes/assets/scripts/linkedin_sync.py:196`, `:29`, `:70`), and on the first run skips every relation (`:209` — `cursor is None` → `continue`), by design so that an established account's thousands of connections aren't queued as "just accepted" (`commands/linkedin.py:260-263`). `relations_cursor` is a timestamp high-water mark (`024:30`, advanced at `linkedin.py:257-274`). **The pre-existing connection list is never fetched and never stored.**

**Verified against Unipile's API reference (external):** `GET /users/relations` is **own-account only** (no third-party identifier), cursor-paginated, `limit` 1–1000, returning `first_name, last_name, headline, public_identifier, public_profile_url, created_at, member_id, member_urn, connection_urn`. So a full ring is ~1–3 `relations` calls, not the 25 you'd get at `SAFE_PAGE=40`. *Unverified in our own trial* (`unipile-trial-results.md:24-30` never probed it).

### What Unipile offers that we don't use

Verified in the trial: the profile payload carries follower/connection counts, `is_open_profile`, `is_premium`, `network_distance`, `connected_at`, contact info (`unipile-trial-results.md:29`); attendees carry `member_urn` (`:27`). From Unipile's docs index (external, endpoint existence verified; record fields **unverified**): third-party **posts by ACo-id**, and per-post comments/reactions keyed by `social_id`; followers/following; company profile. **Not found anywhere:** mutual/shared connections, "people also viewed", a company-employees list. `posts`/`comments` have no references in any repo.

### Safe-rate guard and budgets

Guard: `hermes/src/salesbrain_hermes/linkedin_guard.py` (fail-open `:83-85`; account from params or a ContextVar `:50-55` — set only in `linkedin_sync.py:147-148` and `deliver.py:423`; an unbound call is allowed but **unbudgeted** `:69-70`). Decision `policy/linkedin_limits.py:104-128`; block detection `:131-145` (markers only on failed responses — regression guard `:136-138`). Caps (`core/migrations/035_linkedin_requests.sql:50-57`): free — search 20 · profile_view 80 · message 25 · **relations 60** · inbox_read 400 · params 120; Sales Navigator — 40 · 300 · 40 · **120** · 800 · 240; `min_gap_seconds: 6`, account-wide (`commands/linkedin_health.py:50-53`). Agent budgets: `searches_per_account_per_day: 12` (`032:109`), `profile_fetches_per_account_per_day: 30` (`033_enricher.sql:68`), `outreach.channel_caps.linkedin` 25/day · 100/week (`024:103-105`). All four windows are rolling 24h, not calendar-day (`linkedin_health.py:44-49`, `agents.py:142`, `enrichment.py:51`).

## 3. The outreach loop, "thread exists", and replies

### Draft → send

`propose_outreach` (`commands/agents.py:462-531`): LinkedIn requires an existing `linkedin_thread_id` (`:478-480`, "invitations are not possible"); ownership check uses `actor.user_id` and does **not** filter `revoked_at` (`:497-503`, unlike the queue at `:648`); dedup is one pending row per `(owner, person, kind)` (`:504-511`); TTL from `agents.outreach.approval_ttl_hours` (default 72, `:512`, `:517`). Decide (`decide_outreach:543-580`) only flips to `approved`; send is `hermes/src/salesbrain_hermes/outreach_agent.py::approve_and_send:33-75` → `linkedin.send_message` (`commands/linkedin.py:429-467`, sets `state='waiting', last_from_them=false` `:457-459`) or `record_outreach` (`commands/outreach.py:68-101`). `mark_approval_result` (`agents.py:583-603`) sets `P5_SENT` + `last_contacted_at` **only if `row.prospect_id` is set** (`:595-599`).

### "A thread exists"

Rows are created only by `sync_thread` (`commands/linkedin.py:176-223`) from `linkedin_sync.py:172-177`. The `ON CONFLICT DO UPDATE` set-list (`:193-202`) **does not include `state`** — sync can never change it. `state ∈ needs_reply|waiting|done|ignored` (`024:55-56`); writers are the manual `set_thread_state` (`:252`) and the send path (`:458`). `last_from_them` = "true = ball in our court" (`024:50`).

### Replies: passive, and nothing reacts

"They replied" is representable **only** as `last_from_them IS TRUE` (the `inbox()` predicate, `linkedin.py:321-323`). `'waiting' → 'needs_reply'` never happens. `linkedin_sync.py` has zero references to `prospects`, `stage`, `last_replied_at` or `outreach_approvals`. `P6_REPLIED` is never written (only the CHECK `025:89`, a constant `prospecting.py:28`, and an exclusion `agents.py:598`; the app admits it: `app/components/Sidebar.tsx:158` "nothing sets that stage"). `prospects.last_replied_at`, `reply_status`, `next_action_at` are never written. The only inbound `interactions` row is a one-time synthetic row on thread promotion (`linkedin.py:518-522`). The only reaction to new inbound activity is the Telegram digest (`linkedin_sync.py:226-243`). The only real event loop is **accepted connections** (`linkedin_sync.py:196-216` → `record_relation` → `pending_followups`, `linkedin.py:377-397`).

### No cadence

`followups` is **deal-scoped** (`app/db/schema.sql:65`), written manually, and no timer fires `send_followup` (`commands/deals.py:649-670` sends *now*). The queue's `last_contacted_at IS NULL` (`agents.py:664`) plus the `sent`-approval exclusion (`:665-666`) mean a contacted person can never re-enter.

## 4. Agent/timer framework — where a campaign could live

Registry `agent_definitions` (`032:17-26`, `schedule` is prose `:22`), run log `agent_runs` (`032:31-53`, counters are leads-finder-shaped `:43-46`, `detail` jsonb is the only free slot `:47`), lifecycle `start_run/finish_run/skip_run/request_run/claim_requested` (`agents.py:43-132`; `claim_requested` admin-only `:123`, claims *all* pending rows for an agent `:128`). The unique index `uq_agent_runs_requested (agent, icp_profile_id) WHERE status='requested'` (`037:25-27`) means one pending slot per (agent, ICP) — including `NULL`.

**The "next agent" pattern** (enricher, empirically): registry row (`033:56-60`) + policy row (`:62-69`) + `AGENTS` allowlist (`agents.py:22`) + script + a schedule carrier — systemd timer (`hermes/assets/systemd/*.timer`, shipped by `deploy-server.sh:43`, enabled manually `:205-207`) or a Hermes cron routine (`deploy-server.sh:147-162`, **default profile only** `:130-131`). Plus the app's tool enum (`app/lib/service-mcp/dispatch.ts:186`) and a window case in `schedule.ts:70-72`.

**Timers** are deterministic Python (`leads_finder.py:4-6`), drain `requested` first (`:170`, `enricher.py:91`). **The outreach routine** is the LLM half: `outreach_queue.py` gates and opens the run (`:36-46`), prints the queue as JSON (`:47-53`); `outreach-prompt.txt` drafts via `crm_outreach_propose` and closes with `crm_agent_finish_run` (`:5-7`). Where per-step state lives: the draft in `outreach_approvals`, decision/send outcome on that row, prospect position in `stage`/`last_contacted_at` — **and the run's item list nowhere durable** (it exists only in the script's stdout).

`get_run_status` (`dispatch.ts:330-383`) polls the same row from queue to completion.

## 5. Enrichment as a relationship source

`enrich_one` (`prospecting_core.py:317-387`): employer (1 profile fetch), research (web/LLM), warm (`compute_warm_paths`), email (`match_known_email` then provider; `email_sources.py:161-180`). **None returns relationship data.** Person↔person is *derivable but never derived*: co-employment from `contacts.account_id → accounts` (`025:44,63`; already joined by `match_known_email`, `enrichment.py:166-179`, to borrow an email); shared school from `profile_facets` (`prospecting_core.py:218-224`) — but **lead facets are discarded after scoring**; only the overlap string survives in `warm_paths`. Gmail sync stores `from_email`/`to_email` but only queries contacts the owner already owns and never parses multi-recipient headers (`app/api/integrations/google/sync/route.ts:126-141`, `lib/google-oauth.ts:201`) — so no co-recipient edges. Google People reads `people/me/connections` only (`google-oauth.ts:220-232`).

## 6. The existing intro-request path — five defects

1. `crm_propose_intro` hardcodes `channel="linkedin"` but `connector_thread_id` is optional in its schema (`hermes/src/salesbrain_hermes/tools/agents.py:113-114`, `:282`) → omitting it is a guaranteed error at `agents.py:478-480`.
2. It never passes `prospect_id` (`:113-117`) → `mark_approval_result` sees NULL (`agents.py:595`) → **a sent intro request advances nothing**.
3. Because `prospect_id` is NULL and the outbound interaction lands on the *connector's* person row, **the lead stays eligible for a cold draft** (`agents.py:664-668`).
4. The send path branches on `channel` only; `kind` is never consulted (`outreach_agent.py:45-55`) → an approved intro is just a DM to the connector; nothing records that an intro was asked or watches the answer.
5. The routine is told **not** to use it (`outreach-prompt.txt:5`; `SKILL.md:26`), and it is `mcp=None` (`tools/agents.py:272`) **and** absent from the service `PASSTHROUGH` — unreachable from a partner app. Intro requests also share the 72h TTL (`agents.py:512`).

## 7. Contradictions with `docs/service-mcp.md`

| Doc says / omits | Code |
|---|---|
| `crm_outreach_propose` documented as a partner tool (`service-mcp.md:367-370`) | Marked `mcp=None` "not for the external MCP surface" (`tools/agents.py:254`) — reachable only because the service surface dispatches by name with no `is_exposed` check (`dispatch.ts:459`, `rpc.py:146`). Half a gate. |
| `crm_propose_intro` — absent | Exists, unreachable (§6.5). |
| `next_tick_window` for any agent | `nextWindowFor('outreach')` returns the **leads-finder** window and the wrong "use `crm_leads_finder_run`" hint (`schedule.ts:70-72`, `:58`); outreach is a 10:00 Addis cron (`deploy-server.sh:156`). |
| `crm_agent_request_run` enum includes `outreach`? (it accepts it) | `request_run` accepts `'outreach'` (`agents.py:22,92`) but `outreach_queue.py` never calls `claim_requested` → the row sits `requested` forever, holding the unique slot. |
| "the only place that stage is set" (`agents.py:585`) | `app/lib/prospect-executors.ts:229` also writes `P5_SENT` (and a `prospect_events` row the kernel path never writes). |
| `warm_paths`/`network_degree` returned by `list_leads` (`dispatch.ts:302`) | Undocumented output fields. |
| Pending drafts just wait for a decision | 72h `expire_approvals` sweep (`agents.py:620-625`) runs **only** from the internal outreach cron (`outreach_queue.py:34`); with `agents.outreach.enabled=false` nothing sweeps, and `crm_outreach_decide` then refuses past-due drafts (`:569-572`). Undocumented. |
| 7-stage sequence ends at Send (`service-mcp.md:22-37`) | Accurate — and therefore the external contract has **no vocabulary for anything after a send** (replies, follow-ups, hops). |

**Flags / could not verify:** `imported_messages` has no `CREATE TABLE` in any tracked migration (columns inferred from the INSERTs at `sync/route.ts:163`, `imports/messages/route.ts:38`); `unipile.py:194` cites `docs/unipile-trial-results.md` in the wrong repo; the `/users/relations` response shape is from Unipile's reference, not our trial.
