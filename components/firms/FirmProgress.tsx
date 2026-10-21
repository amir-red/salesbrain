'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ProgressBar from '@/components/panel/ProgressBar';
import { usePoll } from '@/lib/use-poll';
import { relativeTime } from '@/lib/time';
import type { FirmProgressPayload } from '@/lib/firms';

/**
 * What an automatic firm list is doing (core 078): how far research and people-finding have got, the batch running now
 * and its firms, when the next batch starts, the last batches, and anything holding it up. Polls a light endpoint every
 * 30 s (paused while the tab is hidden) and tells the parent when something moved so the table reloads.
 */
function minutesUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function duration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function FirmProgress({ icpId, onMoved }: { icpId: string; onMoved: () => void }) {
  const [p, setP] = useState<FirmProgressPayload | null>(null);
  const [, setTick] = useState(0);
  const last = useRef<string>('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/icp/${icpId}/firms/progress`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw new Error(out.error || 'Could not load the progress.');
    setP(out);
    const sig = `${out.counts?.researched}|${out.counts?.go_with_people}|${out.counts?.people}|${out.running ? 1 : 0}`;
    if (last.current && last.current !== sig) onMoved();
    last.current = sig;
  }, [icpId, onMoved]);
  usePoll(load, 30_000);
  // the "next batch in N min" countdown moves between polls
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 20_000); return () => clearInterval(t); }, []);

  if (!p || !p.counts.total) return null;
  const c = p.counts;
  const next = minutesUntil(p.next_batch_at);
  const state = !p.auto.on ? { label: 'Automatic is off', color: 'var(--text-muted)' }
    : p.auto.working ? { label: p.running ? 'Automatic · working now' : 'Automatic · on', color: 'var(--green)' }
    : { label: 'Automatic · waiting', color: 'var(--orange)' };
  const muted = { color: 'var(--text-muted)' };

  return (
    <div className="rounded-xl p-4 mb-3 grid gap-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span aria-hidden className={p.running ? 'animate-pulse' : ''} style={{ width: 8, height: 8, borderRadius: 999, background: state.color, display: 'inline-block' }} />
          <span style={{ color: state.color }}>{state.label}</span>
        </div>
        {p.auto.working && (
          <div className="text-xs" style={muted}>
            {p.running ? `batch started ${relativeTime(p.running.started_at)}` : next !== null ? (next === 0 ? 'next batch any moment' : `next batch in ${next} min`) : ''}
            {p.eta_minutes ? ` · about ${duration(p.eta_minutes)} of research left (runs 07:00–22:45)` : c.to_research === 0 ? ' · every firm is researched' : ''}
          </div>
        )}
      </div>

      {p.blockers.map((b, i) => <div key={i} className="text-xs rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--orange) 12%, transparent)', color: 'var(--text)' }}>{b}</div>)}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <div className="flex justify-between text-xs"><span className="font-medium">Researched</span><span style={muted}>{c.researched} / {c.total}{c.failed ? ` · ${c.failed} could not be read` : ''}</span></div>
          <ProgressBar used={c.researched} cap={c.total} compact />
          <div className="flex gap-3 text-[11px]" style={muted}>
            <span style={{ color: 'var(--green)' }}>Go {c.go}</span><span style={{ color: 'var(--orange)' }}>Check {c.later}</span>
            <span style={{ color: 'var(--red)' }}>Out {c.out}</span><span>Not yet {c.to_research}</span>
          </div>
        </div>
        <div className="grid gap-1">
          <div className="flex justify-between text-xs"><span className="font-medium">People found at Go firms</span><span style={muted}>{c.go_with_people} / {c.go}{c.go_nobody_found ? ` · ${c.go_nobody_found} with nobody found` : ''}</span></div>
          <ProgressBar used={c.go_with_people} cap={Math.max(c.go, 1)} compact />
          <div className="flex gap-3 text-[11px]" style={muted}>
            <span>{c.people} people</span><span>{c.with_email} with email</span><span>{c.with_linkedin} with LinkedIn</span>
            {c.to_find_people ? <span>{c.to_find_people} firm(s) waiting</span> : null}
          </div>
        </div>
      </div>

      {p.running && (
        <div className="text-xs">
          <span className="font-medium">Now: </span>
          <span style={muted}>researching {p.running.firms.length} firm(s) — {p.running.firms.slice(0, 6).join(', ')}{p.running.firms.length > 6 ? ', …' : ''}</span>
        </div>
      )}
      {p.notes.map((n, i) => <div key={i} className="text-[11px]" style={muted}>{n}</div>)}

      {!!p.runs.length && (
        <div className="grid gap-0.5">
          <div className="z-eyebrow">Last batches</div>
          {p.runs.slice(0, 5).map((r, i) => (
            <div key={i} className="text-xs flex gap-2">
              <span className="tabular-nums shrink-0" style={muted}>{clock(r.started_at)}</span>
              <span style={{ color: r.status === 'error' ? 'var(--red)' : 'var(--text)' }}>{r.summary || r.error || r.status}</span>
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px]" style={muted}>Nothing is sent to anyone without an approved email wave.</div>
    </div>
  );
}
