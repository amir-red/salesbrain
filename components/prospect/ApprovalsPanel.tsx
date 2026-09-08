'use client';

import { useState } from 'react';
import { relativeTime } from '@/lib/time';

export interface LeadApproval {
  id: string; status: string; kind?: string | null; channel: string; subject: string | null; message: string;
  rationale: string | null; created_at: string; decided_at?: string | null; sent_at?: string | null; expires_at: string;
  person_name: string | null; intro_lead_name?: string | null; owner_name?: string | null;
}

/**
 * Drafts filed for this lead — cold first messages to the lead, and intro asks
 * to a connector on the lead's behalf. Same 👍/👎 as /agents and the Telegram
 * card; approve = send now through the policy gate.
 */
export default function ApprovalsPanel({ approvals, onChanged }: { approvals: LeadApproval[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id); setNote(null);
    try {
      const res = await fetch('/api/agents/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval_id: id, decision }) });
      const out = await res.json();
      if (!res.ok || out.error) setNote(out.error || 'Failed');
      else if (decision === 'approve') setNote(out.sent ? 'Sent.' : `Not sent: ${out.note || out.status || 'see /agents'}`);
      else setNote('Skipped.');
      onChanged();
    } finally { setBusy(null); }
  };

  const pending = approvals.filter((a) => a.status === 'pending');
  const past = approvals.filter((a) => a.status !== 'pending');
  const statusColor = (s: string) => s === 'sent' ? 'var(--green)' : s === 'failed' || s === 'rejected' || s === 'expired' ? 'var(--red)' : 'var(--text-muted)';

  return (
    <div className="space-y-2">
      {note && <div className="text-xs" style={{ color: note.startsWith('Not sent') || note === 'Failed' ? 'var(--red)' : 'var(--text-muted)' }}>{note}</div>}
      {approvals.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No drafts yet. Find a route and ask for an intro, or send cold.</p>}
      {pending.map((ap) => (
        <div key={ap.id} className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              {ap.kind === 'intro_request'
                ? <div className="text-[10px] mb-0.5 inline-block px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>🤝 Intro ask → to {ap.person_name || 'connector'}</div>
                : <div className="text-[10px] mb-0.5 inline-block px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}>✉️ Cold message</div>}
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>via {ap.channel} · expires {relativeTime(ap.expires_at)}{ap.owner_name ? ` · for ${ap.owner_name}` : ''}</div>
              {ap.rationale && <div className="text-[11px] mt-1 italic" style={{ color: 'var(--text-muted)' }}>{ap.rationale}</div>}
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => decide(ap.id, 'reject')} disabled={busy === ap.id} className="px-2.5 py-1 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>👎 Skip</button>
              <button onClick={() => decide(ap.id, 'approve')} disabled={busy === ap.id} className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--green)', color: '#fff' }}>{busy === ap.id ? 'Working…' : '👍 Send'}</button>
            </div>
          </div>
          {ap.subject && <div className="text-xs"><b>Subject:</b> {ap.subject}</div>}
          <pre className="text-xs whitespace-pre-wrap rounded-lg p-2" style={{ background: 'var(--bg-card)', color: 'var(--text)', fontFamily: 'inherit' }}>{ap.message}</pre>
        </div>
      ))}
      {past.length > 0 && (
        <div className="space-y-1 pt-1">
          {past.map((ap) => (
            <div key={ap.id} className="text-[11px] flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
              <span style={{ color: statusColor(ap.status) }}>{ap.status}</span>
              <span>{ap.kind === 'intro_request' ? `intro ask to ${ap.person_name || '?'}` : 'cold message'} · {ap.channel}</span>
              <span>· {relativeTime(ap.sent_at || ap.decided_at || ap.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
