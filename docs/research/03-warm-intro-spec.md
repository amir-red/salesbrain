# Warm-intro research — 03: Design spec

*Read time ≈ 8 min. Design only — nothing here is built. Grounded in `01-current-state.md` (cited) and `02-external.md`.*

## The mental model, restated in system terms

Red = the employee (owner). Blue = a person we can message **now** — an email on file or an existing LinkedIn thread on the owner's account (the queue's reachability predicate, `commands/agents.py:671`). Green = the target. Yellow = one hop from the target, not yet blue. The engine's job is (1) know who is blue, (2) find yellows around the target, (3) find a chain red → blue → … → green, (4) walk it one approved hop at a time, and (5) when no chain exists, turn the best yellow blue through the normal pipeline and try again.

**Hard constraints carried through every section:** every message is `crm_outreach_propose` → human approval → `crm_outreach_decide` → policy gate; **no invitations**; edges belong to the employee (`X-On-Behalf-Of`), company data is org-wide; every LinkedIn call passes the safe-rate guard and ring ingestion spends **no** search/profile budget.

---

## 1. Graph model

Today no person↔person edge exists (01 §1). Proposed (core migration, later):

```
person_edges
  owner_user_id   UUID NOT NULL          -- whose knowledge this is (isolation)
  src_person_id   UUID NULL              -- NULL = the owner themself (the red node)
  dst_person_id   UUID NOT NULL → people
  source          TEXT  CHECK IN (linkedin_relation, linkedin_thread, email_thread,
                                  post_engagement, intro_confirmed, manual)
  strength        NUMERIC(4,3)           -- 0..1, computed (see below)
  direction       TEXT  CHECK IN (mutual, out, in)
  last_signal_at  TIMESTAMPTZ            -- most recent evidence
  evidence        JSONB                  -- {"messages": 6, "last": "2026-08-14", "thread_id": …}
  synced_at       TIMESTAMPTZ
  UNIQUE (owner_user_id, src_person_id, dst_person_id, source)
```

- **Social edges are materialized and owner-scoped.** Two employees who both know Alice each hold their own edge; a partner app's employees never see each other's (the isolation rule).
- **Structural edges are derived at query time, never stored:** same current/past employer via `contacts.account_id → accounts` (org-wide company data, `025:44,63`), shared school via persisted facets. Storing "A worked with B" as a third-party claim is exactly the data we don't want to hold (§8).
- **Prerequisite — identity.** Every node must resolve to a `people` row through `channel_handles(channel='linkedin', handle=member_id)`; the identity layer is empty today (01 §1). Identity match keeps the trial's **human-confirm** step (`unipile-trial-results.md:99`): a wrong-person intro is unrecoverable.
- **Facets must be persisted** (a `person_facets` jsonb on `people`: employers, schools, city, fetched_at) — today lead facets are discarded after scoring and `owner_profile.fetched_at` is never written (01 §1, §5).

**Strength** — all constants live in one `policy_rules` row `agents.warm_intro`, like every other cap:

```
strength = base[source] × recency(last_signal_at) × (1 + mutual_bonus if direction=mutual)
base: thread_with_reply 1.0 · email_exchange 0.8 · linkedin_relation 0.5 · post_engagement 0.2
      current_employer 0.4 · past_employer 0.25 · school 0.15 · intro_confirmed 0.9
recency: 0.5 ^ (days_since / 180)          -- 180-day half-life
```

`thread_with_reply` is derivable today from `linkedin_threads.last_from_them` + `linkedin_messages` counts; `email_exchange` from `imported_messages.direction` (01 §3, §5).

## 2. Ingestion — `crm_graph_sync`

Per employee, under the existing guard with the account ContextVar **bound** (otherwise the call is unbudgeted — 01 §2):

