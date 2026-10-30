'use client';

/**
 * /dashboard (was /funnel; design 1 of canvas RVn4piTh8uZYW66fnzTuyG, 2026-10-28): four deep cards — people who got
 * contacted, answered or met, booked a meeting, became an opportunity in the period, each against the same stretch of
 * the period before, with a 12-week trend line — then the funnel and the weekly chart, then the busiest lists, the
 * latest answers and what gets answers. Channels, exits, definitions and the full findings table fold under "More".
 *
 * Funnel = GET /api/funnel (kernel), period numbers / weeks / lists / answers = GET /api/dashboard (person_funnel +
 * funnel_events), findings = GET /api/funnel/insights. The slice (period, list, teammate, lane, people | companies)
 * lives in the URL so a view is shareable.
 */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import PageHeader from '@/components/panel/PageHeader';
import { useFunnel } from '@/components/panel/FunnelStrip';
import FunnelChart from '@/components/funnel/FunnelChart';
import FunnelMore from '@/components/funnel/FunnelMore';
import Insights, { useInsights } from '@/components/funnel/Insights';
import { Briefcase, Calendar, Chat, Send } from '@/components/icons';
import { FUNNEL_LANES, drawnSteps, pct, type FunnelLane, type FunnelSummary } from '@/lib/funnel';
import {
  COMPARE_LABEL, DASH_PERIODS, delta, type DashPeriod, type DashStage, type DashboardPayload,
} from '@/lib/dashboard';
import type { FunnelInsights } from '@/lib/warm';

interface Opt { id: string; name: string; email?: string }
type IconT = (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;

const selectStyle = { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' };

function useDashboard(query: Record<string, string | undefined>) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString();
  useEffect(() => {
    let live = true;
    setError(null);
    fetch(`/api/dashboard${qs ? `?${qs}` : ''}`)
      .then(async (r) => { const o = await r.json().catch(() => ({})); if (!live) return; if (!r.ok) setError(o.error || `Could not load (${r.status})`); else setData(o); })
      .catch(() => { if (live) setError('Could not reach the server'); });
    return () => { live = false; };
  }, [qs]);
  return { data, error };
}

function sparkPath(vals: number[]): string {
  if (!vals.length) return '';
  const max = Math.max(1, ...vals);
  return vals.map((v, i) => `${i ? 'L' : 'M'}${(2 + (i * 100) / Math.max(1, vals.length - 1)).toFixed(1)} ${(32 - (v / max) * 28).toFixed(1)}`).join(' ');
}

function DeepCard({ icon: I, fill, label, value, cur, prev, sub, spark, compare }: {
  icon: IconT; fill: string; label: string; value: string; cur: number; prev: number; sub: string; spark: number[]; compare: string;
}) {
  const d = delta(cur, prev);
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-1.5 min-w-0" style={{ background: fill, color: '#fff' }}>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl" style={{ background: 'rgba(255,255,255,0.16)' }} aria-hidden="true">
          <I width={20} height={20} />
        </span>
        <svg width="104" height="36" viewBox="0 0 104 36" role="img" aria-label={`last 12 weeks: ${spark.join(', ')}`}>
          <path d={sparkPath(spark)} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="text-sm" style={{ color: 'rgba(255,255,255,0.84)' }}>{label}</span>
      <span className="text-[34px] font-semibold leading-none tabular-nums font-mono">{value}</span>
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(255,255,255,0.18)' }} title={`${prev} in the comparison window`}>
          {d.text}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.84)' }}>{compare}</span>
      </span>
      <span className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.84)' }} title={sub}>{sub}</span>
    </div>
  );
}

