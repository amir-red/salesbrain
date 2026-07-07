# SalesBrain External API — zeami.io Integration

Server-to-server endpoints under `/api/public/*` for integrations with external systems (primarily **zeami.io**). All endpoints share one API key (`ONBOARDING_API_KEY`) and one CORS allow-origin (`PUBLIC_FORM_ALLOWED_ORIGIN`).

**Endpoint summary:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/public/sales-leads` | POST | Inbound demo / contact requests from the zeami.io "Request Demo" form |
| `/api/public/calendly-webhook` | POST | Calendly webhook — receives `invitee.created` + `invitee.canceled` events (Phase 2: requires Calendly Standard) |
| `/api/public/onboarding/<token>` | GET / POST | Client onboarding form — prefill + submit + live progress |
| `/api/public/deals` | GET | List deals (slim summaries) with filters + pagination |
| `/api/public/deals/<deal_id>` | GET | Full deal context (company info, pipeline state, captured insights, onboarding pointer) |

Common headers for all calls:

```
X-API-Key: <ONBOARDING_API_KEY>      # required in prod; same key gates every /api/public/* route
Content-Type: application/json       # on POST only
```

---

## Demo request — zeami.io "Request Demo" form

The marketing form at `zeami.io` (full name + work email + company + preferred demo date/time/timezone + optional infrastructure details) POSTs to this endpoint. Each submission creates a row in `sales_leads` with `status='new'`. The CRM surfaces it at `/sales-leads` and any rep can convert it to a G1 sales deal with one click.

### `POST /api/public/sales-leads`

Base: `https://salescrm.chipchip.social/api/public/sales-leads`

Headers:
```
X-API-Key: <ONBOARDING_API_KEY>
Content-Type: application/json
```

Body (JSON):

```json
{
  "full_name": "Bereket Solomon",
  "company": "ChipChip",
  "email": "becksol.bs@gmail.com",
  "description": "i want to automate our team and find out which tasks are eating up time",

  "preferred_demo_date": "2026-06-18",
  "preferred_demo_time": "09:00",
  "preferred_demo_timezone": "Africa/Nairobi"
}
```

### Field rules

