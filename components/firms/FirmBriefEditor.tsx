'use client';

import { useState } from 'react';
import type { FirmBrief } from '@/lib/firms';

/** What every firm on the list is judged against. Saving re-judges the whole list (hand-set verdicts stay). */
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export default function FirmBriefEditor({ icpId, brief, onSaved, onCancel }: {
  icpId: string; brief: FirmBrief; onSaved: (tally: Record<string, number>) => void; onCancel: () => void;
}) {
  const [b, setB] = useState({
    stages: (brief.stages || []).join(', '), round_size: brief.round_size ? String(brief.round_size) : '',
    currency: brief.currency || 'EUR', entity_country: brief.entity_country || '',
    geographies: (brief.geographies || []).join(', '), sectors: (brief.sectors || []).join(', '),
    exclude_sectors: (brief.exclude_sectors || []).join(', '), min_fund_year: brief.min_fund_year ? String(brief.min_fund_year) : '',
    pitch: brief.pitch || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body = {
        stages: list(b.stages), round_size: b.round_size ? Number(b.round_size.replace(/[^\d.]/g, '')) : undefined,
        currency: b.currency || undefined, entity_country: b.entity_country || undefined, geographies: list(b.geographies),
        sectors: list(b.sectors), exclude_sectors: list(b.exclude_sectors),
        min_fund_year: b.min_fund_year ? Number(b.min_fund_year) : undefined, pitch: b.pitch.trim() || undefined,
      };
      const res = await fetch(`/api/icp/${icpId}/firms/brief`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: body }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not save the brief.');
      onSaved(out.rejudged || {});
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    finally { setBusy(false); }
  };

  const field = (k: keyof typeof b, label: string, placeholder: string, hint?: string) => (
    <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
      {label}
      <input id={`brief-${k}`} value={b[k]} onChange={(e) => setB((x) => ({ ...x, [k]: e.target.value }))} className="z-input text-sm" placeholder={placeholder} />
      {hint && <span className="text-[11px]">{hint}</span>}
    </label>
  );

  return (
    <div className="rounded-xl p-4 grid gap-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <div>
        <div className="font-medium text-sm">What firms are judged against</div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Each researched firm gets Go, Check or Out from these rules, with the reason. Commas separate values.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {field('stages', 'Our stage', 'pre-seed, seed')}
        {field('round_size', 'Round size', '1500000')}
        {field('currency', 'Currency', 'EUR')}
        {field('entity_country', 'Our company is in', 'Germany')}
        {field('geographies', 'Regions a fund must cover', 'Europe', 'Global funds always count')}
        {field('min_fund_year', 'Latest fund at least from', String(new Date().getFullYear() - 4), 'Older → Check: may not be investing')}
        {field('sectors', 'Sectors the thesis should name', 'B2B, AI, SaaS, automation')}
        {field('exclude_sectors', 'Out if it invests only in', 'crypto, biotech, consumer')}
      </div>
      <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        What we raise for (one sentence — research uses it to write each firm’s opening line)
        <textarea id="brief-pitch" value={b.pitch} onChange={(e) => setB((x) => ({ ...x, pitch: e.target.value }))} rows={2} className="z-input text-sm"
          placeholder="Zeami: AI workflow software that maps how business teams work and automates the repeatable parts." />
      </label>
      {error && <p className="text-xs" role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="z-btn text-xs">{busy ? 'Saving…' : 'Save and re-judge'}</button>
      </div>
    </div>
  );
}
