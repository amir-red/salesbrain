# SalesBrain — Outreach as a Service (MCP)

A dedicated endpoint that lets a **sibling internal app** run SalesBrain's full
outreach pipeline (ICP → source → enrich → draft → approve → send) on behalf of
**its own employees**. It speaks **MCP over Streamable HTTP (JSON-RPC 2.0)** —
the same protocol as `/api/mcp`, but with an app-level identity model.

- **Base URL:** `https://salescrm.chipchip.social/api/service-mcp`
- **Protocol:** JSON-RPC 2.0. Methods: `initialize`, `tools/list`, `tools/call`, `ping`.

---

## 1. Identity model

Two layers of identity travel on every request:

| Layer | How | Meaning |
|---|---|---|
| **App** | `Authorization: Bearer svc_…` | Which consuming app is calling. One token per app; issued by a SalesBrain admin. Authenticates the app, not a person. |
| **Employee** | `X-On-Behalf-Of: <employee_id>` | Which of your users this call acts as. Each maps 1:1 to a provisioned SalesBrain owner; all their ICPs, prospects, LinkedIn account and drafts are private to them. |

The `employee_id` is **your** stable identifier (uuid, email, payroll id — opaque
to us). You send it once at `register_user`, then on every subsequent call via
the `X-On-Behalf-Of` header (or an `employee_id` argument).

**Register before use.** A `tools/call` for an unregistered employee is rejected.

Data isolation: every employee gets a distinct SalesBrain owner, so leads and
drafts never mix between your employees (or with SalesBrain's own pipeline).
Companies (`accounts`) are shared org-wide, as they already are internally.

---

## 2. Handshake

```http
POST /api/service-mcp
Authorization: Bearer svc_XXXXXXXX
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 1, "method": "initialize" }
```

`tools/list` returns the catalog below. Every `tools/call` looks like:

```http
POST /api/service-mcp
Authorization: Bearer svc_XXXXXXXX
X-On-Behalf-Of: emp-4821
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "crm_leads_finder_run", "arguments": { "icp_id": "…", "limit": 25 } } }
```

Success → `result.content[0].text` is the JSON string; `result._meta.data` is the
same parsed. Tool-level failures come back as `result.isError = true` with the
message in `content[0].text` (JSON-RPC transport errors use the `error` field).

---

## 3. Tools

**Setup**
- `register_user { employee_id, name?, email? }` — provision/confirm an employee. Idempotent. The only tool that needs no `X-On-Behalf-Of`.

**Targeting (ICP)**
- `crm_icp_define { name, product?, description?, search_keywords?, filters?, criteria? }` — create/refine an ICP.
- `crm_icp_preview { criteria, limit?, sample? }` — dry-run scoring; writes nothing.
- `crm_icp_list { include_inactive? }` — this employee's ICPs + counts.

**Sourcing + enrichment**
- `crm_leads_finder_run { icp_id, limit? }` — run one Leads Finder page now (spends the LinkedIn daily search budget).
- `crm_agent_request_run { agent: "leads_finder"|"enricher", icp_id }` — queue a background run instead of spending now.
- `crm_enrich_prospect { prospect_id, kinds? }` — employer + company research + email for one prospect.
- `list_leads { icp_id?, stage?, min_score?, limit? }` — the employee's prospects, best fit first.

**Outreach (draft → approve in YOUR UI → send)**
- `crm_outreach_propose { person_id, channel, message, prospect_id?, subject?, rationale?, linkedin_thread_id? }` — file a draft. Sends nothing.
- `crm_outreach_pending { limit?, include_decided? }` — drafts awaiting a decision. Render these in your UI.
- `crm_outreach_decide { approval_id, decision: "approve"|"reject" }` — **approve = send now** through the policy gate; reject = skip.

**LinkedIn onboarding (per employee)**
- `linkedin_connect_start { success_redirect_url?, failure_redirect_url? }` — returns a Unipile hosted-auth URL for the employee to connect their LinkedIn.
- `linkedin_unbound_accounts {}` — LinkedIn accounts on Unipile not yet bound; pick the id to link.
- `linkedin_link_account { unipile_account_id }` — bind that account to the employee.
- `crm_linkedin_status {}` — is a LinkedIn account connected for this employee.

---

## 4. The send loop (how a message actually goes out)

1. Define an ICP → `crm_leads_finder_run` (or queue it) → `crm_enrich_prospect` for the best hits.
2. `crm_outreach_propose` files a **draft** — nothing is sent.
3. Show pending drafts in your UI via `crm_outreach_pending`.
4. On the employee's click, `crm_outreach_decide { approve }` sends **immediately** through SalesBrain's policy gate (quiet hours, per-person frequency caps, per-account daily caps, kill switch). A denial at that moment is final and reported back.

**Reachability rules (important):**
- **Email** send needs a discovered email address on the person (the Enricher finds it).
- **LinkedIn** send needs an **existing thread** on the employee's connected account — there are **no cold invites**. A freshly sourced LinkedIn lead with no prior thread can only be reached by **email** until a conversation exists.

So for outbound to brand-new leads, **email is the first-class channel**; LinkedIn is for people the employee already has a thread with.

---

## 5. Admin: issuing a token

A SalesBrain admin mints one token per consuming app:

```http
POST /api/admin/service-tokens        (cookie-authed, admin)
{ "app_key": "chipchip-outbound", "name": "ChipChip outbound app (prod)" }
→ { "token": "svc_…", … }             # shown ONCE — store it in the app's secrets
```

`GET` lists active tokens (prefix only); `DELETE ?id=<uuid>` revokes one.

---

## 6. Limits & auditing

- **Rate limits:** 120 req/min per app token; tighter per-tool sub-limits on provider-quota-bound tools (`crm_leads_finder_run`, `crm_enrich_prospect`, `crm_outreach_propose`, `linkedin_connect_start`).
- **Audit:** every call is logged (tool, acting `app_key` + `employee_id`, status, duration) to `mcp_audit_log`.
- All pipeline gates (budgets, quiet hours, caps, kill switch) are enforced server-side and cannot be bypassed by the caller.