| Field | Required? | Format | Notes |
|---|---|---|---|
| `full_name` | ✅ yes | string, 1–200 chars | Trimmed server-side |
| `company` | ✅ yes | string, 1–200 chars | |
| `email` | ✅ yes | valid email, ≤320 chars | Lowercased server-side |
| `description` | ⛔ optional | string ≤5000 chars or `null` | The "Infrastructure Details" textarea on the form |
| `preferred_demo_date` | ⛔ optional | **ISO `YYYY-MM-DD`** | Use `<input type="date">` |
| `preferred_demo_time` | ⛔ optional | **`HH:MM` or `HH:MM:SS` (24-hour)** | Use `<input type="time">` — never AM/PM |
| `preferred_demo_timezone` | ⛔ optional | IANA timezone string, ≤64 chars | Get from `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| `source` | ⛔ optional | string ≤120 chars | Overrides the default `"zeami.io:request-demo"` if you need to tag a campaign |

All three preferred-demo fields are optional and independent. If only `preferred_demo_date` is sent, time defaults to midnight in the supplied tz; if only `preferred_demo_timezone` is sent, date defaults to NULL and no demo line will be shown to the rep.

### Critical format gotchas

1. **Time must be 24-hour, no AM/PM.** Sending `"9:00 AM"` returns `400 Validation failed`. The browser's `<input type="time">` always sends 24-hour — use it as-is, do not reformat before submitting.
2. **Date must be ISO `YYYY-MM-DD`.** Sending `"06/18/2026"` or `"Jun 18, 2026"` returns `400`. `<input type="date">` always sends ISO.
3. **Timezone is the IANA name, not a UTC offset.** Send `"Africa/Nairobi"`, NOT `"GMT+3"` / `"+03:00"` / `"EAT"`. The official list lives at [the IANA tz database](https://www.iana.org/time-zones); any value `Intl.DateTimeFormat().resolvedOptions().timeZone` returns is valid.

### Response

`201 Created`:
```json
{ "id": "9a3f...uuid...", "created_at": "2026-06-18T06:00:00.000Z" }
```

`400 Validation failed`: invalid format on a field. The response body's `details` array names the offending field.

`401 Missing API key` / `403 Invalid API key`: see the API key section below.

### Drop-in client code (zeami.io)

```ts
async function submitDemoRequest(form: {
  fullName: string;
  email: string;
  company: string;
  description?: string;
  demoDate?: string;       // 'YYYY-MM-DD' from <input type="date">
  demoTime?: string;       // 'HH:MM'      from <input type="time">
  demoTimezone?: string;   // IANA, default from Intl
}) {
  const res = await fetch('https://salescrm.chipchip.social/api/public/sales-leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.SALESBRAIN_API_KEY!,
    },
    body: JSON.stringify({
      full_name: form.fullName,
      email:     form.email,
      company:   form.company,
      description: form.description || null,

      preferred_demo_date:     form.demoDate || null,
      preferred_demo_time:     form.demoTime || null,
      preferred_demo_timezone:
        form.demoTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `Demo request failed (${res.status})`);
  }
  return res.json() as Promise<{ id: string; created_at: string }>;
}
```

### What happens after submission (inside the CRM)

1. Row inserted into `sales_leads` with `status='new'`, the demo time fields preserved verbatim (no UTC conversion at intake — we keep the prospect's intent).
2. `/sales-leads` page shows the lead immediately with a 📅 callout: *Preferred demo: Thu, Jun 18 2026 · 9:00 AM · Africa/Nairobi* (rendered IN the prospect's tz, not the rep's).
3. Any signed-in rep can **Convert to deal** → new G1 sales deal seeded with the lead's company/contact and the demo time line appended to `deal.notes`. The agent reads this on the next chat turn, so "when does the prospect want a demo?" works from the get-go.

### Verifying the integration end-to-end

1. Submit a demo from the live zeami.io form.
2. Open `/sales-leads` in the CRM. The new lead should show the 📅 callout line with the time you picked.
3. If the line is missing: the request body is missing the three new keys (inspect zeami.io's network panel).
4. If the API returns `400`: a field's format is wrong (most commonly `9:00 AM` instead of `09:00`).

---

## Calendly booking — professional demo scheduling

Prospects book real available slots via an embedded Calendly widget on the zeami.io demo-request page. Calendly sends the prospect the confirmation (with .ics, Meet link, reschedule + cancel URLs), and — once the workspace is on the Standard plan — fires a webhook back to SalesBrain so the CRM auto-syncs the booking status.

### Rollout: start on Calendly Free, upgrade to Standard when ready

| Feature | Free | Standard (~$12/mo) |
|---|---|---|
| Widget embed on zeami.io | ✅ | ✅ |
| Real availability from `demos@zeami.io` calendar | ✅ | ✅ |
| Google Meet link auto-generation | ✅ | ✅ |
| Prospect confirmation email (.ics + reschedule + cancel links) | ✅ | ✅ |
| Webhook back to SalesBrain (auto-sync `booked_at` / `meet_link` / status) | ❌ | ✅ |
| Internal team notification auto-fires on booking | ❌ | ✅ |

**Phase 1 (Free)**: build the code path, embed the widget on zeami.io, test the prospect UX. `sales_leads` rows are created by the form POST but `booked_at` / `meet_link` / `booking_status` stay NULL — someone can eyeball `demos@` calendar or update the row via SQL.

**Phase 2 (Standard)**: paste the webhook URL + signing secret. No code change, no re-deploy. The dormant handler starts firing.

### Setup on Calendly

1. Sign up (Free is fine to start). One seat, connected to `demos@zeami.io`'s Google Calendar. Enable **Google Meet** auto-generation.
2. Create the event type — "Zeami Demo (30 min)":
   - Duration: 30 minutes, 10-min buffer before/after
   - Availability: weekdays 9–17 EAT (adjust as needed)
   - Custom questions:
     - **Company** (required, single-line) — Calendly's `questions_and_answers[i].answer` maps to `sales_leads.company` on the backend
     - **Anything specific you'd like to see?** (optional, multi-line)
3. **(Phase 2 only)** Configure webhook subscription:
   - URL: `https://salescrm.chipchip.social/api/public/calendly-webhook`
   - Events: `invitee.created`, `invitee.canceled`
   - Copy the signing secret → paste into `CALENDLY_WEBHOOK_SECRET` env on the CRM prod → PM2 restart.

