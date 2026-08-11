'use client';

import { useState } from 'react';

interface Deal {
  id: string;
  name: string;
  company: string;
  gate: number;
  score: number | null;
  risk: string | null;
  value: string | null;
  currency: string;
  owner: string | null;
  lead_id: string | null;
  lead_name: string | null;
  gate_entered_at: string;
  days_in_gate: number;
  sla_days: number;
  is_overdue: boolean;
  is_board: boolean;
  /** Lost deals are excluded from 'All' / 'My deals' / 'Overdue' /
   *  'Board pending'. The 'Lost' chip shows only lost ones. */
  is_lost: boolean;
}

interface Gate {
  number: number;
  name: string;
  color: string;
  sla_days: number;
  is_board: boolean;
  description: string | null;
  required_fields: string[];
  deals: Deal[];
  /** Optional column-header label override. Pseudo-columns in the grants
   * stage view set this to a plain name ("Securing") so the header
   * doesn't render as "G1: Securing" — which reads like a real gate. */
  label?: string;
}

type GrantView = 'stages' | 'gates';

const FILTERS = ['All', 'My deals', 'Overdue', 'Board pending', 'Lost'] as const;

function DealCard({ deal }: { deal: Deal }) {
  const slaRatio = deal.days_in_gate / deal.sla_days;
  const badgeColor = slaRatio >= 1 ? 'var(--red)' : slaRatio >= 0.7 ? 'var(--yellow)' : 'var(--green)';

  return (
    <a
      href={`/deals/${deal.id}`}
      className="block rounded-lg p-3 mb-2 transition-colors"
      style={{
        // Lost cards: dim background + red left-border so they're visually
        // distinct from active overdue ones (which are red border + normal bg).
        background: deal.is_lost ? 'rgba(239,68,68,0.05)' : 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderLeft: deal.is_lost
          ? '3px solid #ef4444'
          : deal.is_overdue
            ? '3px solid var(--red)'
            : '3px solid transparent',
        opacity: deal.is_lost ? 0.75 : 1,
      }}
    >
      <div className="flex items-center gap-1.5">
        {deal.is_lost && (
          <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded font-semibold flex-shrink-0"
                style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444' }}>
            Lost
          </span>
        )}
        <p className="text-sm font-medium truncate">{deal.name}</p>
      </div>
      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{deal.company}</p>
      <div className="flex items-center justify-between mt-2">
        {deal.value && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {deal.currency} {Number(deal.value).toLocaleString()}
          </span>
        )}
        {deal.is_board ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(109,40,217,0.2)', color: '#a78bfa' }}>
            Board
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${badgeColor}20`, color: badgeColor }}>
            {deal.days_in_gate}d / {deal.sla_days}d
          </span>
        )}
      </div>
      {deal.lead_name && (
        <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex w-3.5 h-3.5 rounded-full items-center justify-center text-[7px] font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>
            {deal.lead_name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
          </span>
          {deal.lead_name}
        </p>
      )}
    </a>
  );
}

type PipelineTab = 'sales' | 'grant';

interface FilterBarProps {
  salesGates: Gate[];
  grantGates: Gate[];
  /** Grants collapsed into 2 stage columns (Securing / Disbursement) —
   * Hannes's default view. `grantGates` (10 columns) stays available
   * behind the "Gates" toggle for admins who want to see the full gate
   * breakdown. */
  grantStages: Gate[];
  currentUserId: string;
}

export default function FilterBar({ salesGates, grantGates, grantStages, currentUserId }: FilterBarProps) {
  const [pipeline, setPipeline] = useState<PipelineTab>('sales');
  const [filter, setFilter] = useState<typeof FILTERS[number]>('All');
  const [grantView, setGrantView] = useState<GrantView>('stages');

  const activeGates = pipeline === 'sales'
    ? salesGates
    : (grantView === 'stages' ? grantStages : grantGates);

  const filteredGates = activeGates.map((g) => ({
    ...g,
    deals: g.deals.filter((d) => {
      // The 'Lost' chip is the ONLY way to see lost deals — every other
      // filter hides them so the active board stays clean.
      if (filter === 'Lost') return d.is_lost;
      if (d.is_lost) return false;
      if (filter === 'All') return true;
      if (filter === 'My deals') return d.lead_id === currentUserId;
      if (filter === 'Overdue') return d.is_overdue;
      if (filter === 'Board pending') return d.is_board;
      return true;
    }),
  }));

  // Header counts: total active (excluding lost) so the pipeline tabs reflect
  // the *board* size, not the all-time count.
  const salesCount = salesGates.reduce((sum, g) => sum + g.deals.filter((d) => !d.is_lost).length, 0);
  const grantCount = grantGates.reduce((sum, g) => sum + g.deals.filter((d) => !d.is_lost).length, 0);

  return (
    <div>
      {/* Pipeline tabs */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setPipeline('sales')}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: pipeline === 'sales' ? 'var(--accent)' : 'var(--bg-card)',
            color: pipeline === 'sales' ? '#fff' : 'var(--text-muted)',
            border: `1px solid ${pipeline === 'sales' ? 'var(--accent)' : 'var(--border)'}`,
          }}
        >
          Sales ({salesCount})
        </button>
        <button
          onClick={() => setPipeline('grant')}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: pipeline === 'grant' ? 'var(--green)' : 'var(--bg-card)',
            color: pipeline === 'grant' ? '#fff' : 'var(--text-muted)',
            border: `1px solid ${pipeline === 'grant' ? 'var(--green)' : 'var(--border)'}`,
          }}
        >
          Grants ({grantCount})
        </button>

        {/* Grants-only: toggle between the 2-stage default view (Hannes's ask)
            and the full 10-gate view for admins drilling in. Not shown on
            sales — sales stays 9-gate always per Hannes's spec. */}
        {pipeline === 'grant' && (
          <div className="ml-auto flex rounded-lg overflow-hidden text-xs" style={{ border: '1px solid var(--border)' }}>
            {(['stages', 'gates'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setGrantView(v)}
                className="px-3 py-1.5 font-medium transition-colors capitalize"
                style={{
                  background: grantView === v ? 'var(--bg-input)' : 'transparent',
                  color: grantView === v ? 'var(--text)' : 'var(--text-muted)',
                }}
                title={v === 'stages'
                  ? 'Show 2 stages: Securing / Disbursement, Delivery & Reporting'
                  : 'Show all 10 underlying gates (G1..G10)'}
              >
                {v}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: filter === f ? 'var(--accent)' : 'var(--bg-input)',
              color: filter === f ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Kanban columns. Column width grows in stage view (2 columns to fill
          the space, no benefit to keeping them narrow like the 9/10-gate view). */}
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
        {filteredGates.map((g) => {
          const isStageColumn = !!g.label;   // pseudo-columns from buildGrantStageData
          const headerText = g.label || `G${g.number}: ${g.name}`;
          return (
          <div
            key={g.number}
            className={`flex-shrink-0 flex flex-col ${isStageColumn ? 'w-[26rem]' : 'w-56'}`}
          >
            {/* Column header */}
            <div
              className="rounded-t-lg px-3 py-2 flex items-center justify-between gap-1"
              style={{ background: g.color }}
            >
              <span className="text-xs font-medium text-white truncate flex-1" title={headerText}>
                {headerText}
              </span>
              <GateInfoTooltip gate={g} />
              <span className="text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">
                {g.deals.length}
              </span>
            </div>
            {/* Cards */}
            <div
              className="flex-1 p-2 rounded-b-lg overflow-y-auto"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderTop: 'none' }}
            >
              {g.deals.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>No deals</p>
              )}
              {g.deals.map((d) => (
                <DealCard key={d.id} deal={d} />
              ))}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Small `ⓘ` icon on a kanban column header. Hover opens a styled tooltip with
 * the gate's description, SLA, board-gate badge, and required fields.
 *
 * CSS-only hover (no JS state) so it stays cheap to render and works on every
 * column. Positioned absolutely below the icon so it doesn't push siblings.
 */
function GateInfoTooltip({ gate }: { gate: Gate }) {
  return (
    <div className="relative group flex-shrink-0">
      <button
        type="button"
        aria-label={`What is G${gate.number}?`}
        tabIndex={0}
        className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-white/20 hover:bg-white/40 transition-colors cursor-help"
      >
        i
      </button>

      {/* Tooltip — appears on hover OR keyboard focus. Pointer-events disabled
          so the tooltip itself can't accidentally re-trigger hover loops. */}
      <div
        role="tooltip"
        className="absolute right-0 top-full mt-2 w-72 z-30 rounded-lg p-3 text-left
                   opacity-0 invisible group-hover:opacity-100 group-hover:visible
                   group-focus-within:opacity-100 group-focus-within:visible
                   transition-opacity duration-150 pointer-events-none shadow-lg"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
            G{gate.number}: {gate.name}
          </span>
          {gate.is_board && (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
              style={{ background: 'rgba(109, 40, 217, 0.2)', color: '#a78bfa' }}
            >
              Board
            </span>
          )}
        </div>

        {gate.description ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {gate.description}
          </p>
        ) : (
          <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
            No description set for this gate.
          </p>
        )}

        <div className="flex items-center gap-3 mt-2 pt-2 border-t text-[10px]"
             style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <span>SLA: <strong style={{ color: 'var(--text)' }}>{gate.sla_days}d</strong></span>
          {gate.required_fields.length > 0 && (
            <span>
              Required: <strong style={{ color: 'var(--text)' }}>{gate.required_fields.length}</strong> field{gate.required_fields.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {gate.required_fields.length > 0 && (
          <details className="mt-2">
            <summary className="text-[10px] cursor-pointer pointer-events-auto" style={{ color: 'var(--text-muted)' }}>
              Show required fields
            </summary>
            <ul className="mt-1 text-[10px] space-y-0.5" style={{ color: 'var(--text)' }}>
              {gate.required_fields.map((f) => (
                <li key={f} className="font-mono">· {f}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
