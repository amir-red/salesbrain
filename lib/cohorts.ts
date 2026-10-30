/**
 * Mateo's cohorts (2026-10-28), as the app shows them. Mirrors salesbrain-core policy/cohorts.py (COHORTS, SIGNALS);
 * test_cohorts_parity.py keeps the keys and labels in step — change both.
 */
export interface CohortInfo {
  key: string; number: number; name: string; characteristics: string; person_to_contact: string;
  kind?: 'customers' | 'investors';
}

export const COHORTS: { key: string; number: number; name: string }[] = [
  { key: 'distributors', number: 1, name: 'Specialty B2B distributors' },
  { key: 'freight_forwarders', number: 2, name: 'Independent freight forwarders / brokers' },
  { key: 'admin_services', number: 3, name: 'Recurring B2B administration services' },
  { key: 'vertical_software', number: 4, name: 'Vertical software businesses' },
  { key: 'nrw_mittelstand', number: 5, name: "NRW Mittelstand / Matthias's contacts" },
  { key: 'pe_growth', number: 6, name: 'PE-backed growth businesses' },
  { key: 'pe_exit', number: 7, name: 'PE-backed businesses preparing for exit' },
  { key: 'pe_distress', number: 8, name: 'PE-backed distress / turnaround businesses' },
  { key: 'pe_distributors', number: 9, name: 'PE-backed distributors / distribution platforms' },
  { key: 'pe_logistics', number: 10, name: 'PE-backed freight-forwarding / logistics platforms' },
  { key: 'vc_investors', number: 11, name: 'VC investors for Zeami' },
];

export const SIGNAL_LABELS: Record<string, string> = {
  growth: 'growing', acquisitions: 'acquisitions', buy_and_build: 'buy-and-build', pe_backed: 'PE-backed',
  new_management: 'new management', succession: 'succession', manual_admin: 'manual admin work',
  recurring_services: 'recurring services', exit_prep: 'preparing exit', distress: 'turnaround', hiring: 'hiring',
};

export const cohortName = (key: string | null | undefined) =>
  COHORTS.find((c) => c.key === key)?.name ?? (key === 'unsorted' ? 'Unsorted' : key ?? '');
