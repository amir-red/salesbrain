'use client';

import { AGENTS, AGENT_LABELS } from '@/lib/users-panel';
import type { UsersFilter } from '@/lib/users-panel';

/** The filter bar over /admin/users. `q` and `app` refetch; the rest filter locally. */
export default function UsersFilterBar({ filter, apps, shown, total, onChange }: {
  filter: UsersFilter; apps: string[]; shown: number; total: number;
  onChange: (next: UsersFilter) => void;
}) {
  const set = <K extends keyof UsersFilter>(k: K, v: UsersFilter[K]) => onChange({ ...filter, [k]: v });
  const sel: React.CSSProperties = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };
  const toggle = (label: string, k: 'linkedin' | 'runningNow' | 'errors24h') => (
    <button onClick={() => set(k, !filter[k])} className="px-2 py-1 rounded-lg text-[11px]"
            style={{ border: `1px solid ${filter[k] ? 'var(--accent)' : 'var(--border)'}`, color: filter[k] ? 'var(--accent)' : 'var(--text-muted)' }}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <input value={filter.q} onChange={(e) => set('q', e.target.value)} placeholder="Search name, email, employee id…"
             className="px-2.5 py-1.5 rounded-lg text-xs w-64" style={sel} />
      <select value={filter.app} onChange={(e) => set('app', e.target.value)} className="px-2 py-1.5 rounded-lg text-xs" style={sel}>
        <option value="all">All sources</option>
        <option value="internal">Internal users</option>
        {apps.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select value={filter.agent} onChange={(e) => set('agent', e.target.value as UsersFilter['agent'])} className="px-2 py-1.5 rounded-lg text-xs" style={sel}>
        <option value="any">Any agent</option>
        {AGENTS.map((a) => <option key={a} value={a}>{AGENT_LABELS[a]}</option>)}
      </select>
      <select value={filter.state} onChange={(e) => set('state', e.target.value as UsersFilter['state'])} className="px-2 py-1.5 rounded-lg text-xs" style={sel}>
        <option value="any">Any state</option>
        <option value="held">Held (paused or stopped)</option>
        <option value="running">Running</option>
        <option value="paused">Paused</option>
        <option value="stopped">Stopped</option>
      </select>
      {toggle('has LinkedIn', 'linkedin')}
      {toggle('running now', 'runningNow')}
      {toggle('errors 24h', 'errors24h')}
      <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>{shown} of {total} users</span>
    </div>
  );
}
