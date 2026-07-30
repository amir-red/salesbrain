# Unipile LinkedIn Trial — Probe Results (2026-07-30)

Read-only capability probe against a live Unipile trial with Amir's real LinkedIn account connected.
**No writes performed**: no messages sent, no invitations, no profile edits. ~90 API calls total, paced.

Credentials live in `~/Documents/Programming /Sales CRM/.unipile.env` (outside all three repos, never committed).
Probe scripts are in the session scratchpad, not the repo. Per-person inbox contents are deliberately **not**
recorded in this repo — only aggregate findings.

## 1. Connectivity — works

`GET /api/v1/accounts` → HTTP 200. One LINKEDIN account, status `OK`, connected via `credentials`.

Two facts that change earlier assumptions:

- **The account already carries Sales Navigator** (`premiumFeatures: ["sales_navigator"]`, `premiumContractId` present).
  The open question "do we need to buy a SalesNav seat?" is moot — we have one.
- **Egress proxy country is `FR`** while the user operates from Addis. LinkedIn therefore sees this account from two
  geographies. Geo-mismatch is a documented restriction trigger; **align the proxy country with the real login
  location before any write activity.** This is the single highest-risk finding of the trial.

## 2. Inbox reading — works, full fidelity

| Endpoint | Result |
|---|---|
| `GET /chats?account_id=&limit=` | 200 — 40/40 threads, cursor pagination, `unread_count`, `folder`, `timestamp` |
| `GET /chats/{id}/attendees` | 200 — name, occupation/headline, `network_distance`, `member_urn`, profile URL, picture |
| `GET /chats/{id}/messages?limit=` | 200 — full text, `timestamp`, `is_sender`, `seen`, `message_type` |
| `GET /users/{provider_id}?account_id=` | 200 — headline, location, follower/connection counts, `is_open_profile`, `is_premium`, `network_distance`, `connected_at`, contact info |

40/40 threads and 80/80 sub-calls returned 200. No throttling, no failures. Latency comfortable for a background sync.

`is_open_profile` is notable: it identifies who can be InMailed **without burning credits**.

## 3. Search — works, including Sales Navigator

`POST /api/v1/linkedin/search?account_id=` with body `{api, category, keywords}`:

- `api: "classic"` → 200, results with name/headline/location/network_distance, cursor paging.
- `api: "sales_navigator"` → **200** — SalesNav-tier search is programmatically reachable on this account.

This contradicts Unipile's public docs (which don't advertise SalesNav) — the capability follows the connected
account's entitlements. Wider filter support (seniority, headcount, geography, saved-list URLs) is untested.

## 4. Inbox state — the finding that justifies the whole experiment

Of 40 recent threads: 6 are LinkedIn/company noise, **34 are real human conversations**.

- **34/34 (100%) have the other person speaking last.** Every single open thread is ball-in-our-court.
- 19 carry unread messages; the backlog runs from 2.5 days to **244 days**.
- Content split: roughly 26 are inbound cold pitches (logistics, webinars, agencies), and **~8 are genuinely
  valuable** — a warm intro offer, an existing contact asking "anything new?", a real appointment reference,
  product-fit inbound about ChipChip, and inbound talent.

The failure mode is not "we reply badly" — it is that **valuable threads are indistinguishable from pitch noise**,
so the whole inbox gets ignored together. Triage, not composition, is the job.

## 5. Identity match against our CRM

Inbox humans deduplicated: 29 unique people.

| Source | Matched |
|---|---|
| Relationship graph (`people`, 49 rows) | **0 / 29** |
| Legacy LinkedIn reservoir (`contacts`, 12,932 rows) | **14 / 29 (48%)** |
| Known to the CRM at all | 14 / 29 |

The 14 matches carry real titles (Founder, CEO, COO, Chairman, Director, Managing Consultant) — the reservoir is
doing useful work. The 0/29 graph result is expected: the graph holds deal contacts only.

`channel_handles` currently holds **19 email + 1 phone and zero LinkedIn handles** — the LinkedIn identity layer of
the relationship graph is empty. Unipile's `provider_id` / `member_urn` / `public_identifier` are exactly the stable
keys that would populate it, making LinkedIn threads resolvable to people across sessions.

## 6. Verdict

Technically the experiment succeeded on every axis probed: read the inbox, resolve attendees, fetch profiles,
search including SalesNav — with clean JSON and no reliability problems in this sample. Webhook reliability
(the known weak spot in reviews) was **not** tested; a polling fallback should be assumed necessary.

What it would buy us, in order of value:

1. **Inbox triage + dropped-thread rescue.** Highest value, lowest risk, needs zero write access. Classify each
   thread (real opportunity / talent / intro offer / pitch noise), score staleness, surface the handful that matter
   through the existing Telegram approval flow. A read-only agent already fixes the actual problem.
2. **LinkedIn identity for the graph.** Backfill `channel_handles` with LinkedIn URNs so LinkedIn conversations
   become first-class interactions on people and deals — the graph currently cannot see any of this.
3. **Sales Navigator search as a prospecting tool** — real, but only worth wiring after (1) and (2), and it is the
   most ToS-exposed surface.

## 7. Target workflow (Amir, 2026-07-30) — event networking, and the design decisions taken

Scenario: Mateo meets ~100 people at a conference, takes notes on each, connects on LinkedIn, follows up
referencing the conversation, and needs to know when someone replies.

Stage map (what exists vs what would be new):

| Stage | Mechanism | Status |
|---|---|---|
| 1. Capture notes at the event | Telegram voice/text → distill → person + facts + commitments in the graph | **Exists** |
| 2. Resolve name+company → LinkedIn profile | Unipile search → candidates → **human confirms in Telegram** | New (confirm step is mandatory — wrong-person sends are unrecoverable) |
| 3. Connect | Bare invitation (no note) — QR at the event, or manual tap | **Deliberately not automated** |
| 4. Detect acceptance → draft follow-up | Unipile accepted-invitation signal → agent drafts from real notes → Telegram approval | New |
| 5. Reply handling | New-message webhook → classify → notify owner's DM with draft → approve | New |

**DECISION — no personalized invitation notes (Amir, 2026-07-30).** Rationale: (a) noted invites are the
hard-restricted action (~5/month free vs ~150/week bare), so dropping them removes both the Premium-tier gate and
most of the volume risk; (b) 300 chars attached to an accept/ignore decision is a poor place to personalize —
the post-acceptance message is a better moment with more room; (c) it removes automated invitations from the
system entirely, so every write becomes a message to someone who just chose to connect. Consequence: **speed
matters more** — without a note to jog memory, follow-up should land within ~48h, which the existing commitment/
attention machinery already surfaces.

Resulting first version: **capture → detect acceptance → draft follow-up → manage replies**, no invitation
automation at all.

Open items before any build: Mateo's + Esmail's informed consent to inbox access; LinkedIn tools must be
**owner-scoped and excluded from board-group admin elevation** (otherwise a board member could read another
person's private DMs); per-user proxy choice (worse for travellers — Mateo's real IP moves during conference
travel while Unipile's egress is fixed); whether sends stay human-approved indefinitely.

Risk position is unchanged by the trial: this is still a ToS breach on the user side, mitigated by real-session
architecture, low volume, and no scraped corpus. Concrete follow-ups before any write operation: **fix the FR proxy
mismatch**, keep sends human-approved, and wrap everything behind a provider-agnostic ring interface so a Unipile
failure degrades to "agent drafts, human sends" rather than breaking the CRM.
