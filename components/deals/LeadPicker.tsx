'use client';

/**
 * Project lead of a deal: shows the lead and lets someone who may change it pick another teammate or remove the lead
 * (PUT /api/deals/:id/lead — admin, creator or current lead; recorded in deal_lead_history). Moved here from the old
 * home page's DealPanel when Deals and Pipeline were merged (2026-10-24).
 */
import { useState, useEffect, useCallback } from 'react';

interface User { id: string; name: string; email: string }
export interface LeadDeal { id: string; lead_id: string | null; lead_name: string | null; lead_email: string | null }

export default function LeadPicker({ deal, onUpdate }: { deal: LeadDeal; onUpdate?: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) setUsers(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open && users.length === 0) fetchUsers();
  }, [open, users.length, fetchUsers]);

  const assignLead = async (userId: string | null) => {
    setSaving(true);
    try {
      await fetch(`/api/deals/${deal.id}/lead`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: userId }),
      });
      onUpdate?.();
    } catch { /* ignore */ }
    finally { setSaving(false); setOpen(false); }
  };

  const initials = deal.lead_name
    ? deal.lead_name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Project Lead
      </h3>

      {deal.lead_name ? (
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{deal.lead_name}</p>
            {deal.lead_email && (
              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{deal.lead_email}</p>
            )}
          </div>
          <button
            onClick={() => setOpen(!open)}
            className="px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          >
            Change
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="w-full py-2 rounded-lg text-xs transition-colors"
          style={{ border: '1px dashed var(--border)', color: 'var(--text-muted)' }}
        >
          + Assign project lead
        </button>
      )}

      {open && (
        <div
          className="rounded-lg overflow-hidden"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
        >
          {users.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Loading...</p>
          )}
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => assignLead(u.id)}
              disabled={saving}
              className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors"
              style={{
                borderBottom: '1px solid var(--border)',
                background: u.id === deal.lead_id ? 'var(--accent-glow)' : 'transparent',
              }}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                {u.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div>
                <span>{u.name}</span>
                <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{u.email}</span>
              </div>
            </button>
          ))}
          {deal.lead_id && (
            <button
              onClick={() => assignLead(null)}
              disabled={saving}
              className="w-full px-3 py-2 text-left text-xs"
              style={{ color: 'var(--red)' }}
            >
              Remove lead
            </button>
          )}
        </div>
      )}
    </div>
  );
}
