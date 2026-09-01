/**
 * On-demand kernel RPC — the /api/mcp deal/board tools execute salesbrain-core
 * kernel commands (the single source of truth for gate logic, RBAC, and audit)
 * by spawning the ring's RPC entrypoint once per call. The Next app can't
 * import the Python kernel in-process; a per-call subprocess keeps zero idle
 * RAM on the memory-tight box. This is a runtime-only cross-surface call — no
 * source is shared between the app and the Hermes repos.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const RPC_PYTHON =
  process.env.HERMES_VENV_PYTHON || '/usr/local/lib/hermes-agent/venv/bin/python';

/** Sentinel tool name that returns the ring's MCP catalogue. See rpc.catalog(). */
const CATALOG_REQUEST = '__catalog__';

/** One tool as the ring advertises it — the shape `catalog()` returns. */
export interface RingToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  access: 'read' | 'write' | 'admin';
}

/**
 * Invoke a kernel `crm_*` tool as the acting user. Returns the parsed result.
 * Throws if the kernel returned an `{ error }` — dispatchTool's try/catch maps
 * that to a clean `{ status: 'error' }`, same as the old executor path.
 */
export async function kernelCall(
  tool: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<Record<string, unknown>> {
  return rpc({ tool, args, actor_user_id: userId }, tool);
}

/**
 * Fetch the tool catalogue the ring advertises over MCP.
 *
 * This is what keeps `/api/mcp` and the ring from drifting: the app holds no
 * copy of the `crm_*` tool list, it asks the deployed ring what it has. A tool
 * added to the ring is live on MCP with no app change at all.
 *
 * Takes no actor — the catalogue is identical for every caller and touches no
 * data. Access is enforced per call, from the `access` field each entry
 * carries, and again by the kernel when the tool actually runs.
 */
export async function fetchRingCatalog(): Promise<RingToolDef[]> {
  const parsed = await rpc({ tool: CATALOG_REQUEST }, 'catalog');
  const tools = parsed.tools;
  if (!Array.isArray(tools)) {
    throw new Error(`kernel catalogue returned no tools array: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return tools as RingToolDef[];
}

// Tools that reach LinkedIn/Unipile and/or an LLM per invocation and can run
// well past the default ceiling — a Leads Finder step searches a page THEN
// researches the top N (profile fetches + a model call each). The background
// timer isn't subprocess-bounded; these app/MCP-driven calls are, so give them
// real headroom or they get SIGKILLed mid-research (run left stuck 'running').
const LONG_RUNNING_TOOLS = new Set<string>([
  'crm_leads_finder_run',
  'crm_enrich_prospect',
  'crm_prospect_search',
  'crm_research_company',
  'crm_prospect_auto_qualify',
  'crm_icp_rescore',
]);

async function rpc(
  request: Record<string, unknown>,
  label: string,
): Promise<Record<string, unknown>> {
  const encoded = Buffer.from(JSON.stringify(request)).toString('base64');
  const tool = typeof request.tool === 'string' ? request.tool : '';
  const timeoutMs = LONG_RUNNING_TOOLS.has(tool) ? 180_000 : 30_000;

  let stdout: string;
  try {
    const res = await execFileAsync(RPC_PYTHON, ['-m', 'salesbrain_hermes.rpc'], {
      // Pass the request via env (not argv) so it never shows up in `ps`.
      env: { ...process.env, SALESBRAIN_RPC_REQUEST: encoded },
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err) {
    // Surface WHAT actually happened — a plain "Command failed" hides timeouts
    // (SIGKILL at the ceiling) and Python tracebacks written to stderr.
    const e = err as { message?: string; killed?: boolean; signal?: string; stderr?: string };
    const killed = e?.killed || e?.signal === 'SIGTERM' || e?.signal === 'SIGKILL';
    const reason = killed ? ` (killed after ${Math.round(timeoutMs / 1000)}s — likely timeout)` : '';
    const stderr = e?.stderr ? ` — ${String(e.stderr).slice(0, 400)}` : '';
    throw new Error(
      `kernel RPC failed for ${label}: ${e?.message || String(err)}${reason}${stderr}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`kernel RPC returned non-JSON for ${label}: ${stdout.slice(0, 200)}`);
  }
  if (parsed && typeof parsed.error === 'string') {
    throw new Error(parsed.error);
  }
  return parsed;
}
