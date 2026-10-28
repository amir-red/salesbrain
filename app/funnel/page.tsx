'use client';

/**
 * /funnel — the funnel as a report (design A, 2026-10-28, canvas RVn4piTh8uZYW66fnzTuyG): four headline numbers, the
 * funnel DRAWN (components/funnel/FunnelChart), then three cards — the biggest leak, what gets answers, how people
 * came in. Channels, exits, the full "what converts" table and the definitions are folded under "More". The slice
 * (list, teammate, lane, period, people | companies) lives in the URL so a view is shareable.
 */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import PageHeader from '@/components/panel/PageHeader';
import { GROUP_COLOR, GROUP_HREF, useFunnel } from '@/components/panel/FunnelStrip';
import FunnelChart from '@/components/funnel/FunnelChart';
import Insights, { useInsights } from '@/components/funnel/Insights';
import {
  CHANNEL_LABELS, FUNNEL_EXITS, FUNNEL_GROUPS, FUNNEL_LANES, FUNNEL_PERIODS, FUNNEL_STAGES, FUNNEL_LABELS, drawnSteps, pct,
  type DrawnStep, type FunnelLane, type FunnelPeriod, type FunnelSummary,
} from '@/lib/funnel';
import type { FunnelInsights } from '@/lib/warm';
import { Briefcase, Flag, Handshake, Reply, Send, Sparkle, Users } from '@/components/icons';

interface Opt { id: string; name: string; email?: string }

const selectStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };

type IconT = (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;

/** A dashboard card: a light wash of its colour, a coloured icon chip. Text stays in text tokens (only the icon and
 * the wash carry the colour), so every colour pairing keeps its contrast in both themes. */
function tint(color: string, pct: number) {
  return `color-mix(in srgb, ${color} ${pct}%, var(--bg-card))`;
}

function IconChip({ icon: I, color }: { icon: IconT; color: string }) {
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0" aria-hidden="true"
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
      <I width={16} height={16} />
    </span>
  );
}

function Tile({ label, value, sub, extra, icon, color }: {
  label: string; value: string; sub: string; extra?: string; icon: IconT; color: string;
}) {
  return (
    <div className="rounded-xl px-4 py-3 flex gap-3 min-w-0"
      style={{ background: tint(color, 7), border: `1px solid ${tint(color, 22)}` }}>
      <IconChip icon={icon} color={color} />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="text-2xl font-semibold leading-tight tabular-nums">{value}</span>
        <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }} title={sub}>{sub}</span>
        {extra && <span className="text-xs tabular-nums font-medium">{extra}</span>}
      </div>
    </div>
  );
}

function Tiles({ data, insights, unit }: { data: FunnelSummary; insights: FunnelInsights | null; unit: string }) {
  const s = drawnSteps(data);
  const by = (k: string) => s.find((x) => x.key === k)!;
  const ready = by('ready'), contacted = by('contacted'), opp = by('opportunity'), client = by('client');
  const fromLeads = Math.max(0, opp.reached - opp.direct);
  const period = (st: DrawnStep) => (st.entered !== undefined ? `+${st.entered.toLocaleString()} in period` : undefined);
  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      <Tile icon={Send} color="var(--cat-blue)" label="Contacted" value={contacted.reached.toLocaleString()}
        sub={`${contacted.current.toLocaleString()} in contact now · ${pct(ready.conversion)} of ready to reach`} extra={period(contacted)} />
      <Tile icon={Reply} color="var(--cat-teal)" label="Answered" value={insights ? pct(insights.overall.answer_rate) : '…'}
        sub={insights ? `${insights.overall.answered.toLocaleString()} of ${insights.overall.contacted.toLocaleString()} we reached out to` : 'loading what converts'} />
      <Tile icon={Briefcase} color="var(--cat-violet)" label="Contacted → opportunity" value={contacted.reached ? pct(fromLeads / contacted.reached) : '—'}
        sub={`${fromLeads.toLocaleString()} of ${contacted.reached.toLocaleString()} · ${opp.current.toLocaleString()} open now`} extra={period(opp)} />
      <Tile icon={Handshake} color="var(--green)" label={unit === 'companies' ? 'Client companies' : 'Clients'} value={client.reached.toLocaleString()}
        sub={`of ${opp.reached.toLocaleString()} opportunities · ${pct(opp.conversion)}`} extra={period(client)} />
    </div>
  );
}

