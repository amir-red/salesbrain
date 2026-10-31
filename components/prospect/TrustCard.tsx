'use client';

/**
 * "Who they are to us" on the person page (095): the trust score's four parts, the path, value to us, the research
 * facts with their sources, the ✓ / ↓ history, and "Research now" (POST /api/prospects/[id]/trust-research: one
 * person through the same pass the nightly agent runs, as the list's sender for an admin).
 */
import { useCallback, useEffect, useState } from 'react';
import { PART_LABELS, TRUST_KIND_LABELS, VALUE_LABELS, partFractions, trustBand, BAND_COLOR, type TrustPart } from '@/lib/trust';
import { relativeTime } from '@/lib/time';

interface Research {
  role_confirmed?: boolean | null; authority_override?: string | null; tenure_months?: number | null;
  prior_roles?: string[]; background?: string; mandate?: string; posts_topics?: string[]; signals?: string[];
  connector?: boolean | null; value_note?: string; sources?: { url: string; title?: string }[];
}
interface Detail {
  error?: string; total: number; band: string; parts: Record<TrustPart, number>; weights: Record<TrustPart, number>;
  why: string; held: number; path: { kind: string; via: string | null; hops: number | null; own_tie: string | null; connected: boolean; mutual: number; routes: { via: string; connector_band: string | null }[] };
  value_to_us: string; value_label: string; multiplier: number; signals: { company: string[]; person: string[] };
  research: Research | null; researched_at: string | null; research_tier: string | null;
  feedback: { direction: string; note: string | null; created_at: string; by: string | null }[];
}

export default function TrustCard({ prospectId, canResearch }: { prospectId: string; canResearch: boolean }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/prospects/${prospectId}/trust-score`);
      const out = await res.json();
      if (!res.ok || out.error) { setErr(out.error || `Failed (${res.status})`); return; }
      setD(out); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [prospectId]);
  useEffect(() => { void load(); }, [load]);

  const research = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/trust-research`, { method: 'POST' });
      const out = await res.json();
      if (!res.ok || out.error) { setErr(out.error || 'Research failed'); return; }
      await load();
    } finally { setBusy(false); }
  };

  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)' } as const;
  if (err && !d) return <div className="rounded-xl p-4 text-xs" style={card}><span style={{ color: 'var(--text-muted)' }}>Who they are to us: {err}</span></div>;
  if (!d) return <div className="rounded-xl p-4 text-xs" style={{ ...card, color: 'var(--text-muted)' }}>Who they are to us…</div>;
  const color = BAND_COLOR[trustBand(d.total)];
  const r = d.research;
  return (
    <div className="rounded-xl p-4 space-y-3 text-sm" style={card}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Who they are to us</h3>
        <div className="flex items-center gap-2 text-xs">
          <span style={{ color: 'var(--text-muted)' }}>{d.value_label}{d.multiplier ? ` · knows ${d.multiplier} on our lists` : ''}</span>
          {canResearch && (
            <button type="button" onClick={() => void research()} disabled={busy} className="px-2.5 py-1 rounded-lg font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)', opacity: busy ? 0.6 : 1 }}
              title="LinkedIn profile, the web and one Google lookup, then re-score (as the list's sender)">
              {busy ? 'Researching…' : r ? 'Research again' : 'Research now'}
            </button>
          )}
        </div>
      </div>
      {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
      <div className="space-y-1">
        {partFractions(d.parts, d.weights).map((b) => (
          <div key={b.part} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-2 text-xs">
            <span style={{ color: 'var(--text-muted)' }}>{PART_LABELS[b.part]}</span>
            <span className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
              <span className="block h-full rounded-full" style={{ width: `${Math.round(b.fraction * 100)}%`, background: color }} />
            </span>
            <span className="tabular-nums text-right">{b.points}/{b.max}</span>
          </div>
        ))}
        {d.held ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>held {d.held > 0 ? '+' : ''}{d.held} by the team's ✓ / ↓</p> : null}
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Path: {TRUST_KIND_LABELS[d.path.kind] ?? d.path.kind}{d.path.via ? ` · via ${d.path.via}` : ''}
        {d.path.own_tie ? ` · our tie ${d.path.own_tie}` : ''}{d.path.mutual ? ` · ${d.path.mutual} mutual` : ''}
        {d.path.routes.length > 1 ? ` · ${d.path.routes.length} people know them` : ''}
      </p>
      {r ? (
        <div className="text-xs space-y-1">
          {r.background && <p>{r.background}</p>}
          {r.mandate && <p><span style={{ color: 'var(--text-muted)' }}>Mandate:</span> {r.mandate}</p>}
          {r.value_note && <p><span style={{ color: 'var(--text-muted)' }}>Value to us:</span> {r.value_note}</p>}
          <p style={{ color: 'var(--text-muted)' }}>
            {r.role_confirmed === true ? 'Role confirmed' : r.role_confirmed === false ? 'Role not confirmed' : 'Role unverified'}
            {r.tenure_months != null ? ` · ${r.tenure_months} months in role` : ''}
            {(r.prior_roles ?? []).length ? ` · before: ${(r.prior_roles ?? []).slice(0, 3).join('; ')}` : ''}
          </p>
          {(d.signals.person.length + d.signals.company.length) > 0 && (
            <p style={{ color: 'var(--text-muted)' }}>Signals: {[...d.signals.company, ...d.signals.person].join(', ')}</p>
          )}
          {(r.sources ?? []).length > 0 && (
            <p style={{ color: 'var(--text-muted)' }}>Sources: {(r.sources ?? []).slice(0, 4).map((s, i) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline mr-2" style={{ color: 'var(--accent)' }}>{s.title || `link ${i + 1}`}</a>
            ))}</p>
          )}
          <p style={{ color: 'var(--text-muted)' }}>Researched {d.researched_at ? relativeTime(d.researched_at) : ''}{d.research_tier === 'grounded' ? ' · deep lookup' : ' · free lookup'}</p>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Not researched yet: the score comes from what we already hold (title, the company verdict, warmth, the graph). The nightly pass fills the rest.</p>
      )}
      {d.feedback.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Feedback: {d.feedback.slice(0, 4).map((f) => `${f.direction === 'up' ? '✓' : '↓'} ${f.by ?? 'someone'}${f.note ? ` “${f.note}”` : ''} ${relativeTime(f.created_at)}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
