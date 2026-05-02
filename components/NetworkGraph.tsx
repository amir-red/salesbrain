'use client';

import { useEffect, useRef } from 'react';
import type { GraphNode, GraphEdge } from '@/lib/network-graph';
import { colorForIndustry } from '@/lib/network-graph';

export type NetworkLayout =
  | 'industry'        // free/industry cluster (default)
  | 'company'         // grouped tightly around accounts
  | 'location'        // grouped around locations
  | 'lead_stage'      // x-axis = stage
  | 'relationship';   // radial by recency

interface NetworkGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: NetworkLayout;
  selectedNodeId: string | null;
  searchTerm: string;
  hiddenNodeIds: Set<string>;            // nodes filtered out
  onNodeSelect: (nodeId: string | null) => void;
  onNodeHover?: (nodeId: string | null) => void;
}

// Lazy-loaded so Cytoscape isn't bundled into other pages
type CyInstance = {
  destroy: () => void;
  nodes: (sel?: string) => CySelection;
  edges: (sel?: string) => CySelection;
  on: (event: string, selector: string | ((evt: { target: CyElement }) => void), handler?: (evt: { target: CyElement }) => void) => void;
  fit: (eles?: unknown, padding?: number) => void;
  center: (eles?: unknown) => void;
  layout: (opts: Record<string, unknown>) => { run: () => void };
  getElementById: (id: string) => CyElement;
  $: (sel: string) => CySelection;
  resize: () => void;
};
type CySelection = {
  forEach: (fn: (el: CyElement) => void) => void;
  addClass: (cls: string) => void;
  removeClass: (cls: string) => void;
  length: number;
  filter: (fn: (el: CyElement) => boolean) => CySelection;
};
type CyElement = {
  id: () => string;
  data: (key?: string) => unknown;
  addClass: (cls: string) => void;
  removeClass: (cls: string) => void;
  hasClass: (cls: string) => boolean;
  position: () => { x: number; y: number };
  isNode: () => boolean;
  empty: () => boolean;
  nonempty: () => boolean;
};

