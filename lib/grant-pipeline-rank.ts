import pool from './db';

/**
 * Comparative analysis for a grant deal: where does it rank against other
 * currently-active grants by total upside? Used at G2 (Quick Triage) to force
 * opportunity-cost thinking — small grants get de-prioritized when big ones
 * are in flight.
 */
export interface GrantPipelinePeer {
  id: string;
  name: string;
  company: string;
  gate: number;
  amount_max: number; // USD upside (from fields.grant_amount_max OR deal.value)
  cofunding_split: string | null;
  score: number | null;
}

export interface GrantPipelineRank {
  thisDeal: { amount_max: number; cofunding_split: string | null };
  peers: GrantPipelinePeer[];                // other active grants, biggest first
  rankByAmount: number;                       // 1 = highest, n = lowest
  totalActiveGrants: number;
  totalActivePipelineValue: number;           // sum of amount_max of all active grants
  recommendation: 'top_priority' | 'mid_priority' | 'deprioritize' | 'no_signal';
  reason: string;
}

function extractAmount(deal: { value: string | null; fields: Record<string, unknown> | null }): number {
  // Prefer explicit grant_amount_max in fields, fall back to deal.value
  const fields = (deal.fields || {}) as Record<string, unknown>;
  const fromFields = Number(fields.grant_amount_max ?? fields.grant_amount_min ?? 0);
  if (fromFields > 0) return fromFields;
  return Number(deal.value || 0);
}

function extractSplit(fields: Record<string, unknown> | null): string | null {
  if (!fields) return null;
  return (fields.cofunding_split as string) || null;
}

export async function computeGrantPipelineRank(dealId: string): Promise<GrantPipelineRank | null> {
  const { rows } = await pool.query(
    `SELECT id, name, company, gate, score, value, fields
     FROM deals
     WHERE deal_type = 'grant' AND gate < 10
     ORDER BY id`
  );

  if (rows.length === 0) return null;

  const thisRow = rows.find((r) => r.id === dealId);
  if (!thisRow) return null;

  const peers: GrantPipelinePeer[] = rows
    .filter((r) => r.id !== dealId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      company: r.company,
      gate: r.gate,
      amount_max: extractAmount(r),
      cofunding_split: extractSplit(r.fields),
      score: r.score,
    }))
    .sort((a, b) => b.amount_max - a.amount_max);

  const thisAmount = extractAmount(thisRow);
  const totalActivePipelineValue = peers.reduce((s, p) => s + p.amount_max, 0) + thisAmount;
  const sortedAll = [...peers.map((p) => p.amount_max), thisAmount].sort((a, b) => b - a);
  const rankByAmount = sortedAll.indexOf(thisAmount) + 1;

  let recommendation: GrantPipelineRank['recommendation'] = 'no_signal';
  let reason = '';

  if (thisAmount === 0) {
    recommendation = 'no_signal';
    reason = 'No grant_amount_max set — cannot rank. Fill money fields first.';
  } else if (rows.length === 1) {
    recommendation = 'top_priority';
    reason = 'Only active grant in pipeline.';
  } else if (rankByAmount === 1) {
    recommendation = 'top_priority';
    reason = `Largest active grant in pipeline (USD ${thisAmount.toLocaleString()}). Pursue aggressively.`;
  } else if (rankByAmount <= Math.ceil(rows.length / 3)) {
    recommendation = 'top_priority';
    reason = `Top third of active grants by value (#${rankByAmount} of ${rows.length}).`;
  } else if (rankByAmount <= Math.ceil((rows.length * 2) / 3)) {
    recommendation = 'mid_priority';
    reason = `Middle of pipeline (#${rankByAmount} of ${rows.length}). Pursue only if strategic value beyond cash.`;
  } else {
    const topAmount = peers[0]?.amount_max || 0;
    const ratio = topAmount > 0 ? thisAmount / topAmount : 0;
    recommendation = 'deprioritize';
    reason = `Bottom third of active grants (#${rankByAmount} of ${rows.length}). At ${(ratio * 100).toFixed(0)}% of the largest open grant. Consider dropping unless there's a strategic reason.`;
  }

  return {
    thisDeal: { amount_max: thisAmount, cofunding_split: extractSplit(thisRow.fields) },
    peers,
    rankByAmount,
    totalActiveGrants: rows.length,
    totalActivePipelineValue,
    recommendation,
    reason,
  };
}

/**
 * Format the rank for inclusion in the agent system prompt. Compact text,
 * easy to inject without bloating context.
 */
export function formatRankForPrompt(rank: GrantPipelineRank): string {
  const lines = [
    `## Grant Pipeline Comparison`,
    `Active grants in pipeline: ${rank.totalActiveGrants}`,
    `Total active pipeline value: USD ${rank.totalActivePipelineValue.toLocaleString()}`,
    `This grant rank by amount: #${rank.rankByAmount} of ${rank.totalActiveGrants}`,
    `Recommendation: ${rank.recommendation.toUpperCase()} — ${rank.reason}`,
    ``,
    `Other active grants (biggest first):`,
  ];
  for (const p of rank.peers.slice(0, 5)) {
    lines.push(
      `  - ${p.name} (${p.company}) · USD ${p.amount_max.toLocaleString()} · G${p.gate}${p.cofunding_split ? ' · ' + p.cofunding_split : ''}`
    );
  }
  if (rank.peers.length > 5) {
    lines.push(`  ... and ${rank.peers.length - 5} more`);
  }
  return lines.join('\n');
}
