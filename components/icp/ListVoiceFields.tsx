'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Product } from '@/lib/voice';

export interface ListVoice { product_id: string; writing_context: string; language: string }

/**
 * What one list pitches (Brand & Voice, core 079): a product of the list's brand, the hook for these people, and an
 * optional language. Every drafter writing to someone on this list reads it.
 */
export default function ListVoiceFields({ brandKey, value, onChange, inputStyle }: {
  brandKey: string; value: ListVoice; onChange: (v: ListVoice) => void; inputStyle: React.CSSProperties;
}) {
  const [products, setProducts] = useState<Product[] | null>(null);
  useEffect(() => {
    let off = false;
    fetch(`/api/brand?brand=${encodeURIComponent(brandKey)}`).then((r) => r.json())
      .then((d) => { if (!off) setProducts(Array.isArray(d.products) ? d.products : []); })
      .catch(() => { if (!off) setProducts([]); });
    return () => { off = true; };
  }, [brandKey]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select value={value.product_id} onChange={(e) => onChange({ ...value, product_id: e.target.value })}
          className="z-input text-sm" style={{ ...inputStyle, width: 'auto' }} aria-label="Product">
          <option value="">{products === null ? 'Loading products…' : products.length ? 'No product picked' : 'No products yet'}</option>
          {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value })} placeholder="Language, e.g. de"
          className="z-input text-sm" style={{ ...inputStyle, width: '11rem' }} aria-label="Language" />
      </div>
      <textarea value={value.writing_context} onChange={(e) => onChange({ ...value, writing_context: e.target.value })} rows={2}
        placeholder="The hook, e.g. “Met at Fakuma 2026 — they plan 50+ machines in Excel.”"
        className="z-input text-sm resize-y" style={inputStyle} aria-label="Hook" />
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Products live on <Link href={`/brand?tab=products&brand=${brandKey}`} className="underline">Brand &amp; Voice</Link>.
      </div>
    </div>
  );
}