1. **Full 1st-degree mirror**, once: paginate `list_relations` with `limit=1000` (Unipile's max) → ~1–3 `relations` calls against a cap of 60/120. Upsert `people` + `channel_handles(linkedin)` + `person_edges(source=linkedin_relation)`. Then **incremental** by `created_at` high-water mark — the current change-detector (`linkedin_sync.py:196-216`) becomes this incremental step instead of skipping everything.
2. **Thread edges** from the already-mirrored `linkedin_threads` (no new LinkedIn calls): strength by reply/recency.
3. **Email edges** from Gmail-synced `imported_messages` (no LinkedIn calls).
4. **Facets** for people we already fetched profiles for (employer step) — persist instead of discard.

Budget: **zero** search or profile quota for the ring. Deferred/paused/rate-limited outcomes propagate through the same `{deferred, status, resume_at}` envelope the service surface already returns. Consent: the sync is opt-in per employee (§8).

## 3. Target expansion — `crm_target_expand {target_person_id}`

Build the yellow ring **cheapest first**, stop when enough candidates exist:

| Step | Source | LinkedIn cost | Notes |
|---|---|---|---|
| a | People already on file at the target's `account` (`contacts.account_id`) | 0 | Colleagues we already know |
| b | Target's own facets → employees/alumni in the owner's graph | 1 `profile_view` (cached in facets) | Reuses `profile_facets`, inverted (target facets vs owner's known people) |
| c | **Post engagement**: list the target's recent posts by ACo-id → commenters/reactors on the top N (N=3) | new `posts` action class in the guard, capped | Endpoints verified to exist; **record fields unverified** — validate on one account before relying on it |
| d | **Cross-account degree**: for each other connected SalesBrain account, `get_profile(target)` → if 1st-degree, that colleague **is** a path | 1 `profile_view` per account | The existing `compute_warm_paths` loop (`prospecting_core.py:289-308`), generalized to any target and to non-lead persons |
| e | Company people search | 1 `search` | **Last resort** — spends the 12/day search budget |

Each candidate carries `evidence` and a `connector_score` = f(is a SalesBrain user with an account ⇒ 1.0; responded to us before; recency of last interaction; seniority proximity to the target; how many yellows they touch).

## 4. Pathfinding — `crm_path_find {target_person_id, max_hops≤5, k=3}`

Pure kernel policy (`policy/warm_paths.py`), unit-testable like `policy/icp.py`. Load the employee's subgraph (materialized edges ∪ derived structural edges ∪ cross-account colleague edges ∪ target-expansion yellows) into memory — thousands of nodes, tens of thousands of edges — and run **beam search** from the red node:

- Frontier expanded by cumulative score, top-K per hop (K=50); hop cap `max_hops`; **hard rule: hop 1 must be blue** (reachable now by the queue's predicate). A chain whose first link we can't message is not a path — it's a bridge-building candidate (§5).
- Return the **top-k diverse** paths (Yen-style: penalize reuse of an intermediary already in a returned path).
- Postgres recursive CTE as the fast path for the ≤3-hop existence check; Python beam for 4–5.

```
path_score = Π edge_strength(i) × hop_penalty^(hops−1) × Π connector_score(intermediary)
hop_penalty = 0.5   -- policy; grounded in 02 (chains decay 45%→11% with attrition), NOT a measured constant
```

Returned per hop: `from → to`, `channel` (`linkedin` if a thread exists, else `email`), `confidence`, `evidence` in words ("you exchanged 6 messages in August", "both at Deloitte 2019–21"), `why_this_person` (connector rationale), and whether the hop is **actionable now**. Also `best_path_hops` and `path_available` for `list_leads`.

## 5. Bridge-building fallback (a recursion, not a new pipeline)

When no path ≤3 exists (or none at all): pick the yellow with the highest `connector_score × closeness-to-target`, and run it through the **normal pipeline as its own target**:

```
enrich(yellow) → crm_outreach_propose(kind='outreach', value-first, campaign_context=target)
   → approve → send → [reply / thread exists]
   → yellow becomes blue (a linkedin_thread / email_thread edge is materialized)
   → crm_path_find(target) again
```

The only new fact is *why* we're reaching this person (`campaign_context`), so the drafter writes value-first and the intro ask comes **only after a thread exists** — the brief's rule. No invitations: yellow turns blue by email, or by a human-made connection detected through the existing accepted-connection loop (`linkedin_relations`, trial §7).

## 6. Intro campaign state machine — `crm_intro_campaign_start {path_id}`

```
intro_campaigns: id, owner_user_id, target_person_id, target_prospect_id, path JSONB,
                 current_hop INT, status (active|completed|stalled|abandoned),
                 next_action_at, created_at, updated_at
intro_hops:      id, campaign_id, hop_index, from_person_id, to_person_id, channel,
                 approval_id → outreach_approvals, state, attempts,
                 sent_at, reply_at, next_followup_at
hop.state: drafted → pending_approval → sent → awaiting_reply → replied | silent
           replied → forwarded | declined | asked_more
```

- **Every hop is a normal `crm_outreach_propose`** with `kind='intro_request'` plus three new fields: `intent` (`intro_request`), `target_person_id`, `forwardable_blurb` (the double-opt-in note the connector forwards). Approval, decision, policy gate, send — unchanged.
- **Reply detection is built here, because it does not exist (01 §3).** A post-sync step in `linkedin_sync` (and on Gmail sync for email): for each hop `awaiting_reply`, if its thread's `last_from_them` flipped true (or an inbound `imported_messages` row from that person appears) → `replied`, classify the reply (`forwarded | declined | asked_more`, extending the existing thread classifier), notify the owner, advance `current_hop`. This same hook is what finally writes `P6_REPLIED`/`last_replied_at` for ordinary outreach.
- **Follow-ups** from policy: `followup_days: [5, 10]`, max 2 nudges, each a normal proposal; still `silent` → `crm_path_find` again excluding the silent node → next-best path, else bridge-build.
- **Completion** = a thread/email exchange with the target exists (a blue edge to green) → `completed`; the target prospect enters the normal outreach loop with `warm_paths` set.
- **Runtime split, following the enricher pattern:** a new **`warm_intro` timer agent** (registry row, policy row, `AGENTS` allowlist, systemd timer, service enum, `schedule.ts` window) that advances state deterministically — detect replies, schedule follow-ups, pick fallbacks — while **LLM drafting stays in the daily outreach routine**, which gets a second queue section (`intro_hops` due to draft). This keeps "when" deterministic and "what to say" in the one place that already has the skill + approval plumbing.

**Prerequisite fixes to the existing intro path (01 §6):** pass `prospect_id`; make `mark_approval_result` kind-aware (an intro send must not `P5_SENT` the lead but should mark the hop); make the send path kind-aware; change the routine instruction from "note it" to "use it"; expose on the service surface; and a longer TTL for intro asks (`intro_ttl_hours`, e.g. 168) than the 72h cold-draft TTL.

## 7. Tool schemas (service-MCP style)

| Tool | Access | Params | Returns |
|---|---|---|---|
| `crm_graph_sync` | write (LinkedIn `relations`) | `{full?: bool}` | `{edges_added, people_added, linkedin: {…quota…}}` or `{deferred…}` |
| `crm_target_expand` | write (profile/posts) | `{target_person_id*, max_candidates?}` | `{candidates: [{person_id, name, headline, connector_score, evidence[], is_blue}]}` |
| `crm_path_find` | read | `{target_person_id*, max_hops? (≤5, default 3), k? (default 3)}` | `{paths: [{path_id, score, hops: [{from, to, channel, confidence, evidence, why_this_person, actionable_now}]}], bridge_candidates: […]}` |
| `crm_intro_campaign_start` | write | `{path_id*}` | `{campaign_id, current_hop, next: {approval_id?, state}}` |
| `crm_intro_campaign_status` | read | `{campaign_id?, target_person_id?}` | `{status, current_hop, hops: [{index, from, to, state, sent_at, reply_at, next_followup_at}], next_action_at}` |

**Changes:** `crm_outreach_propose` gains `intent`, `target_person_id`, `forwardable_blurb` (all optional; `kind` inferred from `intent`). `list_leads` gains `best_path_hops`, `path_available`, `campaign_status`. `get_run_status` needs no change (the `warm_intro` agent's runs flow through it).

## 8. Risks and open questions

- **Data protection.** A relationship graph is personal data about third parties. Basis: legitimate interest for B2B, with **minimization** (store identity + edge + strength, not message content beyond what `linkedin_messages` already holds), **per-employee opt-in** to ingest their connections, **purge on disconnect/revoke** (`linkedin_accounts.revoked_at` → delete that owner's edges), no purchased data, and a data-source disclosure on request. Structural edges are derived, not stored, precisely to avoid holding "A worked with B" claims. *Open: retention period; whether an employee's edges survive their leaving.*
- **LinkedIn ToS / account risk.** The relations mirror and posts reads raise read volume on a session that is already a ToS breach (`outreach-agentic-research.md:16`). Mitigation: all through the guard's caps + pacing, `relations` is a one-time mirror, posts capped at N=3 per target, never an account we can't afford to lose. *Open: whether `posts`/`comments` reads count against LinkedIn's profile-view heuristics.*
- **Identity resolution.** False merges send an intro to the wrong person and cannot be undone — keep human confirm for any name-only match; auto-merge only on `member_id`.
- **Unverified Unipile shapes.** Comment/reaction records (author id? headline?), `relations` `headline`, whether `list_relations` at `limit=1000` is accepted on every plan. **Validate on one account before Phase B.**
- **Privilege boundary.** The ring elevates board-group users to admin; every cross-owner read must stay **SERVICE-gated** exactly as `list_connected_accounts` is (`enrichment.py:308-309`).
- **The hop penalty is an estimate.** Instrument campaigns (hops attempted / replied / forwarded / completed) so the constant is tuned from our own data within a quarter.

## 9. Phased rollout

**Phase A — foundation (no user-visible intro feature yet).** LinkedIn identity in `channel_handles`; `person_facets`; full relations mirror + incremental (`crm_graph_sync`) + `person_edges`; **reply detection** (writes `P6_REPLIED`/`last_replied_at`, benefits ordinary outreach immediately); fix the five intro-path defects. Deliverable: 1-hop paths (red → blue colleague who is 1st-degree to the target) via the generalized cross-account loop, surfaced as `warm_paths.colleague` for any target.

**Phase B — paths and single-hop campaigns.** `crm_target_expand` (a, b, d; then c after validating the post endpoints), `crm_path_find` ≤3, `intro_campaigns` with one hop and reply-driven completion, the `warm_intro` timer, service tools + docs.

**Phase C — multi-hop.** Hops 4–5 with beam search, the bridge-building recursion, follow-up cadence, next-best fallback, connector-score tuning from instrumentation.

---

**Status: ready for review. No branch, no code, no migrations — per the brief.**
