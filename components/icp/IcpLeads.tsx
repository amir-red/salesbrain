'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RUN_STATUS_COLOR } from '@/lib/icp';
import type { AgentRun, IcpAgentState, IcpProfile } from '@/lib/icp';
import { relativeTime } from '@/lib/time';

interface Lead {
  id: string; stage: string; icp_score: number | null; fit_label: string | null;
  qualification_reason: string | null; research_summary: string | null;
  source_type: string | null; source_detail: string | null; created_at: string; scored_at: string | null;
  engaged_at: string | null; converted_deal_id: string | null;
  full_name: string | null; title: string | null; email: string | null; linkedin_url: string | null;
  company_name: string | null; industry: string | null; company_size: string | null;
}
interface Payload {
  icp: { id: string; name: string };
  leads: Lead[];
  counts: { total: number; strong: number; proceed: number; researched: number; engaged: number; archived: number };
  agent_state: IcpAgentState | null;
  last_run: AgentRun | null;
  queued_runs: number;
}

const fitColor = (s: number | null) =>
  s === null ? 'var(--text-muted)' : s >= 75 ? 'var(--green)' : s >= 60 ? 'var(--yellow)' : s >= 40 ? 'var(--orange)' : 'var(--red)';

/** Gojiberry's Leads + Activity tabs for one ICP: the list the agent fills, and what it did. */
export default function IcpLeads({ profile, onRun }: { profile: IcpProfile; onRun: (mode: 'now' | 'queue' | 'enrich') => Promise<unknown> }) {
  const [data, setData] = useState<Payload | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [tab, setTab] = useState<'leads' | 'activity'>('leads');
  const [minScore, setMinScore] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`/api/icp/${profile.id}/leads${minScore ? `?min_score=${minScore}` : ''}`),
      fetch(`/api/icp/${profile.id}/activity`),
    ]);
    if (a.ok) setData(await a.json());
    if (b.ok) setRuns(await b.json());
  }, [profile.id, minScore]);
  useEffect(() => { load(); }, [load]);

  const run = async (mode: 'now' | 'queue' | 'enrich') => {
    setBusy(mode); setNote(null);
    try {
      const out = (await onRun(mode)) as Record<string, unknown>;
      if (out?.error) setNote(String(out.error));
      else if (mode === 'enrich') setNote(String(out?.note || 'Queued for the Enricher\u2019s next tick (09:40 / 16:40).'));
      else if (mode === 'queue') setNote(String(out?.note || 'Queued for the next tick.'));
      else setNote(`Analyzed ${out?.analyzed ?? 0} · matched ${out?.matched ?? 0} · new ${out?.new ?? 0} · researched ${out?.researched ?? 0}${out?.more_pages ? ' · more pages remain' : ''}`);
      await load();
    } finally { setBusy(null); }
  };

  const c = data?.counts;
  const st = data?.agent_state;
  return (
    <div className="p-4 space-y-4">
      {/* Agent strip */}
      <div className="rounded-xl p-3 flex flex-wrap items-center gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <RunPill run={data?.last_run ?? null} queued={data?.queued_runs ?? 0} state={st ?? null} />
        <div className="flex gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span><b style={{ color: 'var(--text)' }}>{c?.total ?? '—'}</b> on list</span>
          <span><b style={{ color: 'var(--green)' }}>{c?.strong ?? '—'}</b> strong</span>
          <span><b style={{ color: 'var(--yellow)' }}>{c?.proceed ?? '—'}</b> proceed</span>
          <span><b style={{ color: 'var(--text)' }}>{c?.researched ?? '—'}</b> researched</span>
          <span><b style={{ color: 'var(--text)' }}>{c?.engaged ?? '—'}</b> engaged</span>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => run('enrich')} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }} title="Queue the Enricher: employer, research, website, email for this list">
            {busy === 'enrich' ? 'Queuing…' : 'Enrich now'}
          </button>
          <button onClick={() => run('queue')} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }} title="Queue a pass for the agent's next tick (no budget spent now)">
            {busy === 'queue' ? 'Queuing…' : 'Queue a pass'}
          </button>
          <button onClick={() => run('now')} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }} title="One search page now — spends one unit of today's LinkedIn budget">
            {busy === 'now' ? 'Searching…' : 'Find more now'}
          </button>
        </div>
        {note && <div className="w-full text-[11px]" style={{ color: note.toLowerCase().includes('error') || note.startsWith('Leads Finder can') ? 'var(--red)' : 'var(--text-muted)' }}>{note}</div>}
      </div>

      <div className="flex items-center gap-2">
        {(['leads', 'activity'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="px-3 py-1 rounded text-xs capitalize"
                  style={{ background: tab === t ? 'var(--accent)' : 'var(--bg-input)', color: tab === t ? '#fff' : 'var(--text-muted)' }}>
            {t}{t === 'leads' && data ? ` (${data.leads.length})` : ''}{t === 'activity' ? ` (${runs.length})` : ''}
          </button>
        ))}
        {tab === 'leads' && (
          <label className="ml-auto text-[11px] flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            min score
            <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="px-2 py-1 rounded text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
              <option value={0}>any</option><option value={40}>40 weak+</option><option value={60}>60 proceed+</option><option value={75}>75 strong</option>
            </select>
          </label>
        )}
      </div>

      {tab === 'leads' && (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {!data && <p className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
          {data && data.leads.length === 0 && (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Nothing on this list yet. The Leads Finder fills it on its next tick, or click <b>Find more now</b>.
            </div>
          )}
          {data && data.leads.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
                  <th className="text-left p-2 font-medium text-xs">Person</th>
                  <th className="text-left p-2 font-medium text-xs">Company</th>
                  <th className="text-left p-2 font-medium text-xs">Fit</th>
                  <th className="text-left p-2 font-medium text-xs">Stage</th>
                  <th className="text-left p-2 font-medium text-xs">Source</th>
                  <th className="text-left p-2 font-medium text-xs">Found</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((l) => (
                  <>
                    <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="p-2">
                        <Link href={`/prospects/${l.id}`} className="font-medium hover:underline">{l.full_name || '—'}</Link>
                        <div className="text-xs truncate max-w-[320px]" style={{ color: 'var(--text-muted)' }}>{l.title || '—'}</div>
                        {l.linkedin_url && <a href={l.linkedin_url.startsWith('http') ? l.linkedin_url : `https://linkedin.com/in/${l.linkedin_url}`} target="_blank" rel="noreferrer" className="text-[10px] underline" style={{ color: 'var(--accent)' }}>LinkedIn ↗</a>}
                      </td>
                      <td className="p-2 text-xs">
                        <div>{l.company_name || '—'}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{[l.industry, l.company_size].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="p-2">
                        <button onClick={() => setOpen(open === l.id ? null : l.id)} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: `${fitColor(l.icp_score)}22`, color: fitColor(l.icp_score) }} title="why?">
                          {l.icp_score ?? '—'} · {(l.fit_label || 'unscored').replace(/_/g, ' ')}
                        </button>
                        {l.research_summary && <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }} title="researched">📄</span>}
                      </td>
                      <td className="p-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>{l.stage}{l.converted_deal_id && <Link href={`/deals/${l.converted_deal_id}`} className="ml-1 underline" style={{ color: 'var(--accent)' }}>deal→</Link>}</td>
                      <td className="p-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>{l.source_type || '—'}</td>
                      <td className="p-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>{relativeTime(l.created_at)}</td>
                    </tr>
                    {open === l.id && (
                      <tr key={`${l.id}-why`} style={{ background: 'var(--bg-card)' }}>
                        <td colSpan={6} className="p-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {(l.qualification_reason || '').split('; ').map((r, i) => <div key={i}>· {r}</div>)}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'activity' && <ActivityList runs={runs} />}
    </div>
  );
}

export function RunPill({ run, queued, state }: { run: AgentRun | null; queued: number; state: IcpAgentState | null }) {
  if (!run && !queued) {
    return <span className="text-[11px] px-2 py-1 rounded-full" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>agent hasn&apos;t run yet</span>;
  }
  const color = run ? RUN_STATUS_COLOR[run.status] : 'var(--accent)';
  const label = !run ? 'queued' : run.status === 'skipped' ? `skipped · ${run.detail?.reason || ''}`
    : run.status === 'error' ? `error · ${(run.error || '').slice(0, 60)}`
    : `ran ${relativeTime(run.started_at)} · ${run.analyzed} analyzed · ${run.matched} matched · ${run.created} new`;
  return (
    <span className="text-[11px] px-2 py-1 rounded-full inline-flex items-center gap-1.5" style={{ background: `${color}18`, color }} title={run?.source || ''}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
      {queued > 0 && <span style={{ color: 'var(--text-muted)' }}>· {queued} queued</span>}
      {state?.exhausted_at && <span style={{ color: 'var(--text-muted)' }}>· exhausted</span>}
    </span>
  );
}

export function ActivityList({ runs, showIcp = false }: { runs: AgentRun[]; showIcp?: boolean }) {
  if (runs.length === 0) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No agent activity yet.</p>;
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {runs.map((r) => {
        const color = RUN_STATUS_COLOR[r.status];
        return (
          <div key={r.id} className="p-3 grid grid-cols-[150px_1fr_220px] gap-3 items-start" style={{ borderTop: '1px solid var(--border)' }}>
            <div>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${color}22`, color }}>{r.status}</span>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{relativeTime(r.started_at)} · {r.trigger}</div>
              {showIcp && r.icp_name && <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{r.icp_name}</div>}
            </div>
            <div className="text-xs min-w-0">
              <div className="truncate">{r.source || (r.agent === 'leads_finder' ? 'Lead discovery' : r.agent)}</div>
              {r.status === 'skipped' && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.detail?.reason}</div>}
              {r.error && <div className="text-[11px]" style={{ color: 'var(--red)' }}>{r.error}</div>}
              {r.detail?.top && r.detail.top.length > 0 && (
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {r.detail.top.slice(0, 3).map((t, i) => <div key={i} className="truncate">· {t.name} — {t.headline} ({t.icp_score})</div>)}
                </div>
              )}
              {r.detail?.filter_notes && r.detail.filter_notes.length > 0 && (
                <div className="text-[10px] mt-1" style={{ color: 'var(--orange)' }}>{r.detail.filter_notes.join(' · ')}</div>
              )}
            </div>
            <div className="text-xs text-right" style={{ color: 'var(--text-muted)' }}>
              {r.status !== 'skipped' && (<>{r.analyzed} analyzed · <span style={{ color: r.matched ? 'var(--green)' : undefined }}>{r.matched} matched</span> · {r.created} new{r.researched ? ` · ${r.researched} researched` : ''}</>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
