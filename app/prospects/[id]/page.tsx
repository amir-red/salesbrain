'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { PROSPECT_STAGES } from '@/lib/prospecting';
import { relativeTime, formatDate } from '@/lib/time';

interface Prospect {
  id: string;
  stage: string;
  icp_score: number | null;
  fit_label: string | null;
  qualification_reason: string | null;
  research_summary: string | null;
  reply_status: string | null;
  next_action_at: string | null;
  last_contacted_at: string | null;
  last_replied_at: string | null;
  converted_deal_id: string | null;
  archived_reason: string | null;
  source_type: string | null;
  source_detail: string | null;
  created_at: string;
  company_name: string | null;
  domain: string | null;
  industry: string | null;
  company_size: string | null;
  hq_location: string | null;
  website: string | null;
  full_name: string | null;
  email: string | null;
  title: string | null;
  seniority: string | null;
  persona_type: string | null;
  phone: string | null;
  linkedin_url: string | null;
  owner_name: string | null;
}
interface Brief {
  id: string;
  summary: string | null;
  pain_hypotheses: string | null;
  why_now_signals: string | null;
  outreach_angle: string | null;
  talking_points: string | null;
  risks: string | null;
  created_at: string;
}
interface Score {
  id: string;
  total_score: number | null;
  verdict: string | null;
  reason_codes: string[] | null;
  disqualifiers: string[] | null;
  created_at: string;
}
interface Message {
  id: string;
  direction: string;
  status: string;
  subject: string | null;
  body: string;
  to_email: string | null;
  sent_at: string | null;
  created_at: string;
}
interface Event {
  id: string;
  event_type: string;
  from_stage: string | null;
  to_stage: string | null;
  reason: string | null;
  triggered_by: string | null;
  created_at: string;
}

