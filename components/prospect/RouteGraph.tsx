'use client';

import { useEffect, useRef } from 'react';
import type { RouteGraphEdge, RouteGraphNode } from '@/lib/prospects';
import { ROUTE_COLORS } from '@/lib/prospects';

/**
 * The route picture: red (you / a teammate) → blue (reachable now) → … → green
 * (the lead), yellow bridges beside the target. Left-to-right by hop depth,
 * which the kernel already computed per node — so this is a preset layout,
 * not a force simulation, and the same route always draws the same way.
 *
 * A deliberately small cousin of NetworkGraph: same cytoscape bootstrap, no
 * filters, no search, one job.
 */

interface CyInstance {
  destroy: () => void;
  on: (evt: string, sel: string, cb: (e: { target: { id: () => string } }) => void) => void;
  fit: (eles?: unknown, padding?: number) => void;
  elements: (sel?: string) => { addClass: (c: string) => void; removeClass: (c: string) => void };
  $: (sel: string) => { addClass: (c: string) => void; removeClass: (c: string) => void };
}

export default function RouteGraph({ nodes, edges, highlightPathId, onNodeSelect, height = 260 }: {
  nodes: RouteGraphNode[]; edges: RouteGraphEdge[]; highlightPathId?: string | null;
  onNodeSelect?: (id: string | null) => void; height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CyInstance | null>(null);
  const keyRef = useRef('');
  const key = `${nodes.map((n) => n.id).join(',')}|${edges.length}`;

  useEffect(() => {
    let destroyed = false;
    if (!containerRef.current || nodes.length === 0) return;
    if (cyRef.current && keyRef.current === key) return;
    keyRef.current = key;

    (async () => {
      const mod = await import('cytoscape');
      if (destroyed || !containerRef.current) return;
      const cytoscape = (mod.default || mod) as unknown as (opts: Record<string, unknown>) => CyInstance;
      if (cyRef.current) { try { cyRef.current.destroy(); } catch { /* */ } cyRef.current = null; }

      // Column = hop depth; rows spread the nodes sharing a depth.
      const byHop = new Map<number, RouteGraphNode[]>();
      for (const n of nodes) byHop.set(n.hop, [...(byHop.get(n.hop) || []), n]);
      const maxHop = Math.max(...nodes.map((n) => n.hop));
      const colW = Math.max(160, Math.min(260, 640 / Math.max(1, maxHop)));
      const pos = new Map<string, { x: number; y: number }>();
      for (const [hop, list] of byHop) {
        const sorted = [...list].sort((a, b) => rank(a) - rank(b));
        sorted.forEach((n, i) => pos.set(n.id, { x: hop * colW, y: (i - (sorted.length - 1) / 2) * 64 }));
      }

      const elements = [
        ...nodes.map((n) => ({
          group: 'nodes' as const,
          data: { id: n.id, label: n.label, color: ROUTE_COLORS[n.color], role: n.role,
                  size: n.role === 'target' ? 44 : n.role === 'owner' ? 36 : 30 },
          position: pos.get(n.id),
        })),
        ...edges.map((e, i) => ({
          group: 'edges' as const,
          data: { id: `e${i}`, source: e.from, target: e.to, strength: e.strength,
                  paths: (e.path_ids || []).join(' '), bridge: (e.path_ids || []).length === 0 ? 1 : 0 },
        })),
      ];

      const cy = cytoscape({
        container: containerRef.current,
        elements,
        layout: { name: 'preset', fit: true, padding: 24 },
        wheelSensitivity: 0.2, minZoom: 0.4, maxZoom: 2.5, userPanningEnabled: true,
        style: [
          { selector: 'node', style: {
            'background-color': 'data(color)', 'width': 'data(size)', 'height': 'data(size)',
            'label': 'data(label)', 'color': '#e2e8f0', 'font-size': 10, 'text-valign': 'bottom',
            'text-margin-y': 6, 'text-max-width': 110, 'text-wrap': 'ellipsis',
            'border-width': 2, 'border-color': '#0f172a',
          } },
          { selector: 'node[role = "target"]', style: { 'border-color': '#bbf7d0', 'border-width': 3 } },
          { selector: 'edge', style: {
            'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.9,
            'line-color': '#475569', 'target-arrow-color': '#475569',
            'width': 'mapData(strength, 0, 1, 1.2, 5)',
          } },
          { selector: 'edge[bridge = 1]', style: { 'line-style': 'dashed', 'line-color': '#78716c', 'target-arrow-color': '#78716c' } },
          { selector: '.lit', style: { 'line-color': '#38bdf8', 'target-arrow-color': '#38bdf8', 'z-index': 9 } },
          { selector: '.dim', style: { 'opacity': 0.35 } },
        ],
      });
      cy.on('tap', 'node', (e) => onNodeSelect?.(e.target.id()));
      cyRef.current = cy;
      applyHighlight(cy, highlightPathId);
    })();
    return () => { destroyed = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { if (cyRef.current) applyHighlight(cyRef.current, highlightPathId); }, [highlightPathId]);
  useEffect(() => () => { try { cyRef.current?.destroy(); } catch { /* */ } }, []);

  if (nodes.length === 0) return null;
  return <div ref={containerRef} style={{ height, width: '100%', background: 'var(--bg-input)', borderRadius: 12 }} />;
}

function rank(n: RouteGraphNode): number {
  return n.role === 'owner' ? 0 : n.role === 'target' ? 0 : n.color === 'red' ? 1 : n.color === 'blue' ? 2 : n.color === 'yellow' ? 3 : 4;
}

function applyHighlight(cy: CyInstance, pathId?: string | null) {
  cy.elements().removeClass('lit');
  cy.elements().removeClass('dim');
  if (!pathId) return;
  cy.$('edge').addClass('dim');
  cy.$(`edge[paths @*= "${pathId}"]`).removeClass('dim');
  cy.$(`edge[paths @*= "${pathId}"]`).addClass('lit');
}
