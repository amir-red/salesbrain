'use client';

import { ACTOR_STYLE, LIFECYCLE_BLOCKERS, LIFECYCLE_LABELS, type Lead } from '@/lib/sales-leads';

/**
 * The one line that answers "what is the system doing about this lead?": a stage chip, then one sentence. The colour
 * says who has to move (accent = the system, orange = you, teal = the contact, grey = nobody). Stored by the Lead
 * Conductor (core 068), not derived here.
 */
type Fields = Pick<Lead, 'lifecycle_stage' | 'lifecycle_actor' | 'lifecycle_step' | 'lifecycle_blocker' | 'lifecycle_paused'>;

export default function LifecycleLine({ lead, className = '' }: { lead: Fields; className?: string }) {
  if (!lead.lifecycle_stage) return null;                  // the conductor has not evaluated this lead yet
  const actor = lead.lifecycle_actor ?? 'none';
  const style = ACTOR_STYLE[actor];
  const you = actor === 'you';
  const blocker = lead.lifecycle_blocker ? LIFECYCLE_BLOCKERS[lead.lifecycle_blocker] ?? lead.lifecycle_blocker : null;
  return (
    <div className={`flex items-center gap-1.5 min-w-0 text-[11px] ${className}`} title={[style.label, lead.lifecycle_step, blocker].filter(Boolean).join(' · ')}>
      <span className="px-1.5 rounded-full whitespace-nowrap font-medium flex-shrink-0"
        style={{ background: `color-mix(in srgb, ${style.color} 14%, transparent)`, color: style.color }}>
        {you ? 'You · ' : ''}{LIFECYCLE_LABELS[lead.lifecycle_stage]}
      </span>
      <span className="truncate" style={{ color: you ? 'var(--text)' : 'var(--text-muted)', fontWeight: you ? 600 : 400 }}>{lead.lifecycle_step}</span>
      {blocker && (
        <span role="img" aria-label={`Blocked: ${blocker}`} className="flex-shrink-0 w-3.5 h-3.5 rounded-full text-[9px] font-bold inline-flex items-center justify-center"
          style={{ background: 'var(--orange)', color: 'var(--accent-fg)' }}>!</span>
      )}
    </div>
  );
}
