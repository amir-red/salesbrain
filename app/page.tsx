import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Home = the Dashboard (Amir, 2026-11-04). Opportunities moved to /opportunities; an old link with a query
 * (`/?deal=…`, `/?view=pipeline`, `/?status=won`, …) still lands on Opportunities with the same query.
 */
export default function Home({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one);
  }
  redirect(q.toString() ? `/opportunities?${q}` : '/dashboard');
}
