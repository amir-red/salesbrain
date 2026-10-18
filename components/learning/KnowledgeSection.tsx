'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SectionCard from '@/components/panel/SectionCard';

/**
 * The bot's knowledge base (core 072): short entries it reads before answering — what things mean, what each
 * automatic message is, which tool answers which question. New entries from chat or the nightly review are live at
 * once, so this is where they are read, corrected or archived. `mode="personal"` (on /profile) shows only the
 * viewer's own entries; `mode="all"` (on /admin/learning) shows everything with authors.
 */
type Entry = {
  id: string; scope: 'team' | 'personal'; kind: string; title: string; keywords: string; body: string;
  tool_hint: string | null; source: string; hits: number; last_hit_at: string | null; updated_at: string;
  author?: string | null; owner_name?: string | null;
};

const KIND_LABEL: Record<string, string> = { concept: 'concept', message: 'message', phrase: 'phrase', procedure: 'how-to' };
const SOURCE_LABEL: Record<string, string> = { seed: 'starter', chat: 'learned in chat', review: 'nightly review', app: 'added here' };

export default function KnowledgeSection({ mode = 'all' }: { mode?: 'all' | 'personal' }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Entry> & { replaces?: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/knowledge${mode === 'personal' ? '?scope=personal' : ''}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || `Failed (${res.status})`);
      setEntries(json.entries || []);
      setAdmin(Boolean(json.viewer_is_admin));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => !needle || `${e.title} ${e.keywords} ${e.body} ${e.tool_hint || ''}`.toLowerCase().includes(needle));
  }, [entries, q]);

  const post = async (payload: Record<string, unknown>, key: string, ok: string) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fetch('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || `Failed (${res.status})`);
      setNotice(ok);
      setEditing(null);
      await load();
    } catch (e) {
      setNotice(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  };

  const save = () => {
    if (!editing) return;
    const renamed = editing.replaces && editing.title !== entries.find((e) => e.id === editing.replaces)?.title;
    post({ action: 'save', title: editing.title, body: editing.body, keywords: editing.keywords, kind: editing.kind,
           scope: editing.scope, tool_hint: editing.tool_hint, ...(renamed ? { replaces: editing.replaces } : {}) },
         'save', `Saved "${editing.title}". It is used from the next message on.`);
  };

  const teamCount = entries.filter((e) => e.scope === 'team').length;
  return (
    <SectionCard
      title={mode === 'personal' ? 'What the bot learned about how you ask' : 'Knowledge base'}
      subtitle={mode === 'personal'
        ? 'Your own entries: how you phrase things and what you mean. Only your conversations use them.'
        : 'Short entries the bot reads before answering. The best 3 for each message are put into that turn. New ones from chat or the nightly review are live at once.'}
      right={<span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{mode === 'personal' ? `${entries.length} entries` : `${teamCount} team · ${entries.length - teamCount} personal`}</span>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, words, tool…"
                 className="z-input text-xs flex-1 min-w-[180px] rounded-lg px-3 py-1.5" style={{ border: '1px solid var(--border)', background: 'var(--bg-input)' }} />
          <button onClick={() => setEditing({ title: '', body: '', keywords: '', kind: 'phrase', scope: mode === 'personal' || !admin ? 'personal' : 'team', tool_hint: '' })}
                  className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Add entry</button>
        </div>
        {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
        {notice && <p className="text-xs" style={{ color: notice.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>{notice}</p>}

        {editing && (
          <div className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--accent)', background: 'var(--bg-input)' }}>
            <input value={editing.title || ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Title (what someone would ask about)"
                   className="w-full text-xs rounded px-2 py-1" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} />
            <textarea value={editing.body || ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={3} maxLength={800}
                      placeholder="What it means and what to do (max 800 characters)" className="w-full text-xs rounded px-2 py-1" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} />
            <div className="flex flex-wrap gap-2">
              <input value={editing.keywords || ''} onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} placeholder="keywords, comma separated"
                     className="flex-1 min-w-[160px] text-xs rounded px-2 py-1" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} />
              <input value={editing.tool_hint || ''} onChange={(e) => setEditing({ ...editing, tool_hint: e.target.value })} placeholder="tool that answers it (optional)"
                     className="w-56 text-xs font-mono rounded px-2 py-1" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} />
              <select value={editing.kind || 'phrase'} onChange={(e) => setEditing({ ...editing, kind: e.target.value })} className="text-xs rounded px-2 py-1" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {admin && mode === 'all' && (
                <select value={editing.scope || 'team'} onChange={(e) => setEditing({ ...editing, scope: e.target.value as Entry['scope'] })} className="text-xs rounded px-2 py-1" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  <option value="team">everyone</option><option value="personal">only me</option>
                </select>
              )}
            </div>
            <div className="flex gap-2">
              <button disabled={busy === 'save'} onClick={save} className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Save</button>
              <button onClick={() => setEditing(null)} className="rounded-full px-3 py-1 text-xs" style={{ border: '1px solid var(--border)' }}>Cancel</button>
            </div>
          </div>
        )}

        {shown.length === 0 && !error && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{entries.length ? 'Nothing matches.' : 'No entries yet.'}</p>}
        <ul className="space-y-1.5">
          {shown.map((e) => {
            const mayEdit = admin || e.scope === 'personal';
            return (
              <li key={e.id} className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid var(--border)' }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="rounded-full px-2 py-0.5 mr-2 text-[10px] uppercase tracking-wide" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>{KIND_LABEL[e.kind] || e.kind}</span>
                    <span className="font-semibold">{e.title}</span>
                    {e.tool_hint && <span className="ml-2 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>→ {e.tool_hint}</span>}
                  </div>
                  {mayEdit && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setEditing({ ...e, replaces: e.id })} className="text-[11px] underline">edit</button>
                      <button disabled={busy === e.id} onClick={() => post({ action: 'archive', id: e.id }, e.id, `Archived "${e.title}".`)} className="text-[11px] underline" style={{ color: 'var(--red)' }}>archive</button>
                    </div>
                  )}
                </div>
                <p className="mt-1">{e.body}</p>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {e.scope === 'personal' ? `personal${e.owner_name ? ` · ${e.owner_name}` : ''}` : 'everyone'} · {SOURCE_LABEL[e.source] || e.source}
                  {e.author ? ` · by ${e.author}` : ''} · used {e.hits}×{e.last_hit_at ? `, last ${new Date(e.last_hit_at).toLocaleDateString()}` : ''}
                  {e.keywords ? ` · words: ${e.keywords}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionCard>
  );
}
