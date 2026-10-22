'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType,
  applyNodeChanges, useReactFlow,
  type Connection, type Edge, type Node, type NodeChange, type EdgeChange, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import FillableText from '@/components/campaigns/FillableText';
import {
  HANDLES, HANDLE_LABELS, LABELS, PALETTE, defaultConfig, messageOf, nodeLabel, nodeSummary,
  type Graph, type Sample, type GraphNode, type Handle as Exit, type NodeType, type Validation,
} from '@/lib/campaigns';

/**
 * The free canvas for a campaign's sequence (core 081). The parent owns the graph; every move, connection or
 * removal is handed back through onChange and autosaved there. One exit per handle: drawing from a handle that
 * already leads somewhere replaces that line. Validation comes from the kernel and is shown on each step.
 */

export interface StepStats { here_now?: number; sent?: number; reply_rate?: number | null }

interface StepData extends Record<string, unknown> {
  node: GraphNode; blockers: string[]; warnings: string[]; stats?: StepStats; selected: boolean; sample?: Sample;
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

function StepNode({ data }: NodeProps) {
  const d = data as StepData;
  const n = d.node;
  const tone = TONE[n.type] ?? 'var(--text-muted)';
  const exits = HANDLES[n.type];
  const bad = d.blockers.length > 0;
  const warn = !bad && d.warnings.length > 0;
  return (
    <div className="rounded-xl text-left" title={[...d.blockers, ...d.warnings].join('\n') || undefined}
      style={{
        width: 220, background: 'var(--bg-card)', color: 'var(--text)',
        border: `1.5px solid ${bad ? 'var(--red)' : d.selected ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: d.selected ? '0 0 0 3px var(--accent-glow)' : '0 1px 2px color-mix(in srgb, black 8%, transparent)',
      }}>
      {n.type !== 'start' && <Handle type="target" position={Position.Top} style={{ background: 'var(--text-muted)', width: 9, height: 9 }} />}
      <div className="px-3 pt-2.5 pb-2 grid gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold rounded-md px-1.5 py-0.5 shrink-0"
            style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>{GLYPH[n.type]}</span>
          <span className="text-[13px] font-semibold truncate">{nodeLabel(n)}</span>
          {bad && <span className="ml-auto text-[11px] font-bold" style={{ color: 'var(--red)' }} aria-label="has a problem">!</span>}
          {warn && <span className="ml-auto text-[11px] font-bold" style={{ color: 'var(--orange)' }} aria-label="has a warning">!</span>}
        </div>
        {nodeSummary(n) && <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{nodeSummary(n)}</div>}
        {(() => {
          const m = messageOf(n, d.sample);
          return m ? (
            <div className="text-[11px] leading-snug rounded-md px-2 py-1 mt-0.5 whitespace-pre-line"
              style={{ background: 'var(--bg-input)', color: 'var(--text)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
              title={m.text}>
              {m.sample && <span className="font-medium" style={{ color: 'var(--text-muted)' }}>sample · </span>}<FillableText text={m.text} />
            </div>
          ) : null;
        })()}
        {bad && <div className="text-[11px] leading-snug" style={{ color: 'var(--red)' }}>{d.blockers[0]}</div>}
        {d.stats && (d.stats.here_now || d.stats.sent) ? (
          <div className="text-[11px] flex gap-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {d.stats.here_now ? <span>{d.stats.here_now} here</span> : null}
            {d.stats.sent ? <span>{d.stats.sent} sent</span> : null}
            {d.stats.reply_rate != null && d.stats.sent ? <span>{Math.round(d.stats.reply_rate * 100)}% replied</span> : null}
          </div>
        ) : null}
      </div>
      {exits.length > 0 && (
        <div className="flex justify-around pb-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {exits.map((h) => <span key={h}>{exits.length > 1 ? HANDLE_LABELS[h] : ''}</span>)}
        </div>
      )}
      {exits.map((h, i) => (
        <Handle key={h} id={h} type="source" position={Position.Bottom}
          style={{ left: `${((i + 1) / (exits.length + 1)) * 100}%`, width: 10, height: 10,
            background: h === 'yes' ? 'var(--green)' : h === 'next' ? 'var(--accent)' : 'var(--orange)' }} />
      ))}
    </div>
  );
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

interface Props {
  graph: Graph; validation: Validation | null; editable: boolean; stats?: Record<string, StepStats>; samples?: Record<string, Sample>;
  selected: string | null; onSelect: (id: string | null) => void; onChange: (g: Graph) => void;
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

function Canvas({ graph, validation, editable, stats, samples, selected, onSelect, onChange }: Props) {
  const rf = useReactFlow();
  const theme = useAppTheme();
  // A controlled flow must hand measured sizes back to its nodes, or the minimap has nothing to draw.
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});
  const wrapper = useRef<HTMLDivElement>(null);

  const problems = useMemo(() => {
    const b: Record<string, string[]> = {}, w: Record<string, string[]> = {};
    for (const p of validation?.blockers ?? []) if (p.node) (b[p.node] ||= []).push(p.message);
    for (const p of validation?.warnings ?? []) if (p.node) (w[p.node] ||= []).push(p.message);
    return { b, w };
  }, [validation]);

  const nodes: Node[] = useMemo(() => graph.nodes.map((n) => ({
    id: n.id, type: 'step', position: n.position ?? { x: 0, y: 0 }, deletable: editable && n.type !== 'start',
    measured: dims[n.id],
    draggable: editable, selected: n.id === selected,
    data: { node: n, blockers: problems.b[n.id] ?? [], warnings: problems.w[n.id] ?? [], stats: stats?.[n.id],
      selected: n.id === selected, sample: samples?.[n.id] } satisfies StepData,
  })), [graph.nodes, problems, stats, samples, editable, selected, dims]);

  const edges: Edge[] = useMemo(() => graph.edges.map((e) => ({
    id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, deletable: editable,
    label: e.sourceHandle === 'next' ? undefined : HANDLE_LABELS[e.sourceHandle],
    labelStyle: { fontSize: 11, fill: 'var(--text-muted)' }, labelBgStyle: { fill: 'var(--bg)' },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { strokeWidth: 1.6, stroke: e.sourceHandle === 'yes' ? 'var(--green)' : e.sourceHandle === 'next' ? 'var(--text-muted)' : 'var(--orange)' },
  })), [graph.edges, editable]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const sized = changes.filter((c) => c.type === 'dimensions' && c.dimensions);
    if (sized.length) {
      setDims((d) => {
        const next = { ...d };
        for (const c of sized) if (c.type === 'dimensions' && c.dimensions) next[c.id] = c.dimensions;
        return next;
      });
    }
    if (!editable) {
      const sel = changes.find((c) => c.type === 'select' && c.selected);
      if (sel && 'id' in sel) onSelect(sel.id);
      return;
    }
    const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id));
    const moved = applyNodeChanges(changes.filter((c) => c.type === 'position' || c.type === 'remove'), nodes);
    const pos = Object.fromEntries(moved.map((n) => [n.id, n.position]));
    const sel = changes.find((c) => c.type === 'select' && c.selected);
    if (sel && 'id' in sel) onSelect(sel.id);
    if (!changes.some((c) => c.type === 'position' || c.type === 'remove')) return;
    onChange({
      nodes: graph.nodes.filter((n) => !removed.has(n.id) || n.type === 'start')
        .map((n) => ({ ...n, position: pos[n.id] ? { x: Math.round(pos[n.id].x), y: Math.round(pos[n.id].y) } : n.position })),
      edges: graph.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
    });
    if (selected && removed.has(selected)) onSelect(null);
  }, [editable, nodes, graph, onChange, onSelect, selected]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!editable) return;
    const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id));
    if (removed.size) onChange({ ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) });
  }, [editable, graph, onChange]);

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
    setTimeout(() => { void rf.setCenter(position.x + 110, position.y + 40, { zoom: Math.max(rf.getZoom(), 0.8), duration: 300 }); }, 0);
  }, [graph, onChange, onSelect, selected, rf]);

  const addBelow = (t: NodeType) => {
    const from = attachPoint(graph, selected)?.node ?? null;
    const lowest = graph.nodes.reduce((m, n) => Math.max(m, n.position?.y ?? 0), 0);
    addAt(t, from ? { x: from.position.x, y: from.position.y + 140 } : { x: 260, y: lowest + 140 });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const t = e.dataTransfer.getData('application/x-campaign-step') as NodeType;
    if (!t || !LABELS[t]) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAt(t, { x: Math.round(p.x - 110), y: Math.round(p.y - 30) });
  };

  return (
    <div className="flex h-full min-h-0">
      {editable && (
        <aside className="w-52 shrink-0 border-r p-3 grid grid-cols-[minmax(0,1fr)] content-start gap-1.5 overflow-y-auto" style={{ borderColor: 'var(--border)' }} aria-label="Steps you can add">
          <div className="text-xs font-medium mb-1">Add a step</div>
          {PALETTE.map((p) => (
            <button key={p.type} type="button" draggable title={p.hint}
              onDragStart={(e) => { e.dataTransfer.setData('application/x-campaign-step', p.type); e.dataTransfer.effectAllowed = 'move'; }}
              onClick={() => addBelow(p.type)}
              className="w-full min-w-0 text-left text-[13px] rounded-lg px-2.5 py-2 flex items-center gap-2 cursor-grab"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <span className="text-[10px] font-bold rounded px-1 py-0.5 shrink-0" style={{ color: TONE[p.type], background: `color-mix(in srgb, ${TONE[p.type]} 14%, transparent)` }}>{GLYPH[p.type]}</span>
              <span className="truncate min-w-0">{LABELS[p.type]}</span>
            </button>
          ))}
          <p className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--text-muted)' }}>
            Click a step to add it after the selected one (or after the last open exit). You can also drag it onto the
            canvas and draw a line from an exit dot. Select a step or a line and press Delete to remove it.
          </p>
        </aside>
      )}
      <div ref={wrapper} className="flex-1 min-w-0" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onPaneClick={() => onSelect(null)} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.2}
          nodesConnectable={editable} elementsSelectable connectionRadius={70} deleteKeyCode={editable ? ['Delete', 'Backspace'] : null}
          proOptions={{ hideAttribution: true }} colorMode={theme} style={{ background: 'var(--bg)' }}>
          <Background gap={20} size={1} color="var(--border)" />
          <Controls showInteractive={false} />
          {/* SVG fill attributes cannot read CSS variables: plain colours here. */}
          <MiniMap pannable zoomable nodeStrokeWidth={2}
            nodeColor={(n) => ((n.data as StepData)?.blockers?.length ? '#d93a3a' : theme === 'dark' ? '#5c5470' : '#c9bfd3')} />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function SequenceCanvas(props: Props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
