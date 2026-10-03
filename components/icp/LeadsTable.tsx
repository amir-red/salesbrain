'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PROSPECT_STAGES } from '@/lib/prospecting';
import { relativeTime } from '@/lib/time';
import { DegreeWarm } from '@/components/icp/IcpLeads';
import { CONNECT_COLOR, CONNECT_LABEL, connectState, type ConnectState } from '@/lib/connect';

export interface Lead {
  id: string; stage: string; icp_score: number | null; fit_label: string | null;
  qualification_reason: string | null; research_summary: string | null;
  source_type: string | null; source_detail: string | null; created_at: string; scored_at: string | null;
  engaged_at: string | null; converted_deal_id: string | null;
  full_name: string | null; title: string | null; email: string | null; linkedin_url: string | null;
  company_name: string | null; industry: string | null; company_size: string | null;
  network_degree: string | null;
  warm_paths: { type: string; value?: string; note: string }[] | null;
  linkedin_public_id: string | null;
  invite_status: string | null; invite_sent_at: string | null; invite_source: string | null;
  invite_error: string | null; connect_approval: string | null;
}
interface ConnectInfo {
  linkedin: boolean; enabled: boolean; per_day: number; per_week: number; no_answer_after_days: number;
  sent_today: number; sent_week: number; queued: number;
}
interface Payload { leads: Lead[]; counts: { total: number }; connect?: ConnectInfo }

const CONNECT_FILTERS: ConnectState[] = ['not_invited', 'awaiting_approval', 'pending', 'no_answer', 'connected', 'not_accepted', 'failed', 'no_profile'];

const fitColor = (s: number | null) =>
  s === null ? 'var(--text-muted)' : s >= 75 ? 'var(--green)' : s >= 60 ? 'var(--yellow)' : s >= 40 ? 'var(--orange)' : 'var(--red)';

/**
 * The ICP's list, best fit first, with the stage / score / warm filters and a
 * coverage strip per lead (employer · research · email · warm angle · route)
 * so what the Enricher and the router still owe is visible per row. Fetches
 * on its own (filters are local); `tick` from the page's poll re-fetches it.
 */
