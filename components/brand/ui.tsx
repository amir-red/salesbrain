'use client';

import { useState, type ReactNode } from 'react';

/** Small building blocks for /brand — one look for every tab. */

export function Help({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-snug" style={{ color: 'var(--text-muted)' }}>{children}</p>;
}

export function AiBadge() {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      title="Filled by “Draft from website”. Edit it to make it yours.">AI-drafted</span>
  );
}

export function Section({ title, help, children, aside }: { title: string; help?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="z-panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {help && <Help>{help}</Help>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A field that shows its value and saves on its own: Edit → Save / Cancel. */
export function TextTile({ label, help, value, placeholder, multiline = true, aiDrafted, onSave }: {
  label: string; help: ReactNode; value: string | null; placeholder: string; multiline?: boolean; aiDrafted?: boolean;
  onSave: (v: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    const e = await onSave(draft.trim());
    setBusy(false);
    if (e) setErr(e); else setEditing(false);
  };
  return (
    <div className="z-panel p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{label}</h3>{aiDrafted && <AiBadge />}</div>
        {!editing && <button onClick={() => { setDraft(value ?? ''); setEditing(true); }} className="text-xs underline" style={{ color: 'var(--text-muted)' }}>Edit</button>}
      </div>
      {editing ? (
        <div className="space-y-2">
          {multiline
            ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} className="z-input" placeholder={placeholder} aria-label={label} />
            : <input value={draft} onChange={(e) => setDraft(e.target.value)} className="z-input" placeholder={placeholder} aria-label={label} />}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}>Cancel</button>
          </div>
          {err && <div className="text-xs" style={{ color: 'var(--red)' }}>{err}</div>}
        </div>
      ) : value ? (
        <p className="text-sm whitespace-pre-wrap">{value}</p>
      ) : (
        <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>{placeholder}</p>
      )}
      <Help>{help}</Help>
    </div>
  );
}

/** Chips typed with Enter or a comma (never-write phrases). */
export function ChipInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const parts = text.split(',').map((t) => t.trim()).filter(Boolean);
    if (parts.length) onChange([...values, ...parts.filter((p) => !values.some((v) => v.toLowerCase() === p.toLowerCase()))]);
    setText('');
  };
  return (
    <div className="flex flex-wrap gap-1.5 items-center rounded-xl p-2" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
      {values.map((v) => (
        <span key={v} className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'var(--bg-input)' }}>
          “{v}”
          <button onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} style={{ color: 'var(--text-muted)' }}>×</button>
        </span>
      ))}
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Add a phrase"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} onBlur={add}
        className="flex-1 min-w-[10rem] text-sm bg-transparent outline-none px-1 py-0.5" style={{ color: 'var(--text)' }} />
    </div>
  );
}

/** Edit a list of small objects (case studies, free resources, objections). */
export function ObjectList<T extends Record<string, string | undefined>>({ items, fields, empty, onChange, addLabel }: {
  items: T[]; fields: { key: keyof T & string; label: string; placeholder: string; multiline?: boolean }[];
  empty: string; addLabel: string; onChange: (items: T[]) => void;
}) {
  const set = (i: number, k: string, v: string) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  return (
    <div className="space-y-2">
      {items.length === 0 && <Help>{empty}</Help>}
      {items.map((it, i) => (
        <div key={i} className="rounded-xl p-3 space-y-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          {fields.map((f) => f.multiline
            ? <textarea key={f.key} value={it[f.key] ?? ''} onChange={(e) => set(i, f.key, e.target.value)} placeholder={f.placeholder} aria-label={f.label} rows={2} className="z-input" />
            : <input key={f.key} value={it[f.key] ?? ''} onChange={(e) => set(i, f.key, e.target.value)} placeholder={f.placeholder} aria-label={f.label} className="z-input" />)}
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-xs underline" style={{ color: 'var(--text-muted)' }}>Remove</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, {} as T])} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px dashed var(--border)' }}>+ {addLabel}</button>
    </div>
  );
}

export async function api<T = Record<string, unknown>>(url: string, init?: { method?: string; body?: unknown }): Promise<T & { error?: string }> {
  try {
    const r = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const out = await r.json();
    if (!r.ok && !out.error) out.error = `Request failed (${r.status})`;
    return out;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) } as T & { error?: string };
  }
}
