'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          <header className="space-y-2">
            <div className="z-eyebrow">Brand &amp; Voice</div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h1 className="text-2xl font-semibold" style={{ textWrap: 'balance' }}>
                How we write for <span style={{ color: 'var(--accent)' }}>{data?.brand.name ?? '…'}</span>
              </h1>
              {data && data.brands.length > 1 && (
                <div className="flex rounded-full p-0.5" style={{ background: 'var(--bg-input)' }} role="tablist" aria-label="Brand">
                  {data.brands.map((b) => (
                    <button key={b.key} role="tab" aria-selected={b.key === brand} onClick={() => go({ brand: b.key })}
                      className="px-3 py-1 rounded-full text-xs"
                      style={{ background: b.key === brand ? 'var(--bg-card)' : 'transparent', color: b.key === brand ? 'var(--text)' : 'var(--text-muted)' }}>{b.name}</button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Every drafter — the Outreach agent, the bot, follow-ups, intro asks, the lead card — reads this before it writes to a prospect.
              Your own corrections and ratings teach your voice as you go.
            </p>
          </header>

          <nav className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--border)' }} aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => go({ tab: t.key })} aria-current={t.key === tab ? 'page' : undefined}
                className="px-3 py-2 text-sm whitespace-nowrap -mb-px"
                style={{ borderBottom: `2px solid ${t.key === tab ? 'var(--accent)' : 'transparent'}`, color: t.key === tab ? 'var(--text)' : 'var(--text-muted)' }}>
                {t.label}
                {t.key === 'products' && data ? <span className="ml-1 text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{data.products.length}</span> : null}
              </button>
            ))}
          </nav>

          {err && <div className="text-sm rounded-xl p-3" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>
            {err} — if this says a table is missing, migration 079 has not been applied yet.</div>}
          {!data && !err && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="z-card h-24 animate-pulse" />)}</div>}
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
