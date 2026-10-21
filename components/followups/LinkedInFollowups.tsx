'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { dueLabel, formatDate } from '@/lib/time';

/**
 * The LinkedIn follow-up list on /followups: everyone we messaged who has not
 * answered and whose cadence timer is up (GET /api/followups/linkedin). Each row
 * drafts touch N+1 with the model, lets the user edit it, and files it as an
 * approval card — the owner's 👍 on Telegram (or /agents) is what sends it.
 */
export interface LinkedInFollowup {
  id: string;
  owner_user_id: string;
  person_id: string | null;
  touch_count: number;
  last_contacted_at: string | null;
  next_followup_at: string | null;
  linkedin_public_id: string | null;
  full_name: string;
  title: string | null;
  company: string | null;
  icp_name: string | null;
  owner_name: string;
  thread_id: string | null;
  last_sent: { message?: string; sent_at?: string; kind?: string; channel?: string } | null;
  pending: { id: string; message: string; created_at: string } | null;
}
export interface SentFollowup {
  id: string; message: string; sent_at: string; prospect_id: string;
  full_name: string; company: string | null; owner_name: string;
}
export interface LinkedInData {
  items: LinkedInFollowup[]; sent: SentFollowup[]; spacing_days: number[]; max_touches: number; agent_enabled: boolean;
}

function daysAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
}

function profileUrl(slug: string | null): string | null {
  if (!slug) return null;
  return slug.startsWith('http') ? slug : `https://www.linkedin.com/in/${slug}`;
}

