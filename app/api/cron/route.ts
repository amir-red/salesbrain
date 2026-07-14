import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { runAgent } from '@/lib/agent';
import { getSLAStatus } from '@/lib/gates';
import { computeDecayScore } from '@/lib/decay';
import { exec_send_outreach_message } from '@/lib/prospect-executors';

export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = { followups: 0, sla_alerts: 0, decay_alerts: 0, outreach_sent: 0, prospect_stagnation: 0, errors: 0 };

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

  // ─── 2b. Batched Telegram SLA-breach notifications to linked users ──
  // Runs after the agent-based SLA loop. Groups all breached deals per
  // linked user into a single Telegram message so we don't spam. Best-
  // effort — Telegram outages don't break the cron.
  try {
    const { notifySlaBreachesForAllUsers } = await import('@/lib/telegram-notifications');
    const summary = await notifySlaBreachesForAllUsers();
    console.log(`[cron] telegram SLA notifications: ${summary.notified} users, ${summary.deals} deals`);
  } catch (err) {
    console.error('[cron] telegram SLA notifications failed:', err);
    stats.errors++;
  }

  // ─── 3. Deal decay detection ─────────────────────────────────

  try {
    const { rows: decayCandidates } = await pool.query(
      `SELECT id, name, gate, flags
       FROM deals
       WHERE gate BETWEEN 2 AND 8
       ORDER BY gate_entered_at ASC`
    );

    for (const deal of decayCandidates) {
      const flagKey = `decay_alert_g${deal.gate}`;
      if ((deal.flags as string[])?.includes(flagKey)) continue;

      try {
        const decay = await computeDecayScore(deal.id);
        if (!decay.shouldAlert) continue;

        await pool.query(
          `UPDATE deals SET flags = array_append(flags, $1) WHERE id = $2`,
          [flagKey, deal.id]
        );

        const signalSummary = decay.signals
          .map((s) => `- ${s.signal}: ${s.detail} (weight: ${s.weight})`)
          .join('\n');

        const agentMessage = `SYSTEM ALERT: DEAL DECAY detected for "${deal.name}" (decay score: ${decay.score}/100). This deal is slowly dying. Signals:\n${signalSummary}\n\nAnalyze the situation. If the deal is salvageable, schedule aggressive followups and alert the owner. If not, recommend walking away.`;

        for await (const event of runAgent(deal.id, agentMessage)) {
          if (event.type === 'error') {
            console.error(`Decay agent error for deal ${deal.id}:`, event.error);
          }
        }

        stats.decay_alerts++;
      } catch (err) {
        console.error(`Decay check for deal ${deal.id} failed:`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('Decay detection failed:', err);
    stats.errors++;
  }

  // ─── 4. Scheduled outreach delivery ─────────────────────────

  try {
    const { rows: dueOutreach } = await pool.query(
      `SELECT id FROM outreach_messages
       WHERE status = 'scheduled' AND scheduled_for <= now()
       ORDER BY scheduled_for ASC LIMIT 50`
    );
    for (const msg of dueOutreach) {
      try {
        const result = await exec_send_outreach_message({ message_id: msg.id });
        if (result.sent) stats.outreach_sent++;
      } catch (err) {
        console.error(`Outreach send failed for ${msg.id}:`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('Scheduled outreach check failed:', err);
    stats.errors++;
  }

  // ─── 5. Prospect stagnation flagging ────────────────────────

  try {
    // High-fit prospects (icp_score >= 60) that have been in a non-terminal stage
    // for 10+ days with no next_action_at set — flag with an event
    const { rows: stagnant } = await pool.query(
      `SELECT id, stage FROM prospects
       WHERE stage NOT IN ('P7_QUALIFIED','P8_DISQUALIFIED','P9_ARCHIVED')
         AND icp_score >= 60
         AND (last_contacted_at IS NULL OR last_contacted_at < now() - interval '10 days')
         AND (next_action_at IS NULL OR next_action_at < now() - interval '3 days')
         AND NOT EXISTS (
           SELECT 1 FROM prospect_events
           WHERE prospect_id = prospects.id
             AND event_type = 'stagnation_alert'
             AND created_at > now() - interval '3 days'
         )
       LIMIT 50`
    );
    for (const p of stagnant) {
      try {
        await pool.query(
          `INSERT INTO prospect_events (prospect_id, event_type, reason, triggered_by)
           VALUES ($1, 'stagnation_alert', $2, 'cron')`,
          [p.id, `High-fit prospect idle for 10+ days at ${p.stage}`]
        );
        stats.prospect_stagnation++;
      } catch (err) {
        console.error(`Stagnation flag failed for ${p.id}:`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('Prospect stagnation check failed:', err);
    stats.errors++;
  }

  return NextResponse.json(stats);
}
