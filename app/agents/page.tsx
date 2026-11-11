import { redirect } from 'next/navigation';

/** Moved into Settings (2026-11-11). Kept as a redirect so existing links and bookmarks keep working. */
export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams({ section: 'agents' });
  for (const [key, v] of Object.entries(searchParams)) if (typeof v === 'string' && key !== 'section') q.set(key, v);
  redirect(`/settings?${q.toString()}`);
}
