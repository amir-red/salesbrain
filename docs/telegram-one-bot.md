# One Telegram bot for every user — how it works and how to cut over

Decision (Amir, 2026-10-16): every SalesBrain user talks to ONE bot, receives their notifications there, and
manages their account there. Power is decided by the person's ROLE, not by which bot they opened.

## What each person can do

| | Everyone | Administrator, private chat | Administrator, group chat |
|---|---|---|---|
| Product (every `crm_*` tool: deals, leads, ICPs, approvals, follow-ups, notes, notifications) | yes, as themselves | yes | yes |
| Web search, skills, vision, voice | yes | yes | yes |
| Server (shell, files, code, scheduler, browser, past-conversation search) | no | yes, while `agents.telegram.admin_shell` is on | no |
| Slash commands | `/new /status /retry /undo /title /stop /help /whoami` | all | all |

Enforcement lives in three places, none of them the prompt:

1. **`role_policy.py`**, a `pre_tool_call` plugin hook. An ALLOWlist: anything not `crm_*` or on the short harmless
   list is a server tool. Fails closed (an unreadable role is not an admin). Governs Telegram only; cron, the CLI
   and web chat are limited by their own toolsets. Proved through Hermes' real dispatcher on the box: admin DM ran,
   admin group blocked, teammate blocked, web search allowed.
2. **`platforms.telegram.extra.allow_admin_from` / `user_allowed_commands`** (Hermes slash-command gating). Admin ids
   are written at every deploy from the database: role `admin` + an active Telegram link.
3. **The link table.** Nobody gets in without `/start LINK-…` from the app (`board_hook._sync_access` pairs an active
   link, unpairs a revoked one). Strangers are dropped silently (`unauthorized_dm_behavior: ignore`).

## Cut over (integration session, Amir present, bot idle)

Prerequisites shipped by the normal deploy: migrations 063–065, the ring with `role_policy`, the unified persona.

```
cd salesbrain-hermes
ONE_BOT=1 bash scripts/deploy-server.sh
```

`ONE_BOT=1` additionally: copies the CRM bot's token (already on the box as `SALESBRAIN_BOARD_BOT_TOKEN`) into the
default profile's `TELEGRAM_BOT_TOKEN`; keeps the union of both allowlists so nobody is locked out in the hand-over;
comments out the crm profile's token and disables its Telegram platform (two pollers on one token = 409); leaves
rollback copies `/root/.hermes/.env.pre-onebot` and `profiles/crm/.env.pre-onebot` (mode 600).

Then, by hand:
1. In BotFather, revoke the OLD bot's token (the one that was in the default profile before).
2. DM the bot from your own account: a product question, then a server command (both should work).
3. From a teammate's account: a product question works; "run `ls` on the server" is refused with the reason.
4. In the board group: a vote reply still counts; ask for a server command as admin: refused (group).
5. The gateway log shows no 409 and no second Telegram poller.
6. After a day without problems, delete the two `.pre-onebot` files.

**Known cost:** teammates' Hermes chat history lived in the crm profile and starts fresh in the default profile. Their
saved notes (`agent_memories`) survive; so do deals, leads and every kernel record.

**Rollback:** `cp .env.pre-onebot .env` (and the crm one), `hermes -p crm config set platforms.telegram.enabled true`,
restart the gateway.

## Switches

- Take the server out of Telegram without a deploy:
  `UPDATE policy_rules SET value = jsonb_set(value,'{admin_shell}','false') WHERE key = 'agents.telegram';`
  (seen within 30 seconds).
- A new admin: promote the user in the app, have them link Telegram, redeploy (slash commands read the admin list at
  deploy time; the tool policy follows the role within seconds).

## Traps found while building this

- `platforms.telegram.extra.allow_from` was `['*']`. Hermes ignores it only while `TELEGRAM_ALLOWED_USERS` has entries;
  emptying that list would have admitted every Telegram user. The deploy now clears it and refuses a deploy where the
  wildcard, `GATEWAY_ALLOW_ALL_USERS` or `TELEGRAM_ALLOW_ALL_USERS` is present.
- An EMPTY `allow_admin_from` switches slash gating off (everyone an admin). The deploy stops instead.
- `session_search` searches every past conversation of the profile, other people's included. It is admin-only.
- A `pre_tool_call` callback that raises is skipped by Hermes, so the hook catches its own errors and blocks.
