'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import { dueLabel, formatDate } from '@/lib/time';

interface Followup {
  id: string;
  deal_id: string;
  deal_name: string;
  gate: number;
  type: string;
  subject: string | null;
  body: string;
  to_email: string | null;
  due_at: string;
  sent: boolean;
  sent_at: string | null;
}

interface Deal {
  id: string;
  name: string;
}

type Tab = 'pending' | 'sent';

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    email: 'var(--accent)',
    reminder: 'var(--yellow)',
    sla_alert: 'var(--red)',
  };
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: `${colors[type] || 'var(--text-muted)'}20`, color: colors[type] || 'var(--text-muted)' }}
    >
      {type}
    </span>
  );
}

export default function FollowupsPage() {
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tab, setTab] = useState<Tab>('pending');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  // New followup form state
  const [formDealId, setFormDealId] = useState('');
  const [formType, setFormType] = useState('email');
  const [formSubject, setFormSubject] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formDueAt, setFormDueAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchFollowups = useCallback(async () => {
    try {
      const res = await fetch('/api/followups');
      if (res.ok) setFollowups(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch('/api/deals');
      if (res.ok) setDeals(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchFollowups();
    fetchDeals();
  }, [fetchFollowups, fetchDeals]);

  const pending = followups.filter((f) => !f.sent);
  const sent = followups.filter((f) => f.sent);
  const displayed = tab === 'pending' ? pending : sent;

  // Group pending by due label
  const grouped = new Map<string, Followup[]>();
  if (tab === 'pending') {
    for (const f of displayed) {
      const label = dueLabel(f.due_at);
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label)!.push(f);
    }
  }

  const handleSend = async (id: string) => {
    await fetch(`/api/followups/${id}/send`, { method: 'POST' });
    fetchFollowups();
  };

  const handleDismiss = async (id: string) => {
    // Mark as sent to dismiss
    await fetch(`/api/followups/${id}/send`, { method: 'POST' });
    fetchFollowups();
  };

  const handleCreate = async () => {
    if (!formDealId || !formBody || !formDueAt) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id: formDealId,
          type: formType,
          subject: formSubject || undefined,
          body: formBody,
          to_email: formEmail || undefined,
          due_at: new Date(formDueAt).toISOString(),
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setFormDealId(''); setFormType('email'); setFormSubject('');
        setFormBody(''); setFormEmail(''); setFormDueAt('');
        fetchFollowups();
      }
    } finally { setSubmitting(false); }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Followups</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {pending.length} pending, {sent.length} sent
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            + New followup
          </button>
        </div>

        {/* Inline form */}
        {showForm && (
          <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <div className="grid grid-cols-3 gap-3">
              <select
                value={formDealId}
                onChange={(e) => setFormDealId(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                <option value="">Select deal</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                <option value="email">Email</option>
                <option value="reminder">Reminder</option>
              </select>
              <input
                type="datetime-local"
                value={formDueAt}
                onChange={(e) => setFormDueAt(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
            </div>
            <input
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              placeholder="To email (for email type)"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <input
              value={formSubject}
              onChange={(e) => setFormSubject(e.target.value)}
              placeholder="Subject"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <textarea
              value={formBody}
              onChange={(e) => setFormBody(e.target.value)}
              placeholder="Message body"
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={submitting || !formDealId || !formBody || !formDueAt}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--green)', color: '#fff', opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {(['pending', 'sent'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-3 text-sm font-medium capitalize"
              style={{
                color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {t} ({t === 'pending' ? pending.length : sent.length})
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4">
          {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>}

          {!loading && displayed.length === 0 && (
            <div className="text-center py-12">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" className="mx-auto mb-3">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              <p style={{ color: 'var(--text-muted)' }}>
                {tab === 'pending' ? 'No pending followups' : 'No sent followups yet'}
              </p>
            </div>
          )}

          {tab === 'pending' ? (
            Array.from(grouped.entries()).map(([label, items]) => (
              <div key={label} className="mb-6">
                <h3 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  {label}
                </h3>
                {items.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between p-3 rounded-lg mb-2"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">{f.deal_name}</span>
                        <TypeBadge type={f.type} />
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>G{f.gate}</span>
                      </div>
                      {f.subject && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{f.subject}</p>}
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {f.to_email && `To: ${f.to_email} · `}{formatDate(f.due_at)}
                      </p>
                    </div>
                    <div className="flex gap-2 ml-3">
                      <button
                        onClick={() => handleSend(f.id)}
                        className="px-2 py-1 rounded text-xs font-medium"
                        style={{ background: 'var(--accent)', color: '#fff' }}
                      >
                        Send now
                      </button>
                      <button
                        onClick={() => handleDismiss(f.id)}
                        className="px-2 py-1 rounded text-xs"
                        style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          ) : (
            sent.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between p-3 rounded-lg mb-2"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{f.deal_name}</span>
                    <TypeBadge type={f.type} />
                  </div>
                  {f.subject && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{f.subject}</p>}
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Sent {f.sent_at ? formatDate(f.sent_at) : 'Unknown'}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
