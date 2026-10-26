'use client';

/**
 * /warm — Warm people: who we already talk to and nobody is working yet, warmest first (funnel Phase C).
 *
 * Mateo, 2026-10-26: "nobody opens cold outreach … everything that moved forward is people that are almost friends. Who
 * did I talk to recently and how warm was it." Includes people on no list: a warm friend at a company we would never
 * target can be the door. "Add as lead" makes a card in the Own network lane (back office = the warmest teammate).
 */
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import PageHeader from '@/components/panel/PageHeader';
import ExportButton from '@/components/ExportButton';
import { FUNNEL_LABELS, type FunnelStage } from '@/lib/funnel';
import { WARMTH_BANDS, WARMTH_COLOR, linkedinUrl, type WarmPeople, type WarmPerson } from '@/lib/warm';

interface Opt { id: string; name: string; email?: string }

const selectStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };

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
          <span className="font-medium truncate">{p.name}</span>
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

function WarmPage() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const band = sp.get('band') || 'warm';
  const owner = sp.get('owner') || '';
  const worked = sp.get('worked') === '1';
  const [data, setData] = useState<WarmPeople | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Opt[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const set = (k: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(k, v); else q.delete(k);
    router.replace(`${path}${q.toString() ? `?${q}` : ''}`);
  };

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

  useEffect(() => { setData(null); void load(); }, [load]);
  useEffect(() => {
    fetch('/api/users').then((r) => (r.ok ? r.json() : []))
      .then((u: Opt[]) => setUsers((Array.isArray(u) ? u : []).filter((x) => !x.email?.endsWith('.service.salesbrain')
        && x.email !== 'agent@salesbrain.internal')))
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <PageHeader title="Warm people"
          subtitle="Who we already talk to and nobody is working yet, warmest first. Start here before any cold list."
          actions={<ExportButton href={`/api/export/warm?${new URLSearchParams({ band, ...(owner ? { owner } : {}), ...(worked ? { worked: '1' } : {}) })}`}
            title="Download these people as Excel (current band, teammate and filter), plus every teammate × person relationship" />} />
        <div className="p-4 space-y-3 max-w-[1400px]">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select value={band} onChange={(e) => set('band', e.target.value === 'warm' ? '' : e.target.value)}
              className="px-2 py-1.5 rounded-lg outline-none" style={selectStyle}>
              <option value="hot">Hot only</option>
              <option value="warm">Hot and warm</option>
              <option value="cool">Hot, warm and cool</option>
            </select>
            <select value={owner} onChange={(e) => set('owner', e.target.value)} className="px-2 py-1.5 rounded-lg outline-none" style={selectStyle}>
              <option value="">Whole team&apos;s relationships</option>
              <option value="me">Mine</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <label className="inline-flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={worked} onChange={(e) => set('worked', e.target.checked ? '1' : '')} />
              Also people someone is working
            </label>
            {data && (
              <span style={{ color: 'var(--text-muted)' }}>
                {data.total.toLocaleString()} people
                {Object.entries(data.by_band).map(([b, n]) => ` · ${n} ${b}`).join('')}
                {!worked && data.left_out_being_worked ? ` · ${data.left_out_being_worked} being worked, hidden` : ''}
              </span>
            )}
          </div>
          {note && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)', color: 'var(--green)' }}>{note}</div>
          )}
          {error && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>{error}</div>
          )}
          <section className="z-panel overflow-hidden">
            {!data && !error && (
              <div className="p-4 space-y-2" aria-busy="true">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: 'var(--bg-input)' }} />)}
              </div>
            )}
            {data && data.people.length === 0 && (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Nobody in this band yet. Warmth grows from real conversations: connect LinkedIn and Gmail on your profile,
                and log WhatsApp chats with the bot.
              </div>
            )}
            {data?.people.map((p) => <Row key={p.person_id} p={p} onAdded={setNote} />)}
          </section>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Warmth comes from real signals and fades with time: they wrote to us (LinkedIn, email, logged WhatsApp or
            calls), we met them, a LinkedIn connection, a saved contact. Hover a warmth chip for all its reasons.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><WarmPage /></Suspense>;
}
