import pool from './db';
import { getSLAStatus } from './gates';

export interface DecaySignal {
  signal: string;
  weight: number;
  detail: string;
}

export interface DecayResult {
  dealId: string;
  score: number;
  signals: DecaySignal[];
  shouldAlert: boolean;
}


const DECAY_THRESHOLD = 60;

export async function computeDecayScore(dealId: string): Promise<DecayResult> {
  const signals: DecaySignal[] = [];

  // 1. Days since last conversation
  const { rows: silenceRows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (now() - MAX(created_at))) / 86400 as days_silent
     FROM conversations
     WHERE deal_id = $1 AND role IN ('user', 'assistant')`,
    [dealId]
  );
  const daysSilent = Math.floor(Number(silenceRows[0]?.days_silent) || 999);
  if (daysSilent >= 14) {
    signals.push({ signal: 'Silence', weight: 45, detail: `No conversation in ${daysSilent} days` });
  } else if (daysSilent >= 8) {
    signals.push({ signal: 'Silence', weight: 30, detail: `No conversation in ${daysSilent} days` });
  } else if (daysSilent >= 4) {
    signals.push({ signal: 'Silence', weight: 15, detail: `No conversation in ${daysSilent} days` });
  }

  // 2. Overdue followups
  const { rows: overdueRows } = await pool.query(
    `SELECT COUNT(*)::int as overdue_count
     FROM followups
     WHERE deal_id = $1 AND sent = false AND due_at < now()`,
    [dealId]
  );
  const overdueCount = overdueRows[0]?.overdue_count || 0;
  if (overdueCount > 0) {
    const weight = Math.min(overdueCount * 10, 30);
    signals.push({ signal: 'Overdue followups', weight, detail: `${overdueCount} followup(s) past due` });
  }

  // 3. Pending board decisions > 3 days
  const { rows: pendingRows } = await pool.query(
    `SELECT COUNT(*)::int as pending_count
     FROM board_decisions
     WHERE deal_id = $1 AND decision IS NULL
       AND created_at < now() - interval '3 days'`,
    [dealId]
  );
  const pendingCount = pendingRows[0]?.pending_count || 0;
  if (pendingCount > 0) {
    const weight = Math.min(pendingCount * 15, 30);
    signals.push({ signal: 'Stale board review', weight, detail: `${pendingCount} board decision(s) pending > 3 days` });
  }

  // 4. No gate movement past 1.5x SLA
  const { rows: dealRows } = await pool.query(
    'SELECT gate, gate_entered_at FROM deals WHERE id = $1',
    [dealId]
  );
  if (dealRows[0]) {
    const deal = dealRows[0];
    const sla = getSLAStatus(deal.gate, new Date(deal.gate_entered_at));
    if (sla.daysInGate > sla.slaDays * 1.5) {
      signals.push({
        signal: 'Stagnation',
        weight: 20,
        detail: `${sla.daysInGate}d in G${deal.gate} (SLA: ${sla.slaDays}d, 1.5x exceeded)`,
      });
    }
  }

  const score = Math.min(signals.reduce((sum, s) => sum + s.weight, 0), 100);

  return {
    dealId,
    score,
    signals,
    shouldAlert: score >= DECAY_THRESHOLD,
  };
}
