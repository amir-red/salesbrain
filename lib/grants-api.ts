/**
 * Grant Stage-2 API helper — invokes salesbrain-core kernel commands via the
 * existing `kernelCall` subprocess RPC. Every route under
 * `app/api/grants/*` and `app/api/deals/[id]/{sign,mark-won,mark-cancelled}`
 * uses this so the app never re-implements RBAC / audit / event emission
 * (all live in the kernel).
 *
 * Handler shape mirrors what dispatchTool does for MCP calls: unwrap the
 * kernel's `{ error }` into a Response, forward everything else as JSON. We
 * do NOT process kernel `events[]` here — those side-effects (Telegram
 * notifications) are the ring's job via `deliver.py`, and they fire when
 * the ring calls the same command over its own path. Web-originated calls
 * skip Telegram notifications by design (the user is already looking at
 * the UI; no need to also DM them).
 */

import { NextResponse } from 'next/server';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

export type SessionLike = { userId: string; role?: string };

/**
 * Call a kernel `crm_grant_*` (or `sign_grant_agreement`, `mark_grant_won`,
 * `mark_deal_cancelled`) command as the acting user, and shape the result
 * into a Next.js JSON response. Kernel-level errors (`{ error: '...' }`) come
 * back as 400 with the message; blocked-by-policy responses (`{ blocked: true }`)
 * come back as 409 so the UI can distinguish "wrong input" from "not yet".
 */
export async function callGrantTool(
  session: SessionLike,
  tool: string,
  args: Record<string, unknown>,
): Promise<Response> {
  try {
    const result = await kernelCall(tool, args, session.userId);
    // Drop the `events[]` before returning — those are Telegram-delivery
    // requests, meaningless to the web UI, and can carry chat ids the
    // browser has no business seeing.
    if (result && Array.isArray((result as Record<string, unknown>).events)) {
      delete (result as Record<string, unknown>).events;
    }
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Kernel blockers (grant_close_check, already-signed, wrong deal type)
    // arrive as thrown errors from kernelCall (it turns `{error}` into throw).
    // The kernel error strings usually start with "BLOCKED" or "Cannot" or
    // "This command is grant-only" — treat those as 409.
    const status = /BLOCKED|Cannot|grant-only|Already|not visible/i.test(msg) ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
