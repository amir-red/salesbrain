'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import PageHeader from '@/components/panel/PageHeader';
import BrandTab from '@/components/brand/BrandTab';
import VoiceTab from '@/components/brand/VoiceTab';
import { CompetitorsTab, ProductsTab, TemplatesTab } from '@/components/brand/ItemsTabs';
import { api } from '@/components/brand/ui';
import type { BrandPayload } from '@/lib/voice';

const TABS = [
  { key: 'brand', label: 'Brand' },
  { key: 'voice', label: 'Voice' },
  { key: 'products', label: 'Products' },
  { key: 'competitors', label: 'Competitors' },
  { key: 'templates', label: 'Templates' },
] as const;
type TabKey = typeof TABS[number]['key'];

/**
 * /brand — Brand & Voice (core 079): who we are, how we write, what each list pitches, and the rules every drafter
 * reads before it writes to a prospect. The Voice tab shows the viewer's OWN voice, learned from their edits and
 * 1–10 ratings (live at once, no approval step), and the team's voice for the brand.
 */
export default function BrandPage() {
  return <Suspense><BrandPageInner /></Suspense>;
}

function BrandPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'brand') as TabKey;
  const brand = sp.get('brand') || 'zeami';
  const [data, setData] = useState<(BrandPayload & { brands: { key: string; name: string }[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const out = await api<BrandPayload & { brands: { key: string; name: string }[] }>(`/api/brand?brand=${encodeURIComponent(brand)}`);
    if (out.error) setErr(out.error); else { setData(out); setErr(null); }
  }, [brand]);
  useEffect(() => { load(); }, [load]);

  const go = (next: { tab?: string; brand?: string }) => {
    const q = new URLSearchParams({ tab: next.tab ?? tab, brand: next.brand ?? brand });
    router.replace(`/brand?${q.toString()}`);
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <PageHeader title="Brand & Voice"
          subtitle={<>How we write for {data?.brand.name ?? '…'}. Every drafter — the agents, the bot, follow-ups, intro asks, the lead card — reads this first; your own corrections and ratings teach your voice as you go.</>}
          actions={data && data.brands.length > 1 ? (
            <div className="flex rounded-lg p-0.5" style={{ background: 'var(--bg-input)' }} role="tablist" aria-label="Brand">
              {data.brands.map((b) => (
                <button key={b.key} role="tab" aria-selected={b.key === brand} onClick={() => go({ brand: b.key })}
                  className="px-3 py-1 rounded-md text-xs"
                  style={{ background: b.key === brand ? 'var(--bg-card)' : 'transparent', color: b.key === brand ? 'var(--text)' : 'var(--text-muted)' }}>{b.name}</button>
              ))}
            </div>
          ) : null} />
        <div className="px-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <nav className="flex gap-4 overflow-x-auto" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => go({ tab: t.key })} aria-current={t.key === tab ? 'page' : undefined}
                className="py-2 text-sm whitespace-nowrap -mb-px"
                style={{ borderBottom: `2px solid ${t.key === tab ? 'var(--accent)' : 'transparent'}`, color: t.key === tab ? 'var(--text)' : 'var(--text-muted)' }}>
                {t.label}
                {t.key === 'products' && data ? <span className="ml-1 text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{data.products.length}</span> : null}
              </button>
            ))}
          </nav>
        </div>
        <div className="p-4 space-y-4 max-w-5xl">

          {err && <div className="text-sm rounded-xl p-3" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>
            {err} — if this says a table is missing, migration 079 has not been applied yet.</div>}
          {!data && !err && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="z-panel h-24 animate-pulse" />)}</div>}
          {data && tab === 'brand' && <BrandTab data={data} reload={load} />}
          {data && tab === 'voice' && <VoiceTab data={data} reload={load} />}
          {data && tab === 'products' && <ProductsTab data={data} reload={load} />}
          {data && tab === 'competitors' && <CompetitorsTab data={data} reload={load} />}
          {data && tab === 'templates' && <TemplatesTab data={data} reload={load} />}
        </div>
      </div>
    </div>
  );
}
