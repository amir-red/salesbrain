'use client';

import { useState } from 'react';
import { STEPS, type BrandPayload, type CaseStudy, type Competitor, type MessageTemplate, type Objection, type Product, type ValueGive } from '@/lib/voice';
import { api, Help, ObjectList, Section } from './ui';

/* ------------------------------------------------------------------ Products */

const EMPTY_PRODUCT: Omit<Product, 'id'> = { name: '', description: '', pain: '', case_studies: [], value_gives: [], objections: [] };

export function ProductsTab({ data, reload }: { data: BrandPayload; reload: () => void }) {
  const [open, setOpen] = useState<string | 'new' | null>(data.products.length === 0 ? 'new' : null);
  return (
    <div className="space-y-4">
      <Help>Each list pitches one product (pick it on the list, in ICP). The writer uses the pain to frame the message, the proof as evidence, a free resource instead of asking for a meeting, and the objection answers only when someone replies.</Help>
      {data.products.map((p) => (
        open === p.id
          ? <ProductForm key={p.id} brandKey={data.brand.key} product={p} onDone={() => { setOpen(null); reload(); }} />
          : (
            <div key={p.id} className="z-card p-4 flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold">{p.name}</h3>
                {p.pain && <p className="text-sm">{p.pain}</p>}
                <Help>{p.case_studies.length} proof point{p.case_studies.length === 1 ? '' : 's'} · {p.value_gives.length} free resource{p.value_gives.length === 1 ? '' : 's'} · {p.objections.length} objection answer{p.objections.length === 1 ? '' : 's'}</Help>
              </div>
              <button onClick={() => setOpen(p.id)} className="text-xs underline shrink-0" style={{ color: 'var(--text-muted)' }}>Edit</button>
            </div>
          )
      ))}
      {open === 'new'
        ? <ProductForm brandKey={data.brand.key} product={null} onDone={() => { setOpen(null); reload(); }} />
        : <button onClick={() => setOpen('new')} className="z-btn !min-h-0 !py-2 text-xs">+ New product or service</button>}
    </div>
  );
}

