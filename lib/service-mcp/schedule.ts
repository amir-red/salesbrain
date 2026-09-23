/**
 * When will a queued agent run actually fire?
 *
 * The truth is a Hermes cron job on the box (`hermes cron list`), created by
 * salesbrain-hermes/scripts/deploy-server.sh — keep the constants below in step
 * with the expressions there. `agent_definitions.schedule` is prose for the
 * Agents page. Server TZ: Africa/Addis_Ababa (UTC+3, no DST).
 *
 *   leads-finder   20 7,11,15,19 * * *
 *   enricher       40 9,16 * * *
 *   graph-sync     10 2,14 * * *
 *
 * The Hermes scheduler ticks once a minute, so a run starts within ~1 minute of
 * its expression; we report a short window rather than a point. A tick missed
 * while the gateway was down is not replayed, and even on time the run still has
 * to pass the budget / paused-account / kill-switch gates.
 */

const TZ_OFFSET_HOURS = 3;              // Africa/Addis_Ababa, no DST
const JITTER_MINUTES = 2;               // Hermes ticks every 60 s; allow one tick of slack

/** Local (Addis) hours at which the leads-finder job fires, at :20 past. */
const LEADS_FINDER_HOURS = [7, 11, 15, 19];
const TICK_MINUTE = 20;

/** Enricher: 40 9,16 * * * */
const ENRICHER_HOURS = [9, 16];
const ENRICHER_MINUTE = 40;
const ENRICHER_JITTER_MINUTES = 2;

export interface TickWindow {
  earliest: string;
  latest: string;
  note: string;
}

function nextWindow(hours: number[], minute: number, jitter: number, now = new Date()): TickWindow {
  // Work in "Addis minutes since midnight" to pick the next scheduled tick.
  const addisNow = new Date(now.getTime() + TZ_OFFSET_HOURS * 3600_000);
  const minutesNow = addisNow.getUTCHours() * 60 + addisNow.getUTCMinutes();

  let deltaMin: number | null = null;
  for (const h of hours) {
    const tick = h * 60 + minute;
    if (tick > minutesNow) { deltaMin = tick - minutesNow; break; }
  }
  if (deltaMin === null) {
    // Past the last tick of the day — wrap to the first tick tomorrow.
    deltaMin = (24 * 60 - minutesNow) + (hours[0] * 60 + minute);
  }

  const earliest = new Date(now.getTime() + deltaMin * 60_000);
  const latest = new Date(earliest.getTime() + jitter * 60_000);
  return {
    earliest: earliest.toISOString(),
    latest: latest.toISOString(),
    note: `The agent is a scheduled Hermes job; it starts within about ${jitter} minutes of the tick. `
      + 'A missed tick is not replayed, and the run still needs an unpaused account and remaining daily budget. '
      + 'For an immediate result use crm_leads_finder_run instead of queueing.',
  };
}

export function nextLeadsFinderWindow(now = new Date()): TickWindow {
  return nextWindow(LEADS_FINDER_HOURS, TICK_MINUTE, JITTER_MINUTES, now);
}

export function nextEnricherWindow(now = new Date()): TickWindow {
  return nextWindow(ENRICHER_HOURS, ENRICHER_MINUTE, ENRICHER_JITTER_MINUTES, now);
}

/** Graph Sync: 10 2,14 * * * */
const GRAPH_SYNC_HOURS = [2, 14];
const GRAPH_SYNC_MINUTE = 10;
const GRAPH_SYNC_JITTER_MINUTES = 2;

export function nextGraphSyncWindow(now = new Date()): TickWindow {
  return nextWindow(GRAPH_SYNC_HOURS, GRAPH_SYNC_MINUTE, GRAPH_SYNC_JITTER_MINUTES, now);
}

export function nextWindowFor(agent: string, now = new Date()): TickWindow {
  if (agent === 'enricher') return nextEnricherWindow(now);
  if (agent === 'graph_sync') return nextGraphSyncWindow(now);
  // Unknown agents still get the leads-finder window — wrong, but bounded, and
  // better than no estimate. Add a case here when a new job ships.
  return nextLeadsFinderWindow(now);
}
