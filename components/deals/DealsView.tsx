'use client';

/**
 * Deals — list and board in one page (app/page.tsx). Every choice lives in the URL (view, type, scope, status, flag,
 * q), so a view can be shared and the back button works. Defaults: List = my deals across all types; Pipeline (the board) =
 * everyone's sales deals. Rules for won / overdue / in delivery / vote open: lib/deals-view.ts.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import PriorityPicker from '@/components/PriorityPicker';
import PageHeader from '@/components/panel/PageHeader';
import Button from '@/components/panel/Button';
import { relativeTime } from '@/lib/time';
import {
  DEAL_TYPES, FLAGS, HEALTH_COLOR, STATUS_FILTERS, gateColor, gateName, gatesFor, inDelivery, deliveryStalled, hasClock, initials,
  isOverdue, matches, money, moneyByCurrency, slaDays, stateLabel, summarize, voteOpen,
  type DealItem, type DealType, type Flag, type Scope, type StatusFilter, type View,
} from '@/lib/deals-view';

const chip = (on: boolean, color = 'var(--accent)') => ({
  background: on ? color : 'var(--bg-input)',
  color: on ? 'var(--accent-fg)' : 'var(--text-muted)',
  border: `1px solid ${on ? color : 'var(--border)'}`,
});

export default function DealsView({ deals, userId }: { deals: DealItem[]; userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // ?view=pipeline (older links: ?view=board) = the board by gate; anything else = the list.
  const view: View = sp.get('view') === 'pipeline' || sp.get('view') === 'board' ? 'board' : 'list';
  const typeParam = sp.get('type') as DealType | 'all' | null;
  const type: DealType | 'all' = view === 'board'
    ? (typeParam && typeParam !== 'all' ? typeParam : 'sales')
    : (typeParam ?? 'all');
  const scope: Scope = (sp.get('scope') as Scope) || (view === 'board' ? 'everyone' : 'mine');
  const status: StatusFilter = (sp.get('status') as StatusFilter) || 'current';
  const flag: Flag = (sp.get('flag') as Flag) || '';
  const priority = sp.get('priority') || '';
  const q = sp.get('q') || '';
  const grantView = sp.get('grants') === 'gates' ? 'gates' : 'stages';

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k); else next.set(k, v);
    }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const [search, setSearch] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== q) set({ q: search.trim() || null }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const opts = { userId, scope, status, flag, q, type, priority };
  const shown = useMemo(() => deals.filter((d) => matches(d, opts)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, userId, scope, status, flag, q, type, priority]);
  // The summary follows type + scope only, so the numbers do not jump while you click through filters.
  const summary = useMemo(() => summarize(deals.filter((d) => matches(d, { ...opts, status: 'all', flag: '', q: '' }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, userId, scope, type]);
  const countFor = (t: DealType | 'all') =>
    deals.filter((d) => matches(d, { ...opts, type: t, flag: '', q: '' })).length;

  const [showNew, setShowNew] = useState(false);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <PageHeader
        title="Opportunities"
        subtitle={`${shown.length} shown · ${scope === 'mine' ? 'opportunities you created or lead' : 'everyone’s opportunities'}`}
        actions={
          <>
            <div className="flex rounded-lg overflow-hidden text-sm" style={{ border: '1px solid var(--border)' }} role="tablist" aria-label="View">
              {([['list', 'List', <IconList key="i" />], ['board', 'Pipeline', <IconBoard key="i" />]] as const).map(([v, label, icon]) => (
                <button key={v} role="tab" aria-selected={view === v}
                  onClick={() => set({ view: v === 'list' ? null : 'pipeline', type: null, scope: null, grants: null })}
                  className="px-3 py-1.5 font-medium flex items-center gap-1.5"
                  title={v === 'list' ? 'Opportunities as a list' : 'Opportunities on the pipeline board, by gate'}
                  style={{ background: view === v ? 'var(--accent)' : 'transparent', color: view === v ? 'var(--accent-fg)' : 'var(--text-muted)' }}>
                  {icon}{label}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => setShowNew((v) => !v)}>+ New opportunity</Button>
          </>
        }
      />
      {showNew && <NewDeal onClose={() => setShowNew(false)} />}

      {/* Controls */}
      <div className="px-4 py-3 border-b flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-1.5">
          {view === 'list' && (
            <button onClick={() => set({ type: null })} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={chip(type === 'all')}>
              All ({countFor('all')})
            </button>
          )}
          {DEAL_TYPES.map((t) => (
            <button key={t.key} onClick={() => set({ type: t.key })} className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={chip(type === t.key, t.color)}>
              {t.label} ({countFor(t.key)})
            </button>
          ))}
        </div>

        <div className="flex rounded-lg overflow-hidden text-xs ml-1" style={{ border: '1px solid var(--border)' }}>
          {(['mine', 'everyone'] as const).map((s) => (
            <button key={s} onClick={() => set({ scope: s })} className="px-3 py-1.5 font-medium"
              style={{ background: scope === s ? 'var(--bg-input)' : 'transparent', color: scope === s ? 'var(--text)' : 'var(--text-muted)' }}>
              {s === 'mine' ? 'Mine' : 'Everyone'}
            </button>
          ))}
        </div>

        <select value={status} onChange={(e) => set({ status: e.target.value === 'current' ? null : e.target.value })}
          className="px-2 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          {STATUS_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>

        <select value={priority} onChange={(e) => set({ priority: e.target.value || null })} aria-label="Priority"
          className="px-2 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          <option value="">Any priority</option><option value="top">P1–P3</option><option value="set">Priority set</option><option value="none">No priority</option>
          {[1,2,3,4,5,6,7,8,9,10].map((n) => <option key={n} value={String(n)}>P{n}</option>)}
        </select>

        {FLAGS.map((f) => (
          <button key={f.key} onClick={() => set({ flag: flag === f.key ? null : f.key })}
            className="px-2.5 py-1.5 rounded-lg text-xs" style={chip(flag === f.key)}>
            {f.label}
          </button>
        ))}

        {view === 'board' && type === 'grant' && (
          <div className="flex rounded-lg overflow-hidden text-xs" style={{ border: '1px solid var(--border)' }}>
            {(['stages', 'gates'] as const).map((v) => (
              <button key={v} onClick={() => set({ grants: v === 'stages' ? null : v })} className="px-3 py-1.5 font-medium capitalize"
                title={v === 'stages' ? 'Two stages: Securing / Disbursement, Delivery & Reporting' : 'All 10 grant gates'}
                style={{ background: grantView === v ? 'var(--bg-input)' : 'transparent', color: grantView === v ? 'var(--text)' : 'var(--text-muted)' }}>
                {v}
              </button>
            ))}
          </div>
        )}

        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search opportunity, company, person"
          className="ml-auto px-3 py-1.5 rounded-lg text-xs outline-none w-56"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
      </div>

      <SummaryStrip summary={summary} onFlag={(f) => set({ flag: f })} onStatus={(s) => set({ status: s })} />

      <div className="flex-1 overflow-auto p-4">
        {shown.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
            <p className="text-sm">No opportunities match.</p>
            {scope === 'mine' && (
              <button onClick={() => set({ scope: 'everyone' })} className="text-xs mt-2 underline">Show everyone’s opportunities</button>
            )}
          </div>
        ) : view === 'list' ? (
          <DealsTable deals={shown} />
        ) : (
          <Board deals={shown} type={type as DealType} grantView={grantView} />
        )}
      </div>
    </div>
  );
}

