'use client';

/**
 * /icp/[id] "Next move" (design A, 2026-10-29): the list page leads with the one move that brings people closest to
 * a client — a reply to answer beats a connection to message beats a request to send — then the five lanes with
 * their counts, the chosen lane's queue, and beside it the campaigns that send to the list (first), what happened
 * since yesterday, what the machinery holds in progress, and the journey in one line. The full table of people
 * stays one click away ("All people"). Reads one request (`GET /api/icp/[id]/journey`); every action goes through
 * the row's own route.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { JourneyCampaign, JourneyEvent, JourneyPayload, LaneKey } from '@/lib/icp-journey';
import { LANE_META, LANE_ORDER, heroFor } from '@/lib/icp-journey';
import { LIST_FUNNEL_STEPS, rateLabel, weakestStep } from '@/lib/icp-panel';
import { STATUS_STYLE, type CampaignStatus } from '@/lib/campaigns';
import { relativeTime } from '@/lib/time';
import { Pill } from '@/components/panel/PageHeader';
import { Skeleton, SkeletonCard } from '@/components/panel/Skeleton';
import Queue from './Queue';
import LeadsTable from '@/components/icp/LeadsTable';
import DailyConnectControl, { DAILY_CONNECT_TEXT } from '@/components/icp/DailyConnectControl';

const muted = { color: 'var(--text-muted)' };

function Card({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl p-3 space-y-2 ${className}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function JourneyView({ icpId, data, error, onChanged, onOpenPeople, leadsSignature = '' }: {
  icpId: string; data: JourneyPayload | null; error: string | null; onChanged: () => Promise<void>; onOpenPeople: () => void;
  /** The page's summary of the list; the people table below reloads only when it changes. */
  leadsSignature?: string;
}) {
  const [lane, setLane] = useState<LaneKey | null>(null);
  // The lane opens on the hero's move until the person picks another one.
  const hero = data ? heroFor(data) : null;
  const active: LaneKey = lane ?? hero?.lane ?? 'send';
  useEffect(() => { if (lane && data && data.lanes[lane].length === 0 && lane !== 'send') setLane(null); }, [data, lane]);

  if (!data) {
    return (
      <div className="p-4 space-y-4" aria-busy="true">
        {error ? <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>
          : <Skeleton className="h-[108px] w-full rounded-2xl" />}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>{LANE_ORDER.map((k) => <SkeletonCard key={k} lines={2} />)}</div>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)' }}><SkeletonCard lines={6} /><div className="space-y-3"><SkeletonCard lines={3} /><SkeletonCard lines={4} /></div></div>
      </div>
    );
  }

  const h = hero!;
  const heroColor = h.lane ? LANE_META[h.lane].color : 'var(--deep-violet)';
  const heroAction = () => {
    if (h.lane) setLane(h.lane);
    else if (!data.sender.linkedin) window.location.assign('/profile');
    else onOpenPeople();
  };

  return (
    <div className="p-4 space-y-4">
      {error && <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>Last refresh failed ({error}); showing the previous data.</div>}

      {/* Hero: the one move */}
      <div className="rounded-2xl px-6 py-5 flex items-center justify-between gap-6 flex-wrap" style={{ background: heroColor, color: '#fff' }}>
        <div className="flex flex-col gap-1.5 min-w-0" style={{ flex: '1 1 420px' }}>
          <span className="text-[11px] uppercase tracking-[.08em] opacity-80">Your next move</span>
          <span className="text-2xl font-semibold leading-tight" style={{ textWrap: 'balance' } as React.CSSProperties}>{h.title}</span>
          <span className="text-sm opacity-90 max-w-[720px]">{h.why}</span>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button type="button" onClick={heroAction} className="h-[42px] px-5 rounded-full text-sm font-semibold" style={{ background: '#fff', color: heroColor }}>{h.button}</button>
          {h.next && <span className="text-[11px] opacity-80">{h.next}</span>}
        </div>
      </div>

      {/* Lanes */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {LANE_ORDER.map((k) => {
          const m = LANE_META[k];
          const n = data.lanes[k].length;
          const extra = k === 'send' && n === 0 ? data.counts.send_ready : 0;
          const on = active === k;
          const textColor = `var(--lane-${k}-text)`;
          return (
            <button key={k} type="button" onClick={() => setLane(k)} aria-pressed={on}
              className="rounded-2xl px-4 py-3.5 text-left flex flex-col items-start gap-1.5"
              style={{ background: 'var(--bg-card)', border: on ? `2px solid ${m.color}` : '1px solid var(--border)', padding: on ? '13px 15px' : undefined }}>
              <span className="flex items-center justify-between w-full">
                <span className="text-xs font-semibold" style={{ color: textColor }}>{m.label}</span>
                <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${m.color} 12%, transparent)`, color: textColor }}>{m.when}</span>
              </span>
              <span className="text-3xl font-semibold leading-none font-mono">{n}{extra ? <span className="text-sm font-normal" style={muted}> · {extra.toLocaleString()} ready</span> : null}</span>
              <span className="text-xs" style={muted}>{m.sub}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0, 1fr) 300px' }}>
        {/* Left: the queue, then the people themselves — so the column is always as tall as the cards beside it. */}
        <div className="space-y-4 min-w-0">
          <Queue icpId={icpId} lane={active} data={data} onChanged={onChanged} />
          <section className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold">People · {data.icp.total.toLocaleString()}</h2>
              <span className="text-xs" style={muted}>highest priority first · the filters narrow this list</span>
              <button type="button" onClick={onOpenPeople} className="ml-auto text-xs hover:underline" style={{ color: 'var(--accent)' }}>Open the full view →</button>
            </div>
            <LeadsTable icpId={icpId} signature={leadsSignature} pageSize={10} />
          </section>
        </div>

        <div className="space-y-3 min-w-0">
          <Campaigns icpId={icpId} rows={data.campaigns} />
          <Happened events={data.events} />
          <InProgress data={data} onChanged={() => { void onChanged(); }} />
          <Journey data={data} onOpenPeople={onOpenPeople} />
        </div>
      </div>
    </div>
  );
}

/* ── Campaigns, up front: they are what keeps sending to the list without a person ─────────────────────────── */

function Campaigns({ icpId, rows }: { icpId: string; rows: JourneyCampaign[] }) {
  const live = rows.filter((c) => c.status === 'live');
  return (
    <Card title="Campaigns on this list" right={<Link href={`/campaigns/new?icp_id=${icpId}`} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>New</Link>}>
      {rows.length === 0 && (
        <p className="text-xs" style={muted}>No campaign sends to this list yet. A campaign connects, messages and follows up by itself — you only approve each day&rsquo;s card.</p>
      )}
      {rows.map((c) => {
        const st = STATUS_STYLE[c.status as CampaignStatus] ?? { label: c.status, color: 'var(--text-muted)' };
        return (
          <div key={c.id} className="rounded-xl px-2.5 py-2 space-y-0.5" style={{ background: 'var(--bg-input)' }}>
            <div className="flex items-center justify-between gap-2">
              <Link href={`/campaigns/${c.id}`} className="text-xs font-medium truncate hover:underline">{c.name}</Link>
              <Pill color={st.color}>{st.label}</Pill>
            </div>
            <div className="text-[11px] flex flex-wrap gap-x-3 gap-y-0.5" style={muted}>
              <span>{c.enrolled} enrolled</span>
              {c.active > 0 && <span>{c.active} in sequence</span>}
              <span>{c.sent} sent</span>
              {c.handed_off > 0 && <span>{c.handed_off} handed to a person</span>}
              {c.owner_name && <span>by {c.owner_name}</span>}
            </div>
            {c.cards_waiting > 0 && c.card_id && (
              <Link href={`/campaigns/cards/${c.card_id}`} className="inline-flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                {c.cards_waiting} {c.cards_waiting === 1 ? 'card waits' : 'cards wait'} for a tap →
              </Link>
            )}
            {c.status === 'draft' && <Link href={`/campaigns/${c.id}`} className="text-xs hover:underline" style={muted}>Not launched yet — open to check and launch →</Link>}
          </div>
        );
      })}
      {rows.length > 0 && live.length === 0 && <p className="text-[11px]" style={muted}>Nothing is live: the list only moves when a person acts here.</p>}
    </Card>
  );
}

/* ── What happened since yesterday ────────────────────────────────────────────────────────────────────────── */

const EVENT_COLOR: Record<JourneyEvent['kind'], string> = {
  reply: 'var(--lane-answer)', accepted: 'var(--lane-message)', sent: 'var(--lane-follow)', request: 'var(--lane-send)',
  found: 'var(--lane-pick)', run: 'var(--deep-violet)', campaign: 'var(--deep-violet)',
};
function Happened({ events: all }: { events: JourneyEvent[] }) {
  const [more, setMore] = useState(false);
  const events = more ? all : all.slice(0, 6);
  return (
    <Card title="What happened since yesterday" right={all.length > 6 ? <button type="button" onClick={() => setMore((m) => !m)} className="text-xs hover:underline" style={muted}>{more ? 'Fewer' : `All ${all.length}`}</button> : undefined}>
      {all.length === 0 && <p className="text-xs" style={muted}>Quiet day: no reply, acceptance, send or find on this list in the last 24 hours.</p>}
      {events.map((e, i) => (
        <div key={`${e.kind}-${i}`} className="grid gap-2 items-baseline text-[11px] leading-snug" style={{ gridTemplateColumns: '8px 1fr auto' }}>
          <span className="inline-block w-2 h-2 rounded-full relative top-px" style={{ background: EVENT_COLOR[e.kind] }} />
          <span className="min-w-0">{e.prospect_id ? <Link href={`/prospects/${e.prospect_id}`} className="hover:underline">{e.text}</Link> : e.text}</span>
          <span className="text-[11px] whitespace-nowrap" style={muted}>{relativeTime(e.at)}</span>
        </div>
      ))}
    </Card>
  );
}

/* ── In progress: what the machinery holds, with no one to act ────────────────────────────────────────────── */

function InProgress({ data, onChanged }: { data: JourneyPayload; onChanged?: (note: string) => void }) {
  const { counts, connect } = data;
  const lb = data.sender.last_batch;
  const batchLine = lb
    ? lb.status === 'pending' ? `card waiting for ${data.sender.name}'s tap (${lb.size})`
      : lb.status === 'sent' || lb.status === 'failed' ? `${lb.mode === 'auto' ? 'automatic' : 'card'}: ${lb.sent ?? 0} sent${lb.failed ? `, ${lb.failed} failed` : ''} ${relativeTime(lb.at)}`
      : `${lb.mode === 'auto' ? 'automatic' : 'card'} ${lb.status} ${relativeTime(lb.at)}`
    : null;
  const rows: [string, string][] = [
    ['Requests waiting for acceptance', counts.requests_pending.toLocaleString()],
    ['Profiles still to find', counts.no_profile.toLocaleString()],
    ['Messaged, waiting for an answer', counts.messaged_waiting.toLocaleString()],
    ['Follow-ups timed', counts.followups_timed.toLocaleString()],
    [`Requests used (last 24 h)`, `${connect.sent_today} / ${connect.per_day}`],
  ];
  return (
    <Card title="In progress">
      <div className="text-[11px] space-y-1">
        {rows.map(([l, v]) => <div key={l} className="flex justify-between gap-3"><span style={{ color: 'var(--text)' }}>{l}</span><b className="font-mono font-semibold">{v}</b></div>)}
      </div>
      <div className="pt-1 text-[11px] space-y-1" style={{ borderTop: '1px solid var(--border)' }}>
        <DailyConnectControl icpId={data.icp.id} mode={data.icp.daily_connect} canEdit={data.viewer.can_edit} senderName={data.sender.name} variant="inline" onChanged={onChanged} />
        <p style={muted}>
          {data.icp.daily_connect === 'off' ? 'Switch on to have the Lead Conductor queue this list every day after 09:00.' : `${DAILY_CONNECT_TEXT[data.icp.daily_connect].hint}`}
          {batchLine ? ` Last batch: ${batchLine}.` : ''}
        </p>
      </div>
      {!data.sender.linkedin && <p className="text-[11px]" style={{ color: 'var(--red)' }}>{data.sender.name} has no LinkedIn connected — requests and messages cannot go out.</p>}
      {data.sender.linkedin && connect.remaining === 0 && connect.next_request_at && <p className="text-[11px]" style={muted}>Next request free {relativeTime(connect.next_request_at)}.</p>}
    </Card>
  );
}

/* ── Journey in one line ──────────────────────────────────────────────────────────────────────────────────── */

function Journey({ data, onOpenPeople }: { data: JourneyPayload; onOpenPeople: () => void }) {
  const f = data.funnel;
  const weak = f ? weakestStep(f) : null;
  return (
    <Card title="Journey" right={<Link href={`/dashboard?icp_id=${data.icp.id}`} className="text-xs hover:underline" style={muted}>Full funnel</Link>}>
      {!f && <p className="text-xs" style={muted}>No funnel yet — people appear once the hourly refresh has seen them.</p>}
      {f && (
        <div className="text-[11px] leading-relaxed">
          {LIST_FUNNEL_STEPS.map(([k, label], i) => (
            <span key={k}>
              {i > 0 && <span style={muted}> → </span>}
              <span style={weak === i ? { color: 'var(--lane-answer-text)', fontWeight: 600 } : undefined}>{label} {f[k].toLocaleString()}</span>
            </span>
          ))}
        </div>
      )}
      {f && weak !== null && weak > 0 && (
        <p className="text-[11px]" style={muted}>
          Weakest step: {LIST_FUNNEL_STEPS[weak - 1][1].toLowerCase()} → {LIST_FUNNEL_STEPS[weak][1].toLowerCase()} ({rateLabel(f[LIST_FUNNEL_STEPS[weak][0]], f[LIST_FUNNEL_STEPS[weak - 1][0]])}).
          {weak === 3 && data.lanes.message.length > 0 ? ` Messaging the ${data.lanes.message.length} who accepted is the fix.` : ''}
        </p>
      )}
      <button type="button" onClick={onOpenPeople} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>All {data.icp.total.toLocaleString()} people ↓</button>
    </Card>
  );
}
