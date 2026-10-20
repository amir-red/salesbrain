# Guhan (AI SDR): UI/UX map and what SalesBrain should take

Competitor research, 2026-10-17. Nothing here has been built. Section 8 lists what SalesBrain should take and what it should leave.

Sources:
- **Sections 1–5:** all 46 pages of docs.guhan.ai. These sections say what the docs *say*.
- **Section 6:** the four "AI GTM Outbound Playbook" videos (transcripts plus frames).
- **Section 7:** a read-only walk through Amir's trial workspace at guhan.ai/zeami.

Where the docs and the live app disagree, sections 6 and 7 are right. In sections 1–5, my own inferences are marked *(inferred)* and places where the docs contradict themselves are marked **[inconsistency]**.

Product one-liner (their words): "an AI SDR — a Sales Development Representative that runs the full outbound workflow: learns your business, finds fit prospects, researches every one, drafts hyper-personalized outreach across LinkedIn, Email, and WhatsApp, handles replies, and books meetings for the sales team." Positioning line repeated across pages: **"Guhan does the volume; you keep the judgment."** Workflow slogan: **Set up your business context → import leads → run a Campaign → handle replies → book meetings.**

Target user: "Founders and sales teams selling to a defined buyer." Entry test, three questions: who is your ideal customer, what tells you they might be ready to buy, what do you offer them. "To onboard, you only need your website URL."

---

## 1. Information architecture

### 1.1 Sidebar (main nav)

The sidebar "follows the workflow":

| Item | What lives there |
|---|---|
| **Home** | "Your daily snapshot": what needs attention and what Guhan has been doing. (No dedicated docs page; only described in one line.) |
| **Inbox** | Two-pane conversations view; "Needs you" / "Active" / "Resolved"; Mine/Team; channel tabs. |
| **Meetings** | Tabs Upcoming / Past / Cancelled / Unmatched / All. |
| **Campaigns** | Campaign list (status, messages sent, replies, meetings); per-campaign tabs Leads / Sequence / Overview. |
| **Prospects** | Two tabs: **People** (default) and **Companies**. Buttons top-right: **Create lead**, **Import leads**. |
| **Lists** | All Lists with Source / Status / count; **New list**; per-List tabs Prospects / Sources / History. |
| **Brand & Voice** | Five tabs: Brand, Voice, Competitors, Templates, Products & Services. |
| *System:* **Workspace settings** | Bottom of sidebar. Settings tree below. |
| *Coming soon:* **Ask Guhan**, **Claude MCP**, **Codex MCP** | Listed under "Coming soon". Ask Guhan is documented as a working beta "depending on how it has been enabled for your workspace"; the MCP shortcuts are "planned shortcuts and aren't available yet". |

Other surfaces outside the sidebar:
- **History** page (Ask Guhan past chats, searchable by title), shortcut **Cmd/Ctrl + Shift + O** ("Open Past chats").
- **Profile** (per user): **Sender accounts** (connect your own), **My calendars**, **API keys** tab.
- In-app API reference at `/docs/api`, OpenAPI at `/api/v1/openapi.json`, MCP server at `/api/mcp`.
- A global **banner** at the top of the app for broken senders, out-of-credits, read-only state.
- Prospect and company records open as a **side panel** first, with an expand control to a full page ("Open full record").

### 1.2 Settings tree (Workspace settings)

"Some rows are visible only to org admins. Everyone else sees **Sender accounts**, **Calendars**, and **Team**."

| Row | Visibility | Contents |
|---|---|---|
| **Sender accounts** | All | List of connected LinkedIn/Gmail/Outlook/WhatsApp senders with status badges and "sent today vs daily limit"; **Add sender** (top right); per-account menu **Configure** / **Disconnect** (plus **Re-authorize**, **Reconnect**, **Reactivate** depending on state); per-account settings = daily limit + sending schedule (hours, days, timezone), owner (admins), and for WhatsApp the **Conversation agent on WhatsApp** toggle. |
| **Calendars** | All | Connected calendars (one row each, **Copy public booking link**, disconnect); **Connect calendar**; **Workspace meeting defaults** card (admins). |
| **Sending & Reply Rules** | Admin | Working hours and timezone **per channel** (defaults for newly connected accounts); **Reply handling** (3-way workspace reply policy). Also referred to as "Workspace settings > Sending rules > Reply handling". |
| **Do-Not-Contact list** | Admin (page) | Paste box (one email/domain per line) → **Add to list**; search; remove. |
| **Team** | All (actions admin) | Invite by email + role, members and seats, pending invites (revocable), custom roles (**New role**, org admins). |
| **Billing** | Admin | Plan, licenses, credit balance, credits this cycle, active prospects, history/breakdown of where credits went; tabs incl. **Subscription** (cancel link at the bottom) and **Credit packs** (under "Buy more"). |
| **Enrichment settings** | Admin | Workspace defaults for the seven enrichment steps, each with credit cost; product picker for the brief/fit score; **Reset to defaults**. |
| **Workspace & advanced** | Admin | Rename workspace, URL slug ("old links keep working"), company identity; org admins: enable multiple workspaces, create/delete workspaces (deleting is permanent). |

**[inconsistency]** Settings overview says "Brand & Voice and Products have their own sidebar pages", but every other page puts Products as a tab inside Brand & Voice.

---

## 2. The end-to-end flow

### Step 0. Sign up
guhan.ai → **Get started** → email → confirm a **6-digit code** → name + password. "No credit card required." Trial = **7 days, 500 credits**.

### Step 1. Paste your website (wizard step 1 of 5)
Screen asks for the company website. Click **Analyze**. "Guhan reads a handful of pages from your site and pre-fills the rest of the wizard." Framing note at the top of the Quickstart: "Every onboarding step is Guhan collecting business context from you, the way you'd brief a new SDR."

### Step 2. Confirm your brand
Guhan drafts **company name, industry, what you sell, and the pain you solve**, and **marks the draft as AI-generated**. User decision: read every line, fix anything off. Reassurance tip: "You can edit all of this later under Brand & Voice. Nothing is locked."

### Step 3. Who to reach + which companies (the ICP)
- **Who to reach**: job titles and locations. Type a title, click **Suggest variants** for close alternatives "you can keep or remove".
- **Which companies**: industries and company sizes, plus an optional **buying signals** switch. "Each signal you pick gets its own List."

### Step 4. Review five real prospects
Guhan runs a real search and shows **five** matching people. Per person: **Reject**. Then **Looks good — continue**. "Rejecting pulls fresh candidates, up to three times." The kept people seed the first List. This is the only point in onboarding where the user judges actual output.

### Step 5. Name your Campaign and launch
Summary of brand, audience and signals + campaign name. **Looks good — Launch agent**, then a channel-mode picker: **Multichannel** (LinkedIn invite and message, with email follow-ups), **LinkedIn only**, **Email only**; some modes show **Upgrade to unlock** depending on plan. Button: **Go launch**. Sender accounts are connected *after* this, from Settings → Sender accounts.

What launch creates: one List per signal picked (or one List if none), one Campaign over all those Lists, a starter sequence matching the mode. User lands on the Campaign's **Leads** tab while the first search runs.

Key guardrail (Warning box): the Campaign is created as a **draft**. "Nothing is sent until you review the sequence, connect a sender, and launch the Campaign. The setup screen says the campaign stays paused until at least one sender is connected."

### Step 6. Leads flow into the List (ongoing, autonomous)
Source runs as a "watch" → profiles returned (1 credit each, before filters) → Who-fits filters, competitor removal, DNC removal, not-a-person removal → dedupe → research brief + fit rating (Strong/Moderate/Weak, "Pending…" meanwhile) → added ("Landed"). User reviews via List → Sources tab watch history and the Fit score column; tightens rules via **Edit**.

### Step 7. Build / edit the sequence, preview, launch
Sequence tab editor; per message step pick Auto-draft / Guided / Fixed; preview against a real prospect; **Test run**; **Launch** runs a readiness check (blockers vs warnings) and a confirm dialog ("Cancel keeps it a draft").

### Step 8. Sends happen (autonomous within guardrails)
New members of included Lists auto-enroll while the campaign is live (no toggle). Sends are paced inside each sender's window and limits; a limit makes the step wait, never skip.

### Step 9. Inbox
Replies classified into 7 kinds; policy decides escalate / draft for approval / auto-send. User clears "Needs you" top-down: **Schedule** first, then **Approve**, then **Take over**, then **FYI** ("Got it").

### Step 10. Meeting
Meeting requests are never auto-answered. **Send link** creates a booking link in-thread; prospect books on a Guhan-hosted page (Google/Outlook) or your Cal.com/Calendly; the meeting appears on the calendar and under Meetings, linked to the prospect and conversation.

---

## 3. Area by area

### 3.1 Onboarding / Quickstart
Covered in §2. Extra details:
- The wizard shows **five numbered steps** (website, brand, who to reach + which companies, preview, launch); sign-up precedes it.
- "If something's off": "No prospects yet. The first search takes a little while… if it stays empty, loosen your titles or industries on the List." "Sender not connected. Connect one under Settings → Sender accounts."
- "What next" cards: Review your prospects, Build your sequence, Connect more channels, How credits work.

