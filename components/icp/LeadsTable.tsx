'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PROSPECT_STAGES } from '@/lib/prospecting';
import { relativeTime } from '@/lib/time';
import { DegreeWarm } from '@/components/icp/IcpLeads';

export interface Lead {
  id: string; stage: string; icp_score: number | null; fit_label: string | null;
  qualification_reason: string | null; research_summary: string | null;
  source_type: string | null; source_detail: string | null; created_at: string; scored_at: string | null;
  engaged_at: string | null; converted_deal_id: string | null;
  full_name: string | null; title: string | null; email: string | null; linkedin_url: string | null;
  company_name: string | null; industry: string | null; company_size: string | null;
  network_degree: string | null;
  warm_paths: { type: string; value?: string; note: string }[] | null;
}
interface Payload { leads: Lead[]; counts: { total: number } }

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

  const load = useCallback(async () => {
    const res = await fetch(`/api/icp/${icpId}/leads?` + new URLSearchParams({
      ...(stage ? { stage } : {}),
      ...(minScore ? { min_score: String(minScore) } : {}),
      ...(warmOnly ? { warm: '1' } : {}),
    }).toString());
    if (res.ok) setData(await res.json());
  }, [icpId, stage, minScore, warmOnly]);
  useEffect(() => { load(); }, [load, tick]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span>{data ? `${data.leads.length} shown` : 'Loading…'}</span>
        <label className="ml-auto flex items-center gap-2">
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
                <th className="text-left p-2 font-medium text-xs" title="employer · research · email · warm angle · route">Coverage</th>
                <th className="text-left p-2 font-medium text-xs">Found</th>
              </tr>
            </thead>
            <tbody>
              {data.leads.map((l) => {
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
                        <button onClick={() => setOpen(open === l.id ? null : l.id)} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: `${fitColor(l.icp_score)}22`, color: fitColor(l.icp_score) }} title="why?">
                          {l.icp_score ?? '—'} · {(l.fit_label || 'unscored').replace(/_/g, ' ')}
                        </button>
                      </td>
                      <td className="p-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {stageLabel}
                        {l.converted_deal_id && <Link href={`/deals/${l.converted_deal_id}`} className="ml-1 underline" style={{ color: 'var(--accent)' }}>deal→</Link>}
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
                        <td colSpan={6} className="p-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
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
