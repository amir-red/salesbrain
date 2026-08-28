'use client';

import { useState } from 'react';

export interface ChipGroup { group: string; items: string[] }

interface Props {
  label: string;
  hint?: string;
  /** Flat list or grouped presets. Selected values not in the presets are shown as custom chips. */
  options: string[] | ChipGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  allowCustom?: boolean;
  placeholder?: string;
  /** Render labels differently from stored keys (e.g. size buckets). */
  labelOf?: (value: string) => string;
  /** Distinct style for "exclude" semantics. */
  tone?: 'include' | 'exclude';
  /** Show an "All" chip that clears the selection (= no constraint). */
  allLabel?: string;
}

function isGrouped(o: string[] | ChipGroup[]): o is ChipGroup[] {
  return o.length > 0 && typeof o[0] === 'object';
}

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Chip picker in the Gojiberry style: presets as toggle chips, custom values
 * typed in, selected values highlighted. Order of `selected` is preserved
 * because the scorer reports the FIRST criterion that matched.
 */
export default function ChipSelect({
  label, hint, options, selected, onChange, allowCustom = true, placeholder,
  labelOf, tone = 'include', allLabel,
}: Props) {
  const [draft, setDraft] = useState('');
  const has = (v: string) => selected.some((s) => eq(s, v));
  const toggle = (v: string) => onChange(has(v) ? selected.filter((s) => !eq(s, v)) : [...selected, v]);
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!has(v)) onChange([...selected, v]);
    setDraft('');
  };
  const presetValues = isGrouped(options) ? options.flatMap((g) => g.items) : options;
  const custom = selected.filter((s) => !presetValues.some((p) => eq(p, s)));
  const accent = tone === 'exclude' ? 'var(--red)' : 'var(--accent)';

  const chip = (value: string, on: boolean, onClick: () => void, removable = false) => (
    <button
      key={value}
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded-full text-xs border transition-colors"
      style={{
        background: on ? `${accent}22` : 'var(--bg-input)',
        borderColor: on ? accent : 'var(--border)',
        color: on ? accent : 'var(--text-muted)',
      }}
      title={on ? 'Click to remove' : 'Click to add'}
    >
      {labelOf ? labelOf(value) : value}
      {on && <span className="ml-1 opacity-70">{removable ? '×' : '✓'}</span>}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
          {label}
          {selected.length > 0 && (
            <span className="ml-2 normal-case tracking-normal" style={{ color: accent }}>{selected.length} selected</span>
          )}
        </label>
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-[11px] underline" style={{ color: 'var(--text-muted)' }}>
            clear
          </button>
        )}
      </div>
      {hint && <p className="text-[11px] -mt-1" style={{ color: 'var(--text-muted)' }}>{hint}</p>}

      {allLabel && (
        <div className="flex flex-wrap gap-1.5">
          {chip(allLabel, selected.length === 0, () => onChange([]))}
        </div>
      )}

      {isGrouped(options) ? (
        options.map((g) => (
          <div key={g.group} className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)', opacity: 0.8 }}>{g.group}</div>
            <div className="flex flex-wrap gap-1.5">{g.items.map((v) => chip(v, has(v), () => toggle(v)))}</div>
          </div>
        ))
      ) : (
        <div className="flex flex-wrap gap-1.5">{options.map((v) => chip(v, has(v), () => toggle(v)))}</div>
      )}

      {custom.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {custom.map((v) => chip(v, true, () => toggle(v), true))}
        </div>
      )}

      {allowCustom && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={placeholder || `Add ${label.toLowerCase()}…`}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
