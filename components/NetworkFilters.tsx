'use client';

import { useState } from 'react';

export interface NetworkFilterState {
  industries: string[];                // selected industries (empty = all)
  companies: string[];                 // selected company ids
  locations: string[];                 // selected locations
  titleContains: string;
  hasEmail: boolean | null;
  hasPhone: boolean | null;
  hasLinkedin: boolean | null;
  lastContacted: 'any' | 'never' | 'lt30' | 'gt30' | 'gt90';
  hasProspect: boolean | null;
  hasDeal: boolean | null;
}

export const EMPTY_FILTERS: NetworkFilterState = {
  industries: [], companies: [], locations: [], titleContains: '',
  hasEmail: null, hasPhone: null, hasLinkedin: null,
  lastContacted: 'any', hasProspect: null, hasDeal: null,
};

interface Props {
  filters: NetworkFilterState;
  onChange: (next: NetworkFilterState) => void;
  industries: string[];
  locations: string[];
  companies: { id: string; name: string }[];
}

export default function NetworkFilters({ filters, onChange, industries, locations, companies }: Props) {
  const [open, setOpen] = useState(false);
  const activeCount = countActive(filters);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 rounded border text-sm flex items-center gap-2"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        Filters
        {activeCount > 0 && (
          <span
            className="text-[10px] rounded-full px-1.5 py-0.5"
            style={{ background: 'var(--accent)', color: '#0b1220' }}
          >
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-full mt-1 right-0 w-[340px] p-3 rounded border z-30 shadow-lg max-h-[70vh] overflow-y-auto"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <MultiSelect
            label="Industry"
            options={industries.map((i) => ({ value: i, label: i }))}
            selected={filters.industries}
            onChange={(industriesSel) => onChange({ ...filters, industries: industriesSel })}
          />
          <MultiSelect
            label="Company"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            selected={filters.companies}
            onChange={(sel) => onChange({ ...filters, companies: sel })}
          />
          <MultiSelect
            label="Location"
            options={locations.map((l) => ({ value: l, label: l }))}
            selected={filters.locations}
            onChange={(sel) => onChange({ ...filters, locations: sel })}
          />

          <Divider />
          <label className="block text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Title contains
          </label>
          <input
            value={filters.titleContains}
            onChange={(e) => onChange({ ...filters, titleContains: e.target.value })}
            className="w-full px-2 py-1.5 rounded border text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            placeholder="e.g. CTO, Director"
          />

          <Divider />
          <TriCheckbox label="Has email" value={filters.hasEmail} onChange={(v) => onChange({ ...filters, hasEmail: v })} />
          <TriCheckbox label="Has phone" value={filters.hasPhone} onChange={(v) => onChange({ ...filters, hasPhone: v })} />
          <TriCheckbox label="Has LinkedIn URL" value={filters.hasLinkedin} onChange={(v) => onChange({ ...filters, hasLinkedin: v })} />
          <TriCheckbox label="Has prospect" value={filters.hasProspect} onChange={(v) => onChange({ ...filters, hasProspect: v })} />
          <TriCheckbox label="Has deal" value={filters.hasDeal} onChange={(v) => onChange({ ...filters, hasDeal: v })} />

          <Divider />
          <label className="block text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Last contacted
          </label>
          <select
            value={filters.lastContacted}
            onChange={(e) => onChange({ ...filters, lastContacted: e.target.value as NetworkFilterState['lastContacted'] })}
            className="w-full px-2 py-1.5 rounded border text-sm"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <option value="any">Any</option>
            <option value="never">Never</option>
            <option value="lt30">Less than 30 days</option>
            <option value="gt30">More than 30 days</option>
            <option value="gt90">More than 90 days</option>
          </select>

          <div className="flex justify-between mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <button
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => onChange(EMPTY_FILTERS)}
            >Reset all</button>
            <button
              className="text-xs px-3 py-1 rounded"
              style={{ background: 'var(--accent)', color: '#0b1220' }}
              onClick={() => setOpen(false)}
            >Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function countActive(f: NetworkFilterState): number {
  let n = 0;
  if (f.industries.length) n++;
  if (f.companies.length) n++;
  if (f.locations.length) n++;
  if (f.titleContains.trim()) n++;
  if (f.hasEmail !== null) n++;
  if (f.hasPhone !== null) n++;
  if (f.hasLinkedin !== null) n++;
  if (f.hasProspect !== null) n++;
  if (f.hasDeal !== null) n++;
  if (f.lastContacted !== 'any') n++;
  return n;
}

function Divider() {
  return <div className="h-px my-3" style={{ background: 'var(--border)' }} />;
}

function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState('');
  const show = options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase())).slice(0, 50);
  return (
    <div className="mb-3">
      <label className="block text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
        {label} {selected.length ? `(${selected.length})` : ''}
      </label>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`Filter ${label.toLowerCase()}…`}
        className="w-full px-2 py-1 rounded border text-xs mb-1"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
      />
      <div className="max-h-32 overflow-y-auto rounded border" style={{ borderColor: 'var(--border)' }}>
        {show.length === 0 && <p className="p-2 text-xs" style={{ color: 'var(--text-muted)' }}>No matches</p>}
        {show.map((o) => {
          const checked = selected.includes(o.value);
          return (
            <label
              key={o.value}
              className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-white/5 text-xs"
              style={{ color: 'var(--text)' }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  if (e.target.checked) onChange([...selected, o.value]);
                  else onChange(selected.filter((s) => s !== o.value));
                }}
              />
              <span className="truncate" title={o.label}>{o.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function TriCheckbox({ label, value, onChange }: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  function next() {
    if (value === null) onChange(true);
    else if (value === true) onChange(false);
    else onChange(null);
  }
  const display = value === null ? 'Any' : value ? 'Yes' : 'No';
  const color = value === null ? 'var(--text-muted)' : value ? '#34d399' : '#fb7185';
  return (
    <button
      onClick={next}
      className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-white/5"
      style={{ color: 'var(--text)' }}
    >
      <span>{label}</span>
      <span style={{ color }}>{display}</span>
    </button>
  );
}
