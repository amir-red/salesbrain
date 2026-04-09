import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { runAgent } from '@/lib/agent';
import { getSLAStatus } from '@/lib/gates';

export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = { followups: 0, sla_alerts: 0, errors: 0 };

  // ─── 1. Process due followups ───────────────────────────────

  try {
    const { rows: dueFollowups } = await pool.query(
      `SELECT * FROM followups
       WHERE due_at <= now() AND sent = false
       ORDER BY due_at ASC
       LIMIT 50`
    );

    for (const followup of dueFollowups) {
      try {
        if (followup.type === 'email' && followup.to_email) {
          await sendEmail({
            to: followup.to_email,
            subject: followup.subject || 'SalesBrain Follow-up',
            body: followup.body,
          });
        }

        await pool.query(
          'UPDATE followups SET sent = true, sent_at = now() WHERE id = $1',
          [followup.id]
        );
        stats.followups++;
      } catch (err) {
        console.error(`Followup ${followup.id} failed:`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('Followup query failed:', err);
    stats.errors++;
  }

  // ─── 2. SLA breach detection ────────────────────────────────

  try {
    const { rows: activeDeals } = await pool.query(
      `SELECT id, name, gate, gate_entered_at, flags
       FROM deals
       WHERE gate < 9
       ORDER BY gate_entered_at ASC`
    );

    for (const deal of activeDeals) {
      const sla = getSLAStatus(deal.gate, new Date(deal.gate_entered_at));

      if (sla.status !== 'breached') continue;

      const flagKey = `sla_alert_g${deal.gate}`;
      if ((deal.flags as string[])?.includes(flagKey)) continue;

      try {
        // Add the flag to prevent duplicate alerts
        await pool.query(
          `UPDATE deals SET flags = array_append(flags, $1) WHERE id = $2`,
          [flagKey, deal.id]
        );

        // Run the agent autonomously with SLA breach context
        const agentMessage = `SYSTEM ALERT: SLA BREACH detected for deal "${deal.name}". Gate G${deal.gate} has been active for ${sla.daysInGate} days, exceeding the ${sla.slaDays}-day SLA. Assess the situation and take appropriate action — schedule followups, alert the owner, or recommend next steps.`;

        for await (const event of runAgent(deal.id, agentMessage)) {
          if (event.type === 'error') {
            console.error(`SLA agent error for deal ${deal.id}:`, event.error);
          }
        }

        stats.sla_alerts++;
      } catch (err) {
        console.error(`SLA alert for deal ${deal.id} failed:`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('SLA query failed:', err);
    stats.errors++;
  }

  return NextResponse.json(stats);
}