function IconList() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function IconBoard() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" />
    </svg>
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function SummaryStrip({ summary: s, onFlag, onStatus }: {
  summary: ReturnType<typeof summarize>; onFlag: (f: Flag) => void; onStatus: (s: StatusFilter) => void;
}) {
  const item = (label: string, value: string, onClick?: () => void, color?: string) => (
    <button onClick={onClick} disabled={!onClick} className="text-left px-3 py-1.5 rounded-lg disabled:cursor-default"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="block text-sm font-semibold" style={{ color: color ?? 'var(--text)' }}>{value}</span>
    </button>
  );
  return (
    <div className="px-4 py-2 border-b flex flex-wrap gap-2" style={{ borderColor: 'var(--border)' }}>
      {item('Open', `${s.open} · ${moneyByCurrency(s.inPlay)}`)}
      {item('Weighted by score', moneyByCurrency(s.weighted))}
      {item('Won', `${s.won} · ${moneyByCurrency(s.wonValue)}`, () => onStatus('won'), 'var(--green)')}
      {item('In delivery', String(s.delivery), () => onFlag('delivery'))}
      {item('Board votes open', String(s.votes), () => onFlag('vote'), s.votes ? 'var(--cat-violet)' : undefined)}
      {item('Overdue', String(s.overdue), () => onFlag('overdue'), s.overdue ? 'var(--red)' : undefined)}
      {item('Lost', String(s.lost), () => onStatus('lost'))}
      <Link href="/lessons" className="self-center text-xs ml-1" style={{ color: 'var(--text-muted)' }}>Lessons from lost opportunities →</Link>
    </div>
  );
}

// ─── List ────────────────────────────────────────────────────────────────────

