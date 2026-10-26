'use client';

/**
 * "Owner: Hannes · Change owner" on a list's page. Anyone sees who owns a list; its owner or an admin can hand it to
 * another teammate (POST /api/icp/:id/owner). The leads the old owner holds on the list move with it.
 */
import { useEffect, useState } from 'react';

interface User { id: string; name: string; email: string }

export default function OwnerControl({ icpId, ownerId, ownerName, isOwner, canEdit, onChanged }: {
  icpId: string; ownerId: string; ownerName: string; isOwner: boolean; canEdit: boolean;
  onChanged: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || users.length) return;
    fetch('/api/users').then((r) => (r.ok ? r.json() : [])).then((u) => setUsers(Array.isArray(u) ? u : [])).catch(() => {});
  }, [open, users.length]);

  const save = async () => {
    if (!pick) return;
    const who = users.find((u) => u.id === pick)?.name ?? 'them';
    if (!window.confirm(`Give this list to ${who}?\n\nThe leads ${isOwner ? 'you hold' : `${ownerName} holds`} on it move to ${who} too, `
      + `also the ones already in a conversation. From then on its searches run on ${who}'s LinkedIn and its approval cards go to ${who}.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/icp/${icpId}/owner`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_user_id: pick }) });
      const out = await res.json();
      if (!res.ok) { setError(out.error || `Not changed (${res.status})`); return; }
      setOpen(false); setPick('');
      onChanged(out.unchanged ? out.note
        : `${out.name} now belongs to ${out.to?.name}: ${out.leads_moved} lead${out.leads_moved === 1 ? '' : 's'} moved.${out.note ? ` ${out.note}` : ''}`);
    } catch { setError('Could not reach the server'); } finally { setBusy(false); }
  };

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span>Owner <b style={{ color: 'var(--text)' }}>{isOwner ? 'you' : ownerName}</b></span>
      {canEdit && !open && (
        <button onClick={() => setOpen(true)} className="underline">change owner</button>
      )}
      {open && (
        <>
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="">Choose a teammate…</option>
            {users.filter((u) => u.id !== ownerId && !u.email.endsWith('.service.salesbrain') && u.email !== 'agent@salesbrain.internal').map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
          </select>
          <button onClick={save} disabled={!pick || busy} className="px-2 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Moving…' : 'Give the list'}</button>
          <button onClick={() => { setOpen(false); setError(null); }} className="text-xs">Cancel</button>
        </>
      )}
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}
