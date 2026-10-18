'use client';

/**
 * One campaign in depth: setup and budget, KPIs and daily spend over the page's
 * range, then its ad groups (Google) and ads with metrics. Filters: active /
 * not active / all, and "with activity only". Clicking an ad group narrows the
 * ads to it. Columns sort on click. Closes on ×, Escape, or a click outside.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Sparkline from '@/components/panel/Sparkline';
import { PROVIDER_META, rangeLabel, type AdGroupRow, type AdProvider, type AdRow, type CampaignDetail, type Metrics } from '@/lib/marketing';

const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtMoney = (n: number, ccy: string) => `${ccy} ${n.toLocaleString(undefined, { minimumFractionDigits: n && n < 1000 ? 2 : 0, maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '—');
const per = (a: number, b: number, ccy: string) => (b ? fmtMoney(a / b, ccy) : '—');

type StatusFilter = 'all' | 'active' | 'inactive';
type SortKey = 'name' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'results' | 'cpr';
type Row = (AdGroupRow | AdRow) & { name: string };

function sortRows<T extends Row>(rows: T[], key: SortKey, dir: 1 | -1): T[] {
  const v = (r: Row): number | string => key === 'name' ? r.name.toLowerCase()
    : key === 'ctr' ? (r.impressions ? r.clicks / r.impressions : -1)
    : key === 'cpc' ? (r.clicks ? r.spend / r.clicks : Infinity)
    : key === 'cpr' ? (r.results ? r.spend / r.results : Infinity)
    : r[key];
  return [...rows].sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
}

export default function CampaignModal({ provider, campaignId, campaignName, since, until, onClose }: {
  provider: AdProvider; campaignId: string; campaignName: string; since: string; until: string; onClose: () => void;
}) {
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'groups' | 'ads'>('ads');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [withActivity, setWithActivity] = useState(false);
  const [groupFilter, setGroupFilter] = useState<{ id: string; name: string } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'spend', dir: -1 });
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    fetch(`/api/marketing/campaign?${new URLSearchParams({ provider, id: campaignId, since, until })}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!alive) return; if (r.ok) { setData(j); setTab(j.groups?.length ? 'groups' : 'ads'); } else setError(j.error ?? `HTTP ${r.status}`); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [provider, campaignId, since, until]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const ccy = data?.currency ?? '';
  const keep = <T extends Row>(rows: T[]) => rows
    .filter((r) => status === 'all' || (status === 'active' ? r.active : !r.active))
    .filter((r) => !withActivity || r.impressions > 0 || r.spend > 0);
  const groups = useMemo(() => sortRows(keep((data?.groups ?? []) as Row[]) as AdGroupRow[] as Row[], sort.key, sort.dir) as unknown as AdGroupRow[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, status, withActivity, sort]);
  const ads = useMemo(() => sortRows(keep((data?.ads ?? []).filter((a) => !groupFilter || a.group_id === groupFilter.id)) as Row[], sort.key, sort.dir) as unknown as AdRow[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, status, withActivity, sort, groupFilter]);
  const counts = (rows: { active: boolean }[]) => ({ all: rows.length, active: rows.filter((r) => r.active).length, inactive: rows.filter((r) => !r.active).length });
  const current = tab === 'groups' ? counts(data?.groups ?? []) : counts((data?.ads ?? []).filter((a) => !groupFilter || a.group_id === groupFilter.id));

  const th = (key: SortKey, label: string, right = true) => (
    <th className={`py-1.5 px-2 font-medium cursor-pointer select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (key === 'name' ? 1 : -1) }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  );
  const metricCells = (r: Metrics) => (<>
    <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(r.spend, ccy)}</td>
    <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{fmtInt(r.impressions)}</td>
    <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{fmtInt(r.clicks)}</td>
    <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{pct(r.clicks, r.impressions)}</td>
    <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{per(r.spend, r.clicks, ccy)}</td>
    <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{fmtInt(r.results)}</td>
    <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{per(r.spend, r.results, ccy)}</td>
  </>);
  const statusDot = (active: boolean, text: string) => (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: active ? 'var(--green)' : 'var(--text-muted)' }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: active ? 'var(--green)' : 'var(--text-muted)' }} />{text}
    </span>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
      style={{ background: 'color-mix(in srgb, var(--text) 40%, transparent)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Campaign ${campaignName}`}
        className="w-full max-w-6xl rounded-2xl shadow-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {/* header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="z-eyebrow">{PROVIDER_META[provider].label} · {rangeLabel(since, until)}</div>
            <h2 className="text-lg font-semibold truncate mt-0.5">{data?.name ?? campaignName}</h2>
            {data && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {statusDot(data.active, data.status)}
                {data.setup.map((s) => <span key={s}>{s}</span>)}
                {data.budget && <span>{fmtMoney(data.budget.amount, data.budget.currency)} / {data.budget.period === 'daily' ? 'day' : 'total'}</span>}
                {data.parent && <span>{data.parent.label}: <span style={{ color: 'var(--text)' }}>{data.parent.name}</span> ({data.parent.status.toLowerCase()})</span>}
              </div>
            )}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full inline-flex items-center justify-center flex-shrink-0 hover:bg-[var(--accent-glow)]" style={{ color: 'var(--text-muted)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="rounded-lg p-3 text-sm" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>Could not load this campaign: {error}</div>}
          {!data && !error && (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-8 rounded-lg animate-pulse" style={{ background: 'var(--bg-input)' }} />)}</div>
          )}

          {data && (<>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {[
                ['Spend', fmtMoney(data.totals.spend, ccy)], ['Impressions', fmtInt(data.totals.impressions)], ['Clicks', fmtInt(data.totals.clicks)],
                ['CTR', pct(data.totals.clicks, data.totals.impressions)], ['CPC', per(data.totals.spend, data.totals.clicks, ccy)],
                ['Results', fmtInt(data.totals.results)], ['Cost / result', per(data.totals.spend, data.totals.results, ccy)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-input)' }}>
                  <div className="text-base font-semibold tabular-nums">{v}</div>
                  <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{k}</div>
                </div>
              ))}
            </div>
            {data.days.length > 1 && (
              <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>Spend per day</span>
                <div className="flex-1 max-w-xl">
                  <Sparkline points={data.days.map((d) => ({ day: d.day, n: Math.round(d.spend * 100) / 100, title: `${d.day}: ${fmtMoney(d.spend, ccy)} · ${fmtInt(d.clicks)} clicks` }))} />
                </div>
                <span>{rangeLabel(data.days[0].day, data.days[data.days.length - 1].day)}</span>
              </div>
            )}

            {/* level tabs + filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex p-1 rounded-full" style={{ background: 'var(--bg-input)' }} role="tablist">
                {data.groups && (
                  <button role="tab" aria-selected={tab === 'groups'} onClick={() => setTab('groups')} className="px-3 py-1 rounded-full text-xs"
                    style={{ background: tab === 'groups' ? 'var(--bg-card)' : 'transparent', fontWeight: tab === 'groups' ? 600 : 400 }}>Ad groups ({data.groups.length})</button>
                )}
                <button role="tab" aria-selected={tab === 'ads'} onClick={() => setTab('ads')} className="px-3 py-1 rounded-full text-xs"
                  style={{ background: tab === 'ads' ? 'var(--bg-card)' : 'transparent', fontWeight: tab === 'ads' ? 600 : 400 }}>Ads ({data.ads.length})</button>
              </div>
              <div className="inline-flex p-1 rounded-full" style={{ background: 'var(--bg-input)' }} role="radiogroup" aria-label="Status">
                {(['all', 'active', 'inactive'] as StatusFilter[]).map((s) => (
                  <button key={s} role="radio" aria-checked={status === s} onClick={() => setStatus(s)} className="px-3 py-1 rounded-full text-xs"
                    style={{ background: status === s ? 'var(--bg-card)' : 'transparent', fontWeight: status === s ? 600 : 400 }}>
                    {s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Not active'} ({current[s]})
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={withActivity} onChange={(e) => setWithActivity(e.target.checked)} /> With activity only
              </label>
              {groupFilter && tab === 'ads' && (
                <button onClick={() => setGroupFilter(null)} className="text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  Ad group: {groupFilter.name} ×
                </button>
              )}
            </div>

            {/* tables */}
            <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border)' }}>
              {tab === 'groups' && data.groups ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)', background: 'var(--bg-input)' }}>
                    {th('name', 'Ad group', false)}<th className="py-1.5 px-2 text-left font-medium">Status</th>
                    {th('spend', 'Spend')}{th('impressions', 'Impr.')}{th('clicks', 'Clicks')}{th('ctr', 'CTR')}{th('cpc', 'CPC')}{th('results', 'Results')}{th('cpr', 'Cost / result')}
                    <th className="py-1.5 px-2" />
                  </tr></thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="py-1.5 px-2"><div className="font-medium">{g.name}</div>{g.type && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{g.type}</div>}</td>
                        <td className="py-1.5 px-2">{statusDot(g.active, g.status)}</td>
                        {metricCells(g)}
                        <td className="py-1.5 px-2 text-right">
                          <button onClick={() => { setGroupFilter({ id: g.id, name: g.name }); setTab('ads'); }} className="text-xs underline whitespace-nowrap" style={{ color: 'var(--accent)' }}>
                            {data.ads.filter((a) => a.group_id === g.id).length} ads →
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!groups.length && <tr><td colSpan={10} className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No ad groups match these filters.</td></tr>}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)', background: 'var(--bg-input)' }}>
                    {th('name', 'Ad', false)}<th className="py-1.5 px-2 text-left font-medium">Status</th>
                    {th('spend', 'Spend')}{th('impressions', 'Impr.')}{th('clicks', 'Clicks')}{th('ctr', 'CTR')}{th('cpc', 'CPC')}{th('results', 'Results')}{th('cpr', 'Cost / result')}
                  </tr></thead>
                  <tbody>
                    {ads.map((a) => (
                      <tr key={a.id} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                        <td className="py-1.5 px-2 max-w-[28rem]">
                          <div className="font-medium">
                            {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline">{a.name} <span style={{ color: 'var(--text-muted)' }}>↗</span></a> : a.name}
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {[a.group_name && `Ad group: ${a.group_name}`, a.type, a.approval && `review: ${a.approval.toLowerCase()}`].filter(Boolean).join(' · ')}
                          </div>
                          {a.detail && a.type !== 'Sponsored post' && <div className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{a.detail}</div>}
                        </td>
                        <td className="py-1.5 px-2">{statusDot(a.active, a.status)}</td>
                        {metricCells(a)}
                      </tr>
                    ))}
                    {!ads.length && <tr><td colSpan={9} className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No ads match these filters.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
            {data.notes.length > 0 && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{data.notes.join(' ')}</p>}
          </>)}
        </div>
      </div>
    </div>
  );
}