### Setup on zeami.io — embed the widget

Replace the current date/time/tz picker on the demo-request page with the Calendly inline widget. Prefill from the form fields above the widget so the prospect doesn't retype:

```html
<div id="calendly-inline" style="min-width: 320px; height: 630px;"></div>
<link rel="stylesheet" href="https://assets.calendly.com/assets/external/widget.css"/>
<script src="https://assets.calendly.com/assets/external/widget.js" async></script>
<script>
  window.addEventListener('load', () => {
    Calendly.initInlineWidget({
      url: 'https://calendly.com/amir-zeami/zeami-demo-30-min?hide_gdpr_banner=1',
      parentElement: document.getElementById('calendly-inline'),
      prefill: {
        name:  document.getElementById('fullName').value,
        email: document.getElementById('workEmail').value,
        customAnswers: {
          a1: document.getElementById('company').value,  // maps to "Company" question
        },
      },
    });
  });
</script>
```

Prefill values re-hydrate every time the widget mounts. Reactive updates from user typing → widget prefill are up to your form-state code (React `useEffect` on the prefill values, etc.).

### Webhook shape (Phase 2 reference)

Calendly POSTs `Content-Type: application/json` to the webhook URL with:

```json
{
  "event": "invitee.created",
  "payload": {
    "uri": "https://api.calendly.com/scheduled_events/EVENT_UUID/invitees/INVITEE_UUID",
    "name": "Bereket Solomon",
    "email": "becksol.bs@gmail.com",
    "questions_and_answers": [
      { "position": 0, "question": "Company", "answer": "ChipChip" }
    ],
    "scheduled_event": {
      "uri": "https://api.calendly.com/scheduled_events/EVENT_UUID",
      "start_time": "2026-07-02T14:30:00.000000Z",
      "end_time":   "2026-07-02T15:00:00.000000Z",
      "location": {
        "type": "google_conference",
        "join_url": "https://meet.google.com/xxx-yyyy-zzz"
      }
    },
    "reschedule_url": "https://calendly.com/reschedulings/…",
    "cancel_url":     "https://calendly.com/cancellations/…"
  }
}
```

`invitee.canceled` uses the same shape.

### Signature verification

Every request includes a `Calendly-Webhook-Signature` header of the form:
```
t=1719937200,v1=<64-char-hex-hmac>
```

