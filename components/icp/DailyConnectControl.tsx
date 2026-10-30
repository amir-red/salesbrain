'use client';

/**
 * The daily LinkedIn connector for one list (migration 094; Mateo, 2026-10-29: "every single day my agent connects
 * 15 or 25 times with our target market, mostly where there is already a connection").
 *
 * Three modes: off (queue by hand), card (one approval card a day, one tap sends them paced), auto (sent without a
 * tap, the sender gets the summary). The Lead Conductor fills the sender's batch after 09:00: the person's own
 * priority first, then people with a shared connection, one per company, within the rolling caps. Every request is
 * still its own approval row and goes through the send gate. Owner or admin may change it (POST
 * /api/icp/:id/daily-connect); everyone sees the state.
 */
import { useState } from 'react';

export type DailyConnectMode = 'off' | 'card' | 'auto';

export const DAILY_CONNECT_TEXT: Record<DailyConnectMode, { label: string; short: string; hint: string }> = {
  off: { label: 'Off', short: 'off', hint: 'People on this list are queued by hand (Queue next N).' },
  card: { label: 'Ask me each day', short: 'one card a day',
          hint: 'Every day the list fills one approval card for the sender; one tap sends them, one every 8–16 s.' },
  auto: { label: 'Send automatically', short: 'automatic',
          hint: 'Every day the batch goes out without a tap, within the caps; the sender gets the summary.' },
};

interface Result {
  daily_connect?: DailyConnectMode; was?: DailyConnectMode; note?: string; notes?: string[]; connectable?: number;
  sender?: { name: string; linkedin: boolean; telegram: boolean } | null; error?: string;
}

export default function DailyConnectControl({ icpId, mode, canEdit, senderName, variant = 'card', onChanged }: {
  icpId: string; mode: DailyConnectMode; canEdit: boolean; senderName?: string | null;
  variant?: 'card' | 'inline'; onChanged?: (note: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<DailyConnectMode | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (next: DailyConnectMode) => {
    setBusy(true); setError(null); setConfirm(null);
    try {
      const r = await fetch(`/api/icp/${icpId}/daily-connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }) });
      const d = await r.json() as Result;
      if (!r.ok) { setError(d.error || 'Could not change it'); return; }
      setRes(d);
      onChanged?.(`Daily connector: ${DAILY_CONNECT_TEXT[next].label.toLowerCase()}${d.sender ? ` · sends from ${d.sender.name}` : ''}`);
    } catch { setError('Could not change it'); }
    finally { setBusy(false); }
  };
  const pick = (next: DailyConnectMode) => {
    if (next === mode) return;
    if (next === 'auto') { setConfirm('auto'); return; }
    void apply(next);
  };

  const notes = res?.notes ?? [];
  const select = (
    <select value={mode} disabled={!canEdit || busy} onChange={(e) => pick(e.target.value as DailyConnectMode)}
      className="rounded-lg px-2 py-1 text-xs disabled:opacity-60"
      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
      title={canEdit ? DAILY_CONNECT_TEXT[mode].hint : 'Only the list’s owner or an admin can change this'}>
      {(Object.keys(DAILY_CONNECT_TEXT) as DailyConnectMode[]).map((m) => <option key={m} value={m}>{DAILY_CONNECT_TEXT[m].label}</option>)}
    </select>
  );
  const confirmBox = confirm === 'auto' && (
    <div className="rounded-lg px-3 py-2 text-xs space-y-2" style={{ border: '1px solid var(--orange)', background: 'color-mix(in srgb, var(--orange) 10%, transparent)' }}>
      <p>From tomorrow 09:00 the batch is <b>sent from {senderName ?? 'the sender'}’s LinkedIn every day without a tap</b> — the day’s room under the cap, people with a shared connection first, one per company. Switch it off here any time.</p>
      <div className="flex gap-2">
        <button onClick={() => void apply('auto')} disabled={busy} className="px-3 py-1 rounded-lg text-xs font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Yes, send automatically</button>
        <button onClick={() => setConfirm(null)} className="px-3 py-1 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}>Cancel</button>
      </div>
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span style={{ color: 'var(--text)' }}>Daily requests</span>
          {select}
        </div>
        {confirmBox}
        {error && <p className="text-[11px]" style={{ color: 'var(--red)' }}>{error}</p>}
        {notes.map((n) => <p key={n} className="text-[11px]" style={{ color: 'var(--orange)' }}>{n}</p>)}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Daily LinkedIn requests</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {DAILY_CONNECT_TEXT[mode].hint}{senderName ? ` Sends from ${senderName}’s account.` : ''}
          </div>
        </div>
        {select}
      </div>
      {confirmBox}
      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
      {res && !error && (
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {res.note}{typeof res.connectable === 'number' ? ` ${res.connectable.toLocaleString()} people on the list could be asked.` : ''}
        </p>
      )}
      {notes.map((n) => <p key={n} className="text-[11px]" style={{ color: 'var(--orange)' }}>{n}</p>)}
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Order: a person’s own priority, then people who share a connection with the sender (mutual connections, 2nd degree), one per company before a second. Caps by subscription, rolling 24 h / 7 days; every request is its own approval and goes through the send gate.
      </p>
    </div>
  );
}
