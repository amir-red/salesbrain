'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Panel, Position, MarkerType,
  applyNodeChanges, useReactFlow,
  type Connection, type Edge, type Node, type NodeChange, type EdgeChange, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import FillableText from '@/components/campaigns/FillableText';
import { relativeTime } from '@/lib/time';
import {
  ACTIONS, HANDLES, HANDLE_LABELS, LABELS, PALETTE, defaultConfig, messageOf, nodeLabel, nodeSummary, summaryOf,
  type Graph, type GraphNode, type Handle as Exit, type NodeType, type SavedSample, type Validation,
} from '@/lib/campaigns';

/**
 * The free canvas for a campaign's sequence (core 081). The parent owns the graph; every move, connection or
 * removal is handed back through onChange and autosaved there. One exit per handle: drawing from a handle that
 * already leads somewhere replaces that line. Validation comes from the kernel and is shown on each step.
 *
 * Layout for reading (2026-10-22): message steps are cards with the start of their text (hover = the whole
 * message), every other step is a slim pill; the canvas opens at a readable zoom from the top and the wheel
 * scrolls it like a page; "Tidy up" lays a hand-drawn sequence out again.
 */

export interface StepStats { here_now?: number; sent?: number; reply_rate?: number | null }
export type SampleState = 'ready' | 'stale' | 'writing' | 'none';

interface StepData extends Record<string, unknown> {
  node: GraphNode; blockers: string[]; warnings: string[]; stats?: StepStats; selected: boolean;
  sample?: SavedSample; sampleState?: SampleState;
  onDelete?: (id: string) => void;
  onHover?: (id: string | null, rect?: DOMRect) => void;
}

const TONE: Partial<Record<NodeType, string>> = {
  start: 'var(--accent)', linkedin_connect: 'var(--cat-blue)', linkedin_message: 'var(--cat-blue)',
  email: 'var(--cat-teal)', wait: 'var(--text-muted)', wait_for: 'var(--cat-violet)', branch: 'var(--orange)',
  handoff: 'var(--green)', end: 'var(--text-muted)',
};
const GLYPH: Record<NodeType, string> = {
  start: '▶', linkedin_connect: 'in+', linkedin_message: 'in', email: '@', wait: '⏱', wait_for: '⏳', branch: '⑂',
  handoff: '👤', end: '■',
};
const CARD_W = 270;      // message steps
const PILL_W = 270;      // everything else (as wide as a card, so the line is not cut off)

function Exits({ n }: { n: GraphNode }) {
  const exits = HANDLES[n.type];
  return (
    <>
      {exits.length > 1 && (
        <div className="flex justify-around text-[10px] leading-none pb-1" style={{ color: 'var(--text-muted)' }}>
          {exits.map((h) => <span key={h}>{HANDLE_LABELS[h]}</span>)}
        </div>
      )}
      {exits.map((h, i) => (
        <Handle key={h} id={h} type="source" position={Position.Bottom}
          style={{ left: `${((i + 1) / (exits.length + 1)) * 100}%`, width: 10, height: 10,
            background: h === 'yes' ? 'var(--green)' : h === 'next' ? 'var(--accent)' : 'var(--orange)' }} />
      ))}
    </>
  );
}

function RemoveButton({ d, n }: { d: StepData; n: GraphNode }) {
  if (!d.selected || !d.onDelete || n.type === 'start') return null;
  return (
    <button type="button" aria-label={`Remove ${nodeLabel(n)}`} title="Remove this step (Delete)"
      // React Flow handles mouse-down on a node (drag, select) before any click: act on pointer-down, and stop it.
      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); d.onDelete!(n.id); }}
      onClick={(e) => e.stopPropagation()}
      className="nodrag nopan absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full text-xs leading-none flex items-center justify-center z-10"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--red)', boxShadow: '0 1px 3px color-mix(in srgb, black 15%, transparent)' }}>×</button>
  );
}

function frame(d: StepData) {
  const bad = d.blockers.length > 0;
  return {
    background: 'var(--bg-card)', color: 'var(--text)',
    border: `1.5px solid ${bad ? 'var(--red)' : d.selected ? 'var(--accent)' : 'var(--border)'}`,
    boxShadow: d.selected ? '0 0 0 3px var(--accent-glow)' : '0 1px 2px color-mix(in srgb, black 8%, transparent)',
  };
}

