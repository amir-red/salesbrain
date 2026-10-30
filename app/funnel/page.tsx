import { redirect } from 'next/navigation';

/** /funnel became /dashboard (2026-10-28). Old links keep their list / teammate / lane / view; the old period keys
 * (7d, 30d, …) are dropped because the dashboard's periods are Today / Week / Month / Quarter. */
export default function FunnelRedirect({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams();
  for (const k of ['icp_id', 'owner', 'lane', 'view']) {
    const v = searchParams[k];
    if (typeof v === 'string' && v) q.set(k, v);
  }
  redirect(`/dashboard${q.toString() ? `?${q}` : ''}`);
}