export default function NetworkGraph(props: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CyInstance | null>(null);
  const dataKeyRef = useRef<string>('');

  // Build / rebuild the cytoscape instance only when nodes/edges change identity
  const dataKey = `${props.nodes.length}:${props.edges.length}:${props.nodes[0]?.id || ''}`;

  useEffect(() => {
    let destroyed = false;
    if (!containerRef.current) return;
    if (cyRef.current && dataKeyRef.current === dataKey) return;
    dataKeyRef.current = dataKey;

    (async () => {
      // dynamic import so Cytoscape is code-split off the rest of the app
      const cytoscapeMod = await import('cytoscape');
      const fcoseMod = await import('cytoscape-fcose');
      if (destroyed) return;
      const cytoscape = cytoscapeMod.default || cytoscapeMod;
      const fcose = fcoseMod.default || fcoseMod;
      try { (cytoscape as unknown as { use: (ext: unknown) => void }).use(fcose); } catch { /* already registered */ }

      if (cyRef.current) {
        try { cyRef.current.destroy(); } catch { /* */ }
        cyRef.current = null;
      }

      const elements = [
        ...props.nodes.map((n) => ({
          group: 'nodes' as const,
          data: {
            id: n.id,
            label: n.label,
            type: n.type,
            category: n.category,
            size: n.size,
            color: n.type === 'contact'
              ? colorForIndustry(n.category)
              : n.type === 'account'
              ? '#e5e7eb'
              : n.type === 'industry'
              ? colorForIndustry(n.category)
              : '#475569', // location
            metadata: n.metadata,
          },
        })),
        ...props.edges.map((e) => ({
          group: 'edges' as const,
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            type: e.relationship_type,
            weight: e.weight,
          },
        })),
      ];

      const cy = (cytoscape as unknown as (opts: Record<string, unknown>) => CyInstance)({
        container: containerRef.current,
        elements,
        wheelSensitivity: 0.2,
        minZoom: 0.1,
        maxZoom: 3,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': 'data(color)',
              'width': 'data(size)',
              'height': 'data(size)',
              'label': 'data(label)',
              'color': '#cbd5e1',
              'font-size': 9,
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 4,
              'text-outline-color': '#0b1220',
              'text-outline-width': 1,
              'border-width': 0,
              'transition-property': 'opacity, background-color, border-width',
              'transition-duration': '180ms',
            },
          },
          {
            selector: 'node[type = "industry"]',
            style: {
              'shape': 'diamond',
              'font-size': 12,
              'font-weight': 'bold',
            },
          },
          {
            selector: 'node[type = "location"]',
            style: {
              'shape': 'pentagon',
              'font-size': 11,
            },
          },
          {
            selector: 'node[type = "account"]',
            style: {
              'shape': 'round-rectangle',
              'font-size': 10,
              'font-weight': 'bold',
            },
          },
          {
            selector: 'edge',
            style: {
              'width': 1,
              'line-color': '#334155',
              'target-arrow-color': '#334155',
              'curve-style': 'bezier',
              'opacity': 0.5,
              'transition-property': 'opacity, line-color, width',
              'transition-duration': '180ms',
            },
          },
          {
            selector: 'edge[type = "in_industry"]',
            style: { 'line-style': 'dashed' },
          },
          {
            selector: 'edge[type = "based_in"]',
            style: { 'line-style': 'dotted' },
          },
          {
            selector: 'node.dim',
            style: { 'opacity': 0.15 },
          },
          {
            selector: 'edge.dim',
            style: { 'opacity': 0.05 },
          },
          {
            selector: 'node.hidden',
            style: { 'display': 'none' },
          },
          {
            selector: 'edge.hidden',
            style: { 'display': 'none' },
          },
          {
            selector: 'node.selected',
            style: {
              'border-width': 3,
              'border-color': '#fbbf24',
              'opacity': 1,
            },
          },
          {
            selector: 'node.match',
            style: {
              'border-width': 2,
              'border-color': '#22d3ee',
              'opacity': 1,
            },
          },
        ],
        layout: { name: 'preset' },
      });

      cyRef.current = cy;

      cy.on('tap', 'node', (evt) => {
        props.onNodeSelect(evt.target.id());
      });
      cy.on('tap', (evt) => {
        // tap on background (no node)
        const target = (evt as unknown as { target: CyElement }).target as CyElement;
        if (target && target === (cy as unknown as { container: () => unknown } as unknown as CyElement)) {
          // ignored
        }
      });
      cy.on('mouseover', 'node', (evt) => {
        if (props.onNodeHover) props.onNodeHover(evt.target.id());
      });
      cy.on('mouseout', 'node', () => {
        if (props.onNodeHover) props.onNodeHover(null);
      });

      // Initial layout
      runLayout(cy, props.layout);
    })();

    return () => {
      destroyed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // Handle layout changes
  useEffect(() => {
    if (!cyRef.current) return;
    runLayout(cyRef.current, props.layout);
  }, [props.layout]);

  // Handle visibility (filters)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((n) => {
      if (props.hiddenNodeIds.has(n.id())) n.addClass('hidden');
      else n.removeClass('hidden');
    });
    cy.edges().forEach((e) => {
      const src = e.data('source') as string;
      const tgt = e.data('target') as string;
      if (props.hiddenNodeIds.has(src) || props.hiddenNodeIds.has(tgt)) e.addClass('hidden');
      else e.removeClass('hidden');
    });
  }, [props.hiddenNodeIds]);

  // Handle search dim/match
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const term = props.searchTerm.trim().toLowerCase();
    cy.nodes().forEach((n) => {
      n.removeClass('match');
      n.removeClass('dim');
    });
    if (!term) return;
    cy.nodes().forEach((n) => {
      const label = String(n.data('label') || '').toLowerCase();
      const meta = (n.data('metadata') as Record<string, unknown>) || {};
      const haystack = [
        label,
        String(meta.title ?? ''),
        String(meta.company ?? ''),
        String(meta.industry ?? ''),
        String(meta.location ?? ''),
        String(meta.email ?? ''),
      ].join(' ').toLowerCase();
      if (haystack.includes(term)) n.addClass('match');
      else n.addClass('dim');
    });
  }, [props.searchTerm]);

  // Handle selection
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((n) => n.removeClass('selected'));
    if (props.selectedNodeId) {
      const el = cy.getElementById(props.selectedNodeId);
      if (el && el.nonempty()) {
        el.addClass('selected');
      }
    }
  }, [props.selectedNodeId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: '#0a0f1c' }}
      onClick={(e) => {
        // Click on background closes selection — node taps stop propagation via cytoscape's own handler chain
        if (e.target === containerRef.current) props.onNodeSelect(null);
      }}
    />
  );
}

// ─── Layout runner ──────────────────────────────────────────────────────────

