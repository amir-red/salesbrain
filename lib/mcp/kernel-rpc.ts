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
  const request = Buffer.from(
    JSON.stringify({ tool, args, actor_user_id: userId }),
  ).toString('base64');

  let stdout: string;
  try {
    const res = await execFileAsync(RPC_PYTHON, ['-m', 'salesbrain_hermes.rpc'], {
      // Pass the request via env (not argv) so it never shows up in `ps`.
      env: { ...process.env, SALESBRAIN_RPC_REQUEST: request },
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err) {
    throw new Error(
      `kernel RPC failed for ${tool}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`kernel RPC returned non-JSON for ${tool}: ${stdout.slice(0, 200)}`);
  }
  if (parsed && typeof parsed.error === 'string') {
    throw new Error(parsed.error);
  }
  return parsed;
}
