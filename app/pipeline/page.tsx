import pool from '@/lib/db';
import { GATES } from '@/lib/gates';
import Sidebar from '@/components/Sidebar';
import FilterBar from './FilterBar';
import { cookies } from 'next/headers';
import { unsealData } from 'iron-session';

interface SessionData {
  userId: string;
  email: string;
  name: string;
}

async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get('salesbrain_session');
  if (!cookie?.value) return null;
  try {
    const session = await unsealData<SessionData>(cookie.value, {
      password: process.env.SESSION_SECRET!,
    });
    return session.userId || null;
  } catch {
    return null;
  }
}

const GATE_COLORS: Record<number, string> = {
  1: '#1D4ED8', 2: '#1D4ED8',
  3: '#6D28D9', 4: '#1D4ED8',
  5: '#6D28D9', 6: '#1D4ED8',
  7: '#1D4ED8', 8: '#1D4ED8',
  9: '#166534',
};

export default async function PipelinePage() {
  const userId = await getUserId();
  if (!userId) return null;

  const { rows: deals } = await pool.query(
    `SELECT id, name, company, gate, score, risk, value, currency, owner, gate_entered_at,
     EXTRACT(EPOCH FROM (now() - gate_entered_at))/86400 as days_in_gate_raw
     FROM deals WHERE user_id = $1
     ORDER BY gate, score DESC NULLS LAST`,
    [userId]
  );

  const gateData = GATES.map((g) => {
    const gateDeals = deals
      .filter((d) => d.gate === g.number)
      .map((d) => ({
        id: d.id,
        name: d.name,
        company: d.company,
        gate: d.gate,
        score: d.score,
        risk: d.risk,
        value: d.value,
        currency: d.currency || 'USD',
        owner: d.owner,
        gate_entered_at: d.gate_entered_at,
        days_in_gate: Math.floor(Number(d.days_in_gate_raw)),
        sla_days: g.slaDays,
        is_overdue: Math.floor(Number(d.days_in_gate_raw)) > g.slaDays,
        is_board: g.isBoard,
      }));

    return {
      number: g.number,
      name: g.name,
      color: GATE_COLORS[g.number],
      deals: gateDeals,
    };
  });

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-hidden">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Pipeline Board</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {deals.length} deal{deals.length !== 1 ? 's' : ''} across {GATES.length} gates
          </p>
        </div>
        <div className="p-4 overflow-x-auto h-full">
          <FilterBar gates={gateData} />
        </div>
      </div>
    </div>
  );
}