The handler verifies via HMAC-SHA256 on the literal string `<t>.<raw-body>` using `CALENDLY_WEBHOOK_SECRET`, with a 5-minute skew allowance. Bad signature → `401` with no DB write. Missing secret → `401` (safe default so an unconfigured route can't be spammed).

### What happens on `invitee.created`

1. Handler verifies signature, parses payload.
2. Matches the `sales_leads` row by (in order):
   - `calendly_event_uuid` (re-delivery of an already-recorded booking → no-op UPDATE)
   - Most recent row with same email, no prior booking, status ∈ {new, contacted}
   - Falls through to INSERT a fresh row (cold-start — prospect skipped the zeami.io form and hit Calendly directly)
3. UPDATE/INSERT with `booking_status='scheduled'`, `booked_at`, `meet_link`, `reschedule_url`, `cancel_url`, event/invitee uuids. Backfills `full_name` + `company` from Calendly if empty.
4. Fires **one** internal email — "Demo booked: <Company> — <Name>" — to `LEAD_NOTIFY_TO` (default `tesfa@zeami.io`) + CC. Reply-to = the prospect's email so anyone on the team can reply directly.
5. Prospect's own confirmation email is sent by **Calendly directly** — polished, branded, with `.ics` attachment + reschedule + cancel URLs. We do NOT duplicate it.

### What happens on `invitee.canceled`

1. Handler verifies signature, parses payload.
2. UPDATEs the matching row: `booking_status='canceled'`.
3. Fires "Demo canceled: <Company> — <Name>" to the team. Idempotent — a re-delivery hits the `IS DISTINCT FROM 'canceled'` guard and skips the extra email.

### Reschedule flow

Calendly's reschedule fires `invitee.canceled` (old event) + `invitee.created` (new event with a new `calendly_event_uuid`). Order-independent handling:
- If `canceled` arrives first: row → `booking_status='canceled'`. Then `created` → row overwrites to `scheduled` with the new uuid + slot.
- If `created` arrives first: row overwrites with the new booking data. Then `canceled` for the OLD uuid — no match, no action.

Either way, the `/sales-leads` UI ends up reflecting the new slot.

### Verifying the integration end-to-end

**Phase 1 (Free plan) checks:**
1. Book a test slot via the embedded widget → Calendly's confirmation email lands in your inbox with `.ics`.
2. Reschedule from Calendly's email → Google Calendar reflects the new slot on `demos@`.
3. Cancel from Calendly's email → event disappears from `demos@` calendar.
4. `sales_leads` row is created by the initial form POST but `booking_status` stays NULL — expected on Free.

**Phase 2 (Standard plan) checks:**
5. Book a test slot → within ~1s, `/sales-leads` shows a green "Scheduled" badge + Meet link + Reschedule button. Team gets "Demo booked" email.
6. Reschedule from prospect side → CRM row updates to the new time. Team gets a second email.
7. Cancel from prospect side → CRM badge turns red. Team gets cancellation email.
8. Convert a scheduled lead to a deal → deal.notes contain the booked slot + Meet link + reschedule URL. Ask the agent "when is the demo?" — it reads notes and responds correctly.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Widget doesn't render on zeami.io | `widget.js` blocked by CSP or `Calendly` global not ready | Load `widget.js` in `<head>` OR listen for `load` event before calling `initInlineWidget` |
| Prospect books but SalesBrain doesn't update | You're on Free plan (no webhooks) | Upgrade to Standard, paste secret, PM2 restart |
| Webhook returns 401 with "signature mismatch" | Wrong secret in `CALENDLY_WEBHOOK_SECRET` | Copy the secret again from Calendly's UI — regenerate if unsure |
| Webhook returns 401 with "timestamp outside acceptable skew" | Server clock drift or captured replay | Fix NTP / check for suspicious replay attempts |
| Booking creates a duplicate `sales_leads` row | The prospect used a different email in the widget than in the form | Match logic uses email — reconcile manually in DB or update `sales_leads.email` |

---

## Onboarding form — zeami.io page

The Stage-2 onboarding contacts form is hosted on **zeami.io**. SalesBrain owns the data and the API; zeami.io renders the page and proxies the form submission.

### URL flow

1. Internal PM clicks **Send client form** in SalesBrain (`/onboarding/[id]`).
2. SalesBrain generates a single-use, 30-day token and emails the client a link of the form:
   ```
   https://zeami.io/onboarding/<token>
   ```
3. zeami.io hosts the page at that path. It loads the prefill from SalesBrain, lets the client submit, and posts back to SalesBrain.

The base URL is configurable on the SalesBrain side via `PUBLIC_FORM_BASE_URL` (without trailing slash). If unset, SalesBrain falls back to its own in-app form for development.

## API endpoints

Base: `https://salescrm.chipchip.social/api/public/onboarding/<token>`

### `GET …/<token>` — Validate token + fetch prefill

Headers:
```
X-API-Key: <ONBOARDING_API_KEY>
```

Responses:
- `200 OK` → prefill payload (see schema below).
- `404` → invalid/unknown token. Show "this link is invalid".
- `410` → used or expired. Show "this link can no longer be used; ask your project manager to send a new one".
- `401` / `403` → API key missing or wrong (server-side bug).

Response shape (`200 OK`):
```json
{
  "company_name":          "Acme Inc.",
  "website":               "https://acme.com",
  "company_size":          "50-200",
  "description":           "Mid-market manufacturing co. with a 22-person ops team.",
  "deployment_plan":       "on_premise",
  "primary_contact_email": "ops@acme.com",

  "expires_at":            "2026-06-08T12:00:00Z",
  "submitted_at":          null,                    // ISO timestamp once the form is submitted

  "stage":  1,                                      // 1..8, current onboarding stage
  "status": "in_progress",                          // 'in_progress' | 'completed' | 'paused'
  "stage_completions": {
    "stage1": null,                                 // ISO timestamp when stage 1 was completed
    "stage2": null,
    "stage3": null,
    "stage4": null,
    "stage5": null,
    "stage6": null,
    "stage7": null,
    "stage8": null
  }
}
```

The same endpoint serves **both** "fetch prefill for the form" (when `submitted_at == null`) and "fetch live progress for the timeline" (when `submitted_at != null`). After the client submits, this endpoint keeps responding 200 with the latest stage and completion timestamps — poll it (e.g. every 30 s) to update the UI without a refresh.

Any field except `company_name`, `expires_at`, `stage`, `status`, and `stage_completions` may be `null` if it wasn't captured upstream. `deployment_plan` is `'on_premise' | 'saas_cloud' | null`.

> **Note:** the 3 role contacts (executive / project_manager / it_admin) are intentionally NOT returned. They're write-only — fresh form every time, no leak of who was previously submitted from a stale tab.

### UX recommendation for zeami.io

Render two views off the same response:
- If `submitted_at == null` → render the **form** (prefilled with the editable fields).
- If `submitted_at != null` → render the **timeline / status view** with the 8 stages, marking stage N as ✓ when `stage_completions.stageN` is non-null and stage N+1 as "in progress" when `stage === N+1`. Poll the endpoint every 30 s (or when the page regains focus) to keep it live.

### `POST …/<token>` — Submit the form

Headers:
```
Content-Type: application/json
X-API-Key: <ONBOARDING_API_KEY>
```

Body:
```json
{
  "executive_name":         "Jane Doe",
  "executive_email":        "jane@acme.com",
  "executive_role":         "VP of Operations",      // optional
  "project_manager_name":   "Sam Lee",
  "project_manager_email":  "sam@acme.com",
  "it_admin_name":          "Alex Kim",
  "it_admin_email":         "alex@acme.com",

  // Company-profile fields (all optional — pass only the ones the client edited)
  "website":               "https://acme.com",
  "company_size":          "200-500",
  "description":           "Updated company blurb…",
  "deployment_plan":       "saas_cloud",          // 'on_premise' | 'saas_cloud'
  "primary_contact_email": "ops@acme.com"
}
```

The 7 role-contact fields (3 contacts × name/email/role) are **required**. The 5 company-profile fields are **optional** — omit any field the client didn't change to avoid overwriting existing values with blanks.

Responses:
- `200 OK` → `{ "ok": true }`. Show the success page.
- `400` → validation error, body has `{ error: "…" }`.
- `410` → token already used.
- `401` / `403` → API key issue.

The endpoint is idempotent in the bad direction: if a client double-submits, the second request gets `410` and no duplicate write happens.

## API key

Generated server-side (32 random bytes, base64url-encoded). One key per environment (production, staging, dev).

```
ONBOARDING_API_KEY=h7VavDSOLA37TrMs3E9LaiRHAYJdRzMvR5FY6PoaRzU
```

**Important**:
- Store on **zeami.io's server** only. Never expose to the browser.
- Rotate by re-generating the value and updating both .env files.
- Treat as a secret — don't commit to source control.

## Recommended zeami.io implementation

The form should be a **server component** or use a **server-side API route** as a proxy so the API key never reaches the browser. Example (Next.js on zeami.io):

```ts
// app/onboarding/[token]/page.tsx (server component on zeami.io)
const API = 'https://salescrm.chipchip.social/api/public/onboarding';
const KEY = process.env.SALESBRAIN_ONBOARDING_API_KEY!;

export default async function Page({ params }: { params: { token: string } }) {
  const res = await fetch(`${API}/${params.token}`, {
    headers: { 'X-API-Key': KEY },
    cache: 'no-store',
  });
  if (res.status === 410) return <ExpiredView />;
  if (res.status === 404) return <InvalidView />;
  if (!res.ok) return <ErrorView />;
  const { company_name } = await res.json();
  return <ContactsForm token={params.token} companyName={company_name} />;
}

// Form action server-side:
export async function submitContacts(token: string, formData: FormData) {
  'use server';
  const body = Object.fromEntries(formData.entries());
  const res = await fetch(`${API}/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error);
}
```

If you must call from the browser instead, set `PUBLIC_FORM_ALLOWED_ORIGIN=https://zeami.io` on SalesBrain so CORS lets through the request — but the API key would need to be exposed, which we strongly recommend against.

