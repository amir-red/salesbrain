'use client';

/**
 * The lists overview as funnels (design E, 2026-10-27, Amir: "little text, really present the funnel results and
 * the conversion rates"). One card per list with its own small funnel; a plum summary card for all lists.
 * Steps are cumulative (everyone who got at least that far), so every funnel narrows. Widths use a square-root
 * scale so 10 answers stay visible next to 1,655 found; a step nobody reached is a dashed outline. Each step shows its
 * conversion from the step before; the step that loses the most people is orange. The card's headline is the
 * conversion rate: contacted people who became an opportunity.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LIST_FUNNEL_STEPS, LIST_LANE_LABELS, blockersFor, rateLabel, stepRates, weakestStep } from '@/lib/icp-panel';
import type { ListFunnel, OverviewIcp, OwnerQuota } from '@/lib/icp-panel';
import type { IcpAgentState } from '@/lib/icp';
import type { RunMode } from '@/components/icp/IcpRow';

const fmt = (n: number) => n.toLocaleString('en-US');
const OPACITY = [1, 0.85, 0.7, 0.56, 0.44, 0.34];

/** A small narrowing funnel: bands on the left, number and step name on the right. */
export function MiniFunnel({ f, label, inverse = false }: { f: ListFunnel; label: string; inverse?: boolean }) {
  // inverse = drawn on the plum summary card: bands and text in the on-accent colour.
  const ink = inverse ? 'var(--accent-fg)' : 'var(--accent)';
  const text = inverse ? 'var(--accent-fg)' : 'var(--text)';
  const muted = inverse ? 'var(--accent-fg)' : 'var(--text-muted)';
  const bandH = 22, gap = 5, cx = 78, maxW = 150, minW = 12;
  const vals = LIST_FUNNEL_STEPS.map(([k]) => f[k]);
  const base = vals[0] || 1;
  const w = (v: number) => (v > 0 ? Math.max(minW, Math.sqrt(v / base) * maxW) : minW);
  const H = vals.length * (bandH + gap) - gap;
  const rates = stepRates(f);
  const weak = weakestStep(f);
  const warn = inverse ? 'var(--accent-fg)' : 'var(--orange)';
  return (
    <svg viewBox={`0 0 350 ${H}`} width="100%" role="img" style={{ display: 'block', fontFamily: 'inherit' }}
         aria-label={`${label}: ${LIST_FUNNEL_STEPS.map(([k, l]) => `${l} ${f[k]}`).join(', ')}`}>
      {vals.map((v, i) => {
        const y = i * (bandH + gap);
        const top = w(v);
        const next = vals[i + 1];
        const bot = v === 0 ? top : next !== undefined && next > 0 ? w(next) : top * 0.8;
        const pts = `${cx - top / 2},${y} ${cx + top / 2},${y} ${cx + bot / 2},${y + bandH} ${cx - bot / 2},${y + bandH}`;
        return (
          <g key={i}>
            {v > 0
              ? <polygon points={pts} style={{ fill: ink, fillOpacity: inverse ? OPACITY[i] * 0.9 : OPACITY[i] }} />
              : <polygon points={pts} style={{ fill: 'none', stroke: inverse ? 'var(--accent-fg)' : 'var(--border)', strokeOpacity: inverse ? 0.5 : 1, strokeDasharray: '3 3' }} />}
            <text x={176} y={y + bandH / 2 + 5} style={{ fontSize: 14, fontWeight: 600, fill: v === 0 ? muted : text, fillOpacity: inverse && v === 0 ? 0.7 : 1 }}>{fmt(v)}</text>
            <text x={222} y={y + bandH / 2 + 5} style={{ fontSize: 12, fill: muted, fillOpacity: inverse ? 0.85 : 1 }}>{LIST_FUNNEL_STEPS[i][1]}</text>
            {rates[i] !== null && (
              <text x={350} y={y + bandH / 2 + 5} textAnchor="end"
                    style={{ fontSize: 12, fontWeight: i === weak ? 700 : 500, fill: i === weak ? warn : muted, fillOpacity: inverse && i !== weak ? 0.85 : 1 }}>
                {rateLabel(vals[i], vals[i - 1])}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** All visible lists together, each person once: the same funnel, on plum. */
export function AllListsCard({ f, lists }: { f: ListFunnel; lists: number }) {
  return (
    <article className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
      <div>
        <h2 className="text-base font-semibold">All lists</h2>
        <p className="text-xs mt-1" style={{ opacity: 0.8 }}>{lists} {lists === 1 ? 'list' : 'lists'} · each person counted once</p>
      </div>
      <MiniFunnel f={f} label="All lists" inverse />
      <p className="text-sm" style={{ opacity: 0.9 }} title="Contacted people who became an opportunity">
        Conversion rate <b className="text-lg tabular-nums">{rateLabel(f.opportunity, f.contacted)}</b>
        <span className="text-xs ml-1.5" style={{ opacity: 0.8 }}>contacted → opportunity</span>
      </p>
      <div className="flex gap-3 text-xs" style={{ opacity: 0.9 }}>
        <Link href="/prospecting" className="underline">All prospects →</Link>
        <Link href="/prospecting?warm=1" className="underline">Warm people →</Link>
      </div>
    </article>
  );
}

/** One list. Name, owner and how people came in; its funnel; the conversion rate. Actions sit behind a menu. */
export default function ListFunnelCard({ icp, quota, viewerUserId, isAdmin, fleet, hold, busy, onRun, onState, onArchive }: {
  icp: OverviewIcp; quota: OwnerQuota | null; viewerUserId: string; isAdmin: boolean;
  fleet: { kill_switch: boolean; leads_finder_enabled: boolean };
  hold?: string | null;
  busy: boolean;
  onRun: (mode: RunMode) => Promise<Record<string, unknown>>;
  onState: (state: 'running' | 'paused') => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [running, setRunning] = useState<RunMode | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const f = icp.funnel;
  const isOwner = icp.owner_user_id === viewerUserId;
  const canEdit = isOwner || isAdmin;
  // A hand-picked list (objective 'list') is never searched, so the Leads Finder's blockers do not apply to it.
  const searched = icp.objective !== 'list';
  const blockers = searched
    ? blockersFor(icp, quota, { ...fleet, user_hold: hold ?? null }, (icp.agent_state as IcpAgentState | null) ?? null)
    : [];
  const canRun = isOwner && blockers.length === 0;
  const lane = f?.lane ? LIST_LANE_LABELS[f.lane] ?? null : null;
  const empty = !f || f.found === 0;

  const run = async (mode: RunMode) => {
    setMenu(false); setRunning(mode); setNote(null);
    try {
      const out = await onRun(mode);
      if (out?.error) setNote(String(out.error));
      else if (mode === 'now') setNote(`Found ${out?.new ?? 0} new · ${out?.analyzed ?? 0} looked at`);
      else setNote(String(out?.note || 'Queued for the next run.'));
    } finally { setRunning(null); }
  };
  const item = (label: string, onClick: () => void, disabled = false, title?: string) => (
    <button role="menuitem" onClick={onClick} disabled={disabled || busy} title={title}
            className="w-full text-left px-3 py-2 text-sm rounded-lg disabled:opacity-40 hover:bg-[var(--bg-input)]">
      {label}
    </button>
  );
  const noRunTitle = !isOwner ? 'Runs with the owner’s LinkedIn, so only the owner can start it' : blockers[0];

  if (empty) {
    return (
      <article className="rounded-2xl p-5 flex flex-col gap-2 justify-center min-h-[160px]" style={{ border: '1px dashed var(--border)' }}>
        <Link href={`/icp/${icp.id}`} className="text-[15px] font-medium hover:underline truncate">{icp.name}</Link>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {isOwner ? 'You' : icp.owner_name} · {icp.paused_at ? 'paused' : 'no people yet'}
        </p>
        <Link href={`/icp/${icp.id}`} className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
          {icp.paused_at ? 'Open' : 'Find people'} →
        </Link>
      </article>
    );
  }

  return (
    <article className="rounded-2xl p-5 flex flex-col gap-4 min-w-0" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/icp/${icp.id}`} className="block text-base font-semibold truncate hover:underline" title={icp.name}>{icp.name}</Link>
          <p className="text-xs mt-1 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-muted)' }}>
            {isOwner ? 'You' : icp.owner_name}
            {icp.paused_at && <span title={icp.paused_reason || undefined}>· paused</span>}
            {blockers.length > 0 && !icp.paused_at && (
              <span className="inline-flex items-center gap-1" style={{ color: 'var(--orange)' }} title={blockers.join('\n')}>
                <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--orange)' }} />not searching
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {lane && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>{lane}</span>
          )}
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label={`Actions for ${icp.name}`}
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--bg-input)]" style={{ color: 'var(--text-muted)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="3" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="13" cy="8" r="1.4" fill="currentColor" /></svg>
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-9 z-20 w-52 rounded-xl p-1 shadow-lg"
                   style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <Link href={`/icp/${icp.id}`} role="menuitem" className="block px-3 py-2 text-sm rounded-lg hover:bg-[var(--bg-input)]">Open</Link>
                {searched && item('Find more now', () => run('now'), !canRun, canRun ? undefined : noRunTitle)}
                {searched && item('Queue a search', () => run('queue'), !canRun, canRun ? undefined : noRunTitle)}
                {item('Enrich now', () => run('enrich'), !isOwner, isOwner ? undefined : noRunTitle)}
                {canEdit && (icp.paused_at
                  ? item('Resume', () => { setMenu(false); void onState('running'); })
                  : item('Pause', () => { setMenu(false); void onState('paused'); }))}
                {canEdit && item('Archive', () => { setMenu(false); void onArchive(); })}
              </div>
            )}
          </div>
        </div>
      </div>

      <MiniFunnel f={f} label={icp.name} />

      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }} title="Contacted people who became an opportunity">
          Conversion rate{' '}
          <b className="text-lg tabular-nums" style={{ color: 'var(--text)' }}>{rateLabel(f.opportunity, f.contacted)}</b>
        </p>
        {icp.approvals.pending > 0 && (
          <Link href={`/icp/${icp.id}#outreach`} className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'color-mix(in srgb, var(--green) 14%, transparent)', color: 'var(--green)' }}>
            {icp.approvals.pending} to approve
          </Link>
        )}
      </div>
      {(running || note) && (
        <p className="text-xs -mt-2" style={{ color: note?.toLowerCase().includes('error') ? 'var(--red)' : 'var(--text-muted)' }}>
          {running ? 'Working…' : note}
        </p>
      )}
    </article>
  );
}
