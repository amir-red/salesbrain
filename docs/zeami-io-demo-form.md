# zeami.io — Demo Request Page Integration Spec

**Audience:** whoever builds/maintains the `zeami.io/request-demo` (or equivalent) page.
**Backend:** SalesBrain CRM at `https://salescrm.chipchip.social`.
**Scheduling:** Calendly (Standard plan — **webhook auto-sync is LIVE**).
**Date:** 2026-07-07

**Current status:** SalesBrain-side integration is complete and deployed. The only remaining work is on **zeami.io** — embed the Calendly widget. Everything else auto-syncs.

---

## 1. Current state — what's already working

Prospects on `zeami.io/request-demo` (once the widget is embedded) will see the Calendly widget showing real available slots on `amir@zeami.io`'s Google Calendar. They pick a slot, fill in Calendly's booking form, and:

- ✅ Prospect gets Calendly's confirmation email with `.ics`, Google Meet link, reschedule + cancel URLs
- ✅ Event lands on Amir's Google Calendar with Meet link auto-attached
- ✅ Calendly's webhook fires to `https://salescrm.chipchip.social/api/public/calendly-webhook`
- ✅ SalesBrain verifies the HMAC signature and either UPDATEs an existing `sales_leads` row (if the prospect submitted the zeami.io form first) or INSERTs a fresh one (if they booked directly)
- ✅ `sales_leads` gains: `booking_status='scheduled'`, `booked_at`, `meet_link`, `reschedule_url`, `cancel_url`, `calendly_event_uuid` + all the form fields (see field mapping below)
- ✅ Internal team gets a "Demo booked" email to `amir@zeami.io` with reply-to = the prospect's email
- ✅ `/sales-leads` in the CRM shows the row with a green "Scheduled" badge, "Join meeting" button, and "Reschedule" link
- ✅ Rescheduling from Calendly's link updates the same CRM row automatically
- ✅ Canceling from Calendly's link flips `booking_status='canceled'` and fires a cancellation notification

**None of this needs any code on zeami.io.** The webhook handler already exists in SalesBrain and is production-active.

## 2. Data flow — from prospect click to CRM row

```
┌─────────────────────────────────────────────────────────────────────┐
│  Prospect on zeami.io/request-demo                                  │
│  ┌──────────────────────────────────────────────┐                   │
│  │  Calendly inline widget (embedded, 3 lines)  │                   │
│  │  Shows real availability from Amir's cal     │                   │
│  │  Prospect fills: Name, Email,                │                   │
│  │                  Company, Website,           │                   │
│  │                  Company Description         │                   │
│  │  Picks slot → clicks Confirm                 │                   │
│  └────────────────────────┬─────────────────────┘                   │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Calendly's servers                                                 │
│  ┌────────────────────┐  ┌──────────────────────┐                   │
│  │  Sends prospect    │  │  Adds event to       │                   │
│  │  confirmation      │  │  demos@ Google Cal   │                   │
│  │  email with .ics   │  │  with Meet link      │                   │
│  └────────────────────┘  └──────────────────────┘                   │
│  ┌──────────────────────────────────────────────┐                   │
│  │  Fires webhook POST with HMAC signature      │                   │
│  │  to SalesBrain: invitee.created              │                   │
│  └────────────────────────┬─────────────────────┘                   │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SalesBrain: POST /api/public/calendly-webhook                      │
│  ┌───────────────────────────────────────────┐                      │
│  │ 1. Read raw body, verify HMAC signature   │                      │
│  │ 2. Parse invitee.created payload          │                      │
│  │ 3. Match sales_leads by                   │                      │
│  │      calendly_event_uuid (idempotency),   │                      │
│  │    then by email + status IN (new,        │                      │
│  │      contacted), OR insert fresh row      │                      │
│  │ 4. UPDATE / INSERT with all fields        │                      │
│  │ 5. Fire "Demo booked" email to team       │                      │
│  └───────────────┬───────────────────────────┘                      │
└──────────────────┼──────────────────────────────────────────────────┘
                   │
                   ▼
         `/sales-leads` in CRM shows row within a few seconds.
```

## 3. Calendly's booking form — exact fields captured

