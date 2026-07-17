# SalesBrain Telegram Bot

**Audience:** SalesBrain users who want to interact with their pipeline from Telegram, and anyone maintaining the bot infrastructure.

## What it does

The bot lets each SalesBrain user chat with a Claude-powered assistant that has full access to their (scope-limited) deals through the same MCP tool surface as `/api/mcp` uses. Ask "what's on my sales pipeline?", "add a note to Acme that we spoke to their CFO", "any lessons from similar grants I should worry about?" — the bot understands, calls SalesBrain tools, and replies.

It also **pushes notifications** for two events:
- SLA breaches on deals you lead (daily cron)
- New deal assigned to you (fires the moment `lead_id` is set)

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

## Push notifications

### SLA breach (daily)

The cron at `/api/cron` runs a batched check: any active deal past its SLA whose `lead_id` is a linked Telegram user gets included in that user's daily digest. One message per user, up to 5 deals listed inline, plus a "…N more" if the list is longer.

Example:
```
⚠️ 3 deals past SLA

• Precise Consult (Precise Consult) — G6, 22d / 14d SLA
  https://salescrm.chipchip.social/deals/…

• Acme Corp Pilot (Acme) — G3, 8d / 5d SLA
  https://salescrm.chipchip.social/deals/…

• …
```

### New deal assigned to you

Fires the moment someone sets `lead_id` to your user — via the web UI, the agent, or MCP. Immediate ping (not batched):

```
📌 New deal assigned to you

Big Client Deal
Acme Corp Ltd
G2: Demand Analysis · score 72 · high risk

Assigned by Amir

Open: https://salescrm.chipchip.social/deals/…
```

## Rate + cost considerations

- Every free-text message from a linked user triggers a Claude API call. Costs a few cents per message depending on the tools it calls.
- Push notifications don't hit Claude at all — pure DB read + Telegram send. Basically free.
- The bot handles messages **asynchronously**: your Telegram gets a 200 back immediately, then the actual reply lands seconds later. This avoids timeouts on the Telegram webhook.

## For maintainers

### Files

| File | Role |
|---|---|
| `lib/telegram-links.ts` | Link-token generation, hashing, consumption; link lookup + revoke |
| `lib/telegram-agent.ts` | Bridge from a Telegram message → Claude with MCP tools → reply |
| `lib/telegram-notifications.ts` | `notifyDealAssigned` + `notifySlaBreachesForAllUsers` |
| `lib/telegram.ts` | `sendChatMessage` (DMs) + `sendTelegramMessage` (existing board group) |
| `app/api/telegram/route.ts` | Router: `/start` linking / board vote reply / private-chat agent bridge |
| `app/api/telegram/link-tokens/route.ts` | GET status, POST generate |
| `app/api/telegram/link/route.ts` | DELETE — revoke binding |
| `app/settings/telegram/page.tsx` | UI for linking / revealing code / unlinking |
| `app/api/cron/route.ts` | Batched SLA-breach notify runs here (section 2b) |
| `db/migrations/016_telegram_user_links.sql` | Both link tables |

### Env vars (existing, unchanged)

- `TELEGRAM_BOT_TOKEN` — bot's API token from @BotFather
- `TELEGRAM_BOARD_CHAT_ID` — board group chat id (board reviews)
- `TELEGRAM_WEBHOOK_SECRET` — HMAC secret for `/api/telegram` (already required)
- `TELEGRAM_BOT_USERNAME` (optional) — enables the "Open in Telegram" one-click deep link on the settings page

### Data flow: free-text message

```
Telegram user sends "what's my pipeline?"
                    │
                    ▼
[Telegram servers] POST /api/telegram (with X-Telegram-Bot-Api-Secret-Token)
                    │
                    ▼
Route handler:
  • Not /start? Not a reply? Is private chat?
    → handlePrivateChatMessage()
      │
      ├─ lookupTelegramLink(from.id)
      │  └─ Returns linked SalesBrain user with role
      │
      ├─ Return 200 to Telegram immediately (unblock webhook)
      │
      └─ Background: sendChatAction(typing) + processMessage(linked, text)
         │
         └─ processMessage() in lib/telegram-agent.ts:
            ├─ Build Anthropic tools array from MCP_TOOLS
            ├─ Claude tool-use loop (up to 6 iterations)
            │  └─ Each tool_use → dispatchTool() from lib/mcp/tool-dispatch
            │     with an AuthContext derived from the linked user
            └─ Final text → sendChatMessage(chat_id, reply.text)
```

### Rate limiting notes

Currently no explicit rate limit on the free-text bot flow (MCP-side per-user 100/min still applies because the agent bridge dispatches through `dispatchTool`, but it uses a synthetic `token_id`). If usage explodes, add a per-linked-user counter in `lib/telegram-agent.ts`.

### Troubleshooting

| Symptom | Fix |
|---|---|
| Bot doesn't respond in DM | Check the linked user actually exists: `SELECT * FROM telegram_user_links WHERE telegram_user_id = <id>` |
| `/start LINK-XXX` says "Token is invalid, expired, or already used" | Codes expire in 15 minutes. Generate a fresh one. |
| Bot linked but replies come back as errors | Check `pm2 logs salesbrain` — most common: `ANTHROPIC_API_KEY` missing or Claude quota exceeded |
| SLA breach cron sends nothing | The linked user must be the `lead_id` on an active deal. Non-lead assignees don't trigger these. |
| User gets no "new deal assigned" ping | Ping fires on `exec_update_deal` when `lead_id` changes. If created via `POST /api/deals` (initial state), the current code hooks that path too — verify by adding the assignment then checking `pm2 logs \| grep telegram`. |

### Local dev

The bot's webhook can't reach `localhost` from Telegram's servers. For local testing, use a tunnel:

```bash
ngrok http 3000
```

Set the webhook to the ngrok URL:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://xxx.ngrok.io/api/telegram&secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Then link your Telegram account against `localhost:3000/settings/telegram` (or your ngrok domain).

Remember to restore the prod webhook when done:
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://salescrm.chipchip.social/api/telegram&secret_token=$TELEGRAM_WEBHOOK_SECRET"
```
