# Outreach Service API

> Run SalesBrain's outreach pipeline from your own app — find prospects, enrich them, draft
> personalized messages, and send on approval — on behalf of each of **your** users, with their
> leads kept separate.

- **Endpoint:** `POST https://salescrm.chipchip.social/api/service-mcp`
- **Protocol:** MCP over Streamable HTTP — plain JSON-RPC 2.0 (one request in, one response out)
- **MCP version:** `2024-11-05`

---

## 1. What it does, end to end

```
 01 ICP  →  02 Optimize  →  03 Find  →  04 Enrich  →  05 Draft  →  06 Approve  →  07 Send
 target     LLM completes    source &     employer,     first        your user       through the
 spec       + you confirm    score fit    research,     message      says yes,       policy gate
                                          email                       in your UI
```

Every stage is a tool call. Run the whole sequence, or only the parts you need — bring your own
leads and use just drafting + sending, or use the finder and stop at drafts. **Nothing is ever sent
without an explicit approval.**

---

## 2. Core concepts

**Two layers of identity.** Your *app* authenticates with one service token. Each *call* names which
of your users it acts for, via the `X-On-Behalf-Of` header. The token is the app; the header is the
person.

**One owner per employee.** The first time you register an employee, SalesBrain provisions a private
owner for them. Their ICPs, prospects, LinkedIn account, and drafts belong to that owner alone.

**Isolation by default.** Two of your employees never see each other's leads or drafts — nor
SalesBrain's own pipeline. Company records are shared org-wide; the person-level data is private per
employee.

**Approvals live in your UI.** Drafts are never auto-sent. You list an employee's pending drafts,
render them in your product, and post their decision back. **Approve means send now.**

---

## 3. Authentication & headers

A SalesBrain admin issues you one **service token** (from *Profile → Service API*). It is shown once
— store it in your app's secrets. It authenticates your application, not a person.

Every request:

```
Authorization: Bearer svc_XXXXXXXXXXXXXXXX
Content-Type: application/json
```

Every `tools/call` **except** `register_user`:

```
X-On-Behalf-Of: emp-4821      # your stable id for this employee
```

> **Register before you act.** A call for an employee you never registered is rejected with `-32602`.
> Call `register_user` once per employee first.

The `employee_id` is *your* identifier — a UUID, an email, a payroll id, anything stable and opaque to
us. The same value goes in `register_user` and then in the header on every later call. An `app_key`
(baked into your token) namespaces your employees, so `emp-4821` in your app never collides with the
same id in another app.

---

## 4. Protocol

Four JSON-RPC methods:

| Method | Purpose |
|---|---|
| `initialize` | Handshake — returns server info + protocol version. |
| `tools/list` | The catalog (15 tools) with JSON-Schema for each. |
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

Read the structured result from `result._meta.data` — it is the parsed object. (`content[0].text` is
the same thing as a JSON string, for generic MCP clients.) A tool-level failure comes back as
`result.isError: true` with the message in `content[0].text`; transport/auth failures use the
JSON-RPC `error` field.

---

## 5. Integration steps

The order is the pipeline. Do steps 1–2 once per employee; 3 onward as often as you like.

### 1. Get a service token
Ask a SalesBrain admin to issue one under *Profile → Service API*. Store the `svc_…` value in your
backend secrets.

### 2. Register each employee
Provisions their private owner and maps your id to it. Idempotent — safe to call on every login.

```json
"name": "register_user",
"arguments": { "employee_id": "emp-4821", "name": "Dana Okoro", "email": "dana@you.com" }
```

### 3. Optimize the ICP (recommended)
Often you won't have a full ICP — just a product, a sentence, or a website. `suggest_icp` turns whatever you
have into a complete, LinkedIn-mapped ICP (filters + scoring criteria + weights) and returns an `assumptions`
list of everything it INFERRED. **Show it to your user, let them confirm/edit, then pass the confirmed profile to
`crm_icp_define` in the next step.** Saves nothing on its own.

