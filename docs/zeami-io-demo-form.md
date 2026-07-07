# zeami.io — Demo Request Form Integration Spec

**Audience:** whoever builds/maintains the `zeami.io/request-demo` (or equivalent) page.
**Backend:** SalesBrain CRM at `https://salescrm.chipchip.social`.
**Scheduling:** Calendly (Free plan → Standard plan for auto-sync).
**Date:** 2026-06-18

---

## 1. What we're building

Replace the current preferred-date/time/timezone picker on zeami.io's demo-request form with a real booking flow driven by **Calendly**. The prospect:

1. Fills out a short form (name, work email, company, optional details).
2. Picks a real available slot from a Calendly inline widget (or clicks through to Calendly's page).
3. Gets Calendly's confirmation email with a `.ics` invite, Google Meet link, and reschedule/cancel links.

Meanwhile, SalesBrain captures the lead as soon as the form is submitted (even if the prospect bails before booking) and — on the paid Calendly plan — auto-syncs the booking details (confirmed time, Meet link, reschedule URL) to the CRM the moment the prospect books.

### Why this is better than the current form

| Old flow | New flow |
|---|---|
| Prospect picks a "preferred" time that may not be available | Prospect picks from **actually available** slots on Amir's calendar |
| Someone on the team manually emails back to confirm/reschedule | Calendly handles confirmations + `.ics` + reschedule/cancel links automatically |
| Prospect has no self-serve way to reschedule | Prospect clicks Calendly's reschedule link — no email ping-pong |
| CRM has "preferred_demo_time" fields that need manual triage | CRM auto-populates `booked_at`, `meet_link`, `reschedule_url` (on Standard) |

---

## 2. Recommended UX pattern

Two-step, single-page:

```
┌─────────────────────────────────────────┐
│  Step 1: Contact info                    │
│  ┌──────────────┐  ┌───────────────┐    │
│  │ Full name    │  │ Work email    │    │
│  └──────────────┘  └───────────────┘    │
│  ┌──────────────────────────────────┐   │
│  │ Company                          │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ What you'd like to see (optional)│   │
│  └──────────────────────────────────┘   │
│                                          │
│  [Continue → Pick a time]                │
└─────────────────────────────────────────┘
```

Clicking **Continue** POSTs to SalesBrain (creates the `sales_leads` row) then reveals Step 2 in the same page (no full navigation):

```
┌─────────────────────────────────────────┐
│  Step 2: Pick a time                     │
│  ← Back to details                       │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │                                  │   │
│  │   [ Calendly inline widget ]     │   │
│  │   Real availability from Amir's  │   │
│  │   Google Calendar. Prefilled     │   │
│  │   with name/email/company.       │   │
│  │                                  │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

**Why this pattern:**
- Minimal friction on step 1 (highest funnel conversion)
- Lead is captured **before** the prospect sees the widget — even if they drop off, we have their contact
- Widget is always in a known-good state (prefilled) — no half-typed name lands in Calendly

An alternative pattern — **single-page inline with form + widget simultaneously visible** — also works. Slightly worse funnel metrics but simpler to build. Pick whichever fits zeami.io's design language better.

---

## 3. API contract

### Step 1 — POST to SalesBrain

Whenever the user completes the contact-info step (before opening the Calendly widget), fire one request:

```http
POST https://salescrm.chipchip.social/api/public/sales-leads
Content-Type: application/json
X-API-Key: <ONBOARDING_API_KEY>
```

Body (JSON):

```json
{
  "full_name": "Bereket Solomon",
  "company": "ChipChip",
  "email": "becksol.bs@gmail.com",
  "description": "i want to automate our team and find out which tasks are eating up time"
}
```

**Field rules:**

| Field | Required | Format |
|---|---|---|
| `full_name` | ✅ | string, 1–200 chars |
| `email` | ✅ | valid email, ≤320 chars |
| `company` | ✅ | string, 1–200 chars |
| `description` | ⛔ optional | string ≤5000 chars or `null` |

**Response:**

- `201 Created` → `{ "id": "...uuid...", "created_at": "..." }`
- `400 Validation failed` → the response body's `details` array names the offending field
- `401 / 403` → API key missing or wrong

Handle a `4xx` gracefully — show the prospect an error message and don't proceed to step 2.

> **Note:** the old `preferred_demo_date` / `preferred_demo_time` / `preferred_demo_timezone` fields are still accepted by the endpoint but you should **stop sending them** — Calendly is now the source of truth for time. Sending them doesn't error, they just get stored as legacy fallback data.

### Step 2 — Calendly widget

The widget takes over from here. No further HTTP calls from zeami.io are needed — Calendly's own systems email the prospect and (on Standard plan) POST a webhook to SalesBrain to auto-sync the booking.

---

## 4. The Calendly widget embed

### Prerequisites (Amir handles these once)

1. Sign in to Calendly with `amir@zeami.io` (or the chosen demo owner's email).
2. Connect the Google Calendar under Amir's account.
3. Create an event type — recommended settings:
   - **Name**: "Zeami Demo (30 min)"
   - **Duration**: 30 minutes
   - **Buffer**: 10 min before + 10 min after
   - **Availability**: weekdays 9–17 (Africa/Nairobi)
   - **Custom questions** (in this exact order — the CRM webhook maps by position):
     - Q1: `Company` (short answer, required)
     - Q2: `Anything specific you'd like to see?` (long answer, optional)
   - **Reply-to**: not configurable on Calendly Free — but not a problem. Calendly automatically routes replies to the organizer's account email (`amir@zeami.io`) by default. If/when upgrading to Standard, custom reply-to lives at Account settings → Communication preferences.
4. Note the event type URL — e.g. `https://calendly.com/amir-zeami/zeami-demo-30-min`. This URL goes into the widget embed below.

### The embed snippet

Drop this into the Step 2 container on zeami.io:

```html
<!-- Somewhere in <head> -->
<link rel="stylesheet" href="https://assets.calendly.com/assets/external/widget.css"/>

<!-- The container where the widget renders -->
<div id="calendly-inline"
     style="min-width: 320px; height: 700px; background: transparent;"></div>

<!-- Loader -->
<script src="https://assets.calendly.com/assets/external/widget.js" async></script>

<script>
  // Wait for the script to load, then mount the widget with prefilled values
  // pulled from the form data captured in Step 1.
  function mountCalendly(formData) {
    if (typeof Calendly === 'undefined') {
      // widget.js hasn't loaded yet — retry once
      setTimeout(() => mountCalendly(formData), 200);
      return;
    }
    Calendly.initInlineWidget({
      url: 'https://calendly.com/amir-zeami/zeami-demo-30-min?hide_gdpr_banner=1&background_color=0d0d14&text_color=ffffff&primary_color=00E5FF',
      parentElement: document.getElementById('calendly-inline'),
      prefill: {
        name: formData.fullName,
        email: formData.email,
        // Custom question answers — position-indexed (a1 = Q1, a2 = Q2)
        customAnswers: {
          a1: formData.company,
          a2: formData.description || '',
        },
      },
      // Optional: pass UTM / campaign context so it appears in Calendly's
      // event details for later attribution
      utm: {
        utmSource: 'zeami.io',
        utmMedium: 'demo-form',
      },
    });
  }
</script>
```

### Widget URL parameters worth knowing

| Param | Purpose |
|---|---|
| `hide_gdpr_banner=1` | Suppresses the "Powered by Calendly" GDPR banner |
| `background_color=0d0d14` | Match Zeami dark theme (obsidian) |
| `text_color=ffffff` | Body text color inside the widget |
| `primary_color=00E5FF` | Zeami cyan accent — used for buttons and highlights inside the widget |
| `hide_landing_page_details=1` | Skip the "About Amir" intro screen and jump straight to slot picker (only use if the intro adds no value) |
| `hide_event_type_details=1` | Skip the "30-min demo" description card |

---

## 5. React / Next.js example (single-file)

If the zeami.io site is React-based (Next.js, Astro with React islands, plain React SPA), here's a complete self-contained component:

```tsx
'use client';
import { useState } from 'react';

const SALESBRAIN_API = 'https://salescrm.chipchip.social/api/public/sales-leads';
const CALENDLY_URL = 'https://calendly.com/amir-zeami/zeami-demo-30-min'
  + '?hide_gdpr_banner=1'
  + '&background_color=0d0d14'
  + '&text_color=ffffff'
  + '&primary_color=00E5FF';

interface FormData {
  fullName: string;
  email: string;
  company: string;
  description: string;
}

export default function DemoRequestForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormData>({
    fullName: '', email: '', company: '', description: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitStep1(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(SALESBRAIN_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.NEXT_PUBLIC_SALESBRAIN_API_KEY!,
        },
        body: JSON.stringify({
          full_name: form.fullName.trim(),
          company:   form.company.trim(),
          email:     form.email.trim().toLowerCase(),
          description: form.description.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${res.status}`);
      }
      // Success — move to step 2 and mount the Calendly widget
      setStep(2);
      // Give React a tick to render the container before Calendly reads it
      setTimeout(() => mountCalendly(form), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  function mountCalendly(data: FormData) {
    // @ts-expect-error - loaded via <script> tag in _app or layout
    if (typeof Calendly === 'undefined') {
      setTimeout(() => mountCalendly(data), 200);
      return;
    }
    // @ts-expect-error - global Calendly.initInlineWidget
    Calendly.initInlineWidget({
      url: CALENDLY_URL,
      parentElement: document.getElementById('calendly-inline'),
      prefill: {
        name:  data.fullName,
        email: data.email,
        customAnswers: {
          a1: data.company,
          a2: data.description || '',
        },
      },
      utm: { utmSource: 'zeami.io', utmMedium: 'demo-form' },
    });
  }

  if (step === 2) {
    return (
      <div>
        <button onClick={() => setStep(1)} style={{ marginBottom: 16 }}>
          ← Back to details
        </button>
        <p style={{ marginBottom: 16, color: '#94A3B8' }}>
          Pick a 30-minute slot that works for you. Calendly will send you a
          confirmation with the Google Meet link.
        </p>
        <div id="calendly-inline"
             style={{ minWidth: 320, height: 700, background: 'transparent' }} />
      </div>
    );
  }

  return (
    <form onSubmit={submitStep1}>
      {/* … form fields (same as your current design) … */}
      {/* Full Name, Work Email, Company, Infrastructure Details */}
      <button type="submit" disabled={submitting || !form.fullName || !form.email || !form.company}>
        {submitting ? 'Saving…' : 'Continue → Pick a time'}
      </button>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
    </form>
  );
}
```

The `<script src="https://assets.calendly.com/assets/external/widget.js" async>` and its matching `<link rel="stylesheet">` should be loaded once at the app/layout level (or via Next.js's `<Script strategy="lazyOnload">`) so they're available when the component mounts.

---

## 6. Environment variables on zeami.io

Add to zeami.io's environment (Vercel / Netlify / server env, whatever hosts it):

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SALESBRAIN_API_KEY` | The `ONBOARDING_API_KEY` value that SalesBrain expects | Prefix `NEXT_PUBLIC_` so client-side JS can read it (Next.js convention). This is a **shared bearer key** — it's sent from the browser to SalesBrain, so it's not a strict server-side secret. Rotate it if it leaks widely, but exposing it in client JS is by design for public forms. |