## SalesBrain env vars (set on the SalesBrain side)

```
# The zeami.io URL prefix that gets emailed to clients. Token is appended as `/<token>`.
PUBLIC_FORM_BASE_URL=https://zeami.io/onboarding

# Required to actually receive calls from zeami.io. If unset, the API stays
# open (for development only).
ONBOARDING_API_KEY=h7VavDSOLA37TrMs3E9LaiRHAYJdRzMvR5FY6PoaRzU

# Optional — restricts CORS to a single origin. Useful if zeami.io ever
# calls from the browser.
PUBLIC_FORM_ALLOWED_ORIGIN=https://zeami.io
```

### Data captured

When the client submits, SalesBrain writes the 7 contact fields to `client_onboardings` (executive name/email/role, project_manager name/email, it_admin name/email), marks the token used, and — if the onboarding row was at Stage 2 — auto-advances it to Stage 3.

The internal PM sees this immediately on `/onboarding/<id>` next refresh.

---

## Deal list — server-to-server

Slim summary list to discover which deals exist. Pair with the single-deal endpoint below for full details on the ones you care about.

```
GET https://salescrm.chipchip.social/api/public/deals
```

Headers:
```
X-API-Key: <ONBOARDING_API_KEY>
```

### Query params

| Param | Type | Default | Purpose |
|---|---|---|---|
| `deal_type` | `sales` \| `grant` | (any) | Filter by pipeline |
| `gate` | integer 1–12 | (any) | Exact-gate filter |
| `status` | `all` \| `won` \| `active` | `all` | Shorthand: `won` = at the type's final gate (sales G9, grant G10); `active` = anything below it |
| `updated_since` | ISO 8601 | — | Only deals updated at or after this time. For incremental syncs. |
| `q` | string | — | Case-insensitive substring match on company OR deal name |
| `limit` | int 1–200 | 50 | Page size |
| `offset` | int 0+ | 0 | Pagination offset |

