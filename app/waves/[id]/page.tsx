'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { relativeTime } from '@/lib/time';

/**
 * /waves/[id] — review an email wave before it goes out: every draft exactly as it will be sent, editable while the
 * wave waits; Approve all / Skip for the SENDER (their mailbox). Afterwards: what was sent, what waits, what failed.
 */
interface Draft { id: string; status: string; subject: string; message: string; sent_at: string | null; full_name: string;
  title: string | null; email: string; firm: string; prospect_id: string; rationale?: string }
interface WaveData {
  wave: { id: string; step: number; size: number; status: string; sender_address: string; sender_name: string; list_name: string;
    icp_profile_id: string; created_at: string; expires_at: string | null };
  drafts: Draft[]; counts: Record<string, number>; can_decide: boolean; can_edit: boolean;
}
const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'waiting', color: 'var(--orange)' }, approved: { label: 'approved · in the outbox', color: 'var(--blue)' },
  sent: { label: 'sent', color: 'var(--green)' }, failed: { label: 'not sent', color: 'var(--red)' },
  rejected: { label: 'dropped', color: 'var(--text-muted)' }, expired: { label: 'expired', color: 'var(--text-muted)' },
};

export default function WavePage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<WaveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject: string; message: string }>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/waves/${id}`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) { setError(out.error || 'Could not load the wave.'); return; }
    setD(out); setEdits({});
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const save = async (draft: Draft, body: Record<string, unknown>) => {
    setBusy(draft.id); setError(null);
    try {
      const res = await fetch(`/api/waves/drafts/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not save.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    finally { setBusy(null); }
  };
  const decide = async (decision: 'approve' | 'skip') => {
    if (decision === 'approve' && !confirm(`Approve ${d?.counts.pending ?? 0} email(s)? They go out from ${d?.wave.sender_address} a few every 10 minutes, within your daily cap.`)) return;
    setBusy('decide'); setError(null);
    try {
      const res = await fetch(`/api/waves/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not decide.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not decide.'); }
    finally { setBusy(null); }
  };

  const w = d?.wave;
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-start justify-between gap-4 sticky top-0 z-10" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
          <div className="min-w-0">
            <h1 className="text-lg font-bold">
              {w ? <>{w.step === 0 ? 'First emails' : `Follow-up ${w.step}`} · {w.list_name}</> : 'Email wave'}
            </h1>
            {w && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              From {w.sender_name} · {w.sender_address} · filed {relativeTime(w.created_at)} ·{' '}
              {Object.entries(d!.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${STATUS[k]?.label ?? k}`).join(' · ')} ·{' '}
              <Link href={`/icp/${w.icp_profile_id}#firms`} className="underline">back to the list</Link>
            </p>}
          </div>
          {d?.can_decide && (
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => decide('skip')} disabled={busy !== null} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>Skip</button>
              <button type="button" onClick={() => decide('approve')} disabled={busy !== null} className="z-btn text-sm">{busy === 'decide' ? 'Approving…' : `Approve all ${d.counts.pending}`}</button>
            </div>
          )}
        </div>
        {error && <div className="m-4 rounded-lg px-3 py-2 text-sm" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>}
        {d && w?.status === 'pending' && !d.can_decide && (
          <div className="mx-4 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>Only {w.sender_name} can approve this wave — it goes out from their mailbox. You can still edit or drop drafts.</div>
        )}
        <div className="p-4 grid gap-3">
          {d?.drafts.map((x) => {
            const e = edits[x.id];
            const st = STATUS[x.status] ?? { label: x.status, color: 'var(--text-muted)' };
            const editable = d.can_edit && x.status === 'pending';
            return (
              <div key={x.id} className="z-card p-4 grid gap-2" style={{ background: 'var(--bg-card)', opacity: x.status === 'rejected' ? 0.55 : 1 }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm">
                    <b>{x.full_name}</b>{x.title ? <span style={{ color: 'var(--text-muted)' }}> · {x.title}</span> : null}
                    <span style={{ color: 'var(--text-muted)' }}> · {x.firm} · {x.email}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span style={{ color: st.color }}>{st.label}{x.sent_at ? ` ${relativeTime(x.sent_at)}` : ''}</span>
                    {editable && <button type="button" onClick={() => save(x, { remove: true })} disabled={busy !== null} className="underline" style={{ color: 'var(--text-muted)' }}>drop</button>}
                  </div>
                </div>
                {editable ? (
                  <>
                    <input id={`subj-${x.id}`} aria-label="Subject" className="z-input text-sm" value={e?.subject ?? x.subject}
                      onChange={(ev) => setEdits((m) => ({ ...m, [x.id]: { subject: ev.target.value, message: m[x.id]?.message ?? x.message } }))} />
                    <textarea id={`msg-${x.id}`} aria-label="Email" rows={Math.min(16, Math.max(6, x.message.split('\n').length + 1))} className="z-input text-sm font-[inherit]" value={e?.message ?? x.message}
                      onChange={(ev) => setEdits((m) => ({ ...m, [x.id]: { subject: m[x.id]?.subject ?? x.subject, message: ev.target.value } }))} />
                    {e && (e.subject !== x.subject || e.message !== x.message) && (
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setEdits((m) => { const n = { ...m }; delete n[x.id]; return n; })} className="text-xs px-3 py-1 rounded-lg" style={{ border: '1px solid var(--border)' }}>Undo</button>
                        <button type="button" onClick={() => save(x, { subject: e.subject, message: e.message })} disabled={busy !== null} className="z-btn text-xs">{busy === x.id ? 'Saving…' : 'Save'}</button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium">{x.subject}</div>
                    <pre className="text-sm whitespace-pre-wrap" style={{ fontFamily: 'inherit', color: 'var(--text)' }}>{x.message}</pre>
                  </>
                )}
              </div>
            );
          })}
          {d && !d.drafts.length && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No drafts in this wave.</p>}
        </div>
      </div>
    </div>
  );
}
