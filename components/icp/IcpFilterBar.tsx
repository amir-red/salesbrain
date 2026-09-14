'use client';

import type { IcpListFilter, OverviewIcp } from '@/lib/icp-panel';
import { PRODUCTS } from '@/lib/icp';

/**
 * Filter bar for the /icp overview. Everything here is client-side over the
 * already-fetched list — search and owner narrow the row set, the rest
 * (product/state/toggles) just reflect what's on screen.
 */
export default function IcpFilterBar({ filter, icps, showOwner, shown, total, onChange }: {
  filter: IcpListFilter;
  icps: OverviewIcp[];
  /** Hide the owner select for a non-admin, where every row is already theirs. */
  showOwner: boolean;
  shown: number;
  total: number;
  onChange: (next: IcpListFilter) => void;
}) {
  const set = <K extends keyof IcpListFilter>(k: K, v: IcpListFilter[K]) => onChange({ ...filter, [k]: v });
  const sel: React.CSSProperties = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };

  const owners = Array.from(new Map(icps.map((i) => [i.owner_user_id, i.owner_name])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]));
  const products = Array.from(new Set(icps.map((i) => i.product).filter((p): p is string => Boolean(p))));

  const toggle = (label: string, k: 'pendingOnly' | 'noLinkedin') => (
    <button onClick={() => set(k, !filter[k])} className="px-2 py-1 rounded-lg text-[11px]"
            style={{ border: `1px solid ${filter[k] ? 'var(--accent)' : 'var(--border)'}`, color: filter[k] ? 'var(--accent)' : 'var(--text-muted)' }}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <input value={filter.q} onChange={(e) => set('q', e.target.value)} placeholder="Search ICP, owner, description…"
             className="px-2.5 py-1.5 rounded-lg text-xs w-64" style={sel} />
      {showOwner && (
        <select value={filter.owner} onChange={(e) => set('owner', e.target.value)} className="px-2 py-1.5 rounded-lg text-xs" style={sel}>
          <option value="all">Everyone</option>
          {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      )}
      <select value={filter.product} onChange={(e) => set('product', e.target.value)} className="px-2 py-1.5 rounded-lg text-xs" style={sel}>
        <option value="all">Any product</option>
        {products.map((p) => <option key={p} value={p}>{PRODUCTS.find((x) => x.key === p)?.label ?? p}</option>)}
      </select>
      <select value={filter.state} onChange={(e) => set('state', e.target.value as IcpListFilter['state'])} className="px-2 py-1.5 rounded-lg text-xs" style={sel}>
        <option value="all">Any state</option>
        <option value="running">Running</option>
        <option value="paused">Paused</option>
        <option value="held">Held for this person</option>
      </select>
      {toggle('pending approvals', 'pendingOnly')}
      {toggle('no LinkedIn', 'noLinkedin')}
      <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>{shown} of {total} ICPs</span>
    </div>
  );
}
