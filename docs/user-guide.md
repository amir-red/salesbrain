# SalesBrain — user guide

For Mateo, Esmail, and anyone else joining the CRM assistant. Written 2026-07-31
against the live system (68 tools deployed).

---

## What this is

SalesBrain is a CRM you talk to. There is a web app at
**salescrm.chipchip.social**, but most of the day-to-day happens in **Telegram** —
you ask questions in plain English and the assistant answers using the real
pipeline, your relationships, and your LinkedIn inbox.

**The one rule worth knowing up front: nothing is sent to anyone without you
approving the exact words.** No automatic emails, no automatic LinkedIn
messages, no automatic connection requests. The assistant drafts; you decide.

---

## Part 1 — Setup (ten minutes, once)

### 1.1 Link Telegram

This is what lets the assistant know who you are. Until you do it, the bot will
refuse to talk to you — deliberately, because acting without knowing who is
asking would mean showing your deals to a stranger.

1. Open **salescrm.chipchip.social** → sidebar → **Profile** → **Telegram** tab
2. Click **Generate linking code**. You'll get something like `LINK-A1B2C3`.
3. Open Telegram, find **@MateSalesCRMBot**, and send: `/start LINK-A1B2C3`
4. The bot confirms. Refresh the page to see "Linked".

> **If the bot doesn't answer at all**, your Telegram account isn't on the
> allow-list yet. Message the bot once anyway, then tell Amir — he reads your
> user id from the server log and adds you. Then send the link code.

### 1.2 Connect LinkedIn (optional, but it's half the value)

**Read this before you connect.** Connecting gives the assistant read access to
your *entire* LinkedIn inbox, including personal conversations. That is how it
separates real opportunities from pitch noise. Specifically:

- **We never see your password.** You type it on the provider's page; the CRM
  only stores an opaque account id.
- **Only you can see your inbox.** LinkedIn tools are excluded from the board
  group and from admin-wide visibility — unlike deals, which admins can see.
  Nobody else on the team can read your DMs through this system.
- **Nothing sends without your word-for-word approval.** There is no automated
  connecting and no automated messaging.
- **Automating LinkedIn is against LinkedIn's terms of service.** We keep the
  volume low and human-approved to stay well inside normal use, but the account
  risk is yours to accept. Don't connect an account you can't afford to lose.
- You can disconnect any time; syncing stops immediately.

To connect: **salescrm.chipchip.social** → sidebar → **Profile** → **LinkedIn**
tab → **Connect LinkedIn** → sign in on the provider's page (2FA included) → you
land back on the Profile page showing "Connected".

Your inbox syncs every 30 minutes between 07:00 and 21:00.

---

## Part 2 — Telegram: the daily driver

Just message **@MateSalesCRMBot** in a direct message. No commands to memorise —
ask in normal language. Examples that work today:

**Pipeline and deals**
- "What's in my pipeline?"
- "Show me the Kifiya deal"
- "Which deals are stalled?"
- "What did we learn from deals we lost like this one?"
- "Update the Recursive Robotics deal — value is 40k, they want a pilot in September"
- "Move ChipChip Pilot to gate 4"

**People and commitments**
- "What do I owe people this week?"
- "What do we know about Munir Duri?"
- "I promised Sarah a proposal by Friday" *(records a commitment with a due date)*
- "Log that I met Dawit at the AI summit — he runs engineering at Gebeya and is
  interested in agent tooling"

**The board**
- "What's the vote status on Kifiya?"
- "Remind the board about the pending decision"

### The board group

The assistant is also in the board group. In there it behaves differently on
purpose: **it answers about any deal, not just yours**, because it's a shared
tool for the exec team. Two things to know:

- It only replies when you **@mention it or reply to it** — it won't chime in on
  normal conversation.
- **Voting**: reply to a board-review message with `proceed`, `hold`, or
  `reject`. That's counted deterministically with no AI involved, so votes are
  never mis-read. Adding a reason after the word is fine.
- **Your LinkedIn inbox is not available in the group.** Ask about that in a DM.

---

## Part 3 — LinkedIn

### 3.1 Triage: "what actually needs me?"

The problem this solves: an inbox where a genuine intro offer and a templated
agency pitch look identical, so the whole thing gets ignored. The assistant
classifies every conversation — *opportunity, talent, intro, personal, noise* —
and ranks what's waiting on you.

Ask:
- "What needs me on LinkedIn?"
- "Show me my LinkedIn inbox"
- "Anything important I've missed?"

You'll get the valuable threads with how long they've been waiting, and the
cold pitches filtered out. Ask for `include_noise` if you want to see everything.

You also get a **digest in your Telegram DM** when something changes — never when
nothing has, because silence is information too.

### 3.2 Reading and replying

- "Show me the conversation with Mark Mandau"
- "Draft a reply to Mark" → you get a draft, referencing what he actually said
- "Change the second line to mention the pilot, then send it"

The draft uses the thread history plus anything the CRM knows about that person.
**It is not sent until you say so.** When you approve, it goes out on LinkedIn as
you.

### 3.3 The event workflow — this is the one built for you

You're at a conference and meet forty people. Here's the loop:

**At the event** — after each conversation, message the bot (voice notes work):

> "Met Sarah Chen, CTO at Fintech Co. Interested in agent infrastructure, wants
> to talk about a pilot in September. Sharp, skeptical about vendor lock-in."

That's it. The assistant extracts the facts and the follow-up commitment into
the relationship graph. You've captured it in fifteen seconds and can go back to
the room.

