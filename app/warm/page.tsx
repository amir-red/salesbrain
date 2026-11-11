import { redirect } from 'next/navigation';

/** Warm people moved to the Dashboard's "Warm, nobody on it" section (2026-11-11). Old links keep their teammate. */
export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const owner = typeof searchParams.owner === 'string' ? searchParams.owner : '';
  redirect(`/dashboard${owner ? `?owner=${encodeURIComponent(owner)}` : ''}#warm`);
}