### 3.2 Sender accounts
- Definition: "one of your own accounts (LinkedIn, Gmail, Outlook, or WhatsApp) that Guhan sends from as you." "Guhan never sends from a Guhan address. The prospect sees you."
- "Sender accounts are only for sending. Finding prospects never uses your personal accounts. If you only want to see the prospects Guhan finds, you do not need to connect a sender at all." (FAQ: no Sales Navigator needed; prospects come from "Guhan's managed data sources".)
- **Limit** = licenses + extra-sender add-ons; each license = 1 sender of any channel. Connect dialog shows usage, e.g. **"1 of 2 senders used"** / "2 of 3 with 3 licenses". At the limit, connecting is blocked. A sender counts once connected (including when it needs reconnecting); an unfinished connection does not.
- **Add sender** dialog: choose **LinkedIn**, **Email (Gmail)**, **Email (Outlook)**, **WhatsApp** → **Continue authentication** → provider's own sign-in in a new tab (or QR). "Guhan never sees your password." Admins can connect on behalf of a teammate and choose the owner. Also reachable from Profile → Sender accounts and from the connect prompt in a campaign's sender setup.
- **LinkedIn**: two sign-in tabs, **Credentials** (email + password → **Login**) or **Cookies** (paste **li_at**; optional **li_a** for Recruiter/Sales Navigator). In-page link **How to find them?** with a 6-step devtools walkthrough (F12 / Option+Command+I → Application/Storage → Cookies → linkedin.com → filter `li_at` → copy Cookie Value). Warning: "Treat the cookie like a password." Cookie must come from a computer, same browser. Troubleshooting: pop-up blocked, try other method/private window, "already connected" by someone else in the org, "Stuck on finishing setup".
- **Email**: Gmail/Google Workspace, Outlook/Microsoft 365. Approve all permissions incl. calendar to reuse it as calendar. Sends one-to-one from your address; replies land in your mailbox and the Guhan Inbox. Bounces recorded on the original message and stop the sequence; "A bounce does not appear as a reply." Password change → **Re-authorize**; email steps wait.
- **WhatsApp**: scan QR via WhatsApp → Settings → Linked Devices → Link a Device; QR within **60 seconds** or choose a **pairing code**. "WhatsApp is treated as a personal channel. Use it for people who have already replied or agreed to hear from you, not for cold outreach." Needs a phone number on the prospect. Lowest daily limit. Toggle **Conversation agent on WhatsApp** → message your own number to talk to Guhan; "Only messages you send to yourself are picked up."
- **Status badges**:

| Badge | Meaning | Action |
|---|---|---|
| *(no badge)* | Connected and sending normally | Nothing |
| **Connecting** | Sign-in in progress | Finish in the other tab |
| **Re-authorize** | Provider needs sign-in again (e.g. password change) | Menu → Re-authorize |
| **Reconnect needed** | Disconnected/removed on provider side while campaigns depend on it | Open → Reconnect |
| **Rate-limited** / **Suspended** | Provider restricted the account | Check on provider site; Guhan pauses sending |
| **Paused**, **Error**, **Disconnected** | Not usable now | Reconnect |
| **Hibernated** | Workspace read-only ≥ 1 week, Guhan released the connection; campaigns/history kept | **Reactivate** once active again |

- Broken sender → app banner; sends stop, queued steps wait, new prospects wait for a working sender; its prospects pause and resume on reconnect.
- **Disconnect** with active campaigns → marked **Reconnect needed** instead of removed, "so those campaigns keep their place". Past conversations stay.
- Several senders per channel in one campaign: work is spread; once a prospect is contacted from a sender, later steps keep the same sender ("a conversation stays with the same account").
- Each sender row shows **sent today vs daily limit**.

### 3.3 Brand & Voice
"Where you brief Guhan, the way you would brief a new SDR: what you sell, who it is for, how you talk, and what never to say." One per workspace, applies to every campaign. "Do not put prospect-specific notes here." Changes apply to messages drafted after save; sent messages unchanged. Each tile saves on its own; **Edit** on a tile opens a side panel → **Save changes**.

**Brand tab**
- **Industry** (pick or search)
- **Company description & value proposition** ("two or three plain sentences")
- **Customer pain points** ("specific problems"). Tip with a concrete good/bad example: "Sales teams spend two to three hours a day on manual prospecting and the lists go stale before anyone works them" vs "prospecting is hard".

**Voice tab**
- **Tone**: Professional, Conversational (default), Direct, Authoritative, Technical, Casual, Consultative; each with a short description in the picker ("seven baselines").
- **Preferred language**: guidance, not a guarantee. Options include several English variants, Spanish, French, German, Portuguese (Brazil), Dutch, Italian, Japanese.
- **Words / patterns Guhan won't write**: chip input (Enter or comma), e.g. "just wanted to circle back"; "strictly" kept out of drafted messages.
- Explicit design note: "There is no 'always include' list. Forcing a phrase into every message made messages read as repetitive."
- Rule: only **tone** and the **never-say list** count as "configured voice"; default tone + empty list = "voice not set up yet" (this drives the launch warning "No brand voice configured").

**Competitors tab**: **New competitor** (top right), search box, rows with **Name** + **Differentiation** ("where you win and where you would concede"); row menu Edit/Delete. Used when a prospect mentions that competitor, and also as a filter: prospects working at a competitor are rejected at intake.

**Templates tab** (see 3.4) and **Products & Services tab** (see 3.5).

Scope note: Brand & Voice affects Auto-draft, Guided and AI replies only. "A step set to Fixed message is sent exactly as you typed it." Stability advice: "Changing tone or the never-say list part-way through a campaign makes later messages sound different… prospects notice."

### 3.4 Templates
- Two types: **Guided** (instructions: angle, hook, ask → written fresh per prospect) and **Fixed message** (exact text with `{{firstName}}`-style variables; not rewritten).
- Five read-only **starters** (badges **Starter**, **Guided**, **Default** = suggested first for that channel):
  1. Follow-up email · Referral ask (widen the funnel) — Email
  2. Deliver value · Give it up front — Email
  3. WhatsApp · After reply — WhatsApp
  4. WhatsApp · Gentle nudge — WhatsApp ("one gentle follow-up… then stop")
  5. Re-engagement · Old trial + new signal — Email
- Create: **New template** → name + channels (multi-channel allowed; email has **Subject**) → type → write (**Insert variable**: prospect, company, sender, workspace) → optional **tag** and, on LinkedIn post-comment templates, **Use prospect's recent post** (may use credits) → **Create template**.
- Starter rows: **View** / **Clone to edit**. Custom rows: edit, clone, delete. Filters: channel, tag, kind (**All / Starters only / Custom only**), search by name/tag/instructions.
- Using one: on a message step, **Start from template** (right of "How do you want this message written?") **copies** the text in; the step is then independent in both directions. Not shown on Auto-draft steps.
- Good-instruction example: "Congratulate them on the round, name the lead investor if visible, offer one benchmark from similar-stage companies, end with a question" beats "say congrats and pitch".
- Fixed message with an empty variable for a prospect → that send is **skipped**.

### 3.5 Products & services
"Each campaign pitches one product." Separate campaign per product. All fields optional:

| Field | Guidance |
|---|---|
| **Name** | |
| **Description** | "Skip marketing taglines. It is background for Guhan, not copy to repeat." |
| **Pain this solves** | Frames the opening; falls back to Brand-tab pain points if empty |
| **Case studies (proof)** | Company/customer type, challenge, solution, result ("Include a number"); may be anonymous, e.g. "a home-decor brand about your size" |
| **Free resources you can offer (value gives)** | Title, description, format, optional public URL. With URL → replies include it; without → Guhan leaves you an **Inbox task** to send it |
| **Objection handling (for AI reply)** | Objections + answers, used in reply drafts |

Picked on the campaign's Start step (**Product** / "Product or service"), next to context and goal. Deleted/unset → fallback to workspace description and pain points. Per-product fit ratings appear on each prospect's Research tab when you have several products. Tips: "Lead with the pain, not the feature list." "One strong case study with a real number beats three vague ones."

### 3.6 Prospects page (People tab)
- **Default columns**: name, job title, email, phone, LinkedIn URL, company, location, **fit**, **status**. Optional via column menu: headline, industry, company details, Lists, Campaigns, dates, enriched flag. Column menu groups include **Fit & pipeline** (Fit score, Status).
- **Filter** rules (AND-combined): name, job title, company, location, email, phone, LinkedIn URL, status, List, signal source, Campaign; plus **Include pipeline-rejected** at the end of the field list.
- **Edit in place**: name, title, company, location, email, phone. Editing a company detail (industry, size) edits the company record for every prospect there.
- **Selection**: row ticks, header tick = page; a bar **"Select all N matching your filters"** (up to **10,000**); changing a filter clears it. Bottom bar: **Enrich**, **Export**, **Add to list**, **Cancel**. Enrich works on the current page's ticks only; Add to list and Export also work on select-all.
- **Add to list**: pick a List (search/signal-fed Lists greyed out) or **Create new list** → confirmation reports added vs already-in-list; fit and research carry over, "nothing is rewritten or charged again". If the List feeds an active Campaign the dialog says so (auto-enroll). >500 people runs in the background with a progress banner on the List page. Active-prospect limit applies (adds only those who fit, reports how many were left out).
- **Export CSV**: filtered view or selected rows, max **10,000** per export.
- **Statuses**: Cold (not in a sequence), Active, Replied, Paused, Do not contact, Unmailable (a channel failed, e.g. bounce), Rejected (only with the pipeline-rejected filter). Removal sets **unsubscribed**.
- Keyboard: Left/Right scroll the table sideways, Shift+Left/Right scroll further.
- **Prospect record** (side panel → full page). Tabs:
  - **Details**: editable fields + **Enrich** (refreshes LinkedIn profile).
  - **Overview**: contact channels, company, **Signals: why we matched**, List memberships, role and experience.
  - **Research**: research brief, fit rating (tier + small 1–10 score), per-Product ratings with reasons; **Regenerate brief** (1 credit, refunded on failure).
  - **Activity**: enrollments, every message/reply/event.
  - Header: **Find email (4 credits)** and **Find phone (12 credits)** under the name; charged only if found; needs LinkedIn URL.
  - **...** menu: **Pause enrollments**, **Flag for handoff** (marks the conversation warm so a person takes over), **Remove from outreach** (status → unsubscribed, sequences stop, record kept; "This is not Do Not Contact").
  - Hard delete only via support (privacy requests); Ask Guhan cannot delete either.
