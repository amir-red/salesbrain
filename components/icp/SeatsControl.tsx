'use client';

/**
 * "Back office Hannes · Front office Mateo · Sends from Matthias" on a list's page (migration 085).
 *
 * Every lead on the list inherits these seats; a seat set by hand on a lead wins. The list's owner or an admin can
 * change them (POST /api/icp/:id/seats); open leads that still had the previous person move with the change.
 */
import { useEffect, useState } from 'react';

interface Person { id: string; name: string }
interface Seats {
  responsible: Person | null; front: Person | null; sender: Person | null;
  effective: { back_office: Person | null; front_office: Person | null; sender: Person | null };
  can_edit: boolean;
}
interface User { id: string; name: string; email: string }

const SEAT_TEXT = {
  responsible: { label: 'Back office', hint: 'Drives the leads: research, drafts, follow-ups. Empty = the list owner.' },
  front: { label: 'Front office', hint: 'Takes the calls and meetings. Empty = same as back office.' },
  sender: { label: 'Sends from', hint: 'Whose LinkedIn and mailbox send. Empty = the back office’s own.' },
} as const;
type Seat = keyof typeof SEAT_TEXT;

const selectStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };

export default function SeatsControl({ icpId, onChanged }: { icpId: string; onChanged?: (note: string) => void }) {
  const [seats, setSeats] = useState<Seats | null>(null);
  const [editing, setEditing] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [draft, setDraft] = useState<Record<Seat, string>>({ responsible: '', front: '', sender: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetch(`/api/icp/${icpId}/seats`).then((r) => (r.ok ? r.json() : null)).then((s) => s && setSeats(s)).catch(() => {});
  useEffect(() => { void load(); }, [icpId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editing || users.length) return;
    fetch('/api/users').then((r) => (r.ok ? r.json() : [])).then((u) => setUsers((Array.isArray(u) ? u : [])
      .filter((x: User) => !x.email.endsWith('.service.salesbrain') && x.email !== 'agent@salesbrain.internal'))).catch(() => {});
  }, [editing, users.length]);

  if (!seats) return null;

  const start = () => {
    setDraft({ responsible: seats.responsible?.id ?? '', front: seats.front?.id ?? '', sender: seats.sender?.id ?? '' });
    setError(null); setEditing(true);
  };
  const save = async () => {
    const body: Record<string, string> = {};
    (Object.keys(SEAT_TEXT) as Seat[]).forEach((k) => {
      if ((seats[k]?.id ?? '') !== draft[k]) body[k] = draft[k];
    });
    if (!Object.keys(body).length) { setEditing(false); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/icp/${icpId}/seats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) { setError(out.error || `Not changed (${res.status})`); return; }
      setEditing(false); await load();
      const m = out.leads_moved ?? {};
      onChanged?.(`Seats saved. Leads moved: ${m.responsible ?? 0} back office, ${m.front ?? 0} front office. ${out.note ?? ''}`.trim());
    } catch { setError('Could not reach the server'); } finally { setBusy(false); }
  };

  if (!editing) {
    const show = (k: Seat, eff: Person | null) => {
      const set = seats[k];
      return (
        <span key={k} title={SEAT_TEXT[k].hint}>
          {SEAT_TEXT[k].label} <b style={{ color: 'var(--text)' }}>{eff?.name ?? '—'}</b>
          {!set && eff && <span> (default)</span>}
        </span>
      );
    };
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {show('responsible', seats.effective.back_office)} ·
        {show('front', seats.effective.front_office)} ·
        {show('sender', seats.effective.sender)}
        {seats.can_edit && <button onClick={start} className="underline">change</button>}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {(Object.keys(SEAT_TEXT) as Seat[]).map((k) => (
        <label key={k} className="inline-flex items-center gap-1" title={SEAT_TEXT[k].hint}>
          {SEAT_TEXT[k].label}
          <select value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            className="px-2 py-1 rounded-lg text-xs outline-none" style={selectStyle}>
            <option value="">{k === 'responsible' ? 'List owner (default)' : k === 'front' ? 'Same as back office' : 'Back office’s own'}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      ))}
      <button onClick={save} disabled={busy} className="px-2 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Saving…' : 'Save'}</button>
      <button onClick={() => setEditing(false)} className="text-xs">Cancel</button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}