function Cards({ dash, funnel, insights, period }: { dash: DashboardPayload; funnel: FunnelSummary | null; insights: FunnelInsights | null; period: DashPeriod }) {
  const series = (k: DashStage) => dash.weeks.map((w) => w.counts[k]);
  const steps = funnel ? drawnSteps(funnel) : [];
  const get = (k: string) => steps.find((s) => s.key === k);
  const metInPerson = funnel?.stages.find((s) => s.key === 'lead_engaged')?.substages?.met_in_person ?? 0;
  const label = DASH_PERIODS[period].toLowerCase();
  const compare = COMPARE_LABEL[period];
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      <DeepCard icon={Send} fill="var(--deep-plum)" label={`Contacted · ${label}`} value={dash.current.lead_contacted.toLocaleString()}
        cur={dash.current.lead_contacted} prev={dash.previous.lead_contacted} compare={compare} spark={series('lead_contacted')}
        sub={funnel ? `${(get('contacted')?.current ?? 0).toLocaleString()} in contact now · ${(get('contacted')?.reached ?? 0).toLocaleString()} ever` : '…'} />
      <DeepCard icon={Chat} fill="var(--deep-blue)" label={`Answered or met · ${label}`} value={dash.current.lead_engaged.toLocaleString()}
        cur={dash.current.lead_engaged} prev={dash.previous.lead_engaged} compare={compare} spark={series('lead_engaged')}
        sub={insights ? `${pct(insights.overall.answer_rate)} of everyone we reached out to answered` : 'answered, met in person or came to us'} />
      <DeepCard icon={Calendar} fill="var(--deep-teal)" label={`Meetings · ${label}`} value={dash.current.lead_meeting.toLocaleString()}
        cur={dash.current.lead_meeting} prev={dash.previous.lead_meeting} compare={compare} spark={series('lead_meeting')}
        sub={metInPerson ? `${metInPerson.toLocaleString()} more met in person` : 'a booked call or meeting'} />
      <DeepCard icon={Briefcase} fill="var(--deep-violet)" label={`New opportunities · ${label}`} value={dash.current.opportunity.toLocaleString()}
        cur={dash.current.opportunity} prev={dash.previous.opportunity} compare={compare} spark={series('opportunity')}
        sub={funnel ? `${(get('opportunity')?.current ?? 0).toLocaleString()} open now · ${(get('client')?.reached ?? 0).toLocaleString()} won` : '…'} />
    </div>
  );
}

function niceMax(n: number) {
  if (n <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / (p / 2)) * (p / 2);
}

function shortWeek(iso: string, first: boolean) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.getUTCDate() <= 7 || first ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : String(d.getUTCDate());
}