- Troubleshooting entries: "A prospect has no job title or company" (not enriched), "The fit rating says Pending…" (research not finished or brief generation off), "I cannot reveal an email" (needs LinkedIn URL; no charge if nothing found).

### 3.7 Import leads
Entry: Prospects → People → **Import leads** (top right) or **Create lead**. Three sources, each a **two-step form** (1 = source, 2 = destination List + schedule + enrichment), final button **Import leads**:

| Option | Use it when |
|---|---|
| **From People Search** | "You can describe who fits" |
| **From Signals** | "You want people only when something happens" |
| **Upload CSV** | "You already have a list of people" |

**Step 2, List choice**: existing or **Create new list**. Lists already holding a search/signal are greyed out with **"already has a source"** (a List stays tied to one search or signal); CSV/manual-only Lists remain pickable. If an active Campaign uses the chosen List, the dialog warns new prospects auto-enroll.

**People search, "Who fits" rules** (every rule is a must-match):
- **Job titles**: type + Enter; **Suggest variants** (only added when picked). Literal matching: "Sales Director" ≠ "Director of Sales".
- **Seniority**: Individual Contributor, Manager, Director, VP, C-level.
- **Time at current company**: Recently joined, <1 yr, 1–2, 2–5, 5–10, 10+. **Time in current role**: <3 months, 3–6 months, 6–12 months, 1–2 yrs, 2–5 yrs, 5+ yrs (two separate single-dropdown rules).
- **Location**: city/state/country/region, matched at the level picked ("A city does not widen to its whole country").
- **Industry**: LinkedIn's industry list ("'SaaS' is not one of them; use 'Software Development'").
- **Company HQ country** (stricter than person location) and **Headcount** min/max (blank = no limit).
- **Add rule** button lists the fields.

**Signals**: see 3.9. A source runs one signal; some find people directly, others find companies then apply Who fits.

**CSV**: max **500 rows**. Auto-guessed column mapping, **three-row preview**, any column changeable. Required: **Last name** + at least one of email, phone (with country code, `+14155550123`), LinkedIn URL. Optional: first name, job title, department, seniority, company name, company domain, company LinkedIn URL, industry, location. Rows without LinkedIn URL import but can't be enriched. No discovery credits, but counts toward active-prospect limit (overflow rows skipped with a message). Enrichment toggles decide what gets filled; turn all off for none.

**Create lead (manual)**: first + last name, at least one of email/phone/LinkedIn URL, role, company; optional List (blank = workspace only). Suggested uses: warm leads, referrals, "adding yourself to test a Campaign before launch".

**Shortcuts inside a List**: header **Import** → **Import CSV** / **Add manually**; Sources tab **Add source** on a List with no search/signal. The Prospects page is "the only place to start a search or signal that creates a new List."

**Ongoing vs One-time**:

| | Ongoing | One-time |
|---|---|---|
| Behaviour | Keeps looking, adds new matches as they appear | Runs once, stops |
| Settings | Daily limit in steps of 25 from **25 to 1,000**; weekly and monthly limits, can be **no cap** | **How many to import: 1 to 5,000** |
| Post-based signals | Catches new posts as published | Look-back window + post cap (competitor posts: 24 h to 1 year; topic posts: past day/week/month) |

"Engaged with specific posts" has its own schedule (see 3.9). Switch later via **Edit** on the List. Warning: "Limits cap how many people are added, not what each one costs. You are charged for every profile a run finds, including ones your filters later reject."

### 3.8 Lists
- "A List answers 'who should we talk to?'. A campaign answers 'what do we do with them?'." Suggested splits: by persona, by market, by motion.
- **Lists page** columns: name, **Source** (signal name, **Search only**, **CSV upload**, **Manual**, **Copied from list**), **Status** (**Active** while a source runs, **Paused**, **Draft** = no search/signal yet), prospect count. **New list** asks only for a name. Row menu: **Edit list**, **Clone list**, **Delete list**.
- A List = one search/signal source + any CSV/manual adds on top. Different search → another List or **Clone list**.
- **List page** tabs: **Prospects** (fit rating, search, filters, export), **Sources** (source on/off, watch activity: found / added / rejected, when the next watch runs, **View all watches**), **History** (log of source edits). Header row: **One-time**/**Ongoing** badge, status, **Pause**/**Resume** (source), **Edit**, **Import**, **Enrich** (→ **Enrich whole list**), menu → **Delete list**.
- **Active-prospect limit**: **1,000 active prospects per sender** (licenses + extra senders); applies to CSV, manual adds and clones only. Unsubscribed/stopped/finished prospects don't count. Search/signal finds are exempt "because you pay credits for them as they are found."
- **Delete list**: removes the List, memberships and its source; people and other memberships untouched; **blocked while a Campaign uses the List as audience**.

### 3.9 Signal catalog (all nine)
General: one signal per source; **person signals** (find post authors/engagers/mentioned, then filter with Who fits under a collapsed **"Narrow by who fits (optional)"**) vs **company signals** (find companies, then people matching Who fits). Charged per profile found, before filters. Three groups in the picker:

**Content and engagement**
1. **Posted about specific topics** — Keywords (tags; pain language like "struggling with", "what tool do you use" recommended). **People to import**: Authors, Engagers, Mentioned (Authors + Engagers ticked by default). **Engagement type** (if Engagers): **Commenters only** (default, "higher intent") or **Commenters + reactions** ("more volume, lower intent"). One-time: window past day/week/month + max posts per keyword.
2. **Engaged with specific posts** — Post URLs; people: Engagers (default) and/or Mentioned; engagement type as above. Schedule: each post checked **twice a day for week 1, once a day for the next two weeks, then dormant**; dormant posts can be renewed.
3. **Engaged with competitors' content** — Competitor URLs (LinkedIn company page or an individual profile, e.g. competitor CEO); people Engagers/Mentioned; engagement type. One-time window: last 24 h, 7 d, 30 d, 3 mo, 6 mo, 1 yr + max posts per source.

**Career changes** (take company URLs, so company-side Who-fits rules are hidden/not applied; title/seniority/location still apply)
4. **New executive (in last 90 days)** — Company URLs; executives or directors who joined in last 90 days.
5. **New leadership (C-level / VP)** — same, narrowed to senior leadership. "Good for account-based plays where a new leader may be reconsidering tools and vendors."

**Hiring and growth** (company signals)
6. **Recently raised funding** — nothing to configure; fixed **90-day** window. Tip: pair with finance/ops/RevOps titles.
7. **Hiring growth** — **Min headcount growth (%)** 1–500 (starts at 20); **Over the last** 1/3/6/12 months (starts at 6).
8. **Hiring in specific areas** — **Job functions** (Sales, Engineering, Marketing, Product Management, Customer Support, Finance, Human Resources, Operations…); open LinkedIn postings from the last 30 days; industry/region inherited from Who fits.
9. **Uses a specific technology** — **Technologies** picker (free text allowed but **flagged** "because it may not match anything"); separate data source. **Cost: 3 credits per matching company** (1 to find, 2 to confirm) **+ 1 per profile** found.

Combining signals = one List per signal; a person in several Lists stays one person (deduped). "No signal at all" = People Search alone, "without the 'why now' trigger."

### 3.10 How prospects get added (the pipeline)
Five steps, shown as a numbered sequence:
1. **A search finds profiles** — each returned profile charged.
2. **Your filters are applied** — all Who-fits rules; remove competitors' employees, DNC people/companies, company pages. "Rules that need profile or company details trigger enrichment first, so a rule is never skipped just because data was missing."
3. **Duplicates are skipped** — even across sources.
4. **Guhan researches and rates them** — research brief + **Strong fit / Moderate fit / Weak fit**; **Pending…** meanwhile.
5. **They are added to the List** — a Campaign on that List can start messaging.

Post-based signal finds are always profile-enriched ("a post only carries a headline").

**What you pay for** (Warning box, shown as **Prospect discovery** on billing): 1 credit per profile returned, before filters; some signals add a company charge; CSV/manual free for discovery; enrichment/brief/reveal separate; credits running out mid-run → remaining profiles rejected.

**Fit rating**: colored label in **Fit score** column; based on profile, company, signal, Brand & Voice and Products. Strong = "Right role and company, and a clear connection to what you sell"; Moderate = "reasonable match that is weaker on at least one point"; Weak = "Thin alignment". 1–10 score next to the tier on the prospect page. Weak fits are still added ("the rating helps you decide who to work first"). Turning off **Generate research brief + fit score** → no fit rating.

**Research brief**: short write-up on person + company "with a suggested angle for outreach"; Research tab; **Regenerate brief** 1 credit (refunded on failure).

**Rejected profiles are kept**, visible in two places: List → Sources → watch history (each watch: **Landed**, **Rejected**, **In flight**, reason per rejection) and Prospects → **Include pipeline-rejected** (status Rejected). Rejection reasons verbatim:
- Doesn't fit your audience
- Works at a competitor
- Blocked by Do-Not-Contact / Company on DNC
- Company / Page (not a person)
- No current employer on LinkedIn profile
- Profile fetch failed
- Profile enrichment never completed

### 3.11 Reviewing prospects (tightening)
"Check the first batch before you point a Campaign at the List. A few minutes now is cheaper than messaging the wrong people." Routine: Prospects tab sorted by Fit score → Sources watch activity → open a few Rejected. Per prospect, the test question: **"would I send this person a personalised message right now?"** Yes keep; No → remove from outreach, maybe DNC, tighten source. Fix accordions:
- **Wrong seniority** → add exact title forms via Suggest variants + set Seniority.
- **Wrong industry** → narrower industry, headcount range, or a signal.
- **Wrong location** → city only matches the city; use country.
- **Almost nobody is added** → remove non-essential rules; Rejected reasons show which rule rejects most.
- **Most prospects have no email** → reveal (4/12 credits) or turn reveal on.
- **Mostly Moderate or Weak fit** → rewrite search around the real customer, add an intent signal, fix Brand & Voice/Products (fit is based on them).
Rule changes apply to future runs only.

