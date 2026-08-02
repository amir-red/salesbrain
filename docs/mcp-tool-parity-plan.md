# Plan: give the MCP server the full tool set — and keep it that way

*Written 2026-08-02.*

> **Status: steps 1 and 2 built (branch `mcp-tool-parity`, core+ring 0.15.0).**
> Advertised catalogue goes 23 → 69 (66 ring + 3 app-owned); 5 send/notify tools
> withheld. Step 3 — deleting the superseded app-inline implementations — is
> deliberately NOT done, per §8: it waits until Mateo is confirmed working on
> the kernel twins.
>
> **Deploy the ring BEFORE the app.** The app asks the ring for its catalogue;
> a ring without `catalog()` answers `unknown kernel tool: __catalog__`. The
> fallback covers this (clients keep the legacy 22 rather than dropping to 3),
> but the ordering avoids a degraded window entirely.

## 1. Objective

**Make the MCP endpoint a first-class surface onto the kernel, equal to Telegram
and web chat, and make it impossible for it to fall behind again.**

Two goals, and the second matters more than the first:

1. **Close the gap now.** `/api/mcp` advertises **23** tools; the ring registers
   **70**. Two-thirds of the system — every LinkedIn tool, every prospecting tool,
   the whole relationship graph — is invisible to Claude Desktop and any other MCP
   client.
2. **Close it permanently.** Today a new `crm_` tool reaches Telegram the moment
   it is registered, and reaches MCP never. The fix is not a one-time catch-up; it
   is making *"is this tool useful over MCP?"* a question that must be answered
   when the tool is written, and that CI refuses to let you skip.

3. **Finish the Phase 5 thinning.** Six of MCP's most-used tools are *duplicate
   implementations* of kernel commands — a second deal-RBAC implementation and a
   second write path into `deals` (§3c). Exposing the kernel namespace lets these
   be deleted, so MCP shares one behaviour and one audit trail with Telegram and
   web chat.

**Success looks like:** adding a tool to the ring requires one extra key in its
declaration; getting that key wrong fails CI; and no step in any deploy involves
regenerating, syncing, or remembering anything about MCP.

**Non-goal:** exposing *everything*. Some tools should never be on this surface
(see §5). The point is that exclusion becomes a recorded decision rather than an
oversight.

## 2. Why it drifted (the root cause the design has to kill)

There are two independent catalogues:

- **The ring** builds its tool list from `TOOLS` arrays in
  `salesbrain_hermes/tools/{deals,people,outreach,linkedin,prospecting}.py`. Each
  entry is already a complete declaration:
  ```python
  dict(name="crm_board_status",
       schema={"description": "...", "parameters": {"type": "object", ...}},
       handler=lambda args, **kw: _run(_board.board_status, args))
  ```
- **MCP** builds its list from `lib/mcp/tool-definitions.ts`, a hand-written TS
  file in a different repo, in a different language, with a hand-written
  `switch` in `tool-dispatch.ts` beside it.

Nothing connects them. Adding a `crm_` tool touches neither, and no test notices.
That `schema` block above is *already* MCP's `inputSchema` in all but name — the
data exists, it is simply never carried across.

**So the design principle is: one declaration, two consumers.** The ring's tool
list becomes the single source of truth; MCP derives from it at runtime.

## 3. Implementation

### 3a. Ring — declare the MCP decision at the tool

Add one required key to every tool declaration:

```python
dict(name="crm_board_status",
     schema={...},
     mcp="read",          # "read" | "write" | "admin" | None (not exposed)
     handler=...)
```

`mcp` carries **both** decisions at once — whether the tool is exposed, and at
what access level MCP should gate it. That is better than deriving access from
name patterns (`get_*` → read), which my first draft proposed: name heuristics
are a guess that silently misclassifies the first tool that breaks convention.

`None` is a legitimate, explicit answer meaning *"deliberately not on MCP"* — see
§5 for what earns it.

Then add `catalog()` to `salesbrain_hermes/rpc.py`:

```python
{"tools": [{"name": ..., "description": ..., "parameters": {...}, "access": ...}]}
```

built from the same five `TOOLS` lists `_registry()` already imports, filtered to
`mcp is not None`. It rides the **existing** RPC protocol — a `{"tool":
"__catalog__"}` request through `SALESBRAIN_RPC_REQUEST` — so there is no new
transport, no new daemon, no new port.

