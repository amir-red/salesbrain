'use client';

/**
 * "Warm, nobody on it" on the Dashboard (was the /warm page until 2026-11-11). Who the team already talks to and nobody
 * is working, warmest first; "Add as lead" makes a card in the Own network lane (back office = the warmest teammate).
 *
 * Mateo, 2026-10-26: "nobody opens cold outreach … everything that moved forward is people that are almost friends."
 * Warmth is scored in core policy/warmth.py; a bare LinkedIn connection is "cool" and never shows here by default.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import ExportButton from '@/components/ExportButton';
import { FUNNEL_LABELS, type FunnelStage } from '@/lib/funnel';
import { WARMTH_BANDS, WARMTH_COLOR, linkedinUrl, type WarmPeople, type WarmPerson } from '@/lib/warm';

const selectStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };

/** Their profile page. A person on no list has no profile until they are added as a lead (/person resolves it then). */
function profileHref(p: WarmPerson, added: boolean): string | null {
  return p.prospect_id ? `/prospects/${p.prospect_id}` : added ? `/person/${p.person_id}` : null;
}

function Row({ p, onAdded }: { p: WarmPerson; onAdded: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const color = WARMTH_COLOR[p.band];
  const li = linkedinUrl(p.linkedin);
  const add = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/warm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person_id: p.person_id }) });
      const out = await res.json();
      if (!res.ok || out.error) { setErr(out.error || `Not added (${res.status})`); return; }
      if (out.created === false) { setErr(out.note || 'Already a lead'); return; }
      setAdded(true);
      onAdded(`${p.name} is now a lead (Own network), back office ${p.via.name}.`);
    } catch { setErr('Could not reach the server'); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="w-full sm:w-auto sm:flex-1 min-w-0 sm:min-w-[260px]">
        <div className="flex items-center gap-2 min-w-0">
          {profileHref(p, added) ? (
            <Link href={profileHref(p, added)!} className="font-medium truncate hover:underline" title="Open their profile">{p.name}</Link>
          ) : (
            <span className="font-medium truncate" title="Not a lead yet: add them to get a profile">{p.name}</span>
          )}
          {li && <a href={li} target="_blank" rel="noreferrer" className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>LinkedIn ↗</a>}
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          {[p.company, p.headline].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
      <div className="w-[150px] shrink-0">
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" title={p.reasons.join('\n')}
          style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
          {WARMTH_BANDS[p.band]} · {Math.round(p.warmth * 100)}
        </span>
        <div className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>{p.reasons[0] ?? ''}</div>
      </div>
      <div className="w-[130px] shrink-0 text-xs">
        <div style={{ color: 'var(--text-muted)' }}>via</div>
        <div>{p.via.name}</div>
      </div>
      <div className="w-[170px] shrink-0 text-xs">
        <div style={{ color: 'var(--text-muted)' }}>{p.list ? 'on a list' : 'not on any list'}</div>
        <div className="truncate" title={p.list ?? ''}>{p.list ? `${p.list}${p.fit != null ? ` · fit ${p.fit}` : ''}` : '—'}</div>
      </div>
      <div className="w-[130px] shrink-0 text-xs">
        <div style={{ color: 'var(--text-muted)' }}>funnel</div>
        <div>{p.stage ? FUNNEL_LABELS[p.stage as FunnelStage] ?? p.stage : 'not on a list'}{p.resting ? ' · resting' : ''}</div>
      </div>
      <div className="ml-auto shrink-0 text-right">
        {p.has_card || added ? (
          <Link href={`/sales-leads?q=${encodeURIComponent(p.name)}`} className="text-xs underline" style={{ color: 'var(--text-muted)' }}>
            {added ? 'Added · open lead →' : 'Has a lead card →'}
          </Link>
        ) : (
          <button onClick={add} disabled={busy} className="px-3 py-1.5 rounded-full text-xs font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Adding…' : 'Add as lead'}</button>
        )}
        {err && <div className="text-[11px] mt-1 max-w-[220px]" style={{ color: 'var(--red)' }}>{err}</div>}
      </div>
    </div>
  );
}

const SHOW = 8;

export default function WarmPeopleCard({ owner }: { owner: string }) {
  const [band, setBand] = useState<'hot' | 'warm'>('warm');
  const [worked, setWorked] = useState(false);
  const [all, setAll] = useState(false);
  const [data, setData] = useState<WarmPeople | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const q = new URLSearchParams({ band, limit: '300', ...(owner ? { owner } : {}), ...(worked ? { include_worked: '1' } : {}) });
    try {
      const res = await fetch(`/api/warm?${q}`);
      const out = await res.json();
      if (!res.ok) { setError(out.error || `Could not load (${res.status})`); return; }
      setData(out as WarmPeople);
    } catch { setError('Could not reach the server'); }
  }, [band, owner, worked]);

  useEffect(() => { setData(null); setAll(false); void load(); }, [load]);

  const people = data ? (all ? data.people : data.people.slice(0, SHOW)) : [];
  return (
    <section id="warm" className="z-panel rounded-2xl overflow-hidden scroll-mt-4">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-[15px] font-semibold">Warm, nobody on it{data ? ` · ${data.total.toLocaleString()}` : ''}</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            People who wrote to us or we met, and nobody is working now. Start here before any cold list.
          </p>
        </div>
        <select value={band} onChange={(e) => setBand(e.target.value as 'hot' | 'warm')} aria-label="How warm"
          className="h-8 px-2.5 rounded-full text-xs outline-none" style={selectStyle}>
          <option value="warm">Hot and warm</option>
          <option value="hot">Hot only</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={worked} onChange={(e) => setWorked(e.target.checked)} />
          Also people someone is working
        </label>
        <ExportButton href={`/api/export/warm?${new URLSearchParams({ band, ...(owner ? { owner } : {}), ...(worked ? { worked: '1' } : {}) })}`}
          title="Download these people as Excel, plus every teammate × person relationship" />
      </div>
      {note && <div className="mx-5 mb-2 text-xs px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)', color: 'var(--green)' }}>{note}</div>}
      {error && <div className="mx-5 mb-2 text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>{error}</div>}
      {!data && !error && (
        <div className="px-5 pb-4 space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: 'var(--bg-input)' }} />)}
        </div>
      )}
      {data && data.people.length === 0 && (
        <div className="px-5 pb-5 text-sm" style={{ color: 'var(--text-muted)' }}>
          Nobody here right now. Warmth grows from real conversations: LinkedIn and Gmail on your profile, WhatsApp chats
          imported on Profile → Imports.
        </div>
      )}
      {people.map((p) => <Row key={p.person_id} p={p} onAdded={setNote} />)}
      {data && data.people.length > SHOW && (
        <button type="button" onClick={() => setAll(!all)} className="w-full px-5 py-2.5 text-xs text-left"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {all ? 'Show fewer' : `Show all ${data.people.length.toLocaleString()}${data.total > data.people.length ? ` of ${data.total.toLocaleString()}` : ''}`}
          {!worked && data.left_out_being_worked ? ` · ${data.left_out_being_worked} being worked, hidden` : ''}
        </button>
      )}
    </section>
  );
}
