# SalesBrain MCP — what changed, and what you need to do

*2026-08-02. For Hermes agents connecting to SalesBrain over MCP.*

## The short version

Your SalesBrain MCP connection went from **23 tools to 69**. All of LinkedIn,
all of prospecting, and the whole relationship graph are now available — they
existed in the CRM already, they were just never exposed here.

**What you need to do: reload MCP.** Your token and URL are unchanged.

```text
/reload-mcp
```

If you run Hermes as a gateway rather than an interactive session, **restart the
process** instead.

---

## Why a reload is needed

Hermes discovers MCP tools **once per process, in a background thread at
startup**, and caches them for the life of that process. It will refresh early
if a server sends `notifications/tools/list_changed` — but SalesBrain declares
`listChanged: false` and means it. The endpoint is stateless Streamable HTTP
(one request in, one response out), so it has no open channel to push a
notification down.

Config-file changes auto-reload via the file watcher. This isn't a config
change — the *server's* tool list grew — so nothing on your side notices until
you reload.

---

## Tool names

Hermes prefixes every MCP tool with its server name. If your server block is
named `salesbrain`, the tools appear as:

```text
mcp_salesbrain_crm_linkedin_inbox
mcp_salesbrain_crm_person_dossier
mcp_salesbrain_crm_whoami
```

Throughout this doc I write the bare names (`crm_whoami`); prepend
`mcp_<your-server-name>_` for what you'll actually see in the tool surface.

---

## Config, if you ever need to re-enter it

```yaml
mcp_servers:
  salesbrain:
    url: "https://salescrm.chipchip.social/api/mcp"
    headers:
      Authorization: "Bearer <your token>"
```

Your token lives at **salescrm.chipchip.social → Profile → MCP**. Tokens are
shown once — if you've lost it, mint a new one there and revoke the old.

---

## Did anything break?

**No.** Everything you were using still works, including the old names.

Some names changed — `update_deal` is now `crm_update_deal`, `list_deals` is
`crm_list_my_deals`. The old names still dispatch, they're just no longer
advertised, so after a reload your agent will use the new ones. Nothing to do.

One exception: **`send_email` is gone.** It let the agent mail an external party
with no step where a human read the message first. It had never been called, so
nothing is lost.

---

## What you can do now that you couldn't before

**Your LinkedIn inbox.** `crm_linkedin_inbox` gives you conversations where the
other person spoke last, ranked by value and staleness, cold pitches filtered
out. `crm_linkedin_thread` reads one, `crm_linkedin_draft_reply` drafts,
`crm_linkedin_pending_followups` shows accepted connections still waiting on a
first message.

**Prospecting.** `crm_icp_list`, `crm_prospect_search`, `crm_prospect_queue`,
`crm_prospect_qualify`, `crm_prospect_convert` — define a target, source against
it, see scored candidates with the reasoning, convert a good one to a deal.

**The relationship graph.** `crm_person_lookup` → `crm_person_dossier` before a
call: what you know, where each fact came from, open commitments in both
directions.

**Deal context.** `crm_deal_timeline`, `crm_stalled_deals`,
`crm_relevant_lessons`, `crm_board_status`.

---

## What is deliberately NOT available

Nothing here sends to anyone outside the CRM. No LinkedIn messages, no outreach
emails, no follow-up sends. `crm_linkedin_send` and `crm_send_outreach` are
withheld and come back as `Unknown tool` if something tries.

This isn't a permissions gap — your MCP token carries your identity and the
kernel applies exactly the same rules as everywhere else. It's that this surface
has no moment where a human reads the exact words before they go out. That
matters more for an agent than for a chat client, because your agent runs
multi-turn loops on its own.

**Draft here, send from Telegram.**

---

## Scope

Everything is filtered to your own access — your deals, your LinkedIn inbox,
your prospects. Same rules as the web app and the Telegram bot.

One difference: in the board Telegram group the bot sees the whole pipeline,
because it's a shared group. Over MCP you get only your own deals. That's
intentional.

---

## If 69 tools crowds your context

Hermes can filter per server. Use the **original** tool names (unprefixed):

```yaml
mcp_servers:
  salesbrain:
    url: "https://salescrm.chipchip.social/api/mcp"
    headers:
      Authorization: "Bearer <your token>"
    tools:
      exclude: [crm_ping, crm_icp_define, crm_prospect_archive]
      resources: false
      prompts: false
```

Only worth doing if you notice the tool surface crowding things out — 69 is well
within what Hermes handles.

---

## Suggested system prompt

Add this to your agent's system prompt or a skill. Not required, but it stops
the agent guessing at things it should look up.

```
I use SalesBrain, a CRM exposed over MCP. Tool names are prefixed
mcp_salesbrain_ — adjust if my server block is named differently.

Prefer SalesBrain tools over asking me for anything already recorded there.

Orientation: crm_whoami for who I am. crm_pipeline_overview,
crm_list_my_deals, crm_search_deals to find work. crm_get_deal then
crm_deal_timeline before advising on a deal. crm_stalled_deals for slippage.

Before I talk to anyone: crm_person_lookup then crm_person_dossier. Facts
carry provenance — cite where a fact came from rather than stating it flat,
and say plainly when something is unconfirmed. Never invent a detail about a
person. If it isn't in the dossier, say so.

LinkedIn: crm_linkedin_inbox is triage (who spoke last, ranked by value).
crm_linkedin_thread reads one. crm_linkedin_draft_reply drafts.

You CANNOT send. No tool here delivers a message to anyone outside the CRM,
and the send tools are withheld server-side. Draft it, show me, and tell me
to send it from Telegram. Never imply something went out.

Prospecting: scores come with reasons — quote them rather than asserting a
prospect is good. crm_prospect_search spends Sales Navigator quota against my
real LinkedIn account, so ask before running it.

Deal money and dates go in structured fields via crm_update_deal, not prose
notes — the board card and pipeline views read the columns.

Say what you changed when you change something. When a tool returns an error
or a denial, tell me what it said rather than routing around it.
```

---

## Checks after reloading

- You should see **~69** SalesBrain tools. If you see ~22, the server couldn't
  reach the kernel and served the old set — reload again in a few minutes, and
  tell Amir if it persists.
- `crm_whoami` should return your name and role. If you get
  `read_only_context`, your account isn't linked and the message says how to fix
  it.
