'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import StepInspector from '@/components/campaigns/StepInspector';
import type { StepStats } from '@/components/campaigns/SequenceCanvas';
import { timeUntil } from '@/lib/time';
import {
  ENROLLMENT_STYLE, STATUS_STYLE, nodeLabel,
  type Campaign, type CampaignList, type Graph, type Validation,
} from '@/lib/campaigns';

const SequenceCanvas = dynamic(() => import('@/components/campaigns/SequenceCanvas'), {
  ssr: false, loading: () => <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading the canvas…</div>,
});

/**
 * /campaigns/[id] — one campaign: draw its sequence (Sequence), see who is where (People) and what each step did
 * (Results), and set its goal, lists and product (Settings). Edits to a live campaign are kept as a draft and take
 * effect when it is paused and resumed; the people already in it keep walking the published sequence meanwhile.
 */
type Tab = 'sequence' | 'people' | 'results' | 'settings';
interface Check { ok: boolean; blockers: string[]; warnings: string[]; would_enroll: number }
interface Person {
  id: string; status: string; node_id: string; step_label: string; full_name: string; title: string | null;
  company: string | null; sender_name: string | null; blocked_reason: string | null; exit_reason: string | null;
  due_at: string; entered_node_at: string; draft_status: string | null; card_id: string | null; prospect_id: string;
}
interface Results {
  steps: { node_id: string; type: string; label: string; reached: number; here_now: number; sent: number;
    replied_after: number; reply_rate: number | null; accepted: number }[];
  totals: Record<string, number>; activity: { day: string; sent: number }[];
}
interface TestStep { node: string; type: string; label: string; outcome: string; preview?: string | null }

