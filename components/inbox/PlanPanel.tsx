'use client';

import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/panel/Button';
import type { ConversationPlan, InboxThread, PlanPayload, PlanSummary } from '@/lib/inbox';

/**
 * "No reply needed" on a conversation (core 103): follow up on dates with a reason, or leave it with a reason.
 * The suggestion comes from their last message and from what this person usually decides; the choice is theirs.
 * Nothing is sent from here — a due step becomes a follow-up card (LinkedIn) or a note to the owner (email / chat).
 */

type StepDraft = { days: number; purpose: string };

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function inDays(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function planLine(p: PlanSummary | ConversationPlan | null | undefined): string | null {
  if (!p) return null;
  if (p.decision === 'leave') return 'Left as is';
  return p.next_due_at ? `Follow-up ${fmtDay(p.next_due_at)}` : 'Follow-ups done';
}

export default function PlanPanel({ thread, onClose, onSaved }: {
  thread: InboxThread;
  onClose: () => void;
  /** the new thread state + plan summary (null after a cancel) */
  onSaved: (state: InboxThread['state'], plan: PlanSummary | null) => void;
}) {
  const [data, setData] = useState<PlanPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<'follow_up' | 'leave'>('follow_up');
  const [reasonKind, setReasonKind] = useState<string>('');
  const [reason, setReason] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [editing, setEditing] = useState(false);   // a plan exists and the person wants to change it

  useEffect(() => {
    let alive = true;
    setData(null); setErr(null); setEditing(false);
    fetch(`/api/inbox/${thread.channel}/${thread.id}/plan`).then(async (r) => {
      const d = await r.json();
      if (!alive) return;
      if (!r.ok || d.error) { setErr(d.error || 'Could not load'); return; }
      const p = d as PlanPayload;
      setData(p);
      // the form starts on the suggestion
      const s = p.suggestion;
      const dec: 'follow_up' | 'leave' = s.decision === 'leave' ? 'leave' : 'follow_up';
      setDecision(dec);
      setReasonKind(s.reason_kind || (dec === 'leave' ? 'closed' : 'they_will_get_back'));
      setSteps(s.steps.length ? s.steps.map((x) => ({ days: x.days, purpose: x.purpose })) : [{ days: s.days || 10, purpose: '' }]);
      setReason('');
    }).catch((e) => alive && setErr(e instanceof Error ? e.message : 'Could not load'));
    return () => { alive = false; };
  }, [thread.channel, thread.id]);

  const reasons = data?.reasons ?? [];
  const maxSteps = data?.max_steps ?? 3;
  const s = data?.suggestion;
  const habit = data?.habit;
  const habitLine = useMemo(() => {
    if (!habit || !habit.n || habit.n < 3) return null;
    const bits: string[] = [];
    if (habit.median_days) bits.push(`you usually wait ${Math.round(habit.median_days)} days`);
    if (habit.leave && habit.follow_up) bits.push(`${habit.follow_up}× followed up, ${habit.leave}× left it`);
    return bits.length ? `Your habit here: ${bits.join(' · ')}.` : null;
  }, [habit]);

  function pickReason(key: string) {
    setReasonKind(key);
    const r = reasons.find((x) => x.key === key);
    if (r && !r.follow_up) setDecision('leave');
    else if (r && r.follow_up && decision === 'leave') setDecision('follow_up');
  }

  async function save() {
    if (!reasonKind) { setErr('Pick a reason first.'); return; }
    setBusy(true); setErr(null);
    try {
      const body = {
        decision, reason_kind: reasonKind, reason: reason.trim() || null,
        steps: decision === 'follow_up' ? steps.filter((x) => x.days > 0).map((x) => ({ days: x.days, purpose: x.purpose.trim() || undefined })) : [],
        suggested: s ? { decision: s.decision, reason_kind: s.reason_kind, days: s.days, steps: s.steps } : undefined,
      };
      const r = await fetch(`/api/inbox/${thread.channel}/${thread.id}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Not saved');
      const plan = d.plan as ConversationPlan;
      onSaved(d.thread_state, { id: plan.id, decision: plan.decision, reason_kind: plan.reason_kind, next_due_at: plan.next_due_at,
        steps_left: plan.steps.filter((x) => x.status === 'pending').length });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Not saved');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(planId: string) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/inbox/${thread.channel}/${thread.id}/plan`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_id: planId }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Not dropped');
      onSaved(thread.last_from_them ? 'needs_reply' : 'waiting', null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Not dropped');
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = { border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 12 };
  const chip = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent-glow)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-muted)',
    border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
  });

  return (
    <div className="mx-4 mb-3 p-3 text-sm" style={box} role="region" aria-label="No reply needed">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold">No reply needed?</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Say what should happen instead. The system learns when you answer, when you follow up and when you leave it.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs px-2 py-1 rounded-lg" style={{ border: '1px solid var(--border)' }}>Close</button>
      </div>

      {err && <p className="mt-2 text-xs p-2 rounded-lg" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>{err}</p>}
      {!data && !err && <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>Reading the conversation…</p>}

      {data?.plan && !editing && (
        <div className="mt-3">
          <p className="text-xs font-medium">{planLine(data.plan)} · {data.plan.reason_label}{data.plan.reason ? ` — ${data.plan.reason}` : ''}</p>
          {data.plan.decision === 'follow_up' && (
            <ol className="mt-1.5 space-y-1">
              {data.plan.steps.map((st) => (
                <li key={st.n} className="text-xs flex gap-2">
                  <span className="tabular-nums flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{fmtDay(st.due_at)}</span>
                  <span className="flex-1">{st.purpose}</span>
                  <span className="flex-shrink-0" style={{ color: st.status === 'pending' ? 'var(--text-muted)' : st.status === 'sent' ? 'var(--green)' : 'var(--orange)' }}>
                    {st.status === 'pending' ? '' : st.status === 'filed' ? 'card filed' : st.status === 'notified' ? 'you were told' : st.status}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
            {data.plan.decision === 'follow_up'
              ? 'When a step is due, a follow-up draft is filed in this conversation for your tap (LinkedIn) or you get a note (email, chats). A message from them ends the plan.'
              : 'The conversation sits under Done. A message from them brings it back.'}
          </p>
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={() => setEditing(true)} disabled={busy}>Change</Button>
            <Button size="sm" onClick={() => cancel(data.plan!.id)} disabled={busy}>{busy ? '…' : 'Drop the plan'}</Button>
          </div>
        </div>
      )}

      {data && (!data.plan || editing) && s && (
        <div className="mt-3 space-y-3">
          <div className="text-xs p-2 rounded-lg" style={{ background: 'var(--bg-input)' }}>
            <span className="font-medium">Suggested: </span>
            {s.decision === 'answer' ? 'answer them' : s.decision === 'leave' ? 'leave it' : `no reply now, follow up in ${s.days} days${s.steps.length > 1 ? ` and again in ${s.steps[1].days}` : ''}`}
            <span style={{ color: 'var(--text-muted)' }}> — {s.why}</span>
            {s.signal?.quote && <p className="mt-1 italic" style={{ color: 'var(--text-muted)' }}>“{s.signal.quote}”</p>}
            {habitLine && <p className="mt-1" style={{ color: 'var(--text-muted)' }}>{habitLine}</p>}
          </div>

          <div className="flex gap-1.5" role="group" aria-label="What instead">
            <button type="button" onClick={() => setDecision('follow_up')} aria-pressed={decision === 'follow_up'} className="h-8 px-3 rounded-lg text-xs font-medium" style={chip(decision === 'follow_up')}>Follow up later</button>
            <button type="button" onClick={() => setDecision('leave')} aria-pressed={decision === 'leave'} className="h-8 px-3 rounded-lg text-xs font-medium" style={chip(decision === 'leave')}>Leave it</button>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Why</p>
            <div className="flex flex-wrap gap-1.5">
              {reasons.filter((r) => decision === 'follow_up' ? r.follow_up || r.key === 'other' : !r.follow_up || r.key === 'other').map((r) => (
                <button key={r.key} type="button" onClick={() => pickReason(r.key)} aria-pressed={reasonKind === r.key}
                  className="px-2.5 py-1 rounded-lg text-xs" style={chip(reasonKind === r.key)}>{r.label}</button>
              ))}
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="In your words (optional) — this is what the system learns from"
              className="z-input mt-2" maxLength={500} aria-label="Reason in your words" />
          </div>

          {decision === 'follow_up' && (
            <div>
              <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Follow-ups</p>
              <div className="space-y-1.5">
                {steps.map((st, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <label className="flex items-center gap-1 text-xs flex-shrink-0">
                      in
                      <input type="number" min={1} max={365} value={st.days}
                        onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, days: Math.max(1, Math.min(365, Number(e.target.value) || 1)) } : x)))}
                        className="z-input w-16 text-center" aria-label={`Step ${i + 1}: in how many days`} />
                      days
                      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>· {inDays(st.days)}</span>
                    </label>
                    <input value={st.purpose} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, purpose: e.target.value } : x)))}
                      placeholder="What this follow-up is for (the draft is written from this)" className="z-input flex-1 min-w-0" maxLength={200}
                      aria-label={`Step ${i + 1}: purpose`} />
                    {steps.length > 1 && (
                      <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="text-xs px-1.5 py-1" style={{ color: 'var(--text-muted)' }} aria-label="Remove this step">×</button>
                    )}
                  </div>
                ))}
              </div>
              {steps.length < maxSteps && (
                <button type="button" className="text-xs mt-1.5" style={{ color: 'var(--accent)' }}
                  onClick={() => setSteps([...steps, { days: (steps[steps.length - 1]?.days || 10) + 10, purpose: '' }])}>+ another follow-up</button>
              )}
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Due steps are drafted in your voice from the purpose and filed for your tap — nothing goes out on its own.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={save} disabled={busy || !reasonKind}>{busy ? 'Saving…' : decision === 'follow_up' ? 'Set the follow-ups' : 'Leave it'}</Button>
            {editing && <Button size="sm" onClick={() => setEditing(false)} disabled={busy}>Back</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