export default function ProspectDetailPage() {
  const params = useParams();
  const prospectId = params.id as string;
  const [data, setData] = useState<{ prospect: Prospect; briefs: Brief[]; scores: Score[]; messages: Message[]; events: Event[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prospects/${prospectId}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [prospectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const convertToDeal = async () => {
    setConverting(true);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const result = await res.json();
      if (result.deal_id) {
        window.location.href = `/deals/${result.deal_id}`;
      }
    } finally { setConverting(false); }
  };

  const approveMessage = async (id: string) => {
    await fetch(`/api/outreach/${id}/approve`, { method: 'POST' });
    fetchData();
  };
  const sendMessage = async (id: string) => {
    await fetch(`/api/outreach/${id}/send`, { method: 'POST' });
    fetchData();
  };

  if (loading) {
    return <div className="flex h-screen"><Sidebar /><div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Loading...</div></div>;
  }
  if (!data) {
    return <div className="flex h-screen"><Sidebar /><div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Prospect not found</div></div>;
  }

  const { prospect, briefs, scores, messages, events } = data;
  const stageSpec = PROSPECT_STAGES.find((s) => s.stage === prospect.stage);
  const canConvert = !prospect.converted_deal_id && (prospect.icp_score ?? 0) >= 40;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-4">
            <Link href="/prospecting" className="px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              ← Prospecting
            </Link>
            <div>
              <h1 className="text-xl font-bold">{prospect.full_name || '—'}{prospect.title ? ` · ${prospect.title}` : ''}</h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {prospect.company_name || '—'}{prospect.domain ? ` · ${prospect.domain}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              {prospect.stage} · {stageSpec?.label}
            </span>
            {prospect.converted_deal_id ? (
              <Link href={`/deals/${prospect.converted_deal_id}`} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--green)', color: '#fff' }}>
                View Deal →
              </Link>
            ) : (
              <button
                onClick={convertToDeal}
                disabled={!canConvert || converting}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: canConvert ? 'var(--accent)' : 'var(--border)', color: canConvert ? '#fff' : 'var(--text-muted)', opacity: converting ? 0.6 : 1 }}
              >
                {converting ? 'Converting...' : 'Convert to Deal'}
              </button>
            )}
          </div>
        </div>

        <div className="p-6 grid grid-cols-3 gap-6">
          {/* Left column — Account + Contact */}
          <div className="space-y-4">
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Account</h3>
              <p className="text-sm font-medium">{prospect.company_name || '—'}</p>
              {prospect.industry && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Industry: {prospect.industry}</p>}
              {prospect.company_size && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Size: {prospect.company_size}</p>}
              {prospect.hq_location && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>HQ: {prospect.hq_location}</p>}
              {prospect.website && <p className="text-xs" style={{ color: 'var(--accent)' }}>{prospect.website}</p>}
            </div>

            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Contact</h3>
              <p className="text-sm font-medium">{prospect.full_name || '—'}</p>
              {prospect.title && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{prospect.title}</p>}
              {prospect.email && <p className="text-xs" style={{ color: 'var(--accent)' }}>{prospect.email}</p>}
              {prospect.phone && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{prospect.phone}</p>}
              {prospect.seniority && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Seniority: {prospect.seniority}</p>}
              {prospect.persona_type && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Persona: {prospect.persona_type}</p>}
            </div>

            {scores.length > 0 && (
              <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>ICP Fit</h3>
                <div className="text-2xl font-bold">{scores[0].total_score ?? '—'}</div>
                <p className="text-xs mt-1 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{scores[0].verdict?.replace(/_/g, ' ')}</p>
                {scores[0].reason_codes && scores[0].reason_codes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {scores[0].reason_codes.map((r, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{r}</span>
                    ))}
                  </div>
                )}
                {scores[0].disqualifiers && scores[0].disqualifiers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {scores[0].disqualifiers.map((r, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--red)', color: '#fff', opacity: 0.8 }}>{r}</span>
                    ))}
                  </div>
                )}
                {prospect.qualification_reason && (
                  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{prospect.qualification_reason}</p>
                )}
              </div>
            )}
          </div>

          {/* Middle column — Research brief + Outreach */}
          <div className="space-y-4">
            {briefs.length > 0 && (
              <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Research Brief</h3>
                {briefs[0].summary && <p className="text-sm mb-2">{briefs[0].summary}</p>}
                {briefs[0].pain_hypotheses && <div className="mt-2"><p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Pains</p><p className="text-xs">{briefs[0].pain_hypotheses}</p></div>}
                {briefs[0].outreach_angle && <div className="mt-2"><p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Angle</p><p className="text-xs">{briefs[0].outreach_angle}</p></div>}
                {briefs[0].talking_points && <div className="mt-2"><p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Talking points</p><p className="text-xs whitespace-pre-wrap">{briefs[0].talking_points}</p></div>}
                {briefs[0].risks && <div className="mt-2"><p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Risks</p><p className="text-xs">{briefs[0].risks}</p></div>}
              </div>
            )}

            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Outreach History</h3>
              {messages.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No outreach yet. Ask the AI to draft a message.</p>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <div key={m.id} className="text-xs border-l-2 pl-3" style={{ borderColor: m.direction === 'outbound' ? 'var(--accent)' : 'var(--green)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium" style={{ color: m.direction === 'outbound' ? 'var(--accent)' : 'var(--green)' }}>
                          {m.direction} · {m.status}
                        </span>
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
                      {m.status === 'approved' && (
                        <button onClick={() => sendMessage(m.id)} className="mt-2 text-[10px] px-2 py-1 rounded" style={{ background: 'var(--green)', color: '#fff' }}>Send Now</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column — Events timeline */}
          <div className="space-y-4">
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Meta</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Source: {prospect.source_type || '—'}</p>
              {prospect.source_detail && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{prospect.source_detail}</p>}
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Owner: {prospect.owner_name || '—'}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Created: {formatDate(prospect.created_at)}</p>
              {prospect.last_contacted_at && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Last contacted: {relativeTime(prospect.last_contacted_at)}</p>}
              {prospect.last_replied_at && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Last replied: {relativeTime(prospect.last_replied_at)}</p>}
              {prospect.next_action_at && <p className="text-xs" style={{ color: 'var(--accent)' }}>Next action: {formatDate(prospect.next_action_at)}</p>}
            </div>

            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Activity</h3>
              {events.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No activity yet</p>
              ) : (
                <div className="space-y-2">
                  {events.map((e) => (
                    <div key={e.id} className="text-xs border-l-2 pl-2" style={{ borderColor: 'var(--accent)' }}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{e.event_type}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{relativeTime(e.created_at)}</span>
                      </div>
                      {e.from_stage && e.to_stage && (
                        <p style={{ color: 'var(--text-muted)' }}>{e.from_stage} → {e.to_stage}</p>
                      )}
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
