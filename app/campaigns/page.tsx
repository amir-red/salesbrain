'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import Button from '@/components/panel/Button';
import PageHeader, { Pill } from '@/components/panel/PageHeader';
import { relativeTime } from '@/lib/time';
import { STATUS_STYLE, type CampaignRow } from '@/lib/campaigns';

/**
 * /campaigns — every campaign (org-wide, like /pipeline): a sequence the people on its lists walk, one approval card
 * per step per sender per day. "+ New campaign" opens the five-question wizard.
 */
const muted = { color: 'var(--text-muted)' };

function listLabel(l: { icp_id: string | null; name: string }) {
  return l.icp_id ? l.name : l.name.replace(/^event:/, '').replace(/^import:/, 'import · ').replace(/-/g, ' ');
}

export default function CampaignsPage() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/campaigns${archived ? '?archived=1' : ''}`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) { setError(out.error || 'Could not load campaigns.'); setRows([]); return; }
    setRows(out.campaigns ?? []);
  }, [archived]);
  useEffect(() => { void load(); }, [load]);

  const live = rows?.filter((r) => r.status === 'live').length ?? 0;
  const waiting = rows?.reduce((a, r) => a + (r.cards_waiting || 0), 0) ?? 0;
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <PageHeader title="Campaigns"
          subtitle={rows ? <>{rows.length} campaign{rows.length === 1 ? '' : 's'} · {live} live{waiting ? ` · ${waiting} card${waiting === 1 ? '' : 's'} waiting for approval` : ''} · a sequence of steps the people on your lists walk</> : 'Loading…'}
          actions={<>
            <button type="button" onClick={() => setArchived((v) => !v)} className="px-3 py-1.5 rounded-lg text-xs"
              style={{ border: '1px solid var(--border)', background: archived ? 'var(--accent)' : 'transparent', color: archived ? 'var(--accent-fg)' : 'var(--text-muted)' }}>
              {archived ? 'Archived shown' : 'Show archived'}
            </button>
            <Button variant="primary" href="/campaigns/new">+ New campaign</Button>
          </>} />

        <div className="p-4 space-y-3">
          {error && <div className="rounded-lg px-3 py-2 text-xs" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>}
          {rows === null && <p className="text-sm" style={muted}>Loading…</p>}
          {rows?.length === 0 && !error && (
            <div className="text-center py-16 space-y-2" style={muted}>
              <p className="text-sm">No campaigns yet.</p>
              <p className="text-xs">Pick a list, choose email, LinkedIn or both, and how many follow-ups — we draw the sequence for you.</p>
              <div className="pt-2"><Button variant="primary" href="/campaigns/new">+ New campaign</Button></div>
            </div>
          )}
          {rows?.map((c) => {
            const st = STATUS_STYLE[c.status] ?? STATUS_STYLE.draft;
            const lists = (c.lists ?? []).filter((l) => l.include);
            return (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="block rounded-xl p-4 hover:opacity-90"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{c.name}</span>
                      <Pill color={st.color}>{st.label}</Pill>
                      {c.has_unpublished && c.status !== 'draft' && <Pill color="var(--orange)">unpublished edits</Pill>}
                      {c.cards_waiting > 0 && <Pill color="var(--accent)">{c.cards_waiting} to approve</Pill>}
                    </div>
                    <p className="text-xs" style={muted}>
                      {lists.length ? lists.map(listLabel).join(' · ') : 'no list yet'}
                      {c.product_name ? ` · pitches ${c.product_name}` : ''} · {c.owner_name ?? '—'} · updated {relativeTime(c.updated_at)}
                    </p>
                    {c.goal && <p className="text-xs" style={muted}>Goal: {c.goal}</p>}
                  </div>
                  <div className="flex gap-5 shrink-0">
                    {([['in it now', c.active], ['sent', c.sent], ['replied', c.handed_off], ['finished', c.completed]] as const).map(([k, v]) => (
                      <div key={k} className="text-right">
                        <div className="text-sm font-semibold tabular-nums">{v}</div>
                        <div className="text-[11px]" style={muted}>{k}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