### 3.12 Companies
Prospects → **Companies** tab (old Companies page links redirect). One record shared by all prospects there ("useful for account-based selling"). Filters: industry, country, city, headcount, status; default shows companies with ≥1 prospect (option to include others). Inline edit: name, industry, size, location, domain. **Create company**: name (required), website, LinkedIn URL, industry, location, employee range, founded year, description, notes. Enrich (1 credit, needs company LinkedIn URL): one via Details → **Enrich**; many via **Enrich company** in the bottom bar or the sparkle on Industry/Size/Location headers. Company record tabs: **Details**, **People**, **Lists**, **Research** (company brief + recent funding and hiring highlights), **Activity**. **... → Block company** (adds domain to DNC; future prospects rejected; in-flight sequences paused; needs a domain to take effect; **Unblock** reverses status only, domain stays on DNC). **... → Delete** (prospects kept but lose the company link). Duplicates: matched by domain, else name; reassign via the company cell.

### 3.13 Enrichment
Seven steps (the canonical cost table):

| Step | What you get | Credits | Default |
|---|---|---|---|
| Enrich prospect profile | Title, company, location, experience, education | 1 | On |
| Fetch prospect's recent posts | Last 30 days, up to 5 posts | 0.25 | Off |
| Enrich company profile | Industry, headcount, HQ, founded year, description | 1 | On |
| Fetch company's recent posts | Last 30 days, up to 5 | 0.25 | Off |
| Generate research brief + fit score | Brief + Strong/Moderate/Weak | 1 | On |
| Reveal work email | Verified work email | 4 | Off |
| Reveal phone number | Direct mobile | 12 | Off |

Charged per successful result.
- **Three-level settings, most specific wins**: Workspace default (Settings → Enrichment, **Reset to defaults**) → Per List (Import step 2 or List Edit; copy: "Unset toggles inherit from workspace settings.") → Per run (e.g. Enrich whole list panel). Brief toggle has a product picker.
- **Locked toggles**: if a Who-fits rule needs profile/company data, that step is checked and locked with **"Required by your prospect filter."**
- **Column wand**: hover a People-table header (email, phone, job title, company, location, headline, industry, domain, company HQ, company size) → sparkle → enrich selected rows or the whole page; empty cells show **Enriching…**; filled cells skipped. Hover an empty cell to enrich one prospect.
- **Select rows → Enrich**: message reports how many queued and roughly how many credits.
- **Enrich whole list**: tick steps (each with cost); progress on the List page; ineligible skipped with a reason.
- **Reveal**: Find email / Find phone buttons, the column wand on Email/Phone, or List-level toggles. Only charged when found; needs LinkedIn URL; same value revealed again within a day not double-charged. Phone needed for WhatsApp; email for email steps.
- **Skip rules** (no double spend): no LinkedIn URL; profile enriched in last **7 days** or repeatedly failed; posts fetched in last **3 days**; already has a brief or not on a List ("the brief lives on the List entry"); same step already running; company step with no company. After a few failures, Guhan stops retrying → **Retry** next to the enrichment badge in the List table.
- Read-only workspaces cannot enrich.

### 3.14 Campaigns
- A campaign = **Audience** (include ≥1 List, optional exclude Lists) + **Sequence** + **Senders** (pool per channel) + **product**, **goal**, **context** note.
- **Campaigns list**: status, audience, messages sent, replies (count; hover shows reply rate), meetings. **New campaign** top right.
- **Campaign tabs**: **Leads** (each prospect, current step, next step, status; unenrolled audience members show as **Waiting**), **Sequence** (editor; click **Start** for settings), **Overview** (lead stats, deliverability, **14-day activity chart**, funnel; right after launch shows Guhan finding first prospects). A live campaign opens on Overview.
- Header: status (**Live**, **Paused**, **Draft**), one action button (**Launch** / **Pause** / **Resume**), **...** menu: **Clone campaign**, **Delete campaign**. Full status set: Draft, Live, Paused, Done, Archived.

**Build**: **New campaign** → setup sheet: name (e.g. "Series B fintech founders - Q4"), audience include (required) / exclude, **Product or service**, **Goal** (e.g. "Book a 15-min intro call."), **Context** ("who you are targeting and your hook"), senders per channel (auto-selected when exactly one active account exists), **Allow re-entry** (cooldown in days + optional max entries) → **Create campaign** → blank canvas: Start connected to Exit. Start-step settings read-only while live.

**Sequence editor**: top-to-bottom tree, branches as side-by-side columns. **+** on any connector → step picker that offers only valid steps; greyed options explain why (e.g. **"AI reply must follow a wait for a reply"**). Click card or pencil to edit; copy and trash icons; deleting in a straight line offers bridge-the-gap vs remove-everything-after; on a branch, keep one path. Copy/paste onto any connector. Cmd+Z / Cmd+Shift+Z (or Ctrl+Y). Autosave as draft; bar above canvas shows **Editing**, **Valid**, undo/redo, **Test run**, **Discard changes**, full-screen toggle. Invalid steps show "a plain-language error" on the card (common: unconnected step, email step with no subject, branch/wait missing a required path).

