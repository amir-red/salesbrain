'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PageHeader from '@/components/panel/PageHeader';
import ConversationList from '@/components/inbox/ConversationList';
import ConversationView from '@/components/inbox/ConversationView';
import type { InboxChannel, InboxCounts, InboxFilter, InboxItem, InboxThread } from '@/lib/inbox';

/**
 * /inbox — every outreach conversation in one place: replies to campaign and wave emails, and LinkedIn conversations
 * with leads. Answer from here; the reply goes out from the owner's own LinkedIn or Gmail through the send gate.
 * The selected conversation lives in the URL (?c=linkedin:<id>), so a link opens it.
 */
export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState<'all' | InboxChannel>('all');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [view, setView] = useState<'outreach' | 'all'>('outreach');
  const [admin, setAdmin] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<InboxThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const p = new URLSearchParams({ channel, filter, scope, view });
      if (q.trim()) p.set('q', q.trim());
      const res = await fetch(`/api/inbox?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the inbox');
      if (my !== seq.current) return;
      setItems(data.items || []);
      setCounts(data.counts || null);
      setAdmin(!!data.viewer?.admin);
      setError(null);
    } catch (err) {
      if (my === seq.current) setError(err instanceof Error ? err.message : 'Could not load the inbox');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [channel, filter, scope, view, q]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  // New replies arrive by themselves (Gmail push, the hourly LinkedIn sync): look again every minute while visible.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const open = useCallback(async (key: string) => {
    const [ch, id] = key.split(':');
    if ((ch !== 'email' && ch !== 'linkedin') || !id) return;
    setSelected(key);
    setThreadLoading(true);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('c', key);
      window.history.replaceState(null, '', url);
    } catch { /* ignore */ }
    try {
      const res = await fetch(`/api/inbox/${ch}/${id}`);
      const data = await res.json();
      setThread(res.ok ? data.thread : null);
      if (res.ok) setItems((xs) => xs.map((x) => (`${x.channel}:${x.id}` === key ? { ...x, unread: false } : x)));
    } catch {
      setThread(null);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('c');
    if (c) open(c);
  }, [open]);

  const changed = (t: InboxThread | null) => {
    setThread(t);
    load();
  };

  const back = () => {
    setSelected(null); setThread(null);
    try { const url = new URL(window.location.href); url.searchParams.delete('c'); window.history.replaceState(null, '', url); } catch { /* ignore */ }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          title="Inbox"
          subtitle="Replies to your outreach — campaign and wave emails, and LinkedIn conversations with leads."
          actions={
            <>
              <select value={view} onChange={(e) => setView(e.target.value as 'outreach' | 'all')} className="z-input !w-auto text-sm" aria-label="Which LinkedIn chats">
                <option value="outreach">Outreach only</option>
                <option value="all">All LinkedIn chats</option>
              </select>
              {admin && (
                <select value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'team')} className="z-input !w-auto text-sm" aria-label="Whose conversations">
                  <option value="mine">Mine</option>
                  <option value="team">Whole team</option>
                </select>
              )}
            </>
          }
        />
        <div className="flex-1 flex min-h-0">
          <div className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] flex-shrink-0 border-r flex-col min-h-0`} style={{ borderColor: 'var(--border)' }}>
            <ConversationList
              items={items} counts={counts} loading={loading} error={error} selected={selected}
              onSelect={(it) => open(`${it.channel}:${it.id}`)}
              q={q} setQ={setQ} channel={channel} setChannel={setChannel} filter={filter} setFilter={setFilter}
              showOwner={scope === 'team'}
            />
          </div>
          <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col`} style={{ background: 'var(--bg)' }}>
            <ConversationView thread={thread} loading={threadLoading} onBack={back} onChanged={changed} />
          </div>
        </div>
      </div>
    </div>
  );
}
