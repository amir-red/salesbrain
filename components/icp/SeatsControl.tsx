'use client';

/**
 * Who works a list (migration 085): back office, front office, and whose LinkedIn / mailbox sends.
 *
 * `variant="card"` (the list page, 2026-10-27: Amir — "add the ability to change the back / front office in the ICP"):
 * a visible card with each seat, what it does, and a Change form. `variant="inline"`: the one-line summary.
 * Every lead on the list inherits these seats; a seat set by hand on a lead wins. The list's owner or an admin can
 * change them (POST /api/icp/:id/seats); "also move open leads" moves the leads that still had the previous person.
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
  responsible: { label: 'Back office', hint: 'Drives the leads: research, drafts, follow-ups, the ping-by date.',
                 empty: 'List owner (default)' },
  front: { label: 'Front office', hint: 'The face of the deal: takes the calls, demos and meetings.',
           empty: 'Same as back office' },
  sender: { label: 'Sends from', hint: 'Whose LinkedIn and mailbox the requests and messages go out from.',
            empty: 'Back office’s own' },
} as const;
type Seat = keyof typeof SEAT_TEXT;
const SEATS = Object.keys(SEAT_TEXT) as Seat[];
const EFFECTIVE: Record<Seat, 'back_office' | 'front_office' | 'sender'> = {
  responsible: 'back_office', front: 'front_office', sender: 'sender',
};

const inputStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };

export default function SeatsControl({ icpId, onChanged, variant = 'inline' }: {
  icpId: string; onChanged?: (note: string) => void; variant?: 'inline' | 'card';
}) {
  const [seats, setSeats] = useState<Seats | null>(null);
  const [editing, setEditing] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [draft, setDraft] = useState<Record<Seat, string>>({ responsible: '', front: '', sender: '' });
  const [moveLeads, setMoveLeads] = useState(true);
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
    const body: Record<string, string | boolean> = {};
    SEATS.forEach((k) => { if ((seats[k]?.id ?? '') !== draft[k]) body[k] = draft[k]; });
    if (!Object.keys(body).length) { setEditing(false); return; }
    body.apply_to_leads = moveLeads;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/icp/${icpId}/seats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) { setError(out.error || `Not changed (${res.status})`); return; }
      setEditing(false); await load();
      const m = out.leads_moved ?? {};
      onChanged?.(moveLeads
        ? `Saved. Leads moved: ${m.responsible ?? 0} to the new back office, ${m.front ?? 0} to the new front office. Seats set by hand on a lead stayed.`
        : 'Saved. New leads on this list get these seats; existing leads keep theirs.');
    } catch { setError('Could not reach the server'); } finally { setBusy(false); }
  };

  const select = (k: Seat) => (
    <select value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      className="w-full px-2 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} aria-label={SEAT_TEXT[k].label}>
      <option value="">{SEAT_TEXT[k].empty}</option>
      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select>
  );

  if (variant === 'inline' && !editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {SEATS.map((k, i) => (
          <span key={k} title={SEAT_TEXT[k].hint}>
            {i > 0 && '· '}{SEAT_TEXT[k].label} <b style={{ color: 'var(--text)' }}>{seats.effective[EFFECTIVE[k]]?.name ?? '—'}</b>
          </span>
        ))}
        {seats.can_edit && <button onClick={start} className="underline">change</button>}
      </span>
    );
  }

  return (
    <section className="rounded-xl p-4 space-y-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">Who works this list</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Every lead on this list gets these people. A seat set by hand on a lead wins.
          </p>
        </div>
        {seats.can_edit && !editing && (
          <button onClick={start} className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>Change</button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {SEATS.map((k) => {
          const set = seats[k];
          const eff = seats.effective[EFFECTIVE[k]];
          return (
            <div key={k} className="rounded-lg p-3 space-y-1.5" style={{ background: 'var(--bg-input)' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{SEAT_TEXT[k].label}</div>
              {editing ? select(k) : (
                <div className="text-sm font-medium">
                  {eff?.name ?? '—'}
                  {!set && eff && <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}> · default</span>}
                </div>
              )}
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{SEAT_TEXT[k].hint}</div>
            </div>
          );
        })}
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="checkbox" checked={moveLeads} onChange={(e) => setMoveLeads(e.target.checked)} />
            Also move the open leads that still have the previous person
          </label>
          <div className="flex-1" />
          <button onClick={() => { setEditing(false); setError(null); }} disabled={busy} className="text-xs px-3 py-1.5">Cancel</button>
          <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
      {!seats.can_edit && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Only the list’s owner or an admin can change these.</p>
      )}
    </section>
  );
}