> Note: `crm_ping` is registered directly in `__init__.py::register()` and is not
> in any `TOOLS` list, so `_registry()` (and therefore `catalog()`) will miss it.
> Either move it into a list or add it explicitly.

### 3b. App — derive the catalogue instead of writing it

`lib/mcp/tool-definitions.ts` keeps only the ~9 genuinely app-only tools (sales
leads, memory, lessons, `send_email` via the app mailer) and gains the ring
catalogue at runtime, cached per process:

- **Cold start:** one `catalog()` subprocess, ~1 spawn per process lifetime.
- **If it fails:** serve the app-only tools, log loudly, and set a health flag.
  Never serve an empty `tools/list` — a client that sees zero tools concludes the
  server is useless and stops asking.

`lib/mcp/tool-dispatch.ts` gains a fallthrough: any name not in the hand-written
`switch` that exists in the ring catalogue goes to
`kernelCall(name, args, ctx.user_id)`. The existing 23 `case` arms stay, because
several reshape arguments (`advance_gate` → `crm_advance_gate` with
`new_gate` → `gate`; `schedule_followup` with `type` → `type_`).

### 3c. Naming — one namespace, no aliases

MCP tools are unprefixed (`get_deal`, `update_deal`); ring tools are
`crm_`-prefixed. **Amir's decision: no back-compat aliases — he and Mateo will
update their own MCP clients.** That is the right call, and the usage data shows
why it is worth more than the convenience it costs.

**There is one real consumer.** `mcp_audit_log` records every call by tool name:

| | calls | last used |
|---|---|---|
| `mateo@chipchip.social` | **~530 across 15 tools** | 2026-08-02 (daily) |
| `amir@chipchip.social` | token active, never used | — |
| 2 older tokens | revoked | — |

So MCP is not a toy integration — it is Mateo's working surface, led by
`update_deal` (125), `get_deal` (115) and `list_deals` (85).

**The finding that makes renaming worth doing.** Of Mateo's 15 tools, **13 already
have kernel equivalents** — only `get_memories` and `remember` are genuinely
app-only. But just 7 are *proxied* to the kernel. The other 6 are **duplicate
implementations**: the app runs its own SQL beside the kernel's version of the
same operation.

| MCP tool | Kernel twin | App path today |
|---|---|---|
| `get_deal` (115) | `crm_get_deal` | app-inline SQL |
| `list_deals` (85) | `crm_list_my_deals` | app-inline SQL |
| `create_deal` (24) | `crm_create_deal` | **app-inline `INSERT INTO deals`** |
| `add_deal_note` (20) | `crm_add_note` | app-inline SQL |
| `list_sales_leads` (22) | `crm_list_sales_leads` | app-inline SQL |
| `get_pipeline_overview` (20) | `crm_pipeline_overview` | app-inline SQL |
| `get_relevant_lessons` (4) | `crm_relevant_lessons` | app-inline SQL |

This is a **second implementation of deal RBAC** and a **second write path into
`deals`** — the exact thing Phase 5 set out to eliminate when it thinned
`/api/mcp` to a kernel proxy. That work routed 7 tools and stopped. Concretely:
those 24 deals were created without a kernel audit row and without touching the
gate machinery, and `get_deal`'s visibility rule is maintained twice, in two
languages, free to drift.

**So the rename is not cosmetic — it retires the duplicates.** Expose the kernel
namespace, delete the app-inline twins, and MCP gains one behaviour, one RBAC
implementation, and one audit trail shared with Telegram and web chat.

**Consequence:** deleting the aliases also deletes the argument-reshaping shims
(`new_gate` → `gate`, `type` → `type_`). Those existed only to preserve legacy MCP
argument names; a client calling `crm_advance_gate` reads the kernel's own schema
and sends `gate` directly.

**What Amir and Mateo actually have to do: almost nothing.** MCP clients discover
tools via `tools/list` at connect time — tool names are not in their config. The
token and URL are unchanged, so a reconnect is enough. Only something that names
tools in *text* needs an edit: saved prompts, or the pmi.zeami.io integration if
it references tools by name.

## 4. Integration — how MCP and the ring actually talk