function Card({ title, children, foot, icon, color }: {
  title: string; children: React.ReactNode; foot?: React.ReactNode; icon: IconT; color: string;
}) {
  return (
    <section className="rounded-xl p-4 flex flex-col gap-2"
      style={{ background: tint(color, 6), border: `1px solid ${tint(color, 20)}` }}>
      <div className="flex items-center gap-2.5">
        <IconChip icon={icon} color={color} />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {children}
      {foot && <div className="text-xs mt-auto pt-1">{foot}</div>}
    </section>
  );
}

/** The step with the lowest conversion to the next, among steps enough people reached to mean something. */
function BiggestLeak({ data }: { data: FunnelSummary }) {
  const s = drawnSteps(data);
  const cands = s.filter((x, i) => i < s.length - 1 && x.reached >= 8 && x.conversion != null);
  if (!cands.length) return <Card icon={Flag} color="var(--orange)" title="Biggest leak"><span className="text-sm" style={{ color: 'var(--text-muted)' }}>Not enough people yet.</span></Card>;
  const leak = cands.reduce((a, b) => (b.conversion! < a.conversion! ? b : a));
  const next = s[s.findIndex((x) => x.key === leak.key) + 1];
  const top = [...leak.chips].sort((a, b) => b.n - a.n)[0];
  return (
    <Card icon={Flag} color="var(--orange)" title="Biggest leak" foot={<Link href={GROUP_HREF[leak.group]} className="underline">See who is stuck in {leak.label.toLowerCase()} →</Link>}>
      <span className="text-base font-semibold">{leak.label} → {next.label} · {pct(leak.conversion)}</span>
      <span className="text-sm" style={{ color: 'var(--text)' }}>
        {leak.reached.toLocaleString()} reached {leak.label.toLowerCase()}, <b className="font-semibold">{next.reached.toLocaleString()}</b> went on
        {top ? <> — most of them are <b className="font-semibold">{top.label}</b> ({top.n.toLocaleString()}).</> : '.'}
        {leak.key === 'engaged' && ' Meetings are only counted when they are recorded (a booking, Calendar, or the journey step).'}
      </span>
    </Card>
  );
}

