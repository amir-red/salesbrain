/**
 * When will a queued agent run actually fire?
 *
 * The truth is a systemd timer on the box, not anything in the DB
 * (`agent_definitions.schedule` is prose for the Agents page). The leads
 * finder is:
 *
 *   OnCalendar=*-*-* 07,11,15,19:20   RandomizedDelaySec=1800   Persistent=false
 *   (server TZ: Africa/Addis_Ababa, UTC+3, no DST)
 *
 * So a queued run fires somewhere in a 30-minute WINDOW after the next tick
 * time — never at a point. `Persistent=false` means a tick missed while the box
 * was down is not replayed, and even on time the run still has to pass the
 * budget / paused-account / kill-switch gates. We report the window and say so,
 * rather than inventing a precise ETA we can't honour.
 */

const TZ_OFFSET_HOURS = 3;              // Africa/Addis_Ababa, no DST
const JITTER_MINUTES = 30;              // RandomizedDelaySec=1800

/** Local (Addis) hours at which the leads-finder timer fires, at :20 past. */
const LEADS_FINDER_HOURS = [7, 11, 15, 19];
const TICK_MINUTE = 20;

/** Enricher: OnCalendar=*-*-* 09,16:40, RandomizedDelaySec=600. */
const ENRICHER_HOURS = [9, 16];
const ENRICHER_MINUTE = 40;
const ENRICHER_JITTER_MINUTES = 10;

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
    note: `The agent runs on a timer with up to ${jitter} minutes of jitter, so it starts somewhere in this window. `
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

/** Graph Sync: OnCalendar=*-*-* 02,14:10, RandomizedDelaySec=900. */
const GRAPH_SYNC_HOURS = [2, 14];
const GRAPH_SYNC_MINUTE = 10;
const GRAPH_SYNC_JITTER_MINUTES = 15;

export function nextGraphSyncWindow(now = new Date()): TickWindow {
  return nextWindow(GRAPH_SYNC_HOURS, GRAPH_SYNC_MINUTE, GRAPH_SYNC_JITTER_MINUTES, now);
}

export function nextWindowFor(agent: string, now = new Date()): TickWindow {
  if (agent === 'enricher') return nextEnricherWindow(now);
  if (agent === 'graph_sync') return nextGraphSyncWindow(now);
  // Unknown agents still get the leads-finder window — wrong, but bounded, and
  // better than no estimate. Add a case here when a new timer ships.
  return nextLeadsFinderWindow(now);
}