function WeeklyChart({ dash }: { dash: DashboardPayload }) {
  const rows = dash.weeks.map((w) => ({ week: w.week, a: w.counts.lead_contacted, b: w.counts.lead_engaged }));
  const top = niceMax(Math.max(1, ...rows.map((r) => Math.max(r.a, r.b))));
  const best = rows.reduce((x, r) => (r.a > x.a ? r : x), rows[0] ?? { week: '', a: 0, b: 0 });
  const sumA = rows.reduce((n, r) => n + r.a, 0), sumB = rows.reduce((n, r) => n + r.b, 0);
  return (
    <section className="z-panel rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Contacted and answered, per week</h2>
        <span className="inline-flex gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--series-1)' }} />Contacted</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--series-2)' }} />Answered or met</span>
        </span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: '32px minmax(0, 1fr)' }}>
        <div className="flex flex-col justify-between text-[11px] text-right font-mono h-[220px]" style={{ color: 'var(--text-muted)' }}>
          <span>{top}</span><span>{Math.round(top / 2)}</span><span>0</span>
        </div>
        <div className="relative h-[220px] grid items-end" style={{ gridTemplateColumns: `repeat(${rows.length || 1}, minmax(0, 1fr))`, borderBottom: '1px solid var(--border)' }}>
          <span className="absolute left-0 right-0 top-0 h-px" style={{ background: 'var(--border)', opacity: 0.6 }} aria-hidden="true" />
          <span className="absolute left-0 right-0 top-1/2 h-px" style={{ background: 'var(--border)', opacity: 0.6 }} aria-hidden="true" />
          {rows.map((r) => (
            <div key={r.week} className="relative flex items-end justify-center gap-0.5 h-full group"
              title={`Week of ${new Date(`${r.week}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}: ${r.a} contacted · ${r.b} answered or met`}>
              <span className="block w-3.5 rounded-t" style={{ height: `${Math.max(r.a ? 2 : 0, (r.a / top) * 100)}%`, background: 'var(--series-1)' }} />
              <span className="block w-3.5 rounded-t" style={{ height: `${Math.max(r.b ? 2 : 0, (r.b / top) * 100)}%`, background: 'var(--series-2)' }} />
            </div>
          ))}
        </div>
        <span />
        <div className="grid text-[11px] text-center" style={{ gridTemplateColumns: `repeat(${rows.length || 1}, minmax(0, 1fr))`, color: 'var(--text-muted)' }}>
          {rows.map((r, i) => <span key={r.week}>{shortWeek(r.week, i === 0)}</span>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        <span>12 weeks: <b className="font-semibold" style={{ color: 'var(--text)' }}>{sumA.toLocaleString()}</b> contacted · <b className="font-semibold" style={{ color: 'var(--text)' }}>{sumB.toLocaleString()}</b> answered or met</span>
        {best?.a > 0 && <span>Best week <b className="font-semibold" style={{ color: 'var(--text)' }}>{shortWeek(best.week, true)}</b> · {best.a} contacted</span>}
      </div>
    </section>
  );
}

function Panel({ title, link, children }: { title: string; link?: { href: string; label: string } | { onClick: () => void; label: string }; children: React.ReactNode }) {
  return (
    <section className="z-panel rounded-2xl p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {link && ('href' in link
          ? <Link href={link.href} className="text-xs underline">{link.label}</Link>
          : <button type="button" onClick={link.onClick} className="text-xs underline">{link.label}</button>)}
      </div>
      {children}
    </section>
  );
}

function Lists({ dash }: { dash: DashboardPayload }) {
  return (
    <Panel title="Lists" link={{ href: '/icp', label: 'All lists →' }}>
      {dash.lists.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nobody contacted on a list in this slice yet.</p>}
      {dash.lists.map((l) => (
        <Link key={l.id} href={`/icp/${l.id}`} className="flex flex-col gap-1.5 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="flex justify-between gap-3 text-sm">
            <span className="font-medium truncate">{l.name}</span>
            <span className="tabular-nums font-mono text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{l.contacted.toLocaleString()} / {l.found.toLocaleString()}</span>
          </span>
          <span className="flex h-2 rounded gap-0.5 overflow-hidden" style={{ background: 'var(--bg-input)' }}
            title={`${l.contacted} contacted of ${l.found} · ${l.answered} answered or met`}>
            <span className="block h-2" style={{ background: 'var(--series-1)', width: `${Math.max(1, ((l.contacted - l.answered) / Math.max(1, l.found)) * 100)}%` }} />
            <span className="block h-2" style={{ background: 'var(--series-2)', width: `${Math.max(l.answered ? 1 : 0, (l.answered / Math.max(1, l.found)) * 100)}%` }} />
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {l.owner_name} · {l.contacted.toLocaleString()} contacted · {l.answered.toLocaleString()} answered or met{l.opportunity ? ` · ${l.opportunity} opportunit${l.opportunity === 1 ? 'y' : 'ies'}` : ''}
          </span>
        </Link>
      ))}
    </Panel>
  );
}

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} d`;
}

const AVATAR = ['var(--deep-plum)', 'var(--deep-blue)', 'var(--deep-teal)', 'var(--deep-violet)'];

function Replies({ dash }: { dash: DashboardPayload }) {
  return (
    <Panel title="Latest answers" link={{ href: '/inbox', label: 'Inbox →' }}>
      {dash.replies.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No answers in this slice yet.</p>}
      {dash.replies.map((r, i) => {
        const name = r.full_name || 'Someone';
        const ini = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
        const row = (
          <span className="grid items-center gap-3 py-1.5" style={{ gridTemplateColumns: '36px minmax(0, 1fr) auto' }}>
            <span className="w-9 h-9 rounded-full inline-flex items-center justify-center text-xs font-semibold" style={{ background: AVATAR[i % AVATAR.length], color: '#fff' }} aria-hidden="true">{ini}</span>
            <span className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">{name}{r.company ? <span className="font-normal" style={{ color: 'var(--text-muted)' }}> · {r.company}</span> : null}</span>
              <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }} title={r.snippet ?? ''}>{r.snippet ? `“${r.snippet}”` : `answered ${r.owner_name}`}</span>
            </span>
            <span className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={{ color: 'var(--series-1)', background: 'color-mix(in srgb, var(--series-1) 12%, transparent)' }}>
                {r.channel === 'email' ? 'Email' : 'LinkedIn'}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{ago(r.at)} · {r.owner_name.split(' ')[0]}</span>
            </span>
          </span>
        );
        return r.lead_id
          ? <Link key={i} href={`/sales-leads?q=${encodeURIComponent(name)}&open=${r.lead_id}`} className="block">{row}</Link>
          : <div key={i}>{row}</div>;
      })}
    </Panel>
  );
}

