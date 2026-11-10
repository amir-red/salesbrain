'use client';

import { useEffect, useState } from 'react';

/**
 * The sender's priority list, editable where a draft is reviewed (2026-11-10, Mateo's sales experiments: "My priority
 * list, editable"). The drafter reads the sender's rules in this order; ↑ / ↓ moves one, "Add to the top" saves a new
 * rule in the sender's own words as number 1. The next draft follows the new order.
 *
 * A draft shows only the rules that apply to its channel and step, while the order covers ALL the sender's rules
 * (`voice_rules.position`, reorder_rules clears every position it is not given). So a move loads the full list, moves
 * the rule next to its visible neighbour there, and saves the full order — rules not shown keep their places.
 * Only the sender's own list is editable (the kernel reorders the caller's rules).
 */
export interface Priority { id?: string | null; content: string; kind: string }

type Rule = { id: string; content: string; kind: string; status: string };

async function fullOrder(): Promise<Rule[]> {
  const res = await fetch('/api/voice/rules');
  const d = await res.json();
  if (!res.ok || d.error) throw new Error(d.error || 'Could not load your rules');
  return ((d.sender || []) as Rule[]).filter((r) => r.status === 'active');
}

async function saveOrder(ids: string[]): Promise<void> {
  const res = await fetch('/api/voice/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reorder', rule_ids: ids }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(d.error || 'Could not save the order');
}

/** Pure: move `id` before (up) or after (down) `neighbour` inside the full order. */
export function moveNextTo(order: string[], id: string, neighbour: string, dir: 'up' | 'down'): string[] {
  const rest = order.filter((x) => x !== id);
  const at = rest.indexOf(neighbour);
  if (at < 0) return order;
  rest.splice(dir === 'up' ? at : at + 1, 0, id);
  return rest;
}

export default function PriorityList({ items, editable = true, senderFirst, onChange }: {
  items: Priority[]; editable?: boolean; senderFirst: string; onChange?: (items: Priority[]) => void;
}) {
  const [list, setList] = useState<Priority[]>(items);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => { setList(items); setNote(null); }, [items]);   // a new draft brings its own list
  const canEdit = editable && list.every((p) => !!p.id);

  const commit = (next: Priority[], msg: string) => { setList(next); onChange?.(next); setNote({ kind: 'ok', text: msg }); };

  async function move(i: number, dir: 'up' | 'down') {
    const j = dir === 'up' ? i - 1 : i + 1;
    const me = list[i]; const other = list[j];
    if (!me?.id || !other?.id) return;
    setBusy(true); setNote(null);
    try {
      const full = (await fullOrder()).map((r) => r.id);
      await saveOrder(moveNextTo(full, me.id, other.id, dir));
      const next = [...list]; next[i] = other; next[j] = me;
      commit(next, 'Saved. The next draft reads them in this order.');
    } catch (e) { setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  async function addTop() {
    const content = text.trim();
    if (!content) return;
    setBusy(true); setNote(null);
    try {
      const res = await fetch('/api/voice/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, scope: 'sender', kind: 'rule' }) });
      const d = await res.json();
      if (!res.ok || d.error || !d.rule?.id) throw new Error(d.error || 'Could not save the rule');
      const id = String(d.rule.id);
      const full = (await fullOrder()).map((r) => r.id).filter((x) => x !== id);
      await saveOrder([id, ...full]);
      const next = [{ id, content: String(d.rule.content || content), kind: 'rule' }, ...list.filter((p) => p.id !== id)];
      setText(''); setAdding(false);
      commit(next, d.reinforced ? 'You had this rule already — it is number 1 now.' : 'Added as number 1. The next draft follows it first.');
    } catch (e) { setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  const muted = { color: 'var(--text-muted)' } as const;
  const arrow = 'w-6 h-6 rounded-md inline-flex items-center justify-center text-xs disabled:opacity-30 hover:bg-[var(--bg-input)]';
  return (
    <div className="mt-2 space-y-2">
      {list.length ? (
        <ol className="space-y-1">
          {list.map((r, i) => (
            <li key={r.id || i} className="flex items-start gap-2">
              <span className="w-5 shrink-0 text-right tabular-nums pt-0.5" style={muted}>{i + 1}.</span>
              <span className="flex-1 min-w-0 leading-snug pt-0.5">{r.kind === 'never_write' ? `Never write “${r.content}”` : r.content}</span>
              {canEdit && (
                <span className="shrink-0 inline-flex">
                  <button type="button" className={arrow} onClick={() => move(i, 'up')} disabled={busy || i === 0} aria-label={`Move “${r.content}” up`} title="Move up">↑</button>
                  <button type="button" className={arrow} onClick={() => move(i, 'down')} disabled={busy || i === list.length - 1} aria-label={`Move “${r.content}” down`} title="Move down">↓</button>
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : <p style={muted}>No priorities yet — add one, or what you write in the note becomes one.</p>}
      {editable && (adding ? (
        <div className="flex items-start gap-2">
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} autoFocus disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addTop(); } if (e.key === 'Escape') setAdding(false); }}
            placeholder="A rule in your own words, e.g. Offer two concrete time slots" className="z-input flex-1 !py-1 text-xs" aria-label="New priority" />
          <button type="button" onClick={addTop} disabled={busy || !text.trim()} className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Saving…' : 'Add'}</button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs underline pt-1" style={muted}>Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => { setAdding(true); setNote(null); }} className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
          + Add to the top
        </button>
      ))}
      {editable && !canEdit && list.length > 0 && <p className="text-[11px]" style={muted}>Draft again to reorder — this proposal was written before {senderFirst === 'your' ? 'your' : `${senderFirst}'s`} list could be reordered here.</p>}
      {note && <p className="text-[11px]" style={{ color: note.kind === 'error' ? 'var(--red)' : 'var(--green)' }}>{note.text}</p>}
    </div>
  );
}
