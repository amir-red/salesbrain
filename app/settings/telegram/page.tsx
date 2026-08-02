import { redirect } from 'next/navigation';

/** Moved into the Profile page as a tab (2026-07-31). Kept as a redirect so
 *  existing links, bookmarks and the user guide keep working. */
export default function Page() {
  redirect('/profile?tab=telegram');
}
