'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { relativeTime } from '@/lib/time';
import { STATUS_STYLE, type CampaignRow } from '@/lib/campaigns';

/**
 * /campaigns — every campaign (org-wide, like /pipeline): a sequence the people on its lists walk, one approval card
 * per step per sender per day. Open one to draw its sequence on the canvas.
 */
interface Options {
  icps: { id: string; name: string; owner_name: string | null; leads: number }[];
  sources: { source: string; leads: number }[];
  products: { id: string; name: string }[];
}

function sourceLabel(s: string) {
  return s.replace(/^event:/, '').replace(/^import:/, 'import · ').replace(/-/g, ' ');
}

export default function CampaignsPage() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/campaigns${archived ? '?archived=1' : ''}`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) { setError(out.error || 'Could not load campaigns.'); setRows([]); return; }
    setRows(out.campaigns ?? []);
  }, [archived]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 max-w-6xl mx-auto grid gap-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold">Campaigns</h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                A sequence of steps the people on your lists walk: connect, wait, message, email, hand off. Every step
                drafts in the sender’s voice and waits on one card for their approval.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> show archived
              </label>
              <button type="button" className="z-btn text-sm" onClick={() => setCreating(true)}>New campaign</button>
            </div>
          </div>

          {error && <div className="rounded-lg px-3 py-2 text-sm" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>}

          {rows === null ? (
            <div className="grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="z-card h-20 animate-pulse" style={{ background: 'var(--bg-card)' }} />)}</div>
          ) : rows.length === 0 && !error ? (
            <div className="z-card p-8 text-center grid gap-2" style={{ background: 'var(--bg-card)' }}>
              <div className="font-semibold">No campaigns yet</div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Start from the usual path — connect, wait for the acceptance, a first message, up to three follow-ups,
                email when the request is not accepted — and change it on the canvas.
              </p>
              <div><button type="button" className="z-btn text-sm" onClick={() => setCreating(true)}>New campaign</button></div>
            </div>
          ) : (
            <div className="grid gap-2">
              {rows.map((c) => {
                const st = STATUS_STYLE[c.status] ?? STATUS_STYLE.draft;
                return (
                  <Link key={c.id} href={`/campaigns/${c.id}`} className="z-card p-4 grid gap-2 hover:opacity-90" style={{ background: 'var(--bg-card)' }}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{c.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: st.color, background: `color-mix(in srgb, ${st.color} 14%, transparent)` }}>{st.label}</span>
                          {c.has_unpublished && c.status !== 'draft' && (
                            <span className="text-xs" style={{ color: 'var(--orange)' }}>unpublished edits</span>
                          )}
                          {c.cards_waiting > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}>
                              {c.cards_waiting} card{c.cards_waiting === 1 ? '' : 's'} to approve
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                          {(c.lists ?? []).filter((l) => l.include).map((l) => l.icp_id ? l.name : sourceLabel(l.name)).join(' · ') || 'no list yet'}
                          {c.product_name ? ` · pitches ${c.product_name}` : ''} · {c.owner_name ?? '—'} · updated {relativeTime(c.updated_at)}
                        </div>
                      </div>
                      <div className="flex gap-4 text-sm shrink-0">
                        {[['in', c.active], ['sent', c.sent], ['handed off', c.handed_off], ['finished', c.completed]].map(([k, v]) => (
                          <div key={String(k)} className="text-right">
                            <div className="font-semibold tabular-nums">{v as number}</div>
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{k}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {c.goal && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Goal: {c.goal}</div>}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {creating && <NewCampaign onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewCampaign({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [opts, setOpts] = useState<Options | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [productId, setProductId] = useState('');
  const [icps, setIcps] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [startFrom, setStartFrom] = useState<'default' | 'blank'>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/campaigns/options');
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) { setError(out.error || 'Could not load your lists.'); return; }
      setOpts(out);
    })();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, goal, product_id: productId || null, start_from: startFrom,
          lists: [...icps.map((id) => ({ icp_id: id })), ...sources.map((s) => ({ source: s }))] }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not create the campaign.');
      router.push(`/campaigns/${out.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the campaign.'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'color-mix(in srgb, black 45%, transparent)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-campaign-title" className="z-card w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 grid gap-4" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between">
          <h2 id="new-campaign-title" className="font-bold">New campaign</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-lg leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="z-eyebrow">Name</span>
          <input className="z-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NRW plastics · autumn" autoFocus />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="z-eyebrow">Goal</span>
          <input className="z-input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. a 20-minute call about where AI saves them hours" />
        </label>
        {opts && opts.products.length > 0 && (
          <label className="grid gap-1 text-sm">
            <span className="z-eyebrow">Product it pitches</span>
            <select className="z-input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— the brand in general —</option>
              {opts.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <div className="grid gap-2 text-sm">
          <span className="z-eyebrow">Who it works on</span>
          {!opts && !error && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading your lists…</div>}
          {opts && (
            <div className="grid gap-3 max-h-64 overflow-y-auto pr-1">
              {opts.icps.length > 0 && (
                <div className="grid gap-1">
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Lists</div>
                  {opts.icps.map((i) => (
                    <label key={i.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={icps.includes(i.id)} onChange={() => toggle(icps, setIcps, i.id)} />
                      <span className="flex-1 truncate">{i.name}</span>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{i.leads} · {i.owner_name}</span>
                    </label>
                  ))}
                </div>
              )}
              {opts.sources.length > 0 && (
                <div className="grid gap-1">
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Sales-lead sources</div>
                  {opts.sources.map((s) => (
                    <label key={s.source} className="flex items-center gap-2">
                      <input type="checkbox" checked={sources.includes(s.source)} onChange={() => toggle(sources, setSources, s.source)} />
                      <span className="flex-1 truncate">{sourceLabel(s.source)}</span>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{s.leads}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            A person is in one campaign at a time. People who already replied, or are in another campaign, are not added.
          </p>
        </div>
        <div className="grid gap-2 text-sm">
          <span className="z-eyebrow">Start from</span>
          <div className="grid sm:grid-cols-2 gap-2">
            {([['default', 'The usual path', 'Connect → wait for the acceptance → first message → up to 3 follow-ups; email when the request is not accepted.'],
               ['blank', 'An empty canvas', 'Only the Start step; draw your own.']] as const).map(([k, t, h]) => (
              <button key={k} type="button" onClick={() => setStartFrom(k)} className="text-left rounded-xl p-3 grid gap-1"
                style={{ border: `1px solid ${startFrom === k ? 'var(--accent)' : 'var(--border)'}`, background: startFrom === k ? 'var(--accent-soft)' : 'transparent' }}>
                <span className="font-medium">{t}</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{h}</span>
              </button>
            ))}
          </div>
        </div>
        {error && <div className="rounded-lg px-3 py-2 text-sm" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>Cancel</button>
          <button type="button" onClick={create} disabled={busy || !name.trim()} className="z-btn text-sm">{busy ? 'Creating…' : 'Create draft'}</button>
        </div>
      </div>
    </div>
  );
}
