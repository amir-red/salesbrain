'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import ProfileHero from '@/components/prospect/ProfileHero';
import LeadBrief from '@/components/prospect/LeadBrief';
import JourneyTab, { type IntroRequest, type ResearchBrief, type Score } from '@/components/prospect/JourneyTab';
import type { LeadApproval } from '@/components/prospect/ApprovalsPanel';
import type { ActAs, Prospect } from '@/lib/prospects';
import type { LeadBrief as Brief } from '@/lib/lead-brief';
import { relativeTime } from '@/lib/time';
import { Skeleton } from '@/components/panel/Skeleton';

interface Event { id: string; event_type: string; from_stage: string | null; to_stage: string | null; reason: string | null; triggered_by: string | null; created_at: string }
interface Payload {
  prospect: Prospect; briefs: ResearchBrief[]; scores: Score[]; events: Event[];
  approvals: LeadApproval[]; intro_requests: IntroRequest[]; teammates_with_linkedin: number;
  acting_user_id: string; owner_can_source: boolean; viewer_can_source: boolean;
  viewer: { user_id: string; role: string; name: string };
}
type Tab = 'brief' | 'journey' | 'activity';

/**
 * A person's page (2026-11-09): a profile, not a stack of boxes. The hero (picture, name, role, how to reach them,
 * Write message) over three tabs — Brief (the eight questions a seller asks before writing, answered from the data),
 * Journey (the 2026-09 machinery: fit, enrichment, route, drafts, history) and Activity.
 */
