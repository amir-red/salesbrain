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
  role?: string;
}

async function getSessionInfo(): Promise<{ userId: string; isAdmin: boolean } | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get('salesbrain_session');
  if (!cookie?.value) return null;
  try {
    const session = await unsealData<SessionData>(cookie.value, {
      password: process.env.SESSION_SECRET!,
    });
    if (!session.userId) return null;
    return { userId: session.userId, isAdmin: session.role === 'admin' };
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

// Grant pipeline gate colors (10 gates) — board gates G3 + G7 + G9 purple, final G10 green
const GRANT_GATE_COLORS: Record<number, string> = {
  1: '#1D4ED8', 2: '#1D4ED8',
  3: '#6D28D9',  // ← NEW: board gate
  4: '#1D4ED8',
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

// ─── Aggregates ─────────────────────────────────────────────────

interface PipelineSummary {
  active_count: number;
  active_value_by_currency: Record<string, number>; // e.g. { USD: 1500000, EUR: 30000 }
  weighted_value_by_currency: Record<string, number>; // value × score/100, for deals with score
  won_count: number;
  won_value_by_currency: Record<string, number>;
  board_pending_count: number;
  overdue_count: number;
}

function summarize(deals: DealRow[], gates: typeof SALES_GATES): PipelineSummary {
  const finalGate = gates[gates.length - 1].number;
  const summary: PipelineSummary = {
    active_count: 0,
    active_value_by_currency: {},
    weighted_value_by_currency: {},
    won_count: 0,
    won_value_by_currency: {},
    board_pending_count: 0,
    overdue_count: 0,
  };

  const boardGateNumbers = new Set(gates.filter((g) => g.isBoard).map((g) => g.number));

  for (const d of deals) {
    const value = d.value ? Number(d.value) : 0;
    const currency = d.currency || 'USD';
    const days = Math.floor(Number(d.days_in_gate_raw));
    const slaDays = gates.find((g) => g.number === d.gate)?.slaDays || 0;
    const isWon = d.gate === finalGate;

    if (isWon) {
      summary.won_count++;
      summary.won_value_by_currency[currency] = (summary.won_value_by_currency[currency] || 0) + value;
    } else {
      summary.active_count++;
      summary.active_value_by_currency[currency] = (summary.active_value_by_currency[currency] || 0) + value;

      // Weighted pipeline: value × (score/100) — only count deals with a score
      if (d.score !== null && d.score !== undefined) {
        summary.weighted_value_by_currency[currency] =
          (summary.weighted_value_by_currency[currency] || 0) + value * (Number(d.score) / 100);
      }

      if (boardGateNumbers.has(d.gate)) summary.board_pending_count++;
      if (slaDays > 0 && days > slaDays) summary.overdue_count++;
    }
  }

  return summary;
}

function formatMoney(byCurrency: Record<string, number>): string {
  const entries = Object.entries(byCurrency).filter(([, v]) => v > 0);
  if (entries.length === 0) return '—';
  // Show dominant currency first; if multiple, append the rest with their codes
  entries.sort((a, b) => b[1] - a[1]);
  const formatted = entries.map(([cur, val]) => {
    const display = val >= 1_000_000
      ? `${(val / 1_000_000).toFixed(2)}M`
      : val >= 1_000
        ? `${Math.round(val / 1_000)}K`
        : Math.round(val).toLocaleString();
    return `${cur} ${display}`;
  });
  return formatted.join(' · ');
}

// ─── Page ───────────────────────────────────────────────────────

export default async function PipelinePage() {
  const sessionInfo = await getSessionInfo();
  if (!sessionInfo) return null;
  const { userId } = sessionInfo;

  // Pipeline view is intentionally org-wide so the whole team can see where
  // everyone is at. Per-user filtering ("My deals") is handled client-side
  // in FilterBar via the currentUserId prop. Detail page (`/deals/[id]`) is
  // also org-wide so any card on the kanban stays clickable.
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

  const salesSummary = summarize(salesDeals, SALES_GATES);
  const grantSummary = summarize(grantDeals, GRANT_GATES);

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

        {/* Pipeline value overview */}
        <div className="p-4 grid grid-cols-2 gap-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <SummaryCard
            label="Sales Pipeline"
            accent="var(--accent)"
            summary={salesSummary}
          />
          <SummaryCard
            label="Grants Pipeline"
            accent="var(--green)"
            summary={grantSummary}
          />
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

function SummaryCard({ label, accent, summary }: { label: string; accent: string; summary: PipelineSummary }) {
  const activeMoney = formatMoney(summary.active_value_by_currency);
  const weightedMoney = formatMoney(summary.weighted_value_by_currency);
  const wonMoney = formatMoney(summary.won_value_by_currency);

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: `3px solid ${accent}` }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: `${accent}20`, color: accent }}>
          {summary.active_count} active
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total in play" value={activeMoney} highlight />
        <Stat label="Weighted (×score)" value={weightedMoney} hint="Sum of value × score/100 for scored deals" />
        <Stat
          label="Won"
          value={wonMoney}
          sub={summary.won_count > 0 ? `${summary.won_count} closed` : undefined}
        />
      </div>

      {(summary.board_pending_count > 0 || summary.overdue_count > 0) && (
        <div className="mt-3 flex gap-3 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {summary.board_pending_count > 0 && (
            <span>
              <span style={{ color: '#a78bfa', fontWeight: 600 }}>{summary.board_pending_count}</span> board pending
            </span>
          )}
          {summary.overdue_count > 0 && (
            <span>
              <span style={{ color: 'var(--red)', fontWeight: 600 }}>{summary.overdue_count}</span> overdue SLA
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, hint, highlight }: { label: string; value: string; sub?: string; hint?: string; highlight?: boolean }) {
  return (
    <div title={hint}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p
        className="font-bold mt-0.5"
        style={{ fontSize: highlight ? '1.1rem' : '0.95rem', color: 'var(--text)' }}
      >
        {value}
      </p>
      {sub && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}
