# Onboarding Contacts Form — zeami.io Integration

The Stage-2 onboarding contacts form is hosted on **zeami.io**. SalesBrain owns the data and the API; zeami.io renders the page and proxies the form submission.

## URL flow

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

## Data captured

When the client submits, SalesBrain writes the 7 contact fields to `client_onboardings` (executive name/email/role, project_manager name/email, it_admin name/email), marks the token used, and — if the onboarding row was at Stage 2 — auto-advances it to Stage 3.

The internal PM sees this immediately on `/onboarding/<id>` next refresh.
