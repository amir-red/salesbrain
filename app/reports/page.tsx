import pool from '@/lib/db';
import { GATES } from '@/lib/gates';
import Sidebar from '@/components/Sidebar';
import { relativeTime } from '@/lib/time';
import { cookies } from 'next/headers';
import { unsealData } from 'iron-session';

interface SessionData { userId: string; email: string; name: string }

async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get('salesbrain_session');
  if (!cookie?.value) return null;
  try {
    const session = await unsealData<SessionData>(cookie.value, { password: process.env.SESSION_SECRET! });
    return session.userId || null;
  } catch { return null; }
}

const GATE_COLORS: Record<number, string> = {
  1: '#1D4ED8', 2: '#1D4ED8', 3: '#6D28D9', 4: '#1D4ED8',
  5: '#6D28D9', 6: '#1D4ED8', 7: '#1D4ED8', 8: '#1D4ED8', 9: '#166534',
};

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

export default async function ReportsPage() {
  const userId = await getUserId();
  if (!userId) return null;

  // Metric queries
  const [activeRes, valueRes, overdueRes, wonRes, byGateRes, activityRes] = await Promise.all([
    pool.query('SELECT COUNT(*)::int as count FROM deals WHERE gate < 9 AND user_id = $1', [userId]),
    pool.query('SELECT COALESCE(SUM(value), 0)::numeric as total FROM deals WHERE gate < 9 AND user_id = $1', [userId]),
    pool.query(
      `SELECT COUNT(*)::int as count FROM deals
       WHERE gate < 9 AND user_id = $1
       AND EXTRACT(EPOCH FROM (now() - gate_entered_at))/86400 >
         CASE gate
           WHEN 1 THEN 3 WHEN 2 THEN 10 WHEN 3 THEN 5 WHEN 4 THEN 14
           WHEN 5 THEN 5 WHEN 6 THEN 7 WHEN 7 THEN 21 WHEN 8 THEN 3 WHEN 9 THEN 5
         END`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int as count FROM gate_events ge
       JOIN deals d ON d.id = ge.deal_id
       WHERE ge.to_gate = 9 AND d.user_id = $1
       AND ge.created_at >= date_trunc('month', now())`,
      [userId]
    ),
    pool.query(
      `SELECT gate, COUNT(*)::int as count FROM deals
       WHERE user_id = $1 GROUP BY gate ORDER BY gate`,
      [userId]
    ),
    pool.query(
      `SELECT ge.from_gate, ge.to_gate, ge.created_at, d.name as deal_name
       FROM gate_events ge
       JOIN deals d ON d.id = ge.deal_id
       WHERE d.user_id = $1
       ORDER BY ge.created_at DESC LIMIT 10`,
      [userId]
    ),
  ]);

  const activeCount = activeRes.rows[0]?.count || 0;
  const pipelineValue = Number(valueRes.rows[0]?.total || 0);
  const overdueCount = overdueRes.rows[0]?.count || 0;
  const wonCount = wonRes.rows[0]?.count || 0;

  // Bar chart data
  const gateCounts = GATES.map((g) => {
    const row = byGateRes.rows.find((r) => r.gate === g.number);
    return { gate: g.number, name: g.name, count: row?.count || 0 };
  });
  const maxCount = Math.max(...gateCounts.map((g) => g.count), 1);

  const activities: { deal_name: string; from_gate: number; to_gate: number; created_at: string }[] = activityRes.rows;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Reports</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pipeline overview and activity</p>
        </div>

        <div className="p-4 space-y-6">
          {/* Metric cards */}
          <div className="grid grid-cols-4 gap-4">
            <MetricCard label="Active Deals" value={String(activeCount)} />
            <MetricCard label="Pipeline Value" value={`$${pipelineValue.toLocaleString()}`} />
            <MetricCard label="Overdue" value={String(overdueCount)} sub={overdueCount > 0 ? 'Needs attention' : 'All on track'} />
            <MetricCard label="Won This Month" value={String(wonCount)} />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Bar chart */}
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-medium mb-4">Deals by Gate</h2>
              <svg viewBox="0 0 360 160" className="w-full">
                {gateCounts.map((g, i) => {
                  const barHeight = maxCount > 0 ? (g.count / maxCount) * 120 : 0;
                  const x = i * 40;
                  return (
                    <g key={g.gate}>
                      <rect
                        x={x + 5}
                        y={130 - barHeight}
                        width="30"
                        height={barHeight}
                        rx="3"
                        fill={GATE_COLORS[g.gate]}
                        opacity={0.85}
                      />
                      <text x={x + 20} y={145} textAnchor="middle" fill="#8888a0" fontSize="9">
                        G{g.gate}
                      </text>
                      {g.count > 0 && (
                        <text x={x + 20} y={125 - barHeight} textAnchor="middle" fill="#e4e4ed" fontSize="10" fontWeight="600">
                          {g.count}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Recent activity */}
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-medium mb-4">Recent Activity</h2>
              {activities.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {activities.map((a, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="mt-1 w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs">
                          <span className="font-medium">{a.deal_name}</span>
                          <span style={{ color: 'var(--text-muted)' }}> moved from </span>
                          G{a.from_gate}
                          <span style={{ color: 'var(--text-muted)' }}> to </span>
                          G{a.to_gate}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{relativeTime(a.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
