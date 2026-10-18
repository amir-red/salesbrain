'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lead } from '@/lib/sales-leads';

/**
 * The Enrich button's brain and its progress bar. Three steps, in this order (the email provider matches best with the
 * profile and the company domain): LinkedIn profile → website → email. Each step is ONE server call
 * (POST /api/sales-leads/:id/enrich), so the bar moves for real instead of spinning for a minute. Steps whose field is
 * already on the card are skipped without a call. Phone is deliberately not a step.
 */
export type StepKey = 'linkedin' | 'website' | 'email';
export const STEP_ORDER: { key: StepKey; label: string; field: 'linkedin_url' | 'website' | 'email' }[] = [
  { key: 'linkedin', label: 'LinkedIn profile', field: 'linkedin_url' },
  { key: 'website', label: 'Website', field: 'website' },
  { key: 'email', label: 'Email', field: 'email' },
];

export interface Candidate {
  name: string | null; headline: string | null; location: string | null;
  public_identifier: string | null; provider_id: string | null; likely?: boolean; possible?: boolean;
}
type Status = 'wait' | 'run' | 'done' | 'skip' | 'none' | 'warn' | 'fail' | 'pick';
export interface StepState { key: StepKey; label: string; status: Status; message?: string; candidates?: Candidate[] }

const FROM_API: Record<string, Status> = {
  found: 'done', already: 'skip', none: 'none', pick: 'pick', weak: 'warn', capped: 'warn', skipped: 'warn', duplicate: 'warn', error: 'fail',
};

async function callStep(leadId: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`/api/sales-leads/${leadId}/enrich`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { /* keep empty */ }
  return { ok: res.ok, status: res.status, data };
}

export function useEnrich(lead: Lead, onRefresh?: () => void) {
  const [steps, setSteps] = useState<StepState[] | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // A different lead opened in the same slot starts clean.
  useEffect(() => { setSteps(null); setFatal(null); setRunning(false); }, [lead.id]);

  const missing = STEP_ORDER.filter((s) => !(lead[s.field] || '').toString().trim());
  const patchStep = useCallback((key: StepKey, p: Partial<StepState>) => {
    if (alive.current) setSteps((cur) => (cur ? cur.map((s) => (s.key === key ? { ...s, ...p } : s)) : cur));
  }, []);

  /** One call, mapped onto the step row. Returns false when the whole run must stop (not allowed). */
  const runOne = useCallback(async (key: StepKey, extra: Record<string, unknown> = {}): Promise<boolean> => {
    patchStep(key, { status: 'run', message: undefined, candidates: undefined });
    const r = await callStep(lead.id, { step: extra.step ?? key, ...extra });
    if (!alive.current) return false;
    if (!r.ok) {
      const msg = String(r.data.error || 'Something went wrong');
      if (r.status === 403) { setFatal(msg); patchStep(key, { status: 'wait' }); return false; }
      patchStep(key, { status: 'fail', message: msg });
      return true;
    }
    const status = FROM_API[String(r.data.status)] ?? 'none';
    const filled = Object.keys((r.data.filled as Record<string, unknown>) || {});
    patchStep(key, {
      status, message: String(r.data.message || ''),
      candidates: status === 'pick' ? ((r.data.candidates as Candidate[]) || []) : undefined,
    });
    if (filled.length) onRefresh?.();
    return true;
  }, [lead.id, onRefresh, patchStep]);

  const start = useCallback(async () => {
    if (running) return;
    const init: StepState[] = STEP_ORDER.map((s) => ({
      key: s.key, label: s.label,
      status: (lead[s.field] || '').toString().trim() ? 'skip' : 'wait',
      message: (lead[s.field] || '').toString().trim() ? 'Already on the card' : undefined,
    }));
    setSteps(init); setFatal(null); setRunning(true);
    for (const s of init) {
      if (s.status === 'skip') continue;
      const goOn = await runOne(s.key);
      if (!goOn || !alive.current) break;
    }
    if (alive.current) { setRunning(false); onRefresh?.(); }
  }, [lead, onRefresh, running, runOne]);

  /** The person chose one of the LinkedIn candidates: save it, then retry the email with the profile known. */
  const pick = useCallback(async (c: Candidate) => {
    if (!c.public_identifier) return;
    setRunning(true);
    await runOne('linkedin', { step: 'pick', public_identifier: c.public_identifier, ...(c.provider_id ? { member_id: c.provider_id } : {}) });
    onRefresh?.();
    const emailStep = steps?.find((s) => s.key === 'email');
    if (alive.current && emailStep && emailStep.status !== 'done' && emailStep.status !== 'skip') await runOne('email');
    if (alive.current) { setRunning(false); onRefresh?.(); }
  }, [onRefresh, runOne, steps]);

  return { steps, running, fatal, missing, start, pick };
}

