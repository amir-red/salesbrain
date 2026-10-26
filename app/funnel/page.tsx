'use client';

/**
 * /funnel — the whole funnel in one place: prospect → lead → opportunity → client, each person once
 * (plan: funnel-redesign.md, 2026-10-26). Slice by list, teammate and lane; the slice lives in the URL so a view is
 * shareable. Below the strip: how people came in (lanes), where they stand per channel, who left and where, and the
 * definitions the whole team uses.
 */
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import PageHeader from '@/components/panel/PageHeader';
import FunnelStrip, { GROUP_COLOR, useFunnel } from '@/components/panel/FunnelStrip';
import Insights from '@/components/funnel/Insights';
import {
  CHANNEL_LABELS, FUNNEL_EXITS, FUNNEL_GROUPS, FUNNEL_LANES, FUNNEL_PERIODS, FUNNEL_STAGES, FUNNEL_LABELS,
  type FunnelLane, type FunnelPeriod, type FunnelSummary,
} from '@/lib/funnel';

interface Opt { id: string; name: string; email?: string }

const selectStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };

function Card({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="z-panel p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Bar({ n, of, color }: { n: number; of: number; color: string }) {
  const w = of ? Math.max(2, Math.round((n / of) * 100)) : 0;
  return (
    <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-input)' }}>
      <div className="h-1.5 rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

function Breakdown({ data }: { data: FunnelSummary }) {
  const laneMax = Math.max(1, ...data.lanes.map((l) => l.total));
  const exitsAt = data.stages.filter((s) => Object.keys(s.exits).length);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="How they came in" hint="Lane = how a person entered the funnel. Leads = got to Lead or further.">
        <div className="space-y-2">
          {data.lanes.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nobody in this slice.</p>}
          {data.lanes.map((l) => (
            <div key={l.key} className="space-y-1">
              <div className="flex justify-between text-xs gap-2">
                <span>{l.label}</span>
                <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  <b style={{ color: 'var(--text)' }}>{l.total.toLocaleString()}</b> people · {l.leads.toLocaleString()} leads
                </span>
              </div>
              <Bar n={l.total} of={laneMax} color="var(--cat-blue)" />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Channels" hint="Where the people still in the funnel stand on each channel. A channel is not a stage.">
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
      </Card>

      <Card title="Who left or is resting, and where" hint="Counted at the furthest stage the person reached. Resting people come back by themselves at the next touch or reply.">
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
      </Card>

      <Card title="What the words mean" hint="The same definitions in the app, the bot and every report.">
        <div className="space-y-3">
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
            Someone becomes a lead only when contact happens. A found profile, a hand-picked list or a drafted message
            does not count. An accepted connection request is still “Contacted” until they answer. Resting = in
            contact but quiet for 30 days with nothing planned: kept for a later touch, not lost. Opportunities created
            directly count in Opportunity and Client but not in any conversion rate.
          </p>
        </div>
      </Card>
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
  const [lists, setLists] = useState<Opt[]>([]);
  const [users, setUsers] = useState<Opt[]>([]);

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

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <PageHeader title="Funnel"
          subtitle="Every person once, at the furthest stage they reached: prospect → lead → opportunity → client." />
        <div className="p-4 space-y-4 max-w-[1400px]">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select value={icp} onChange={(e) => set('icp_id', e.target.value)} className="px-2 py-1.5 rounded-lg outline-none max-w-[260px]" style={selectStyle}>
              <option value="">All lists</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select value={owner} onChange={(e) => set('owner', e.target.value)} className="px-2 py-1.5 rounded-lg outline-none" style={selectStyle}>
              <option value="">Whole team</option>
              <option value="me">Me</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => set('lane', '')} className="px-2 py-1 rounded-full"
                style={{ background: lane ? 'var(--bg-input)' : 'var(--accent)', color: lane ? 'var(--text)' : 'var(--accent-fg)' }}>All lanes</button>
              {(Object.keys(FUNNEL_LANES) as FunnelLane[]).map((k) => (
                <button key={k} onClick={() => set('lane', lane === k ? '' : k)} className="px-2 py-1 rounded-full"
                  style={{ background: lane === k ? 'var(--accent)' : 'var(--bg-input)', color: lane === k ? 'var(--accent-fg)' : 'var(--text)' }}>
                  {FUNNEL_LANES[k]}
                </button>
              ))}
            </div>
            <select value={period} onChange={(e) => set('period', e.target.value)} className="px-2 py-1.5 rounded-lg outline-none" style={selectStyle}
              title="Adds to each stage how many people entered it in the period">
              <option value="">Any time</option>
              {(Object.keys(FUNNEL_PERIODS) as FunnelPeriod[]).map((k) => <option key={k} value={k}>{FUNNEL_PERIODS[k]}</option>)}
            </select>
            <div className="inline-flex p-0.5 rounded-full" style={{ background: 'var(--bg-input)' }}>
              {([['', 'People'], ['companies', 'Companies']] as const).map(([k, l]) => (
                <button key={k} onClick={() => set('view', k)} className="px-2.5 py-1 rounded-full"
                  title={k ? 'Each company once, at the furthest stage of any of its people' : 'Each person once'}
                  style={{ background: view === k ? 'var(--bg-card)' : 'transparent', color: 'var(--text)' }}>{l}</button>
              ))}
            </div>
            {data && (
              <span style={{ color: 'var(--text-muted)' }}>
                {data.people.toLocaleString()} {view ? 'companies' : 'people'}
                {data.evaluated_at ? ` · updated ${new Date(data.evaluated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
              </span>
            )}
          </div>
          {error
            ? <div className="text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>{error}</div>
            : <FunnelStrip data={data} />}
          <Insights query={{ icp_id: icp || undefined, owner: owner || undefined, period: period || undefined }} />
          {data && <Breakdown data={data} />}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><FunnelPage /></Suspense>;
}