function runLayout(cy: CyInstance, layout: NetworkLayout) {
  if (layout === 'lead_stage') {
    runLeadStageLayout(cy);
    return;
  }
  if (layout === 'relationship') {
    runRelationshipLayout(cy);
    return;
  }

  // industry / company / location → fcose with different priorities
  const sameClusterAttr =
    layout === 'company' ? 'company' : layout === 'location' ? 'location' : 'industry';

  cy.layout({
    name: 'fcose',
    quality: 'default',
    animate: true,
    animationDuration: 600,
    randomize: true,
    idealEdgeLength: (edge: { data: (k: string) => string }) => {
      const t = edge.data('type');
      if (t === 'works_at') return sameClusterAttr === 'company' ? 30 : 50;
      if (t === 'in_industry') return sameClusterAttr === 'industry' ? 30 : 80;
      if (t === 'based_in') return sameClusterAttr === 'location' ? 30 : 80;
      return 60;
    },
    nodeRepulsion: 4500,
    gravity: 0.25,
    edgeElasticity: 0.45,
    numIter: 2500,
    tile: false,
    padding: 30,
  } as Record<string, unknown>).run();
  setTimeout(() => cy.fit(undefined, 30), 700);
}

function runLeadStageLayout(cy: CyInstance) {
  const stageOrder = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
  const positions = new Map<string, { x: number; y: number }>();
  const w = 1400;
  const h = 700;
  const cellWidth = w / (stageOrder.length + 1);

  // Bucket contacts by their prospect_stage prefix
  const buckets = new Map<string, string[]>();
  cy.nodes('[type = "contact"]').forEach((n) => {
    const meta = (n.data('metadata') as Record<string, unknown>) || {};
    const stage = String(meta.prospect_stage ?? '');
    const dealGate = meta.deal_gate as number | null;
    let bucket = 'unsorted';
    if (stage) {
      const prefix = stage.split('_')[0];
      if (stageOrder.includes(prefix)) bucket = prefix;
    } else if (dealGate) {
      // Map gate 1..9 → P-buckets 0..8
      bucket = stageOrder[Math.min(stageOrder.length - 1, Math.max(0, dealGate - 1))];
    }
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(n.id());
  });

  for (const [bucket, ids] of buckets) {
    const idx = bucket === 'unsorted' ? stageOrder.length : stageOrder.indexOf(bucket);
    const x = (idx + 1) * cellWidth - w / 2;
    ids.forEach((id, i) => {
      const y = (i / Math.max(1, ids.length - 1)) * h - h / 2;
      positions.set(id, { x, y });
    });
  }

  // Other node types (account, industry, location): stack on right edge
  let other = 0;
  cy.nodes().forEach((n) => {
    if (n.data('type') === 'contact') return;
    positions.set(n.id(), { x: w / 2 + 80, y: (other++ * 25) - h / 2 });
  });

  cy.layout({
    name: 'preset',
    positions: (n: CyElement) => positions.get(n.id()) ?? { x: 0, y: 0 },
    animate: true,
    animationDuration: 600,
    fit: true,
    padding: 40,
  } as Record<string, unknown>).run();
}

function runRelationshipLayout(cy: CyInstance) {
  // Radial: contacts placed at radius inversely proportional to recency.
  // Most recent = innermost ring.
  const now = Date.now();
  const contacts: { id: string; ageDays: number }[] = [];
  cy.nodes('[type = "contact"]').forEach((n) => {
    const meta = (n.data('metadata') as Record<string, unknown>) || {};
    const last = meta.last_contacted_at as string | null;
    let ageDays = 9999;
    if (last) {
      const t = Date.parse(last);
      if (!Number.isNaN(t)) ageDays = Math.max(0, (now - t) / 86400_000);
    }
    contacts.push({ id: n.id(), ageDays });
  });
  contacts.sort((a, b) => a.ageDays - b.ageDays);
  const maxAge = Math.max(30, contacts[contacts.length - 1]?.ageDays ?? 30);

  const positions = new Map<string, { x: number; y: number }>();
  const ringStep = 60;
  const minR = 80;
  contacts.forEach((c, i) => {
    const ringRatio = c.ageDays / maxAge; // 0..1
    const r = minR + ringRatio * 6 * ringStep;
    const angle = (i / Math.max(1, contacts.length)) * Math.PI * 2;
    positions.set(c.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  });
  // accounts on outer ring
  let outer = 0;
  cy.nodes().forEach((n) => {
    if (n.data('type') === 'contact') return;
    const r = minR + 7 * ringStep;
    const angle = outer++;
    const a = (angle / 16) * Math.PI;
    positions.set(n.id(), { x: Math.cos(a) * r, y: Math.sin(a) * r });
  });

  cy.layout({
    name: 'preset',
    positions: (n: CyElement) => positions.get(n.id()) ?? { x: 0, y: 0 },
    animate: true,
    animationDuration: 600,
    fit: true,
    padding: 40,
  } as Record<string, unknown>).run();
}