async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) throw new Error(out.error || `Request failed (${res.status})`);
  return out as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function Alert({ tone = 'red', children }: { tone?: 'red' | 'orange'; children: React.ReactNode }) {
  return <div className="rounded-lg px-3 py-2 text-sm" role={tone === 'red' ? 'alert' : undefined}
    style={{ background: `color-mix(in srgb, var(--${tone}) 10%, transparent)`, color: `var(--${tone})` }}>{children}</div>;
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<Campaign | null>(null);
  const [tab, setTab] = useState<Tab>('sequence');
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [save, setSave] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved');
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Graph | null>(null);

  const load = useCallback(async () => {
    try {
      const out = await api<Campaign>(`/api/campaigns/${id}`);
      setC(out); setGraph(out.editing_graph); setValidation(out.validation); setSave('saved');
      if (out.status !== 'draft') api<Results>(`/api/campaigns/${id}/results`).then(setResults).catch(() => setResults(null));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load the campaign.'); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const flush = useCallback(async () => {
    const g = pending.current;
    if (!g) return;
    pending.current = null; setSave('saving');
    try {
      const out = await api<{ validation: Validation; unpublished: boolean }>(`/api/campaigns/${id}`, json('PATCH', { graph: g }));
      setValidation(out.validation);
      setSave(pending.current ? 'unsaved' : 'saved');
      setC((prev) => (prev ? { ...prev, draft_graph: out.unpublished ? g : null } : prev));
    } catch (err) { setSave('failed'); setError(err instanceof Error ? err.message : 'Could not save the sequence.'); }
  }, [id]);

  const onGraph = useCallback((g: Graph) => {
    setGraph(g); pending.current = g; setSave('unsaved');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 900);
  }, [flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const act = async (action: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    if (timer.current) { clearTimeout(timer.current); await flush(); }
    setBusy(action); setError(null);
    try {
      if (action === 'check') { setCheck(await api<Check>(`/api/campaigns/${id}`, json('POST', { action: 'check' }))); return; }
      await api(`/api/campaigns/${id}`, json('POST', { action }));
      setCheck(null); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not work.'); }
    finally { setBusy(null); }
  };

  const stats = useMemo<Record<string, StepStats> | undefined>(() => (results ? Object.fromEntries(results.steps.map((s) =>
    [s.node_id, { here_now: s.here_now, sent: s.sent, reply_rate: s.reply_rate }])) : undefined), [results]);

  const sel = graph?.nodes.find((n) => n.id === selected) ?? null;
  const problems = (kind: 'blockers' | 'warnings') => (validation?.[kind] ?? []).filter((p) => p.node === selected).map((p) => p.message);
  const st = c ? STATUS_STYLE[c.status] ?? STATUS_STYLE.draft : null;
  const unpublished = !!c && c.status !== 'draft' && c.draft_graph != null;
  const general = (validation?.blockers ?? []).filter((p) => !p.node);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}><Link href="/campaigns" className="underline">Campaigns</Link></div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold truncate">{c?.name ?? 'Campaign'}</h1>
              {st && <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: st.color, background: `color-mix(in srgb, ${st.color} 14%, transparent)` }}>{st.label}</span>}
              {tab === 'sequence' && c?.can_edit && (
                <span className="text-xs" style={{ color: save === 'failed' ? 'var(--red)' : 'var(--text-muted)' }}>
                  {{ saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', failed: 'Not saved' }[save]}
                </span>
              )}
            </div>
          </div>
          {c?.can_edit && (
            <div className="flex items-center gap-2 flex-wrap">
              {tab === 'sequence' && <button type="button" className="text-sm px-3 py-1.5 rounded-full" style={{ border: '1px solid var(--border)' }} onClick={() => setTesting(true)}>Test run</button>}
              {(c.status === 'paused' || c.status === 'draft') && unpublished && (
                <button type="button" className="text-sm px-3 py-1.5 rounded-full" style={{ border: '1px solid var(--border)' }} disabled={busy !== null}
                  onClick={() => act('discard', 'Throw away the edits and go back to the published sequence?')}>Discard edits</button>
              )}
              {c.status !== 'live' && c.status !== 'archived' && (
                <button type="button" className="text-sm px-3 py-1.5 rounded-full" style={{ border: '1px solid var(--border)' }} disabled={busy !== null}
                  onClick={() => act('archive', 'Archive this campaign? Everyone still in it leaves, and waiting drafts are dropped.')}>Archive</button>
              )}
              {c.status === 'live' && (
                <button type="button" className="text-sm px-3 py-1.5 rounded-full" style={{ border: '1px solid var(--border)' }} disabled={busy !== null}
                  onClick={() => act('pause')}>{busy === 'pause' ? 'Pausing…' : 'Pause'}</button>
              )}
              {(c.status === 'draft' || c.status === 'paused') && (
                <button type="button" className="z-btn text-sm" disabled={busy !== null} onClick={() => act('check')}>
                  {busy === 'check' ? 'Checking…' : c.status === 'draft' ? 'Check & launch' : unpublished ? 'Publish & resume' : 'Resume'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-4 border-b flex gap-4 text-sm" role="tablist" style={{ borderColor: 'var(--border)' }}>
          {(['sequence', 'people', 'results', 'settings'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="py-2 capitalize"
              style={{ borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`, color: tab === t ? 'var(--text)' : 'var(--text-muted)' }}>{t}</button>
          ))}
        </div>

        {(error || unpublished || general.length > 0) && (
          <div className="px-4 pt-3 grid gap-2">
            {error && <Alert>{error}</Alert>}
            {unpublished && c?.status === 'live' && <Alert tone="orange">You have edits that are not live yet. People keep walking the published sequence until you pause and resume the campaign.</Alert>}
            {tab === 'sequence' && general.map((g) => <Alert key={g.message} tone="orange">{g.message}</Alert>)}
          </div>
        )}

        <div className="flex-1 min-h-0">
          {!c ? (
            !error && <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : tab === 'sequence' && graph ? (
            <div className="flex h-full min-h-0">
              <div className="flex-1 min-w-0">
                <SequenceCanvas graph={graph} validation={validation} editable={c.can_edit} stats={stats}
                  selected={selected} onSelect={setSelected} onChange={onGraph} />
              </div>
              <aside className="w-80 shrink-0 border-l p-4 overflow-y-auto" style={{ borderColor: 'var(--border)' }} aria-label="Step settings">
                {sel ? (
                  <StepInspector key={sel.id} node={sel} editable={c.can_edit} blockers={problems('blockers')} warnings={problems('warnings')}
                    onChange={(config) => onGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === sel.id ? { ...n, config } : n)) })}
                    onRemove={() => { onGraph({ nodes: graph.nodes.filter((n) => n.id !== sel.id), edges: graph.edges.filter((e) => e.source !== sel.id && e.target !== sel.id) }); setSelected(null); }} />
                ) : (
                  <div className="grid gap-3 text-sm">
                    <div className="z-eyebrow">The sequence</div>
                    <p style={{ color: 'var(--text-muted)' }}>Select a step to change what it does. Every message is drafted in the sender’s voice and waits on one card per step per day for their approval — nothing goes out by itself.</p>
                    <div className="grid gap-1">
                      <div>{validation?.ok ? <span style={{ color: 'var(--green)' }}>✓ Ready to run</span> : <span style={{ color: 'var(--red)' }}>{validation?.blockers.length ?? 0} thing(s) to fix before it can run</span>}</div>
                      {(validation?.warnings.length ?? 0) > 0 && <div style={{ color: 'var(--orange)' }}>{validation!.warnings.length} warning(s)</div>}
                    </div>
                    {(validation?.blockers ?? []).filter((b) => b.node).slice(0, 8).map((b, i) => (
                      <button key={i} type="button" className="text-left text-xs underline" style={{ color: 'var(--red)' }} onClick={() => setSelected(b.node)}>
                        {nodeLabel(graph.nodes.find((n) => n.id === b.node) ?? { type: 'start', config: {} })}: {b.message}
                      </button>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          ) : tab === 'people' ? (
            <PeopleTab id={id} />
          ) : tab === 'results' ? (
            <ResultsTab results={results} draft={c.status === 'draft'} />
          ) : tab === 'settings' ? (
            <SettingsTab c={c} onSaved={load} />
          ) : null}
        </div>
      </div>

      {check && c && (
        <LaunchDialog check={check} status={c.status} busy={busy} onClose={() => setCheck(null)}
          onGo={() => act(c.status === 'draft' ? 'launch' : 'resume')} />
      )}
      {testing && graph && <TestRunDialog id={id} graph={graph} onClose={() => setTesting(false)} />}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'color-mix(in srgb, black 45%, transparent)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="z-card w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 grid gap-3" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-lg leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LaunchDialog({ check, status, busy, onClose, onGo }: { check: Check; status: string; busy: string | null; onClose: () => void; onGo: () => void }) {
  return (
    <Modal title={status === 'draft' ? 'Launch the campaign' : 'Resume the campaign'} onClose={onClose}>
      {check.blockers.length > 0 && (
        <div className="grid gap-1">
          <div className="text-sm font-medium" style={{ color: 'var(--red)' }}>Fix these first</div>
          <ul className="text-sm list-disc pl-5" style={{ color: 'var(--red)' }}>{check.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {check.warnings.length > 0 && (
        <div className="grid gap-1">
          <div className="text-sm font-medium" style={{ color: 'var(--orange)' }}>Worth knowing</div>
          <ul className="text-sm list-disc pl-5" style={{ color: 'var(--orange)' }}>{check.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {check.ok && (
        <p className="text-sm">
          <b>{check.would_enroll}</b> {check.would_enroll === 1 ? 'person joins' : 'people join'} now; anyone added to these lists later joins
          at the next hourly run. Nothing is sent until each sender approves their card.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>Close</button>
        {check.ok && <button type="button" onClick={onGo} disabled={busy !== null} className="z-btn text-sm">{busy ? 'Working…' : status === 'draft' ? 'Launch' : 'Resume'}</button>}
      </div>
    </Modal>
  );
}

function TestRunDialog({ id, graph, onClose }: { id: string; graph: Graph; onClose: () => void }) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [path, setPath] = useState<TestStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    api<{ path: TestStep[] }>(`/api/campaigns/${id}`, json('POST', { action: 'test', choices }))
      .then((o) => { if (!off) setPath(o.path); }).catch((e) => setError(e instanceof Error ? e.message : 'Test run failed.'));
    return () => { off = true; };
  }, [id, choices]);
  const flip = (s: TestStep) => {
    const n = graph.nodes.find((x) => x.id === s.node);
    if (!n || (n.type !== 'wait_for' && n.type !== 'branch')) return;
    const yes = n.type === 'wait_for' ? s.outcome.endsWith(': yes') : s.outcome === 'yes';
    setChoices((m) => ({ ...m, [s.node]: yes ? (n.type === 'wait_for' ? 'timeout' : 'no') : 'yes' }));
  };
  return (
    <Modal title="Test run — Anna Beispiel, Geschäftsführerin at Beispiel GmbH" onClose={onClose}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>A sample person walks the sequence you are editing. Click a wait or an “If” to take the other way. Nothing is drafted or sent.</p>
      {error && <Alert>{error}</Alert>}
      <ol className="grid gap-1.5">
        {(path ?? []).map((s, i) => {
          const clickable = s.type === 'wait_for' || s.type === 'branch';
          return (
            <li key={`${s.node}-${i}`} className="text-sm rounded-lg px-3 py-2" style={{ border: '1px solid var(--border)' }}>
              <div className="flex justify-between gap-2">
                <span className="font-medium">{i + 1}. {s.label}</span>
                {clickable
                  ? <button type="button" className="text-xs underline" onClick={() => flip(s)}>{s.outcome} ↺</button>
                  : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.outcome}</span>}
              </div>
              {s.preview && <div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>{s.preview}</div>}
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}

function PeopleTab({ id }: { id: string }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPeople(null);
    api<{ people: Person[] }>(`/api/campaigns/${id}/people${status ? `?status=${status}` : ''}`)
      .then((o) => setPeople(o.people)).catch((e) => setError(e instanceof Error ? e.message : 'Could not load people.'));
  }, [id, status]);
  return (
    <div className="p-4 grid gap-3 overflow-y-auto h-full content-start">
      <div className="flex items-center gap-2 text-sm">
        <span style={{ color: 'var(--text-muted)' }}>Show</span>
        <select className="z-input text-sm" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">everyone</option>
          {Object.entries(ENROLLMENT_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {people && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{people.length} {people.length === 1 ? 'person' : 'people'}</span>}
      </div>
      {error && <Alert>{error}</Alert>}
      {people === null && !error ? <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div> : people && people.length === 0 ? (
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Nobody here yet. People join when the campaign is live, at the hourly run.</div>
      ) : (
        <div className="z-card overflow-x-auto" style={{ background: 'var(--bg-card)' }}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs" style={{ color: 'var(--text-muted)' }}>
              <th className="p-2">Person</th><th className="p-2">Step</th><th className="p-2">Status</th><th className="p-2">Why they wait / next</th><th className="p-2">Sender</th>
            </tr></thead>
            <tbody>
              {people?.map((p) => {
                const s = ENROLLMENT_STYLE[p.status] ?? { label: p.status, color: 'var(--text-muted)' };
                return (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-2"><Link className="underline" href={`/prospects/${p.prospect_id}`}>{p.full_name}</Link>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{[p.title, p.company].filter(Boolean).join(' · ')}</div></td>
                    <td className="p-2">{p.step_label}</td>
                    <td className="p-2"><span style={{ color: s.color }}>{s.label}</span></td>
                    <td className="p-2 text-xs" style={{ color: p.blocked_reason ? 'var(--orange)' : 'var(--text-muted)' }}>
                      {p.status === 'active'
                        ? (p.blocked_reason ?? (p.draft_status === 'pending' && p.card_id
                          ? <Link className="underline" href={`/campaigns/cards/${p.card_id}`}>draft waiting on the card</Link>
                          : `next look ${timeUntil(p.due_at)}`))
                        : p.exit_reason}
                    </td>
                    <td className="p-2 text-xs">{p.sender_name ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultsTab({ results, draft }: { results: Results | null; draft: boolean }) {
  if (draft) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Results appear once the campaign is live.</div>;
  if (!results) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  const t = results.totals;
  const steps = results.steps.filter((s) => s.type !== 'start' && (s.reached || s.sent));
  return (
    <div className="p-4 grid gap-4 overflow-y-auto h-full content-start">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[['In the campaign', t.enrolled], ['Still going', t.active], ['Sent', t.sent], ['Replied → handed off', t.handed_off], ['Finished', t.completed]].map(([k, v]) => (
          <div key={String(k)} className="z-card p-3" style={{ background: 'var(--bg-card)' }}>
            <div className="text-xl font-bold tabular-nums">{v ?? 0}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{k}</div>
          </div>
        ))}
      </div>
      <div className="z-card overflow-x-auto" style={{ background: 'var(--bg-card)' }}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs" style={{ color: 'var(--text-muted)' }}>
            <th className="p-2">Step</th><th className="p-2 text-right">Reached</th><th className="p-2 text-right">Here now</th>
            <th className="p-2 text-right">Sent</th><th className="p-2 text-right">Accepted</th><th className="p-2 text-right">Replied after</th>
          </tr></thead>
          <tbody>
            {steps.length === 0 && <tr><td className="p-3 text-sm" colSpan={6} style={{ color: 'var(--text-muted)' }}>Nobody has reached a step yet.</td></tr>}
            {steps.map((s) => (
              <tr key={s.node_id} className="border-t tabular-nums" style={{ borderColor: 'var(--border)' }}>
                <td className="p-2">{s.label}</td><td className="p-2 text-right">{s.reached}</td><td className="p-2 text-right">{s.here_now}</td>
                <td className="p-2 text-right">{s.sent || '—'}</td><td className="p-2 text-right">{s.accepted || '—'}</td>
                <td className="p-2 text-right">{s.sent ? `${s.replied_after} (${Math.round((s.reply_rate ?? 0) * 100)}%)` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {results.activity.length > 0 && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Sent in the last 14 days: {results.activity.map((a) => `${a.day.slice(5)} · ${a.sent}`).join('  ')}
        </div>
      )}
    </div>
  );
}

interface Options { icps: { id: string; name: string; owner_name: string | null; leads: number }[]; sources: { source: string; leads: number }[]; products: { id: string; name: string }[] }

function SettingsTab({ c, onSaved }: { c: Campaign; onSaved: () => Promise<void> }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [f, setF] = useState({ name: c.name, goal: c.goal ?? '', writing_context: c.writing_context ?? '', language: c.language ?? '',
    product_id: c.product_id ?? '', daily_max_per_step: c.settings?.daily_max_per_step ?? '' as number | '' });
  const [lists, setLists] = useState<CampaignList[]>(c.lists);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { api<Options>('/api/campaigns/options').then(setOpts).catch(() => setOpts({ icps: [], sources: [], products: [] })); }, []);
  const has = (l: Partial<CampaignList>) => lists.some((x) => (l.icp_id ? x.icp_id === l.icp_id : x.source === l.source));
  const toggle = (l: CampaignList) => setLists((ls) => (has(l) ? ls.filter((x) => !(l.icp_id ? x.icp_id === l.icp_id : x.source === l.source)) : [...ls, l]));
  const saveAll = async () => {
    setBusy(true); setMsg(null);
    try {
      await api(`/api/campaigns/${c.id}`, json('PATCH', {
        fields: { name: f.name, goal: f.goal, writing_context: f.writing_context, language: f.language, product_id: f.product_id || null,
          settings: f.daily_max_per_step ? { daily_max_per_step: Number(f.daily_max_per_step) } : {} },
        lists: lists.map((l) => (l.icp_id ? { icp_id: l.icp_id, include: l.include } : { source: l.source, include: l.include })),
      }));
      setMsg({ ok: true, text: 'Saved.' }); await onSaved();
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not save.' }); }
    finally { setBusy(false); }
  };
  const dis = !c.can_edit;
  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="max-w-2xl grid gap-4">
        <label className="grid gap-1 text-sm"><span className="z-eyebrow">Name</span><input className="z-input" disabled={dis} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="grid gap-1 text-sm"><span className="z-eyebrow">Goal</span><input className="z-input" disabled={dis} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="What a good outcome is — steers the ask in every draft" /></label>
        <label className="grid gap-1 text-sm"><span className="z-eyebrow">Who we target and the hook</span>
          <textarea className="z-input" rows={3} disabled={dis} value={f.writing_context} onChange={(e) => setF({ ...f, writing_context: e.target.value })} placeholder="e.g. Owner-run plastics processors in NRW; we met many at Fakuma; their pain is quoting time." /></label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm"><span className="z-eyebrow">Language</span>
            <select className="z-input" disabled={dis} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
              <option value="">decide per person</option><option value="de">German</option><option value="en">English</option>
            </select></label>
          <label className="grid gap-1 text-sm"><span className="z-eyebrow">Product it pitches</span>
            <select className="z-input" disabled={dis} value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
              <option value="">— the brand in general —</option>
              {opts?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
        </div>
        <label className="grid gap-1 text-sm"><span className="z-eyebrow">Most drafts per step per sender per day</span>
          <input type="number" min={1} max={100} className="z-input" style={{ width: 128 }} disabled={dis} value={f.daily_max_per_step} placeholder="25"
            onChange={(e) => setF({ ...f, daily_max_per_step: e.target.value ? Number(e.target.value) : '' })} />
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>The LinkedIn and email caps of each sender still apply on top.</span></label>
        <div className="grid gap-2 text-sm">
          <span className="z-eyebrow">Lists</span>
          {!opts ? <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</span> : (
            <div className="grid gap-1 max-h-72 overflow-y-auto">
              {[...lists.filter((l) => !opts.icps.some((i) => i.id === l.icp_id) && !opts.sources.some((s) => s.source === l.source)),
                ...opts.icps.map((i) => ({ icp_id: i.id, source: null, include: true, name: `${i.name} · ${i.leads} · ${i.owner_name ?? ''}` })),
                ...opts.sources.map((s) => ({ icp_id: null, source: s.source, include: true, name: `${s.source} · ${s.leads} open sales leads` }))]
                .map((l) => (
                  <label key={l.icp_id ?? `s:${l.source}`} className="flex items-center gap-2">
                    <input type="checkbox" disabled={dis} checked={has(l)} onChange={() => toggle(l as CampaignList)} />
                    <span className="truncate">{l.name}</span>
                  </label>
                ))}
            </div>
          )}
          {c.status !== 'draft' && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Removing a list stops new people joining from it; people already in keep going.</span>}
        </div>
        {msg && <div className="text-sm" role={msg.ok ? undefined : 'alert'} style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</div>}
        {c.can_edit && <div><button type="button" className="z-btn text-sm" disabled={busy} onClick={saveAll}>{busy ? 'Saving…' : 'Save settings'}</button></div>}
      </div>
    </div>
  );
}
