# Outreach Service API

> Run SalesBrain's outreach pipeline from your own app — optimize a target profile, find prospects, enrich
> them, draft personalized messages, and send on approval — on behalf of each of **your** users, with their
> leads kept separate.

- **Endpoint:** `POST https://salescrm.chipchip.social/api/service-mcp`
- **Protocol:** MCP over Streamable HTTP — plain JSON-RPC 2.0 (one request in, one response out)
- **MCP version:** `2024-11-05`

---

## 1. What it does, end to end

```
 01 ICP  →  02 Optimize  →  03 Find  →  04 Enrich  →  05 Draft  →  06 Approve  →  07 Send
 target     LLM scores       source &     employer,     first        your user       through the
 spec       candidates,      score fit    research,     message      says yes,       policy gate
            you confirm                   email                      in your UI
```

Every stage is a tool call. Run the whole sequence, or only the parts you need — bring your own leads and use
just drafting + sending, or use the finder and stop at drafts. **Nothing is ever sent without an explicit
approval.**

### The stages, and what your system does at each

| # | Stage | What it means | Your system calls | Your system's UI / job |
|---|---|---|---|---|
| — | *(setup)* | Map your user to a private SalesBrain owner (once) | `register_user` | On first login of an employee |
| **01** | **ICP** | Define who to target | *(the raw idea — a product, a sentence, a rough list)* | Collect whatever the user knows |
| **02** | **Optimize** | LLM completes it, you confirm | `suggest_icp` → `crm_icp_define` | Show the scored candidates, let the user pick/edit one, then save it |
| **03** | **Find** | Source from LinkedIn, score fit | `crm_leads_finder_run` (or `crm_agent_request_run` to queue) | Trigger a run; poll `list_leads` for results |
| **04** | **Enrich** | Employer, research, email | `crm_enrich_prospect` | Enrich the best leads so they're reachable + specific |
| **05** | **Draft** | Personalized first message | `crm_outreach_propose` | File a draft per chosen person (sends nothing) |
| **06** | **Approve** | Your user says yes, in your UI | `crm_outreach_pending` → `crm_outreach_decide` | Render pending drafts; on the user's approve, decide |
| **07** | **Send** | Through the policy gate | *(the `approve` decision above sends it)* | Show the outcome returned by `crm_outreach_decide` |

Everything acts for a specific employee via the `X-On-Behalf-Of` header (see §3), except the setup/optimize calls,
which need no header. §5 walks each step with real payloads.

---

## 2. Core concepts

**Two layers of identity.** Your *app* authenticates with one service token. Each *call* names which of your
users it acts for, via the `X-On-Behalf-Of` header. The token is the app; the header is the person.

**One owner per employee.** The first time you register an employee, SalesBrain provisions a private owner for
them. Their ICPs, prospects, LinkedIn account, and drafts belong to that owner alone.

**Isolation by default.** Two of your employees never see each other's leads or drafts — nor SalesBrain's own
pipeline. Company records are shared org-wide; the person-level data is private per employee.

**Approvals live in your UI.** Drafts are never auto-sent. You list an employee's pending drafts, render them in
your product, and post their decision back. **Approve means send now.**

**Many ICPs per employee; `name` is the identity.** There is no per-employee limit and no operator step. A new
`name` on `crm_icp_define` creates a new profile alongside the existing ones; a name you have used before
updates *that* profile in place. So keep the name stable and distinct per profile — re-sending a name
overwrites rather than adds, and paraphrasing it ("Tech Founders" → "Technical Founders") quietly creates a
near-duplicate. `crm_icp_list` shows what exists; `crm_icp_archive` retires one.

**Vocabulary is closed, and unknown values are dropped in silence.** `seniority`, `industries`, `locations` and
`company_sizes` are enumerated sets matched exactly. An unrecognised value is not an error — the ICP saves
happily and simply scores nothing on that dimension, which is the usual reason a profile looks correct and
returns zero strong fits. Seniority in particular is **lowercase keys**:

`c_level` · `founder` · `vp` · `head` · `director` · `manager` · `senior`