function Badge({ d }: { d: StepData }) {
  if (d.blockers.length) return <span className="ml-auto text-[11px] font-bold shrink-0" style={{ color: 'var(--red)' }} aria-label="has a problem">!</span>;
  if (d.warnings.length) return <span className="ml-auto text-[11px] font-bold shrink-0" style={{ color: 'var(--orange)' }} aria-label="has a warning">!</span>;
  return null;
}

/** A message step: a card with the start of its text. Hover shows the whole message (drawn by the canvas). */
function MessageCard({ d, n }: { d: StepData; n: GraphNode }) {
  const tone = TONE[n.type] ?? 'var(--text-muted)';
  const m = messageOf(n, d.sample);
  const state = m && !m.sample ? 'own' : d.sampleState ?? 'none';
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="rounded-xl text-left relative" style={{ width: CARD_W, ...frame(d) }}
      title={d.blockers.concat(d.warnings).join('\n') || undefined}
      onMouseEnter={() => d.onHover?.(n.id, ref.current?.getBoundingClientRect())}
      onMouseLeave={() => d.onHover?.(null)}>
      <Handle type="target" position={Position.Top} style={{ background: 'var(--text-muted)', width: 9, height: 9 }} />
      <RemoveButton d={d} n={n} />
      <div className="px-3 pt-2.5 pb-2 grid gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold rounded-md px-1.5 py-0.5 shrink-0"
            style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>{GLYPH[n.type]}</span>
          <span className="text-[13px] font-semibold truncate">{nodeLabel(n)}</span>
          <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>· {nodeSummary(n)}</span>
          <Badge d={d} />
        </div>
        <div className="text-[11.5px] leading-snug rounded-lg px-2 py-1.5"
          style={{ background: 'var(--bg-input)', minHeight: 38 }}>
          {m ? (
            <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              <FillableText text={summaryOf(m.text)} />
            </span>
          ) : state === 'writing' ? (
            <span className="animate-pulse" style={{ color: 'var(--text-muted)' }}>Writing a sample…</span>
          ) : n.type === 'linkedin_connect' && String(n.config?.note_mode || 'none') === 'none' ? (
            <span style={{ color: 'var(--text-muted)' }}>A plain request, no note.</span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>No sample yet.</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {state === 'own' && <span>your exact text</span>}
          {state === 'ready' && <span>sample · hover to read it all</span>}
          {state === 'stale' && <span style={{ color: 'var(--orange)' }}>sample out of date · refresh samples</span>}
          {d.stats && (d.stats.here_now || d.stats.sent) ? (
            <span className="ml-auto tabular-nums">
              {d.stats.here_now ? `${d.stats.here_now} here` : ''}{d.stats.here_now && d.stats.sent ? ' · ' : ''}
              {d.stats.sent ? `${d.stats.sent} sent` : ''}
              {d.stats.reply_rate != null && d.stats.sent ? ` · ${Math.round(d.stats.reply_rate * 100)}% replied` : ''}
            </span>
          ) : null}
        </div>
        {d.blockers.length > 0 && <div className="text-[11px] leading-snug" style={{ color: 'var(--red)' }}>{d.blockers[0]}</div>}
      </div>
      <Exits n={n} />
    </div>
  );
}

/** Every other step: one slim line (what it does), its exits underneath. */
function Pill({ d, n }: { d: StepData; n: GraphNode }) {
  const tone = TONE[n.type] ?? 'var(--text-muted)';
  const summary = nodeSummary(n);
  return (
    <div className="rounded-full text-left relative" style={{ width: PILL_W, ...frame(d) }}
      title={d.blockers.concat(d.warnings).join('\n') || undefined}>
      {n.type !== 'start' && <Handle type="target" position={Position.Top} style={{ background: 'var(--text-muted)', width: 9, height: 9 }} />}
      <RemoveButton d={d} n={n} />
      <div className="px-3.5 py-1.5 flex items-center gap-2 min-w-0">
        <span className="text-[11px] shrink-0" style={{ color: tone }}>{GLYPH[n.type]}</span>
        <span className="text-[12.5px] font-semibold truncate">{nodeLabel(n)}</span>
        {summary && <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>· {summary}</span>}
        <Badge d={d} />
      </div>
      {d.blockers.length > 0 && <div className="px-3.5 pb-1 text-[10.5px] leading-snug" style={{ color: 'var(--red)' }}>{d.blockers[0]}</div>}
      <Exits n={n} />
    </div>
  );
}

function StepNode({ data }: NodeProps) {
  const d = data as StepData;
  return ACTIONS.includes(d.node.type) ? <MessageCard d={d} n={d.node} /> : <Pill d={d} n={d.node} />;
}

const nodeTypes = { step: StepNode };

/** Which exit a new step hangs from: "then", or a wait's "no / timed out" (the sequence goes on when nobody answers),
 *  or an If's "yes". The selected step if it has one free, otherwise the lowest step on the canvas that does. */
const EXIT_ORDER: Exit[] = ['next', 'timeout', 'yes', 'no'];
function freeExit(g: Graph, n: GraphNode): Exit | null {
  for (const h of EXIT_ORDER) {
    if (HANDLES[n.type].includes(h) && !g.edges.some((e) => e.source === n.id && e.sourceHandle === h)) return h;
  }
  return null;
}
function attachPoint(g: Graph, selected: string | null): { node: GraphNode; exit: Exit } | null {
  const sel = selected ? g.nodes.find((n) => n.id === selected) : null;
  if (sel) { const exit = freeExit(g, sel); return exit ? { node: sel, exit } : null; }
  const open = g.nodes.map((n) => ({ node: n, exit: freeExit(g, n) })).filter((x): x is { node: GraphNode; exit: Exit } => !!x.exit);
  return open.sort((a, b) => (b.node.position?.y ?? 0) - (a.node.position?.y ?? 0))[0] ?? null;
}

function newId(g: Graph, t: NodeType): string {
  const base = t.replace('linkedin_', 'li_');
  let i = 1;
  while (g.nodes.some((n) => n.id === `${base}${i}`)) i += 1;
  return `${base}${i}`;
}

/**
 * Lay the sequence out again, top to bottom: each step one row below its lowest parent, under the parent it hangs
 * from (the main path straight down: a reply-wait's "no / timed out", an acceptance's "yes", an If's "yes"),
 * siblings side by side, rows as tall as their tallest step.
 */
export function tidyLayout(g: Graph, dims: Record<string, { width: number; height: number }>): Graph {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const parents = new Map<string, { id: string; handle: Exit }[]>();
  for (const e of g.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    (parents.get(e.target) ?? parents.set(e.target, []).get(e.target)!).push({ id: e.source, handle: e.sourceHandle });
  }
  const rank = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const ps = parents.get(id) ?? [];
    const r = ps.length ? Math.max(...ps.map((p) => visit(p.id, stack))) + 1 : 0;
    stack.delete(id);
    rank.set(id, r);
    return r;
  };
  g.nodes.forEach((n) => visit(n.id, new Set()));
  const mainExit = (p: GraphNode): Exit[] => p.type === 'wait_for' && p.config?.event !== 'accepted'
    ? ['next', 'timeout', 'yes', 'no'] : ['next', 'yes', 'timeout', 'no'];
  const rows = new Map<number, string[]>();
  for (const n of g.nodes) (rows.get(rank.get(n.id)!) ?? rows.set(rank.get(n.id)!, []).get(rank.get(n.id)!)!).push(n.id);
  const X = 320, GAP = 46;
  const x = new Map<string, number>();
  const y = new Map<string, number>();
  let top = 0;
  for (const r of Array.from(rows.keys()).sort((a, b) => a - b)) {
    const ids = rows.get(r)!;
    const want = ids.map((id) => {
      const ps = parents.get(id) ?? [];
      if (!ps.length) return { id, x: 0 };
      const p = ps.slice().sort((a, b) => (rank.get(b.id)! - rank.get(a.id)!))[0];
      const pn = byId.get(p.id)!;
      const order = mainExit(pn);
      const kids = g.edges.filter((e) => e.source === p.id && rank.get(e.target) === r)
        .sort((a, b) => order.indexOf(a.sourceHandle) - order.indexOf(b.sourceHandle)).map((e) => e.target);
      return { id, x: (x.get(p.id) ?? 0) + Math.max(0, kids.indexOf(id)) * X };
    }).sort((a, b) => a.x - b.x);
    for (let i = 1; i < want.length; i++) if (want[i].x < want[i - 1].x + X) want[i].x = want[i - 1].x + X;
    let tallest = 0;
    for (const w of want) {
      x.set(w.id, w.x); y.set(w.id, top);
      tallest = Math.max(tallest, dims[w.id]?.height ?? (ACTIONS.includes(byId.get(w.id)!.type) ? 130 : 48));
    }
    top += tallest + GAP;
  }
  return {
    nodes: g.nodes.map((n) => {
      const w = ACTIONS.includes(n.type) ? CARD_W : PILL_W;
      return { ...n, position: { x: Math.round((x.get(n.id) ?? 0) - w / 2), y: Math.round(y.get(n.id) ?? 0) } };
    }),
    edges: g.edges,
  };
}

