'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Button from '@/components/panel/Button';
import PageHeader from '@/components/panel/PageHeader';
import { timeUntil } from '@/lib/time';

/**
 * /campaigns/cards/[id] — one campaign card: every draft one step produced for one sender today, exactly as it will
 * go out. Edit or drop any of them while the card waits; Approve all / Skip belongs to the SENDER (it goes out from
 * their account). Linked from the Telegram card's "Review / edit" button.
 */
interface Draft {
  id: string; status: string; channel: string; kind: string; subject: string | null; message: string | null;
  check_flags: { check: string; detail: string }[] | null; edited_at: string | null; full_name: string;
  title: string | null; company: string | null; company_conflict: unknown;
}
interface Card {
  id: string; campaign_id: string; campaign_name: string; step_label: string; step_type: string; kind: string;
  status: string; sender_name: string; day: string; expires_at: string; waiting: number; drafts: Draft[];
  can_decide: boolean; result: { sent?: number; failed?: number; errors?: string[] } | null;
}
const DRAFT: Record<string, { label: string; color: string }> = {
  pending: { label: 'waiting', color: 'var(--orange)' }, approved: { label: 'approved', color: 'var(--blue)' },
  sent: { label: 'sent', color: 'var(--green)' }, failed: { label: 'not sent', color: 'var(--red)' },
  rejected: { label: 'dropped', color: 'var(--text-muted)' }, expired: { label: 'not sent (skipped)', color: 'var(--text-muted)' },
};
const CARD: Record<string, string> = {
  pending: 'Waiting for your decision', approved: 'Approved — going out within the hour', sending: 'Sending…',
  done: 'Done', skipped: 'Skipped — drafted again tomorrow', expired: 'Expired — drafted again',
};

export default function CampaignCardPage() {
  const { id } = useParams<{ id: string }>();
  const [k, setK] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/cards/${id}`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) { setError(out.error || 'Could not load the card.'); return; }
    setK(out); setEdits({});
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const post = async (key: string, url: string, body: unknown) => {
    setBusy(key); setError(null); setNote(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'That did not work.');
      if (out.note) setNote(String(out.note));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not work.'); }
    finally { setBusy(null); }
  };

  const pending = k?.drafts.filter((d) => d.status === 'pending') ?? [];
  const where = k?.kind === 'email' ? 'from your Gmail, a few every 10 minutes' : 'from your LinkedIn within the hour, one every 8–16 seconds';
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10" style={{ background: 'var(--bg)' }}>
          <PageHeader back={k ? { href: `/campaigns/${k.campaign_id}`, label: 'Open the campaign' } : undefined}
            title={k ? <>{k.step_label} · {k.campaign_name}</> : 'Campaign card'}
            subtitle={k ? <>For {k.sender_name} · {k.day} · {CARD[k.status] ?? k.status}{k.status === 'pending' ? ` · expires ${timeUntil(k.expires_at)}` : ''}</> : null}
            actions={k?.can_decide && k.status === 'pending' && pending.length > 0 ? <>
              <Button disabled={busy !== null} onClick={() => post('skip', `/api/campaigns/cards/${id}`, { decision: 'skip' })}>Skip</Button>
              <Button variant="primary" disabled={busy !== null || Object.keys(edits).length > 0}
                title={Object.keys(edits).length ? 'Save or undo your edits first' : undefined}
                onClick={() => { if (confirm(`Approve ${pending.length}? They go out ${where}.`)) void post('approve', `/api/campaigns/cards/${id}`, { decision: 'approve' }); }}>
                {busy === 'approve' ? 'Approving…' : `Approve all ${pending.length}`}
              </Button>
            </> : null} />
        </div>
        <div className="p-4 grid gap-3 max-w-4xl">
          {error && <div className="rounded-lg px-3 py-2 text-sm" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>}
          {note && <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)', color: 'var(--green)' }}>{note}</div>}
          {k && k.status === 'pending' && !k.can_decide && (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Only {k.sender_name} can approve this card — it goes out from their account.</div>
          )}
          {k?.result && (k.result.sent != null) && (
            <div className="text-sm">Sent {k.result.sent}{k.result.failed ? `, not sent ${k.result.failed}` : ''}.
              {(k.result.errors ?? []).length > 0 && <ul className="text-xs list-disc pl-5 mt-1" style={{ color: 'var(--red)' }}>{k.result.errors!.map((e) => <li key={e}>{e}</li>)}</ul>}
            </div>
          )}
          {k && k.drafts.length === 0 && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No drafts on this card.</div>}
          {k?.drafts.map((d) => {
            const st = DRAFT[d.status] ?? { label: d.status, color: 'var(--text-muted)' };
            const editable = d.status === 'pending' && k.status === 'pending';
            const val = edits[d.id];
            return (
              <div key={d.id} className="rounded-xl p-4 grid gap-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', opacity: d.status === 'rejected' ? 0.55 : 1 }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm"><b>{d.full_name}</b>
                    <span style={{ color: 'var(--text-muted)' }}>{[d.title, d.company].filter(Boolean).map((x) => ` · ${x}`).join('')}</span></div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    {d.edited_at && <span style={{ color: 'var(--text-muted)' }}>edited</span>}
                    <span style={{ color: st.color }}>{st.label}</span>
                    {d.status === 'pending' && k.status === 'pending' && (
                      <button type="button" className="underline" style={{ color: 'var(--text-muted)' }} disabled={busy !== null}
                        onClick={() => { if (confirm(`Take ${d.full_name} off the card? They leave the campaign.`)) void post(d.id, `/api/campaigns/cards/${id}`, { drop: d.id }); }}>drop</button>
                    )}
                  </div>
                </div>
                {d.subject && <div className="text-sm"><span style={{ color: 'var(--text-muted)' }}>Subject:</span> {d.subject}</div>}
                {d.kind === 'connect' && !d.message ? (
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Connection request without a note.</div>
                ) : editable && d.message != null ? (
                  <>
                    <textarea aria-label={`Message to ${d.full_name}`} className="z-input text-sm font-[inherit]" rows={Math.min(14, Math.max(4, (val ?? d.message).split('\n').length + 1))}
                      value={val ?? d.message} onChange={(e) => setEdits((m) => ({ ...m, [d.id]: e.target.value }))} />
                    {val != null && val !== d.message && (
                      <div className="flex gap-2 justify-end">
                        <button type="button" className="text-xs px-3 py-1 rounded-lg" style={{ border: '1px solid var(--border)' }}
                          onClick={() => setEdits((m) => { const n = { ...m }; delete n[d.id]; return n; })}>Undo</button>
                        <button type="button" className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }} disabled={busy !== null}
                          onClick={() => post(d.id, `/api/drafts/${d.id}`, { action: 'edit', text: val })}>{busy === d.id ? 'Saving…' : 'Save'}</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm whitespace-pre-wrap">{d.message}</div>
                )}
                {(d.check_flags ?? []).length > 0 && (
                  <div className="text-xs" style={{ color: 'var(--orange)' }}>⚠️ {(d.check_flags ?? []).map((f) => f.detail).join(' · ')}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
