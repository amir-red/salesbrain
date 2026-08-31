/**
 * Employee → SalesBrain user mapping for the outreach-as-a-service surface.
 *
 * The kernel is multi-tenant on owner_user_id (a users.id) and has NO org/
 * tenant layer, so the established grain is one SalesBrain users row per
 * external employee. The sibling app registers each employee up front
 * (register_user), and every later request carries that employee_id.
 *
 * Provisioned users are un-loginable by password — we store the same sentinel
 * hash the service account uses (salesbrain-core migration 022), so they exist
 * for FK/audit/ownership purposes but can never log into the web app.
 */

import pool from '../db';

// Same sentinel migration 022 uses: not a valid bcrypt digest, so
// bcrypt.compare() always fails and the row can never authenticate.
const NO_LOGIN_HASH = 'service-account-no-login';

/** Deterministic, namespaced, non-routable email for a provisioned employee. */
function serviceEmail(appKey: string, employeeId: string): string {
  const slug = employeeId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return `${slug}@${appKey}.service.salesbrain`;
}

export interface RegisterResult {
  salesbrain_user_id: string;
  created: boolean;
}

/**
 * Register (or idempotently re-register) an employee. Provisions a SalesBrain
 * user on first sight and stores the mapping; on repeat, refreshes name/email
 * and last_seen_at. Returns the mapped user id.
 */
export async function registerEmployee(
  appKey: string,
  employeeId: string,
  opts: { name?: string; email?: string } = {},
): Promise<RegisterResult> {
  const emp = (employeeId ?? '').trim();
  if (!emp) throw new Error('employee_id is required');
  if (emp.length > 200) throw new Error('employee_id too long (max 200 chars)');

  const existing = await pool.query<{ salesbrain_user_id: string }>(
    `SELECT salesbrain_user_id FROM external_employees WHERE app_key = $1 AND employee_id = $2`,
    [appKey, emp],
  );
  if (existing.rows.length) {
    await pool.query(
      `UPDATE external_employees
       SET display_name = COALESCE($3, display_name),
           email = COALESCE($4, email),
           last_seen_at = now()
       WHERE app_key = $1 AND employee_id = $2`,
      [appKey, emp, opts.name ?? null, opts.email ?? null],
    );
    return { salesbrain_user_id: existing.rows[0].salesbrain_user_id, created: false };
  }

  // Provision a fresh, un-loginable user, then map it. Two statements rather
  // than a CTE so a mid-way unique-email collision surfaces as a clear error.
  const displayName = (opts.name ?? '').trim() || `${appKey}:${emp}`;
  const email = (opts.email ?? '').trim() || serviceEmail(appKey, emp);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'user')
     RETURNING id`,
    [displayName, email, NO_LOGIN_HASH],
  );
  const userId = inserted.rows[0].id;
  await pool.query(
    `INSERT INTO external_employees (app_key, employee_id, salesbrain_user_id, display_name, email, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [appKey, emp, userId, displayName, email],
  );
  return { salesbrain_user_id: userId, created: true };
}

/**
 * Resolve a registered employee to its SalesBrain user id. Throws if the
 * employee was never registered — the contract is register-then-use, so we
 * never silently provision on a bare tools/call.
 */
export async function resolveOwner(appKey: string, employeeId: string): Promise<string> {
  const emp = (employeeId ?? '').trim();
  if (!emp) throw new Error('missing employee id (X-On-Behalf-Of)');
  const { rows } = await pool.query<{ salesbrain_user_id: string }>(
    `UPDATE external_employees SET last_seen_at = now()
     WHERE app_key = $1 AND employee_id = $2
     RETURNING salesbrain_user_id`,
    [appKey, emp],
  );
  if (!rows.length) {
    throw new Error(`employee '${emp}' is not registered — call register_user first`);
  }
  return rows[0].salesbrain_user_id;
}