`"C-Level"`, `"C-Suite"`, `"Owner"`, `"Executive"` all score nothing. Industries and locations must be LinkedIn
names (`"Financial Services"`, `"Software Development"`, `"United Kingdom"`). `titles[]` and `exclude_titles[]`
are the exception: free text, matched as keywords. When in doubt call `suggest_icp` first and use the values it
returns — they are already in the vocabulary.

---

## 3. Authentication & headers

A SalesBrain admin issues you one **service token** (from *Profile → Service API*). It is shown once — store it
in your app's secrets. It authenticates your application, not a person.

Every request:

```
Authorization: Bearer svc_XXXXXXXXXXXXXXXX
Content-Type: application/json
```

Every `tools/call` **except** `register_user` and `suggest_icp`:

```
X-On-Behalf-Of: emp-4821      # your stable id for this employee
```

> **Register before you act.** A call for an employee you never registered is rejected with `-32602`. Call
> `register_user` once per employee first. (`register_user` and `suggest_icp` are stateless and need no header.)

The `employee_id` is *your* identifier — a UUID, an email, a payroll id, anything stable and opaque to us. The
same value goes in `register_user` and then in the header on every later call. An `app_key` (baked into your
token) namespaces your employees, so `emp-4821` in your app never collides with the same id in another.

---

## 4. Protocol

Four JSON-RPC methods:

| Method | Purpose |
|---|---|
| `initialize` | Handshake — returns server info + protocol version. |
| `tools/list` | The catalog (24 tools) with JSON-Schema for each. |
| `tools/call` | Invoke one tool. This is where the work happens. |
| `ping` | Health check. |

**Request — `tools/call`:**

```json
{
  "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": {
    "name": "crm_leads_finder_run",
    "arguments": { "icp_id": "…", "limit": 25 }
  }
}
```

**Response — success:**

```json
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "{…json string…}" }],
    "_meta": { "data": { /* the same result, already parsed */ } }
  }
}
```

Read the structured result from `result._meta.data` — it is the parsed object. (`content[0].text` is the same
thing as a JSON string, for generic MCP clients.) A tool-level failure comes back as `result.isError: true` with
the message in `content[0].text`; transport/auth failures use the JSON-RPC `error` field.

---

## 5. Integration steps

The order is the pipeline. Do steps 1–2 once per employee; 3 onward as often as you like.

### 1. Get a service token
Ask a SalesBrain admin to issue one under *Profile → Service API*. Store the `svc_…` value in your backend
secrets.

### 2. Register each employee
Provisions their private owner and maps your id to it. Idempotent — safe to call on every login.

```json
"name": "register_user",
"arguments": { "employee_id": "emp-4821", "name": "Dana Okoro", "email": "dana@you.com" }
```

### 3. Optimize the ICP (recommended)
Often you won't have a full ICP — just a product, a sentence, maybe a website. `suggest_icp` turns whatever you
have into **2–4 candidate ICPs**, each a complete LinkedIn-mapped profile (filters + criteria + weights) **scored
1–5 on five strategic objectives** — speed_to_market, volume, margin, logo, test_cases — plus an `assumptions`
list of what it inferred. Pass an optional primary `objective` and the recommended candidate is tuned to it.
**Show the candidates, let your user pick/edit one, then pass it to `crm_icp_define`.** Saves nothing.

```json
"name": "suggest_icp",
"arguments": { "product": "AI ops automation", "description": "we help mid-market ops teams cut manual work", "objective": "margin" }
```
→ `{ recommended_index: 0, candidates: [ { suggestion:{name,filters,criteria,weights,search_keywords}, objective_scores:{speed_to_market,volume,margin,logo,test_cases}, rationale, assumptions:[…], confidence } ] }`

### 4. Define the ICP
The confirmed candidate (or one built by hand) — search filters plus scoring criteria, and the chosen objective.
Re-run with the same `name` to refine; criteria are data, no redeploy.

```json
"name": "crm_icp_define",
"arguments": {
  "name": "US fintech ops leaders",
  "objective": "margin",
  "search_keywords": "VP Operations fintech",
  "filters": { "location": ["United States"], "industry": ["Financial Services"] },
  "criteria": { "seniority": ["vp","head"], "company_sizes": ["51-200","201-500"] }
}
```

