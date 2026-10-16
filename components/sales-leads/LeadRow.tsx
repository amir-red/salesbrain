'use client';

import { contactAge, firstName, linkedInLabel, linkedInState, myRole, nextContactLabel, PRIORITY_LEVELS, priorityLevel, ROLES, STATUS_COLOR, tierLabel, type Lead } from '@/lib/sales-leads';
import { useEffect, useState } from 'react';
import { Chevron, LinkedIn, Star } from './icons';

/**
 * One aligned line per lead. Columns: rank · person · status · last / next
 * contact · who works it · controls. Everything else lives in LeadDetail.
 */
export const ROW_GRID = 'md:grid-cols-[2.5rem_minmax(0,1fr)_7.5rem_8.5rem_9.5rem_15.5rem]';

export default function LeadRow({ lead, rank, open, onToggle, onPatch, busy, viewerId = null }: {
  lead: Lead; rank: number; open: boolean; onToggle: () => void;
  onPatch: (patch: Record<string, unknown>) => void; busy: boolean; viewerId?: string | null;
}) {
  const mine = myRole(lead, viewerId);
  const li = linkedInState(lead);
  const liInfo = linkedInLabel(li, lead);
  const liColor = li === 'connected' ? 'var(--cat-blue)' : li === 'pending' || li === 'awaiting_approval' ? 'var(--yellow)' : 'var(--text-muted)';
  const age = contactAge(lead);
  const next = nextContactLabel(lead.next_contact_at);
  const prio = priorityLevel(lead.priority);
  const tier = tierLabel(lead.dossier?.tier);
  const ageColor = age.tone === 'alert' ? 'var(--red)' : age.tone === 'warn' ? 'var(--orange)' : age.tone === 'never' ? 'var(--text-muted)' : 'var(--text)';
  const company = lead.company && lead.company !== 'Unknown' ? lead.company : null;
  const sub = [lead.title, company].filter(Boolean).join(' · ');
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  // The order inside a priority is typed, not picked: commit on blur / Enter.
  const [rankText, setRankText] = useState(lead.rank == null ? '' : String(lead.rank));
  useEffect(() => { setRankText(lead.rank == null ? '' : String(lead.rank)); }, [lead.rank]);
  const commitRank = () => {
    const n = rankText.trim() === '' ? 0 : Math.max(0, Math.floor(Number(rankText)));
    if (Number.isNaN(n)) { setRankText(lead.rank == null ? '' : String(lead.rank)); return; }
    if ((n || null) !== lead.rank) onPatch({ rank: n });
  };

  return (
    <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] ${ROW_GRID} items-center gap-x-3 px-4 py-2.5 cursor-pointer outline-none focus-visible:ring-2`}
      style={{ opacity: busy ? 0.55 : 1, transition: 'background 150ms', background: open ? 'var(--accent-glow)' : undefined }}>

      {/* rank + priority mark */}
      <div className="flex items-center gap-2">
        <span className="w-1 self-stretch rounded-full" style={{ background: prio ? prio.color : 'transparent', minHeight: 28 }} />
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }} title={prio ? `priority ${prio.short}${lead.rank != null ? ` · order ${lead.rank}` : ''}` : 'no priority'}>{rank}</span>
      </div>

      {/* person */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{lead.full_name}</span>
          {lead.must_talk && <Star filled width={13} height={13} style={{ color: 'var(--orange)', flexShrink: 0 }} />}
          {lead.cards_pending > 0 && (
            <span className="text-[10px] px-1.5 rounded-full whitespace-nowrap" title="approval cards waiting on Telegram / /agents"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{lead.cards_pending} to approve</span>
          )}
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          {sub || <span style={{ opacity: 0.6 }}>no title on file</span>}
          {lead.met_at && <span> · met at {lead.met_at}</span>}
          {lead.icp_name && !lead.met_at && <span> · {lead.icp_name}</span>}
        </div>
        {lead.next_step && (
          <div className="text-[11px] truncate font-medium" style={{ color: 'var(--accent)' }} title={`Next step: ${lead.next_step}`}>→ {lead.next_step}</div>
        )}
      </div>

      {/* status + fit */}
      <div className="hidden md:block min-w-0">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize" style={{ color: STATUS_COLOR[lead.status] }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[lead.status] }} />{lead.status}
        </span>
        {tier && <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{tier}</div>}
      </div>

      {/* last / next contact */}
      <div className="hidden md:block min-w-0 leading-tight">
        <div className="text-sm font-semibold tabular-nums" style={{ color: ageColor }} title={lead.last_contact_at ? `last contact ${new Date(lead.last_contact_at).toLocaleDateString()}` : 'no contact on record'}>
          {age.short}
        </div>
        <div className="text-[11px] truncate" style={{ color: next?.overdue ? 'var(--red)' : next ? 'var(--cat-teal)' : 'var(--text-muted)' }}>
          {next ? next.label : age.tone === 'never' ? 'never talked' : 'since contact'}
        </div>
      </div>

      {/* who works it */}
      <div className="hidden md:block min-w-0 leading-tight" title={`${ROLES.responsible.label} (${ROLES.responsible.duties}): ${lead.responsible_name ?? '—'}\n${ROLES.front.label} (${ROLES.front.duties}): ${lead.front_name ?? 'same as back office'}`}>
        {lead.responsible_name || lead.front_name ? (<>
          <div className="text-xs truncate">
            {firstName(lead.responsible_name) || '—'}
            {lead.front_name && lead.front_name !== lead.responsible_name && <span style={{ color: 'var(--text-muted)' }}> → {firstName(lead.front_name)}</span>}
            {mine && <span className="ml-1.5 text-[10px] px-1.5 rounded-full align-middle" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>you · {ROLES[mine].short}</span>}
          </div>
          <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>back office{lead.front_name && lead.front_name !== lead.responsible_name ? ' → front' : ''}</div>
        </>) : <span className="text-xs" style={{ color: 'var(--orange)' }}>unassigned</span>}
      </div>

      {/* controls */}
      <div className="flex items-center justify-end gap-1" onClick={stop} onKeyDown={stop}>
        <span className="relative hidden md:inline-flex items-center" style={{ color: prio ? prio.color : 'var(--text-muted)' }}>
          <select value={lead.priority ?? 0} aria-label="Priority" onChange={(e) => onPatch({ priority: Number(e.target.value) })}
            className="text-xs font-medium rounded-full py-1 pl-2.5 pr-6 appearance-none cursor-pointer"
            style={prio
              ? { background: `color-mix(in srgb, ${prio.color} 12%, transparent)`, color: prio.color, border: '1px solid transparent' }
              : { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            <option value={0}>Priority</option>
            {PRIORITY_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <Chevron width={12} height={12} className="absolute right-2 pointer-events-none" style={{ transform: 'rotate(90deg)' }} />
        </span>
        <input type="number" min={0} inputMode="numeric" aria-label="Order inside the priority" title="Order inside the priority (1 = first). Leads with the same priority are worked in this order."
          value={rankText} placeholder="#" onChange={(e) => setRankText(e.target.value)} onBlur={commitRank}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
          className="hidden md:block w-12 text-xs tabular-nums rounded-full py-1 px-2 text-center"
          style={{ background: 'transparent', border: '1px solid var(--border)', color: lead.rank != null ? 'var(--text)' : 'var(--text-muted)' }} />
        <button type="button" aria-label={lead.must_talk ? 'Unstar' : 'Must talk'} title="Must talk"
          onClick={() => onPatch({ must_talk: !lead.must_talk })}
          className="w-8 h-8 rounded-full inline-flex items-center justify-center"
          style={{ color: lead.must_talk ? 'var(--orange)' : 'var(--text-muted)' }}>
          <Star filled={lead.must_talk} />
        </button>
        {lead.linkedin_url ? (
          <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" title={`Open LinkedIn · ${liInfo.label}`} aria-label={`LinkedIn: ${liInfo.label}`}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center" style={{ color: liColor }}><LinkedIn /></a>
        ) : <span className="w-8 h-8" />}
        <span className="w-6 h-8 inline-flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
          <Chevron style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }} />
        </span>
      </div>
    </div>
  );
}