### Response (`200 OK`)

```json
{
  "data": [
    {
      "id":              "93c4386c-6120-42f3-a71e-488252a49f59",
      "name":            "ChipChip Pilot",
      "company":         "ChipChip",
      "deal_type":       "sales",
      "gate":            9,
      "gate_name":       "Project Handover",
      "value":           50000,
      "currency":        "USD",
      "gate_entered_at": "2026-05-08T12:30:00Z",
      "updated_at":      "2026-05-09T11:20:00Z",
      "has_onboarding":  true
    }
  ],
  "pagination": {
    "limit":    50,
    "offset":   0,
    "total":    1,
    "has_more": false
  }
}
```

Each row is intentionally slim — no scores, flags, fields, or contact details. Once you've picked rows you care about, hit `/api/public/deals/<id>` for the full context.

`has_onboarding` is a cheap server-side lookup so you can render "Already onboarding →" links in your list view without a second round trip.

### Common queries

```bash
# All won sales deals (i.e. at G9 — ready for onboarding)
curl '…/api/public/deals?deal_type=sales&status=won' -H "X-API-Key: $KEY"

# Active grants only
curl '…/api/public/deals?deal_type=grant&status=active' -H "X-API-Key: $KEY"

# Incremental sync — deals changed since last poll
curl '…/api/public/deals?updated_since=2026-05-10T00:00:00Z' -H "X-API-Key: $KEY"

# Search "Chip"
curl '…/api/public/deals?q=Chip&limit=10' -H "X-API-Key: $KEY"

# Paginate
curl '…/api/public/deals?limit=50&offset=50' -H "X-API-Key: $KEY"
```