Calendly's form asks 5 fields on every booking (Amir configured these). Each one maps to a specific column in the `sales_leads` table via the webhook handler:

| Calendly form field | Required? | Maps to `sales_leads` column | Behavior on repeat bookings |
|---|---|---|---|
| **Name** | ✅ built-in | `full_name` | COALESCE — kept from prior form submit if already set |
| **Email** | ✅ built-in | `email` | Match key — used to find existing row |
| **Company** | ✅ custom Q | `company` | COALESCE — kept from prior form submit if already set |
| **Website** | custom Q | `website` (new col.) | COALESCE — populated from Calendly if empty |
| **Company Description** | optional | `description` | COALESCE — kept from prior form submit if already set |

Also automatically stored:

| Field | `sales_leads` column | Source |
|---|---|---|
| Booked slot start | `booked_at` (TIMESTAMPTZ, UTC) | Calendly payload `scheduled_event.start_time` |
| Google Meet link | `meet_link` | Calendly payload `scheduled_event.location.join_url` |
| Reschedule URL | `reschedule_url` | Calendly payload `reschedule_url` |
| Cancel URL | `cancel_url` | Calendly payload `cancel_url` |
| Booking state | `booking_status` = `'scheduled'` \| `'canceled'` | Webhook event type |
| Calendly event uuid | `calendly_event_uuid` (UNIQUE) | For idempotency + matching |

## 4. Decision — which flow does zeami.io implement?

Two options depending on how much lead-capture you want:

- **Option A — Pure Calendly widget (recommended)**: page is essentially a wrapper around the Calendly widget. No custom form, no fetch calls to SalesBrain, no API key. Simplest to build, best conversion, zero maintenance.
- **Option B — Two-step (form → widget)**: minimal form on zeami.io captures the lead into SalesBrain **before** they see the widget, so drop-offs are still tracked. More code, more moving parts.

For early-stage traffic, **Option A wins**. Sections 5 and 7 are everything you need — skip section 6 unless you specifically want Option B.

---

### 4.1 Why Option A is the recommended pattern

| Consideration | Option A (pure Calendly) | Option B (form + widget) |
|---|---|---|
| Prospect fills in fields once | ✅ Only Calendly asks | ❌ Same fields duplicated |
| Lead captured if prospect bails before booking | ❌ No row created | ✅ Row created on form submit |
| Code on zeami.io | ~10 lines of HTML | ~150 lines (React + fetch + state) |
| Vendor lock-in | Higher (fields live in Calendly) | Lower (fields live in SalesBrain) |
| Prospect UX | Cleaner (one form) | Slightly disjointed |
| Conversion (industry data) | Higher | Lower |

Unless zeami.io needs to track drop-offs (which requires meaningful follow-up capacity), Option A is strictly better.

---

## 5. Option A — Pure Calendly widget (recommended path)

### 5.1 Where the widget lives

Anywhere on `zeami.io`. Common patterns:
- Dedicated page: `zeami.io/request-demo` or `zeami.io/book-a-demo`
- Modal triggered by a "Get a demo" CTA on the homepage
- Bottom section of the pricing page

### 5.2 The embed snippet (drop this in as-is)

```html
<!-- 1. Calendly's stylesheet — load once, ideally in <head> -->
<link rel="stylesheet" href="https://assets.calendly.com/assets/external/widget.css"/>

<!-- 2. The widget container. Calendly reads the `data-url` attribute and
        auto-mounts the inline booking widget inside this div. -->
<div class="calendly-inline-widget"
     data-url="https://calendly.com/amir-zeami/zeami-demo-30-min?hide_gdpr_banner=1&background_color=0d0d14&text_color=ffffff&primary_color=00E5FF"
     style="min-width: 320px; height: 800px;">
</div>

<!-- 3. Calendly's loader — attach at end of <body>, async. Auto-detects
        the `.calendly-inline-widget` divs on the page and mounts them. -->
<script src="https://assets.calendly.com/assets/external/widget.js" async></script>
```

That's the entire integration. Three tags. No JavaScript to write. No API keys. No CORS setup.

### 5.3 What the URL parameters do