The channel already exists and is proven in production; this plan adds one
message type to it.

```
Claude Desktop
  │  JSON-RPC over HTTPS, Authorization: Bearer <token>
  ▼
app/api/mcp/route.ts          ── authenticates, audits, dispatches
  │  lib/mcp/auth.ts: SHA-256 → mcp_tokens → { user_id, is_admin, token_id }
  ▼
lib/mcp/tool-dispatch.ts      ── admin gate → read_only gate → per-tool rate limit
  │  kernelCall(tool, args, ctx.user_id)
  ▼
execFile(venv python -m salesbrain_hermes.rpc)
  │  request base64 in $SALESBRAIN_RPC_REQUEST (env, never argv — invisible to `ps`)
  ▼
ring handler  →  resolve_actor  →  salesbrain_core command  →  deliver_events
  │  JSON on stdout
  ▼
back up the same path
```

**Identity — verified this session, and it settles the safety question.** An MCP
token is user-scoped exactly like a Telegram link: `mcp_tokens.user_id` exists,
the token is minted from a logged-in session, and `dispatchTool` passes
`ctx.user_id` into `kernelCall`. The kernel therefore sees a real actor, and **all
RBAC, policy, quiet hours, frequency caps and audit apply unchanged**. I earlier
called an MCP token a weaker identity than a Telegram link — it is not.

One asymmetry is worth keeping in mind: the ring **elevates** board-group Telegram
users to admin (`_actor_board_elevate`). MCP has no board group and no elevation
path, so an MCP caller gets exactly their own role. That is the safer default and
requires no work — but it means a board member who can see the whole pipeline in
the board chat will see only their own deals over MCP. Expected, not a bug.

**Response shape.** Kernel-routed tools return the *kernel's* shape, not the
legacy MCP shape — a contract change already absorbed once when `/api/mcp` was
thinned to a proxy. Every newly exposed tool is kernel-shaped from day one, so
there is nothing to migrate; only the 7 legacy aliases carry the older shape.

**Failure modes to handle explicitly:**

| Failure | Current behaviour | Needed |
|---|---|---|
| `catalog()` subprocess fails | n/a (new) | serve app-only tools, log, health flag |
| Kernel returns `{error}` | `kernelCall` throws → `{status:'error'}` | unchanged, already correct |
| Subprocess timeout (30s) | throws | fine; note LinkedIn/research tools are the slow ones |
| Unknown tool name | `Unknown tool: X` | unchanged |

**Cost.** One process spawn per tool call is the existing design, chosen
deliberately for the memory-tight box (zero idle RAM). 70 tools does not change
that. What *would* change it is calling `catalog()` per request instead of per
process — hence the cache.

## 5. Keeping it in sync forever — the part that matters

**The mechanism: a required field, enforced by a test.**

1. Every entry in every `TOOLS` list must have an `mcp` key. A ring test asserts
   this across all five modules. **A new tool without an explicit decision fails
   CI** — the author is forced to answer "should this be on MCP?" while they still
   have the context to answer it well.
2. `catalog()` filters on that key, so a tool marked `mcp="read"` is live on MCP
   the moment the ring deploys. No app change, no regeneration, no second file.
3. Because the app reads the catalogue from the **deployed** ring at runtime, the
   two surfaces cannot drift. Drift stops being something to police and becomes
   structurally impossible.

**The default for the `mcp` key should be "no decision" — never a working
default.** If a missing key silently meant `"read"`, every future tool would be
exposed by accident; if it silently meant `None`, we would be back to today's
drift, just quieter. Requiring the key is what makes the judgment happen.

**What earns `mcp=None`:**

- **Send tools** — `crm_linkedin_send`, `crm_send_outreach`, `crm_send_followup`.
  Not because MCP's identity is weaker (it isn't), but because MCP has **no
  conversational approval step**. On Telegram you see the draft and say "send";
  over MCP a client can call send directly. The kernel still enforces caps, quiet
  hours and the commercial gate, but *"a human read the exact words first"* is a
  property of the Telegram flow, not of the kernel. Read and draft tools —
  including all the LinkedIn ones — are fine.
- **Tools whose output only makes sense in a chat transport** — anything that
  exists to post to the board group or a Telegram DM.

