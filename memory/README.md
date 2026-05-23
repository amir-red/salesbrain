# Agent Memory

This directory is the agent's long-term memory — durable facts that persist across every conversation, every deal, every restart. Think of it like Claude Code's `MEMORY.md`, but for SalesBrain's deal-chat agent.

## Files

| Path | Who reads it | Who writes to it |
|---|---|---|
| `org.md` | Loaded into every chat for every user | The whole team — via VSCode or via the agent's `remember` tool |
| `users/<localpart>.md` | Loaded only when that user is chatting | Just that user — via VSCode or via `remember` |

Filename rule for per-user files: **email local-part, lowercased**. So `amir@chipchip.social` writes to `users/amir.md`.

## Bullet format

One fact per line, leading with a `-`. The agent stamps an HTML-comment id + provenance at the end of each bullet so it can refer to memories by id and you can see who/when added it:

```md
- Never quote on-prem without a 20% security premium. <!-- mem_a1b2 · added 2026-05-16 by amir · from deal a1b2c3d4 -->
- Grants under $50K USD are de-prioritized when bigger ones are open. <!-- mem_c3d4 · added 2026-05-12 by sara -->
```

HTML comments don't render in markdown previews, so the file stays readable in VSCode.

## Editing by hand

Just open the file in VSCode and edit. Save. Commit. The agent re-reads on every chat turn so changes take effect immediately. The `mem_xxxx` ids are optional — bullets without them load fine; they just can't be removed via the `forget` tool (delete them by hand instead).

## Editing via the agent

Say "remember X" in any deal chat. The agent calls its `remember` tool, which appends a bullet to the right file (`org.md` for team-wide lessons, your `users/<you>.md` for personal preferences) and auto-commits to git. Say "forget mem_xxxx" to remove a specific bullet.

## Why git?

Every write here is auto-committed (`mem: org · "..."`). That gives you free version history (`git log memory/org.md`), free undo (revert the commit), and survival across deploys (the deploy pulls from git, so prod-side appends are pushed back to keep them).

## Scopes that don't exist yet

V1 is `org` + `user`. Per-contact and per-account memory layers are V2 — for now, contact-specific facts live in `deal.notes` and `deal.fields`.