| Param | Purpose |
|---|---|
| `hide_gdpr_banner=1` | Suppresses the "Powered by Calendly" GDPR banner at the bottom of the widget |
| `background_color=0d0d14` | Widget background — Zeami's obsidian dark (`#0D0D14` without the `#`) |
| `text_color=ffffff` | Body text inside the widget |
| `primary_color=00E5FF` | Buttons, highlights, selected states — Zeami cyan (`#00E5FF` without the `#`) |

Optional flags you can add:
| Param | Effect |
|---|---|
| `hide_landing_page_details=1` | Skip the "About Amir" intro card and go straight to the calendar |
| `hide_event_type_details=1` | Skip the "30-min demo" description card |

### 5.4 React / Next.js version (if zeami.io is a SPA)

Same three tags, wrapped in a component. Handles the case where React's `<head>` might mount the stylesheet after the widget script tries to render:

```tsx
'use client';
import { useEffect } from 'react';

const CALENDLY_URL =
  'https://calendly.com/amir-zeami/zeami-demo-30-min' +
  '?hide_gdpr_banner=1' +
  '&background_color=0d0d14' +
  '&text_color=ffffff' +
  '&primary_color=00E5FF';

export default function DemoRequestPage() {
  useEffect(() => {
    // Widget script self-mounts. If it's already loaded (e.g. user navigated
    // away and came back), calling initInlineWidget again re-mounts cleanly.
    const script = document.createElement('script');
    script.src = 'https://assets.calendly.com/assets/external/widget.js';
    script.async = true;
    document.body.appendChild(script);
    return () => { script.remove(); };
  }, []);

  return (
    <>
      <link rel="stylesheet" href="https://assets.calendly.com/assets/external/widget.css" />
      <div
        className="calendly-inline-widget"
        data-url={CALENDLY_URL}
        style={{ minWidth: 320, height: 800 }}
      />
    </>
  );
}
```

### 5.5 What SalesBrain receives (automatic — no zeami.io code)

The moment the prospect completes a booking, Calendly's webhook fires to `https://salescrm.chipchip.social/api/public/calendly-webhook`. SalesBrain verifies the HMAC signature and (within ~1 second) writes the row to `sales_leads`. Full lifecycle:

**Booking created:**
- `sales_leads` row inserted (or updated if it existed from a prior form submit)
- Booking columns populated: `booked_at`, `meet_link`, `reschedule_url`, `cancel_url`, `calendly_event_uuid`, `booking_status='scheduled'`
- Custom-question columns populated: `full_name`, `email`, `company`, `website`, `description` (see section 3 for full mapping)
- `/sales-leads` UI shows the row with a green "**Scheduled**" badge, "Join meeting" button (opens Meet), "Reschedule" button (opens Calendly's reschedule page)
- Internal team gets a "**Demo booked: <Company> — <Name>**" email at `amir@zeami.io` with reply-to = prospect's email
- Prospect gets Calendly's own confirmation with `.ics`, Meet link, reschedule + cancel URLs (Calendly sends this — SalesBrain doesn't duplicate)

**Booking rescheduled** (prospect uses the reschedule URL):
- Calendly fires `canceled` (old event) + `created` (new event) in sequence
- SalesBrain UPDATEs the same `sales_leads` row — new `calendly_event_uuid`, new `booked_at`, same lead
- Team gets a second "Demo booked" notification (with the new time)

**Booking canceled** (prospect uses the cancel URL):
- `booking_status='canceled'`
- Row badge in `/sales-leads` turns red
- Team gets a "Demo canceled: <Company> — <Name>" notification

**Zero code needed on zeami.io to make any of this work.** The widget embed handles the prospect experience; the webhook handles everything else.

---

## 6. Option B — Two-step form + widget (alternative — skip if using Option A)

Only pick this if you specifically need to capture leads that abandon before booking. Otherwise, skip to section 7.

### 6.1 The flow

