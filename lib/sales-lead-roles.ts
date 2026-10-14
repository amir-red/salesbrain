/**
 * Server-side hook for the PUBLIC lead routes (zeami.io form, Calendly): a
 * lead landed or a demo got booked → the kernel fills the default back /
 * front office, writes the track-record line and DMs the roles
 * (`sales_lead_landed`, an app-only RPC; delivery = owner's DM or nothing).
 *
 * Fire-and-forget: the row is already persisted, a ring hiccup must never
 * fail the public request. Runs as the SERVICE actor — no session on these
 * routes.
 */
import { kernelCall } from '@/lib/mcp/kernel-rpc';

export const SERVICE_USER_ID = '00000000-0000-0000-0000-000000000000';

export function leadLanded(leadId: string, event: 'landed' | 'booked'): void {
  void kernelCall('sales_lead_landed', { lead_id: leadId, event }, SERVICE_USER_ID)
    .then((out) => {
      if (out?.error) console.warn(`[lead-roles] ${event} ${leadId}: ${String(out.error)}`);
    })
    .catch((err) => console.warn(`[lead-roles] ${event} ${leadId} failed:`, err instanceof Error ? err.message : err));
}