function ProductForm({ brandKey, product, onDone }: { brandKey: string; product: Product | null; onDone: () => void }) {
  const [p, setP] = useState<Omit<Product, 'id'> & { id?: string }>(product ?? { ...EMPTY_PRODUCT });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErr(null);
    const clean = <T extends object>(xs: T[]) => xs.filter((x) => Object.values(x).some((v) => typeof v === 'string' && v.trim()));
    const out = await api(`/api/brand/${brandKey}`, { method: 'POST', body: { type: 'product', item: {
      ...p, case_studies: clean(p.case_studies), value_gives: clean(p.value_gives), objections: clean(p.objections) } } });
    setBusy(false);
    if (out.error) setErr(out.error); else onDone();
  };
  const archive = async () => {
    if (!product) return;
    await api(`/api/brand/${brandKey}`, { method: 'POST', body: { action: 'archive', type: 'product', id: product.id } });
    onDone();
  };
  return (
    <Section title={product ? `Edit ${product.name}` : 'New product or service'}>
      <label className="block space-y-1"><span className="text-xs font-medium">Name</span>
        <input value={p.name} onChange={(e) => set('name', e.target.value)} className="z-input" placeholder="Zeami Audit" /></label>
      <label className="block space-y-1"><span className="text-xs font-medium">What it does, for whom</span>
        <textarea value={p.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={3} className="z-input" placeholder="One plain paragraph." />
        <Help>Background for the writer, never copied — skip the taglines.</Help></label>
      <label className="block space-y-1"><span className="text-xs font-medium">The pain it solves</span>
        <textarea value={p.pain ?? ''} onChange={(e) => set('pain', e.target.value)} rows={2} className="z-input"
          placeholder="e.g. Nobody can say where the team's week goes, so automation money is spent on the wrong things." />
        <Help>Frames the opening of every message for this product. Empty → the brand&apos;s pain is used.</Help></label>
      <div className="space-y-1"><span className="text-xs font-medium">Proof</span>
        <ObjectList<CaseStudy & Record<string, string | undefined>> items={p.case_studies as (CaseStudy & Record<string, string | undefined>)[]}
          onChange={(v) => set('case_studies', v)} addLabel="Add a case" empty="No proof yet. One real result with a number beats three vague ones."
          fields={[{ key: 'company', label: 'Company', placeholder: 'Real name, or “a 300-person plastics maker in NRW”' },
                   { key: 'challenge', label: 'Challenge', placeholder: 'What was wrong' },
                   { key: 'result', label: 'Result', placeholder: 'What changed — with a number' }]} /></div>
      <div className="space-y-1"><span className="text-xs font-medium">Something useful we can give</span>
        <ObjectList<ValueGive & Record<string, string | undefined>> items={p.value_gives as (ValueGive & Record<string, string | undefined>)[]}
          onChange={(v) => set('value_gives', v)} addLabel="Add a free resource" empty="A checklist, a benchmark, a teardown — a reason to reply instead of a meeting ask."
          fields={[{ key: 'title', label: 'Title', placeholder: 'The 1-page automation readiness checklist' },
                   { key: 'description', label: 'Description', placeholder: 'What they get' },
                   { key: 'url', label: 'Link', placeholder: 'https://… (with a link the reply can include it; without, you get a task to send it)' }]} /></div>
      <div className="space-y-1"><span className="text-xs font-medium">Objection answers</span>
        <ObjectList<Objection & Record<string, string | undefined>> items={p.objections as (Objection & Record<string, string | undefined>)[]}
          onChange={(v) => set('objections', v)} addLabel="Add an objection" empty="Used only when drafting a reply to someone who pushes back."
          fields={[{ key: 'objection', label: 'Objection', placeholder: '“We have no budget this year”' },
                   { key: 'answer', label: 'Answer', placeholder: 'How we answer it', multiline: true }]} /></div>
      {err && <div className="text-xs" style={{ color: 'var(--red)' }}>{err}</div>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy || !p.name.trim()} className="z-btn !min-h-0 !py-2 text-xs">{busy ? 'Saving…' : 'Save product'}</button>
        <button onClick={onDone} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}>Cancel</button>
        {product && <button onClick={archive} className="ml-auto text-xs underline" style={{ color: 'var(--text-muted)' }}>Archive</button>}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ Competitors */

export function CompetitorsTab({ data, reload }: { data: BrandPayload; reload: () => void }) {
  const [form, setForm] = useState<Partial<Competitor> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!form?.name?.trim()) return;
    const out = await api(`/api/brand/${data.brand.key}`, { method: 'POST', body: { type: 'competitor', item: form } });
    if (out.error) { setErr(out.error); return; }
    setForm(null); setErr(null); reload();
  };
  const archive = async (id: string) => {
    await api(`/api/brand/${data.brand.key}`, { method: 'POST', body: { action: 'archive', type: 'competitor', id } });
    reload();
  };
  return (
    <div className="space-y-4">
      <Help>Used when a prospect names one — never in a cold opener. People who work at a listed competitor are never treated as prospects.</Help>
      {data.competitors.length === 0 && !form && <Help>No competitors yet.</Help>}
      {data.competitors.map((c) => (
        <div key={c.id} className="z-card p-4 flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="text-sm font-semibold">{c.name}{c.domain ? <span className="font-normal text-xs" style={{ color: 'var(--text-muted)' }}> · {c.domain}</span> : null}</h3>
            {c.differentiation ? <p className="text-sm whitespace-pre-wrap">{c.differentiation}</p> : <Help>No positioning written yet.</Help>}</div>
          <span className="flex gap-2 text-xs shrink-0">
            <button onClick={() => setForm(c)} className="underline" style={{ color: 'var(--text-muted)' }}>Edit</button>
            <button onClick={() => archive(c.id)} className="underline" style={{ color: 'var(--text-muted)' }}>Archive</button>
          </span>
        </div>
      ))}
      {form ? (
        <Section title={form.id ? `Edit ${form.name}` : 'New competitor'}>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="z-input" placeholder="Name" aria-label="Name" />
            <input value={form.domain ?? ''} onChange={(e) => setForm({ ...form, domain: e.target.value })} className="z-input" placeholder="domain.com (optional)" aria-label="Domain" />
          </div>
          <textarea value={form.differentiation ?? ''} onChange={(e) => setForm({ ...form, differentiation: e.target.value })} rows={3} className="z-input"
            placeholder="Where we win, and where we would honestly concede." aria-label="How we differ" />
          {err && <div className="text-xs" style={{ color: 'var(--red)' }}>{err}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={!form.name?.trim()} className="z-btn !min-h-0 !py-2 text-xs">Save</button>
            <button onClick={() => setForm(null)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}>Cancel</button>
          </div>
        </Section>
      ) : <button onClick={() => setForm({})} className="z-btn !min-h-0 !py-2 text-xs">+ New competitor</button>}
    </div>
  );
}

