'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PROSPECT_STAGES } from '@/lib/prospecting';
import { relativeTime } from '@/lib/time';
import { DegreeWarm } from '@/components/icp/IcpLeads';
import { COHORTS, SIGNAL_LABELS, cohortName, type CohortInfo } from '@/lib/cohorts';
import PriorityPicker from '@/components/PriorityPicker';
import { CONNECT_COLOR, CONNECT_LABEL, RUNG_LABEL, connectState, describeLookup, type ConnectState, type ProfileLookup } from '@/lib/connect';
import { SkeletonRows } from '@/components/panel/Skeleton';

/** The slim row GET /api/icp/[id]/leads returns; the heavy parts (`LeadDetail`) load when a row is expanded. */
export interface Lead {
  id: string; stage: string; icp_score: number | null; fit_label: string | null;
  researched: boolean;
  source_type: string | null; source_detail: string | null; created_at: string; scored_at: string | null;
  engaged_at: string | null; converted_deal_id: string | null;
  full_name: string | null; title: string | null; email: string | null; linkedin_url: string | null;
  company_name: string | null; industry: string | null; company_size: string | null;
  network_degree: string | null;
  warm_paths: { type: string; value?: string; note: string }[] | null;
  linkedin_public_id: string | null; priority_rank: number | null;
  priority?: number | null; must_talk?: boolean | null;
  invite_status: string | null; invite_sent_at: string | null; invite_source: string | null;
  invite_error: string | null; connect_approval: string | null;
  /** The verdict of the newest lookup-by-name and its counts; the candidates come with the detail. */
  profile_lookup: LookupSummary | null;
  // Cohorts (090): the rank, why, and the company in two sentences + facts
  cohort_score?: number | null; cohort_why?: string | null; cohort_signals?: string[] | null;
  cohort_guess?: string | null; cohort_confidence?: string | null; warm_via?: string | null;
  company_summary?: string | null;
  company_facts?: { industry?: string; size?: string; revenue_estimate?: string; locations?: string; ownership?: string } | null;
}
export interface LookupSummary {
  result: string; reason: string | null; created_at: string; candidate_count: number; strong_count: number;
  duplicate_of: string | null; rung?: string | null; discovered: string[];
}
/** GET /api/icp/[id]/leads/[leadId]. */
interface LeadDetail { qualification_reason: string | null; research_summary: string | null; profile_lookup: ProfileLookup | null }
interface ConnectInfo {
  linkedin: boolean; enabled: boolean; per_day: number; per_week: number; no_answer_after_days: number;
  sent_today: number; sent_week: number; queued: number;  // ROLLING: last 24 h / last 7 days
  subscription?: 'free' | 'sales_navigator'; next_request_at?: string | null;
}
interface Payload { leads: Lead[]; counts: { total: number }; connect?: ConnectInfo; cohort?: CohortInfo | null }

const CONNECT_FILTERS: ConnectState[] = ['not_invited', 'awaiting_approval', 'pending', 'no_answer', 'connected', 'not_accepted', 'failed', 'awaiting_pick', 'no_profile'];
const FIND_PER_CLICK = 25;
const PAGE = 50;

const fitColor = (s: number | null) =>
  s === null ? 'var(--text-muted)' : s >= 75 ? 'var(--green)' : s >= 60 ? 'var(--yellow)' : s >= 40 ? 'var(--orange)' : 'var(--red)';

/**
 * The ICP's list, best fit first, with the stage / score / warm filters and a
 * coverage strip per lead (employer · research · email · warm angle · route)
 * so what the Enricher and the router still owe is visible per row. Fetches
 * on its own (filters are local). `signature` is the page's summary of the list (counts the poll saw): the table
 * reloads only when it changes, never on every poll — the list is the heaviest request on the page. Rows are
 * slim; a row's research / reasons / profile candidates load when it is expanded. `pageSize` rows are drawn at a time
 * (50 on the All-people view, 10 under the journey view); the footer lets the person change it.
 */