export function LinkedInFollowups({ tab, onCounts }: { tab: 'pending' | 'sent'; onCounts: (pending: number, sent: number) => void }) {
  const [data, setData] = useState<LinkedInData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Brand & Voice (079): the stamp each model draft came with — sent back on propose so an edit can be learned from.
  const [stamp, setStamp] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});
  // "Show in English": display-only translations, fetched in one batch and kept per text.
  const [english, setEnglish] = useState<boolean>(() => {
    try { return localStorage.getItem('followups-english') === '1'; } catch { return false; }
  });
  const [tr, setTr] = useState<Record<string, string>>({});
  const [trBusy, setTrBusy] = useState(false);
  const [trError, setTrError] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem('followups-english', english ? '1' : '0'); } catch { /* private window */ }
  }, [english]);

  useEffect(() => {
    if (!english || !data) return;
    const texts = new Set<string>();
    for (const it of data.items) {
      if (it.last_sent?.message) texts.add(it.last_sent.message);
      if (it.pending?.message) texts.add(it.pending.message);
    }
    for (const s of data.sent) if (s.message) texts.add(s.message);
    for (const d of Object.values(draft)) if (d?.trim()) texts.add(d);
    const missing = Array.from(texts).filter((t) => tr[t] === undefined).slice(0, 40);
    if (!missing.length) return;
    let cancelled = false;
    setTrBusy(true);
    setTrError(null);
    fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: missing }) })
      .then(async (res) => {
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || 'Translation failed');
        if (cancelled) return;
        setTr((m) => { const c = { ...m }; missing.forEach((t, i) => { c[t] = out.translations[i] ?? t; }); return c; });
      })
      .catch((err) => { if (!cancelled) setTrError(err instanceof Error ? err.message : 'Translation failed'); })
      .finally(() => { if (!cancelled) setTrBusy(false); });
    return () => { cancelled = true; };
  }, [english, data, draft, tr]);

  const show = (text: string | null | undefined): string => {
    if (!text) return '';
    return english ? (tr[text] ?? text) : text;
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/followups/linkedin');
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
      const d = (await res.json()) as LinkedInData;
      setData(d);
      onCounts(d.items.length, d.sent.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [onCounts]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: 'draft' | 'propose' | 'skip') {
    setBusy(id);
    setNotice((n) => ({ ...n, [id]: '' }));
    try {
      const res = await fetch(`/api/prospects/${id}/followup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, message: action === 'propose' ? draft[id] : undefined,
          voice: action === 'propose' ? stamp[id] : undefined }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Failed');
      if (action === 'draft') {
        setDraft((d) => ({ ...d, [id]: out.message }));
        setStamp((v) => ({ ...v, [id]: out.voice }));
        if (Array.isArray(out.flags) && out.flags.length) {
          setNotice((n) => ({ ...n, [id]: `Check before filing: ${out.flags.map((f: { detail: string }) => f.detail).join(' · ')}` }));
        }
      }
      if (action === 'propose') {
        setDraft((d) => { const c = { ...d }; delete c[id]; return c; });
        setNotice((n) => ({ ...n, [id]: `Draft filed — ${out.acted_as?.name || 'the owner'} approves it on Telegram or /agents.` }));
        await load();
      }
      if (action === 'skip') await load();
    } catch (err) {
      setNotice((n) => ({ ...n, [id]: err instanceof Error ? err.message : 'Failed' }));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="text-sm mb-4" style={{ color: 'var(--red)' }}>{error}</p>;
  if (!data) return null;

  if (tab === 'sent') {
    if (data.sent.length === 0) return null;
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>LinkedIn follow-ups sent</h3>
          <EnglishToggle english={english} setEnglish={setEnglish} busy={trBusy} error={trError} />
        </div>
        {data.sent.map((s) => (
          <div key={s.id} className="p-3 rounded-lg mb-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Link href={`/prospects/${s.prospect_id}`} className="text-sm font-medium hover:underline">{s.full_name}</Link>
              {s.company && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {s.company}</span>}
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>by {s.owner_name} · {formatDate(s.sent_at)}</span>
            </div>
            <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>{show(s.message)}</p>
          </div>
        ))}
      </div>
    );
  }

  if (data.items.length === 0) return null;

  // Group by due label like the deal follow-ups; drafts awaiting approval first.
  const grouped = new Map<string, LinkedInFollowup[]>();
  for (const it of data.items) {
    const label = it.pending ? 'Awaiting approval' : it.next_followup_at ? dueLabel(it.next_followup_at) : 'No date';
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)!.push(it);
  }

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          LinkedIn follow-ups · {data.items.length}
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            cadence {data.spacing_days.join(' / ')} days, max {data.max_touches} touches · a draft is sent only after the owner approves it
          </span>
          <EnglishToggle english={english} setEnglish={setEnglish} busy={trBusy} error={trError} />
        </div>
      </div>
      {Array.from(grouped.entries()).map(([label, items]) => (
        <div key={label} className="mb-4">
          <p className="text-[11px] font-medium mb-1.5" style={{ color: label === 'Overdue' ? 'var(--red)' : 'var(--text-muted)' }}>{label}</p>
          {items.map((it) => {
            const url = profileUrl(it.linkedin_public_id);
            const isBusy = busy === it.id;
            return (
              <div key={it.id} className="p-3 rounded-lg mb-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: '3px solid var(--cat-blue, var(--accent))' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/prospects/${it.id}`} className="text-sm font-medium hover:underline">{it.full_name}</Link>
                      {it.title && <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{it.title}</span>}
                      {it.company && <span className="text-xs" style={{ color: 'var(--text)' }}>· {it.company}</span>}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: 'color-mix(in srgb, var(--yellow) 14%, transparent)', color: 'var(--yellow)' }}>
                        touch {it.touch_count} of {data.max_touches}
                      </span>
                      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] hover:underline" style={{ color: 'var(--accent)' }}>LinkedIn ↗</a>}
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {it.owner_name}&apos;s lead{it.icp_name ? ` · ${it.icp_name}` : ''}
                      {it.last_sent?.sent_at && ` · last message ${daysAgo(it.last_sent.sent_at)}`}
                      {!it.thread_id && ' · no LinkedIn thread on file'}
                    </p>
                    {it.last_sent?.message && (
                      <p className="text-xs mt-1.5 whitespace-pre-wrap line-clamp-3" style={{ color: 'var(--text-muted)' }}>
                        <span className="font-medium">We wrote:</span> {show(it.last_sent.message)}
                      </p>
                    )}
                    {it.pending && (
                      <div className="mt-2 rounded p-2 text-xs" style={{ background: 'color-mix(in srgb, var(--yellow) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--yellow) 30%, transparent)' }}>
                        <span className="font-medium" style={{ color: 'var(--yellow)' }}>Draft awaiting the owner&apos;s approval</span>
                        <span style={{ color: 'var(--text-muted)' }}> — on Telegram or <Link href="/agents" className="underline">/agents</Link></span>
                        <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--text)' }}>{show(it.pending.message)}</p>
                      </div>
                    )}
                    {draft[it.id] !== undefined && !it.pending && (
                      <div className="mt-2">
                        <textarea
                          value={draft[it.id]}
                          onChange={(e) => setDraft((d) => ({ ...d, [it.id]: e.target.value }))}
                          rows={4}
                          className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        />
                        {english && tr[draft[it.id]] && (
                          <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>
                            <span className="font-medium">In English:</span> {tr[draft[it.id]]}
                          </p>
                        )}
                        <div className="flex gap-2 mt-1.5">
                          <button onClick={() => act(it.id, 'propose')} disabled={isBusy || !draft[it.id]?.trim()}
                                  className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                            {isBusy ? '…' : 'Queue for approval'}
                          </button>
                          <button onClick={() => act(it.id, 'draft')} disabled={isBusy}
                                  className="px-3 py-1.5 rounded text-xs disabled:opacity-50"
                                  style={{ color: 'var(--text)', border: '1px solid var(--border)' }}>
                            Redraft
                          </button>
                          <button onClick={() => setDraft((d) => { const c = { ...d }; delete c[it.id]; return c; })}
                                  className="px-3 py-1.5 rounded text-xs" style={{ color: 'var(--text-muted)' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {notice[it.id] && <p className="text-xs mt-1.5" style={{ color: notice[it.id].startsWith('Draft filed') ? 'var(--green)' : 'var(--red)' }}>{notice[it.id]}</p>}
                  </div>
                  {!it.pending && draft[it.id] === undefined && (
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <button onClick={() => act(it.id, 'draft')} disabled={isBusy || !it.thread_id}
                              title={it.thread_id ? '' : 'No LinkedIn conversation on file for this person'}
                              className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                        {isBusy ? '…' : 'Draft follow-up'}
                      </button>
                      <button onClick={() => act(it.id, 'skip')} disabled={isBusy}
                              className="px-3 py-1.5 rounded text-xs disabled:opacity-50"
                              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                        Skip
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}


function EnglishToggle({ english, setEnglish, busy, error }: { english: boolean; setEnglish: (v: boolean) => void; busy: boolean; error: string | null }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none" style={{ color: error ? 'var(--red)' : 'var(--text-muted)' }} title={error || 'Translate the messages for display; what gets sent stays in the original language'}>
      <input type="checkbox" checked={english} onChange={(e) => setEnglish(e.target.checked)} className="accent-[var(--accent)]" />
      Show in English{busy ? '…' : ''}{error ? ' (failed)' : ''}
    </label>
  );
}