export default function LeadsTable({ icpId, tick = 0 }: { icpId: string; tick?: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [stage, setStage] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [warmOnly, setWarmOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [conn, setConn] = useState<'' | ConnectState>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/icp/${icpId}/leads?` + new URLSearchParams({
      ...(stage ? { stage } : {}),
      ...(minScore ? { min_score: String(minScore) } : {}),
      ...(warmOnly ? { warm: '1' } : {}),
    }).toString());
    if (res.ok) setData(await res.json());
  }, [icpId, stage, minScore, warmOnly]);
  useEffect(() => { load(); }, [load, tick]);

  const noAnswer = data?.connect?.no_answer_after_days;
  const stateOf = (l: Lead) => connectState(l, noAnswer);
  const tally = (data?.leads ?? []).reduce<Record<string, number>>((acc, l) => {
    const st = stateOf(l); acc[st] = (acc[st] ?? 0) + 1; return acc;
  }, {});
  const shown = (data?.leads ?? []).filter((l) => !conn || stateOf(l) === conn);
  const c = data?.connect;
  const room = c ? Math.max(0, Math.min(c.per_day - c.sent_today, c.per_week - c.sent_week) - c.queued) : 0;

  // Both actions only FILE a request for approval; the owner's 👍 sends it.
  const post = async (key: string, url: string, body: Record<string, unknown>) => {
    setBusy(key); setMsg(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      setMsg(out.error ? `Not filed: ${out.error}` : (out.note || 'Filed for approval.'));
      await load();
    } finally { setBusy(null); }
  };
  const connectOne = (l: Lead) => {
    const note = window.prompt(
      `Connection request to ${l.full_name || 'this person'}.\n\nOptional note (max 200 characters, no pitch). Leave empty for a plain request.`, '');
    if (note === null) return;
    void post(l.id, `/api/prospects/${l.id}/connect`, { note });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span>{data ? `${shown.length} shown` : 'Loading…'}</span>
        <label className="ml-auto flex items-center gap-2">
          LinkedIn
          <select value={conn} onChange={(e) => setConn(e.target.value as '' | ConnectState)} className="px-2 py-1 rounded text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="">any</option>
            {CONNECT_FILTERS.map((st) => <option key={st} value={st}>{CONNECT_LABEL[st]} ({tally[st] ?? 0})</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          stage
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="px-2 py-1 rounded text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="">any</option>
            {PROSPECT_STAGES.map((s) => <option key={s.stage} value={s.stage}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          min score
          <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="px-2 py-1 rounded text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value={0}>any</option><option value={40}>40 weak+</option><option value={60}>60 proceed+</option><option value={75}>75 strong</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={warmOnly} onChange={(e) => setWarmOnly(e.target.checked)} /> warm only
        </label>
      </div>

      {data && c && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <span className="font-medium" style={{ color: 'var(--text)' }}>LinkedIn connections</span>
          {(['connected', 'pending', 'awaiting_approval', 'no_answer', 'not_accepted', 'not_invited'] as ConnectState[]).map((st) => (
            <button key={st} onClick={() => setConn(conn === st ? '' : st)} style={{ color: tally[st] ? CONNECT_COLOR[st] : 'var(--text-muted)', textDecoration: conn === st ? 'underline' : 'none' }}>
              {tally[st] ?? 0} {CONNECT_LABEL[st].toLowerCase()}
            </button>
          ))}
          <span className="ml-auto">
            {c.linkedin ? `${c.sent_today}/${c.per_day} sent today · ${c.sent_week}/${c.per_week} this week` : 'no LinkedIn account connected'}
          </span>
          <button
            onClick={() => post('batch', `/api/icp/${icpId}/connect`, { limit: room })}
            disabled={busy !== null || !c.linkedin || !c.enabled || room <= 0 || !(tally.not_invited > 0)}
            title={room <= 0 ? 'Today\'s limit is reached or already queued for approval' : 'Files requests for approval — nothing is sent until each one is approved'}
            className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            {busy === 'batch' ? 'Filing…' : `Queue next ${room > 0 ? room : ''} for approval`}
          </button>
        </div>
      )}
      {msg && <div className="text-xs" style={{ color: msg.startsWith('Not filed') ? 'var(--red)' : 'var(--text-muted)' }}>{msg}</div>}

      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {data && data.leads.length === 0 && (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Nothing here. The Leads Finder fills the list on its next tick, or click <b>Find more now</b>.
          </div>
        )}
        {data && data.leads.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                <th className="text-left p-2 font-medium text-xs">Person</th>
                <th className="text-left p-2 font-medium text-xs">Company</th>
                <th className="text-left p-2 font-medium text-xs">Fit</th>
                <th className="text-left p-2 font-medium text-xs">Stage</th>
                <th className="text-left p-2 font-medium text-xs" title="LinkedIn connection request: sent, accepted, no answer">LinkedIn</th>
                <th className="text-left p-2 font-medium text-xs" title="employer · research · email · warm angle · route">Coverage</th>
                <th className="text-left p-2 font-medium text-xs">Found</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const cs = stateOf(l);
                const csTitle = cs === 'failed' ? (l.invite_error || 'the request could not be sent')
                  : cs === 'connected' ? (l.invite_status === 'accepted' ? 'accepted our request' : '1st-degree connection')
                  : l.invite_sent_at ? `sent ${relativeTime(l.invite_sent_at)}${l.invite_source === 'linkedin' ? ' · by hand in LinkedIn' : ''}`
                  : cs === 'awaiting_approval' ? 'filed — waiting for the owner to approve' : '';
                const warm = (l.warm_paths || []).filter((w) => w.type !== 'route');
                const route = (l.warm_paths || []).find((w) => w.type === 'route') as { path_available?: boolean } | undefined;
                const dots: { k: string; on: boolean; title: string }[] = [
                  { k: 'E', on: Boolean(l.company_name), title: l.company_name ? `employer: ${l.company_name}` : 'employer unknown' },
                  { k: 'R', on: Boolean(l.research_summary), title: l.research_summary ? 'researched' : 'not researched' },
                  { k: '@', on: Boolean(l.email), title: l.email ? `email: ${l.email}` : 'no email' },
                  { k: '🔥', on: warm.length > 0, title: warm.length ? warm.map((w) => w.note).join(' · ') : 'no warm angle' },
                  { k: '↝', on: Boolean(route?.path_available), title: route ? (route.path_available ? 'warm route found' : 'route computed: none') : 'route not computed' },
                ];
                const stageLabel = PROSPECT_STAGES.find((s) => s.stage === l.stage)?.label ?? l.stage;
                return (
                  <FragmentRow key={l.id}>
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="p-2">
                        <Link href={`/prospects/${l.id}`} className="font-medium hover:underline">{l.full_name || '—'}</Link>
                        <div className="text-xs truncate max-w-[320px]" style={{ color: 'var(--text-muted)' }}>{l.title || '—'}</div>
                        {l.linkedin_url && <a href={l.linkedin_url.startsWith('http') ? l.linkedin_url : `https://linkedin.com/in/${l.linkedin_url}`} target="_blank" rel="noreferrer" className="text-[10px] underline" style={{ color: 'var(--accent)' }}>LinkedIn ↗</a>}
                        <DegreeWarm degree={l.network_degree} paths={l.warm_paths} />
                      </td>
                      <td className="p-2 text-xs">
                        <div>{l.company_name || '—'}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{[l.industry, l.company_size].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="p-2">
                        <button onClick={() => setOpen(open === l.id ? null : l.id)} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${fitColor(l.icp_score)} 14%, transparent)`, color: fitColor(l.icp_score) }} title="why?">
                          {l.icp_score ?? '—'} · {(l.fit_label || 'unscored').replace(/_/g, ' ')}
                        </button>
                      </td>
                      <td className="p-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {stageLabel}
                        {l.converted_deal_id && <Link href={`/deals/${l.converted_deal_id}`} className="ml-1 underline" style={{ color: 'var(--accent)' }}>deal→</Link>}
                      </td>
                      <td className="p-2 text-[10px] whitespace-nowrap">
                        <span title={csTitle} className="px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${CONNECT_COLOR[cs]} 14%, transparent)`, color: CONNECT_COLOR[cs] }}>
                          {CONNECT_LABEL[cs]}{(cs === 'pending' || cs === 'no_answer') && l.invite_sent_at ? ` · ${relativeTime(l.invite_sent_at)}` : ''}
                        </span>
                        {(cs === 'not_invited' || cs === 'not_accepted' || cs === 'failed') && l.linkedin_public_id && c?.linkedin && (
                          <button onClick={() => connectOne(l)} disabled={busy !== null} className="ml-1.5 underline disabled:opacity-40" style={{ color: 'var(--accent)' }}>
                            {busy === l.id ? '…' : cs === 'not_invited' ? 'Connect' : 'Ask again'}
                          </button>
                        )}
                      </td>
                      <td className="p-2">
                        <span className="inline-flex gap-1">
                          {dots.map((d) => (
                            <span key={d.k} title={d.title} className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-medium"
                                  style={{ background: d.on ? 'rgba(34,197,94,0.15)' : 'var(--bg-input)', color: d.on ? 'var(--green)' : 'var(--text-muted)', opacity: d.on ? 1 : 0.6 }}>
                              {d.k}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="p-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>{relativeTime(l.created_at)}</td>
                    </tr>
                    {open === l.id && (
                      <tr style={{ background: 'var(--bg-card)' }}>
                        <td colSpan={7} className="p-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {(l.qualification_reason || 'no reasons recorded').split('; ').map((r, i) => <div key={i}>· {r}</div>)}
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// A keyed fragment for the row + its expandable "why?" row.
function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }
