import Link from 'next/link';
import { redirect } from 'next/navigation';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';

/**
 * /person/<person id> — opens a person's profile (/prospects/<id>). Replaces the People dossier page (/relationships,
 * retired 2026-11-11): links that only know a person id (Network, the Dashboard's warm list, old bookmarks) land here.
 * Picks the person's prospect row — the viewer's own first, then a live one, then the best fit, then the newest —
 * matched by person id or through their contact. Prospect profiles are readable by every teammate.
 */
export default async function PersonPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const id = params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/network');

  const { rows } = await pool.query(
    `SELECT p.id
       FROM prospects p
      WHERE p.person_id = $1
         OR p.contact_id IN (SELECT c.id FROM contacts c WHERE c.person_id = $1)
      ORDER BY (p.owner_user_id = $2) DESC, (p.stage <> 'P9_ARCHIVED') DESC,
               p.icp_score DESC NULLS LAST, p.created_at DESC
      LIMIT 1`,
    [id, session.userId],
  );
  if (rows[0]) redirect(`/prospects/${rows[0].id}`);

  const person = await pool.query(`SELECT full_name FROM people WHERE id = $1`, [id]);
  const name = (person.rows[0]?.full_name as string | undefined) || 'This person';
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="z-panel p-6 max-w-xl space-y-2">
          <h1 className="text-lg font-bold">{name}</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {name} is not a lead or prospect yet, so there is no profile.
            Add them from <Link href="/dashboard#warm" className="underline">Warm, nobody on it</Link> on the Dashboard or put them on a list.
          </p>
          <p className="text-sm"><Link href="/network" className="underline" style={{ color: 'var(--accent)' }}>← Network</Link></p>
        </div>
      </div>
    </div>
  );
}
