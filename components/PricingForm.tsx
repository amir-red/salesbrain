'use client';

import { useState } from 'react';
import type { PricingInputs } from '@/lib/pricing/inputs';

/**
 * Shared pricing input form. Visible block = 8 core inputs reps usually touch.
 * Advanced expander = everything else (consultant rates, hours, tier mix, etc.)
 *
 * Stays a controlled component — parent owns `values` so it can prefill from
 * deal data, reset, or read on submit.
 */

export type PricingFormValues = Partial<PricingInputs>;

interface Props {
  values: PricingFormValues;
  onChange: (next: PricingFormValues) => void;
  onCalculate: () => void;
  onReset?: () => void;
  busy?: boolean;
  disabled?: boolean;
}

export default function PricingForm({ values, onChange, onCalculate, onReset, busy, disabled }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const set = <K extends keyof PricingInputs>(key: K, v: PricingInputs[K] | undefined) => {
    onChange({ ...values, [key]: v });
  };

  function num(key: keyof PricingInputs, label: string, opts: { hint?: string; step?: number; pct?: boolean } = {}) {
    const raw = values[key];
    const displayVal = raw === undefined || raw === null
      ? ''
      : opts.pct ? String(Number(raw) * 100)
      : String(raw);
    return (
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
          {label} {opts.pct && <span className="opacity-50">(%)</span>}
        </span>
        <input
          type="number"
          step={opts.step ?? (opts.pct ? 1 : 'any')}
          value={displayVal}
          disabled={disabled || busy}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') return set(key, undefined as unknown as PricingInputs[typeof key]);
            const n = Number(v);
            set(key, (opts.pct ? n / 100 : n) as PricingInputs[typeof key]);
          }}
          className="w-full px-2 py-1.5 rounded border text-sm"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
        {opts.hint && <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{opts.hint}</p>}
      </label>
    );
  }

  function text(key: keyof PricingInputs, label: string, placeholder?: string) {
    return (
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <input
          type="text"
          value={(values[key] as string | undefined) ?? ''}
          placeholder={placeholder}
          disabled={disabled || busy}
          onChange={(e) => set(key, (e.target.value || undefined) as PricingInputs[typeof key])}
          className="w-full px-2 py-1.5 rounded border text-sm"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
      </label>
    );
  }

  return (
    <div className="space-y-4">
      {/* Core (visible) */}
      <div className="space-y-3">
        <h3 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Customer</h3>
        <div className="grid grid-cols-2 gap-3">
          {text('customer_name', 'Company name')}
          {text('country', 'Country', 'e.g. Denmark')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {num('seats', 'Total employees (seats)')}
          {num('customer_annual_revenue', 'Customer annual revenue (USD)')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {num('customer_annual_labor_cost', 'Annual labor cost (USD)', { hint: '≈30% of revenue if unknown' })}
          {num('ebitda_pct', 'EBITDA %', { pct: true })}
        </div>
        {num('pilot_discount', 'Pilot discount', { pct: true })}
      </div>

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        className="text-xs font-medium px-2 py-1 rounded"
        style={{ background: 'var(--bg-input)', color: 'var(--text)' }}
      >
        {advancedOpen ? '▼ Hide advanced' : '▶ Advanced inputs'}
      </button>

      {advancedOpen && (
        <div className="space-y-4 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <Section title="Pilot economics">
            <div className="grid grid-cols-3 gap-3">
              {num('consultant_base_rate', 'Consultant base rate ($/hr)')}
              {num('consultant_count', 'Consultants')}
              {num('consultant_hours', 'Hours per consultant')}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {num('travel_per_consultant', 'Travel per consultant ($)')}
              {num('hotel_nightly_rate', 'Hotel nightly ($)')}
              {num('llm_cost_per_person_day', 'LLM cost /person/day ($)')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {num('pilot_people_observed', 'People observed in pilot')}
              {num('pilot_observation_days', 'Pilot observation days')}
            </div>
          </Section>
          <Section title="Implementation">
            <div className="grid grid-cols-3 gap-3">
              {num('impl_integration_hrs_per_emp', 'Integration hrs/emp')}
              {num('impl_workflow_hrs_per_emp', 'Workflow hrs/emp')}
              {num('impl_training_hrs_per_emp', 'Training hrs/emp')}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {num('impl_calibration_hrs_per_emp', 'Calibration hrs/emp')}
              {num('impl_pm_hours', 'PM hours (fixed)')}
              {num('impl_travel_budget', 'Travel budget ($)')}
            </div>
          </Section>
          <Section title="Recurring">
            <div className="grid grid-cols-2 gap-3">
              {num('seat_base_price', 'Base seat price /month ($)')}
              {num('improvement_subscription', 'Improvement subscription /seat/mo ($)')}
            </div>
          </Section>
          <Section title="Agent revenue (tier mix must sum to 100%)">
            {num('automatable_work_pct', 'Automatable work %', { pct: true })}
            <div className="grid grid-cols-4 gap-3">
              {num('tier1_pct', 'Tier 1 (10% capture)', { pct: true })}
              {num('tier2_pct', 'Tier 2 (15%)', { pct: true })}
              {num('tier3_pct', 'Tier 3 (20%)', { pct: true })}
              {num('tier4_pct', 'Tier 4 (25%)', { pct: true })}
            </div>
          </Section>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          onClick={onCalculate}
          disabled={disabled || busy}
          className="flex-1 px-4 py-2 rounded text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#0b1220' }}
        >
          {busy ? 'Calculating…' : 'Calculate'}
        </button>
        {onReset && (
          <button
            onClick={onReset}
            disabled={disabled || busy}
            className="px-3 py-2 rounded text-sm border disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            Reset to defaults
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{title}</h4>
      {children}
    </div>
  );
}
