'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { relativeTime } from '@/lib/time';

interface Message {
  id: string;
  prospect_id: string;
  direction: string;
  status: string;
  subject: string | null;
  body: string;
  to_email: string | null;
  created_at: string;
  ai_generated: boolean;
  company_name: string | null;
  contact_name: string | null;
  prospect_stage: string;
}

export default function ApprovalsPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/outreach?status=draft');
      if (res.ok) setMessages(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  const approve = async (id: string) => {
    await fetch(`/api/outreach/${id}/approve`, { method: 'POST' });
    fetchDrafts();
  };

  const approveAndSend = async (id: string) => {
    await fetch(`/api/outreach/${id}/approve`, { method: 'POST' });
    await fetch(`/api/outreach/${id}/send`, { method: 'POST' });
    fetchDrafts();
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Approvals</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{messages.length} draft outreach messages awaiting review</p>
        </div>

        <div className="p-4 space-y-3">
          {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>}
          {!loading && messages.length === 0 && (
            <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
              <p>No drafts awaiting approval</p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Link href={`/prospects/${m.prospect_id}`} className="text-sm font-medium hover:underline">
                    {m.contact_name || '—'} · {m.company_name || '—'}
                  </Link>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {m.prospect_stage} · {m.to_email || 'no email'} · {relativeTime(m.created_at)}
                  </p>
                </div>
                {m.ai_generated && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>AI</span>
                )}
              </div>
              {m.subject && <p className="text-sm font-medium mb-1">Subject: {m.subject}</p>}
              <pre className="text-xs whitespace-pre-wrap p-2 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{m.body}</pre>
              <div className="flex gap-2 mt-3">
                <button onClick={() => approve(m.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>Approve</button>
                <button onClick={() => approveAndSend(m.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--green)', color: '#fff' }}>Approve & Send</button>
                <Link href={`/prospects/${m.prospect_id}`} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>View Prospect</Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