function WhatWorks({ insights, error, onAll }: { insights: FunnelInsights | null; error: string | null; onAll: () => void }) {
  const rows = insights
    ? (['first_channel', 'lane'] as const).flatMap((d) => (insights.dimensions[d]?.rows ?? [])
      .filter((r) => r.enough && r.answer_rate != null).map((r) => ({ ...r, dim: d })))
      .sort((a, b) => (b.answer_rate ?? 0) - (a.answer_rate ?? 0))
      .filter((r, i, all) => all.findIndex((x) => x.value === r.value) === i)
      .slice(0, 6)
    : [];
  const avg = insights?.overall.answer_rate ?? null;
  const top = Math.max(0.05, ...rows.map((r) => r.answer_rate ?? 0));
  return (
    <Panel title="What gets answers" link={{ onClick: onAll, label: 'All findings →' }}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Answer rate by how we reached out and how they came in · average {pct(avg)}</p>
      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
      {!insights && !error && <div className="h-28 rounded-lg animate-pulse" style={{ background: 'var(--bg-input)' }} />}
      {insights && rows.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Not enough people yet — a group needs 8 people before it counts.</p>}
      {rows.map((r) => {
        const above = avg != null && (r.answer_rate ?? 0) > avg;
        return (
          <div key={`${r.dim}:${r.value}`} className="grid items-center gap-2.5 text-sm" style={{ gridTemplateColumns: 'minmax(0, 150px) minmax(0, 1fr) 44px' }}
            title={`${r.answered} of ${r.contacted} answered`}>
            <span className="truncate">{r.value}</span>
            <span className="relative block h-3 rounded" style={{ background: 'var(--bg-input)' }}>
              <span className="block h-3 rounded" style={{ width: `${Math.max(2, ((r.answer_rate ?? 0) / top) * 100)}%`, background: above ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 30%, var(--bg-card))' }} />
              {avg != null && <span className="absolute -top-1 -bottom-1 w-px" style={{ left: `${(avg / top) * 100}%`, background: 'var(--text-muted)' }} aria-hidden="true" />}
            </span>
            <b className="text-right font-semibold tabular-nums font-mono">{pct(r.answer_rate)}</b>
          </div>
        );
      })}
    </Panel>
  );
}

function DashboardPage() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const icp = sp.get('icp_id') || '';
  const owner = sp.get('owner') || '';
  const lane = sp.get('lane') || '';
  const pRaw = sp.get('period') || '';
  const period: DashPeriod = pRaw in DASH_PERIODS ? (pRaw as DashPeriod) : 'month';
  const view = sp.get('view') === 'companies' ? 'companies' : '';
  const unit = view ? 'companies' : 'people';
  const [lists, setLists] = useState<Opt[]>([]);
  const [users, setUsers] = useState<Opt[]>([]);
  const [more, setMore] = useState<'' | 'findings' | 'more'>('');

  useEffect(() => {
    fetch('/api/icp?scope=all').then((r) => (r.ok ? r.json() : null))
      .then((o) => setLists((o?.icps ?? []).filter((i: { is_active?: boolean }) => i.is_active !== false)
        .map((i: { id: string; name: string }) => ({ id: i.id, name: i.name }))))
      .catch(() => {});
    fetch('/api/users').then((r) => (r.ok ? r.json() : []))
      .then((u: Opt[]) => setUsers((Array.isArray(u) ? u : []).filter((x) => !x.email?.endsWith('.service.salesbrain')
        && x.email !== 'agent@salesbrain.internal')))
      .catch(() => {});
  }, []);

  const set = (k: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(k, v); else q.delete(k);
    router.replace(`${path}${q.toString() ? `?${q}` : ''}`);
  };
  const slice = { icp_id: icp || undefined, owner: owner || undefined, lane: lane || undefined };
  const funnel = useFunnel({ ...slice, view: view || undefined });
  const dash = useDashboard({ ...slice, period });
  const insights = useInsights({ icp_id: icp || undefined, owner: owner || undefined });

  const open = (k: 'findings' | 'more') => {
    setMore(k);
    setTimeout(() => document.getElementById('dashboard-more')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const listName = lists.find((l) => l.id === icp)?.name;
  const ownerName = owner === 'me' ? 'Me' : users.find((u) => u.id === owner)?.name;
  const updated = funnel.data?.evaluated_at
    ? `updated ${new Date(funnel.data.evaluated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null;
  const subtitle = [listName ?? 'All lists', ownerName ?? 'whole team', lane ? FUNNEL_LANES[lane as FunnelLane] : null,
    `${DASH_PERIODS[period].toLowerCase()} so far`, updated].filter(Boolean).join(' · ');
  const err = dash.error || funnel.error;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <PageHeader title="Dashboard" subtitle={subtitle}
          actions={(
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="inline-flex p-1 rounded-full" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }} role="group" aria-label="Period">
                {(Object.keys(DASH_PERIODS) as DashPeriod[]).map((k) => (
                  <button key={k} type="button" onClick={() => set('period', k === 'month' ? '' : k)} aria-pressed={period === k}
                    className="h-8 px-3.5 rounded-full text-[13px]"
                    style={period === k ? { background: 'var(--deep-plum)', color: '#fff' } : { color: 'var(--text-muted)' }}>{DASH_PERIODS[k]}</button>
                ))}
              </div>
              <select value={icp} onChange={(e) => set('icp_id', e.target.value)} className="h-10 px-3 rounded-full outline-none max-w-[220px]" style={selectStyle} aria-label="List">
                <option value="">All lists</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <select value={owner} onChange={(e) => set('owner', e.target.value)} className="h-10 px-3 rounded-full outline-none" style={selectStyle} aria-label="Teammate">
                <option value="">Whole team</option>
                <option value="me">Me</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )} />
        <div className="p-4 md:p-6 space-y-4 max-w-[1440px]">
          {err && <div className="text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>{err}</div>}

          {dash.data
            ? <Cards dash={dash.data} funnel={funnel.data} insights={insights.data} period={period} />
            : !err && <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }} aria-busy="true">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[178px] rounded-2xl animate-pulse" style={{ background: 'var(--bg-input)' }} />)}
            </div>}
          {dash.data && !dash.data.history && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Period numbers need the funnel history (migration 086); the funnel below is live.</p>
          )}

          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))' }}>
            {funnel.data
              ? <FunnelChart data={funnel.data} unit={unit} controls={(
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select value={lane} onChange={(e) => set('lane', e.target.value)} className="h-8 px-2.5 rounded-full outline-none" style={selectStyle} aria-label="How they came in">
                    <option value="">All lanes</option>
                    {(Object.keys(FUNNEL_LANES) as FunnelLane[]).map((k) => <option key={k} value={k}>{FUNNEL_LANES[k]}</option>)}
                  </select>
                  <div className="inline-flex p-0.5 rounded-full" style={{ background: 'var(--bg-input)' }}>
                    {([['', 'People'], ['companies', 'Companies']] as const).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => set('view', k)} className="px-2.5 py-1 rounded-full"
                        title={k ? 'Each company once, at the furthest stage of any of its people' : 'Each person once'}
                        style={{ background: view === k ? 'var(--bg-card)' : 'transparent', color: 'var(--text)' }}>{l}</button>
                    ))}
                  </div>
                </div>
              )} />
              : !funnel.error && <div className="h-[420px] rounded-2xl animate-pulse" style={{ background: 'var(--bg-input)' }} />}
            {dash.data
              ? <WeeklyChart dash={dash.data} />
              : !dash.error && <div className="h-[420px] rounded-2xl animate-pulse" style={{ background: 'var(--bg-input)' }} />}
          </div>

          {dash.data && (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
              <Lists dash={dash.data} />
              <Replies dash={dash.data} />
              <WhatWorks insights={insights.data} error={insights.error} onAll={() => open('findings')} />
            </div>
          )}

          <section id="dashboard-more" className="z-panel rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {([['', 'More'], ['findings', 'What converts, in full'], ['more', 'Channels, exits, definitions']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setMore(k)} className="text-xs px-2.5 py-1 rounded-full"
                  style={{ background: more === k ? 'var(--accent)' : 'var(--bg-input)', color: more === k ? 'var(--accent-fg)' : 'var(--text)' }}>{l}</button>
              ))}
            </div>
            {more === '' && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>The full findings table, channels, exits and the definitions the whole team uses.</p>}
            {more === 'findings' && <Insights data={insights.data} error={insights.error} />}
            {more === 'more' && funnel.data && <FunnelMore data={funnel.data} />}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><DashboardPage /></Suspense>;
}
