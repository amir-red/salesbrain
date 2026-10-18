/** One person per company (core 071): a first message to a second person at a firm the team already messaged
 *  is held unless the owner explicitly chooses "Send anyway". */
export interface CompanyConflict { company: string; others: { name: string; when?: string | null }[]; warning: string }

export function isHeld(ap: { company_conflict?: CompanyConflict | null; company_override_at?: string | null }): boolean {
  return !!ap.company_conflict && !ap.company_override_at;
}
