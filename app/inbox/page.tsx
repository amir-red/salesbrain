'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { relativeTime } from '@/lib/time';

interface Prospect {
  id: string;
  stage: string;
  reply_status: string | null;
  last_replied_at: string | null;
  company_name: string | null;
  full_name: string | null;
  title: string | null;
}

const REPLY_STATUS_COLORS: Record<string, string> = {
  interested: 'var(--green)',
  meeting_ready: 'var(--green)',
  not_now: 'var(--yellow)',
  objection: 'var(--orange)',
  wrong_person: 'var(--text-muted)',
  no_fit: 'var(--red)',
  unsubscribe: 'var(--red)',
};

export default function InboxPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReplied = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/prospects?stage=P6_REPLIED');
      if (res.ok) setProspects(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchReplied(); }, [fetchReplied]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Inbox</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{prospects.length} prospects with replies needing review</p>
        </div>

        <div className="p-4 space-y-2">
          {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>}
          {!loading && prospects.length === 0 && (
            <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
              <p>No replies yet</p>
              <p className="text-xs mt-1">When a prospect replies to outreach, they&apos;ll appear here.</p>
            </div>
          )}

          {prospects.map((p) => {
            const color = (p.reply_status && REPLY_STATUS_COLORS[p.reply_status]) || 'var(--text-muted)';
            return (
              <Link
                key={p.id}
                href={`/prospects/${p.id}`}
                className="block rounded-lg p-3"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: `3px solid ${color}` }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{p.full_name || '—'} · {p.company_name || '—'}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.title || '—'}</p>
                  </div>
                  <div className="text-right">
                    {p.reply_status && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${color}20`, color }}>
                        {p.reply_status.replace(/_/g, ' ')}
                      </span>
                    )}
                    {p.last_replied_at && (
                      <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{relativeTime(p.last_replied_at)}</p>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
