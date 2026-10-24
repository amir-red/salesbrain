'use client';

import type { InboxChannel, InboxCounts, InboxFilter, InboxItem } from '@/lib/inbox';
import { initials, shortWhen } from '@/lib/inbox';
import ChannelIcon from './ChannelIcon';

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'unread', label: 'Unread' },
  { key: 'done', label: 'Done' },
];

/** The left column: search, channel and state filters, and one line per conversation. */
export default function ConversationList({
  items, counts, loading, error, selected, onSelect, q, setQ, channel, setChannel, filter, setFilter, showOwner,
}: {
  items: InboxItem[]; counts: InboxCounts | null; loading: boolean; error: string | null;
  selected: string | null; onSelect: (it: InboxItem) => void;
  q: string; setQ: (v: string) => void;
  channel: 'all' | InboxChannel; setChannel: (c: 'all' | InboxChannel) => void;
  filter: InboxFilter; setFilter: (f: InboxFilter) => void;
  showOwner: boolean;
}) {
  const badge = (f: InboxFilter) => (f === 'needs_reply' ? counts?.needs_reply : f === 'unread' ? counts?.unread : undefined);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b flex flex-col gap-2.5" style={{ borderColor: 'var(--border)' }}>
        <label className="relative block">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
          </span>
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, companies, subjects…"
            className="z-input" style={{ paddingLeft: '2rem' }} aria-label="Search conversations"
          />
        </label>
        <div className="flex items-center gap-1.5" role="group" aria-label="Channel">
          {(['all', 'email', 'linkedin'] as const).map((c) => {
            const active = channel === c;
            const n = c === 'email' ? counts?.email : c === 'linkedin' ? counts?.linkedin : undefined;
            return (
              <button key={c} type="button" onClick={() => setChannel(c)} aria-pressed={active}
                title={c === 'all' ? 'All channels' : c === 'email' ? 'Email' : 'LinkedIn'}
                className="h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                style={{ background: active ? 'var(--accent-glow)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-muted)', border: `1px solid ${active ? 'transparent' : 'var(--border)'}` }}>
                {c === 'all' ? 'All' : <ChannelIcon channel={c} size={16} />}
                {n != null && <span className="tabular-nums">{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-xs" role="tablist" aria-label="Show">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const n = badge(f.key);
            return (
              <button key={f.key} type="button" role="tab" aria-selected={active} onClick={() => setFilter(f.key)}
                className="pb-1 inline-flex items-center gap-1 border-b-2"
                style={{ borderColor: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>
                {f.label}
                {!!n && <span className="tabular-nums text-[10px] px-1.5 rounded-full" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {error && <p className="m-3 text-sm p-3 rounded-lg" style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>{error}</p>}
        {loading && !items.length && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-3 py-3 flex gap-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="w-9 h-9 rounded-full animate-pulse" style={{ background: 'var(--bg-input)' }} />
            <div className="flex-1 space-y-1.5"><div className="h-3 w-32 rounded animate-pulse" style={{ background: 'var(--bg-input)' }} /><div className="h-3 w-48 rounded animate-pulse" style={{ background: 'var(--bg-input)' }} /></div>
          </div>
        ))}
        {!loading && !error && !items.length && (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">No conversations here.</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {q || filter !== 'all' || channel !== 'all'
                ? 'Nothing matches these filters.'
                : 'Replies to your outreach land here — emails from campaigns and waves, and your LinkedIn conversations with leads.'}
            </p>
          </div>
        )}
        {items.map((it) => {
          const key = `${it.channel}:${it.id}`;
          const active = selected === key;
          return (
            <button key={key} type="button" onClick={() => onSelect(it)} aria-current={active ? 'true' : undefined}
              className="w-full text-left px-3 py-2.5 flex gap-3 border-b transition-colors hover:bg-[var(--accent-glow)]"
              style={{ borderColor: 'var(--border)', background: active ? 'var(--accent-glow)' : undefined }}>
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{initials(it.name)}</div>
                <span className="absolute -bottom-0.5 -right-0.5 rounded-[5px] p-px" style={{ background: 'var(--bg-card)' }}>
                  <ChannelIcon channel={it.channel} size={13} />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm" style={{ fontWeight: it.unread ? 700 : 500 }}>{it.name || 'Unknown'}</span>
                  <span className="ml-auto text-[11px] flex-shrink-0 tabular-nums" style={{ color: it.unread ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {shortWhen(it.last_message_at)}
                  </span>
                </div>
                <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                  {[it.company, it.channel === 'email' ? it.subject : it.headline].filter(Boolean).join(' · ') || ' '}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="truncate text-xs flex-1" style={{ color: it.unread ? 'var(--text)' : 'var(--text-muted)' }}>
                    {it.last_from_them ? '' : 'You: '}{it.snippet || ''}
                  </p>
                  {it.unread && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} aria-label="unread" />}
                  {!it.unread && it.state === 'needs_reply' && (
                    <span className="text-[10px] flex-shrink-0 px-1.5 rounded-full" style={{ color: 'var(--orange)', background: 'color-mix(in srgb, var(--orange) 14%, transparent)' }}>reply</span>
                  )}
                </div>
                {showOwner && it.owner_name && (
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>on {it.owner_name.split(' ')[0]}&apos;s account</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