**Step types**
- **Send a message** — LinkedIn: invite (note ≤ **300 characters**), DM (to a connection), visit profile (triggers "viewed your profile"), comment on a post, react to a post. Email: send (follow-ups thread as "Re: …"). WhatsApp: message. Options: **Require approval before sending** (draft held in Tasks until you click Send; text steps only); **Reference their recent posts & activity** (LinkedIn DMs); comment/react: target **latest** or **most-engaged recent post**, max post age (default **30 days**), reaction type; no qualifying post → step skipped. Warning if no account connected for the channel (save allowed, launch not).
- **Wait** — days + hours; cannot sit next to a wait-for-event step.
- **Wait for reply / event** — channel then event; timeout default **7 days**; two exits (event happened / timeout). Events: LinkedIn: Invite accepted, They replied on LinkedIn, They replied to your comment; Email: Link clicked, Email reply; WhatsApp: They replied on WhatsApp; Any channel: Any reply on any channel. Only events an earlier step can produce are offered. "Email open tracking is not offered."
- **Branch on a condition** — rows (field, comparison, value), **all**/**any**; Yes/No paths. Fields: Prospect (job title, department, seniority, headline, location, has email, has phone number, do not contact); Company (industry, headcount, HQ country, HQ city, founded year); How they were added (signal source, agent search, manual paste, CSV upload, cloned from another list); Lists (also in / not in another list); Time (days since added, days in list, days enrolled in this campaign).
- **Hand off to a teammate** — urgency, optional subject + context; **Notify** (heads-up task) or **Take over** (you send the next message, then the sequence continues down its single path). Legacy Approve/Decide/Schedule handoffs still work in older sequences.
- **AI reply** — after a wait-for-reply; **Send for approval** on/off; **Max consecutive replies** 1–10; hard stop at **20 replies per prospect**; **Reply timeout** 1 hour–30 days (default **3 days**); four exits: **Conversation done**, **Meeting requested**, **Not interested**, **Reply timeout**. Built-in, no path needed: OOO → pause 7 days; "not now" → pause 30 days; failed sends → Tasks for manual retry. 1 credit per automatic reply; approved ones charged at Send.
- **Exit** — records reason: completed, replied, no response, unsubscribed, bounced, do not contact, paused by you, custom. Multiple paths can share one Exit.
- **Start** — no steps; opens campaign settings.

**Message modes** (tiles under "How do you want this message written?"):

| Mode | Behaviour | Credits |
|---|---|---|
| **Auto-draft** | Written from campaign goal + context + prospect research; no instructions | 1/message |
| **Guided** | Written from your instructions (angle, hook, CTA), adapted per person | 1/message |
| **Fixed message** | Exact text, `{{tokens}}` filled; not rewritten | 0 |

Tokens: `{{firstName}}`, `{{company}}`, `{{title}}`, `{{senderFirstName}}`, `{{signature}}` (+ Insert variable menu). Missing token → send skipped "so you never send 'Hi , thanks for reading'." Step preview: pick a prospect, read the draft. **Test run**: walk a prospect through the steps, nothing sent; "template-level preview; it is not a full personalized draft."

**Personalization inputs** (what Guhan reads per AI message): the prospect (name, title, company, headline, past roles, location); research brief (built on the spot if missing "so the message is not generic"); the reason they're on the list (signal); your brand (name, story, industry, pain points, language, tone, never-say); the campaign's product; campaign goal + context; **where the message sits** ("a first LinkedIn invite is short; a follow-up email later in the sequence can say more"); Guided instructions. Preview checklist: sounds like you, refers to something specific, clear low-effort CTA.

**Launch checklist** (clicking **Launch**):
- *Blockers*: sequence has ≥1 step; sequence valid; audience List selected; every channel used has senders; ≥1 sender per channel connected. Refusal shows **Cannot launch** listing each item with a fix link; hovering the disabled button shows them too. Unpublished edits don't block (Launch/Resume publish them).
- *Warnings*: no prospects in audience yet (campaign waits); no product set; no brand voice configured.
- "Quick sanity check": preview a message, confirm sender window/limits, add your own domain to DNC.
- Confirmation dialog; **Cancel** keeps it a draft.

**Enrollment**: on going active, existing audience members enroll; while active, any prospect added to an included List enrolls automatically "however they were added… There is no separate toggle." Excluded Lists never enroll. One active enrollment per campaign per prospect; re-entry after cooldown up to max. One sender per channel per prospect for the whole campaign. **Leads statuses**: Active, Paused (campaign paused, sender disconnected, or OOO), Handoff, Replied, Completed, Stopped (e.g. DNC match, step removed), Waiting.

**Pause / edit / resume**: Pause → confirm → sends stop immediately, prospects stay put. Live campaigns are view-only "so you cannot change a sequence mid-send by accident". After edits, Resume shows a diff dialog: **Publish & resume** or **Discard edits & resume**. On publish, in-flight prospects move to the new version; if their step is gone they skip to the next existing step, else their enrollment stops.

**Clone**: new draft with same steps, re-entry rules and senders; **audience not copied** ("stops the copy from contacting the same prospects"). **Delete**: only when not active; confirmation lists what's removed (enrolled prospects, threads, message records, open tasks, meetings); **type `delete`** to confirm; a short audit record (name, created date, total sends/replies) kept "so billing still adds up".

### 3.15 Sending safety
Defaults per sender account, across all campaigns:

| Channel | Action | Per day | Per week |
|---|---|---|---|
| LinkedIn | Connection invites | 25 | 80 |
| LinkedIn | Direct messages | 30 | 100 |
| LinkedIn | Profile visits | 30 | 100 |
| LinkedIn | Post comments | – | 100 |
| LinkedIn | Post reactions | – | 300 |
| Email (Gmail, Outlook) | Emails | 500 | – |
| WhatsApp | Messages | 40 | – |

- Fixed, non-editable hourly caps: LinkedIn invites + DMs + profile visits together **10/hour/account**; WhatsApp **10/hour**.
- At a limit: "Nothing is skipped." The step waits for the reset.
- **Send window** default **9:00–19:00, Monday–Saturday**, in the **sender's** timezone ("not the prospect's local time"). Per-account override in Sender accounts; defaults for new accounts in Sending rules.
- **Pacing**: randomized gaps scaled to limit and window length; example "25 LinkedIn invites across a 10-hour window average roughly one every 24 minutes"; always a minimum gap.
- LinkedIn "invited recently" refusal → pause invites on that account for several hours. Temporary errors retry automatically.
- **30-day warm-up** on new LinkedIn accounts governs prospect-finding activity (profile lookups/searches), *not* invites/DMs/emails.
- **Pending invites withdrawn** automatically after **14 days** unanswered (daily cleanup).
- DNC checked before every send; unreachable channel (bounce) → skip that step, continue the rest.
- Warnings in sender docs: raising LinkedIn limits raises restriction risk; WhatsApp unsolicited volume can get the number restricted.

### 3.16 Inbox
- Two panes: conversation list left, thread right. Sections: **Needs you**, **Active**, **Resolved** (a new reply reopens). Filters: **Mine** / **Team** (permission), channel tabs **All, Email, LinkedIn, WhatsApp**, search by name.
- Row tags: **Approve** (draft waiting), **Take over** (Guhan stepping back), **Decide** (pick among options; hover shows why each was suggested), **Schedule** (prospect wants to meet; high priority), **FYI** (no action; **Got it**).
- Thread: marker on the last message when a decision is pending; cross-channel jump buttons if the same person has a thread on another channel; drafts marked as written by Guhan.
- **Seven reply kinds** and actions:

| Prospect said | Guhan does |
|---|---|
| Interested | Per reply policy: hand to you or draft |
| Asked for a meeting | Always to a person (Schedule task); never auto-answered |
| Asked a question | Per reply policy |
| Said no | Stops sequence; nothing sent |
| Asked to unsubscribe | Stops sequence; nothing sent |
| Out of office | Pause 7 days, resume |
| Not now | Pause 30 days, resume, leaves you a note |

  Never auto-replies to no / unsubscribe / OOO / not-now. Low-confidence no/unsubscribe → **Take over** task, "because stopping a sequence cannot be undone." Stopping on a no does **not** add the person to DNC. (Troubleshooting uses labels: positive, meeting request, question, negative, unsubscribe, out of office, not now.)
- **Daily routine** (Handle replies): Mine scope → **Schedule** rows first (**Send link**) → **Approve** rows (**Approve & send**, **Edit**, **Reject**) → **Take over** rows (**Take over** or **Assign to**) → **FYI** (**Got it**). Also **Reopen** on closed threads.
- **Take over** stops every automated sequence on that same thread and channel ("an automated message arriving in the middle of a human conversation reads as spam"); other channels keep running. Typing in the composer of an unassigned conversation does the same. **Assign to** moves it to a teammate's Inbox.
- Two campaigns drafting for the same message: sending one clears the others.
- Conversations belong to the owner of the sender that sent the last message.
- Shortcuts: `j`/`k`, `/`, `a` (approve), `t` (take over), Cmd/Ctrl+Enter (send / approve & send). Only outside text fields.

**AI reply policy** (Settings → Sending & Reply Rules → **Reply handling**; default for steps without an AI reply step):
1. **Escalate to a user** — default; every interested reply and question becomes a task; "Guhan writes nothing."
2. **AI drafts — user approves before sending**.
3. **AI drafts and auto-sends** — "Riskier. Use it once you trust the tone." Limited to **one reply per conversation** under the workspace policy; a second prospect reply or a failed send → Take over task. Also falls back to you when credits run out.
Per-step **AI reply** step overrides ("Explicit steps always win"). Drafts use full conversation, Brand & Voice, product (objections, offers), prospect knowledge. Cost: 1 credit per AI draft, charged at Send for approval steps. Honest caveat: "Reply meaning is read by a model and can be wrong on short or ambiguous messages."

### 3.17 Meetings and calendars
- Meetings page tabs: **Upcoming** (grouped Today, Tomorrow, This week, Next week, Later), **Past**, **Cancelled**, **Unmatched** (calendar events not tied to a prospect), **All**. Source badge per meeting: **Picker** (Guhan's booking page), **Cal.com**, **Calendly**, **Calendar**. Detail: time, join link, prospect, host, attendees, conversation; **Cancel meeting** (provider notifies prospect). No reschedule button (prospect uses invite link). No per-link revoke (contact support).
- **Workspace meeting defaults** (admins): Default meeting length 15/20/**30**/45/60/90; Buffer **No buffer**/5/10/15/30; Default meeting title with `{firstName}` `{lastName}` (blank = "Intro chat with {firstName}"); Default scheduling tool: Built-in picker / Cal.com link / Calendly link. Reps override tool, working hours, timezone, meeting room. Length is baked into a link at creation.
- Teams: each rep connects their own calendar; link created against the sender's calendar; **no round-robin**.
- **Google / Outlook**: ride on the matching email sender's sign-in (no second login; calendar permissions must have been approved). **Connect calendar** → source → **Continue** → pick hosting sender → finish setup: timezone, default calendar, meeting room (platform default Meet/Teams, Zoom personal room link, or custom URL), working hours/days. Availability = working hours minus busy events. Admins can connect for teammates (those with a calendar greyed out). **Copy public booking link**.
- **Cal.com / Calendly**: paste booking link → Guhan shows a connection (webhook) URL → paste into the tool (Cal.com: Settings → Developer → Webhooks; events booking created/cancelled/rescheduled. Calendly: Integrations → Webhook subscriptions; invitee created/canceled) → click **Listen** in Guhan and make a test booking → marked active. Guhan appends a hidden tracking tag to the link; link shorteners can strip it.

### 3.18 Ask Guhan (chat agent)
- Beta, "can make mistakes"; in-app and WhatsApp share **one conversation**. Opens with **today's brief and your numbers, then suggested next moves**, chat box at bottom.
- Can: set things up ("Create a list of VP Sales at 100 to 500 person software companies in the US." "Create a campaign for that list." "Launch it."), check things (credits left, prospects from latest list, upcoming meetings, "Is my LinkedIn sender healthy?"), handle Inbox ("What is waiting on me?" then approve/reject/answer tasks in chat), update setup (brand voice, products, templates), send a scheduling link, look up a person's meetings.
- Cannot: **delete anything** ("a deliberate safety limit"), connect accounts (sign-in is on provider pages), touch other workspaces; respects permissions.
- Cost **1 credit per message sent**, regardless of answer length. Silent when out of credits or read-only. Requires permission to create campaigns.
- Threads with memory within a thread; History page; thumbs up/down per reply; **action cards** showing what it looked up or changed, with records linking to their app pages.

### 3.19 Workspace: plans, credits, roles, DNC, API/MCP
**Plan**: one plan, per license: **$49/license/month annual or $59 monthly**. One license = **1 seat + 1 sender (any channel) + 2,000 credits/month**. Extra sender add-on **$15/month annual, $18 monthly** (no seat, no credits). Adding licenses immediate; reducing at next cycle (blocked if members/senders exceed new count).

**Credit price list** ("the single source of truth"):

| Action | Credits |
|---|---|
| Prospect discovery | 1 per profile returned (before fit check) |
| Company discovery | 1 per company (technology signals) |
| Prospect enrichment | 1 |
| Company enrichment | 1 |
| Research brief | 1 (refunded on failure) |
| Work email reveal | 4 (only if found) |
| Phone reveal | 12 (only if found) |
| Recent posts | 0.25 |
| Technology match | 2 per confirmed company |
| AI-drafted message (first touch or reply) | 1 (Fixed message = 0) |
| Ask Guhan | 1 per turn |

"Sending itself is free." Two balances: monthly (refill to 2,000/license, no carry-over) and top-up (packs, last **12 months**, spent after monthly). Packs: **200 = $10, 1,000 = $45, 2,000 = $80**. Out of credits → credit-spending actions refused, Lists stop adding, enrichment and drafting stop, banner shown. Trial 7 days / 500 credits; on subscription balance resets to 2,000/license. **Read-only mode**: trial ends unsubscribed or failed renewal not fixed in a **7-day grace period**; watches and sends stop, data and credits kept. After ≥1 week read-only, senders become **Hibernated**. Cancel: Billing → Subscription tab (link at bottom); runs to period end.

