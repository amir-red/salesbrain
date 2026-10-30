'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Button from '@/components/panel/Button';
import PageHeader, { Pill } from '@/components/panel/PageHeader';
import StepInspector from '@/components/campaigns/StepInspector';
import type { SampleState, StepStats } from '@/components/campaigns/SequenceCanvas';
import { timeUntil } from '@/lib/time';
import {
  ENROLLMENT_STYLE, STATUS_STYLE, nodeLabel, toTemplate,
  needsSample, sampleIsStale,
  type PreviewDraft, type PreviewPerson, type Sample, type SavedSample,
  type Campaign, type CampaignList, type Graph, type Validation, sampleSlots, type AutoSend, type StepTrust, SEND_FROM, APPROVE_BY } from '@/lib/campaigns';

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
interface VariantResult { id: string; label: string; sent: number; replied_after: number; reply_rate: number | null; winner: boolean }
interface Results {
  steps: { node_id: string; type: string; label: string; reached: number; here_now: number; sent: number;
    replied_after: number; reply_rate: number | null; accepted: number; variants?: VariantResult[]; winner?: string | null;
    trust?: StepTrust[] }[];
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

function Alert({ tone = 'red', children, onClose }: { tone?: 'red' | 'orange' | 'green' | 'neutral'; children: React.ReactNode; onClose?: () => void }) {
  const color = tone === 'neutral' ? 'var(--text)' : `var(--${tone})`;
  const bg = tone === 'neutral' ? 'var(--bg-input)' : `color-mix(in srgb, var(--${tone}) 10%, transparent)`;
  return (
    <div className="rounded-lg px-3 py-2 text-xs flex items-start gap-3" role={tone === 'red' ? 'alert' : undefined} style={{ background: bg, color }}>
      <div className="flex-1">{children}</div>
      {onClose && <button type="button" onClick={onClose} aria-label="Dismiss" style={{ color: 'var(--text-muted)' }}>×</button>}
    </div>
  );
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const [created, setCreated] = useState<string | null>(sp.get('created'));
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
  // The message samples on the canvas cards: kept on the campaign (settings.samples), written when missing.
  const [samples, setSamples] = useState<Record<string, SavedSample>>({});
  const [writingSamples, setWritingSamples] = useState(false);
  const autoWritten = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Graph | null>(null);

  const load = useCallback(async () => {
    try {
      const out = await api<Campaign>(`/api/campaigns/${id}`);
      setC(out); setGraph(out.editing_graph); graphRef.current = out.editing_graph; setValidation(out.validation); setSave('saved');
      setSamples((cur) => ({ ...(out.settings?.samples ?? {}), ...cur }));
      past.current = []; future.current = []; setHist({ undo: 0, redo: 0 });
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

  const save_ = useCallback((g: Graph) => {
    setGraph(g); graphRef.current = g; pending.current = g; setSave('unsaved');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 900);
  }, [flush]);

  // Undo / redo over the sequence being edited. A drag ('move') or typing in the step panel ('edit') is folded into
  // one step: a new step starts only after 0.8 s without that kind of change. Everything else is its own step.
  const graphRef = useRef<Graph | null>(null);
  const past = useRef<Graph[]>([]);
  const future = useRef<Graph[]>([]);
  const lastKind = useRef<{ kind: string; at: number } | null>(null);
  const [hist, setHist] = useState({ undo: 0, redo: 0 });
  const syncHist = () => setHist({ undo: past.current.length, redo: future.current.length });
  const onGraph = useCallback((g: Graph, kind?: 'move' | 'edit') => {
    const now = Date.now();
    const fold = kind && lastKind.current?.kind === kind && now - lastKind.current.at < 800;
    if (!fold && graphRef.current) {
      past.current = [...past.current.slice(-99), graphRef.current];
      future.current = [];
    }
    lastKind.current = kind ? { kind, at: now } : null;
    save_(g); syncHist();
  }, [save_]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !graphRef.current) return;
    future.current.push(graphRef.current); lastKind.current = null;
    save_(prev); syncHist();
  }, [save_]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !graphRef.current) return;
    past.current.push(graphRef.current); lastKind.current = null;
    save_(next); syncHist();
  }, [save_]);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removed = useCallback((labels: string[]) => {
    const lines = labels.length === 1 && /^(a line|\d+ lines)$/.test(labels[0]);
    setNotice(lines ? `Removed ${labels[0]}` : `Removed ${labels.length === 1 ? `“${labels[0]}”` : `${labels.length} steps`} and ${labels.length === 1 ? 'its' : 'their'} lines`);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 7000);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
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

  const writeSamples = useCallback(async () => {
    if (writingSamples) return;
    if (timer.current) { clearTimeout(timer.current); await flush(); }
    setWritingSamples(true);
    try {
      const o = await api<{ samples?: Record<string, SavedSample> }>(`/api/campaigns/${id}`, json('POST', { action: 'samples' }));
      if (o.samples) setSamples((cur) => ({ ...cur, ...o.samples }));
    } catch (err) { setError(err instanceof Error ? `Could not write the sample drafts: ${err.message}` : 'Could not write the sample drafts.'); }
    finally { setWritingSamples(false); }
  }, [id, writingSamples, flush]);
  const sampleStates = useMemo<Record<string, SampleState>>(() => {
    const out: Record<string, SampleState> = {};
    for (const n of graph?.nodes ?? []) {
      for (const slot of sampleSlots(n)) {           // one sample per variant (084)
        if (!needsSample(n, slot.variant)) continue;
        const smp = samples[slot.key];
        const stale = !!smp && sampleIsStale(n, smp, slot.variant);
        out[slot.key] = writingSamples && (!smp || stale) ? 'writing' : !smp ? 'none' : stale ? 'stale' : 'ready';
      }
    }
    return out;
  }, [graph, samples, writingSamples]);
  // Once per visit: a step whose words are written per person and has no sample yet gets one, so every card shows
  // what its message looks like without anyone pressing a button.
  useEffect(() => {
    if (autoWritten.current || !c?.can_edit || !graph) return;
    if (Object.values(sampleStates).some((st) => st === 'none')) { autoWritten.current = true; void writeSamples(); }
  }, [c, graph, sampleStates, writeSamples]);
  const samplesStatus = {
    writing: writingSamples,
    stale: Object.values(sampleStates).filter((st) => st === 'stale').length,
    missing: Object.values(sampleStates).filter((st) => st === 'none').length,
    refresh: () => { void writeSamples(); },
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
        <PageHeader back={{ href: '/campaigns', label: 'Back to campaigns' }} title={c?.name ?? 'Campaign'}
          badge={st ? <Pill color={st.color}>{st.label}</Pill> : null}
          subtitle={c ? <>
            {c.lists.filter((l) => l.include).map((l) => l.name).join(' · ') || 'no list yet'}
            {c.goal ? ` · ${c.goal}` : ''}
            {tab === 'sequence' && c.can_edit && (
              <span style={{ color: save === 'failed' ? 'var(--red)' : undefined }}>
                {' · '}{{ saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', failed: 'Not saved' }[save]}
              </span>
            )}
          </> : null}
          actions={c?.can_edit ? <>
            {tab === 'sequence' && <Button onClick={async () => { if (timer.current) { clearTimeout(timer.current); await flush(); } setTesting(true); }}>Test run</Button>}
            {(c.status === 'paused' || c.status === 'draft') && unpublished && (
              <Button disabled={busy !== null} onClick={() => act('discard', 'Throw away the edits and go back to the published sequence?')}>Discard edits</Button>
            )}
            {c.status !== 'live' && c.status !== 'archived' && (
              <Button variant="danger" disabled={busy !== null}
                onClick={() => act('archive', 'Archive this campaign? Everyone still in it leaves, and waiting drafts are dropped.')}>Archive</Button>
            )}
            {c.status === 'live' && <Button disabled={busy !== null} onClick={() => act('pause')}>{busy === 'pause' ? 'Pausing…' : 'Pause'}</Button>}
            {(c.status === 'draft' || c.status === 'paused') && (
              <Button variant="primary" disabled={busy !== null} onClick={() => act('check')}>
                {busy === 'check' ? 'Checking…' : c.status === 'draft' ? 'Check & launch' : unpublished ? 'Publish & resume' : 'Resume'}
              </Button>
            )}
          </> : null} />

        <div className="px-4 border-b flex gap-4 text-sm" role="tablist" style={{ borderColor: 'var(--border)' }}>
          {(['sequence', 'people', 'results', 'settings'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="py-2 capitalize"
              style={{ borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`, color: tab === t ? 'var(--text)' : 'var(--text-muted)' }}>{t}</button>
          ))}
        </div>

        {(error || unpublished || general.length > 0 || created) && (
          <div className="px-4 pt-3 grid gap-2">
            {created === 'drawn' && tab === 'sequence' && (
              <Alert tone="green" onClose={() => setCreated(null)}>
                Your sequence is drawn from your answers. Click any step to change it, try <b>Test run</b>, then <b>Check &amp; launch</b>.
                Nothing is sent until you launch it.
              </Alert>
            )}
            {error && <Alert>{error}</Alert>}
            {unpublished && c?.status === 'live' && <Alert tone="orange">You have edits that are not live yet. People keep walking the published sequence until you pause and resume the campaign.</Alert>}
            {tab === 'sequence' && (graph?.nodes.length ?? 0) <= 1 && c?.can_edit ? (
              <Alert tone="neutral">
                Start by adding the first step from the left — <b>Email</b>, <b>LinkedIn connection request</b> or <b>LinkedIn message</b>.
                It connects to Start on its own. Prefer answering a few questions instead? <Link href="/campaigns/new" className="underline">Use the guided setup</Link>.
              </Alert>
            ) : tab === 'sequence' && general.map((g) => <Alert key={g.message} tone="orange">{g.message}</Alert>)}
          </div>
        )}

        <div className="flex-1 min-h-0">
          {!c ? (
            !error && <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : tab === 'sequence' && graph ? (
            <div className="flex h-full min-h-0">
              <div className="flex-1 min-w-0 relative">
                <SequenceCanvas graph={graph} validation={validation} editable={c.can_edit} stats={stats} samples={samples}
                  sampleStates={sampleStates} samplesStatus={samplesStatus}
                  selected={selected} onSelect={setSelected} onChange={onGraph} onRemoved={removed}
                  history={{ canUndo: hist.undo > 0, canRedo: hist.redo > 0, undo, redo }} />
                {notice && (
                  <div role="status" className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 rounded-lg px-3 py-2 text-xs flex items-center gap-3 shadow"
                    style={{ background: 'var(--text)', color: 'var(--bg)' }}>
                    <span>{notice}</span>
                    <button type="button" className="font-semibold underline" onClick={() => { undo(); setNotice(null); }}>Undo</button>
                    <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} style={{ opacity: 0.7 }}>×</button>
                  </div>
                )}
              </div>
              {sel && (
                <aside className="w-80 shrink-0 border-l p-4 overflow-y-auto relative" style={{ borderColor: 'var(--border)' }} aria-label="Step settings">
                  <button type="button" aria-label="Close" title="Close (or click the canvas)" onClick={() => setSelected(null)}
                    className="absolute top-3 right-3 text-lg leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
                  <StepInspector key={sel.id} node={sel} editable={c.can_edit} blockers={problems('blockers')} warnings={problems('warnings')}
                    sample={samples[sampleSlots(sel)[0].key]} samples={samples} onTestRun={() => setTesting(true)}
                    onChange={(config) => onGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === sel.id ? { ...n, config } : n)) }, 'edit')}
                    onRemove={() => { onGraph({ nodes: graph.nodes.filter((n) => n.id !== sel.id), edges: graph.edges.filter((e) => e.source !== sel.id && e.target !== sel.id) }); removed([nodeLabel(sel)]); setSelected(null); }} />
                </aside>
              )}
            </div>
          ) : tab === 'people' ? (
            <PeopleTab id={id} />
          ) : tab === 'results' ? (
            <ResultsTab results={results} draft={c.status === 'draft'} canEdit={c.can_edit} autoSend={c.settings?.auto_send}
              onWinner={async (nodeId, variantId) => {
                await api(`/api/campaigns/${id}`, json('POST', { action: 'winner', node_id: nodeId, variant_id: variantId }));
                await load();
              }} />
          ) : tab === 'settings' ? (
            <SettingsTab c={c} onSaved={load} />
          ) : null}
        </div>
      </div>

      {check && c && (
        <LaunchDialog check={check} status={c.status} busy={busy} onClose={() => setCheck(null)}
          onGo={() => act(c.status === 'draft' ? 'launch' : 'resume')} />
      )}
      {testing && graph && c && (
        <TestRunDialog id={id} graph={graph} editable={c.can_edit} onClose={() => setTesting(false)}
          onSamples={(m) => setSamples((cur) => ({ ...cur, ...m }))}
          onUseText={(nodeId, text, subject) => onGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id !== nodeId ? n
            : n.type === 'linkedin_connect' ? { ...n, config: { ...n.config, note_mode: 'fixed', text } }
              : { ...n, config: { ...n.config, mode: 'fixed', text, ...(subject && n.type === 'email' ? { subject } : {}) } })) })} />
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'color-mix(in srgb, black 45%, transparent)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`z-panel w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[85vh] overflow-y-auto p-5 grid gap-3`} style={{ background: 'var(--bg-card)' }}>
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
        <Button onClick={onClose}>Close</Button>
        {check.ok && <Button variant="primary" onClick={onGo} disabled={busy !== null}>{busy ? 'Working…' : status === 'draft' ? 'Launch' : 'Resume'}</Button>}
      </div>
    </Modal>
  );
}

interface PreviewStep extends TestStep { draft?: PreviewDraft }

/**
 * Test run: one person (the sample, or anyone on the campaign's lists) walks the sequence being edited. "Write the
 * drafts" has the ring write every message on that path exactly as the live campaign would (same prompt, voice and
 * rules; nothing filed or sent). A draft can be edited here and kept as that step's own text.
 */
function TestRunDialog({ id, graph, editable, onClose, onSamples, onUseText }: {
  id: string; graph: Graph; editable: boolean; onClose: () => void;
  onSamples: (s: Record<string, Sample>) => void;
  onUseText: (nodeId: string, text: string, subject: string | null) => void;
}) {
  const [people, setPeople] = useState<{ prospect_id: string; full_name: string; company: string | null; has_email: boolean }[]>([]);
  const [who, setWho] = useState('');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [path, setPath] = useState<PreviewStep[] | null>(null);
  const [person, setPerson] = useState<PreviewPerson | null>(null);
  const [drafted, setDrafted] = useState(false);
  const [edits, setEdits] = useState<Record<string, { text: string; subject: string }>>({});
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ people: typeof people }>(`/api/campaigns/${id}`, json('POST', { action: 'people' })).then((o) => setPeople(o.people || [])).catch(() => setPeople([]));
  }, [id]);
  useEffect(() => {       // the path alone is instant; drafts are written on request
    let off = false;
    setDrafted(false); setEdits({}); setUsed({});
    api<{ path: TestStep[]; facts: PreviewPerson }>(`/api/campaigns/${id}`, json('POST', { action: 'test', choices, ...(who ? { prospect_id: who } : {}) }))
      .then((o) => { if (!off) { setPath(o.path); setPerson(o.facts); } }).catch((e) => setError(e instanceof Error ? e.message : 'Test run failed.'));
    return () => { off = true; };
  }, [id, choices, who]);

  const write = async () => {
    setBusy(true); setError(null);
    try {
      const o = await api<{ path: PreviewStep[]; person: PreviewPerson }>(`/api/campaigns/${id}`, json('POST', { action: 'preview', choices, ...(who ? { prospect_id: who } : {}) }));
      setPath(o.path); setPerson(o.person); setDrafted(true);
      const e: Record<string, { text: string; subject: string }> = {};
      const samples: Record<string, Sample> = {};
      for (const s of o.path) {
        if (s.draft?.text) {
          e[s.node] = { text: s.draft.text, subject: s.draft.subject ?? '' };
          samples[s.node] = { text: s.draft.text, subject: s.draft.subject, person: o.person };
        }
      }
      setEdits(e); onSamples(samples);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not write the drafts.'); }
    finally { setBusy(false); }
  };
  const flip = (s: TestStep) => {
    const n = graph.nodes.find((x) => x.id === s.node);
    if (!n || (n.type !== 'wait_for' && n.type !== 'branch')) return;
    const yes = n.type === 'wait_for' ? s.outcome.endsWith(': yes') : s.outcome === 'yes';
    setChoices((m) => ({ ...m, [s.node]: yes ? (n.type === 'wait_for' ? 'timeout' : 'no') : 'yes' }));
  };
  const name = person?.full_name || 'the sample person';
  const muted = { color: 'var(--text-muted)' };

  return (
    <Modal title="Test run" wide onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span style={muted}>Test with</span>
        <select className="z-input text-sm" style={{ width: 'auto', maxWidth: 360 }} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Anna Beispiel (a sample person)</option>
          {people.map((p) => <option key={p.prospect_id} value={p.prospect_id}>{p.full_name}{p.company ? ` · ${p.company}` : ''}{p.has_email ? '' : ' · no email'}</option>)}
        </select>
        <Button variant="primary" disabled={busy || !path} onClick={write}>{busy ? 'Writing the drafts…' : drafted ? 'Write them again' : 'Write the drafts'}</Button>
      </div>
      <p className="text-xs" style={muted}>
        {name} walks the sequence you are editing. Click a wait or an “If” to take the other way.
        {drafted ? ' These are the messages as the campaign would write them for this person — nothing is sent.'
          : ' “Write the drafts” shows each message as the campaign would write it (takes up to half a minute). Nothing is sent.'}
      </p>
      {error && <Alert>{error}</Alert>}
      <ol className="grid gap-1.5">
        {(path ?? []).map((s, i) => {
          const clickable = s.type === 'wait_for' || s.type === 'branch';
          const d = s.draft;
          const e = edits[s.node];
          const isMsg = s.type === 'linkedin_connect' || s.type === 'linkedin_message' || s.type === 'email';
          return (
            <li key={`${s.node}-${i}`} className="text-sm rounded-lg px-3 py-2 grid gap-2" style={{ border: '1px solid var(--border)' }}>
              <div className="flex justify-between gap-2">
                <span className="font-medium">{i + 1}. {s.label}</span>
                {clickable
                  ? <button type="button" className="text-xs underline" onClick={() => flip(s)}>{s.outcome} ↺</button>
                  : <span className="text-xs" style={muted}>{s.outcome}</span>}
              </div>
              {isMsg && !drafted && s.preview && <div className="text-xs whitespace-pre-wrap" style={muted}>{s.preview}</div>}
              {isMsg && drafted && d && !d.text && (
                <div className="text-xs" style={muted}>{d.mode === 'none' ? 'A plain connection request, no note.' : `No draft: ${d.why}`}</div>
              )}
              {isMsg && drafted && d?.text && e && (
                <div className="grid gap-1.5">
                  {s.type === 'email' && (e.subject || d.subject) && (
                    <input className="z-input text-sm" aria-label="Subject" value={e.subject} readOnly={!editable}
                      onChange={(ev) => setEdits((m) => ({ ...m, [s.node]: { ...m[s.node], subject: ev.target.value } }))} />
                  )}
                  <textarea className="z-input text-sm" aria-label={`${s.label} for ${name}`} readOnly={!editable}
                    rows={Math.min(14, Math.max(3, e.text.split('\n').reduce((n, l) => n + Math.ceil((l.length || 1) / 78), 0) + 1))} value={e.text}
                    onChange={(ev) => setEdits((m) => ({ ...m, [s.node]: { ...m[s.node], text: ev.target.value } }))} />
                  {editable && (
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px]" style={muted}>
                        {used[s.node] ? '✓ This step now uses this text.' : `Keep it: everyone gets this text with their own name and company filled in.`}
                        {s.type === 'email' ? ' Your signature and the opt-out line are added under it when it is sent.' : ''}
                      </span>
                      <Button size="sm" variant={used[s.node] ? 'secondary' : 'primary'}
                        onClick={() => { onUseText(s.node, toTemplate(e.text, person), s.type === 'email' && e.subject ? toTemplate(e.subject, person) : null); setUsed((m) => ({ ...m, [s.node]: true })); }}>
                        {used[s.node] ? 'Use again' : 'Use as this step’s text'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
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
        <div className="z-panel overflow-x-auto" style={{ background: 'var(--bg-card)' }}>
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

function TrustChip({ t }: { t: StepTrust }) {
  if (!t.enabled) return null;
  const text = t.trusted ? `trusted · sends without ${t.sender_name?.split(' ')[0] ?? 'a'} tap`
    : `${t.human_approvals} of ${t.needed} approvals${t.reset_at ? ` · reset ${String(t.reset_at).slice(0, 10)}` : ''}`;
  const color = t.trusted ? 'var(--green)' : 'var(--text-muted)';
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap" title={`Trusted auto-send for ${t.sender_name ?? 'the sender'}`}
    style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{text}</span>;
}

function ResultsTab({ results, draft, canEdit, autoSend, onWinner }: {
  results: Results | null; draft: boolean; canEdit: boolean; autoSend?: AutoSend;
  onWinner: (nodeId: string, variantId: string | null) => Promise<void>;
}) {
  if (draft) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Results appear once the campaign is live.</div>;
  if (!results) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  const t = results.totals;
  const steps = results.steps.filter((s) => s.type !== 'start' && (s.reached || s.sent));
  const pct = (r: number | null | undefined) => `${Math.round((r ?? 0) * 100)}%`;
  return (
    <div className="p-4 grid gap-4 overflow-y-auto h-full content-start">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[['In the campaign', t.enrolled], ['Still going', t.active], ['Sent', t.sent], ['Replied → handed off', t.handed_off], ['Finished', t.completed]].map(([k, v]) => (
          <div key={String(k)} className="z-panel p-3" style={{ background: 'var(--bg-card)' }}>
            <div className="text-xl font-bold tabular-nums">{v ?? 0}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{k}</div>
          </div>
        ))}
      </div>
      <div className="z-panel overflow-x-auto" style={{ background: 'var(--bg-card)' }}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs" style={{ color: 'var(--text-muted)' }}>
            <th className="p-2">Step</th><th className="p-2 text-right">Reached</th><th className="p-2 text-right">Here now</th>
            <th className="p-2 text-right">Sent</th><th className="p-2 text-right">Accepted</th><th className="p-2 text-right">Replied after</th>
          </tr></thead>
          <tbody>
            {steps.length === 0 && <tr><td className="p-3 text-sm" colSpan={6} style={{ color: 'var(--text-muted)' }}>Nobody has reached a step yet.</td></tr>}
            {steps.map((s) => (
              <Fragment key={s.node_id}>
                <tr className="border-t tabular-nums" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{s.label}</span>
                      {(s.trust ?? []).map((tr) => <TrustChip key={tr.sender_user_id} t={tr} />)}
                    </div>
                  </td>
                  <td className="p-2 text-right">{s.reached}</td><td className="p-2 text-right">{s.here_now}</td>
                  <td className="p-2 text-right">{s.sent || '—'}</td><td className="p-2 text-right">{s.accepted || '—'}</td>
                  <td className="p-2 text-right">{s.sent ? `${s.replied_after} (${pct(s.reply_rate)})` : '—'}</td>
                </tr>
                {(s.variants ?? []).map((v) => (
                  <tr key={`${s.node_id}:${v.id}`} className="tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
                    <td className="py-1 pl-6 pr-2">
                      <span className="font-semibold" style={{ color: 'var(--text)' }}>{v.id.toUpperCase()}</span>{v.label && v.label !== v.id.toUpperCase() ? ` · ${v.label}` : ''}
                      {v.winner && <span className="ml-2 px-1.5 rounded-full" style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}>winner</span>}
                      {canEdit && (
                        v.winner
                          ? <button type="button" className="ml-2 underline" onClick={() => { void onWinner(s.node_id, null); }}>split again</button>
                          : <button type="button" className="ml-2 underline" title="From now on only this variant is sent at this step"
                              onClick={() => { if (confirm(`Send only variant ${v.id.toUpperCase()} at “${s.label}” from now on?`)) void onWinner(s.node_id, v.id); }}>Make winner</button>
                      )}
                    </td>
                    <td /><td />
                    <td className="py-1 px-2 text-right">{v.sent || '—'}</td><td />
                    <td className="py-1 px-2 text-right">{v.sent ? `${v.replied_after} (${pct(v.reply_rate)})` : '—'}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {results.activity.length > 0 && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Sent in the last 14 days: {results.activity.map((a) => `${a.day.slice(5)} · ${a.sent}`).join('  ')}
        </div>
      )}
      {autoSend?.enabled && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Trusted auto-send is on: after {autoSend.trust_after} cards of a step approved unchanged, that step sends without a tap.
          An edit, a skip or a dropped draft starts the count again. Switch it off on the Settings tab.
        </div>
      )}
    </div>
  );
}

interface Teammate { id: string; name: string; has_gmail: boolean; has_linkedin: boolean }
interface Options { icps: { id: string; name: string; owner_name: string | null; leads: number }[]; sources: { source: string; leads: number }[]; products: { id: string; name: string }[]; teammates?: Teammate[] }

function SettingsTab({ c, onSaved }: { c: Campaign; onSaved: () => Promise<void> }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [f, setF] = useState({ name: c.name, goal: c.goal ?? '', writing_context: c.writing_context ?? '', language: c.language ?? '',
    product_id: c.product_id ?? '', daily_max_per_step: c.settings?.daily_max_per_step ?? '' as number | '',
    auto_enabled: !!c.settings?.auto_send?.enabled, trust_after: c.settings?.auto_send?.trust_after ?? 3,
    allow_unverified: !!c.settings?.allow_unverified,
    send_from: c.settings?.send_from?.mode ?? 'owner', send_from_user: c.settings?.send_from?.user_id ?? '',
    approve_by: c.settings?.approve_by?.mode ?? 'sender', approve_by_user: c.settings?.approve_by?.user_id ?? '' });
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
          settings: { ...(f.daily_max_per_step ? { daily_max_per_step: Number(f.daily_max_per_step) } : {}),
            auto_send: { enabled: f.auto_enabled, trust_after: Math.max(1, Math.min(10, Number(f.trust_after) || 3)) },
            allow_unverified: f.allow_unverified,
            send_from: f.send_from === 'person' ? { mode: 'person', user_id: f.send_from_user } : { mode: f.send_from },
            approve_by: f.approve_by === 'person' ? { mode: 'person', user_id: f.approve_by_user } : { mode: f.approve_by } } },
        lists: lists.map((l) => (l.icp_id ? { icp_id: l.icp_id, include: l.include } : { source: l.source, include: l.include })),
      }));
      setMsg({ ok: true, text: 'Saved.' }); await onSaved();
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not save.' }); }
    finally { setBusy(false); }
  };
  const dis = !c.can_edit;
  const team = opts?.teammates ?? [];
  const accounts = (t: Teammate) => [t.has_linkedin && 'LinkedIn', t.has_gmail && 'Gmail'].filter(Boolean).join(' + ') || 'no accounts';
  const picker = (value: string, set: (v: string) => void, withAccounts: boolean) => (
    <select className="z-input" disabled={dis} value={value} onChange={(e) => set(e.target.value)}>
      <option value="">— choose a teammate —</option>
      {team.map((t) => <option key={t.id} value={t.id}>{t.name}{withAccounts ? ` · ${accounts(t)}` : ''}</option>)}
    </select>
  );
  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="max-w-2xl grid gap-4">
        <label className="grid gap-1 text-sm"><span className="text-xs font-medium">Name</span><input className="z-input" disabled={dis} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="grid gap-1 text-sm"><span className="text-xs font-medium">Goal</span><input className="z-input" disabled={dis} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="What a good outcome is — steers the ask in every draft" /></label>
        <label className="grid gap-1 text-sm"><span className="text-xs font-medium">Who we target and the hook</span>
          <textarea className="z-input" rows={3} disabled={dis} value={f.writing_context} onChange={(e) => setF({ ...f, writing_context: e.target.value })} placeholder="e.g. Owner-run plastics processors in NRW; we met many at Fakuma; their pain is quoting time." /></label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm"><span className="text-xs font-medium">Language</span>
            <select className="z-input" disabled={dis} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
              <option value="">decide per person</option><option value="de">German</option><option value="en">English</option>
            </select></label>
          <label className="grid gap-1 text-sm"><span className="text-xs font-medium">Product it pitches</span>
            <select className="z-input" disabled={dis} value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
              <option value="">— the brand in general —</option>
              {opts?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
        </div>
        <label className="grid gap-1 text-sm"><span className="text-xs font-medium">Most drafts per step per sender per day</span>
          <input type="number" min={1} max={100} className="z-input" style={{ width: 128 }} disabled={dis} value={f.daily_max_per_step} placeholder="25"
            onChange={(e) => setF({ ...f, daily_max_per_step: e.target.value ? Number(e.target.value) : '' })} />
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>The LinkedIn and email caps of each sender still apply on top.</span></label>
        <div className="grid sm:grid-cols-2 gap-3 rounded-xl p-3" style={{ border: '1px solid var(--border)' }}>
          <label className="grid gap-1 text-sm content-start"><span className="text-xs font-medium">Sends from</span>
            <select className="z-input" disabled={dis} value={f.send_from} onChange={(e) => setF({ ...f, send_from: e.target.value })}>
              {SEND_FROM.map((o) => <option key={o.mode} value={o.mode}>{o.label}</option>)}
            </select>
            {f.send_from === 'person' && picker(f.send_from_user, (v) => setF({ ...f, send_from_user: v }), true)}
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {SEND_FROM.find((o) => o.mode === f.send_from)?.hint} Applies to people as they join. Someone already written to or sent a
              request stays with that account, and so does anyone whose chosen sender lacks the LinkedIn or Gmail this campaign needs.
            </span></label>
          <label className="grid gap-1 text-sm content-start"><span className="text-xs font-medium">Approved by</span>
            <select className="z-input" disabled={dis} value={f.approve_by} onChange={(e) => setF({ ...f, approve_by: e.target.value })}>
              {APPROVE_BY.map((o) => <option key={o.mode} value={o.mode}>{o.label}</option>)}
            </select>
            {f.approve_by === 'person' && picker(f.approve_by_user, (v) => setF({ ...f, approve_by_user: v }), false)}
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {APPROVE_BY.find((o) => o.mode === f.approve_by)?.hint} The sender can always decide their own cards too. Applies to new cards.
            </span></label>
        </div>
        <div className="grid gap-2 rounded-xl p-3" style={{ border: '1px solid var(--border)' }}>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" disabled={dis} checked={f.auto_enabled} onChange={(e) => setF({ ...f, auto_enabled: e.target.checked })} />
            <span><b>Send without my tap once I have approved</b>{' '}
              <input type="number" min={1} max={10} className="z-input inline-block mx-1 text-sm" style={{ width: 56 }} disabled={dis || !f.auto_enabled}
                value={f.trust_after} onChange={(e) => setF({ ...f, trust_after: Number(e.target.value) || 3 })} />
              <b>cards of a step unchanged</b>
              <span className="block text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                Per step and per sender. The system then approves that step’s cards itself and tells you on Telegram, with a Pause button.
                Any edit, skip or dropped draft starts the count again; a draft that fails a check or hits one-person-per-company always waits for you.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" disabled={dis} checked={f.allow_unverified} onChange={(e) => setF({ ...f, allow_unverified: e.target.checked })} />
            <span><b>Also email addresses that are not verified</b>
              <span className="block text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                Off: an email goes only to an address a provider verified or that already wrote to us; catch-all and unchecked addresses wait
                (an address with no mail server is never sent to). On: catch-all and unchecked addresses are sent to as well — more reach, more bounces.
              </span>
            </span>
          </label>
        </div>
        <div className="grid gap-2 text-sm">
          <span className="text-xs font-medium">Lists</span>
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
        {c.can_edit && <div><Button variant="primary" disabled={busy} onClick={saveAll}>{busy ? 'Saving…' : 'Save settings'}</Button></div>}
      </div>
    </div>
  );
}
