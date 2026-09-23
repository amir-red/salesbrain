# SalesBrain Telegram Bot

**Audience:** SalesBrain users who want to interact with their pipeline from Telegram, and anyone maintaining the bot infrastructure.

> **Status (2026-09-23):** the bot is the **Hermes gateway**, not an app webhook. The app-side runtime this
> document used to describe (`lib/telegram-agent.ts`, `app/api/telegram/route.ts`, `/api/cron/*`, the SLA and
> deal-assigned pushes) was deleted in July 2026. The user-facing behaviour below is still accurate; the
> maintainer section has been rewritten. See `docs/architecture.md`.

## What it does

Each SalesBrain user chats with the Hermes agent, which reaches their (scope-limited) deals, prospects and
relationships through the `crm_*` tools of the `salesbrain-hermes` plugin. Ask "what's on my sales
pipeline?", "add a note to Acme that we spoke to their CFO", "draft a follow-up for Lesya" — the agent calls
SalesBrain tools and replies. Anything that would reach a customer becomes a **draft card** with 👍 Send /
👎 Skip; nothing is sent until you decide (enforced in the kernel).

It also delivers, on a schedule and only when there is something to say: board-vote nudges (Mon/Wed/Fri),
the daily attention digest, approval cards from the outreach routine, and per-agent digests (leads found,
enrichment results, graph sync) to the owner's private chat.

## Setup — one-time (per user)

1. Log into SalesBrain at `https://salescrm.chipchip.social`
2. Sidebar → **Telegram** → **Generate linking code**
3. Copy the shown `LINK-XXXXXX` code (or tap the "Open in Telegram" button)
4. In Telegram, find the SalesBrain bot and send it: `/start LINK-XXXXXX`
5. Bot confirms with ✅. You're linked.

Codes expire in 15 minutes and are single-use. Generate a fresh one if you miss the window.

To unlink at any time, return to Settings → Telegram → **Unlink**.

## What the bot understands

### Free-text queries (natural language)

Just type what you want. The bot uses Claude to figure out which SalesBrain tool to call.

- "What's on my pipeline?" → `list_deals`
- "Show me the Acme Corp deal" → `list_deals` (search) → `get_deal`
- "Any lessons from similar losses?" → `get_relevant_lessons`
- "Add a note to Acme: talked to CFO, they want on-prem" → `add_deal_note`
- "Mark this deal lost — they went with a cheaper competitor. Lesson: ask budget at G2." → `mark_deal_lost`
- "Advance Acme to G4" (admin only) → `advance_gate`
- "Remember: we always include the 20% security premium for on-prem" → `remember` (org scope)

Everything obeys your visibility scope — non-admins only see/edit deals they created or are assigned to lead.

### Commands

| Command | Purpose |
|---|---|
| `/start LINK-XXXXXX` | Link this Telegram account to a SalesBrain user |
| `/start` (no args) | Show the linking hint |

Note: reply-to-message voting on board review pings continues to work exactly as before, independently of the linked-user chat flow.

### Group @mentions

In any group where the bot is a member, `@<TELEGRAM_BOT_USERNAME> <question>` runs the same agent bridge and replies as a thread reply. Typical questions:

- "@salesbrain what's stuck at the board?" → uses `list_pending_board_decisions`
- "@salesbrain who voted on ChipChip and how many more do we need?" → same tool
- "@salesbrain how's the pipeline this week?" → `get_pipeline_overview`

Who can ask:

| Caller | Scope | Writes? |
|---|---|---|
| Linked user (any group) | Their normal per-user scope (or admin org-wide) | Yes — same as DM |
| Unlinked user, in the allowlisted board chat (`TELEGRAM_BOARD_CHAT_ID`) | Org-wide, read-only | No — gets a "link your account" reply |
| Unlinked user, any other group | Nothing — bot only replies with a linking hint | No |

