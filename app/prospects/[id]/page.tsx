'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import JourneyStepper from '@/components/prospect/JourneyStepper';
import RoutePanel from '@/components/prospect/RoutePanel';
import ApprovalsPanel from '@/components/prospect/ApprovalsPanel';
import type { LeadApproval } from '@/components/prospect/ApprovalsPanel';
import { PROSPECT_STAGES } from '@/lib/prospecting';
import { journeyState, routeEntry, warmAngles } from '@/lib/prospects';
import type { ActAs, IntroRequestLite, JourneyKey, Prospect } from '@/lib/prospects';
import { relativeTime, formatDate } from '@/lib/time';

interface Brief {
  id: string; summary: string | null; pain_hypotheses: string | null; why_now_signals: string | null;
  outreach_angle: string | null; talking_points: string | null; risks: string | null; created_at: string;
}
interface Score { id: string; total_score: number | null; verdict: string | null; reason_codes: string[] | null; disqualifiers: string[] | null; created_at: string }
interface Message { id: string; direction: string; status: string; subject: string | null; body: string; to_email: string | null; sent_at: string | null; created_at: string }
interface Event { id: string; event_type: string; from_stage: string | null; to_stage: string | null; reason: string | null; triggered_by: string | null; created_at: string }
interface IntroRequest extends IntroRequestLite { channel: string | null; path_id: string | null; created_at: string; replied_at: string | null; approval_id: string | null }
interface Payload {
  prospect: Prospect; briefs: Brief[]; scores: Score[]; messages: Message[]; events: Event[];
  approvals: LeadApproval[]; intro_requests: IntroRequest[]; teammates_with_linkedin: number;
  acting_user_id: string; owner_can_source: boolean; viewer_can_source: boolean;
  viewer: { user_id: string; role: string; name: string };
}

/**
 * The lead's home — one page, the journey in order. Every stage is a panel;
 * the relationship graph appears exactly once, as step 5 (Route).
 */
