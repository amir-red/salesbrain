'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PageHeader from '@/components/panel/PageHeader';
import ConversationList from '@/components/inbox/ConversationList';
import ConversationView from '@/components/inbox/ConversationView';
import AcceptedView, { AcceptedRow } from '@/components/inbox/AcceptedView';
import ComposeView from '@/components/inbox/ComposeView';
import type { AcceptedItem } from '@/lib/inbox-accepted';
import type { InboxChannel, InboxCounts, InboxFilter, InboxItem, InboxThread } from '@/lib/inbox';
import { parseKey } from '@/lib/inbox';

/**
 * /inbox — every outreach conversation in one place: replies to campaign and wave emails, and LinkedIn conversations
 * with leads. Answer from here; the reply goes out from the owner's own LinkedIn or Gmail through the send gate.
 * One row per PERSON across channels (2026-11-09): the selected conversation lives in the URL (?c=person:<id>; a
 * thread key such as linkedin:<id> still opens, landing on the person it belongs to), so a link opens it.
 * ?compose=<prospect id> (2026-11-09, "Write message" on a person page) opens a compose view for a first message from
 * the viewer's own account.
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
  // Everything by default (2026-11-06): "With people in the CRM" hid the newest LinkedIn chats with people not (yet) in
  // the CRM, so the top of the list looked stale. The choice is remembered per browser.
  const [view, setViewState] = useState<'outreach' | 'all'>('all');
  useEffect(() => {
    try { const v = localStorage.getItem('inbox.view'); if (v === 'outreach' || v === 'all') setViewState(v); } catch { /* ignore */ }
  }, []);
  const setView = (v: 'outreach' | 'all') => { setViewState(v); try { localStorage.setItem('inbox.view', v); } catch { /* ignore */ } };
  const [mailbox, setMailbox] = useState('');
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [admin, setAdmin] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<InboxThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const seq = useRef(0);
  // The "Accepted" tab (2026-11-06): LinkedIn connection requests accepted, with the first message to send.
  const [accepted, setAccepted] = useState(false);
  const [compose, setCompose] = useState<string | null>(null);   // a prospect id: writing a first message
  const [acc, setAcc] = useState<AcceptedItem[]>([]);
  const [accWaiting, setAccWaiting] = useState(0);
  const [accLoading, setAccLoading] = useState(false);
  const [accError, setAccError] = useState<string | null>(null);
  const loadAccepted = useCallback(async () => {
    setAccLoading(true);
    try {
      const p = new URLSearchParams({ scope });
      if (q.trim()) p.set('q', q.trim());
      const res = await fetch(`/api/inbox/accepted?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load');
      setAcc(data.items || []); setAccWaiting(data.waiting || 0); setAccError(null);
    } catch (err) {
      setAccError(err instanceof Error ? err.message : 'Could not load');
    } finally { setAccLoading(false); }
  }, [scope, q]);
  useEffect(() => { const t = setTimeout(loadAccepted, q ? 250 : 0); return () => clearTimeout(t); }, [loadAccepted, q]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const p = new URLSearchParams({ channel, filter, scope, view });
      if (q.trim()) p.set('q', q.trim());
      if (mailbox) p.set('mailbox', mailbox);
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
  }, [channel, filter, scope, view, q, mailbox]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  // core 102: a person may connect several Google accounts — then the Inbox can show one mailbox at a time.
  useEffect(() => {
    fetch('/api/integrations/status').then((r) => (r.ok ? r.json() : null))
      .then((d) => setMailboxes(((d?.google_accounts ?? []) as { account_email: string }[]).map((a) => a.account_email)))
      .catch(() => undefined);
  }, []);
  // New replies arrive by themselves (Gmail push, the hourly LinkedIn sync): look again every minute while visible.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') { load(); loadAccepted(); } }, 60_000);
    return () => clearInterval(t);
  }, [load, loadAccepted]);

  const setUrl = (key: string | null) => {
    try {
      const url = new URL(window.location.href);
      if (key) url.searchParams.set('c', key); else url.searchParams.delete('c');
      url.searchParams.delete('compose');
      window.history.replaceState(null, '', url);
    } catch { /* ignore */ }
  };

  const open = useCallback(async (key: string) => {
    const k = parseKey(key);
    if (!k) return;
    setCompose(null);   // opening a conversation closes the compose view (setUrl drops ?compose=)
    if (k.kind === 'accepted') {
      setAccepted(true); setSelected(key); setThread(null); setUrl(key);
      return;
    }
    setAccepted(false);
    setSelected(key);
    setThreadLoading(true);
    setUrl(key);
    try {
      const res = await fetch(k.kind === 'thread' ? `/api/inbox/${k.channel}/${k.id}` : `/api/inbox/person/${encodeURIComponent(key)}`);
      const data = await res.json();
      const t: InboxThread | null = res.ok ? data.thread : null;
      setThread(t);
      if (t) {
        // a thread key lands on the person's conversation: the row and the URL follow its key
        if (t.key && t.key !== key) { setSelected(t.key); setUrl(t.key); }
        const sel = t.key || key;
        setItems((xs) => xs.map((x) => (x.key === sel ? { ...x, unread: false } : x)));
      }
    } catch {
      setThread(null);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const c = sp.get('c');
    const cp = sp.get('compose');
    if (cp && /^[0-9a-f-]{36}$/i.test(cp)) { setCompose(cp); setSelected(`compose:${cp}`); setAccepted(false); setThread(null); return; }
    if (c) open(c);
  }, [open]);

  const changed = (t: InboxThread | null) => {
    setThread(t);
    load();
  };

  const back = () => {
    setSelected(null); setThread(null); setCompose(null); setUrl(null);
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          title="Inbox"
          subtitle="Your conversations — one line per person across email, LinkedIn and chats, and the mail in every Google account you connected."
          actions={
            <>
              <select value={view} onChange={(e) => setView(e.target.value as 'outreach' | 'all')} className="z-input !w-auto text-sm"
                aria-label="Which conversations" title="With people in the CRM, or everything (all mail and all LinkedIn chats)">
                <option value="all">Everything</option>
                <option value="outreach">With people in the CRM</option>
              </select>
              {mailboxes.length > 1 && scope === 'mine' && (
                <select value={mailbox} onChange={(e) => setMailbox(e.target.value)} className="z-input !w-auto text-sm" aria-label="Which mailbox">
                  <option value="">All mailboxes</option>
                  {mailboxes.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
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
              onSelect={(it) => open(it.key)}
              q={q} setQ={setQ} channel={channel} setChannel={(c) => { setAccepted(false); setChannel(c); }} filter={filter} setFilter={setFilter}
              showOwner={scope === 'team'}
              accepted={accepted} acceptedWaiting={accWaiting} onAccepted={() => { setAccepted(true); back(); }}
            >
              {accError && <p className="m-3 text-sm p-3 rounded-lg" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>{accError}</p>}
              {accLoading && !acc.length && <p className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
              {!accLoading && !accError && !acc.length && (
                <div className="px-6 py-16 text-center">
                  <p className="text-sm font-medium">Nobody accepted in the last 30 days.</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>When someone accepts one of your connection requests, they show here with the first message to send.</p>
                </div>
              )}
              {acc.map((it) => (
                <AcceptedRow key={it.id} it={it} active={selected === `accepted:${it.id}`} showOwner={scope === 'team'}
                  onSelect={() => open(`accepted:${it.id}`)} />
              ))}
            </ConversationList>
          </div>
          <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col`} style={{ background: 'var(--bg)' }}>
            {compose
              ? <ComposeView prospectId={compose} onBack={back} onOpen={(key) => { const ch = key.split(':')[0]; if (ch === 'email' || ch === 'linkedin' || ch === 'chat') setChannel(ch); open(key); load(); }} />
              : accepted
              ? <AcceptedView item={acc.find((x) => selected === `accepted:${x.id}`) ?? null} onBack={back}
                  onChanged={() => { loadAccepted(); load(); }}
                  onOpenThread={(tid) => { setChannel('linkedin'); open(`linkedin:${tid}`); }} />
              : <ConversationView thread={thread} loading={threadLoading} onBack={back} onChanged={changed} />}
          </div>
        </div>
      </div>
    </div>
  );
}
