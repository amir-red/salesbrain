'use client';

import { JOURNEY } from '@/lib/prospects';
import type { JourneyKey, StepState } from '@/lib/prospects';

/** The lead's journey, one chip per step. Done = green, current = accent, todo = muted. */
export default function JourneyStepper({ state, onJump }: {
  state: Record<JourneyKey, StepState>; onJump?: (key: JourneyKey) => void;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {JOURNEY.map((s, i) => {
        const st = state[s.key];
        const color = st === 'done' ? 'var(--green)' : st === 'current' ? 'var(--accent)' : 'var(--text-muted)';
        return (
          <div key={s.key} className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onJump?.(s.key)}
              title={s.hint}
              className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px]"
              style={{ border: `1px solid ${st === 'todo' ? 'var(--border)' : color}`, color, background: st === 'current' ? 'var(--accent-glow)' : 'transparent' }}
            >
              <span className="inline-flex items-center justify-center rounded-full text-[9px] font-bold" style={{ width: 14, height: 14, background: st === 'todo' ? 'var(--border)' : color, color: '#0f172a' }}>
                {st === 'done' ? '✓' : i + 1}
              </span>
              {s.label}
            </button>
            {i < JOURNEY.length - 1 && <span style={{ color: 'var(--border)' }}>—</span>}
          </div>
        );
      })}
    </div>
  );
}