### 5. Source leads
`crm_leads_finder_run` pulls one page now (spends the LinkedIn daily search budget). Prefer
`crm_agent_request_run` to queue a background pass when it needn't happen this second.

### 6. Enrich the best ones
`crm_enrich_prospect` fills employer, company research + website, and an email address. It contacts no one. This
is what makes a lead reachable and a draft specific.

### 7. Read the list & draft
`list_leads` returns the employee's prospects, best fit first, with reachability. For a chosen person,
`crm_outreach_propose` files a draft — it sends nothing.

### 8. Approve in your UI → send
Show `crm_outreach_pending` in your product. When the employee clicks approve, call `crm_outreach_decide` — that
sends immediately through SalesBrain's policy gate and reports the outcome.

---

## 6. The send loop & reachability

A message only goes out when a person approves it and the policy gate passes. Two rules decide whether a person
is reachable at all:

- **Email** — needs a discovered address on the person (the enricher finds it). This is the first-class channel
  for brand-new leads.
- **LinkedIn** — needs an **existing thread** on the employee's connected account. There are **no cold
  invitations**. A freshly sourced LinkedIn lead with no prior conversation can only be reached by email until a
  thread exists.

At approval time the gate also enforces quiet hours, per-person frequency caps, per-account daily caps, and the
global kill switch. A denial at that moment is **final** and returned to you — it is not queued for retry.

### LinkedIn safe-rate — quota & block protection

The two LinkedIn-spending tools — `crm_leads_finder_run` and `crm_enrich_prospect` — are guarded so an employee's
LinkedIn account is never pushed into a block. **You don't have to track limits yourself; the response tells you.**

