'use client';

import { useState } from 'react';
import type { BrandPayload } from '@/lib/voice';
import { api, Help, Section, TextTile } from './ui';

interface Suggestion {
  industry: string | null; description: string | null; pain_points: string | null; tone: string | null; language: string | null;
  products: { name: string; description: string | null; pain: string | null }[];
  competitors: { name: string; differentiation: string | null }[];
}

/** Who we are and whose problem we solve — the subject matter of every message. */
export default function BrandTab({ data, reload }: { data: BrandPayload; reload: () => void }) {
  const b = data.brand;
  const drafted = b.ai_drafted ?? {};
  const save = (field: string) => async (v: string) => {
    const out = await api(`/api/brand/${b.key}`, { method: 'PATCH', body: { fields: { [field]: v } } });
    if (out.error) return out.error;
    reload();
    return null;
  };

  return (
    <div className="space-y-4">
      <DraftFromWebsite data={data} reload={reload} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextTile label="What we do and why it matters" value={b.description} aiDrafted={!!drafted.description}
          placeholder="Two or three plain sentences: what we do, for whom, and the result for the customer."
          help="The subject of every message and reply. Background for the writer, never copied word for word — so no taglines."
          onSave={save('description')} />
        <TextTile label="Our customers' pain" value={b.pain_points} aiDrafted={!!drafted.pain_points}
          placeholder="e.g. Ops leads at 200-person manufacturers lose a day a week chasing status across email, Excel and the ERP."
          help={<>Specific beats general. A product&apos;s own pain wins over this; this is the fallback for every list without one.</>}
          onSave={save('pain_points')} />
        <TextTile label="Industry" value={b.industry} multiline={false} aiDrafted={!!drafted.industry}
          placeholder="The industry we sell into, a few words"
          help="Context for the writer and for judging fit." onSave={save('industry')} />
        <TextTile label="Website" value={b.website} multiline={false}
          placeholder="https://…" help="Where “Draft from website” reads from." onSave={save('website')} />
      </div>
    </div>
  );
}

function DraftFromWebsite({ data, reload }: { data: BrandPayload; reload: () => void }) {
  const b = data.brand;
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [s, setS] = useState<Suggestion | null>(null);
  const [saving, setSaving] = useState(false);

  const run = async () => {
    setBusy(true); setErr(null); setS(null);
    const out = await api<{ suggestion: Suggestion }>(`/api/brand/${b.key}/suggest`, { method: 'POST', body: { notes } });
    setBusy(false);
    if (out.error) setErr(out.error); else setS(out.suggestion);
  };

  const accept = async () => {
    if (!s) return;
    setSaving(true); setErr(null);
    const fields: Record<string, string> = {};
    for (const k of ['description', 'pain_points', 'industry', 'tone', 'language'] as const) {
      const v = s[k];
      // Only fill what is empty — a person's text is never overwritten by a draft.
      if (v && !(b as unknown as Record<string, string | null>)[k]) fields[k] = v;
    }
    if (Object.keys(fields).length) {
      const out = await api(`/api/brand/${b.key}`, { method: 'PATCH', body: { fields, ai_drafted: Object.keys(fields) } });
      if (out.error) { setErr(out.error); setSaving(false); return; }
    }
    const haveP = new Set(data.products.map((p) => p.name.toLowerCase()));
    for (const p of s.products) if (!haveP.has(p.name.toLowerCase())) await api(`/api/brand/${b.key}`, { method: 'POST', body: { type: 'product', item: p } });
    const haveC = new Set(data.competitors.map((c) => c.name.toLowerCase()));
    for (const c of s.competitors) if (!haveC.has(c.name.toLowerCase())) await api(`/api/brand/${b.key}`, { method: 'POST', body: { type: 'competitor', item: c } });
    setSaving(false); setS(null); reload();
  };

  const empty = data.missing.length > 0;
  return (
    <Section title="Draft from website"
      help={<>Reads {b.website ? <b>{b.website}</b> : 'the website'} and drafts what is empty. You see it first; only empty fields are filled, and they stay marked as AI-drafted until you edit them.</>}
      aside={<button onClick={run} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 shrink-0" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Reading…' : 'Draft'}</button>}>
      {empty && !s && <Help>Still empty: {data.missing.map((m) => m.replace('_', ' ')).join(', ')}.</Help>}
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="z-input"
        placeholder="Optional: a few sentences in your own words — what we sell, to whom, what changes for them. Used with the website, or instead of it when the site can't be read." aria-label="Notes for the draft" />
      {err && <div className="text-xs" style={{ color: 'var(--red)' }}>{err}</div>}
      {s && (
        <div className="space-y-2 rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          {(['description', 'pain_points', 'industry', 'tone', 'language'] as const).map((k) => s[k] ? (
            <div key={k} className="text-sm"><span className="text-xs font-medium">{k.replace('_', ' ')}</span>
              <p className="whitespace-pre-wrap">{s[k]}</p>
              {(b as unknown as Record<string, string | null>)[k] ? <Help>Already filled — yours is kept.</Help> : null}
            </div>) : null)}
          {s.products.length > 0 && <div className="text-sm"><span className="text-xs font-medium">products</span>
            {s.products.map((p) => <p key={p.name}><b>{p.name}</b>{p.description ? ` — ${p.description}` : ''}</p>)}</div>}
          {s.competitors.length > 0 && <div className="text-sm"><span className="text-xs font-medium">competitors</span>
            <p>{s.competitors.map((c) => c.name).join(', ')}</p></div>}
          <div className="flex gap-2 pt-1">
            <button onClick={accept} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{saving ? 'Saving…' : 'Use these'}</button>
            <button onClick={() => setS(null)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}>Discard</button>
          </div>
        </div>
      )}
    </Section>
  );
}
