import { redirect } from 'next/navigation';

// Retired 2026-10-24: Clients was deals grouped by company name, everything on it is on Deals and Pipeline.
export default function ClientsPage() {
  redirect('/pipeline');
}