export default function ProspectDetailPage() {
  const params = useParams();
  const prospectId = params.id as string;
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);
  // Whose graph/LinkedIn the route + enrich + intro actions run with (admins
  // on someone else's lead default to the owner).
  const [as, setAs] = useState<ActAs>('owner');
  const refs = useRef<Partial<Record<JourneyKey, HTMLDivElement | null>>>({});

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/prospects/${prospectId}?as=${as}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [prospectId, as]);
  useEffect(() => { fetchData(); }, [fetchData]);
  const refresh = () => fetchData(true);

  const convertToDeal = async () => {
    setConverting(true);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const result = await res.json();
      if (result.deal_id) window.location.href = `/deals/${result.deal_id}`;
    } finally { setConverting(false); }
  };
  const enrichNow = async () => {
    setEnriching(true); setEnrichNote(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/enrich`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ as }) });
      const out = await res.json();
      if (out.error) setEnrichNote(String(out.error));
      else {
        const bits = [];
        if (out.employer) bits.push(`employer: ${typeof out.employer === 'string' ? out.employer : 'set'}`);
        if (out.research?.researched) bits.push(`researched (fit ${out.research.icp_score})`);
        if (out.email?.written) bits.push('email found');
        else if (out.email?.note) bits.push(`email: ${out.email.note}`);
        setEnrichNote(bits.join(' · ') || 'Nothing new to add.');
      }
      refresh();
    } finally { setEnriching(false); }
  };
  const approveMessage = async (id: string) => { await fetch(`/api/outreach/${id}/approve`, { method: 'POST' }); refresh(); };
  const sendMessage = async (id: string) => { await fetch(`/api/outreach/${id}/send`, { method: 'POST' }); refresh(); };
  const jump = (key: JourneyKey) => refs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (loading) return <div className="flex h-screen"><Sidebar /><div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Loading...</div></div>;
  if (!data) return <div className="flex h-screen"><Sidebar /><div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Prospect not found</div></div>;

  const { prospect, briefs, scores, messages, events, approvals, intro_requests } = data;
  const stageSpec = PROSPECT_STAGES.find((s) => s.stage === prospect.stage);
  const canConvert = !prospect.converted_deal_id && (prospect.icp_score ?? 0) >= 40;
  const state = journeyState(prospect, approvals, intro_requests);
  const route = routeEntry(prospect.warm_paths);
  const angles = warmAngles(prospect.warm_paths);
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)' } as const;
  const h3 = 'text-xs font-medium uppercase tracking-wider mb-2';

  const Section = ({ k, n, title, right, children }: { k: JourneyKey; n: number; title: string; right?: React.ReactNode; children: React.ReactNode }) => (
    <div ref={(el) => { refs.current[k] = el; }} className="rounded-xl p-4" style={{ ...card, borderColor: state[k] === 'current' ? 'var(--accent)' : 'var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={h3} style={{ color: state[k] === 'done' ? 'var(--green)' : state[k] === 'current' ? 'var(--accent)' : 'var(--text-muted)', marginBottom: 0 }}>{n}. {title}</h3>
        {right}
      </div>
      {children}
    </div>
  );

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b space-y-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/prospecting" className="px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>← Prospecting</Link>
              <div>
                <h1 className="text-xl font-bold">{prospect.full_name || '—'}{prospect.title ? ` · ${prospect.title}` : ''}</h1>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {prospect.company_name || '—'}{prospect.domain ? ` · ${prospect.domain}` : ''}
                  {prospect.linkedin_url && <> · <a href={prospect.linkedin_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>LinkedIn ↗</a></>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded" style={card}>{prospect.stage} · {stageSpec?.label}</span>
              {prospect.converted_deal_id ? (
                <Link href={`/deals/${prospect.converted_deal_id}`} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--green)', color: '#fff' }}>View Deal →</Link>
              ) : (
                <button onClick={convertToDeal} disabled={!canConvert || converting} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: canConvert ? 'var(--accent)' : 'var(--border)', color: canConvert ? '#fff' : 'var(--text-muted)', opacity: converting ? 0.6 : 1 }}>
                  {converting ? 'Converting...' : 'Convert to Deal'}
                </button>
              )}
            </div>
          </div>
          <JourneyStepper state={state} onJump={jump} />
        </div>

        <div className="p-6 grid grid-cols-3 gap-6">
          {/* Left — who they are, fit, enrichment */}
          <div className="space-y-4">
            <Section k="imported" n={1} title="Who">
              <p className="text-sm font-medium">{prospect.full_name || '—'}</p>
              {prospect.title && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{prospect.title}</p>}
              {prospect.email && <p className="text-xs" style={{ color: 'var(--accent)' }}>{prospect.email}</p>}
              {prospect.phone && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{prospect.phone}</p>}
              <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-sm font-medium">{prospect.company_name || '—'}</p>
                {prospect.industry && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{prospect.industry}{prospect.company_size ? ` · ${prospect.company_size}` : ''}</p>}
                {prospect.hq_location && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>HQ: {prospect.hq_location}</p>}
                {prospect.website && <p className="text-xs" style={{ color: 'var(--accent)' }}>{prospect.website}</p>}
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>Source: {prospect.source_type || '—'}{prospect.source_detail ? ` · ${prospect.source_detail}` : ''} · {formatDate(prospect.created_at)} · owner {prospect.owner_name || '—'}</p>
            </Section>

            <Section k="icp_fit" n={2} title="ICP fit">
              <div className="text-2xl font-bold">{prospect.icp_score ?? scores[0]?.total_score ?? '—'}</div>
              <p className="text-xs mt-1 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{(prospect.fit_label || scores[0]?.verdict || 'unscored').replace(/_/g, ' ')}</p>
              {scores[0]?.reason_codes && scores[0].reason_codes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">{scores[0].reason_codes.map((r, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{r}</span>)}</div>
              )}
              {scores[0]?.disqualifiers && scores[0].disqualifiers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">{scores[0].disqualifiers.map((r, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--red)', color: '#fff', opacity: 0.8 }}>{r}</span>)}</div>
              )}
              {prospect.qualification_reason && <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{prospect.qualification_reason}</p>}
            </Section>

            <Section k="enriched" n={3} title="Enriched" right={<button onClick={enrichNow} disabled={enriching} className="px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>{enriching ? 'Enriching…' : 'Enrich now'}</button>}>
              {enrichNote && <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>{enrichNote}</p>}
              <div className="text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
                <div>Employer: <b style={{ color: prospect.company_name ? 'var(--text)' : 'inherit' }}>{prospect.company_name || 'unknown'}</b></div>
                <div>Email: <b style={{ color: prospect.email ? 'var(--text)' : 'inherit' }}>{prospect.email || 'none on file'}</b></div>
                <div>Research: <b style={{ color: prospect.research_summary ? 'var(--text)' : 'inherit' }}>{prospect.research_summary ? 'done' : 'not yet'}</b></div>
              </div>
              {prospect.research_summary && <p className="text-xs mt-2">{prospect.research_summary}</p>}
              {briefs[0] && (
                <div className="mt-2 space-y-1">
                  {briefs[0].outreach_angle && <div><p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Angle</p><p className="text-xs">{briefs[0].outreach_angle}</p></div>}
                  {briefs[0].talking_points && <div><p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Talking points</p><p className="text-xs whitespace-pre-wrap">{briefs[0].talking_points}</p></div>}
                </div>
              )}
              {angles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">{angles.map((w, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" title={w.note} style={{ background: 'var(--bg-input)', color: 'var(--green)' }}>🔥 {w.type}{w.value ? `: ${w.value}` : ''}</span>)}</div>
              )}
            </Section>
          </div>

          {/* Middle — the route and the drafts */}
          <div className="space-y-4">
            <Section k="route" n={4} title="Route — how to reach them">
              <RoutePanel
                prospectId={prospectId} route={route} intros={intro_requests} degree={prospect.network_degree}
                teammatesWithLinkedin={data.teammates_with_linkedin} onChanged={refresh}
                acting={{ as, setAs, viewer: data.viewer, owner: { user_id: prospect.owner_user_id ?? null, name: prospect.owner_name ?? null },
                          ownerCanSource: data.owner_can_source, viewerCanSource: data.viewer_can_source }}
              />
            </Section>

            <Section k="drafted" n={5} title="Drafts & approvals">
              <ApprovalsPanel approvals={approvals} onChanged={refresh} />
              {intro_requests.length > 0 && (
                <div className="mt-2 pt-2 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Intro asks</div>
                  {intro_requests.map((ir) => (
                    <div key={ir.id} className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      🤝 <b style={{ color: 'var(--text)' }}>{ir.connector_name}</b> · {ir.state.replace(/_/g, ' ')}{ir.channel ? ` · ${ir.channel}` : ''} · {relativeTime(ir.sent_at || ir.created_at)}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section k="sent" n={6} title="Outreach history">
              {messages.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No cold messages yet. Ask the AI to draft one, or use a route above.</p>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <div key={m.id} className="text-xs border-l-2 pl-3" style={{ borderColor: m.direction === 'outbound' ? 'var(--accent)' : 'var(--green)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium" style={{ color: m.direction === 'outbound' ? 'var(--accent)' : 'var(--green)' }}>{m.direction} · {m.status}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{formatDate(m.created_at)}</span>
                      </div>
                      {m.subject && <p className="font-medium">{m.subject}</p>}
                      <p className="whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>{m.body.slice(0, 300)}{m.body.length > 300 ? '...' : ''}</p>
                      {m.status === 'draft' && (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => approveMessage(m.id)} className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--accent)', color: '#fff' }}>Approve</button>
                          <button onClick={() => sendMessage(m.id)} className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--green)', color: '#fff' }}>Approve & Send</button>
                        </div>
                      )}
                      {m.status === 'approved' && <button onClick={() => sendMessage(m.id)} className="mt-2 text-[10px] px-2 py-1 rounded" style={{ background: 'var(--green)', color: '#fff' }}>Send Now</button>}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* Right — what happens after */}
          <div className="space-y-4">
            <Section k="replied" n={7} title="Reply">
              {prospect.last_replied_at
                ? <p className="text-xs">Replied {relativeTime(prospect.last_replied_at)}{prospect.reply_status ? ` · ${prospect.reply_status}` : ''}</p>
                : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{prospect.last_contacted_at ? `Waiting since ${relativeTime(prospect.last_contacted_at)}.` : 'Nothing sent yet.'} Reply detection is not automatic yet — mark it from the chat when they write back.</p>}
              {prospect.next_action_at && <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>Next action: {formatDate(prospect.next_action_at)}</p>}
            </Section>

            <Section k="deal" n={8} title="Qualified → Deal">
              {prospect.converted_deal_id
                ? <Link href={`/deals/${prospect.converted_deal_id}`} className="text-xs underline" style={{ color: 'var(--accent)' }}>Open the deal →</Link>
                : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{canConvert ? 'Fit is good enough — convert when they engage.' : 'Needs a fit score of 40+ to convert.'}</p>}
            </Section>

            <div className="rounded-xl p-4" style={card}>
              <h3 className={h3} style={{ color: 'var(--text-muted)' }}>Activity</h3>
              {events.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No activity yet</p> : (
                <div className="space-y-2">
                  {events.map((e) => (
                    <div key={e.id} className="text-xs border-l-2 pl-2" style={{ borderColor: 'var(--accent)' }}>
                      <div className="flex items-center justify-between"><span className="font-medium">{e.event_type}</span><span style={{ color: 'var(--text-muted)' }}>{relativeTime(e.created_at)}</span></div>
                      {e.from_stage && e.to_stage && <p style={{ color: 'var(--text-muted)' }}>{e.from_stage} → {e.to_stage}</p>}
                      {e.reason && <p style={{ color: 'var(--text-muted)' }}>{e.reason}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