**Roles**: Workspace Admin, Campaign Manager, Sales Rep, Viewer (+ custom roles by org admins; built-ins not editable; assigned roles can't be deleted). Highlights of the matrix: everyone views campaigns/lists/companies/products/templates/senders/calendars/analytics/DNC; Campaign Manager creates/edits/launches campaigns and Lists, edits/blocks companies, edits products/templates, sees all conversations, sends, reassigns, edits DNC, but cannot delete campaigns/companies, cannot connect senders, cannot connect their own calendar (sic, per the table), cannot manage members; **Sales Rep** sees only own conversations, can send and connect own calendar, nothing else editable; **Viewer** sees all conversations but cannot send. Only Admin: delete campaigns/companies, connect/disconnect/share senders, change sender owner, members, workspace settings. Billing/org actions: **org admins** only. One license = one seat; invites blocked when seats are full; invite link valid **7 days**, revocable. Every sender has one owner; conversations on it are assigned to that owner.

**DNC**: only **email address** and **domain** entries ("There's no block for a LinkedIn profile URL or a phone number"). Paste one per line, lowercased/trimmed, duplicates harmless, invalid lines listed back; up to **500 entries at a time**; no import/export. Effect is immediate: matching in-sequence prospects paused, List matches marked unsubscribed, new matches rejected at intake. Removing an entry restores nobody. Per workspace. Tip: add your own domain.

**API & MCP**: personal access tokens under **Profile → API keys** ("belong to you, not to the workspace"); **New token**, name, expiry or **Never expires**; shown once; list shows status (active/expired/revoked), created, last used; prefix `pat_live_`; no narrower scopes ("A token can do everything you can do"). REST: bearer auth, covers campaigns, Lists, prospects, companies, conversations, DNC, meetings, products, templates, brand voice; permission-checked. MCP at `/api/mcp`, same tools as the API, rate-limited per token.

### 3.20 Chrome extension
- Read-only on LinkedIn: "never sends a message, an invite, a comment or a follow"; reads only the page you're on, never opens other profiles to collect details; scrolls only when asked (**Load full details** or a bulk import you started); credits only when you choose enrich/reveal/brief, cost shown before confirm. The one layout change: extra left space on result rows for checkboxes.
- Install from Chrome Web Store; floating Guhan icon on the right edge (draggable vertically) or toolbar icon opens a right-side **drawer**; **Connect to Guhan** once. Reload already-open LinkedIn tabs.
- **Drawer**: **Home** (house button: welcome, shortcuts to Lists, Campaigns, Inbox, Settings, one-click import starts, **Back to this page**); workspace switcher at top; **credit balance** next to the workspace name (live-updating); **⋯** menu: **Open Guhan**, **How to use** (illustrated guide), **Sign out**. Unsupported pages: drawer keeps the last workable page marked **"You've left that page"**, picks kept.
- **Profile page button**: **Add to Guhan** / **Open in Guhan** / **Guhan** (status unknown yet). Drawer status badges: **Not in Guhan**, **In a list**, **In a live campaign**, **Campaign paused**, **Replied**, **Do not contact**, **No reachable email**, **Possible duplicates** ("Guhan won't guess which, so it doesn't add them"); also **Strong fit** etc., **Enriched**, Lists and Campaigns. **Add to list** (search/signal Lists not offered; active-Campaign warning; free; shows remaining active-prospect room). **Load full details** (scrolls a few seconds, reads current job/company, schools, top skills, returns you). Optional post-add enrichment: profile details, work email, phone, recent posts, research brief, company details, company posts; nothing ticked by default except profile + company details when adding from a profile; nothing charged during the add; afterwards a card shows exact count and cost and runs only on **Enrich**. **Find email** / **Find phone** carry a credit icon + cost; confirm first; charged only if found.
- **Searches and network lists**: Guhan bar above results: **Select all**, count, **Clear**, **Bulk import…**, **Add to Guhan** (→ **Add N to Guhan**) → drawer opens on Add to list; nothing added until the final button. Picks persist across result pages of the same search; a new search starts fresh. Drawer shows **Bulk import this search** "or" **Import your selection** (**Add selected to list**). Bulk import sheet: List + how many; shows "About 3 pages to go, up to 30 people" or the network list's size; max **999** or remaining room; pages through a few seconds apart "the way you'd browse"; keep the tab open. Progress card: added / already in the List / couldn't be added, with **Pause** and **Stop**. Works on your own connections/followers/following (matched by LinkedIn member ID, so duplicates possible for people stored only by profile link).
- **Company page**: **Open employees**. **Event page**: **Open attendees** (no registration needed; hidden attendees excluded).

### 3.21 FAQ / troubleshooting highlights
- No Sales Navigator needed; personal Gmail/Outlook fine; main LinkedIn account fine.
- Campaign not sending: still a draft; no sequence/errors; no List; no sender or disconnected; outside window; out of credits; read-only. Empty audience only warns.
- Isolation technique for an empty List: "pause every signal source but one and see whether prospects get added."
- Emails bouncing: check SPF, DKIM, DMARC, volume vs mailbox norms, spammy phrasing.
- "Nobody is replying": read sent messages from a prospect's timeline; usual causes tone, heavy first-message pitch, weak signal fit; "Try a softer opening and a tighter List."
- "Messages feel repetitive": over-specific step briefs and too many required phrases; trim never-include list; turn on recent-post fetching.
- Meetings: busy calendars, all-day blocks, duration + buffer must fit gaps; shorteners strip Cal.com/Calendly tracking.
- Support: hello@guhan.ai with what you tried / expected / happened / workspace name.

### 3.22 Keyboard shortcuts
"Guhan is mostly mouse-driven." Inbox: `j`, `k`, `a`, `t`, `/`, Cmd+Enter. Sequence editor: Cmd+Z, Cmd+Shift+Z / Ctrl+Y. Prospects: Left/Right, Shift+Left/Right. Anywhere: Cmd+Shift+O (Past chats). Invitation to request more by email.

### 3.23 Glossary terms
Added (watch history: **Landed**), Ask Guhan, AI-drafted message, Brand & Voice, **Brief** ("You give the intent; Guhan writes the actual words"), Campaign, Company, Credit, DNC, Draft (campaign not launched, or message awaiting approval), Enrichment, **Enrollment** (one prospect in one Campaign's sequence), Fit rating, Fixed message, **Handoff** (modes notify, approve, decide, take over, schedule), ICP, Inbox, License, List, Product, Prospect, **Quota** (daily/weekly cap per sender), Reauthorize, Read-only mode, Research brief, Sender account, Sequence, Signal, **Signal source** (a search rule on a List: who + optional signal), Template, **Watch** (one scheduled run of a signal source's search).

---

## 4. Distinctive UX patterns and design choices

1. **The "brief a new SDR" metaphor everywhere.** Onboarding, Brand & Voice and templates are framed as briefing a human hire. The glossary even defines "Brief" as intent you give, words Guhan writes. It sets the expectation that output quality follows input quality.
2. **AI-generated content is labelled, then confirmed.** The onboarding brand draft is "marked as AI-generated"; drafts in the Inbox carry a "written by Guhan" marker; Ask Guhan shows action cards for every lookup or change, with links to the records.
3. **Real output early.** Onboarding shows five real prospects and lets you reject (re-pulling up to 3 times) before anything is created. A user sees concrete results before committing.
4. **Safe-by-default creation.** The onboarding "Launch agent" creates a **draft** campaign; nothing sends until a sender is connected and Launch is pressed. Live campaigns are view-only; editing needs pause, then a diff dialog (**Publish & resume** / **Discard edits & resume**).
5. **Brutally explicit cost transparency.** One canonical price table. Costs printed on buttons ("Find email (4 credits)"), on every enrichment toggle, and on the extension's pre-confirm cost card. They say plainly that discovery is charged **before** filters, so rejects still cost ("Tighter filters improve the quality… but they do not reduce what a run costs"). Pay-on-success for reveals, refunds for failed briefs, no double charge within a day, skip rules to avoid re-spending.
6. **Nothing is ever silently dropped.** Limits make sends wait, never skip; rejected profiles are kept with a reason code; a Fixed message with an empty token is *skipped* rather than sent blank (with the "Hi , thanks for reading" example); every delete lists what goes.
7. **Explained disabled states.** The step picker greys out invalid options with a reason ("AI reply must follow a wait for a reply"); Lists that already have a source show "already has a source"; locked enrichment toggles say "Required by your prospect filter."; launch shows **Cannot launch** with a fix link per blocker; blockers vs warnings are separated.
8. **Asymmetric caution on irreversible AI decisions.** Low-confidence "no"/"unsubscribe" go to a human "because stopping a sequence cannot be undone". Meeting requests always go to a human. Auto-send replies are capped (1 per conversation under the workspace policy, 1–10 per step, 20 per prospect hard stop).
9. **Hard-coded refusals for the agent.** Ask Guhan cannot delete anything or connect accounts; the extension never sends anything on LinkedIn. Both are stated as deliberate.
10. **Honesty about what's missing.** Docs state plainly: no email open tracking, no round-robin, no reschedule button, no link revoke, no DNC by LinkedIn URL or phone, no "always include" list (with the rationale), no import/export of DNC, MCP shortcuts "coming soon", Ask Guhan in beta and "can make mistakes".
11. **Progressive disclosure.** "Narrow by who fits (optional)" is collapsed by default on person signals; the column menu hides extra columns; side panel first, full page on demand; three-level enrichment inheritance ("Unset toggles inherit from workspace settings").
12. **Ownership follows the sender.** A conversation belongs to the owner of the account that sent the last message; a prospect keeps one sender per channel for the whole campaign; disconnecting a sender in use marks it "Reconnect needed" so campaigns "keep their place".
13. **Implicit auto-enrollment.** Adding anyone to an included List of a live campaign enrolls them, with "no separate toggle". The UI warns in every add dialog (Prospects page, Import step 2, extension drawer) that an active Campaign will pick them up.
14. **Concrete examples instead of abstract advice.** Good/bad pain point, good/bad Guided instruction, campaign name example, goal example, title-variant example ("Sales Director" vs "Director of Sales").
15. **Copy style.** Short, plain, second person; bold lead sentence on every page that defines the concept in one line; every page ends with "If something's off" accordions and three "Related" cards. Labels are human verbs: "Looks good — continue", "Looks good — Launch agent", "Got it", "Take over", "Approve & send", "Send link".
16. **Daily-triage Inbox.** "You open the Inbox to deal with what is waiting, not to sort through everything." Five decision tags with one primary action each, a prescribed order (Schedule → Approve → Take over → FYI), and vim-style keys.
17. **Channel discipline in product design.** WhatsApp is explicitly a warm channel (starters "After reply", "Gentle nudge… then stop"); LinkedIn is the tightest-limited; email is the high-volume one.
18. **Sticky safety plumbing.** Randomized pacing, a fixed 10/hour burst cap, automatic withdrawal of 14-day-old invites, a warm-up on prospect-finding, Monday–Saturday 9–19 default window in the sender's timezone.

---

## 5. Human-in-the-loop model

### 5.1 Where the user approves or decides (gates)

| Point | Gate |
|---|---|
| Onboarding brand draft | Read and edit the AI-generated summary |
| Onboarding preview | Reject people among five real prospects (up to 3 refreshes), then "Looks good — continue" |
| Onboarding launch | Creates a **draft** campaign only |
| Sender connection | Always by the user, on the provider's page (Ask Guhan can't do it) |
| Prospect review | Recommended manual check of the first batch; tighten rules; remove; DNC |
| Campaign launch | Explicit **Launch** + confirm dialog after the readiness check |
| Live edits | Must **Pause**, then **Publish & resume** / **Discard edits & resume** |
| First-touch messages | Opt-in per step: **Require approval before sending** (draft held in Tasks until **Send**) |
| Fixed message steps | The user writes the exact text (AI removed) |
| Reply policy (workspace) | Default **Escalate to a user**: Guhan writes nothing. Option 2: AI drafts, user approves. |
| AI reply step | **Send for approval** on = each reply waits for the user |
| Meeting requests | **Always** a person (**Schedule** → **Send link**); the prospect then picks a time themselves |
| Ambiguous no/unsubscribe | Routed as a **Take over** task instead of stopping |
| **Decide** tasks | User picks among options Guhan suggests (hover shows why) |
| Handoff step | **Notify** (FYI task) or **Take over** (user sends the next message) |
| Free resource without URL | Inbox task: send it yourself |
| Failed sends / auto-send failures | Go to Tasks / Take over for manual retry |
| "Not now" replies | Note left in the Inbox to follow up personally |
| Flag for handoff (prospect menu) | Marks the conversation warm for a person |
| Extension enrichment and reveals | Cost card / confirmation, runs only on **Enrich** / confirm |
| Deletes | Only in the app (Ask Guhan can't); campaign delete requires typing **delete** |
| Billing, members, senders | Admin / org-admin only |

### 5.2 What runs autonomously once set up
- **Sourcing**: Ongoing sources keep running watches within daily/weekly/monthly limits, spending discovery credits per profile returned.
- **Filtering, dedupe, competitor and DNC exclusion**, enrichment needed by filters, **research brief + fit rating** for every added prospect (if the toggle is on, which it is by default).
- **Auto-enrollment** of anyone added to an included List of a live campaign (no toggle).
- **Writing and sending first-touch and follow-up messages** in Auto-draft / Guided mode **without approval** unless the step has "Require approval before sending" *(inferred: approval is an opt-in toggle; the docs never call it default-on)*. Brief built on the spot if missing.
- **LinkedIn engagement actions**: profile visits, comments, reactions on recent posts (skipped when no qualifying post).
- **Scheduling and safety**: send windows, randomized pacing, per-day/week/hour caps, rescheduling at limits, retries, pausing invites after LinkedIn refusals, withdrawing invites after 14 days.
- **Reply handling**: classification of every reply; stopping on clear no/unsubscribe; pausing 7 days on OOO and 30 days on not-now, then resuming; bounce detection stops the sequence.
- **Auto-sent replies** only if the admin picks "AI drafts and auto-sends" (one reply per conversation) or an AI reply step has approval off (up to the configured 1–10 consecutive, hard cap 20 per prospect).
- **Account health**: pausing prospects when a sender disconnects and resuming on reconnect; DNC changes applied immediately to in-flight prospects.
- **Ask Guhan** acts on instructions (can create lists, create and **launch** campaigns, approve/reject Inbox tasks from chat) but never deletes.

### 5.3 The net shape
Discovery, research, first-touch writing and sending are autonomous by default; reply *responses* are human-by-default (Escalate) with opt-in automation that is capped; meetings are always human-initiated (send link), with booking done by the prospect. Irreversible or high-stakes calls (stopping on an unclear no, deleting, connecting accounts, sending a calendar) are deliberately kept with a person.

---

## 6. From the four videos (transcripts + frames, 2026-10-17)

**Framing (video 1, 3:09):** outbound = 3 acts, 6 agents, one handover each: FIND (Discovery, Research) → REACH (Writer, Outreach) → CONVERT (Reply handler, Booking). Slogan "Stop sending messages, send reasons" (Sarah example: "50,000 candidates" vs "eight engineering roles opened since your funding round"). "You are the director": you set who + voice, **approve the first 20 messages**, set daily limits, review anything unclear, send the booking link. "A team can scale a process, it cannot fix a broken one… test it small first."

**Seen on screen (product UI, light theme, orange accent):**
- Top bar: breadcrumb, Inbox-count chip (11) and credits chip (342) on every page. Sidebar: Home, Inbox (badge), Meetings, Campaigns, Prospects, Lists, Brand & Voice; "Coming soon: Ask Guhan, Claude MCP, Codex MCP"; System: Workspace settings; workspace switcher at the bottom. (The "01 PEOPLE SEARCH" step pill and the orange "DISCOVERY AGENT — finds…" card in the sidebar are video overlays, not product.)
- Import from People Search: right-side sheet, 2-step stepper (Who fits → Import destination), rule rows "Title * matches [Search job titles…]" + "Suggested variants", "+ Add rule", Back/Next.
- Import destination: enrichment checklist, each row = name + credit chip + one-line description; locked rows say "Required by your prospect filter"; header "Override workspace defaults for this list. Unset toggles inherit from workspace settings."; under "Generate research brief + fit score": "Score against these products or services (2 of 2 selected)".
- Import leads modal: grouped signal picker (content/engagement with LinkedIn icon; Career Changes; Hiring & Growth with sparkle icon; Files → Upload CSV).
- Prospect side panel: name + LinkedIn + "New" badge, title · company, location · **"7:32 PM their time"**, "Find phone · 12 credits"; tabs Details/Overview/Research/Activity. Research: 3-sentence brief that includes a **behavioural hint** ("tends to answer short factual emails and ignore anything long"), "Regenerate brief · 1 credit"; Fit assessment "Strong fit 8/10" + one row per product with a one-line reason.
- List → Sources: summary "Paused · 14 watches · 16 found · 10 landed · 6 rejected"; Watch history sheet: "10 landed · 6 rejected across every watch", filter chips per source, one row per run (when · found · landed · rejected), expandable: person card (profile, SIGNAL: type, source "Funding announcements", detected timestamp; CONTACT LinkedIn "verified"; "Open prospect 360") and a REJECTED (n) group with a reason pill + tooltip ("Doesn't fit your audience").
- New campaign sheet: Product or service ("agent references this product in every message"), Goal ("What success looks like — steers the CTA"), Context ("Framing… overrides workspace defaults"), Senders per channel (pre-selected when only one).
- Sequence canvas: dotted canvas, cards Trigger/Start ("1 inclusion list", Configure) → Action LinkedIn message (Auto-draft) → Wait for event (timeout 3 days) → branches "Timed out" → Email, "Event received" → Handoff "Take over conversation"; minimap; chips Editing / Valid / Saved; Test run, Discard changes, Draft + Launch.
- Action node sheet: channel tiles (LinkedIn/Email/WhatsApp), action radio cards with one-line descriptions, note "Sender picked at send time from this campaign's pool", "How do you want this message written?" tiles Auto-draft / Guided / Fixed, cost hint "1 credit", "PREVIEW AGAINST A PROSPECT [picker] Regenerate".
- Test run sheet: "Testing with <prospect> · Try another", vertical timeline, per wait step "Simulate which branch?" chips, ends "Completed event_timed_out".
- Inbox: Mine dropdown, search with "/" key hint, channel tabs with counts, tag filter chips All/Approve/Decide/Take over/Schedule/Notify, "NEEDS YOU · n"; rows: avatar, name, company · campaign, "via <sender>", snippet, tag pill + red **OVERDUE** + date. Thread: agent-sent bubbles carry an agent icon; marker under the last inbound ("DECISION WAITING" / "SCHEDULE WAITING"); **Decide footer "Pick a branch:" with three AI-written next moves as buttons** ("Send the ramp plan teardown" / "Offer a 20-minute call" / "Ask one question first"); Schedule footer "Send a booking link the prospect can click. [Send link]"; header has an "Agent" control.
- Settings → Sending rules: per channel TZ + window (09:00 → 19:00) + day pills; "Daily caps" and "Blackout windows" marked Coming soon; Reply handling radio cards (Escalate default).
- Booking page: "Book a meeting with <host> · 30-minute meeting · Times shown in your timezone · <host> is in America/New_York", month calendar + slot grid.
- Meetings: Upcoming/Past/Cancelled/Unmatched/All, grouped "NEXT WEEK", date block, "Confirmed" + source badge (Picker / Calendly / Cal.com); side panel: Join meeting, prospect (Open prospect), host + calendar, attendees, Cancel meeting.

---

## 7. Live workspace guhan.ai/zeami (read-only walk-through, 2026-10-17)

Nothing was saved, launched, connected, revealed or regenerated; every sheet was cancelled.

**Credits.** Balance fell 416 → 382 during the walk-through. Cause: the onboarding List "Owner" (Search only, Active, Ongoing, daily 25 = the minimum, weekly/monthly no cap). Each landed prospect costs ~3 credits (profile 1 + company 1 + research brief 1; profile and company locked "Required by your prospect/company filter"). Sources tab: "WHO-only · Live · Daily firmographic search runs automatically · 2 watches · 40 found · 36 landed · 0 rejected · 4 in flight · Next watch Tomorrow 11:54 AM". About 75 credits/day, so roughly five days of trial credit. Stop it with Lists → Owner → Pause.

**Lead quality (onboarding rules: Title = Owner / Director / General Manager; Location = North Rhine-Westphalia; Headcount 51–5000).** 40 prospects; first page of 20: 15 Moderate, 5 Weak, 0 Strong; all status Cold. Included Merck Finck (private bank), Max Planck Institute researchers, Schule Schloss Salem (boarding school), Germany Trade & Invest (government agency), a profile named "Hallo Hallo". Conclusion: their discovery is weak; take the UX, not the sourcing.

**Onboarding prefill from zeami.io was thin.** Brand: description = "Bessere Arbeit. Gemeinsam.", industry = Technology, Information and Media, pain points empty. Voice: tone Professional, language English (US), never-write list empty. Competitors 0, Products 0, Templates = the 5 read-only starters. The draft campaign "Owner" has an EMPTY sequence (Start → Exit), although the docs say onboarding builds a starter sequence. Fit was therefore scored against the slogan alone ("Zeami — Bessere Arbeit. Gemeinsam.").

**Research brief (Colja Dams, VOK DAMS, Moderate 6/10).** Three paragraphs: who they are (co-CEO, 193 staff, events/live marketing), how the offer might apply, and an opening angle. It states its own limits: the signal "only confirms Dams matched a watchlist, not a specific company announcement"; the firm is outside the target industry; open "using the watchlist match as a reason to reconnect rather than claiming an unverified business change". Fit assessment = overall tier + score, then one row per product with a reason.

**Prospect panel.** Header: photo, name, LinkedIn icon, "New" badge, title · company logo, location; "Find email · 4 credits", "Find phone · 12 credits". Tabs Details (editable grid incl. Timezone "Auto — inferred from location", Created, Updated, Last enriched, Email valid; "Enrich · 1 credit"), Overview (collapsible Contact with "Not found yet"; Company card with domain, industry · headcount · city; "Signals — why we matched"; Lists), Research, Activity. Expand icon top-left opens the full page.

**Home.** "Welcome Amir"; Create List / Create Campaign; range toggle 7 days / 30 days / 3 months / This month; four tiles: Sent, Replies, Meetings booked (last 30 days), Hot leads (all time); "NEEDS YOU · Action queue" ("No handoffs yet — Guhan will surface things needing your attention as your campaigns run"); "WHAT'S HAPPENING · Recent activity"; "WHAT'S NEXT ON THE CALENDAR · Upcoming meetings". Banner on every page: "Connect a sender account to start outreach. Your agents will queue prospects but can't send messages until a LinkedIn or Gmail account is connected." + "Connect sender →". Top bar: credit chip + avatar.

**Brand & Voice page.** Eyebrow "BRAND & VOICE", heading "How Guhan writes *for Zeami.*", subline "Guhan reads this every time it drafts. Edit any field — or have a conversation with Guhan below." "Ask about this" button (chat, 1 credit per turn, not used). Tiles with their own Edit and example placeholders. Never-write field: "Each entry is a separate phrase Guhan will refuse to write."

**New product or service form (help copy).** Name; Description ("Prose only — the message agent uses this as background context, not as a template. Skip marketing taglines; write plainly."); Pain this solves ("Every outbound message uses this to frame the insight and pick the right proof point. Falls back to your workspace-level pain points when this is empty."); Case studies ("'Company' can be a real name OR an anonymised description… always with a metric in the result."); Free resources ("Give prospects a reason to reply — offer a teardown, benchmark, or checklist instead of asking for a meeting. If you set a URL, replies get it inline; if empty, we'll create an inbox task for you to send it manually."); Objection handling (for AI reply). Buttons Cancel / Create product or service.

**Campaign.** List page columns Campaign / Audience / Status / Sent / Reply / Meetings / Action. Tabs Leads (Name+title, Company, Enrolled on, Current step, Next step, Status = "Waiting"; status filter; refresh), Sequence, Overview (Lead stats: Enrolled, Reached; Deliverability: Not sent "Terminal failure", Invites accepted, Rep replies "Human take-over sends", last-7-days line; "Activity, last 14 days"). Header: Draft pill + Launch + ⋯. Step picker "Add a step — Pick what happens here.": Send a message / Wait / Wait for reply or event (greyed: "Add a message step… earlier in the flow first") / Branch on a condition / Hand off to a teammate ("Notify, approve, decide, or take over") / AI reply (greyed: "Add a 'wait for reply' step earlier so AI has something to respond to").

**List edit sheet.** Name; "Source Signals — Who fits" rule rows (Title * matches chips + "Suggest variants"; Location is in; Headcount between); Import Schedule One-time / Ongoing ("Keeps finding new matches on this criteria every day"); How many to import: Daily (min 25) / Weekly / Monthly (0 = no cap); Enrichment options with credit chips ("Override workspace defaults for this list only. Unset toggles inherit from workspace settings."); brief described as "AI-drafted 3-sentence hook + 1-10 fit score".

**Watch history.** "36 landed · 0 rejected across every watch"; filter chips All / WHO-only; rows "WHO · 4m ago · 9s · 25 found · 23 landed · 0 rejected · 2 in flight" and "Onboarding · 15 found · 15 landed"; expandable.

**Settings.** Rows: Sender accounts, Calendars, Sending & Reply Rules, Do-Not-Contact list, Team, Billing, Enrichment settings ("Which enrichment steps fire on newly-landed prospects"), Workspace & advanced. Header copy: "Most things you can also tell Guhan in chat." Sending defaults per channel: TZ UTC, window 09:00 → 17:00, day pills (docs say 9–19); "Each account's own schedule wins at runtime"; Daily caps and Blackout windows = Coming soon; Reply handling radio cards (Escalate to a user / AI drafts — user approves / AI drafts and auto-sends "Single-shot only. Riskier"). "Workspace & advanced" promises scoring weights but shows only name, slug, org, plan (Free), workspace identity (company name, website) and multi-workspace; no weights visible. Billing stayed on "Loading billing…".

**Empty states.** Inbox: "No conversations yet. Your agent will drop threads here as prospects reply." Meetings: "No upcoming meetings. Send a scheduling link from any prospect's inbox task." Competitors: "Add competitors so Guhan knows how to position you when prospects bring them up." Products: "Add your products or services so the agent can write messages grounded in what you actually sell."

**Performance.** Tables and campaign pages show loading placeholders for 5–10 s before data appears.

---

## 8. What SalesBrain should take (recommendation, 2026-10-17)

Not built. In priority order:

1. **Brand & Voice and Products.** SalesBrain has nothing like it today. Build one workspace record plus a products table:
   - Products: Zeami and ChipChip, each with the pain it solves, case studies with a number, free resources to offer, and objection answers.
   - Voice: a tone, plus a never-write list that code checks before a draft reaches the approval card.
   - Competitors: how we differ from each one.
   - Every drafter reads from it: `lib/intro-draft.ts`, the follow-up draft, the outreach skill, and the bot's first-message and reply drafts. ICP fit scores against the same products.
   - Prefill it from what we already have: the ICP website suggest, `docs/brand/zeami-brand-basics.md`, memory notes. Guhan's website read gave Zeami only the slogan, and fit scored against that alone produced 0 Strong among the 20 leads on the first page.
2. **Sort replies into types.** `record_reply` only marks someone as replied.
   - Interested, meeting request, question → a person.
   - No, unsubscribe → stop the sequence.
   - Out of office → pause 7 days.
   - Not now → pause 30 days, with a note.
   - An unclear "no" goes to a person, because stopping cannot be undone.
3. **One "Needs you" inbox.** Today decisions are spread over Telegram cards, `/agents`, the ICP `ApprovalsPanel`, `/followups` and `/sales-leads`. Each row gets one tag with one main action:
   - Approve, Decide, Take over, Schedule, FYI.
   - A red OVERDUE tag on items left waiting.
   - Quick first step: **Decide = three drafted next moves as Telegram buttons.**
4. **Keep rejected leads, with a reason.** A per-run log of landed / rejected / in flight, plus a "rejected" filter on the leads list.
5. **Show the agents as three acts on `/icp/[id]`:**
   - Find: Leads Finder, Enricher.
   - Reach: writer, send gate.
   - Convert: replies, booking.
   - Plus a Home-style summary page: KPI tiles, Needs you, recent activity, upcoming meetings, and one banner for whatever is blocking with a single fix button.

Cheap details to add along the way:
- the lead's local time on the lead card
- a behaviour hint in the research brief
- a brief that says what it does not know ("matched a watchlist, not a specific company announcement")
- fit per product, each with a one-line reason
- "Preview against a prospect" and Test run for templates
- quota shown on action buttons
- disabled controls that say why
- auto-withdraw LinkedIn invites still pending after 14 days

**Do not take:**
- **Their discovery.** The live list included a private bank, research institutes, a school, a government agency and a profile named "Hallo Hallo".
- **First messages sent with no approval.** SalesBrain's rule is that every send is approved.
- **LinkedIn login by pasting the `li_at` cookie.** Unipile's hosted login is safer.
- **Automatic comments and reactions on posts.**
- **Cold WhatsApp.**
- **Credit-based billing.**

**Where SalesBrain is already ahead:** warm-intro routes and the relationship graph, board-gated deals and grants, per-person memory, one Telegram bot for the team, the service MCP, and back-office / front-office roles.
