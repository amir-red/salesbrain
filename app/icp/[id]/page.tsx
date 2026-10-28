'use client';

import OwnerControl from '@/components/icp/OwnerControl';
import SeatsControl from '@/components/icp/SeatsControl';
import TuningPanel from '@/components/icp/TuningPanel';
import ListSettings from '@/components/icp/ListSettings';
import CohortHeader from '@/components/icp/CohortHeader';
import PriorityPicker from '@/components/PriorityPicker';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import IcpWizard from '@/components/icp/IcpWizard';
import LeadsTable from '@/components/icp/LeadsTable';
import FirmsSection from '@/components/firms/FirmsSection';
import EmailOutreachSection from '@/components/email/EmailOutreachSection';
import { ActivityList } from '@/components/icp/IcpLeads';
import type { RunMode } from '@/components/icp/IcpRow';
import DefinitionSection from '@/components/icp/panel/DefinitionSection';
import FinderSection from '@/components/icp/panel/FinderSection';
import EnricherSection from '@/components/icp/panel/EnricherSection';
import GraphSection from '@/components/icp/panel/GraphSection';
import OutreachSection from '@/components/icp/panel/OutreachSection';
import SectionCard from '@/components/panel/SectionCard';
import Drawer from '@/components/icp/cockpit/Drawer';
import { Skeleton, SkeletonCard, SkeletonRows } from '@/components/panel/Skeleton';
import { AgentsCard, CampaignsCard, NeedsYou, RailFunnel, WhoBelongsCard, type AgentKey } from '@/components/icp/cockpit/Rail';
import type { PanelPayload } from '@/lib/icp-panel';
import { usePoll } from '@/lib/use-poll';
import { relativeTime } from '@/lib/time';
import ExportButton from '@/components/ExportButton';
import ImportLeadsModal from '@/components/sales-leads/ImportLeadsModal';

/**
 * /icp/[id] — one list (design B, 2026-10-28): the leads table is the page, and a rail beside it shows the state of the
 * list — funnel, what needs a decision, each agent in one line, the campaigns that send to it, who belongs. Every rail
 * card opens its full detail in a drawer (the old sections, unchanged); list settings live in a Settings drawer.
 * Polls every 30 s; actions reuse the endpoints the old cards already had.
 */
