'use client';

import Link from 'next/link';
import { useRef } from 'react';
import JourneyStepper from '@/components/prospect/JourneyStepper';
import RoutePanel from '@/components/prospect/RoutePanel';
import ApprovalsPanel from '@/components/prospect/ApprovalsPanel';
import type { LeadApproval } from '@/components/prospect/ApprovalsPanel';
import TrustCard from '@/components/prospect/TrustCard';
import { journeyState, routeEntry, warmAngles } from '@/lib/prospects';
import type { ActAs, IntroRequestLite, JourneyKey, Prospect } from '@/lib/prospects';
import { relativeTime, formatDate } from '@/lib/time';

export interface ResearchBrief {
  id: string; summary: string | null; pain_hypotheses: string | null; why_now_signals: string | null;
  outreach_angle: string | null; talking_points: string | null; risks: string | null; created_at: string;
}
export interface Score { id: string; total_score: number | null; verdict: string | null; reason_codes: string[] | null; disqualifiers: string[] | null; created_at: string }
export interface IntroRequest extends IntroRequestLite { channel: string | null; path_id: string | null; created_at: string; replied_at: string | null; approval_id: string | null }

/**
 * The 2026-09 journey (1 Imported … 8 Deal), kept as it was behind the Journey tab (2026-11-09): the trust card,
 * fit, enrichment, the route graph, drafts and approvals, outreach history. The brief on the first tab answers the
 * seller's questions; this tab is the machinery.
 */