function WhatWorks({ insights, error, onAll }: { insights: FunnelInsights | null; error: string | null; onAll: () => void }) {
  const rate = (f: { dimension: string; value: string }) =>
    insights?.dimensions[f.dimension]?.rows.find((r) => r.value === f.value)?.answer_rate ?? null;
  const works = (insights?.findings ?? []).filter((f) => f.kind === 'works').sort((a, b) => b.ratio - a.ratio).slice(0, 4);
  const weak = (insights?.findings ?? []).filter((f) => f.kind === 'weak').sort((a, b) => a.ratio - b.ratio)[0];
  return (
    <Card icon={Sparkle} color="var(--green)" title="What gets answers" foot={<button type="button" onClick={onAll} className="underline">All findings{insights ? ` (${insights.findings.length})` : ''} →</button>}>
      {error && <span className="text-xs" style={{ color: 'var(--red)' }}>{error}</span>}
      {!insights && !error && <div className="h-16 rounded-lg animate-pulse" style={{ background: 'var(--bg-input)' }} />}
      {insights && works.length === 0 && <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Nothing stands out yet — findings need 8 people per group and a few answers.</span>}
      {insights && (works.length > 0 || weak) && (
        <div className="flex flex-col gap-1.5 text-sm">
          {works.map((f) => (
            <div key={`${f.dimension}:${f.value}`} className="grid gap-2 items-baseline" style={{ gridTemplateColumns: '1fr 48px' }} title={f.text}>
              <span className="truncate">{f.value} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {insights.dimensions[f.dimension]?.label ?? f.dimension}</span></span>
              <b className="font-semibold text-right tabular-nums">{pct(rate(f))}</b>
            </div>
          ))}
          {weak && (
            <div className="grid gap-2 items-baseline" style={{ gridTemplateColumns: '1fr 48px', color: 'var(--text-muted)' }} title={weak.text}>
              <span className="truncate">{weak.value} <span className="text-xs">· {insights.dimensions[weak.dimension]?.label ?? weak.dimension}</span></span>
              <b className="font-semibold text-right tabular-nums">{pct(rate(weak))}</b>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Lanes({ data, onMore }: { data: FunnelSummary; onMore: () => void }) {
  const max = Math.max(1, ...data.lanes.map((l) => l.total));
  return (
    <Card icon={Users} color="var(--cat-blue)" title="How people came in" foot={<button type="button" onClick={onMore} className="underline">Channels, exits, definitions →</button>}>
      {data.lanes.length === 0 && <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Nobody in this slice.</span>}
      <div className="flex flex-col gap-1.5">
        {data.lanes.map((l) => (
          <div key={l.key} className="grid gap-2 items-center text-xs" style={{ gridTemplateColumns: '124px 1fr 52px' }}
            title={`${l.total.toLocaleString()} people · ${l.leads.toLocaleString()} got to lead or further`}>
            <span className="truncate">{l.label}</span>
            <span className="block h-2 rounded-full" style={{ background: tint('var(--cat-blue)', 14) }}>
              <span className="block h-2 rounded-full" style={{ background: 'var(--cat-blue)', width: `${Math.max(3, Math.round((Math.sqrt(l.total) / Math.sqrt(max)) * 100))}%` }} />
            </span>
            <span className="text-right tabular-nums">{l.total.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function More({ data }: { data: FunnelSummary }) {
  const exitsAt = data.stages.filter((s) => Object.keys(s.exits).length);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Channels</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Where the people still in the funnel stand on each channel. A channel is not a stage.</p>
        {(['linkedin', 'email'] as const).map((ch) => {
          const rows = Object.entries(data.channels[ch] || {}).sort((a, b) => b[1] - a[1]);
          const total = rows.reduce((n, [, v]) => n + v, 0);
          return (
            <div key={ch} className="space-y-1">
              <div className="text-xs font-medium">{ch === 'linkedin' ? 'LinkedIn' : 'Email'}</div>
              <div className="flex flex-wrap gap-1.5">
                {rows.map(([k, v]) => (
                  <span key={k} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-input)' }}
                    title={`${Math.round((v / Math.max(1, total)) * 100)}%`}>
                    {CHANNEL_LABELS[ch][k] ?? k} <b>{v.toLocaleString()}</b>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Who left or is resting, and where</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Counted at the furthest stage the person reached. Resting people come back by themselves at the next touch or reply.</p>
        {exitsAt.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nobody left in this slice.</p> : (
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-normal py-1">Stage</th>
                {Object.entries(FUNNEL_EXITS).map(([k, l]) => <th key={k} className="text-right font-normal">{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {exitsAt.map((s) => (
                <tr key={s.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-1">{s.label}</td>
                  {Object.keys(FUNNEL_EXITS).map((k) => (
                    <td key={k} className="text-right tabular-nums">{(s.exits as Record<string, number>)[k]?.toLocaleString() ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">What the words mean</h3>
        {FUNNEL_GROUPS.map((g) => (
          <div key={g.key} className="space-y-1">
            <div className="text-xs font-semibold" style={{ color: GROUP_COLOR[g.key] }}>{g.label}</div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{g.meaning}</p>
            <ul className="text-xs space-y-0.5">
              {FUNNEL_STAGES.filter((s) => data.stages.find((r) => r.key === s)?.group === g.key).map((s) => (
                <li key={s}><b>{FUNNEL_LABELS[s]}</b> — {data.definitions.stages[s]}</li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Someone becomes a lead only when contact happens. An accepted connection request is still “Contacted” until
          they answer. Resting = in contact but quiet for 30 days with nothing planned. Opportunities created directly
          count in Opportunity and Client but not in any conversion rate.
        </p>
      </section>
    </div>
  );
}

function FunnelPage() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const icp = sp.get('icp_id') || '';
  const owner = sp.get('owner') || '';
  const lane = sp.get('lane') || '';
  const period = (sp.get('period') || '') as FunnelPeriod | '';
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
  const query = { icp_id: icp || undefined, owner: owner || undefined, lane: lane || undefined,
    period: period || undefined, view: view || undefined };
  const { data, error } = useFunnel(query);
  const insights = useInsights({ icp_id: icp || undefined, owner: owner || undefined, period: period || undefined });

  const open = (k: 'findings' | 'more') => {
    setMore(k);
    setTimeout(() => document.getElementById('funnel-more')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const listName = lists.find((l) => l.id === icp)?.name;
  const ownerName = owner === 'me' ? 'me' : users.find((u) => u.id === owner)?.name;
  const subtitle = data
    ? [`${data.people.toLocaleString()} ${unit}`, listName ?? 'all lists', ownerName ?? 'whole team',
      lane ? FUNNEL_LANES[lane as FunnelLane] : null, period ? FUNNEL_PERIODS[period] : 'any time',
      data.evaluated_at ? `updated ${new Date(data.evaluated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null]
      .filter(Boolean).join(' · ')
    : 'Every person once, at the furthest stage they reached.';

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <PageHeader title="Funnel" subtitle={subtitle}
          actions={(
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select value={icp} onChange={(e) => set('icp_id', e.target.value)} className="px-2 py-1.5 rounded-lg outline-none max-w-[220px]" style={selectStyle} aria-label="List">
                <option value="">All lists</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <select value={owner} onChange={(e) => set('owner', e.target.value)} className="px-2 py-1.5 rounded-lg outline-none" style={selectStyle} aria-label="Teammate">
                <option value="">Whole team</option>
                <option value="me">Me</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <select value={lane} onChange={(e) => set('lane', e.target.value)} className="px-2 py-1.5 rounded-lg outline-none" style={selectStyle} aria-label="Lane">
                <option value="">All lanes</option>
                {(Object.keys(FUNNEL_LANES) as FunnelLane[]).map((k) => <option key={k} value={k}>{FUNNEL_LANES[k]}</option>)}
              </select>
              <select value={period} onChange={(e) => set('period', e.target.value)} className="px-2 py-1.5 rounded-lg outline-none" style={selectStyle}
                aria-label="Period" title="Adds to each step how many people entered it in the period">
                <option value="">Any time</option>
                {(Object.keys(FUNNEL_PERIODS) as FunnelPeriod[]).map((k) => <option key={k} value={k}>{FUNNEL_PERIODS[k]}</option>)}
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
        <div className="p-4 space-y-4 max-w-[1400px]">
          {error && <div className="text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>{error}</div>}
          {!data && !error && (
            <div className="space-y-4" aria-busy="true">
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: 'var(--bg-input)' }} />)}</div>
              <div className="h-80 rounded-xl animate-pulse" style={{ background: 'var(--bg-input)' }} />
            </div>
          )}
          {data && (
            <>
              <Tiles data={data} insights={insights.data} unit={unit} />
              <FunnelChart data={data} unit={unit} />
              <div className="grid gap-3 md:grid-cols-3">
                <BiggestLeak data={data} />
                <WhatWorks insights={insights.data} error={insights.error} onAll={() => open('findings')} />
                <Lanes data={data} onMore={() => open('more')} />
              </div>
              <section id="funnel-more" className="z-panel p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {([['', 'More'], ['findings', 'What converts, in full'], ['more', 'Channels, exits, definitions']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setMore(k)} className="text-xs px-2.5 py-1 rounded-full"
                      style={{ background: more === k ? 'var(--accent)' : 'var(--bg-input)', color: more === k ? 'var(--accent-fg)' : 'var(--text)' }}>{l}</button>
                  ))}
                </div>
                {more === '' && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>The full findings table, channels, exits and the definitions the whole team uses.</p>}
                {more === 'findings' && <Insights data={insights.data} error={insights.error} />}
                {more === 'more' && <More data={data} />}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><FunnelPage /></Suspense>;
}