Belt and braces: alongside the per-tool key, keep a **deny-by-pattern** guard
(`*_send`, `send_*`) applied when building the catalogue. If someone marks a new
send tool `mcp="write"` without thinking, the pattern still catches it. Pattern
first, explicit key second — the tool must pass both.

## 6. Files

**Ring** (`salesbrain-hermes`)
- `tools/{deals,people,outreach,linkedin,prospecting}.py` — add `mcp=` to all 70
- `rpc.py` — `catalog()` + `__catalog__` request handling; include `crm_ping`
- `tests/` — assert every tool declares `mcp`; assert no `*_send` is exposed

**App** (`salesbrain`)
- `lib/mcp/tool-definitions.ts` — app-only tools + runtime ring catalogue, cached
- `lib/mcp/tool-dispatch.ts` — generic `crm_*` fallthrough; aliases unlisted but live
- `lib/mcp/auth.ts` — `PER_TOOL_LIMITS` defaults for the newly exposed names
- `app/api/mcp/route.ts` — catalogue-fetch failure handling; the header comment
  still says "the 19-tool catalog"
- `docs/mcp-integration.md` — stop enumerating tools; point at `tools/list`

## 7. Risks

- **A generated catalogue can advertise something unintended.** Mitigated twice
  over (§5), but this is the failure that matters most: it is the difference
  between a client that can read your pipeline and one that can message your
  prospects. Both guards, plus a test.
- **Mateo's daily workflow is the thing at risk.** ~530 calls, still running
  today; MCP is how he works. Names change with no alias by decision, and a
  reconnect covers it — but the *behaviour* changes too, because six tools move
  from app-inline SQL to their kernel twins. Diff each replacement against the
  app version before deleting it: `crm_list_my_deals` and `list_deals` may filter
  or order differently, and he would feel that immediately. Tell him before the
  switch, not after.
- **`tools/list` payload size.** 70 tools with full descriptions is a large block
  of client context. Check what Claude Desktop does with it. If it is too much,
  the answer is grouping or a filter parameter — *not* going back to hand-curation.
- **A catalogue fetch failure degrades the whole surface**, where today the list
  is static and cannot fail. Hence the fallback + health flag.
- **`mcp=` on 70 tools is 70 judgment calls in one pass.** Do it per module, not
  in one commit, and default to `None` wherever unsure — under-exposing is
  recoverable in one line; over-exposing a send tool is not.

## 8. Sequencing

Ship in three steps, each independently useful and independently revertible:

1. **Ring: declaration + catalog.** Add `mcp=` to all 70, add `catalog()`, add the
   CI tests. Nothing changes for any consumer — MCP is not reading it yet.
2. **App: consume the catalogue.** Fallthrough dispatch, cached catalogue,
   fallback behaviour. This is the step where the 47 tools go live.
3. **Retire the duplicates.** Delete the 6 app-inline twins and the ~7 reshaping
   shims; keep only the genuinely app-only tools (`get_memories`, `remember`,
   `forget`, `send_email`). Fix the docs and the stale "19-tool catalog" comment
   in the route header. **Do this only after step 2 is confirmed working for
   Mateo** — it is the irreversible step, and it is where a behaviour difference
   between an app-inline tool and its kernel twin would surface.

## 9. Verification

- `tools/list` returns the ring's exposed tools plus the app-only tools, and
  every advertised name dispatches successfully — no advertised-but-broken entry.
- **Identity proven, not assumed:** a read tool called with a non-admin token
  returns only that user's data. Test with Mateo's scope, not an admin's, or the
  test proves nothing.
- Every `*_send` tool is absent from `tools/list` **and** refused when called
  directly by name.
- A tool declared without `mcp=` fails ring CI (assert the guard actually bites —
  write the failing case).
- **Each of Mateo's 15 tools has a working replacement**, checked one by one
  against `mcp_audit_log` — that list is the real acceptance test, not the
  70-tool count. For the 6 duplicates, compare kernel output against the
  app-inline output on the same deal before deleting anything.
- `create_deal` via `crm_create_deal` now writes a kernel audit row, which the
  app-inline path never did — confirm in `agent_audit_log`.
- Kill the catalogue subprocess and confirm `tools/list` degrades to app-only
  rather than empty.
- Live smoke from an actual MCP client, not just curl — payload size and tool
  selection behaviour only show up there.
