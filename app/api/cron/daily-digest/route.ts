import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { sendTelegramMessage } from '@/lib/telegram';
import { getSLAStatus, GATES } from '@/lib/gates';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = { messages_sent: 0, errors: 0 };

  try {
    // A. Active deals with SLA status
    const { rows: activeDeals } = await pool.query(
      `SELECT d.id, d.name, d.company, d.gate, d.score, d.value, d.currency,
              d.gate_entered_at, d.flags, u.name as lead_name
       FROM deals d
       LEFT JOIN users u ON u.id = d.lead_id
       WHERE d.gate < 9
       ORDER BY d.gate DESC, d.gate_entered_at ASC`
    );

    // B. Followups due within 24 hours
    const { rows: dueFollowups } = await pool.query(
      `SELECT f.id, f.type, f.subject, f.due_at, d.name as deal_name
       FROM followups f
       JOIN deals d ON d.id = f.deal_id
       WHERE f.sent = false AND f.due_at <= now() + interval '24 hours'
       ORDER BY f.due_at ASC`
    );

    // C. Deals gone quiet (no conversation in 7 days)
    const { rows: quietDeals } = await pool.query(
      `SELECT d.id, d.name, d.company, d.gate
       FROM deals d
       WHERE d.gate < 9
         AND NOT EXISTS (
           SELECT 1 FROM conversations c
           WHERE c.deal_id = d.id AND c.created_at > now() - interval '7 days'
         )`
    );

    // D. Yesterday's gate movements
    const { rows: movements } = await pool.query(
      `SELECT ge.from_gate, ge.to_gate, d.name as deal_name
       FROM gate_events ge
       JOIN deals d ON d.id = ge.deal_id
       WHERE ge.created_at >= now() - interval '24 hours'
       ORDER BY ge.created_at DESC`
    );

    // Build digest message
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const lines: string[] = [];

    lines.push(`SALESBRAIN DAILY DIGEST — ${today}`);
    lines.push('');

    // Pipeline status
    lines.push(`PIPELINE: ${activeDeals.length} active deal${activeDeals.length !== 1 ? 's' : ''}`);

    // SLA alerts
    const slaAlerts: string[] = [];
    for (const deal of activeDeals) {
      const sla = getSLAStatus(deal.gate, new Date(deal.gate_entered_at));
      if (sla.status === 'breached') {
        slaAlerts.push(`  !! ${deal.name} — G${deal.gate} BREACHED (${sla.daysInGate}d / ${sla.slaDays}d)`);
      } else if (sla.status === 'warning') {
        slaAlerts.push(`  ! ${deal.name} — G${deal.gate} warning (${sla.daysInGate}d / ${sla.slaDays}d)`);
      }
    }
    if (slaAlerts.length > 0) {
      lines.push('');
      lines.push('SLA ALERTS:');
      lines.push(...slaAlerts);
    }

    // Due today
    if (dueFollowups.length > 0) {
      lines.push('');
      lines.push('DUE TODAY:');
      for (const f of dueFollowups) {
        lines.push(`  - ${f.deal_name}: ${f.subject || f.type}`);
      }
    }

    // Quiet deals
    if (quietDeals.length > 0) {
      lines.push('');
      lines.push('GONE QUIET (7+ days):');
      for (const d of quietDeals) {
        lines.push(`  - ${d.name} (${d.company}) at G${d.gate}`);
      }
    }

    // Yesterday's moves
    if (movements.length > 0) {
      lines.push('');
      lines.push("YESTERDAY'S MOVES:");
      for (const m of movements) {
        const gateName = GATES[m.to_gate - 1]?.name || '';
        lines.push(`  + ${m.deal_name}: G${m.from_gate} -> G${m.to_gate} ${gateName}`);
      }
    }

    // Deals summary by gate
    lines.push('');
    lines.push('BY GATE:');
    for (const g of GATES) {
      const count = activeDeals.filter((d) => d.gate === g.number).length;
      if (count > 0) lines.push(`  G${g.number} ${g.name}: ${count}`);
    }

    const message = lines.join('\n');

    // Send to Telegram (consolidated message to board channel)
    try {
      await sendTelegramMessage(message);
      stats.messages_sent++;
    } catch (err) {
      console.error('Failed to send daily digest:', err);
      stats.errors++;
    }
  } catch (err) {
    console.error('Daily digest failed:', err);
    stats.errors++;
  }

  return NextResponse.json(stats);
}