### Errors

- `400` → invalid param (bad `deal_type`, malformed `updated_since`, etc.)
- `401` / `403` → API key missing or wrong
- `500` → server error

---

## Deal info — server-to-server

Pull the full company / pipeline context for a single sales deal. Use this when zeami.io (or another internal tool) needs to render a deal summary, onboarding context page, customer-success briefing, etc.

```
GET https://salescrm.chipchip.social/api/public/deals/<deal_id>
```

Headers:
```
X-API-Key: <ONBOARDING_API_KEY>
```

`<deal_id>` is the UUID from `deals.id`.

### Response (`200 OK`)

```json
{
  "deal": {
    "id":               "93c4386c-6120-42f3-a71e-488252a49f59",
    "name":             "ChipChip Pilot",
    "deal_type":        "sales",                     // 'sales' | 'grant'
    "gate":             9,
    "gate_name":        "Project Handover",
    "gate_entered_at":  "2026-05-08T12:30:00Z",
    "value":            50000,
    "currency":         "USD",
    "created_at":       "2026-04-12T09:15:00Z",
    "updated_at":       "2026-05-09T11:20:00Z"
  },
  "company": {
    "name":     "ChipChip",
    "website":  "https://chipchip.social",           // explicit, else inferred from contact email domain
    "domain":   null,
    "size":     "22",
    "industry": "Tech",
    "location": null
  },
  "contact": {
    "name":  "Bruk",
    "email": "bruk@chipchip.social",
    "phone": null,
    "title": "CEO"
  },
  "insights": {
    "industry":         "Tech",
    "company_size":     "22",
    "hq_location":      null,
    "business_model":   "Social commerce marketplace",
    "pain_point":       "No overview of task mining process, lack of visibility into how employees work…",
    "growth_rate":      "170% YoY",
    "annual_revenue":   "1.3M USD",
    "solution_fit":     "High — Zeami addresses exact need for full workflow visibility…",
    "sales_cycle":      "Short — CEO can decide independently…",
    "payment_terms":    "USD invoicing acceptable",
    "desktop_heavy_roles": "devs, marketing, sourcing, operations, customer support, finance, executives",
    "pilot_or_full":    "Full implementation preferred",
    "deployment_plan":  "saas_cloud",                // 'on_premise' | 'saas_cloud' | null
    "raw": {
      "industry": "Tech", "pain_point": "…", "growth_rate": "170% YoY",
      "...": "every field the agent captured during sales — raw JSONB"
    }
  },
  "onboarding": {
    "id":                    "bee03340-7e8b-4a24-b0a8-a04d8ce1e0d0",
    "stage":                 3,
    "status":                "in_progress",
    "deployment_plan":       "saas_cloud",
    "primary_contact_email": "bruk@chipchip.social",
    "created_at":            "2026-05-08T12:30:00Z",
    "updated_at":            "2026-05-09T11:20:00Z",

    "pm": {
      "name":  "Amir",
      "email": "amir@chipchip.social"
    },

    "company_profile": {
      "company_name":          "ChipChip",
      "website":               "https://chipchip.social",
      "company_size":          "22",
      "description":           "Social commerce marketplace",
      "primary_contact_email": "bruk@chipchip.social"
    },

    "contacts": {
      "executive":       { "name": "Bruk",  "email": "bruk@chipchip.social",  "role": "CEO" },
      "project_manager": { "name": "Sarah", "email": "sarah@chipchip.social", "role": null },
      "it_admin":        { "name": "Dan",   "email": "dan@chipchip.social",   "role": null }
    },

    "access": {
      "server_setup_done": true,
      "app_setup_done":    true,
      "download_url":      "https://downloads.zeami.io/chipchip/installer.dmg",
      "email_sent_at":     "2026-05-09T10:30:00Z"
    },

    "briefing": {
      "meeting_at": null,
      "notes":      null
    },

    "employees": {
      "count":       null,
      "setup_notes": null
    },

    "deployment": {
      "started_at": null
    },

    "audit": {
      "started_at": null,
      "notes":      null
    },

    "pnl": {
      "ready_at":   null,
      "report_url": null
    },

    "stage_completions": {
      "stage1": "2026-05-08T12:35:00Z",
      "stage2": "2026-05-08T15:00:00Z",
      "stage3": null, "stage4": null, "stage5": null,
      "stage6": null, "stage7": null, "stage8": null
    }
  }
}
```

