'use client';

import type { PanelPayload } from '@/lib/icp-panel';
import { relativeTime } from '@/lib/time';
import SectionCard from '@/components/panel/SectionCard';
import StatTile from '@/components/panel/StatTile';
import ProgressBar from '@/components/panel/ProgressBar';
import Sparkline from '@/components/panel/Sparkline';
import { ActivityList, RunPill } from '@/components/icp/IcpLeads';
import type { RunMode } from '@/components/icp/IcpRow';

/** Step 3: the Leads Finder — where its cursor is, what it may still spend, what it found. */
export default function FinderSection({ data, canAct, busy, onRun, disabledReason }: {
  data: PanelPayload; canAct: boolean; busy: RunMode | null; onRun: (mode: RunMode) => void; disabledReason?: string;
}) {
  const { finder, quota, coverage, policy } = data;
  const st = finder.state;
  const last = finder.runs[0] ?? null;
  const top = last?.detail?.top ?? [];
  const cfg = policy.leads_finder;
  const btn = (label: string, mode: RunMode, primary = false) => (
    <button onClick={() => onRun(mode)} disabled={!canAct || !!busy} title={canAct ? undefined : disabledReason}
            className="px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-40"
            style={primary ? { background: 'var(--accent)', color: '#fff' } : { border: '1px solid var(--border)', color: 'var(--text)' }}>
      {busy === mode ? '…' : label}
    </button>
  );
  return (
    <SectionCard title="3 · Leads Finder" subtitle={`${policy.enabled.leads_finder ? 'enabled' : 'disabled'} · one Sales Navigator page per tick · stores ≥ ${String(cfg.min_score_to_store ?? 40)}, researches the top ${String(cfg.research_per_run ?? 5)} ≥ ${String(cfg.min_score_to_research ?? 60)}`}
                 right={<>{btn('Queue a pass', 'queue')}{btn('Find more now', 'now', true)}</>}>
      <div className="flex flex-wrap items-center gap-3">
        <RunPill run={last} queued={finder.queued} state={st} />
        {st?.next_eligible_at && new Date(st.next_eligible_at) > new Date() && <span className="text-[11px]" style={{ color: 'var(--yellow)' }}>backing off until {new Date(st.next_eligible_at).toLocaleString()}</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatTile label="on list" value={coverage.total} />
        <StatTile label="matched" value={coverage.matched} color="var(--green)" sub={`${coverage.scored} scored`} />
        <StatTile label="query variant" value={st ? `#${st.variant_index + 1}` : '—'} sub={st?.page_cursor ? `page cursor ${st.page_cursor.slice(0, 12)}…` : 'first page'} title={st?.page_cursor ?? undefined} />
        <StatTile label="empty runs in a row" value={st?.consecutive_empty_runs ?? 0} color={st?.exhausted_at ? 'var(--red)' : undefined} sub={st?.exhausted_at ? `exhausted ${relativeTime(st.exhausted_at)}` : st?.last_run_at ? `last ${relativeTime(st.last_run_at)}` : 'never ran'} />
      </div>
      <div className="grid gap-3 md:grid-cols-2 items-end">
        <ProgressBar label={`searches today${quota.connected ? '' : ' (no LinkedIn)'}`} used={quota.search.used} cap={quota.search.cap} title="Every Leads Finder search on the owner's account today — timer, chat and manual all count" />
        <div>
          <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>matched per day · 7 days</div>
          <Sparkline points={finder.daily.map((d) => ({ day: d.day, n: d.matched, title: `${d.day}: ${d.runs} runs · ${d.analyzed} analyzed · ${d.matched} matched · ${d.created} new` }))} height={30} />
        </div>
      </div>
      {top.length > 0 && (
        <div className="text-[11px] space-y-0.5">
          <div style={{ color: 'var(--text-muted)' }}>Top finds on the last pass</div>
          {top.slice(0, 5).map((t, i) => (
            <div key={i} className="truncate">
              {t.prospect_id ? <a href={`/prospects/${t.prospect_id}`} className="hover:underline">{t.name}</a> : t.name}
              <span style={{ color: 'var(--text-muted)' }}> — {t.headline}{t.company ? ` · ${t.company}` : ''} ({t.icp_score})</span>
            </div>
          ))}
        </div>
      )}
      <details>
        <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--text-muted)' }}>last {finder.runs.length} runs</summary>
        <div className="mt-2"><ActivityList runs={finder.runs} /></div>
      </details>
    </SectionCard>
  );
}