/* ------------------------------------------------------------------ Templates */

export function TemplatesTab({ data, reload }: { data: BrandPayload; reload: () => void }) {
  const [form, setForm] = useState<Partial<MessageTemplate> & { personal?: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!form?.name?.trim() || !form.body?.trim()) return;
    const { personal, ...item } = form;
    const out = await api(`/api/brand/${data.brand.key}`, { method: 'POST', body: { type: 'template', item: { channels: ['linkedin'], step: 'first', kind: 'guided', ...item }, personal } });
    if (out.error) { setErr(out.error); return; }
    setForm(null); setErr(null); reload();
  };
  const archive = async (id: string) => {
    await api(`/api/brand/${data.brand.key}`, { method: 'POST', body: { action: 'archive', type: 'template', id } });
    reload();
  };
  return (
    <div className="space-y-4">
      <Help><b>Guided</b> = instructions the writer follows for each person (the angle, the hook, the ask). <b>Fixed</b> = the exact text, with {'{first_name}'} and {'{company}'} filled in, never rewritten — and skipped for anyone a placeholder has no value for.</Help>
      {data.templates.length === 0 && !form && <Help>No templates yet.</Help>}
      {data.templates.map((t) => (
        <div key={t.id} className="z-card p-4 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold">{t.name}
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-normal" style={{ background: 'var(--bg-input)' }}>{t.kind === 'fixed' ? 'Fixed' : 'Guided'}</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-normal" style={{ background: 'var(--bg-input)' }}>{STEPS.find((s) => s.key === t.step)?.label ?? t.step} · {t.channels.join('/')}</span>
              {t.owner_user_id && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-normal" style={{ background: 'var(--bg-input)' }}>only you</span>}
            </h3>
            <span className="flex gap-2 text-xs shrink-0">
              <button onClick={() => setForm(t)} className="underline" style={{ color: 'var(--text-muted)' }}>Edit</button>
              <button onClick={() => archive(t.id)} className="underline" style={{ color: 'var(--text-muted)' }}>Archive</button>
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>{t.body}</p>
        </div>
      ))}
      {form ? (
        <Section title={form.id ? `Edit ${form.name}` : 'New template'}>
          <input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="z-input" placeholder="Name, e.g. After a trade fair" aria-label="Name" />
          <div className="flex flex-wrap gap-2">
            <select value={form.kind ?? 'guided'} onChange={(e) => setForm({ ...form, kind: e.target.value as 'guided' | 'fixed' })} className="z-input !w-auto" aria-label="Kind">
              <option value="guided">Guided — instructions</option><option value="fixed">Fixed — exact text</option>
            </select>
            <select value={form.step ?? 'first'} onChange={(e) => setForm({ ...form, step: e.target.value as MessageTemplate['step'] })} className="z-input !w-auto" aria-label="Step">
              {STEPS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select value={(form.channels ?? ['linkedin'])[0]} onChange={(e) => setForm({ ...form, channels: [e.target.value] })} className="z-input !w-auto" aria-label="Channel">
              <option value="linkedin">LinkedIn</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option>
            </select>
            {!form.id && <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={!!form.personal} onChange={(e) => setForm({ ...form, personal: e.target.checked })} /> only for me</label>}
          </div>
          <textarea value={form.body ?? ''} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={5} className="z-input" aria-label="Template text"
            placeholder={form.kind === 'fixed' ? 'Guten Tag {first_name}, …' : 'Open with where we met. Offer the readiness checklist. End with one easy question. No meeting ask.'} />
          {err && <div className="text-xs" style={{ color: 'var(--red)' }}>{err}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={!form.name?.trim() || !form.body?.trim()} className="z-btn !min-h-0 !py-2 text-xs">Save</button>
            <button onClick={() => setForm(null)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}>Cancel</button>
          </div>
        </Section>
      ) : <button onClick={() => setForm({ kind: 'guided', step: 'first', channels: ['linkedin'] })} className="z-btn !min-h-0 !py-2 text-xs">+ New template</button>}
    </div>
  );
}