const PAGE_SIZES = [10, 25, 50, 100];
export default function LeadsTable({ icpId, signature = '', pageSize = PAGE }: { icpId: string; signature?: string; pageSize?: number }) {
  const [page, setPage] = useState(pageSize);
  const [data, setData] = useState<Payload | null>(null);
  const [details, setDetails] = useState<Record<string, LeadDetail | 'loading'>>({});
  const [limit, setLimit] = useState(pageSize);
  const [stage, setStage] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [warmOnly, setWarmOnly] = useState(false);
  const [prio, setPrio] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [conn, setConn] = useState<'' | ConnectState>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);   // lead whose profile candidates are open

  const load = useCallback(async () => {
    const res = await fetch(`/api/icp/${icpId}/leads?` + new URLSearchParams({
      ...(stage ? { stage } : {}),
      ...(minScore ? { min_score: String(minScore) } : {}),
      ...(warmOnly ? { warm: '1' } : {}),
      ...(prio ? { priority: prio } : {}),
    }).toString());
    if (res.ok) { setData(await res.json()); setDetails({}); }
  }, [icpId, stage, minScore, warmOnly, prio]);
  useEffect(() => { load(); }, [load, signature]);
  useEffect(() => { setLimit(page); }, [stage, minScore, warmOnly, prio, conn, page]);

  const detailOf = (id: string) => {
    if (details[id]) return;
    setDetails((d) => ({ ...d, [id]: 'loading' }));
    fetch(`/api/icp/${icpId}/leads/${id}`).then((r) => (r.ok ? r.json() : null))
      .then((out) => setDetails((d) => ({ ...d, [id]: out ?? { qualification_reason: null, research_summary: null, profile_lookup: null } })))
      .catch(() => setDetails((d) => { const { [id]: _gone, ...rest } = d; return rest; }));
  };
  const openWhy = (id: string) => { setOpen(open === id ? null : id); detailOf(id); };
  const openPick = (id: string) => { setPick(pick === id ? null : id); detailOf(id); };

  const noAnswer = data?.connect?.no_answer_after_days;
  const stateOf = (l: Lead) => connectState(l, noAnswer);
  const tally = (data?.leads ?? []).reduce<Record<string, number>>((acc, l) => {
    const st = stateOf(l); acc[st] = (acc[st] ?? 0) + 1; return acc;
  }, {});
  const matching = (data?.leads ?? []).filter((l) => !conn || stateOf(l) === conn);
  const shown = matching.slice(0, limit);
  const c = data?.connect;
  const room = c ? Math.max(0, Math.min(c.per_day - c.sent_today, c.per_week - c.sent_week) - c.queued) : 0;

  // Both actions only FILE a request for approval; the owner's 👍 sends it.
  const post = async (key: string, url: string, body: Record<string, unknown>) => {
    setBusy(key); setMsg(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      setMsg(out.error ? `Error: ${out.error}` : (out.note || 'Filed for approval.'));
      await load();
    } finally { setBusy(null); }
  };
  // Profile lookups write a slug only on exactly one strong match; a pick is a person's decision.
  const findOne = (l: Lead) => post(l.id, `/api/prospects/${l.id}/find-linkedin`, {});
  const pickOne = (l: Lead, public_identifier: string, member_id: string | null) => {
    setPick(null);
    void post(l.id, `/api/prospects/${l.id}/find-linkedin`, { public_identifier, ...(member_id ? { member_id } : {}) });
  };
  const findNext = () => post('find', `/api/icp/${icpId}/find-linkedin`, { limit: FIND_PER_CLICK });
  // Unsorted (cohorts, 090): a person decides where the sorter was unsure. The person leaves this list.
  const unsorted = data?.cohort?.key === 'unsorted';
  const moveTo = async (l: Lead, cohort: string) => {
    setBusy(l.id); setMsg(null);
    try {
      const res = await fetch(`/api/prospects/${l.id}/cohort`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cohort }) });
      const out = await res.json().catch(() => ({}));
      setMsg(out.error ? `Error: ${out.error}` : `${l.full_name || 'Moved'} → ${cohortName(cohort)}.`);
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
        <span>{data ? `${matching.length} shown` : <span className="inline-block w-14 h-3 rounded animate-pulse align-middle" style={{ background: 'var(--bg-input)' }} />}</span>
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
        <label className="flex items-center gap-2">
          priority
          <select value={prio} onChange={(e) => setPrio(e.target.value)} className="px-2 py-1 rounded text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="">any</option><option value="top">P1–P3</option><option value="set">any set</option><option value="none">not set</option>
            {[1,2,3,4,5,6,7,8,9,10].map((n) => <option key={n} value={String(n)}>P{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={warmOnly} onChange={(e) => setWarmOnly(e.target.checked)} /> warm only
        </label>
      </div>

      {data && c && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <span className="font-medium" style={{ color: 'var(--text)' }}>LinkedIn connections</span>
          {(['connected', 'pending', 'awaiting_approval', 'no_answer', 'not_accepted', 'not_invited', 'awaiting_pick', 'no_profile'] as ConnectState[]).map((st) => (
            <button key={st} onClick={() => setConn(conn === st ? '' : st)} style={{ color: tally[st] ? CONNECT_COLOR[st] : 'var(--text-muted)', textDecoration: conn === st ? 'underline' : 'none' }}>
              {tally[st] ?? 0} {CONNECT_LABEL[st].toLowerCase()}
            </button>
          ))}
          <span className="ml-auto">
            {c.linkedin
              ? `${c.sent_today}/${c.per_day} in the last 24 h · ${c.sent_week}/${c.per_week} in the last 7 days`
                + ` · ${c.subscription === 'sales_navigator' ? 'Sales Navigator' : 'free account'}`
                + (c.next_request_at ? ` · next request ${new Date(c.next_request_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '')
              : 'no LinkedIn account connected'}
          </span>
          {(tally.no_profile ?? 0) > 0 && (
            <button
              onClick={findNext}
              disabled={busy !== null || !c.linkedin}
              title={c.linkedin
                ? `Find the next ${Math.min(FIND_PER_CLICK, tally.no_profile)} profiles: web search first (free), then LinkedIn search, then a company-first search that also adds the company's decision makers as new leads. A profile is attached only after one clear, verified match; the rest wait for your pick.`
                : 'Needs the list owner\'s LinkedIn account'}
              className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
              {busy === 'find' ? 'Searching…' : `Find next ${Math.min(FIND_PER_CLICK, tally.no_profile)} on LinkedIn`}
            </button>
          )}
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
      {msg && <div className="text-xs" style={{ color: msg.startsWith('Error') ? 'var(--red)' : 'var(--text-muted)' }}>{msg}</div>}

      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {!data && <SkeletonRows rows={10} />}
        {data && data.leads.length === 0 && (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Nothing here. The Leads Finder fills the list on its next tick, or click <b>Find more now</b>.
          </div>
        )}
        {data && data.leads.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                <th className="text-left p-2 font-medium text-xs" title="The one person priority: 1 = top. Set it here, on the lead card or the opportunity — it is the same number everywhere.">Prio</th>
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
                  : cs === 'awaiting_approval' ? 'filed — waiting for the owner to approve'
                  : (cs === 'no_profile' || cs === 'awaiting_pick') && l.profile_lookup
                    ? `${describeLookup({ ...l.profile_lookup, strong: new Array(l.profile_lookup.strong_count).fill(0), candidates: new Array(l.profile_lookup.candidate_count).fill(0), discovered: l.profile_lookup.discovered.map(() => ({ landed: true })) })} (searched ${relativeTime(l.profile_lookup.created_at)})`
                  : cs === 'no_profile' ? 'no LinkedIn profile on file — not searched yet' : '';
                const det = details[l.id];
                const full = det && det !== 'loading' ? det : null;
                const cands = (full?.profile_lookup?.candidates ?? []).filter((x) => x.public_identifier);
                const strong = new Set(full?.profile_lookup?.strong ?? []);
                const possible = new Set(full?.profile_lookup?.possible ?? []);
                const candCount = l.profile_lookup?.candidate_count ?? 0;
                const warm = (l.warm_paths || []).filter((w) => w.type !== 'route');
                const route = (l.warm_paths || []).find((w) => w.type === 'route') as { path_available?: boolean } | undefined;
                const dots: { k: string; on: boolean; title: string }[] = [
                  { k: 'E', on: Boolean(l.company_name), title: l.company_name ? `employer: ${l.company_name}` : 'employer unknown' },
                  { k: 'R', on: l.researched, title: l.researched ? 'researched' : 'not researched' },
                  { k: '@', on: Boolean(l.email), title: l.email ? `email: ${l.email}` : 'no email' },
                  { k: '🔥', on: warm.length > 0, title: warm.length ? warm.map((w) => w.note).join(' · ') : 'no warm angle' },
                  { k: '↝', on: Boolean(route?.path_available), title: route ? (route.path_available ? 'warm route found' : 'route computed: none') : 'route not computed' },
                ];
                const stageLabel = PROSPECT_STAGES.find((s) => s.stage === l.stage)?.label ?? l.stage;
                return (
                  <FragmentRow key={l.id}>
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="p-2 align-top"><PriorityPicker value={l.priority} prospectId={l.id} onChanged={() => void load()} /></td>
                      <td className="p-2">
                        <Link href={`/prospects/${l.id}`} className="font-medium hover:underline">{l.full_name || '—'}</Link>
                        <div className="text-xs truncate max-w-[320px]" style={{ color: 'var(--text-muted)' }}>{l.title || '—'}</div>
                        {l.cohort_why && <div className="text-[11px] max-w-[320px]" style={{ color: 'var(--accent)' }}>{l.cohort_why}</div>}
                        {unsorted && (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {l.cohort_guess && <span>guess: {cohortName(l.cohort_guess)}</span>}
                            <select defaultValue="" disabled={busy !== null} onChange={(e) => e.target.value && moveTo(l, e.target.value)}
                              className="px-1.5 py-0.5 rounded-md text-[11px]" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
                              aria-label="Move to a cohort">
                              <option value="">Move to…</option>
                              {COHORTS.map((c) => <option key={c.key} value={c.key}>{c.number} · {c.name}</option>)}
                            </select>
                          </div>
                        )}
                        {l.linkedin_url && <a href={l.linkedin_url.startsWith('http') ? l.linkedin_url : `https://linkedin.com/in/${l.linkedin_url}`} target="_blank" rel="noreferrer" className="text-[10px] underline" style={{ color: 'var(--accent)' }}>LinkedIn ↗</a>}
                        <DegreeWarm degree={l.network_degree} paths={l.warm_paths} />
                      </td>
                      <td className="p-2 text-xs">
                        <div>
                          {l.priority_rank != null && <span title="priority rank on this list" className="mr-1.5 px-1 rounded text-[10px] font-medium" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>#{l.priority_rank}</span>}
                          {l.company_name || '—'}
                          {l.source_type === 'company_discovery' && <span title={l.source_detail || 'found by starting from the company'} className="ml-1.5 px-1 rounded text-[10px] font-medium" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>via company</span>}
                        </div>
                        <div style={{ color: 'var(--text-muted)' }}>{[l.company_facts?.industry || l.industry, l.company_facts?.size || l.company_size, l.company_facts?.revenue_estimate].filter(Boolean).join(' · ')}</div>
                        {l.company_summary && <div className="mt-0.5 max-w-[340px] line-clamp-2" title={l.company_summary} style={{ color: 'var(--text)' }}>{l.company_summary}</div>}
                      </td>
                      <td className="p-2">
                        {l.cohort_score != null ? (
                          <button onClick={() => openWhy(l.id)} className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md"
                            style={{ background: `color-mix(in srgb, ${fitColor(l.cohort_score)} 14%, transparent)`, color: fitColor(l.cohort_score) }}
                            title="Priority: right person + company fit and early-adopter signals + warmth. Click for details.">
                            {l.cohort_score}
                          </button>
                        ) : (
                          <button onClick={() => openWhy(l.id)} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${fitColor(l.icp_score)} 14%, transparent)`, color: fitColor(l.icp_score) }} title="why?">
                            {l.icp_score ?? '—'} · {(l.fit_label || 'unscored').replace(/_/g, ' ')}
                          </button>
                        )}
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
                        {cs === 'no_profile' && c?.linkedin && (
                          <button onClick={() => findOne(l)} disabled={busy !== null} className="ml-1.5 underline disabled:opacity-40" style={{ color: 'var(--accent)' }}
                                  title="One LinkedIn search by name + company on the owner's account; attached only on one clear match">
                            {busy === l.id ? '…' : l.profile_lookup ? 'Search again' : 'Find on LinkedIn'}
                          </button>
                        )}
                        {(cs === 'awaiting_pick' || (cs === 'no_profile' && candCount > 0)) && (
                          <button onClick={() => openPick(l.id)} disabled={busy !== null} className="ml-1.5 underline disabled:opacity-40" style={{ color: 'var(--accent)' }}>
                            {pick === l.id ? 'Close' : `Pick (${candCount})`}
                          </button>
                        )}
                        {(l.profile_lookup?.discovered ?? []).length > 0 && (
                          <div className="mt-0.5 text-[10px]" style={{ color: 'var(--text-muted)' }} title="decision makers found by starting from the company, added as new leads">
                            via company: {(l.profile_lookup?.discovered ?? []).join(', ')}
                          </div>
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
                        <td colSpan={8} className="p-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {l.cohort_score != null && (
                            <div className="mb-1.5 space-y-0.5" style={{ color: 'var(--text)' }}>
                              {l.company_summary && <div>{l.company_summary}</div>}
                              {l.company_facts && <div style={{ color: 'var(--text-muted)' }}>{Object.entries(l.company_facts).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</div>}
                              {(l.cohort_signals ?? []).length > 0 && <div>Signals: {(l.cohort_signals ?? []).map((x) => SIGNAL_LABELS[x] ?? x).join(', ')}</div>}
                              <div style={{ color: 'var(--text-muted)' }}>Sorter confidence: {l.cohort_confidence ?? '—'}{l.warm_via ? ` · ${l.warm_via} knows them` : ''}</div>
                            </div>
                          )}
                          {!full && <div className="h-3 w-48 rounded animate-pulse" style={{ background: 'var(--bg-input)' }} />}
                          {full && (full.qualification_reason || 'no reasons recorded').split('; ').map((r, i) => <div key={i}>· {r}</div>)}
                          {full?.research_summary && <div className="mt-1.5 whitespace-pre-line" style={{ color: 'var(--text)' }}>{full.research_summary}</div>}
                        </td>
                      </tr>
                    )}
                    {pick === l.id && (
                      <tr style={{ background: 'var(--bg-card)' }}>
                        <td colSpan={8} className="p-2 text-[11px]">
                          <div className="mb-1" style={{ color: 'var(--text-muted)' }}>
                            Which LinkedIn profile is {l.full_name || 'this person'} ({l.company_name || 'company unknown'})?
                            {l.profile_lookup?.reason ? ` ${l.profile_lookup.reason}.` : ''} A wrong pick cannot be undone once a request goes out.
                          </div>
                          {!full && <div className="h-10 rounded-lg animate-pulse" style={{ background: 'var(--bg-input)' }} />}
                          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                            {cands.map((x) => (
                              <div key={x.public_identifier!} className="rounded-lg px-2 py-1.5 flex items-start gap-2" style={{ border: `1px solid ${strong.has(x.public_identifier!) ? 'var(--green)' : possible.has(x.public_identifier!) ? 'var(--yellow)' : 'var(--border)'}`, background: 'var(--bg-input)' }}>
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium truncate" style={{ color: 'var(--text)' }}>
                                    {x.name || x.public_identifier}
                                    {strong.has(x.public_identifier!) && <span className="ml-1 text-[9px] px-1 rounded" style={{ background: 'color-mix(in srgb, var(--green) 14%, transparent)', color: 'var(--green)' }}>likely</span>}
                                    {!strong.has(x.public_identifier!) && possible.has(x.public_identifier!) && <span className="ml-1 text-[9px] px-1 rounded" title="same name and same state only — confirm on the profile" style={{ background: 'color-mix(in srgb, var(--yellow) 14%, transparent)', color: 'var(--yellow)' }}>possible</span>}
                                    {x.rung && <span className="ml-1 text-[9px]" style={{ color: 'var(--text-muted)' }} title="where this candidate came from">{RUNG_LABEL[x.rung] || x.rung}</span>}
                                    {x.network_distance && <span className="ml-1 text-[9px]" style={{ color: 'var(--text-muted)' }}>{String(x.network_distance).replace('DISTANCE_', '')}°</span>}
                                  </div>
                                  <div className="truncate" style={{ color: 'var(--text-muted)' }}>{x.headline || '—'}</div>
                                  <div className="truncate" style={{ color: 'var(--text-muted)' }}>{x.location || ''}</div>
                                  <a href={`https://www.linkedin.com/in/${x.public_identifier}`} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent)' }}>open ↗</a>
                                </div>
                                <button onClick={() => pickOne(l, x.public_identifier!, x.provider_id)} disabled={busy !== null}
                                        className="px-2 py-1 rounded-lg text-[11px] font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                                  Use this
                                </button>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        )}
        {data && matching.length > 0 && (
          <div className="px-3 py-2 flex items-center justify-between gap-3 text-xs flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>{shown.length} of {matching.length}</span>
            {matching.length > shown.length && (
              <button type="button" onClick={() => setLimit((n) => n + page)} className="underline" style={{ color: 'var(--accent)' }}>
                Show {Math.min(page, matching.length - shown.length)} more
              </button>
            )}
            <label className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
              per page
              <select value={page} onChange={(e) => setPage(Number(e.target.value))} className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

// A keyed fragment for the row + its expandable "why?" row.
function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }
