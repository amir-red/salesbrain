import { redirect } from 'next/navigation';

/** The People dossier page was retired on 2026-11-11; a person's profile is /prospects/<id>. Old links land there. */
export default function Page({ searchParams }: { searchParams: { person?: string } }) {
  redirect(searchParams.person ? `/person/${encodeURIComponent(searchParams.person)}` : '/network');
}
