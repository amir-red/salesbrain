'use client';

import { useState } from 'react';
import Link from 'next/link';
import { pct } from '@/lib/icp-panel';
import type { PanelPayload } from '@/lib/icp-panel';
import { relativeTime } from '@/lib/time';
import SectionCard from '@/components/panel/SectionCard';
import StatTile from '@/components/panel/StatTile';
import { RunPill } from '@/components/icp/IcpLeads';

/** Step 5: the relationship graph the routes are found in, and how many of this list's leads have a warm way in. */
export default function GraphSection({ data, onChanged }: { data: PanelPayload; onChanged: () => Promise<void> }) {
  const { graph, coverage, is_owner, policy } = data;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rebuild = async () => {
    setBusy(true); setNote(null);
    try {
      const res = await fetch('/api/graph/sync', { method: 'POST' });
      const out = await res.json().catch(() => ({}));
      setNote(out.error ? String(out.error) : String(out.note || 'Queued — the graph sync picks it up on its next tick.'));
      await onChanged();
    } finally { setBusy(false); }
  };
  const maxHop = Math.max(1, ...graph.hops.map((h) => h.n));
  const deg = graph.degrees;
  return (
    <SectionCard title="5 · Graph & routes"
                 subtitle={`${policy.enabled.graph_sync ? 'graph sync enabled' : 'graph sync disabled'} · owner's graph: ${graph.totals.people} people · ${graph.totals.edges} connections${graph.sync ? ` · mirror ${graph.sync.phase.replace(/_/g, ' ')}` : ' · never synced'}`}
                 right={is_owner ? <button onClick={rebuild} disabled={busy} className="px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }} title="Queue a graph sync for your own account">{busy ? '…' : 'Rebuild graph'}</button> : undefined}>
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <RunPill run={graph.last_run} queued={0} state={null} />
        {graph.sync?.last_error && <span style={{ color: 'var(--red)' }} title={graph.sync.last_error}>last error: {graph.sync.last_error.slice(0, 80)}</span>}
        {graph.sync?.mirror_completed_at && <span style={{ color: 'var(--text-muted)' }}>mirror complete {relativeTime(graph.sync.mirror_completed_at)} · {graph.sync.relations_seen} relations</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatTile label="1st degree" value={deg.d1} color="var(--green)" sub="message directly" />
        <StatTile label="2nd degree" value={deg.d2} color="var(--yellow)" sub="one intro away" />
        <StatTile label="3rd / unknown" value={deg.d3 + deg.unknown} sub={`${deg.unknown} not looked up`} />
        <StatTile label="warm route found" value={coverage.route_available} color={coverage.route_available ? 'var(--green)' : undefined}
                  sub={`${coverage.routed} of ${coverage.total} computed · ${pct(coverage.route_available, coverage.total) ?? '—'}${coverage.total ? '%' : ''} reachable warm`} />
      </div>
      {graph.hops.length > 0 && (
        <div className="flex items-end gap-3 text-[11px]">
          {graph.hops.map((h) => (
            <div key={h.hops} className="flex flex-col items-center gap-1" title={`${h.n} lead${h.n === 1 ? '' : 's'} reachable in ${h.hops} hop${h.hops === 1 ? '' : 's'}`}>
              <div className="w-8 rounded-t" style={{ height: 8 + (h.n / maxHop) * 32, background: h.hops === 1 ? 'var(--green)' : 'var(--yellow)', opacity: 0.7 }} />
              <span style={{ color: 'var(--text-muted)' }}>{h.hops} hop{h.hops === 1 ? '' : 's'} · <b style={{ color: 'var(--text)' }}>{h.n}</b></span>
            </div>
          ))}
        </div>
      )}
      {graph.top_routed.length > 0 ? (
        <div className="text-[11px] space-y-0.5">
          <div style={{ color: 'var(--text-muted)' }}>Shortest routes on this list</div>
          {graph.top_routed.map((r) => (
            <div key={r.prospect_id} className="flex items-center gap-2">
              <Link href={`/prospects/${r.prospect_id}`} className="hover:underline truncate">{r.full_name || '—'}</Link>
              <span className="truncate" style={{ color: 'var(--text-muted)' }}>{r.company_name || ''}</span>
              <span className="ml-auto shrink-0 px-1.5 rounded text-[10px]" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)' }}>{r.hops} hop{r.hops === 1 ? '' : 's'}</span>
              <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>fit {r.icp_score ?? '—'}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {coverage.total === 0 ? 'No leads to route yet.' : coverage.routed === 0 ? 'No routes computed yet — open a lead and click Find route, or let the Enricher look leads up.' : 'Routes were computed but none of these leads has a warm way in yet.'}
        </p>
      )}
      {note && <div className="text-[11px]" style={{ color: note.toLowerCase().includes('error') ? 'var(--red)' : 'var(--text-muted)' }}>{note}</div>}
    </SectionCard>
  );
}