Rate limit: 10 mentions per user per group per rolling 60 seconds. The board vote-reply flow keeps priority — a reply-to a pending decision is scored as a vote even if it @mentions the bot.

### Board-vote nudge

The bot re-posts a compressed reminder in the board group for every pending decision on **Mon / Wed / Fri at 11:00 EAT** (08:00 UTC). Each reminder shows the running tally (`proceed 4/5 · stop 1/4 · amend 0/4`), who's voted so far, and how many more "proceed" votes will advance the deal. Replies to the reminder count as votes exactly like replies to the original post — internally we update `board_decisions.telegram_message_id` to the new message so Route 2 keeps working.

Two additional triggers:

- **On-demand from the group**: an admin @mentions the bot with something like *"@salesbrain nudge the votes on ChipChip"* → the `nudge_pending_votes` MCP tool fires. Omit the deal name to nudge every pending decision.
- **Vote-miss safety net**: if someone replies "proceed" to a message that isn't the current vote anchor (e.g., a scrolled-off post or a tally reply), the bot posts a fresh nudge and tells them where to reply.

Cadence + throttle:
- Cron throttle: any decision nudged in the last **4 hours** is skipped.
- Age filter (cron only): decisions younger than **6 hours** are left alone so the original board post has room to work first.
- Admin `nudge_pending_votes` bypasses both filters (`force: true`).

Required env: `TELEGRAM_BOT_USERNAME` (without the leading `@`).

## Push notifications

All pushes are produced ring-side (`salesbrain-hermes`) and reach your private chat only if you have linked
your account; otherwise they fall back to the supervisor chat (or are dropped, for routine per-owner notes).

- **Approval cards** — "✉️ Outreach draft", "🔁 Follow-up #N", "🤝 Intro request", each with 👍 Send /
  👎 Skip. Approving sends immediately through the policy gate; the card is edited with the outcome.
- **Attention digest** (daily, 09:30 Addis) — who needs attention and why, with drafts already filed.
- **Agent digests** — the Leads Finder, Enricher and Graph Sync report to their owner after a run with work.
- **Board nudges** — Mon/Wed/Fri to the board group, re-anchoring the vote message.

## Rate + cost considerations

- Every free-text message triggers a model turn inside Hermes (Bedrock Sonnet). Cards, nudges and digests
  from the deterministic scripts cost no tokens.

## For maintainers

### Where things live

| Piece | Location |
|---|---|
| Gateway, profiles, bot tokens | Hermes on the server (`/root/.hermes`, profiles `default`, `crm`, `dev`, `presenter`) |
| `/start LINK-…` handling, board-vote interception | `salesbrain-hermes/src/salesbrain_hermes/board_hook.py` (`pre_gateway_dispatch`) |
| Acting identity (Telegram user → SalesBrain user) | `salesbrain-hermes/src/salesbrain_hermes/identity.py` + the `tool_request` middleware |
| Cards, digests, edits | `salesbrain-hermes/src/salesbrain_hermes/deliver.py` |
| 👍/👎 button handling | ring-side Telegram callback handler (`oa:` approvals, `bv:` votes) |
| Link tokens (this app) | `lib/telegram-links.ts`, `app/api/telegram/link-tokens/route.ts`, `app/api/telegram/link/route.ts`, `/profile → Telegram` |
| Board nudge on demand | `nudge_pending_votes` MCP tool → `lib/telegram-notifications.ts` |
| Tables | `telegram_user_links`, `telegram_link_tokens` (`db/migrations/016`) |

### Env vars (this app)

- `TELEGRAM_BOT_TOKEN` — used only for the on-demand board nudge and link-code deep links
- `TELEGRAM_BOARD_CHAT_ID` — board group chat id
- `TELEGRAM_BOT_USERNAME` (optional) — the "Open in Telegram" one-click link on the profile page

The gateway's own tokens and allowlists live in the Hermes `.env` on the server, not here.