type DrawerKey = AgentKey | 'activity' | 'who' | 'settings';
const DRAWER_TITLE: Record<DrawerKey, string> = {
  finder: 'Leads Finder', enricher: 'Enricher', graph: 'Warm routes', outreach: 'Waiting for a decision · outreach and intros',
  activity: 'Activity', who: 'Who belongs on this list', settings: 'List settings',
};
export default function IcpPanelPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PanelPayload | null>(null);
  const [status, setStatus] = useState<number>(200);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<RunMode | 'state' | 'archive' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [addingPeople, setAddingPeople] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const [firmCount, setFirmCount] = useState<number | null>(null);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/icp/${id}/panel`);
    setStatus(res.status);
    if (!res.ok) throw new Error(res.status === 404 ? 'Not found, or not yours' : 'Failed to load');
    setData(await res.json());
  }, [id]);
  const { refresh, loading, lastAt, error } = usePoll(load, 30_000);

  const run = async (mode: RunMode) => {
    setBusy(mode); setNote(null);
    try {
      const res = await fetch(`/api/icp/${id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const out = await res.json().catch(() => ({}));
      if (out?.error) setNote(String(out.error));
      else if (mode === 'now') setNote(`Analyzed ${out?.analyzed ?? 0} · matched ${out?.matched ?? 0} · new ${out?.new ?? 0} · researched ${out?.researched ?? 0}${out?.more_pages ? ' · more pages remain' : ''}`);
      else setNote(String(out?.note || 'Queued for the next tick.'));
      await refresh();
    } finally { setBusy(null); }
  };
  const setState = async (state: 'running' | 'paused') => {
    if (!data) return;
    let reason: string | undefined;
    if (state === 'paused') {
      const answer = prompt(`Pause "${data.icp.name}"?\n\nSourcing, enrichment, drafting and sending stop for this ICP only. Resume puts it straight back.\n\nReason (optional):`);
      if (answer === null) return;
      reason = answer.trim() || undefined;
    }
    setBusy('state');
    try {
      const res = await fetch(`/api/icp/${id}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, reason }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) alert(json.error || 'Could not change the state');
      await refresh();
    } finally { setBusy(null); }
  };
  const archive = async () => {
    if (!data || !confirm(`Archive "${data.icp.name}"? Its prospects keep their link; re-creating the same name revives it.`)) return;
    setBusy('archive');
    try {
      const res = await fetch(`/api/icp/${id}`, { method: 'DELETE' });
      if (res.ok) router.push('/icp');
    } finally { setBusy(null); }
  };

  // The list reloads only when the poll sees the list change (counts per stage, coverage, pending cards) — not every 30 s.
  const leadsSignature = data ? JSON.stringify([data.coverage, data.stages, data.outreach.pending.length, data.icp.updated_at]) : '';
  const canAct = Boolean(data?.is_owner) && (data?.blockers.length ?? 0) === 0;
  const disabledReason = data && !data.is_owner ? 'Runs with the owner’s LinkedIn — only the owner can start it' : data?.blockers[0];
  const runBusy = busy === 'now' || busy === 'queue' || busy === 'enrich' ? busy : null;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-start justify-between gap-4 sticky top-0 z-10" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
          <div className="min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Link href="/icp" className="text-sm" style={{ color: 'var(--text-muted)' }} title="All ICPs">←</Link>
              <span className="truncate">{data?.icp.name ?? (loading ? 'Loading…' : 'ICP')}</span>
              {data?.icp.paused_at && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>⏸ paused</span>}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {data ? <><OwnerControl icpId={id} ownerId={data.icp.owner_user_id} ownerName={data.icp.owner_name} isOwner={data.is_owner}
                  canEdit={data.can_edit} onChanged={(n) => { setNote(n); void refresh(); }} /> · <PriorityPicker value={data.icp.priority ?? null} icpId={id} readOnly={!data.can_edit} onChanged={() => void refresh()} /> · {lastAt ? `updated ${relativeTime(lastAt.toISOString())}` : ''} · <button onClick={() => refresh()} className="underline">refresh</button></> : 'The whole journey for this list, and what the machinery is doing at each step.'}
            </p>
            {data && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                <SeatsControl icpId={id} canEdit={data.can_edit} onChanged={(n) => { setNote(n); void refresh(); }} />
              </p>
            )}

          </div>
          {data && !editing && (
            <div className="flex flex-wrap gap-2 justify-end shrink-0">
              <ExportButton href={`/api/export/icp?icp_id=${id}`} label="Export Excel"
                title="The whole ICP as Excel: definition, every lead with all details, funnel and agent runs" />
              {data.can_edit && (data.icp.paused_at
                ? <button onClick={() => setState('running')} disabled={busy === 'state'} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>Resume</button>
                : <button onClick={() => setState('paused')} disabled={busy === 'state'} className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} title="Hold this ICP only — reversible">Pause</button>)}
              <button onClick={() => setDrawer('settings')} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Settings</button>
              {data.can_edit && <button onClick={() => setEditing(true)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Edit</button>}
              {data.can_edit && <button onClick={archive} disabled={busy === 'archive'} className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>Archive</button>}
            </div>
          )}
        </div>

        {!data && !error && (
          <div className="p-4 space-y-3" aria-busy="true">
            <div className="flex flex-wrap items-start gap-4">
              <div className="z-panel" style={{ flex: '999 1 560px', minWidth: 0 }}>
                <div className="p-4 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-80" /></div>
                <SkeletonRows rows={10} />
              </div>
              <aside className="space-y-3 w-full lg:max-w-[360px]" style={{ flex: '1 1 300px' }}>
                <SkeletonCard lines={6} /><SkeletonCard lines={2} /><SkeletonCard lines={4} /><SkeletonCard lines={2} />
              </aside>
            </div>
          </div>
        )}
        {error && !data && (
          <div className="p-8 text-center text-sm space-y-2" style={{ color: 'var(--text-muted)' }}>
            <p>{status === 404 ? 'This ICP does not exist.' : error}</p>
            <Link href="/icp" className="underline">Back to ICPs</Link>
          </div>
        )}
        {error && data && <div className="mx-4 mt-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>Last refresh failed ({error}); showing the previous data.</div>}

        {data && editing && (
          <IcpWizard initial={data.icp} onSaved={() => { setEditing(false); void refresh(); }} onCancel={() => setEditing(false)} />
        )}

        {data && !editing && (
          <div className="p-4 space-y-3">
            {note && <div className="text-[11px]" style={{ color: note.toLowerCase().includes('error') || note.startsWith('Leads Finder can') ? 'var(--red)' : 'var(--text-muted)' }}>{note}</div>}
            <div className="flex flex-wrap items-start gap-4">
              <div className="space-y-4" style={{ flex: '999 1 560px', minWidth: 0 }}>
                {/* On a firm list (e.g. VC funds) the firms are the work; on a people list nothing shows here. */}
                <div id="firms"><FirmsSection icpId={id} canEdit={data.can_edit} hideWhenEmpty onCount={setFirmCount} /></div>
                <SectionCard title={`Leads · ${data.coverage.total}`}
                  subtitle={data.icp.cohort ? 'highest priority first: right person + company fit and early-adopter signals + warmth · click a score for why' : 'priority rank first, then best fit · coverage: E employer · R research · @ email · 🔥 warm angle · ↝ warm route'}
                  right={data.can_edit && <button type="button" onClick={() => setAddingPeople(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}
                    title="Paste rows or upload a CSV / Excel file; new people land on this list, scored against it">Add people</button>}>
                  <LeadsTable icpId={id} signature={leadsSignature} />
                </SectionCard>
              </div>
              <aside className="space-y-3 w-full lg:max-w-[360px]" style={{ flex: '1 1 300px' }} aria-label="This list">
                <RailFunnel icpId={id} funnel={data.funnel ?? null} />
                <NeedsYou data={data} onOpen={() => setDrawer('outreach')} />
                <AgentsCard data={data} onOpen={setDrawer} onActivity={() => setDrawer('activity')} />
                <CampaignsCard icpId={id} />
                <WhoBelongsCard data={data} onOpen={() => setDrawer('who')} />
              </aside>
            </div>

            {addingPeople && (
              <ImportLeadsModal list={{ id, name: data.icp.name, ownerName: data.is_owner ? 'You' : data.icp.owner_name }}
                onClose={() => { setAddingPeople(false); void refresh(); }}
                onImported={(n) => { setNote(`${n} ${n === 1 ? 'person' : 'people'} added. The agents now look up their LinkedIn profiles and enrich them.`); void refresh(); }} />
            )}

            {drawer && (
              <Drawer title={DRAWER_TITLE[drawer]} onClose={closeDrawer}>
                {drawer === 'finder' && <>
                  {data.blockers.length > 0 && data.icp.objective !== 'list' && (
                    <div className="rounded-xl px-4 py-3 text-xs space-y-0.5" style={{ background: 'color-mix(in srgb, var(--yellow) 8%, transparent)', border: '1px solid var(--yellow)' }}>
                      <div className="font-medium" style={{ color: 'var(--yellow)' }}>The Leads Finder will not run for this list right now</div>
                      {data.blockers.map((b, i) => <div key={i} style={{ color: 'var(--text-muted)' }}>· {b}</div>)}
                    </div>
                  )}
                  <FinderSection data={data} canAct={canAct} busy={runBusy} onRun={run} disabledReason={disabledReason} />
                </>}
                {drawer === 'enricher' && <EnricherSection data={data} canAct={canAct} busy={runBusy} onRun={run} disabledReason={disabledReason} />}
                {drawer === 'graph' && <GraphSection data={data} onChanged={refresh} />}
                {drawer === 'outreach' && <OutreachSection data={data} onChanged={refresh} />}
                {drawer === 'activity' && <ActivityList runs={data.activity} showIcp />}
                {drawer === 'who' && <>
                  {data.icp.cohort && <CohortHeader cohort={data.icp.cohort} />}
                  <DefinitionSection data={data} onEdit={data.can_edit ? () => { setDrawer(null); setEditing(true); } : undefined} />
                  <TuningPanel icpId={id} onApplied={(n) => { setNote(n); void refresh(); }} />
                </>}
                {drawer === 'settings' && <>
                  <ListSettings icpId={id} onSaved={(n) => { setNote(n); void refresh(); }} />
                  {firmCount === 0 && <FirmsSection icpId={id} canEdit={data.can_edit} />}
                  <details className="rounded-xl px-4 py-3" style={{ border: '1px solid var(--border)' }}>
                    <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>Email waves (older way to email a list; campaigns now do this)</summary>
                    <div className="mt-3"><EmailOutreachSection icpId={id} /></div>
                  </details>
                </>}
              </Drawer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
