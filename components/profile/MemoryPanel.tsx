'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Memory, MemoryKind, MemoryScope } from '@/lib/memory-panel';
import { SOURCE_LABELS, statusLabel } from '@/lib/memory-panel';

/**
 * /profile → Memory: what the agents remember about ME (per-person notes the
 * bots inject into my turns on every surface) and the team's shared notes.
 * Forget supersedes; Share proposes a team copy an admin approves.
 */
export default function MemoryPanel() {
  const [rows, setRows] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<MemoryScope>('personal');
  const [kind, setKind] = useState<MemoryKind>('fact');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/memory');
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load memory');
      setRows(json.memories as Memory[]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    if (!draft.trim()) return;
    setBusy('save');
    setNotice(null);
    try {
      const res = await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim(), scope, kind }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || 'Save failed');
      setNotice(json.message || 'saved');
      setDraft('');
      await load();
    } catch (e) { setNotice(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  }, [draft, scope, kind, load]);

  const act = useCallback(async (id: string, action: 'forget' | 'share') => {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/memory/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || `${action} failed`);
      setNotice(json.message || action);
      await load();
    } catch (e) { setNotice(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  }, [load]);

  const personal = (rows || []).filter((m) => m.scope === 'personal' && m.status === 'active');
  const team = (rows || []).filter((m) => m.scope === 'team' && m.status === 'active');
  const pending = (rows || []).filter((m) => m.scope === 'team' && m.status === 'proposed');
  const forgotten = (rows || []).filter((m) => m.status === 'superseded' || m.status === 'archived');

  return (
    <div className="space-y-5 max-w-3xl">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        What the agents remember about you. These notes sit at the top of every conversation you have with the bots
        (Telegram and web chat), and only yours. Say &ldquo;remember that …&rdquo; in chat, or add one here. Every 8 turns the
        assistant also reviews the conversation and may add a note by itself (marked <em>learned from a conversation</em>) —
        forget anything that is wrong. Secrets and pay data are refused.
      </p>
      {error && <Note tone="red">{error}</Note>}
      {notice && <Note tone={notice.startsWith('Error') ? 'red' : 'green'}>{notice}</Note>}

      <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-semibold">Add a note</div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={300} rows={2}
                  placeholder="e.g. I prefer replies in German; always one batch call instead of a loop"
                  className="w-full rounded-lg p-2 text-sm" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className="rounded-md px-2 py-1" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="fact">fact</option><option value="preference">preference</option><option value="rule">rule</option><option value="procedure">procedure</option>
          </select>
          <select value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)} className="rounded-md px-2 py-1" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="personal">only me</option><option value="team">propose to the team</option>
          </select>
          <button onClick={save} disabled={busy === 'save' || !draft.trim()} className="rounded-full px-3 py-1 font-semibold"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)', opacity: busy === 'save' || !draft.trim() ? 0.6 : 1 }}>
            {busy === 'save' ? '…' : 'Save'}
          </button>
          <span style={{ color: 'var(--text-muted)' }}>{draft.length}/300</span>
        </div>
      </div>

      <Section title={`Your notes (${personal.length})`} empty="Nothing yet. Tell the bot what to remember, or add a note above.">
        {personal.map((m) => <Row key={m.id} m={m} busy={busy === m.id} onForget={() => act(m.id, 'forget')} onShare={() => act(m.id, 'share')} />)}
      </Section>
      {pending.length > 0 && (
        <Section title={`Proposed to the team (${pending.length})`} empty="">
          {pending.map((m) => <Row key={m.id} m={m} busy={busy === m.id} onForget={() => act(m.id, 'forget')} />)}
        </Section>
      )}
      <Section title={`Team notes (${team.length})`} empty="No shared notes yet. Share one of yours, or an admin adds one.">
        {team.map((m) => <Row key={m.id} m={m} busy={busy === m.id} />)}
      </Section>
      {forgotten.length > 0 && (
        <details className="text-xs" style={{ color: 'var(--text-muted)' }}>
          <summary className="cursor-pointer">Forgotten ({forgotten.length})</summary>
          <ul className="mt-1 space-y-0.5 list-disc pl-4">{forgotten.map((m) => <li key={m.id} className="line-through">{m.content}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <div className="text-xs font-semibold mb-1">{title}</div>
      {children.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{empty}</p> : <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function Row({ m, busy, onForget, onShare }: { m: Memory; busy: boolean; onForget?: () => void; onShare?: () => void }) {
  return (
    <div className="rounded-lg px-3 py-2 flex items-start justify-between gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="text-sm min-w-0">
        <span className="rounded-full px-2 py-0.5 mr-2 text-[10px] uppercase tracking-wide" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>{m.kind}</span>
        <span>{m.content}</span>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {SOURCE_LABELS[m.source]} · {new Date(m.created_at).toLocaleDateString()} · {statusLabel(m)}{m.owner_name ? ` · by ${m.owner_name}` : ''}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        {onShare && m.scope === 'personal' && (
          <button disabled={busy} onClick={onShare} className="rounded-full px-2.5 py-1 text-[11px]" style={{ border: '1px solid var(--border)' }}>Share with team</button>
        )}
        {onForget && (
          <button disabled={busy} onClick={onForget} className="rounded-full px-2.5 py-1 text-[11px]" style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{busy ? '…' : 'Forget'}</button>
        )}
      </div>
    </div>
  );
}

function Note({ tone, children }: { tone: 'red' | 'green'; children: React.ReactNode }) {
  const color = tone === 'red' ? 'var(--red)' : 'var(--green)';
  return <div className="rounded-lg px-3 py-2 text-xs" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)` }}>{children}</div>;
}
