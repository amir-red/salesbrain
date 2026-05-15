'use client';

import type { PricingOutputs, PricingPnl } from '@/lib/pricing/inputs';

interface Props {
  outputs: PricingOutputs;
  pnl: PricingPnl;
  toolLabel?: string;       // e.g. "Pricing tool v3"
  currency?: string;        // default 'USD'
}

const USD = (currency: string, n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  // Compact for big numbers
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${currency} ${Math.round(v).toLocaleString()}`;
  return `${currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const PCT = (n: number | null | undefined, digits = 1): string => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return `${(Number(n) * 100).toFixed(digits)}%`;
};

const MULT = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(1)}×`;
};

const NUM = (n: number | null | undefined, digits = 1): string => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(digits);
};

export default function PricingResult({ outputs, pnl, toolLabel, currency = 'USD' }: Props) {
  const margin = pnl.year_1_revenue && pnl.year_1_gross_profit && pnl.year_1_revenue !== 0
    ? pnl.year_1_gross_profit / pnl.year_1_revenue
    : null;

  return (
    <div className="space-y-4">
      {toolLabel && (
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{toolLabel}</p>
      )}

      {/* Slide-ready numbers */}
      <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <h3 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
          Customer-facing pricing
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <BigStat label="Paid pilot"        value={USD(currency, outputs.pilot_price)} sub="One-time · credited toward impl" />
          <BigStat label="Implementation"    value={USD(currency, outputs.implementation_minus_pilot_credit)} sub={`Gross ${USD(currency, outputs.implementation_price)}`} />
          <BigStat label="Monthly recurring" value={USD(currency, outputs.monthly_total)} sub="Platform + agents + improvement" />
          <BigStat label="Year 1 total"      value={USD(currency, outputs.year_1_total)} sub="One-time + 12 × monthly" />
        </div>
      </div>

      {/* Customer ROI */}
      <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <h3 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
          Customer ROI
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Est. profit increase /yr" value={USD(currency, outputs.est_profit_increase)} />
          <Stat label="ROI (after impl)"        value={MULT(outputs.roi_after_impl)} sub="Steady-state" />
          <Stat label="Payback"                 value={`${NUM(outputs.payback_months, 1)} mo`} sub="Target <12" />
        </div>
      </div>

      {/* Breakdown */}
      <details className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <summary className="text-xs uppercase tracking-wider cursor-pointer" style={{ color: 'var(--text-muted)' }}>
          Monthly breakdown
        </summary>
        <div className="grid grid-cols-3 gap-4 mt-3">
          <Stat label="Monthly platform" value={USD(currency, outputs.monthly_platform)} />
          <Stat label="Monthly agents"   value={USD(currency, outputs.monthly_agents)} />
          <Stat label="Monthly improvement" value={USD(currency, outputs.monthly_improvement)} />
          <Stat label="Effective seat price" value={USD(currency, outputs.effective_seat_price)} />
          <Stat label="Agent rev /emp /mo" value={USD(currency, outputs.monthly_agent_rev_per_emp)} />
          <Stat label="Weighted capture rate" value={PCT(outputs.weighted_capture_rate)} />
        </div>
      </details>

      {/* Internal P&L */}
      <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Internal P&amp;L (Year 1)</h3>
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
            Internal — not shared with customer
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Revenue"      value={USD(currency, pnl.year_1_revenue)} />
          <Stat label="Gross profit" value={USD(currency, pnl.year_1_gross_profit)} />
          <Stat label="Gross margin" value={PCT(margin, 0)} />
        </div>
      </div>
    </div>
  );
}

function BigStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold mt-0.5" style={{ color: 'var(--text)' }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-base font-semibold mt-0.5" style={{ color: 'var(--text)' }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}