#### Notes on the onboarding block

- `onboarding` is `null` if the deal hasn't reached G9 yet (or hasn't been manually onboarded).
- `pm` is the **internal** project manager managing this client on the SalesBrain side. `name` + `email` only — the internal `user_id` is never exposed. Null if no PM is assigned.
- `company_profile` is the onboarding row's *own* copy of the company info. It diverges from the top-level `company` block once the client edits it via the public form. Use `onboarding.company_profile` if you want what the client confirmed; use `company` if you want what sales captured.
- Each `contacts.*` is null if that role wasn't submitted yet.
- `access.app_credentials` is **never** returned — sensitive. We do return `email_sent_at` so you can show "IT-admin email sent on X".
- The grouped stage blocks (`briefing`, `employees`, `deployment`, `audit`, `pnl`) hold the data the PM captures as they work each stage. Most fields are `null` until that stage is in progress or done.
- `stage_completions.stageN` is the timestamp when stage N was marked complete (null if not yet). Combined with the top-level `stage` field, this drives a checklist / timeline UI.

- `onboarding` is `null` if the deal hasn't reached G9 yet.
- `value` is a JSON number (cast from `numeric` in the DB).
- `insights.raw` is the agent-captured `deals.fields` JSONB verbatim — useful when you need fields that aren't surfaced in the curated set.
- Every nested field (except `deal.id`, `deal.name`, `company.name`) may be `null` if it wasn't captured upstream.

### Intentionally not exposed
- `score`, `risk`, `verdict` — sales-internal scoring
- `flags`, `missing`, `notes` — sales-internal annotations
- `lead_id`, `user_id` — internal CRM identity
- Anything under `/conversations`, `/timeline`, etc.

If you need any of these, ask — we can extend the response with explicit fields.

### Errors

- `400` → malformed deal id (not a UUID)
- `404` → no deal with that id
- `401` / `403` → API key missing or wrong

### Example: Next.js server-component pattern

```ts
// app/clients/[deal_id]/page.tsx on zeami.io
const API = 'https://salescrm.chipchip.social/api/public/deals';
const KEY = process.env.SALESBRAIN_ONBOARDING_API_KEY!;

export default async function Page({ params }: { params: { deal_id: string } }) {
  const res = await fetch(`${API}/${params.deal_id}`, {
    headers: { 'X-API-Key': KEY },
    cache: 'no-store',
  });
  if (!res.ok) return <ErrorView status={res.status} />;
  const { company, contact, insights, onboarding } = await res.json();

  return <ClientBriefing company={company} contact={contact} insights={insights} onboarding={onboarding} />;
}
```