const TONE: Record<Status, string> = {
  wait: 'var(--text-muted)', run: 'var(--accent)', done: 'var(--green)', skip: 'var(--text-muted)',
  none: 'var(--text-muted)', warn: 'var(--yellow)', fail: 'var(--red)', pick: 'var(--accent)',
};

function Glyph({ status }: { status: Status }) {
  if (status === 'run') return <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" aria-label="working" />;
  const path = status === 'done' ? 'M5 12l4 4 10-10' : status === 'fail' ? 'M6 6l12 12M18 6L6 18' : status === 'pick' ? 'M12 8v5m0 3v.01' : status === 'warn' ? 'M12 7v6m0 4v.01' : 'M7 12h10';
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={path} /></svg>;
}

export function EnrichProgress({ steps, running, fatal, onPick }: {
  steps: StepState[]; running: boolean; fatal: string | null; onPick: (c: Candidate) => void;
}) {
  const finished = steps.filter((s) => s.status !== 'wait' && s.status !== 'run').length;
  const pct = Math.round(((finished + (steps.some((s) => s.status === 'run') ? 0.5 : 0)) / steps.length) * 100);
  return (
    <div className="mt-2 rounded-xl px-3 py-2.5 text-[11px]" style={{ background: 'var(--bg-input)' }} role="status" aria-live="polite">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-medium" style={{ color: 'var(--text)' }}>{running ? 'Enriching…' : fatal ? 'Could not start' : 'Done'}</span>
        <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{finished} of {steps.length}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
      </div>
      {fatal && <p className="mt-2" style={{ color: 'var(--red)' }}>{fatal}</p>}
      <ul className="mt-2 space-y-1.5">
        {steps.map((s) => (
          <li key={s.key}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0" style={{ color: TONE[s.status] }}><Glyph status={s.status} /></span>
              <span className="w-24 flex-shrink-0 font-medium" style={{ color: s.status === 'wait' ? 'var(--text-muted)' : 'var(--text)' }}>{s.label}</span>
              <span className="flex-1 min-w-0" style={{ color: s.status === 'fail' ? 'var(--red)' : 'var(--text-muted)' }}>
                {s.status === 'wait' ? 'waiting' : s.status === 'run' ? 'searching…' : s.message || (s.status === 'none' ? 'nothing found' : '')}
              </span>
            </div>
            {s.status === 'pick' && s.candidates && (
              <ul className="mt-1 ml-6 space-y-1">
                {s.candidates.map((c) => (
                  <li key={c.public_identifier ?? c.name} className="flex items-center gap-2 rounded-lg px-2 py-1" style={{ background: 'var(--bg-card)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="truncate"><span className="font-medium" style={{ color: 'var(--text)' }}>{c.name}</span>
                        {c.likely && <span className="ml-1.5" style={{ color: 'var(--green)' }}>likely</span>}
                        {!c.likely && c.possible && <span className="ml-1.5" style={{ color: 'var(--yellow)' }}>possible</span>}</div>
                      <div className="truncate" style={{ color: 'var(--text-muted)' }}>{[c.headline, c.location].filter(Boolean).join(' · ')}</div>
                    </div>
                    {c.public_identifier && <a href={`https://www.linkedin.com/in/${c.public_identifier}/`} target="_blank" rel="noopener noreferrer" className="underline flex-shrink-0" style={{ color: 'var(--text-muted)' }}>open</a>}
                    <button type="button" disabled={running} onClick={() => onPick(c)} className="px-2.5 py-0.5 rounded-full font-medium flex-shrink-0 disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Use this</button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {!running && <p className="mt-2" style={{ color: 'var(--text-muted)' }}>Only empty fields were filled; nothing you typed was changed. Phone is not searched.</p>}
    </div>
  );
}