Get the API key value from Amir (it's stored in SalesBrain's GitHub Secrets as `ONBOARDING_API_KEY`).

---

## 7. Design tokens — match Zeami brand

Match the widget's colors to the site's existing dark theme so it blends visually:

| Token | Value | Where |
|---|---|---|
| Background | `#0D0D14` (obsidian) | Widget `background_color=0d0d14` |
| Text | `#FFFFFF` | Widget `text_color=ffffff` |
| Accent (buttons, highlights) | `#00E5FF` (cyan) | Widget `primary_color=00E5FF` |
| Body font | Poppins | Set on the containing page — widget respects the parent's Poppins if declared |
| Card border | `#E2E8F0` (light UI parts) | Not directly settable in widget; leaves defaults |

The current form's fields (full name, email, etc.) already use these tokens — keep them consistent so the step-1 → step-2 transition feels seamless.

---

## 8. What Calendly handles automatically

Once the prospect books through the widget:

1. **Confirmation email** to the prospect — from `noreply@zeami.io` (or Calendly's default if SPF/DKIM isn't configured for `zeami.io` in Calendly — check the outgoing sender in Calendly's settings). Includes:
   - `.ics` attachment (adds to Google Calendar / Outlook / Apple Calendar in one click)
   - Google Meet link
   - Reschedule + cancel links
2. **Calendar event** on Amir's Google Calendar with the Meet link auto-attached.
3. **Reminder emails** to both parties (24h + 1h before, if configured in Calendly's event type notifications).
4. **Webhook** to SalesBrain (Standard plan only) — SalesBrain updates the `sales_leads` row and fires the internal team notification email.

zeami.io's page can just show a static "Thanks — check your email for the confirmation" message after the widget's booking-complete callback (or just let the widget's own success screen do the job).

### Wiring the booking-complete callback (optional polish)

If you want to trigger something on zeami.io when the booking completes (analytics event, redirect, thank-you screen), Calendly emits a `postMessage` you can listen for:

```ts
window.addEventListener('message', (e) => {
  // Only accept messages from Calendly's origin
  if (e.origin !== 'https://calendly.com') return;

  if (e.data.event === 'calendly.event_scheduled') {
    // Booking is confirmed. Fire analytics, redirect, show success screen…
    console.log('Booking confirmed:', e.data.payload);
    // e.data.payload contains { event: { uri }, invitee: { uri } }
  }
});
```

Other events worth listening for: `calendly.event_type_viewed`, `calendly.date_and_time_selected`, `calendly.profile_page_viewed` — useful for funnel analytics.

---

## 9. Testing checklist

Before shipping the new form to production:

- [ ] **Widget renders** — the Calendly widget shows real availability from Amir's Google Calendar (busy blocks in his calendar should not appear as available slots).
- [ ] **Prefill works** — after step-1 submit, the widget's "Your name" / "Your email" / "Company" fields are already filled with what the prospect typed. They can edit but shouldn't have to.
- [ ] **Zeami styling** — background, text color, and accent match the rest of the zeami.io page. No jarring white flash.
- [ ] **Lead capture on step 1 works** — check SalesBrain's `/sales-leads` page after submitting the form once. A new row should appear immediately, before the prospect books through Calendly.
- [ ] **Booking through the widget works** — pick a real slot in a test capacity. Verify:
  - Calendly sends a confirmation email to the test prospect address
  - Google Meet link is included and works
  - The event appears on Amir's Google Calendar
  - Reschedule + cancel links in the email work
- [ ] **Field validation** — try invalid inputs (empty name, invalid email, oversized description) and confirm the form catches them before hitting SalesBrain.
- [ ] **API failure handling** — with SalesBrain temporarily unreachable (simulate via network throttle), the form should show an error message and NOT let the prospect proceed to step 2.
- [ ] **Mobile / responsive** — the widget's iframe must be `min-height: 700px` on mobile too. Consider `height: 100vh` on small screens.

### Post-launch spot-checks (weekly)

- Are bookings actually landing on Amir's Google Calendar?
- Are `/sales-leads` rows appearing for every submit?
- On Calendly Standard: does the `booked_at` column populate on the same row within a few seconds of the prospect completing the booking? If not, check the webhook subscription in Calendly's dashboard.

---

## 10. Free vs Standard plan behavior (recap)

**On Calendly Free (current):**

| Feature | Works? |
|---|---|
| Widget on zeami.io | ✅ |
| Prefill from form values | ✅ |
| Real availability from Amir's calendar | ✅ |
| `.ics` + Meet link + reschedule/cancel in prospect's email | ✅ |
| SalesBrain auto-sync (`booked_at`, `meet_link`, etc.) | ❌ — webhooks gated |
| Internal team "Demo booked" email from CRM | ❌ — fires only on webhook |

**On Calendly Standard (after upgrade):**

Everything above plus:

- Bookings auto-sync into `sales_leads` (`booked_at`, `meet_link`, `reschedule_url`, `booking_status='scheduled'`)
- Team gets a "Demo booked: <Company> — <Name>" email immediately
- Reschedule / cancel from prospect side auto-updates the CRM row

**No zeami.io code changes needed when upgrading.** Just flip the plan in Calendly's billing UI + configure the webhook subscription. All zeami.io code stays the same.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Widget doesn't render on the page | `widget.js` blocked by CSP, or the `<div id="calendly-inline">` isn't in the DOM yet when `initInlineWidget` is called | Load `widget.js` in `<head>` OR use `defer` / `async` correctly; wrap the call in a `DOMContentLoaded` / `useEffect` |
| Prefill values don't populate | Custom answer keys `a1` / `a2` don't match Calendly's question order | In Calendly, ensure "Company" is Question 1 and "Anything specific" is Question 2. `a1` maps to Q1, `a2` to Q2 (position-indexed) |
| POST to SalesBrain returns 401 | Missing / wrong `X-API-Key` header | Set `NEXT_PUBLIC_SALESBRAIN_API_KEY` correctly, redeploy zeami.io |
| POST to SalesBrain returns 403 | The API key is set but CORS is locked to a different origin | On SalesBrain, `PUBLIC_FORM_ALLOWED_ORIGIN` must be `https://zeami.io` |
| Widget colors don't match brand | URL params not URL-encoded properly | Colors are 6-char hex without `#` — pass `00E5FF`, not `#00E5FF` or `%2300E5FF` |
| Booking works but the prospect doesn't get a confirmation email | Amir's Calendly account isn't configured to send from a verified domain, or the prospect email bounced | Check Calendly's outgoing email settings — verify SPF/DKIM for `zeami.io` or fall back to Calendly's default sender |

---

## 12. Reference

- SalesBrain public API doc: `docs/external-api.md` (in the SalesBrain repo)
- Calendly widget docs: https://help.calendly.com/hc/en-us/articles/223147027
- Calendly widget URL params: https://developer.calendly.com/api-docs/8be1de55c73dd-embed-a-calendly-inline-widget

---

## Summary

**What zeami.io needs to change:**

1. Remove the current preferred-date/time/timezone picker.
2. Add a two-step page: form → widget.
3. On step-1 submit, POST to `https://salescrm.chipchip.social/api/public/sales-leads` with `{full_name, email, company, description}` and the `X-API-Key` header.
4. On step-2, mount Calendly's inline widget for `https://calendly.com/amir-zeami/zeami-demo-30-min` with prefill from the form data.
5. Match the widget colors to Zeami's dark theme (obsidian bg, white text, cyan accent).
6. Add the API key to zeami.io's env as `NEXT_PUBLIC_SALESBRAIN_API_KEY`.

**No other integration work** — Calendly handles the confirmation email, the .ics, the Meet link, the reschedule/cancel, and (on Standard plan) the webhook back to the CRM.

Estimated implementation effort: **1–2 hours** for a familiar developer, including styling to match the current form's design.
