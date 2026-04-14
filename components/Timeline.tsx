'use client';

import { useState, useEffect } from 'react';
import { relativeTime } from '@/lib/time';

interface TimelineEvent {
  id: string;
  type: 'gate_change' | 'board_decision' | 'followup_sent' | 'conversation';
  timestamp: string;
  title: string;
  detail: string | null;
}

const TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  gate_change: { color: 'var(--accent)', label: 'Gate' },
  board_decision: { color: 'var(--orange)', label: 'Board' },
  followup_sent: { color: 'var(--green)', label: 'Followup' },
  conversation: { color: 'var(--text-muted)', label: 'Message' },
};

export default function Timeline({ dealId }: { dealId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/timeline`);
        if (res.ok && !cancelled) {
          setEvents(await res.json());
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  if (loading) {
    return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading timeline...</p>;
  }

  if (events.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No activity yet</p>;
  }

  return (
    <div className="space-y-0 max-h-64 overflow-y-auto pr-1">
      {events.map((event, i) => {
        const config = TYPE_CONFIG[event.type] || TYPE_CONFIG.conversation;
        const isLast = i === events.length - 1;

        return (
          <div key={event.id} className="flex gap-3 relative">
            {/* Dot + line */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                style={{ background: config.color }}
              />
              {!isLast && (
                <div className="w-px flex-1 min-h-[16px]" style={{ background: 'var(--border)' }} />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pb-3">
              <div className="flex items-center gap-2">
                <span
                  className="text-[9px] px-1 py-0.5 rounded"
                  style={{ background: `${config.color}20`, color: config.color }}
                >
                  {config.label}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {relativeTime(event.timestamp)}
                </span>
              </div>
              <p className="text-xs mt-0.5 truncate">{event.title}</p>
              {event.detail && (
                <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{event.detail}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