interface Props {
  graph: Graph; validation: Validation | null; editable: boolean; stats?: Record<string, StepStats>;
  samples?: Record<string, SavedSample>; sampleStates?: Record<string, SampleState>;
  selected: string | null; onSelect: (id: string | null) => void;
  /** kind 'move' = a drag in progress: the page folds a whole drag into one undo step. */
  onChange: (g: Graph, kind?: 'move' | 'edit') => void;
  history?: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  /** Something was removed (shown with an Undo by the page). */
  onRemoved?: (labels: string[]) => void;
  /** The samples on the cards: whether they are being written / out of date, and how to write them again. */
  samplesStatus?: { writing: boolean; stale: number; missing: number; refresh: () => void };
}

/** The app's theme lives on <html class="light|dark"> (set by the theme script), not in the system setting. */
function useAppTheme(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const read = () => setMode(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return mode;
}

/** The whole message of the hovered card, drawn outside the zoomed canvas so it is always readable. */
function HoverMessage({ node, sample, rect }: { node: GraphNode; sample?: SavedSample; rect: DOMRect }) {
  const m = messageOf(node, sample);
  if (!m) return null;
  const W = 380;
  const left = rect.right + 14 + W < window.innerWidth ? rect.right + 14 : Math.max(8, rect.left - W - 14);
  const top = Math.min(Math.max(8, rect.top), window.innerHeight - 320);
  const subject = node.type === 'email'
    ? (m.sample ? (sample?.subject ? messageOf({ type: 'email', config: { mode: 'auto' } }, { ...sample, text: sample.subject })?.text : null)
      : (node.config?.subject as string | undefined)) : null;
  // Rendered by Canvas outside React Flow's zoomed pane, so `fixed` is relative to the window and the text stays
  // full size at any zoom.
  return (
    <div className="fixed z-50 rounded-xl p-3.5 grid gap-2 text-sm pointer-events-none"
      style={{ left, top, width: W, maxHeight: '70vh', overflow: 'hidden', background: 'var(--bg-card)', border: '1px solid var(--border)',
        boxShadow: '0 12px 32px color-mix(in srgb, black 22%, transparent)', color: 'var(--text)' }}>
      <div className="text-xs font-semibold">{nodeLabel(node)}</div>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {m.sample
          ? <>A sample, written for {sample?.person?.full_name ?? 'the sample person'}{sample?.at ? ` ${relativeTime(sample.at)}` : ''}. Highlighted fields are filled in for each person; with “Write it for me” or your instructions, each person still gets their own draft.</>
          : <>Your exact text. Highlighted fields are filled in for each person.</>}
      </div>
      {subject && <div className="text-xs"><span style={{ color: 'var(--text-muted)' }}>Subject: </span><FillableText text={subject} /></div>}
      <div className="whitespace-pre-wrap leading-relaxed"><FillableText text={m.text} /></div>
      {node.type === 'email' && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Your signature and the opt-out line are added under it when it is sent.</div>}
    </div>
  );
}

function Canvas({ graph, validation, editable, stats, samples, sampleStates, selected, onSelect, onChange, history, onRemoved, samplesStatus }: Props) {
  const rf = useReactFlow();
  const theme = useAppTheme();
  // A controlled flow must hand measured sizes back to its nodes, or the minimap has nothing to draw.
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});
  const [pickedEdges, setPickedEdges] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  const problems = useMemo(() => {
    const b: Record<string, string[]> = {}, w: Record<string, string[]> = {};
    for (const p of validation?.blockers ?? []) if (p.node) (b[p.node] ||= []).push(p.message);
    for (const p of validation?.warnings ?? []) if (p.node) (w[p.node] ||= []).push(p.message);
    return { b, w };
  }, [validation]);

  const remove = useCallback((nodeIds: string[], edgeIds: string[] = []) => {
    const ids = new Set(graph.nodes.filter((n) => nodeIds.includes(n.id) && n.type !== 'start').map((n) => n.id));
    const lines = new Set(edgeIds);
    if (!ids.size && !lines.size) return;
    const labels = graph.nodes.filter((n) => ids.has(n.id)).map((n) => nodeLabel(n));
    onChange({
      nodes: graph.nodes.filter((n) => !ids.has(n.id)),
      edges: graph.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target) && !lines.has(e.id)),
    });
    if (selected && ids.has(selected)) onSelect(null);
    setHover(null);
    onRemoved?.(labels.length ? labels : [lines.size === 1 ? 'a line' : `${lines.size} lines`]);
  }, [graph, onChange, onRemoved, onSelect, selected]);

  const onHover = useCallback((id: string | null, rect?: DOMRect) => setHover(id && rect ? { id, rect } : null), []);

  const nodes: Node[] = useMemo(() => graph.nodes.map((n) => ({
    id: n.id, type: 'step', position: n.position ?? { x: 0, y: 0 }, deletable: editable && n.type !== 'start',
    measured: dims[n.id],
    draggable: editable, selected: n.id === selected,
    data: { node: n, blockers: problems.b[n.id] ?? [], warnings: problems.w[n.id] ?? [], stats: stats?.[n.id],
      selected: n.id === selected, sample: samples?.[n.id], sampleState: sampleStates?.[n.id], onHover,
      onDelete: editable ? (id: string) => remove([id]) : undefined } satisfies StepData,
  })), [graph.nodes, problems, stats, samples, sampleStates, editable, selected, dims, remove, onHover]);

  const edges: Edge[] = useMemo(() => graph.edges.map((e) => ({
    id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, deletable: editable, selected: pickedEdges.has(e.id),
    label: e.sourceHandle === 'next' ? undefined : HANDLE_LABELS[e.sourceHandle],
    labelStyle: { fontSize: 11, fill: 'var(--text-muted)' }, labelBgStyle: { fill: 'var(--bg)' },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { strokeWidth: pickedEdges.has(e.id) ? 3 : 1.6, stroke: e.sourceHandle === 'yes' ? 'var(--green)' : e.sourceHandle === 'next' ? 'var(--text-muted)' : 'var(--orange)' },
  })), [graph.edges, editable, pickedEdges]);

  // Open at a readable zoom: the whole sequence when it fits at >= 80 %, else top-aligned at 85 % and the wheel
  // scrolls down it (panOnScroll) like a page.
  useEffect(() => {
    if (placed.current || !wrapper.current || !graph.nodes.length) return;
    if (graph.nodes.some((n) => !dims[n.id])) return;
    placed.current = true;
    const xs = graph.nodes.map((n) => n.position.x), ys = graph.nodes.map((n) => n.position.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...graph.nodes.map((n) => n.position.x + (dims[n.id]?.width ?? 240)));
    const maxY = Math.max(...graph.nodes.map((n) => n.position.y + (dims[n.id]?.height ?? 60)));
    const W = wrapper.current.clientWidth, H = wrapper.current.clientHeight;
    const fit = Math.min(1, (W - 80) / (maxX - minX), (H - 80) / (maxY - minY));
    const zoom = fit >= 0.8 ? fit : 0.85;
    const x = W / 2 - ((minX + maxX) / 2) * zoom;
    const y = fit >= 0.8 ? H / 2 - ((minY + maxY) / 2) * zoom : 56 - minY * zoom;
    void rf.setViewport({ x, y, zoom });
  }, [dims, graph.nodes, rf]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const sized = changes.filter((c) => c.type === 'dimensions' && c.dimensions);
    if (sized.length) {
      setDims((d) => {
        const next = { ...d };
        for (const c of sized) if (c.type === 'dimensions' && c.dimensions) next[c.id] = c.dimensions;
        return next;
      });
    }
    const sel = changes.find((c) => c.type === 'select' && c.selected);
    if (sel && 'id' in sel) onSelect(sel.id);
    if (!editable) return;
    // Removals arrive through onDelete as ONE change (a step and its lines together), so undo restores both at once.
    const moves = changes.filter((c) => c.type === 'position');
    if (!moves.length) return;
    setHover(null);
    const pos = Object.fromEntries(applyNodeChanges(moves, nodes).map((n) => [n.id, n.position]));
    onChange({
      nodes: graph.nodes.map((n) => ({ ...n, position: pos[n.id] ? { x: Math.round(pos[n.id].x), y: Math.round(pos[n.id].y) } : n.position })),
      edges: graph.edges,
    }, 'move');
  }, [editable, nodes, graph, onChange, onSelect]);

  // Which lines are selected (so Delete can remove one, and it shows); removal itself goes through onDelete.
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const sel = changes.filter((c) => c.type === 'select');
    if (!sel.length) return;
    setPickedEdges((cur) => {
      const next = new Set(cur);
      for (const c of sel) if (c.type === 'select') { if (c.selected) next.add(c.id); else next.delete(c.id); }
      return next;
    });
  }, []);
  const onDelete = useCallback(({ nodes: ns, edges: es }: { nodes: Node[]; edges: Edge[] }) => {
    if (editable) remove(ns.map((n) => n.id), es.map((e) => e.id));
  }, [editable, remove]);

  const onConnect = useCallback((c: Connection) => {
    if (!editable || !c.source || !c.target || c.source === c.target) return;
    const handle = (c.sourceHandle || 'next') as Exit;
    const edges = graph.edges.filter((e) => !(e.source === c.source && e.sourceHandle === handle));   // one exit per handle
    edges.push({ id: `${c.source}-${handle}-${c.target}`, source: c.source, sourceHandle: handle, target: c.target });
    onChange({ ...graph, edges });
  }, [editable, graph, onChange]);

  const addAt = useCallback((t: NodeType, position: { x: number; y: number }) => {
    const id = newId(graph, t);
    const node: GraphNode = { id, type: t, config: defaultConfig(t), position };
    const edges = [...graph.edges];
    // Wire it in: from the selected step, else from the lowest step that still has a free exit.
    const from = attachPoint(graph, selected);
    if (from) edges.push({ id: `${from.node.id}-${from.exit}-${id}`, source: from.node.id, sourceHandle: from.exit, target: id });
    onChange({ nodes: [...graph.nodes, node], edges });
    onSelect(id);
    // Bring the new step into view: it may land below the visible part of a long sequence.
    setTimeout(() => { void rf.setCenter(position.x + 130, position.y + 40, { zoom: Math.max(rf.getZoom(), 0.85), duration: 300 }); }, 0);
  }, [graph, onChange, onSelect, selected, rf]);

  const addBelow = (t: NodeType) => {
    const from = attachPoint(graph, selected)?.node ?? null;
    const lowest = graph.nodes.reduce((m, n) => Math.max(m, n.position?.y ?? 0), 0);
    const h = from ? (dims[from.id]?.height ?? 60) : 0;
    addAt(t, from ? { x: from.position.x, y: from.position.y + h + 50 } : { x: 260, y: lowest + 160 });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const t = e.dataTransfer.getData('application/x-campaign-step') as NodeType;
    if (!t || !LABELS[t]) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAt(t, { x: Math.round(p.x - 120), y: Math.round(p.y - 30) });
  };

  const tidy = () => {
    onChange(tidyLayout(graph, dims));
    placed.current = false;            // place the view again once the steps have moved
  };
  const firstProblem = (validation?.blockers ?? []).find((b) => b.node)?.node ?? null;
  const goTo = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) return;
    onSelect(id);
    void rf.setCenter(n.position.x + 130, n.position.y + 50, { zoom: Math.max(rf.getZoom(), 0.9), duration: 300 });
  };
  const hovered = hover ? graph.nodes.find((n) => n.id === hover.id) : null;
  const btn = 'px-2.5 py-1 text-xs flex items-center gap-1 disabled:opacity-35';

  return (
    <div className="flex h-full min-h-0">
      {editable && (
        <aside className="w-44 shrink-0 border-r p-2.5 grid grid-cols-[minmax(0,1fr)] content-start gap-1 overflow-y-auto" style={{ borderColor: 'var(--border)' }} aria-label="Steps you can add">
          <div className="text-[11px] font-medium mb-0.5 px-0.5" style={{ color: 'var(--text-muted)' }}>Add a step</div>
          {PALETTE.map((p) => (
            <button key={p.type} type="button" draggable title={p.hint}
              onDragStart={(e) => { e.dataTransfer.setData('application/x-campaign-step', p.type); e.dataTransfer.effectAllowed = 'move'; }}
              onClick={() => addBelow(p.type)}
              className="w-full min-w-0 text-left text-[12.5px] rounded-lg px-2 py-1.5 flex items-center gap-2 cursor-grab"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <span className="text-[10px] font-bold rounded px-1 py-0.5 shrink-0" style={{ color: TONE[p.type], background: `color-mix(in srgb, ${TONE[p.type]} 14%, transparent)` }}>{GLYPH[p.type]}</span>
              <span className="truncate min-w-0">{LABELS[p.type]}</span>
            </button>
          ))}
          <p className="text-[10.5px] mt-1.5 leading-snug px-0.5" style={{ color: 'var(--text-muted)' }}>
            Click to add after the selected step, or drag onto the canvas. Scroll to move down; pinch or ⌘-scroll to zoom.
          </p>
        </aside>
      )}
      <div ref={wrapper} className="flex-1 min-w-0" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onDelete={onDelete}
          onPaneClick={() => onSelect(null)} onMoveStart={() => setHover(null)} minZoom={0.25} maxZoom={1.6}
          panOnScroll zoomOnScroll={false} zoomOnPinch
          nodesConnectable={editable} elementsSelectable connectionRadius={70} deleteKeyCode={editable ? ['Delete', 'Backspace'] : null}
          proOptions={{ hideAttribution: true }} colorMode={theme} style={{ background: 'var(--bg)' }}>
          <Background gap={20} size={1} color="var(--border)" />
          <Controls showInteractive={false} />
          <Panel position="top-left">
            <div className="flex gap-2">
              {editable && history && (
                <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  {([['Undo', '↶', history.canUndo, history.undo, '⌘Z / Ctrl+Z'], ['Redo', '↷', history.canRedo, history.redo, '⇧⌘Z / Ctrl+Y']] as const).map(([label, icon, ok, fn, keys], i) => (
                    <button key={label} type="button" onClick={fn} disabled={!ok} title={`${label} (${keys})`} aria-label={label}
                      className={btn} style={{ color: 'var(--text)', borderLeft: i ? '1px solid var(--border)' : undefined }}>
                      <span className="text-sm leading-none">{icon}</span>{label}
                    </button>
                  ))}
                </div>
              )}
              {editable && (
                <button type="button" onClick={tidy} title="Lay the steps out again, top to bottom" className={`${btn} rounded-lg`}
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)' }}>⇅ Tidy up</button>
              )}
            </div>
          </Panel>
          <Panel position="top-right">
            <div className="flex gap-2 items-center">
              {samplesStatus && (samplesStatus.writing ? (
                <span className="text-xs rounded-lg px-2.5 py-1 animate-pulse" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Writing sample drafts…</span>
              ) : editable && (samplesStatus.stale > 0 || samplesStatus.missing > 0) ? (
                <button type="button" onClick={samplesStatus.refresh} className={`${btn} rounded-lg`}
                  style={{ background: 'var(--bg-card)', border: `1px solid ${samplesStatus.stale ? 'var(--orange)' : 'var(--border)'}`, color: samplesStatus.stale ? 'var(--orange)' : 'var(--text)' }}>
                  ↻ {samplesStatus.stale ? `Refresh ${samplesStatus.stale} sample${samplesStatus.stale === 1 ? '' : 's'}` : 'Write samples'}
                </button>
              ) : null)}
              {validation && (validation.ok ? (
                <span className="text-xs rounded-lg px-2.5 py-1" style={{ background: 'color-mix(in srgb, var(--green) 12%, var(--bg-card))', color: 'var(--green)', border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)' }}>✓ Ready to run</span>
              ) : (
                <button type="button" onClick={() => firstProblem && goTo(firstProblem)} className={`${btn} rounded-lg`}
                  style={{ background: 'color-mix(in srgb, var(--red) 10%, var(--bg-card))', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)' }}>
                  {validation.blockers.length} to fix{firstProblem ? ' · show' : ''}
                </button>
              ))}
            </div>
          </Panel>
          {/* SVG fill attributes cannot read CSS variables: plain colours here. */}
          <MiniMap pannable zoomable nodeStrokeWidth={2}
            nodeColor={(n) => ((n.data as StepData)?.blockers?.length ? '#d93a3a' : theme === 'dark' ? '#5c5470' : '#c9bfd3')} />
        </ReactFlow>
      </div>
      {hovered && hover && <HoverMessage node={hovered} sample={samples?.[hovered.id]} rect={hover.rect} />}
    </div>
  );
}

export default function SequenceCanvas(props: Props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
