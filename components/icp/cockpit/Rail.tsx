'use client';

/**
 * The right-hand rail of /icp/[id] (design B, 2026-10-28): the state of the list next to its leads table. Each card is
 * short and opens the full detail in a drawer; nothing here acts on its own.
 */
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { AgentRun } from '@/lib/icp';
import type { ListFunnel, PanelPayload } from '@/lib/icp-panel';
import { summarizeCriteria } from '@/lib/icp';
import { pct } from '@/lib/funnel';
import { STATUS_STYLE, type CampaignRow } from '@/lib/campaigns';
import { relativeTime } from '@/lib/time';
import { Chevron } from '@/components/icons';

const muted = { color: 'var(--text-muted)' };

function Card({ title, right, children, tone }: { title: string; right?: ReactNode; children: ReactNode; tone?: 'accent' }) {
  return (
    <section className="rounded-xl p-4 space-y-2.5"
      style={tone === 'accent'
        ? { background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' }
        : { background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold" style={tone === 'accent' ? { color: 'var(--accent)' } : muted}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

const linkBtn = 'text-xs underline-offset-2 hover:underline';

/* ── Funnel ─────────────────────────────────────────────────────────── */

const STEPS = [
  ['prospect_ready', 'Ready to reach'], ['lead_contacted', 'Contacted'], ['lead_engaged', 'Answered'],
  ['lead_meeting', 'Meeting'], ['opportunity', 'Opportunity'],
] as const;

/** The list's funnel, read from the panel payload (person_funnel in SQL — no kernel process per load). */
export function RailFunnel({ icpId, funnel }: { icpId: string; funnel: ListFunnel | null }) {
  const data = funnel;
  const reached = (k: string) => {
    const m: Record<string, keyof ListFunnel> = { prospect_ready: 'ready', lead_contacted: 'contacted', lead_engaged: 'answered', lead_meeting: 'meeting', opportunity: 'opportunity' };
    const key = m[k];
    return key ? Number(data?.[key] ?? 0) : 0;
  };
  const top = data?.found ?? 0;
  const rows: [string, number][] = [['On the list', top], ...STEPS.map(([k, l]) => [l, reached(k)] as [string, number])];
  return (
    <Card title="Funnel" right={<Link href={`/dashboard?icp_id=${icpId}`} className={linkBtn} style={muted}>Full funnel</Link>}>
      {!data && <p className="text-xs" style={muted}>No funnel yet — people appear here once the hourly refresh has seen them.</p>}
      {data && rows.map(([label, n], i) => {
        const prev = i > 0 ? rows[i - 1][1] : 0;
        const w = top ? Math.max(n ? 3 : 0, Math.round(Math.sqrt(n / top) * 100)) : 0;
        return (
          <div key={label} className="grid items-center gap-2 text-xs" style={{ gridTemplateColumns: '96px 1fr 36px' }}>
            <span className="truncate">{label}</span>
            <div className="h-2 rounded-full" style={{ background: 'var(--bg-input)' }}>
              <div className="h-2 rounded-full" style={{ width: `${w}%`, background: 'var(--accent)' }} />
            </div>
            <span className="text-right font-mono" title={i > 1 && prev ? `${pct(n / prev)} of the step before` : undefined}>{n}</span>
          </div>
        );
      })}
      {data && reached('lead_contacted') > 0 && (
        <p className="text-[11px]" style={muted}>
          {pct(reached('lead_engaged') / reached('lead_contacted'))} of contacted answered · {pct(reached('opportunity') / reached('lead_contacted'))} became an opportunity
        </p>
      )}
    </Card>
  );
}

/* ── Needs you ──────────────────────────────────────────────────────── */

const KIND_LABEL: Record<string, [string, string]> = {
  connect: ['connection request', 'connection requests'],
  outreach: ['message', 'messages'],
  followup: ['follow-up', 'follow-ups'],
  intro_request: ['intro ask', 'intro asks'],
  proposal: ['agent proposal', 'agent proposals'],
};

export function NeedsYou({ data, onOpen }: { data: PanelPayload; onOpen: () => void }) {
  const counts: Record<string, number> = {};
  for (const a of data.outreach.pending) { const k = a.kind || 'outreach'; counts[k] = (counts[k] ?? 0) + 1; }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = data.outreach.pending.length;
  return (
    <Card title="Needs you" tone="accent">
      {total === 0
        ? <p className="text-xs" style={muted}>Nothing waiting for a decision on this list.</p>
        : <>
            {entries.map(([k, n]) => (
              <div key={k} className="flex justify-between text-xs">
                <span>{(KIND_LABEL[k] ?? [k, k])[n === 1 ? 0 : 1].replace(/^./, (c) => c.toUpperCase())}</span>
                <b className="font-semibold">{n}</b>
              </div>
            ))}
            <button type="button" onClick={onOpen} className="w-full h-9 rounded-full text-xs font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              {data.is_owner ? `Review ${total}` : `See ${total} · ${data.icp.owner_name} decides`}
            </button>
          </>}
    </Card>
  );
}

/* ── Agents ─────────────────────────────────────────────────────────── */

type Tone = 'ok' | 'off' | 'warn' | 'bad' | 'busy';
const DOT: Record<Tone, string> = { ok: 'var(--green)', off: 'var(--text-muted)', warn: 'var(--yellow)', bad: 'var(--red)', busy: 'var(--accent)' };

function runTone(run: AgentRun | null): Tone {
  if (!run) return 'off';
  if (run.status === 'error') return 'bad';
  if (run.status === 'running' || run.status === 'requested') return 'busy';
  return 'ok';
}
function when(run: AgentRun | null): string {
  if (!run) return 'no runs';
  if (run.status === 'running') return 'running now';
  return relativeTime(run.finished_at || run.started_at);
}

export type AgentKey = 'finder' | 'enricher' | 'graph' | 'outreach';

function AgentLine({ name, tone, when: w, line, onOpen }: { name: string; tone: Tone; when: string; line: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full text-left py-1.5 group" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 text-xs">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DOT[tone] }} aria-hidden="true" />
        <span className="font-medium">{name}</span>
        <span className="ml-auto" style={muted}>{w}</span>
        <Chevron width={12} height={12} style={muted} aria-hidden="true" />
      </div>
      <div className="text-[11px] pl-4 mt-0.5 group-hover:underline" style={muted}>{line}</div>
    </button>
  );
}

export function AgentsCard({ data, onOpen, onActivity }: { data: PanelPayload; onOpen: (a: AgentKey) => void; onActivity: () => void }) {
  const { finder, enricher, graph, outreach, coverage, policy, blockers, icp } = data;
  const handMade = icp.objective === 'list';
  const fRun = finder.runs[0] ?? null;
  const finderTone: Tone = handMade ? 'off' : !policy.enabled.leads_finder ? 'off' : blockers.length ? 'warn' : runTone(fRun);
  const finderLine = handMade ? 'Hand-made list: nothing to search'
    : !policy.enabled.leads_finder ? 'Switched off for everyone'
    : blockers.length ? `Will not run: ${blockers[0]}`
    : fRun ? `Last pass: ${fRun.matched} matched · ${fRun.created} new` : 'Has not searched yet';
  const eRun = enricher.runs[0] ?? null;
  const eligible = coverage.eligible || coverage.total;
  const gRun = graph.last_run;
  return (
    <Card title="Agents on this list" right={<button type="button" onClick={onActivity} className={linkBtn} style={muted}>Activity</button>}>
      <AgentLine name="Leads Finder" tone={finderTone} when={handMade ? 'off' : when(fRun)} line={finderLine} onOpen={() => onOpen('finder')} />
      <AgentLine name="Enricher" tone={policy.enabled.enricher ? runTone(eRun) : 'off'} when={when(eRun)}
        line={`${coverage.employer}/${eligible} employer · ${coverage.email} email · ${coverage.research} researched`} onOpen={() => onOpen('enricher')} />
      <AgentLine name="Warm routes" tone={graph.sync?.last_error ? 'bad' : runTone(gRun)} when={when(gRun)}
        line={`${coverage.routed} leads with a warm route · ${coverage.warm} with a warm angle`} onOpen={() => onOpen('graph')} />
      <AgentLine name="Outreach" tone={policy.enabled.outreach ? runTone(outreach.last_run) : 'off'} when={when(outreach.last_run)}
        line={`${outreach.by_status.sent ?? 0} sent · ${outreach.pending.length} waiting · ${outreach.intros.open.length} intro asks open`} onOpen={() => onOpen('outreach')} />
    </Card>
  );
}

/* ── Campaigns ──────────────────────────────────────────────────────── */

export function CampaignsCard({ icpId }: { icpId: string }) {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/campaigns').then((r) => r.json()).then((out) => {
      if (!live) return;
      if (out?.error) { setError(true); return; }
      setRows(((out.campaigns ?? []) as CampaignRow[]).filter((c) => (c.lists ?? []).some((l) => l.icp_id === icpId && l.include !== false)));
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [icpId]);
  return (
    <Card title="Campaigns" right={<Link href="/campaigns/new" className={linkBtn} style={muted}>New</Link>}>
      {error && <p className="text-xs" style={muted}>Could not load campaigns.</p>}
      {!rows && !error && <p className="text-xs" style={muted}>Loading…</p>}
      {rows?.length === 0 && <p className="text-xs" style={muted}>No campaign uses this list yet. A campaign is what sends to it.</p>}
      {rows?.map((c) => (
        <Link key={c.id} href={`/campaigns/${c.id}`} className="block text-xs hover:underline">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{c.name}</span>
            <span className="shrink-0 text-[11px]" style={{ color: STATUS_STYLE[c.status]?.color }}>{STATUS_STYLE[c.status]?.label ?? c.status}</span>
          </div>
          <div className="text-[11px]" style={muted}>
            {c.enrolled} enrolled · {c.sent} sent{c.cards_waiting ? ` · ${c.cards_waiting} cards waiting` : ''}
          </div>
        </Link>
      ))}
    </Card>
  );
}

/* ── Who belongs ────────────────────────────────────────────────────── */

export function WhoBelongsCard({ data, onOpen }: { data: PanelPayload; onOpen: () => void }) {
  const { icp, fit } = data;
  const text = icp.cohort && icp.cohort.key !== 'unsorted'
    ? icp.cohort.person_to_contact
    : icp.cohort?.characteristics || icp.description || summarizeCriteria(icp.criteria);
  return (
    <Card title="Who belongs" right={<button type="button" onClick={onOpen} className={linkBtn} style={muted}>Details</button>}>
      <p className="text-xs leading-relaxed line-clamp-4">{text || 'No description yet.'}</p>
      {icp.cohort && icp.cohort.key !== 'unsorted' && (
        <p className="text-[11px] line-clamp-3" style={muted}>{icp.cohort.characteristics}</p>
      )}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-input)' }}>{fit.strong} strong fit</span>
        <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-input)' }}>{fit.proceed} possible</span>
        <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-input)', ...muted }}>{fit.weak + fit.do_not_pursue} weak</span>
      </div>
    </Card>
  );
}