1. Prospect lands on `zeami.io/request-demo` and sees a short form: **Name + Email** (2 fields, that's it).
2. Prospect clicks "Continue → Pick a time".
3. `POST /api/public/sales-leads` fires with `{full_name, email}`. Creates the `sales_leads` row at `status='new'`. Response is `201 { id, created_at }`.
4. Same page transitions to show the Calendly widget with prefilled name + email.
5. Prospect books a slot → Calendly webhook UPDATEs the same row with company, website, description, booking details.

### 6.2 The API call

Endpoint: `POST https://salescrm.chipchip.social/api/public/sales-leads`

Headers:
```
Content-Type: application/json
X-API-Key: <ONBOARDING_API_KEY>
```

Body:
```json
{
  "full_name": "Bereket Solomon",
  "email": "becksol.bs@gmail.com"
}
```

Response: `201 { "id": "uuid", "created_at": "..." }`.

Only `full_name` and `email` are required in this minimal flow — company, website, description all come from Calendly's form later.

### 6.3 API key

Add to zeami.io's environment as `NEXT_PUBLIC_SALESBRAIN_API_KEY`. Get the value from Amir (it's stored as `ONBOARDING_API_KEY` in SalesBrain's GitHub Secrets). The `NEXT_PUBLIC_` prefix makes it available to client-side JS.

Security note: this key is sent from a public form, so it's a shared bearer, not a strict secret. That's by design — the SalesBrain endpoint validates other things (CORS, rate-limiting via cron) beyond just the key.

### 6.4 The prefill

When mounting the Calendly widget in step 4, pass the form values as prefill so the prospect isn't retyping:

```js
Calendly.initInlineWidget({
  url: CALENDLY_URL,
  parentElement: document.getElementById('calendly-inline'),
  prefill: {
    name:  formData.fullName,
    email: formData.email,
    // Company, website, description come from Calendly's own form
  },
  utm: { utmSource: 'zeami.io', utmMedium: 'demo-form' },
});
```

---

## 7. Calendly-side setup — status: ✅ Complete

For reference, so the zeami.io dev knows what to expect on the other end of the widget. **All of this is done and live** — no action needed.

- ✅ Calendly account under `amir@zeami.io` — **Standard plan** (webhooks enabled)
- ✅ Connected to Amir's Google Calendar → availability + auto-adds events
- ✅ Event type live at **`https://calendly.com/amir-zeami/zeami-demo-30-min`**
  - Duration: 30 minutes
  - Google Meet auto-generated per booking
  - Buffer + availability configured
  - Custom questions on the booking form (order matters — matches SalesBrain's parser):
    - **Company** — required
    - **Website** — optional
    - **Company Description** — optional
  - Reply-to on confirmation email: `amir@zeami.io` (organizer default on Standard)
- ✅ Webhook subscription active
  - URL: `https://salescrm.chipchip.social/api/public/calendly-webhook`
  - Events: `invitee.created`, `invitee.canceled`
  - Signing key stored as `CALENDLY_WEBHOOK_SECRET` in SalesBrain's GitHub Secrets → propagated to prod `.env.production` on every deploy
- ✅ SalesBrain webhook handler deployed at `POST /api/public/calendly-webhook`
  - HMAC-SHA256 signature verification with 5-min replay window
  - Idempotent: re-delivered webhooks are no-ops
  - Handles reschedule via `canceled → created` in any order

---

## 8. Design tokens — match Zeami brand

The Calendly widget's colors are set via URL params. Use these for consistency with the rest of `zeami.io`:

| Design token | Value | Calendly URL param |
|---|---|---|
| Widget background | `#0D0D14` (obsidian) | `background_color=0d0d14` |
| Text color | `#FFFFFF` | `text_color=ffffff` |
| Accent (buttons, highlights) | `#00E5FF` (cyan) | `primary_color=00E5FF` |
| Font | Poppins | Widget inherits page font family |

Note: no `#` prefix in Calendly's params — pass `0d0d14`, not `#0D0D14`.

---

## 9. Testing checklist

Before shipping:

- [ ] **Widget renders** — Calendly shows real availability from Amir's Google Calendar. Busy blocks on his calendar don't appear as available slots.
- [ ] **Zeami brand colors applied** — obsidian bg, white text, cyan buttons. No white-flash on load.
- [ ] **Mobile-responsive** — widget height and width work on phone-sized viewports. Set `min-height: 600px` on small screens if needed.
- [ ] **A live booking test**: pick a real slot in an incognito window as a test prospect. Verify:
  - Calendly sends the confirmation email with `.ics`, Meet link, reschedule + cancel URLs
  - Event lands on Amir's Google Calendar with the Meet link attached
  - Amir receives the internal team "Demo booked" email at `amir@zeami.io`
  - `/sales-leads` in the SalesBrain CRM shows a new row with the booking within a few seconds

If all checks pass, the flow is production-ready.

---

## 10. Analytics / postMessage listener (optional polish)

If zeami.io wants to trigger something when the booking completes (fire a GA/Segment event, redirect to a thank-you page, etc.), Calendly emits `postMessage` events you can listen for:

```js
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://calendly.com') return;
  if (e.data.event === 'calendly.event_scheduled') {
    // Booking confirmed
    // e.data.payload has { event: { uri }, invitee: { uri } }
    fbq && fbq('track', 'Lead');
    gtag && gtag('event', 'demo_booked');
    // Or window.location.href = '/thank-you';
  }
});
```

Other events worth listening for: `calendly.event_type_viewed`, `calendly.date_and_time_selected`, `calendly.profile_page_viewed` — useful for funnel analytics.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Widget shows a spinner forever | `widget.js` blocked by CSP or ad-blocker | Check browser console; whitelist `assets.calendly.com` in CSP |
| Widget colors default (blue instead of cyan) | URL params malformed (e.g. `#` prefix, spaces, missing `?`) | Match the snippet in section 3.2 exactly |
| Booking works but `/sales-leads` doesn't update | Webhook signature mismatch OR webhook not active | Check Calendly's webhook delivery log; verify `CALENDLY_WEBHOOK_SECRET` in SalesBrain env matches Calendly's signing key |
| Prospect doesn't get confirmation email | Their spam filter caught it, OR `zeami.io` not fully verified in Resend/Calendly | Check spam folder; check Calendly's outgoing email settings |

---

## 12. Summary — what zeami.io needs to change

**Everything else is done and live** — the only remaining work is on zeami.io.

**Recommended (Option A):** replace the current demo-request page contents with 3 lines of HTML:
```html
<link rel="stylesheet" href="https://assets.calendly.com/assets/external/widget.css"/>
<div class="calendly-inline-widget" data-url="https://calendly.com/amir-zeami/zeami-demo-30-min?hide_gdpr_banner=1&background_color=0d0d14&text_color=ffffff&primary_color=00E5FF" style="min-width:320px;height:800px;"></div>
<script src="https://assets.calendly.com/assets/external/widget.js" async></script>
```

**Post-deploy checks (should all pass immediately):**
- Widget renders inside the container with Zeami colors
- Real availability from Amir's Google Calendar shown
- Booking a test slot from an incognito window: prospect gets Calendly's confirmation, Amir gets the internal notification email, `/sales-leads` row shows within a few seconds with green "Scheduled" badge

That's the whole integration. Nothing else on zeami.io needs to change.

Estimated dev effort: **10 minutes** including styling to match the surrounding page.

### Status recap (SalesBrain + Calendly side)

| Component | Status |
|---|---|
| SalesBrain webhook endpoint deployed | ✅ Live |
| HMAC signature verification wired | ✅ Live |
| `sales_leads` schema (`booked_at`, `meet_link`, `website`, etc.) | ✅ Migrated to prod |
| `/sales-leads` UI (booking card, Join meeting, Reschedule) | ✅ Live |
| Convert-to-deal preserves Meet link + reschedule URL + website | ✅ Live |
| Calendly Standard plan | ✅ Active |
| Calendly event type + custom questions | ✅ Configured |
| Calendly webhook subscription | ✅ Active, signing key deployed |
| **Widget embed on zeami.io** | ⏳ **Pending — zeami.io dev work** |

---

## 13. Reference

- SalesBrain public API doc: `docs/external-api.md` (in the SalesBrain repo)
- Calendly widget docs: https://help.calendly.com/hc/en-us/articles/223147027
- Calendly widget URL params reference: https://developer.calendly.com/api-docs/8be1de55c73dd-embed-a-calendly-inline-widget
- Calendly postMessage events: https://developer.calendly.com/docs/embed-options-overview
