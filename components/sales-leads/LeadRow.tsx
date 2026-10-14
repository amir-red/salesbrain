'use client';

import { contactAge, initials, nextContactLabel, STATUS_COLOR, type Lead } from '@/lib/sales-leads';

/**
 * One line per lead (Mateo's Napa CRM row): rank · status dot · name, title at
 * company · badges (P1, ★, ticker, ping-by, owner, ICP, cards) · inline
 * priority + star + LinkedIn · chevron. Everything else lives in LeadDetail.
 */
export default function LeadRow({ lead, rank, open, onToggle, onPatch, busy }: {
  lead: Lead; rank: number; open: boolean; onToggle: () => void;
  onPatch: (patch: Record<string, unknown>) => void; busy: boolean;
}) {
  const age = contactAge(lead);
  const next = nextContactLabel(lead.next_contact_at);
  const ageColor = age.tone === 'alert' ? 'var(--red)' : age.tone === 'warn' ? 'var(--orange)' : age.tone === 'never' ? 'var(--text-muted)' : 'var(--green)';
  const tier = lead.dossier?.tier;
  const badge = (text: string, color: string, title?: string) => (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap" title={title}
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>{text}</span>
  );

  return (
    <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={onToggle}
      style={{ opacity: busy ? 0.6 : 1 }}>
      <span className="w-7 text-right text-xs font-bold tabular-nums flex-shrink-0" style={{ color: 'var(--accent)' }}>{rank}.</span>
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[lead.status] }} title={lead.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold truncate max-w-[22ch]">{lead.full_name}</span>
          {lead.priority ? badge(`P${lead.priority}`, 'var(--accent)', 'priority') : null}
          {lead.must_talk ? badge('★ must talk', 'var(--orange)') : null}
          {tier ? badge(tier, tier === 'High' ? 'var(--green)' : tier === 'Medium' ? 'var(--yellow)' : 'var(--text-muted)', 'fit tier') : null}
          {lead.status !== 'new' && badge(lead.status, STATUS_COLOR[lead.status])}
          {badge(age.label, ageColor, lead.last_contact_at ? `last contact ${new Date(lead.last_contact_at).toLocaleDateString()}` : 'no contact event on record')}
          {next ? badge(next.label, next.overdue ? 'var(--red)' : 'var(--cat-teal)', `next contact ${lead.next_contact_at}`) : null}
          {lead.cards_pending > 0 ? badge(`${lead.cards_pending} card${lead.cards_pending > 1 ? 's' : ''} awaiting 👍`, 'var(--cat-violet)', 'approval cards on Telegram / /agents') : null}
          {lead.icp_name ? badge(lead.icp_name, 'var(--cat-blue)', 'ICP list') : null}
          {lead.met_at ? badge(`met: ${lead.met_at}`, 'var(--cat-pink)') : null}
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          {lead.title ? `${lead.title} · ` : ''}{lead.company}
          {lead.last_event && lead.status !== 'new' ? <span> · <span style={{ color: 'var(--text)' }}>{lead.last_event.text}</span></span> : null}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {(lead.responsible_name || lead.front_name) && (
          <span className="text-[10px] font-bold px-1.5 py-1 rounded-full" title={`back office: ${lead.responsible_name ?? '—'} · front office: ${lead.front_name ?? '—'}`}
            style={{ background: 'var(--bg-input)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            {initials(lead.responsible_name)}{lead.front_name && lead.front_name !== lead.responsible_name ? `/${initials(lead.front_name)}` : ''}
          </span>
        )}
        <input type="number" inputMode="numeric" min={1} max={10} placeholder="#" defaultValue={lead.priority ?? ''}
          key={`${lead.id}-${lead.priority ?? 0}`}
          title="Priority 1–10 (1 = top; empty clears)"
          className="w-11 text-center text-xs rounded py-1"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
          onBlur={(e) => { const n = parseInt(e.target.value, 10); const p = isNaN(n) ? 0 : Math.min(10, Math.max(0, n)); if (p !== (lead.priority ?? 0)) onPatch({ priority: p }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <button type="button" title="Must talk" onClick={() => onPatch({ must_talk: !lead.must_talk })}
          className="text-xs px-2 py-1 rounded font-semibold"
          style={lead.must_talk
            ? { background: 'var(--orange)', color: 'var(--accent-fg)' }
            : { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {lead.must_talk ? '★' : '☆'}
        </button>
        {lead.linkedin_url && (
          <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" title="LinkedIn"
            className="text-xs px-2 py-1 rounded font-semibold"
            style={{ background: 'color-mix(in srgb, var(--cat-blue) 12%, transparent)', color: 'var(--cat-blue)' }}>in</a>
        )}
        <span className="text-xs w-4 text-center" style={{ color: 'var(--text-muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} onClick={onToggle}>▶</span>
      </div>
    </div>
  );
}
