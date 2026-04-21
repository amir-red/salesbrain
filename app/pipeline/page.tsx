import pool from '@/lib/db';
import { SALES_GATES, GRANT_GATES } from '@/lib/gates';
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

// Sales pipeline gate colors (9 gates)
const SALES_GATE_COLORS: Record<number, string> = {
  1: '#1D4ED8', 2: '#1D4ED8',
  3: '#6D28D9', 4: '#1D4ED8',
  5: '#6D28D9', 6: '#1D4ED8',
  7: '#1D4ED8', 8: '#1D4ED8',
  9: '#166534',
};

// Grant pipeline gate colors (10 gates) — board gates G7 + G9 purple, final G10 green
const GRANT_GATE_COLORS: Record<number, string> = {
  1: '#1D4ED8', 2: '#1D4ED8',
  3: '#1D4ED8', 4: '#1D4ED8',
  5: '#1D4ED8', 6: '#1D4ED8',
  7: '#6D28D9', 8: '#1D4ED8',
  9: '#6D28D9',
  10: '#166534',
};

interface DealRow {
  id: string;
  name: string;
  company: string;
  gate: number;
  score: number | null;
  risk: string | null;
  value: string | null;
  currency: string | null;
  owner: string | null;
  lead_id: string | null;
  lead_name: string | null;
  gate_entered_at: string;
  deal_type: 'sales' | 'grant';
  days_in_gate_raw: string;
}

function buildGateData(deals: DealRow[], gates: typeof SALES_GATES, colors: Record<number, string>) {
  return gates.map((g) => {
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
        lead_id: d.lead_id,
        lead_name: d.lead_name,
        gate_entered_at: d.gate_entered_at,
        days_in_gate: Math.floor(Number(d.days_in_gate_raw)),
        sla_days: g.slaDays,
        is_overdue: Math.floor(Number(d.days_in_gate_raw)) > g.slaDays,
        is_board: g.isBoard,
      }));

    return {
      number: g.number,
      name: g.name,
      color: colors[g.number] || '#1D4ED8',
      deals: gateDeals,
    };
  });
}

export default async function PipelinePage() {
  const userId = await getUserId();
  if (!userId) return null;

  // Pipeline is org-wide — all deals visible to everyone
  const { rows: deals } = await pool.query<DealRow>(
    `SELECT d.id, d.name, d.company, d.gate, d.score, d.risk, d.value, d.currency,
     d.owner, d.gate_entered_at, d.lead_id, d.deal_type,
     u.name as lead_name,
     EXTRACT(EPOCH FROM (now() - d.gate_entered_at))/86400 as days_in_gate_raw
     FROM deals d
     LEFT JOIN users u ON u.id = d.lead_id
     ORDER BY d.gate, d.score DESC NULLS LAST`
  );

  const salesDeals = deals.filter((d) => d.deal_type !== 'grant');
  const grantDeals = deals.filter((d) => d.deal_type === 'grant');

  const salesGateData = buildGateData(salesDeals, SALES_GATES, SALES_GATE_COLORS);
  const grantGateData = buildGateData(grantDeals, GRANT_GATES, GRANT_GATE_COLORS);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Pipeline Board</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {salesDeals.length} sales · {grantDeals.length} grants
          </p>
        </div>
        <div className="p-4 overflow-x-auto flex-1">
          <FilterBar
            salesGates={salesGateData}
            grantGates={grantGateData}
            currentUserId={userId}
          />
        </div>
      </div>
    </div>
  );
}