export default function JourneyTab({ prospect, briefs, scores, approvals, intros, teammatesWithLinkedin, acting, enriching, enrichNote, onEnrich, onChanged }: {
  prospect: Prospect; briefs: ResearchBrief[]; scores: Score[]; approvals: LeadApproval[]; intros: IntroRequest[]; teammatesWithLinkedin: number;
  acting: { as: ActAs; setAs: (a: ActAs) => void; viewer: { user_id: string; role: string; name: string }; ownerCanSource: boolean; viewerCanSource: boolean };
  enriching: boolean; enrichNote: string | null; onEnrich: () => void; onChanged: () => void;
}) {
  const refs = useRef<Partial<Record<JourneyKey, HTMLDivElement | null>>>({});
  const jump = (key: JourneyKey) => refs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const history = approvals.filter((a) => a.status === 'sent' || a.status === 'failed');
  const state = journeyState(prospect, approvals, intros);
  const route = routeEntry(prospect.warm_paths);
  const angles = warmAngles(prospect.warm_paths);
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)' } as const;
  const h3 = 'text-xs font-medium uppercase tracking-wider mb-2';
  const canConvert = !prospect.converted_deal_id && ((prospect.trust_total ?? 0) >= 50 || (prospect.icp_score ?? 0) >= 40);

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
    <div className="space-y-4">
      <JourneyStepper state={state} onJump={jump} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-4">
          <TrustCard prospectId={prospect.id} canResearch />
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

          <Section k="icp_fit" n={2} title="List fit">
            <div className="text-2xl font-bold">{prospect.icp_score ?? scores[0]?.total_score ?? '—'}</div>
            <p className="text-xs mt-1 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{(prospect.fit_label || scores[0]?.verdict || 'unscored').replace(/_/g, ' ')}</p>
            {scores[0]?.reason_codes && scores[0].reason_codes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">{scores[0].reason_codes.map((r, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{r}</span>)}</div>
            )}
            {scores[0]?.disqualifiers && scores[0].disqualifiers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">{scores[0].disqualifiers.map((r, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--red)', color: 'var(--accent-fg)', opacity: 0.8 }}>{r}</span>)}</div>
            )}
            {prospect.qualification_reason && <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{prospect.qualification_reason}</p>}
          </Section>

          <Section k="enriched" n={3} title="Enriched" right={<button onClick={onEnrich} disabled={enriching} className="px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>{enriching ? 'Enriching…' : 'Enrich now'}</button>}>
            {enrichNote && <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>{enrichNote}</p>}
            <div className="text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
              <div>Employer: <b style={{ color: prospect.company_name ? 'var(--text)' : 'inherit' }}>{prospect.company_name || 'unknown'}</b></div>
              <div>Email: <b style={{ color: prospect.email ? 'var(--text)' : 'inherit' }}>{prospect.email || 'none on file'}</b></div>
              <div>Research: <b style={{ color: prospect.research_summary ? 'var(--text)' : 'inherit' }}>{prospect.research_summary ? 'done' : 'not yet'}</b></div>
            </div>
            {prospect.research_summary && (
              <details className="mt-2 text-xs"><summary className="cursor-pointer" style={{ color: 'var(--accent)' }}>Full research</summary><p className="mt-1 whitespace-pre-wrap">{prospect.research_summary}</p></details>
            )}
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

        <div className="space-y-4">
          <Section k="route" n={4} title="Route — how to reach them">
            <RoutePanel
              prospectId={prospect.id} route={route} intros={intros} degree={prospect.network_degree}
              teammatesWithLinkedin={teammatesWithLinkedin} onChanged={onChanged}
              acting={{ as: acting.as, setAs: acting.setAs, viewer: acting.viewer, owner: { user_id: prospect.owner_user_id ?? null, name: prospect.owner_name ?? null },
                        ownerCanSource: acting.ownerCanSource, viewerCanSource: acting.viewerCanSource }}
            />
          </Section>

          <Section k="drafted" n={5} title="Drafts & approvals">
            <ApprovalsPanel approvals={approvals} onChanged={onChanged} />
            {intros.length > 0 && (
              <div className="mt-2 pt-2 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Intro asks</div>
                {intros.map((ir) => (
                  <div key={ir.id} className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    🤝 <b style={{ color: 'var(--text)' }}>{ir.connector_name}</b> · {ir.state.replace(/_/g, ' ')}{ir.channel ? ` · ${ir.channel}` : ''} · {relativeTime(ir.sent_at || ir.created_at)}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section k="sent" n={6} title="Outreach history">
            {history.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nothing sent through an approval yet. Hand-sent LinkedIn messages show in the brief&apos;s conversations.</p>
            ) : (
              <div className="space-y-3">
                {history.map((a) => (
                  <div key={a.id} className="text-xs border-l-2 pl-3" style={{ borderColor: a.status === 'sent' ? 'var(--accent)' : 'var(--red)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium" style={{ color: a.status === 'sent' ? 'var(--accent)' : 'var(--red)' }}>{a.kind === 'followup' ? 'follow-up' : a.kind === 'intro_request' ? 'intro ask' : a.kind === 'connect' ? 'connection request' : 'outreach'} · {a.channel} · {a.status}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{formatDate(a.sent_at || a.created_at)}</span>
                    </div>
                    {a.subject && <p className="font-medium">{a.subject}</p>}
                    <p className="whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>{a.message.slice(0, 300)}{a.message.length > 300 ? '...' : ''}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section k="replied" n={7} title="Reply">
            {prospect.last_replied_at
              ? <p className="text-xs">Replied {relativeTime(prospect.last_replied_at)}{prospect.reply_status ? ` · ${prospect.reply_status}` : ''}</p>
              : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{prospect.last_contacted_at ? `Waiting since ${relativeTime(prospect.last_contacted_at)}.` : 'Nothing sent yet.'} Replies on LinkedIn and email are picked up within the hour, and the follow-up timer stops when they write back.</p>}
            {prospect.next_action_at && <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>Next action: {formatDate(prospect.next_action_at)}</p>}
          </Section>

          <Section k="deal" n={8} title="Qualified → Opportunity">
            {prospect.converted_deal_id
              ? <Link href={`/deals/${prospect.converted_deal_id}`} className="text-xs underline" style={{ color: 'var(--accent)' }}>Open the opportunity →</Link>
              : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{canConvert ? 'Good enough to convert when they engage — the button is in the header.' : 'Needs a trust score of 50+ or a fit of 40+ to convert.'}</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}