function StateBadges({ d }: { d: DealItem }) {
  const st = stateLabel(d);
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
        style={{ background: `color-mix(in srgb, ${st.color} 14%, transparent)`, color: st.color }}>{st.label}</span>
      {voteOpen(d) && st.label !== 'Board vote open' && (
        <span className="text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{ background: 'color-mix(in srgb, var(--cat-violet) 14%, transparent)', color: 'var(--cat-violet)' }}>
          vote G{d.vote_gate}
        </span>
      )}
      {(inDelivery(d) || deliveryStalled(d)) && d.delivery_health && (
        <span title={`PMI health: ${d.delivery_health}${d.delivery_step ? ` · ${d.delivery_step}` : ''}`}
          className="inline-block w-2 h-2 rounded-full" style={{ background: HEALTH_COLOR[d.delivery_health] ?? 'var(--text-muted)' }} />
      )}
      {deliveryStalled(d) && <span className="text-[10px]" style={{ color: 'var(--yellow)' }}>delivery paused</span>}
    </span>
  );
}

function DealsTable({ deals }: { deals: DealItem[] }) {
  const router = useRouter();
  return (
    <div className="rounded-lg overflow-x-auto" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
            {['Prio', 'Opportunity', 'Stage', 'State', 'Value', 'Lead', 'In stage', 'Updated'].map((h) => (
              <th key={h} className="text-left p-2 font-medium text-xs">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => {
            const sla = slaDays(d);
            const overdue = isOverdue(d);
            const type = DEAL_TYPES.find((t) => t.key === d.deal_type);
            return (
              <tr key={d.id} onClick={() => router.push(`/deals/${d.id}`)} className="cursor-pointer hover:brightness-95"
                style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                <td className="p-2"><PriorityPicker value={d.priority} dealId={d.id} onChanged={() => router.refresh()} /></td>
                <td className="p-2">
                  <Link href={`/deals/${d.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{d.name}</Link>
                  <div className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    {d.deal_type !== 'sales' && <span style={{ color: type?.color }}>{type?.label.replace(/s$/, '')} ·</span>}
                    {d.company}
                  </div>
                </td>
                <td className="p-2 text-xs whitespace-nowrap">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: gateColor(d.deal_type, d.gate) }} />
                  G{d.gate} {gateName(d)}
                </td>
                <td className="p-2"><StateBadges d={d} /></td>
                <td className="p-2 text-xs whitespace-nowrap">{money(d.value, d.currency)}</td>
                <td className="p-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {d.lead_name || '—'}
                  {d.deal_type === 'sales' && d.rep_name && d.rep_name !== d.lead_name && (
                    <div className="text-[10px]">sales rep {d.rep_name}</div>
                  )}
                </td>
                <td className="p-2 text-xs whitespace-nowrap" style={{ color: overdue ? 'var(--red)' : 'var(--text-muted)' }}>
                  {hasClock(d) ? `${d.days_in_gate}d / ${sla}d` : '—'}
                </td>
                <td className="p-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{relativeTime(d.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Board ───────────────────────────────────────────────────────────────────

interface Column { key: string; title: string; color: string; info?: { name: string; description?: string; sla: number; board: boolean; required: string[] }; deals: DealItem[] }

function columns(deals: DealItem[], type: DealType, grantView: 'stages' | 'gates'): Column[] {
  if (type === 'grant' && grantView === 'stages') {
    return [
      { key: 'securing', title: 'Securing', color: '#6C477D', deals: deals.filter((d) => !d.contract_signed_at) },
      { key: 'delivering', title: 'Disbursement, Delivery & Reporting', color: '#166534', deals: deals.filter((d) => !!d.contract_signed_at) },
    ];
  }
  return gatesFor(type).map((g) => ({
    key: String(g.number),
    title: `G${g.number}: ${g.name}`,
    color: gateColor(type, g.number),
    info: { name: g.name, description: g.description, sla: g.slaDays, board: g.isBoard, required: g.requiredFields ?? [] },
    deals: deals.filter((d) => d.gate === g.number),
  }));
}

function Board({ deals, type, grantView }: { deals: DealItem[]; type: DealType; grantView: 'stages' | 'gates' }) {
  const cols = columns(deals, type, grantView);
  const wide = cols.length <= 2;
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 h-full">
      {cols.map((c) => (
        <div key={c.key} className={`flex-shrink-0 flex flex-col ${wide ? 'w-[26rem]' : 'w-60'}`}>
          <div className="rounded-t-lg px-3 py-2 flex items-center justify-between gap-1" style={{ background: c.color }}>
            <span className="text-xs font-medium text-white truncate flex-1" title={c.title}>{c.title}</span>
            {c.info && <GateInfo title={c.title} info={c.info} />}
            <span className="text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">{c.deals.length}</span>
          </div>
          <div className="flex-1 p-2 rounded-b-lg overflow-y-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderTop: 'none' }}>
            {c.deals.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>No opportunities</p>}
            {c.deals.map((d) => <DealCard key={d.id} d={d} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function DealCard({ d }: { d: DealItem }) {
  const overdue = isOverdue(d);
  const closed = d.status === 'lost' || d.status === 'cancelled';
  const sla = slaDays(d);
  const ratio = sla ? d.days_in_gate / sla : 0;
  const clock = ratio >= 1 ? 'var(--red)' : ratio >= 0.7 ? 'var(--yellow)' : 'var(--green)';
  const showClock = hasClock(d);
  return (
    <Link href={`/deals/${d.id}`} className="block rounded-lg p-3 mb-2"
      style={{
        background: closed ? 'color-mix(in srgb, var(--red) 5%, transparent)' : 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${overdue || d.status === 'lost' ? 'var(--red)' : voteOpen(d) ? 'var(--cat-violet)' : 'transparent'}`,
        opacity: closed ? 0.75 : 1,
      }}>
      <p className="text-sm font-medium truncate">{d.name}</p>
      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{d.company}</p>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.value ? money(d.value, d.currency) : ''}</span>
        {showClock ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${clock} 14%, transparent)`, color: clock }}>
            {d.days_in_gate}d / {sla}d
          </span>
        ) : null}
      </div>
      <div className="mt-1.5"><StateBadges d={d} /></div>
      {voteOpen(d) && (
        <p className="text-[10px] mt-1" style={{ color: 'var(--cat-violet)' }}>
          {d.vote_proceed} proceed · {d.vote_stop} stop{d.vote_required ? ` · ${d.vote_required} needed` : ''}
        </p>
      )}
      {d.lead_name && (
        <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex w-3.5 h-3.5 rounded-full items-center justify-center text-[7px] font-bold"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{initials(d.lead_name)}</span>
          {d.lead_name}
        </p>
      )}
    </Link>
  );
}

function GateInfo({ title, info }: { title: string; info: NonNullable<Column['info']> }) {
  return (
    <div className="relative group flex-shrink-0">
      <button type="button" aria-label={`What is ${title}?`}
        className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-white/20 hover:bg-white/40 cursor-help">i</button>
      <div role="tooltip"
        className="absolute right-0 top-full mt-2 w-72 z-30 rounded-lg p-3 text-left opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-opacity pointer-events-none shadow-lg"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text)' }}>
          {title} {info.board && <span style={{ color: 'var(--cat-violet)' }}>· board review</span>}
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{info.description || 'No description set for this gate.'}</p>
        <p className="text-[10px] mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          SLA {info.sla}d{info.required.length ? ` · required: ${info.required.join(', ').replace(/_/g, ' ')}` : ''}
        </p>
      </div>
    </div>
  );
}

// ─── New deal ────────────────────────────────────────────────────────────────

function NewDeal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [type, setType] = useState<DealType>('sales');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), company: company.trim(), deal_type: type }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not create the opportunity'); return; }
      router.push(`/deals/${body.id}?tab=chat`);
    } catch { setError('Could not reach the server'); } finally { setBusy(false); }
  };
  const label = type === 'grant' ? ['Opportunity name', 'Donor / funding body'] : type === 'ai_credit' ? ['Programme name', 'Provider'] : ['Opportunity name', 'Company'];
  return (
    <div className="px-4 py-3 border-b flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
      <div className="flex rounded-lg overflow-hidden text-xs" style={{ border: '1px solid var(--border)' }}>
        {DEAL_TYPES.map((t) => (
          <button key={t.key} onClick={() => setType(t.key)} className="px-3 py-1.5 font-medium"
            style={{ background: type === t.key ? t.color : 'transparent', color: type === t.key ? 'var(--accent-fg)' : 'var(--text-muted)' }}>
            {t.key === 'sales' ? 'Sales (Zeami)' : t.key === 'grant' ? 'Grant (ChipChip)' : 'AI credit'}
          </button>
        ))}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={label[0]} className="px-3 py-1.5 rounded-lg text-sm outline-none w-56"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={label[1]} className="px-3 py-1.5 rounded-lg text-sm outline-none w-56"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && company.trim()) create(); }} />
      <Button variant="success" onClick={create} disabled={busy || !name.trim() || !company.trim()}>{busy ? 'Creating…' : 'Create and open chat'}</Button>
      <Button onClick={onClose}>Cancel</Button>
      {error && <span className="text-xs" style={{ color: 'var(--red)' }}>{error}</span>}
    </div>
  );
}