**Connecting** — do it yourself, ideally on the spot: LinkedIn's QR code (both
phones out, five seconds) or send the request by hand. **The system deliberately
does not send connection requests.** A bare invite from someone you just met is
completely normal; the personalisation belongs in the first message *after* they
accept, where there's room to say something real.

**Not sure which profile is theirs?** Ask: *"find Sarah Chen at Fintech Co on
LinkedIn"* — you'll get candidates with photo, headline and location, and you
pick. It will never guess for you, because "great meeting you at the conference"
sent to the wrong Sarah Chen is unrecoverable.

**After they accept** — the assistant notices (within a few hours; LinkedIn gives
no instant signal) and surfaces them:

- "Who's accepted my connection requests?"
- "Draft a follow-up to Sarah"

The draft references what you actually captured — not generic flattery. Approve
it and it sends.

**Why speed matters:** without a note on the invite, people forget the
conversation quickly. Aim to follow up within a day or two. The assistant tracks
that as a commitment and will remind you.

---

## Part 4 — Finding new prospects

For going after people you *haven't* met, using LinkedIn Sales Navigator.

### 4.1 Define who you're looking for

> "Set up an ICP called 'UK fintech eng leaders' — VP Engineering, CTO or Head of
> Platform, at financial services companies in the UK or Germany. Not students or
> anyone job-hunting."

This gets stored, so you refine rather than retype it: *"add Netherlands to that
ICP"*.

### 4.2 Source

> "Find me 25 prospects for the UK fintech ICP"

It searches Sales Navigator, scores each person against your criteria, and gives
you a ranked list with **the reasoning shown**:

> `80 strong_fit — Jodie O'Rourke, VP of Engineering at SumUp`
> *title matches 'vp engineering' (+40); seniority 'vp' (+20); located in
> 'united kingdom' (+20); industry unknown — run company research (+0)*

Read those reasons. A score that says "industry unknown" is telling you it's
working on partial information. Ask *"research SumUp and re-score"* to fill the
gap.

**This uses your LinkedIn search quota**, which is account-level, so it runs when
you ask and never on a loop. If a search matches 20,000 people, that's a signal
your ICP is too loose — tighten it rather than fetching more.

### 4.3 Act on one

> "Engage Jodie"

That pulls them into your relationship graph, carrying their score, reasoning and
any research across so the next draft knows why they mattered. Then the
assistant tells you honestly what's possible:

- Already have a LinkedIn conversation → it can draft into it
- Email on file → the normal outreach path works
- **Neither** → *there is no way to message them yet.* Connect by hand first.
  It will say so plainly rather than pretending.

### 4.4 Uploading a list

Import contacts at **Profile → Imports**. They're scored against your active ICP
automatically, and the ones that fit become prospects. The rest stay as contacts
— that's intentional, not a failure. If nothing clears the bar, your ICP and your
list disagree.

---

## Part 5 — The guardrails

The assistant will sometimes refuse. **That's the system working, not a bug.**

| Rule | What it means |
|---|---|
| **Quiet hours** | Nothing sends outside 08:00–20:00 Addis time |
| **Per-person cap** | Max 1 message per person per day, 3 per week |
| **LinkedIn account cap** | Max 25 LinkedIn messages a day, 100 a week |
| **Commercial gate** | Before an *ask*, you need to have delivered value to that person in the last 30 days — unless the relationship is already trusted |

The last one is the important one. The doctrine is **create value before asking
for value**: something personal beats something career-helpful, which beats
something useful to their company, which beats anything that benefits us. A
commercial ask is last, and gated.

When it refuses, it tells you why. **Don't rephrase to get around it** — the
assistant is instructed to treat a denial as final for that turn, and the caps
exist to protect relationships from us.

---

## Part 6 — Who sees what

| | You | Other users | Admins | Board group |
|---|---|---|---|---|
| Your deals | ✅ | ❌ | ✅ | ✅ |
| Your LinkedIn inbox | ✅ | ❌ | ❌ | ❌ |
| Your prospects | ✅ | ❌ | ✅ | ✅ |
| The relationship graph | ✅ | ✅ | ✅ | ✅ |

LinkedIn is the deliberate exception: it's personal, so it never widens — not to
admins, not in the board group. Everything you do is recorded in an audit log
attributed to you.

---

## Part 7 — When something looks wrong

**"The bot doesn't reply in my DM"** — your Telegram isn't linked, or your account
isn't allow-listed. See §1.1.

**"It says it can't see my deals"** — check with *"who am I?"*. If it names the
wrong person, your Telegram is linked to the wrong CRM account.

**"My LinkedIn inbox is empty"** — check **Profile → LinkedIn** shows Connected.
The sync runs every 30 minutes during working hours; it won't have anything the
first few minutes after connecting.

**"It refuses to send"** — read the reason. It's almost always quiet hours, a cap,
or the commercial gate. All four are listed in §5.

**"It told me there's no way to message someone"** — that's honest, not broken.
You have no LinkedIn thread and no email for them. Connect by hand first.

**Something looks wrong in the data** — say so. If the assistant ever states a
fact about a person, it should be able to tell you where that came from and when.
Ask *"where did that come from?"* — anything it can't attribute, it shouldn't be
using.

---

## A short list of things it will not do

Worth knowing so you don't wait for them:

- Send anything without your approval
- Send LinkedIn connection requests
- Message people outside quiet hours or over the caps
- Read another person's LinkedIn inbox
- Auto-send onboarding or kickoff emails to clients
- Act at all for someone whose Telegram isn't linked
