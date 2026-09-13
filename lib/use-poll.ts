'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Poll a loader on an interval, the way the control panel pages watch agents
 * land: run on mount, every `intervalMs` while the tab is visible, and once
 * more when the tab comes back after a long absence. One request at a time —
 * a tick that fires mid-load is coalesced into a single re-run afterwards.
 *
 * `load` must be a stable `useCallback` (its deps decide when the poll
 * restarts). Mutation handlers should `await refresh()` instead of calling the
 * loader directly so the in-flight guard applies to them too.
 */
export function usePoll(load: () => Promise<void>, intervalMs = 45_000) {
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const lastRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [lastAt, setLastAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (): Promise<void> => {
    if (inFlight.current) { rerun.current = true; return; }
    inFlight.current = true;
    try {
      await load();
      setError(null);
      lastRef.current = Date.now();
      setLastAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      inFlight.current = false;
      setLoading(false);
      if (rerun.current) { rerun.current = false; void run(); }
    }
  }, [load]);

  useEffect(() => {
    void run();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void run(); }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRef.current > intervalMs / 2) void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [run, intervalMs]);

  return { refresh: run, loading, lastAt, error };
}
