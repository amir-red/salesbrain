# SalesBrain MCP — what changed, and what you need to do

*2026-08-02*

## The short version

Your SalesBrain MCP connection went from **23 tools to 69**. All of LinkedIn,
all of prospecting, and the whole relationship graph are now available to
Claude — they existed in the CRM already, they just were never exposed here.

**What you need to do: reconnect.** Nothing else.

Your token and URL are unchanged. Tool names are not stored in your config —
your client asks the server for the list each time it connects, so it picks up
the new ones on its own.

---

## Reconnecting

**Claude Desktop:** quit it fully (Cmd-Q, not just closing the window) and
reopen. Check the tools icon in the message box — you should see ~69 SalesBrain
tools where there used to be 23.

**Anything else:** restart the client, or toggle the SalesBrain server off and
on in its settings.

If your config needs re-entering for any reason:

```json
{
  "mcpServers": {
    "salesbrain": {
      "url": "https://salescrm.chipchip.social/api/mcp",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}
```

Your token lives at **salescrm.chipchip.social → Profile → MCP**. If you've lost
it, mint a new one there and revoke the old — tokens are shown once.

---

## Did anything break?

**No.** Every tool you were using still works, including the old names.

Some names changed — `update_deal` is now `crm_update_deal`, `list_deals` is
`crm_list_my_deals`, and so on. The old names still function, they're just no
longer advertised, so Claude will naturally start using the new ones. You don't
need to do anything about this. If you have saved prompts that name a tool
explicitly, add the `crm_` prefix when you next edit them.

One exception: **`send_email` is gone.** It let the MCP client mail an external
party with no step where you read the message first. It had never been used, so
nothing is lost. Follow-up emails still go out from the CRM and from Telegram.

---

## What you can do now that you couldn't before

**Your LinkedIn inbox.** Ask *"what's in my LinkedIn inbox that needs me?"* and
you get your conversations ranked by value and staleness, with cold pitches
filtered out. You can read a thread, draft a reply, and see who's accepted a
connection and is waiting on a first message.

**Prospecting.** Define an ICP, search Sales Navigator against it, see the
scored queue with the reasons behind each score, and convert a qualified
prospect into a deal.

**The relationship graph.** Ask what you know about a person before a call —
their dossier, the facts on file with where each came from, open commitments in
both directions, and the value ledger.

**Deal context you had to dig for.** Full timeline for a deal, stalled deals
past their gate SLA, lessons from similar losses, board vote tallies with who
has actually voted.

Ask in plain language. Claude picks the tool.

---

## What is deliberately NOT available

Claude cannot **send** anything to anyone outside the CRM from here. No LinkedIn
messages, no outreach emails, no follow-up sends.

This isn't a permissions gap — your MCP token carries your identity and the same
access rules as everywhere else. It's that this surface has no moment where you
read the exact words before they go. On Telegram you see the draft and say
"send"; here a client could just call send directly.

So: **drafting happens here, sending happens on Telegram.** Ask Claude to draft
a LinkedIn reply, read it, then send it from your Telegram DM with the bot.

---

## What Claude sees is scoped to you

Everything comes back filtered to your own access — your deals, your LinkedIn
inbox, your prospects. Same rules as the web app and the Telegram bot.

One difference worth knowing: in the board Telegram group the bot can see the
whole pipeline, because it's a shared group. Over MCP you get only your own
deals. That's intentional.

---

## Optional: a better system prompt

Paste this into your client's custom-instructions or project-instructions field.
It's not required — everything works without it — but it helps Claude choose the
right tool and stops it guessing at things it should look up.

```
I use SalesBrain, a CRM exposed through MCP. Prefer its tools over asking me
for information I've already recorded there.

Orientation:
- crm_whoami tells you who I am and my role.
- crm_pipeline_overview / crm_list_my_deals / crm_search_deals to find deals.
- crm_get_deal then crm_deal_timeline for full history before advising.
- crm_stalled_deals for what's slipping.

Before I talk to anyone, look them up: crm_person_lookup then
crm_person_dossier. Facts carry provenance — cite where a fact came from
rather than stating it flat, and say plainly when something is unconfirmed.
Never invent a detail about a person; if it isn't in the dossier, say so.

LinkedIn: crm_linkedin_inbox is the triage view (who spoke last, ranked by
value). crm_linkedin_thread reads one. crm_linkedin_draft_reply drafts.
crm_linkedin_pending_followups shows accepted connections still waiting on a
first message.

You CANNOT send. No tool here delivers a message to anyone outside the CRM.
Draft it, show it to me, and tell me to send it from Telegram. Never imply
something went out.

Prospecting: crm_icp_list, crm_prospect_queue, crm_prospect_get. Scores come
with reasons — quote them rather than asserting a prospect is good.
crm_prospect_search burns Sales Navigator quota, so ask me first.

Deal money and dates belong in structured fields via crm_update_deal, not in
prose notes — the board card and the pipeline views read the columns.

When you change something, say what you changed. When a tool returns an error
or a denial, tell me what it said rather than working around it.
```

---

## If something looks wrong

If you see only ~20 tools after reconnecting, the server couldn't reach the
kernel and fell back to the old set. Reconnect again in a few minutes; if it
persists, tell Amir.

If a tool returns `read_only_context`, your account isn't linked — that message
tells you how to fix it.