```json
"name": "suggest_icp",
"arguments": { "product": "AI ops automation", "description": "we help mid-market ops teams cut manual work" }
```
→ `{ suggestion: { name, filters, criteria, weights, search_keywords }, rationale, assumptions: ["we assumed US/EU — confirm?"], confidence }`

### 4. Define the ICP
Who this employee is selling to — search filters plus scoring criteria (the confirmed output of step 3, or built
by hand). Re-run with the same `name` to refine; criteria are data, no redeploy.

```json
"name": "crm_icp_define",
"arguments": {
  "name": "US fintech ops leaders",
  "search_keywords": "VP Operations fintech",
  "filters": { "location": ["United States"], "industry": ["Financial Services"] },
  "criteria": { "seniority": ["vp","head"], "company_sizes": ["51-200","201-500"] }
}
```

### 5. Source leads
`crm_leads_finder_run` pulls one page now (spends the LinkedIn daily search budget). Prefer
`crm_agent_request_run` to queue a background pass when it needn't happen this second.

### 6. Enrich the best ones
`crm_enrich_prospect` fills employer, company research + website, and an email address. It contacts no
one. This is what makes a lead reachable and a draft specific.

### 7. Read the list & draft
`list_leads` returns the employee's prospects, best fit first, with reachability. For a chosen person,
`crm_outreach_propose` files a draft — it sends nothing.

### 8. Approve in your UI → send
Show `crm_outreach_pending` in your product. When the employee clicks approve, call
`crm_outreach_decide` — that sends immediately through SalesBrain's policy gate and reports the
outcome.

---

## 6. The send loop & reachability

A message only goes out when a person approves it and the policy gate passes. Two rules decide whether
a person is reachable at all:

- **Email** — needs a discovered address on the person (the enricher finds it). This is the
  first-class channel for brand-new leads.
- **LinkedIn** — needs an **existing thread** on the employee's connected account. There are **no cold
  invitations**. A freshly sourced LinkedIn lead with no prior conversation can only be reached by
  email until a thread exists.

At approval time the gate also enforces quiet hours, per-person frequency caps, per-account daily caps,
and the global kill switch. A denial at that moment is **final** and returned to you — it is not queued
for retry.

---

## 7. LinkedIn onboarding (per employee)

Optional, and only needed for LinkedIn sending. Each employee connects their own account:

1. **Start the connect flow.** `linkedin_connect_start` returns a hosted-auth `url`. Send the employee
   there; they enter their LinkedIn credentials on the provider's page, never on SalesBrain. Pass your
   own `success_redirect_url` / `failure_redirect_url` to bring them back.
2. **Bind the account.** On return, call `linkedin_unbound_accounts` to get the new
   `unipile_account_id`, then `linkedin_link_account` to bind it to that employee. `crm_linkedin_status`
   confirms the connection.

---

## 8. Tool reference

Fifteen tools. Access tags: **setup** establishes identity · **read** only reads · **write** creates or
spends quota · **send** can deliver a message. Required params marked `*`.

### Setup

**`register_user`** · setup — Provision (or re-confirm) an employee's owner. The only tool that needs no
`X-On-Behalf-Of`.
- `employee_id*` — your stable id for this person
- `name` — display name
- `email` — their email, if you have it

### Targeting

**`suggest_icp`** · read (LLM) — Turn partial input (website / product / description / a partial criteria or
filters) into a complete, confirmable ICP + an `assumptions` list of what it inferred + a `confidence`. Saves
nothing. Run before `crm_icp_define`.
- `website` / `product` / `description` — any subset; more is better
- `criteria` / `filters` — a partial draft to optimize
- `name` — optional name for the suggested ICP

**`crm_icp_define`** · write — Create or update a named ICP: filters (who to find) + criteria (what
scores as a fit).
- `name*` — ICP name; re-use to refine
- `search_keywords` — free-text LinkedIn query
- `filters` — `location[]`, `industry[]`, `function[]`, `company[]`, `tenure[]`
- `criteria` — `titles[]`, `seniority[]`, `locations[]`, `industries[]`, `company_sizes[]`,
  `exclude_titles[]`, `exclude_companies[]`, `weights{}`