- **Quota used for the period** → the call is *deferred, not failed*. You get a normal success result with:
  ```json
  { "deferred": true, "status": "rate_limited",
    "message": "LinkedIn search quota for this period is used (12/12 today). We'll resume automatically after 2026-09-04T09:20:00Z.",
    "resume_at": "2026-09-04T09:20:00Z",
    "linkedin": { "search": {"used":12,"cap":12,"remaining":0,"resume_at":"…"}, "profile": {…}, "tier":"free", "paused":false } }
  ```
  Show `message` to your user and retry after `resume_at` — no LinkedIn call was spent. (`status` is `paused` if
  the account was auto-paused after LinkedIn pushed back, or `not_connected` if there's no linked account.)
- **Approaching the limit** → a successful call still carries the remaining budget and a heads-up so you can warn
  your user *before* the next call gets risky:
  ```json
  { "…tool result…",
    "linkedin": { "search": {"used":10,"cap":12,"remaining":2,"resume_at":"…"}, … },
    "warnings": ["Only 2 LinkedIn searches left today for this account (10/12) — approaching the safe limit. It resumes after 2026-09-04T09:20:00Z."] }
  ```
- **`crm_linkedin_quota`** (read) returns the same budget snapshot on demand (search + profile daily budgets, used
  / cap / remaining / `resume_at`, tier, pause state, recent blocks) — call it to render a "LinkedIn budget" meter
  in your UI at any time.

Under the hood every LinkedIn call is also paced (a minimum gap between calls) and the account is paused
immediately if LinkedIn ever returns a rate-limit/challenge — so even a burst of calls can't get it blocked.

---

## 6b. Tracking a run

Two ways to source, and they differ in how you observe them:

**Synchronous — no polling needed.** `crm_leads_finder_run` does the search inline and returns the counts
(`analyzed / matched / new / already_known / researched`, `top`, `budget`). Use this when a user is waiting.

**Queued — poll it.** `crm_agent_request_run` hands back a **`run_id`**, and the background timer mutates *that
same row* (`requested → running → success | partial | error | skipped`). The ack is self-describing:

```json
{ "requested": true, "run_id": "…", "icp": "…", "status": "requested",
  "poll_with": "get_run_status",
  "next_tick_window": { "earliest": "…", "latest": "…", "note": "…jitter / not replayed / needs budget…" },
  "readiness": { "connected": true, "paused": false, "search": {"used":4,"cap":12,"remaining":8,"resume_at":"…"} } }
```

Then poll **`get_run_status { run_id }`** until `done: true`:

```json
{ "found": true, "run_id": "…", "agent": "leads_finder",
  "status": "skipped", "done": true, "trigger": "requested",
  "analyzed": 0, "matched": 0, "created": 0, "researched": 0,
  "reason": "daily search budget spent (12/12)",     // why a tick did nothing, verbatim
  "error": null, "icp_name": "…", "lead_count": 43,
  "readiness": { … } }
```
While still pending it also carries `queued_runs` + `next_tick_window`. **`reason` is the field to surface to your
user** — it explains every no-op (budget spent, account paused, kill switch, backoff, exhausted).

**Timing, honestly.** The agent runs on a timer (four times a day) with up to 30 minutes of jitter, so we return a
**window, not an ETA**. A tick missed while the box was down is *not* replayed, and the run still needs an
unpaused account and remaining budget. If you need certainty, use the synchronous tool.

**Refused before it's queued.** If the employee has no LinkedIn connected, `crm_agent_request_run` does **not**
create a run that would silently skip — it returns immediately:

```json
{ "refused": true, "status": "not_connected",
  "message": "No LinkedIn account is connected for this employee — sourcing can't run, so nothing was queued. Send them a connect link with linkedin_connect_start, then queue the run again." }
```

For a broader view, `crm_agent_activity` lists recent runs and `crm_agent_status` shows whether the agents are
enabled at all.

---

## 7. LinkedIn onboarding (per employee)

Optional, and only needed for LinkedIn sending. Each employee connects their own account:

1. **Start the connect flow.** `linkedin_connect_start` returns a hosted-auth `url`. Send the employee there;
   they enter their LinkedIn credentials on the provider's page, never on SalesBrain. Pass your own
   `success_redirect_url` / `failure_redirect_url` to bring them back.
2. **Bind the account.** On return, call `linkedin_unbound_accounts` to get the new `unipile_account_id`, then
   `linkedin_link_account` to bind it to that employee. `crm_linkedin_status` confirms the connection.
3. **Disconnect (when needed).** `crm_linkedin_revoke` unbinds the account AND ends the session at the provider
   (the Unipile account is deleted). Mirrored conversation history is kept. The employee can reconnect later by
   starting the flow again from step 1 — a reconnect creates a fresh account, it does not resurrect the old one.

---

## 8. Tool reference

Twenty-four tools. Access tags: **setup** establishes identity · **read** only reads · **write** creates or spends
quota · **send** can deliver a message. Required params marked `*`.

Every tool except `register_user` and `suggest_icp` requires the `X-On-Behalf-Of` header and acts only on that
employee's data.

| | Tool | Access | What it is for |
|---|---|---|---|
| **Setup** | `register_user` | setup | Map one of your users to a SalesBrain owner. Do this once, before anything else |
| | `linkedin_connect_start` | write | Mint a hosted-auth link for the employee to connect LinkedIn |
| | `linkedin_unbound_accounts` | read | Connected accounts not yet bound to an owner |
| | `linkedin_link_account` | write | Bind one of those to this employee |
| | `crm_linkedin_status` | read | Is LinkedIn connected for this employee |
| | `crm_linkedin_revoke` | write | Disconnect it and end the session at the provider |
| **Targeting** | `suggest_icp` | read | Website or notes in, scored candidate ICPs out. Saves nothing |
| | `crm_icp_define` | write | Create or update a profile. **A new `name` creates; a used `name` overwrites** |
| | `crm_icp_preview` | read | Dry-run criteria against contacts on file |
| | `crm_icp_list` | read | Their profiles, with `state` and lead counts |
| | `crm_icp_set_state` | write | **running / paused / stopped**, per profile |
| | `crm_icp_archive` | write | Retire one (same as `state: "stopped"`) |
| | `crm_icp_rescore` | write | Re-score existing leads after editing criteria |
| **Sourcing** | `crm_leads_finder_run` | write | Source one page now. Spends LinkedIn search quota |
| | `crm_agent_request_run` | write | Queue a background run instead of waiting |
| | `crm_enrich_prospect` | write | Fill employer, company, email for one lead |
| | `list_leads` | read | The lead list, filterable by ICP, stage and fit |
| **Visibility** | `get_run_status` | read | Poll a queued or finished run. The poll loop |
| | `crm_agent_activity` | read | Recent runs and why a tick was skipped |
| | `crm_agent_status` | read | Agent switches, caps, `sourcing_paused`, paused accounts |
| | `crm_linkedin_quota` | read | Today's LinkedIn budget and when it resets |
| **Outreach** | `crm_outreach_propose` | write | File a draft for approval |
| | `crm_outreach_pending` | read | Drafts awaiting a decision — render these in your UI |
| | `crm_outreach_decide` | **send** | Approve or skip. **Approve sends immediately** |

### Setup

**`register_user`** · setup — Provision (or re-confirm) an employee's owner. Needs no `X-On-Behalf-Of`.
- `employee_id*` — your stable id for this person
- `name` — display name · `email` — their email, if you have it

### Targeting

**`suggest_icp`** · read (LLM) — Turn partial input into **2–4 candidate ICPs**, each a full profile scored 1–5
on the five objectives (`objective_scores`) with `assumptions` + `confidence`; `recommended_index` flags the best
fit. Saves nothing. Needs no `X-On-Behalf-Of`. Run before `crm_icp_define`.
- `website` / `product` / `description` — any subset; more is better
- `criteria` / `filters` — a partial draft to optimize
- `objective` — primary goal to tune the recommendation to: `speed_to_market` | `volume` | `margin` | `logo` | `test_cases`
- `n_candidates` — how many candidates (2–4, default 3) · `name` — optional name

**`crm_icp_define`** · write — Create or update an ICP: filters (who to find) + criteria (what scores as a fit).
**`name` is the identity** — a new name creates a profile alongside the existing ones, a name already in use
updates that one in place. An employee may hold many at once.
- `name*` — the profile identity. Keep it stable and distinct; see "Many ICPs per employee" in §2
- `objective` — the strategic goal it optimizes for (from `suggest_icp`): one of the five above
- `search_keywords` — free-text LinkedIn query
- `filters` — `location[]`, `industry[]`, `function[]`, `company[]`, `tenure[]`
- `criteria` — `titles[]`, `seniority[]`, `locations[]`, `industries[]`, `company_sizes[]`, `exclude_titles[]`, `exclude_companies[]`, `weights{}`
- `product` — `zeami` | `chipchip`

Closed vocabularies apply (§2): `seniority` is lowercase `c_level | founder | vp | head | director | manager |
senior`; industries and locations must be LinkedIn names. Unknown values save without error and score nothing.

Two calls, two live profiles — this is how you add a profile rather than replace one:

```json
{ "name": "crm_icp_define", "arguments": {
    "name": "Hands-On Technical Founder/CTO",
    "criteria": { "titles": ["CTO", "Head of Engineering"], "seniority": ["c_level", "founder"] } } }

{ "name": "crm_icp_define", "arguments": {
    "name": "PE Portfolio Operators",
    "criteria": { "titles": ["COO", "CFO", "Operations Director"],
                  "seniority": ["c_level", "director"],
                  "industries": ["Venture Capital and Private Equity", "Manufacturing"] } } }
```

`crm_icp_list` now returns **two** profiles. Sending the second payload under the *first* name would instead
have overwritten it, leaving one.

**`crm_icp_preview`** · read — Dry-run criteria against contacts on file — who it would pick and the fit
distribution. Writes nothing, spends no quota.
- `criteria*` — same shape as `define.criteria`
- `limit` / `sample` — top matches to return / contacts to score

**`crm_icp_list`** · read — This employee's ICP profiles (with `objective`) and how many prospects each has found.
- `include_inactive` — include archived ICPs

**`crm_icp_set_state`** · write — Start, hold or retire ONE ICP. This is the per-profile switch: it affects
that profile only, not the employee's other ICPs and not anyone else.
- `icp_id*` · `state*` — `running` | `paused` | `stopped` · `reason` — shown wherever the hold is reported

| State | What runs | Notes |
|---|---|---|
| `running` | sourcing, enrichment, drafting, sending | the default |
| `paused` | **nothing** | leads and history untouched; one call puts it back. Use this for a temporary hold |
| `stopped` | nothing | retired; hidden from `crm_icp_list` unless `include_inactive` |

`paused` stops the **send** path too: no new drafts are queued for that ICP's leads, so there is nothing to
approve. A pause set by a SalesBrain administrator can only be lifted by one, and `crm_icp_define` does **not**
clear a pause — editing a profile cannot quietly resume work an operator stopped.

`crm_icp_list` returns `state` (`running` | `paused` | `stopped`) plus `paused_at`, `paused_reason` and
`paused_by_admin` on every profile.

**`crm_icp_archive`** · write — Retire an ICP (soft): agents stop sourcing for it, prospects keep their link.
Use it to put a profile on standby; re-defining the same `name` with `crm_icp_define` revives it.
- `icp_id*` — from `crm_icp_list`

**`crm_icp_rescore`** · write — Re-score every open prospect on an ICP with its current criteria. Call it after
editing an ICP via `crm_icp_define` so existing leads reflect the new rules. Creates and contacts nothing.
- `icp_id*` — from `crm_icp_list` · `limit` — prospects to re-score (default 2000)

**Verify your writes.** A successful `crm_icp_define` returns the saved profile including its `id` — that id
appearing in the response IS the confirmation. If your call errored, or you never made it, there is nothing to
report as "applied": confirm with `crm_icp_list` before telling your user a configuration is live. Every call you
make is audit-logged on our side, so a claimed write with no matching call is visible.

**Multi-profile configs.** A targeting document with several profiles or market tiers maps to SEVERAL ICPs — one
`crm_icp_define` per profile × market (e.g. "Avocado Buyers — Kenya (T1)", "Avocado Buyers — Gulf (T2)", "Pulses
Buyers — Kenya (T1)"), since an ICP carries one location set and one criteria set. Standby profiles: define them,
then `crm_icp_archive` (revive later by re-defining the same name). Edits: re-define the same name, then
`crm_icp_rescore`. Sourcing: `crm_agent_request_run` per ACTIVE ICP, then poll `get_run_status`. Rules an ICP
cannot express (custom point values, research gates, per-tier budget ordering) stay in your agent's own logic.

### Sourcing & enrichment

**`crm_leads_finder_run`** · write — Run one Leads Finder page now: search the next page, score + store new
people, research the best. Spends the daily LinkedIn search budget.
- `icp_id*` — from `crm_icp_list` · `limit` — candidates this page (≤50)

**`crm_agent_request_run`** · write — Queue a background run; the agent picks it up on its next tick.
- `agent*` — `leads_finder` | `enricher` · `icp_id*` — target ICP

**`crm_enrich_prospect`** · write — Enrich one prospect now: employer, company research + website, and an email.
Contacts no one.
- `prospect_id*` — from `list_leads` · `kinds` — subset of `employer`, `research`, `email`

**`list_leads`** · read — The employee's prospects for an ICP (or all), best fit first — contact, company, score,
stage, research summary, reachability.
- `icp_id` — filter to one ICP · `stage` / `min_score` / `limit` — filter + cap (≤300)

### Run visibility

**`get_run_status`** · read — Track a queued or finished run: `status`, `done`, counts, the skip `reason`
verbatim, `error`, `lead_count`, plus (while pending) `queued_runs` and `next_tick_window`, and always
`readiness`. **This is the poll loop.**
- `run_id` — from `crm_agent_request_run` · `icp_id` — alternative: that ICP's latest run

**`crm_agent_activity`** · read — Recent runs for this employee: status, trigger, source/query, counts, skip
reason, error.
- `agent` — `leads_finder` | `outreach` | `enricher` · `icp_id` · `limit` (default 30)

**`crm_agent_status`** · read — Each agent's `enabled` flag, caps + schedule, its last run and 24h totals, and
any LinkedIn account paused for agent work.

> **`kill_switch: true` means agents are ALLOWED to run.** It is the master enable, not a brake — `true` is the
> healthy value and `false` means every agent is halted globally. Because that name reads backwards, the
> response also carries **`sourcing_paused`**, the same fact stated safely: `sourcing_paused: false` = sourcing
> is running normally. Whether a *particular* agent runs is its own `enabled` flag, not this one.

**`crm_linkedin_quota`** · read — Today's LinkedIn budget: searches and profile fetches used vs the safe cap,
`remaining`, `resume_at`, tier, pause state.

### Outreach

**`crm_outreach_propose`** · write — File a first-message draft for the employee to approve. Sends nothing. One
pending draft per person.
- `person_id*` — the recipient · `channel*` — `email` | `linkedin` · `message*` — the full draft
- `subject` — email only · `linkedin_thread_id` — LinkedIn only, an existing thread
- `prospect_id` / `rationale` — link + one-line why

**`crm_outreach_pending`** · read — The employee's drafts awaiting a decision, with the card text. Render these
in your UI.
- `limit` — how many · `include_decided` — also show recently decided

**`crm_outreach_decide`** · send — Approve or reject as the owner. **Approve sends now** through the policy gate
and reports the outcome; reject files it as skipped.
- `approval_id*` — from `crm_outreach_pending` · `decision*` — `approve` | `reject`

### LinkedIn

**`linkedin_connect_start`** · write — Mint a hosted-auth link for the employee to connect their LinkedIn.
Returns `url`.
- `success_redirect_url` / `failure_redirect_url` — where to return on success / failure

**`linkedin_unbound_accounts`** · read — Connected LinkedIn accounts not yet bound to an owner — pick the id to
link.

**`linkedin_link_account`** · write — Bind a specific account to this employee. Idempotent.
- `unipile_account_id*` — from `linkedin_unbound_accounts`

**`crm_linkedin_status`** · read — Whether this employee has a connected LinkedIn account, and which.

**`crm_linkedin_revoke`** · write — Disconnect this employee's LinkedIn account. Stops syncing/sending and ends
the session at the provider (deletes the Unipile account, so it stops being billed). Mirrored threads are kept as
history. If the result carries a `delivery_note`, the CRM side is revoked but the provider deletion failed — the
account must then be removed from the Unipile dashboard by the operator.

**`crm_linkedin_quota`** · read — This employee's LinkedIn spend budget for the day: searches + profile fetches
used vs the safe cap, `remaining`, `resume_at`, tier, pause state, and recent block count. The same snapshot the
spending tools attach as `linkedin`.

### Relationship graph

Each employee has a private graph of the people they actually know, scored by how warm the connection is
right now. It is built from data already on file — imported LinkedIn contacts, mirrored LinkedIn threads,
synced email — plus a paginated mirror of their LinkedIn 1st-degree ring. It contacts no one and spends no
search or profile budget, and an employee with no LinkedIn connected still gets a graph from the rest.

This is the foundation for warm-introduction pathfinding. Path search and intro campaigns are not built yet;
today the graph is readable and can be rebuilt on demand.

**`crm_graph_sync`** · write — Build this employee's graph now. Free sources always run; the LinkedIn mirror
pages only while today's `relations` budget allows and resumes on the next call.
- `sources` — any of `contacts`, `threads`, `email`, `relations`, `linkedin` (default: all)
- `max_pages` — LinkedIn relations pages this call (default 2, max 5). For a full first mirror, queue the
  agent instead: `crm_agent_request_run {agent: "graph_sync"}` — no `icp_id`.

**`crm_graph_status`** · read — Size by source, average strength, mirror progress, and how many of the
employee's imported contacts have been bridged into the graph.

**`crm_graph_edges`** · read — The strongest people in the graph, with the evidence behind each score.
- `limit` — default 50, max 500
- `source` — one of `linkedin_csv`, `linkedin_relation`, `linkedin_thread`, `email_thread`,
  `intro_confirmed`, `manual`

> **Strength is a decayed score, not a flag.** `base[source] x 0.5 ^ (days_since_last_signal / 180)`. A reply
> outranks a connection; a 2014 connection outranks almost nothing. Contacts imported before this shipped
> carry no connection date and are scored at a flat mid-value until the employee re-uploads their
> Connections.csv.

---

## 9. Admin: issuing a token

A SalesBrain admin mints one token per consuming app, in the UI at *Profile → Service API* (admin only) or:

```http
POST /api/admin/service-tokens        (cookie-authed, admin)
{ "app_key": "chipchip-outbound", "name": "ChipChip outbound app (prod)" }
→ { "token": "svc_…", … }             # shown ONCE — store it in the app's secrets
```

`GET` lists active tokens (prefix only); `DELETE ?id=<uuid>` revokes one.

---

## 10. Errors, limits & auditing

| Code | Meaning |
|---|---|
| `401` | Missing or invalid service token. |
| `-32602` | Invalid params — includes an unregistered employee, or a missing `X-On-Behalf-Of`. |
| `-32601` | Unknown method. |
| `isError: true` | Tool ran but failed (e.g. person not reachable, policy denial) — message in `content[0].text`. |

**Rate limits.** 120 requests/min per service token, plus tighter per-tool ceilings on the heavy tools
(`crm_leads_finder_run`, `crm_enrich_prospect`, `crm_outreach_propose`, `suggest_icp`, `linkedin_connect_start`).
Over the limit returns HTTP 429.

**Auditing.** Every call is logged with the tool, your `app_key` and the acting `employee_id`, status, and
duration.

---

## 11. A minimal client

```js
const BASE = "https://salescrm.chipchip.social/api/service-mcp";

async function call(tool, args, employeeId) {
  const headers = {
    "Authorization": `Bearer ${process.env.SALESBRAIN_SERVICE_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (employeeId) headers["X-On-Behalf-Of"] = employeeId;
  const res = await fetch(BASE, {
    method: "POST", headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  if (json.result?.isError) throw new Error(json.result.content[0].text);
  return json.result._meta.data;
}

// per employee, once:
await call("register_user", { employee_id: "emp-4821", name: "Dana Okoro" });

// optimize → confirm → define (no X-On-Behalf-Of needed for suggest_icp):
const opt = await call("suggest_icp", { product: "AI ops automation", objective: "margin" });
const chosen = opt.candidates[opt.recommended_index].suggestion;
const icp = await call("crm_icp_define", { ...chosen, objective: "margin" }, "emp-4821");

// source:
await call("crm_leads_finder_run", { icp_id: icp.id, limit: 25 }, "emp-4821");
```

---

## 12. Changelog

### 2026-09-06 — per-ICP control, and two corrections

**New: `crm_icp_set_state`** (§8 Targeting). Start, hold or retire one profile — `running` | `paused` |
`stopped` — affecting that profile only, not the employee's others and not anyone else. `paused` stops
sourcing, enrichment, drafting **and sending** for it, keeps the leads and history intact, and reverses in one
call. `crm_icp_list` now returns `state`, `paused_at`, `paused_reason` and `paused_by_admin` per profile.

Two behaviours to code against: `crm_icp_define` does **not** clear a pause, and a pause set by a SalesBrain
administrator can only be lifted by one. `crm_agent_request_run` against a paused ICP now **refuses** with
`status: "icp_paused"` rather than queueing a run that would skip on every tick.

**Clarified: an employee may hold many ICPs at once, and `name` is the identity.** There is no per-employee
limit and no operator step. A new `name` creates a profile alongside the existing ones; a name already in use
updates that one **in place**. Keep names stable and distinct — re-sending a name overwrites rather than adds,
and paraphrasing one creates a near-duplicate. This was always the behaviour; only the documentation changed.

**Clarified: `kill_switch: true` means agents are ALLOWED to run.** It is the master enable, not a brake, so
`true` is the healthy value. `crm_agent_status` now also returns **`sourcing_paused`**, the same fact stated the
safe way round.

**Documented: the vocabularies are closed and fail silently** (§2). `seniority` must be lowercase
(`c_level` · `founder` · `vp` · `head` · `director` · `manager` · `senior`); industries and locations must be
LinkedIn names. An unrecognised value is not an error — the ICP saves and simply scores nothing on that
dimension, which is the usual reason a profile looks right and returns no strong fits.

### Earlier

`crm_linkedin_revoke` (disconnect + end the provider session) · `crm_icp_archive` and `crm_icp_rescore` ·
run visibility (`get_run_status`, readiness pre-flight, refuse-early) · LinkedIn safe-rate guard on the
spending tools (`crm_linkedin_quota`, deferral envelopes) · `suggest_icp` objective-scored candidates.