export default function ProspectDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const prospectId = params.id as string;
  const [data, setData] = useState<Payload | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [researching, setResearching] = useState(false);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [as, setAs] = useState<ActAs>('owner');
  const tab = ((search.get('tab') as Tab | null) ?? 'brief');

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/prospects/${prospectId}?as=${as}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [prospectId, as]);
  const fetchBrief = useCallback(async () => {
    try {
      const res = await fetch(`/api/prospects/${prospectId}/brief`);
      const d = await res.json();
      if (!res.ok || d.error) { setBriefErr(d.error || `The brief did not load (${res.status})`); return; }
      setBrief(d as Brief); setBriefErr(null);
    } catch (e) { setBriefErr(e instanceof Error ? e.message : String(e)); }
  }, [prospectId]);
  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchBrief(); }, [fetchBrief]);
  const refresh = () => { void fetchData(true); void fetchBrief(); };
  const setTab = (t: Tab) => {
    const sp = new URLSearchParams(search.toString());
    if (t === 'brief') sp.delete('tab'); else sp.set('tab', t);
    router.replace(`/prospects/${prospectId}${sp.toString() ? `?${sp}` : ''}`);
  };

  const convertToDeal = async () => {
    setConverting(true); setFlash(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const result = await res.json();
      if (result.deal_id) window.location.href = `/deals/${result.deal_id}`;
      else setFlash({ kind: 'error', text: result.error || result.reason || 'Could not convert.' });
    } finally { setConverting(false); }
  };
  const enrichNow = async () => {
    setEnriching(true); setEnrichNote(null); setFlash(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/enrich`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ as }) });
      const out = await res.json();
      if (out.error) { setEnrichNote(String(out.error)); setFlash({ kind: 'error', text: String(out.error) }); }
      else {
        const bits = [];
        if (out.employer) bits.push(`employer: ${typeof out.employer === 'string' ? out.employer : 'set'}`);
        if (out.research?.researched) bits.push(`researched (fit ${out.research.icp_score})`);
        if (out.email?.written) bits.push('email found');
        else if (out.email?.note) bits.push(`email: ${out.email.note}`);
        const line = bits.join(' · ') || 'Nothing new to add.';
        setEnrichNote(line); setFlash({ kind: 'info', text: `Enriched — ${line}` });
      }
      refresh();
    } finally { setEnriching(false); }
  };
  const researchNow = async () => {
    setResearching(true); setFlash(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/trust-research`, { method: 'POST' });
      const out = await res.json();
      if (!res.ok || out.error) setFlash({ kind: 'error', text: out.error || 'Research failed' });
      else setFlash({ kind: 'info', text: `Researched${out.acting_as ? ` as ${out.acting_as}` : ''} — ${out.extracted ? 'the brief is refreshed.' : 'nothing new was found.'}` });
      refresh();
    } catch (e) { setFlash({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setResearching(false); }
  };

  if (loading && !data) {
    return (
      <div className="flex h-screen"><Sidebar />
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-4 pb-5 border-b" style={{ borderColor: 'var(--border)' }}>
            <Skeleton className="h-3 w-24 mb-5" />
            <div className="flex items-center gap-5"><Skeleton className="w-[84px] h-[84px] rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-64" /><Skeleton className="h-4 w-80" /><Skeleton className="h-3 w-56" /></div></div>
          </div>
          <div className="p-6 space-y-3"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/3" /></div>
        </div>
      </div>
    );
  }
  if (!data) return <div className="flex h-screen"><Sidebar /><div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Person not found</div></div>;

  const { prospect, briefs, scores, events, approvals, intro_requests } = data;
  const from = search.get('from');
  const backHref = from && from.startsWith('/') ? from : prospect.icp_profile_id ? `/icp/${prospect.icp_profile_id}` : '/prospecting';
  const backLabel = from && from.startsWith('/') ? 'Back' : prospect.icp_profile_id ? (prospect.list_name || 'List') : 'Prospects';
  const tabBtn = (t: Tab, label: string, badge?: number) => (
    <button type="button" onClick={() => setTab(t)} className="px-3 py-2 text-sm -mb-px border-b-2"
      style={{ borderColor: tab === t ? 'var(--accent)' : 'transparent', color: tab === t ? 'var(--text)' : 'var(--text-muted)', fontWeight: tab === t ? 600 : 400 }}>
      {label}{badge ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{badge}</span> : null}
    </button>
  );
  const pendingCount = approvals.filter((a) => a.status === 'pending').length;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <ProfileHero p={prospect} backHref={backHref} backLabel={backLabel} onChanged={refresh}
          researching={researching} onResearch={researchNow} enriching={enriching} onEnrich={enrichNow} converting={converting} onConvert={convertToDeal} />
        <div className="px-6 border-b flex items-center gap-1" style={{ borderColor: 'var(--border)' }}>
          {tabBtn('brief', 'Brief')}
          {tabBtn('journey', 'Journey', pendingCount)}
          {tabBtn('activity', 'Activity')}
        </div>
        {flash && (
          <p className="mx-6 mt-4 text-xs p-2.5 rounded-lg" style={{ color: flash.kind === 'error' ? 'var(--red)' : 'var(--text)', background: flash.kind === 'error' ? 'color-mix(in srgb, var(--red) 10%, transparent)' : 'var(--bg-input)' }}>{flash.text}</p>
        )}
        <div className="px-6 pb-10 max-w-6xl">
          {tab === 'brief' && (
            brief ? <LeadBrief b={brief} researching={researching} onResearch={researchNow} enriching={enriching} onEnrich={enrichNow} />
              : briefErr ? <p className="py-6 text-sm" style={{ color: 'var(--red)' }}>{briefErr}</p>
              : <div className="py-6 space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
          )}
          {tab === 'journey' && (
            <div className="pt-5">
              <JourneyTab prospect={prospect} briefs={briefs} scores={scores} approvals={approvals} intros={intro_requests}
                teammatesWithLinkedin={data.teammates_with_linkedin}
                acting={{ as, setAs, viewer: data.viewer, ownerCanSource: data.owner_can_source, viewerCanSource: data.viewer_can_source }}
                enriching={enriching} enrichNote={enrichNote} onEnrich={enrichNow} onChanged={refresh} />
            </div>
          )}
          {tab === 'activity' && (
            <div className="pt-5 max-w-2xl">
              {events.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No activity yet.</p> : (
                <ol className="space-y-3">
                  {events.map((e) => (
                    <li key={e.id} className="text-sm border-l-2 pl-3" style={{ borderColor: 'var(--accent)' }}>
                      <div className="flex items-center justify-between gap-3"><span className="font-medium">{e.event_type.replace(/_/g, ' ')}</span><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{relativeTime(e.created_at)}</span></div>
                      {e.from_stage && e.to_stage && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.from_stage} → {e.to_stage}</p>}
                      {e.reason && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.reason}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