- `product` — `zeami` | `chipchip`

**`crm_icp_preview`** · read — Dry-run criteria against contacts on file — who it would pick and the fit
distribution. Writes nothing, spends no quota.
- `criteria*` — same shape as `define.criteria`
- `limit` / `sample` — top matches to return / contacts to score

**`crm_icp_list`** · read — This employee's ICP profiles and how many prospects each has found.
- `include_inactive` — include archived ICPs

### Sourcing & enrichment

**`crm_leads_finder_run`** · write — Run one Leads Finder page now: search the next page, score + store
new people, research the best. Spends the daily LinkedIn search budget.
- `icp_id*` — from `crm_icp_list`
- `limit` — candidates this page (≤50)

**`crm_agent_request_run`** · write — Queue a background run; the agent picks it up on its next tick.
- `agent*` — `leads_finder` | `enricher`
- `icp_id*` — target ICP

**`crm_enrich_prospect`** · write — Enrich one prospect now: employer, company research + website, and an
email. Contacts no one.
- `prospect_id*` — from `list_leads`
- `kinds` — subset of `employer`, `research`, `email`

**`list_leads`** · read — The employee's prospects for an ICP (or all), best fit first — contact,
company, score, stage, research summary, reachability.
- `icp_id` — filter to one ICP
- `stage` / `min_score` / `limit` — filter + cap (≤300)

### Outreach

**`crm_outreach_propose`** · write — File a first-message draft for the employee to approve. Sends
nothing. One pending draft per person.
- `person_id*` — the recipient
- `channel*` — `email` | `linkedin`
- `message*` — the full draft, in the employee's voice
- `subject` — email only
- `linkedin_thread_id` — LinkedIn only — an existing thread
- `prospect_id` / `rationale` — link + one-line why

**`crm_outreach_pending`** · read — The employee's drafts awaiting a decision, with the card text. Render
these in your UI.
- `limit` — how many
- `include_decided` — also show recently decided

**`crm_outreach_decide`** · send — Approve or reject as the owner. **Approve sends now** through the
policy gate and reports the outcome; reject files it as skipped.
- `approval_id*` — from `crm_outreach_pending`
- `decision*` — `approve` | `reject`

### LinkedIn

**`linkedin_connect_start`** · write — Mint a hosted-auth link for the employee to connect their
LinkedIn. Returns `url`.
- `success_redirect_url` — where to return on success
- `failure_redirect_url` — where to return on failure

**`linkedin_unbound_accounts`** · read — Connected LinkedIn accounts not yet bound to an owner — pick the
id to link.

**`linkedin_link_account`** · write — Bind a specific account to this employee. Idempotent.
- `unipile_account_id*` — from `linkedin_unbound_accounts`

**`crm_linkedin_status`** · read — Whether this employee has a connected LinkedIn account, and which.

---

## 9. Errors, limits & auditing

| Code | Meaning |
|---|---|
| `401` | Missing or invalid service token. |
| `-32602` | Invalid params — includes an unregistered employee, or a missing `X-On-Behalf-Of`. |
| `-32601` | Unknown method. |
| `isError: true` | Tool ran but failed (e.g. person not reachable, policy denial) — message in `content[0].text`. |

**Rate limits.** 120 requests/min per service token, plus tighter per-tool ceilings on quota-bound
tools (`crm_leads_finder_run`, `crm_enrich_prospect`, `crm_outreach_propose`, `linkedin_connect_start`).
Over the limit returns HTTP 429.

**Auditing.** Every call is logged with the tool, your `app_key` and the acting `employee_id`, status,
and duration.

---

## 10. A minimal client

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
// then, as that employee:
const icp = await call("crm_icp_define", { name: "US fintech ops" }, "emp-4821");
await call("crm_leads_finder_run", { icp_id: icp.id, limit: 25 }, "emp-4821");
```
