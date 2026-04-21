'use client';

import { useState, useMemo } from 'react';
import {
  sankey as d3Sankey,
  sankeyJustify,
  sankeyLeft,
  sankeyCenter,
  sankeyLinkHorizontal,
} from 'd3-sankey';

// ── Types ──

interface TestNode {
  id: string;
  name: string;
  type: string;
}

interface TestLink {
  source: string;
  target: string;
  value: number;
}

interface TestData {
  label: string;
  description: string;
  nodes: TestNode[];
  links: TestLink[];
}

interface D3Node extends TestNode {
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  depth?: number;
  height?: number;
  layer?: number;
  sourceLinks?: D3Link[];
  targetLinks?: D3Link[];
  value?: number;
}

interface D3Link {
  source: D3Node;
  target: D3Node;
  value: number;
  width?: number;
  sourceWidth?: number;
  targetWidth?: number;
  y0?: number;
  y1?: number;
}

// ── Test Data Patterns ──

const PATTERN_A: TestData = {
  label: 'A: 完全形',
  description: '3省庁→3事業→3支出先（正常な4列構造）',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B', type: 'ministry-budget' },
    { id: 'ministry-budget-3', name: '省庁C', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2', type: 'project-budget' },
    { id: 'project-budget-3', name: '事業3', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2', type: 'project-spending' },
    { id: 'project-spending-3', name: '支出3', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B', type: 'recipient' },
    { id: 'recipient-3', name: '支出先C', type: 'recipient' },
  ],
  links: [
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 100 },
    { source: 'ministry-budget-2', target: 'project-budget-2', value: 80 },
    { source: 'ministry-budget-3', target: 'project-budget-3', value: 60 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 100 },
    { source: 'project-budget-2', target: 'project-spending-2', value: 80 },
    { source: 'project-budget-3', target: 'project-spending-3', value: 60 },
    { source: 'project-spending-1', target: 'recipient-1', value: 50 },
    { source: 'project-spending-1', target: 'recipient-2', value: 50 },
    { source: 'project-spending-2', target: 'recipient-2', value: 40 },
    { source: 'project-spending-2', target: 'recipient-3', value: 40 },
    { source: 'project-spending-3', target: 'recipient-3', value: 60 },
  ],
};

const PATTERN_B: TestData = {
  label: 'B: 支出先少',
  description: '3省庁→3事業→1支出先（支出先が少ないケース）',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B', type: 'ministry-budget' },
    { id: 'ministry-budget-3', name: '省庁C', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2', type: 'project-budget' },
    { id: 'project-budget-3', name: '事業3', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2', type: 'project-spending' },
    { id: 'project-spending-3', name: '支出3', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A', type: 'recipient' },
  ],
  links: [
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 100 },
    { source: 'ministry-budget-2', target: 'project-budget-2', value: 80 },
    { source: 'ministry-budget-3', target: 'project-budget-3', value: 60 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 100 },
    { source: 'project-budget-2', target: 'project-spending-2', value: 80 },
    { source: 'project-budget-3', target: 'project-spending-3', value: 60 },
    { source: 'project-spending-1', target: 'recipient-1', value: 100 },
    // spending-2, spending-3 have no downstream links → justify will shift them
  ],
};

const PATTERN_C: TestData = {
  label: 'C: 支出先なし',
  description: '3省庁→3事業→0支出先（最悪ケース）',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B', type: 'ministry-budget' },
    { id: 'ministry-budget-3', name: '省庁C', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2', type: 'project-budget' },
    { id: 'project-budget-3', name: '事業3', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2', type: 'project-spending' },
    { id: 'project-spending-3', name: '支出3', type: 'project-spending' },
  ],
  links: [
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 100 },
    { source: 'ministry-budget-2', target: 'project-budget-2', value: 80 },
    { source: 'ministry-budget-3', target: 'project-budget-3', value: 60 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 100 },
    { source: 'project-budget-2', target: 'project-spending-2', value: 80 },
    { source: 'project-budget-3', target: 'project-spending-3', value: 60 },
    // No recipient links at all
  ],
};

const TEST_PATTERNS = [PATTERN_A, PATTERN_B, PATTERN_C];

// ── Alignment approaches ──

type AlignFn = (node: { depth: number; height: number; sourceLinks: unknown[]; targetLinks: unknown[] }, n: number) => number;

// Experiment 3: Custom align by node type
function customAlign(node: { id?: string; depth: number; sourceLinks: unknown[] }, n: number): number {
  const id = (node as D3Node).id || '';
  if (id.startsWith('ministry-budget')) return 0;
  if (id.startsWith('project-budget')) return 1;
  if (id.startsWith('project-spending')) return 2;
  if (id.startsWith('recipient') || id.startsWith('subcontract')) return 3;
  return node.sourceLinks.length ? node.depth : n - 1;
}

interface Approach {
  id: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  align: any;
  postProcess?: (nodes: D3Node[], width: number, height: number) => void;
  /** Skip d3-sankey entirely; build layout from scratch */
  fullCustom?: boolean;
}

const COL_MAP: Record<string, number> = {
  'ministry-budget': 0,
  'project-budget': 1,
  'project-spending': 2,
  'recipient': 3,
  'subcontract-recipient': 3,
};

const APPROACHES: Approach[] = [
  { id: 'justify', label: '1. sankeyJustify（現状）', align: sankeyJustify },
  { id: 'left', label: '2. sankeyLeft', align: sankeyLeft },
  { id: 'center', label: '3. sankeyCenter', align: sankeyCenter },
  { id: 'custom', label: '4. カスタムalign', align: customAlign as AlignFn },
  {
    id: 'postfix-x',
    label: '5. x座標のみ上書き',
    align: sankeyJustify,
    postProcess: (nodes: D3Node[], innerWidth: number) => {
      const NODE_W = 24;
      const colSpacing = (innerWidth - NODE_W) / 3;
      for (const node of nodes) {
        const col = COL_MAP[node.type] ?? 0;
        node.x0 = col * colSpacing;
        node.x1 = node.x0! + NODE_W;
      }
    },
  },
  {
    id: 'postfix-xy',
    label: '6. x+y座標上書き',
    align: sankeyJustify,
    postProcess: (nodes: D3Node[], innerWidth: number, innerHeight: number) => {
      const NODE_W = 24;
      const PAD = 16;
      const colSpacing = (innerWidth - NODE_W) / 3;

      // Group nodes by column
      const columns: Map<number, D3Node[]> = new Map();
      for (const node of nodes) {
        const col = COL_MAP[node.type] ?? 0;
        if (!columns.has(col)) columns.set(col, []);
        columns.get(col)!.push(node);
      }

      // Compute global ky: same scale for all columns
      let ky = Infinity;
      for (const [, colNodes] of columns) {
        const totalValue = colNodes.reduce((s, n) => s + (n.value ?? 1), 0);
        const totalPadding = Math.max(0, (colNodes.length - 1) * PAD);
        const available = innerHeight - totalPadding;
        if (totalValue > 0) ky = Math.min(ky, available / totalValue);
      }
      if (!isFinite(ky)) ky = 1;

      for (const [col, colNodes] of columns) {
        for (const node of colNodes) {
          node.x0 = col * colSpacing;
          node.x1 = node.x0! + NODE_W;
        }

        let y = 0;
        for (const node of colNodes) {
          const h = Math.max(2, (node.value ?? 1) * ky);
          node.y0 = y;
          node.y1 = y + h;
          y += h + PAD;
        }

        const totalUsed = y - (colNodes.length > 0 ? PAD : 0);
        const offset = (innerHeight - totalUsed) / 2;
        if (offset > 0) {
          for (const node of colNodes) {
            node.y0! += offset;
            node.y1! += offset;
          }
        }
      }
    },
  },
  {
    id: 'no-d3',
    label: '7. d3-sankey不使用',
    align: sankeyJustify, // unused
    fullCustom: true,
  },
];

// ── Layout computation ──

const SVG_W = 320;
const SVG_H = 220;
const MARGIN = { top: 24, right: 60, bottom: 8, left: 60 };
const INNER_W = SVG_W - MARGIN.left - MARGIN.right;
const INNER_H = SVG_H - MARGIN.top - MARGIN.bottom;
const NODE_W = 24;
const NODE_PAD = 16;

/**
 * Fully custom layout without d3-sankey.
 * Computes node x/y and link paths from scratch.
 */
function computeCustomLayout(data: TestData) {
  const PAD = NODE_PAD;
  const colSpacing = (INNER_W - NODE_W) / 3;

  // Build nodes with value computed from links
  const nodeMap = new Map<string, D3Node>();
  for (const n of data.nodes) {
    nodeMap.set(n.id, { ...n, value: 0, sourceLinks: [], targetLinks: [] });
  }

  // Build links (with object refs)
  const links: D3Link[] = [];
  for (const l of data.links) {
    const src = nodeMap.get(l.source);
    const tgt = nodeMap.get(l.target);
    if (!src || !tgt) continue;
    const link: D3Link = { source: src, target: tgt, value: l.value, width: 0, y0: 0, y1: 0 };
    links.push(link);
    src.sourceLinks!.push(link);
    tgt.targetLinks!.push(link);
  }

  const nodes = Array.from(nodeMap.values());

  // Compute node values = max(sum incoming, sum outgoing)
  for (const node of nodes) {
    const srcSum = node.sourceLinks!.reduce((s, l) => s + l.value, 0);
    const tgtSum = node.targetLinks!.reduce((s, l) => s + l.value, 0);
    node.value = Math.max(srcSum, tgtSum);
  }

  // Group by column
  const columns: Map<number, D3Node[]> = new Map();
  for (const node of nodes) {
    const col = COL_MAP[node.type] ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  // Compute global ky: same scale for all columns (like d3-sankey)
  // ky = min across columns of (availableHeight / totalValue)
  let ky = Infinity;
  for (const [, colNodes] of columns) {
    const totalValue = colNodes.reduce((s, n) => s + (n.value ?? 1), 0);
    const totalPadding = Math.max(0, (colNodes.length - 1) * PAD);
    const availableHeight = INNER_H - totalPadding;
    if (totalValue > 0) {
      ky = Math.min(ky, availableHeight / totalValue);
    }
  }
  if (!isFinite(ky)) ky = 1;

  // Layout each column: x fixed, y proportional to value with global ky
  for (const [col, colNodes] of columns) {
    for (const node of colNodes) {
      node.x0 = col * colSpacing;
      node.x1 = node.x0 + NODE_W;
    }

    let y = 0;
    for (const node of colNodes) {
      const h = Math.max(2, (node.value ?? 1) * ky);
      node.y0 = y;
      node.y1 = y + h;
      y += h + PAD;
    }

    // Center vertically
    const totalUsed = y - (colNodes.length > 0 ? PAD : 0);
    const offset = (INNER_H - totalUsed) / 2;
    if (offset > 0) {
      for (const node of colNodes) {
        node.y0! += offset;
        node.y1! += offset;
      }
    }
  }

  // Compute link widths and y positions (per-side: source and target can differ)
  for (const node of nodes) {
    const nodeHeight = (node.y1 ?? 0) - (node.y0 ?? 0);
    const totalSrcValue = node.sourceLinks!.reduce((s, l) => s + l.value, 0);
    const totalTgtValue = node.targetLinks!.reduce((s, l) => s + l.value, 0);

    let sy = node.y0 ?? 0;
    for (const link of node.sourceLinks!) {
      const proportion = totalSrcValue > 0 ? link.value / totalSrcValue : 0;
      link.sourceWidth = nodeHeight * proportion;
      link.y0 = sy; // top edge of link at source
      sy += link.sourceWidth;
    }

    let ty = node.y0 ?? 0;
    for (const link of node.targetLinks!) {
      const proportion = totalTgtValue > 0 ? link.value / totalTgtValue : 0;
      link.targetWidth = nodeHeight * proportion;
      link.y1 = ty; // top edge of link at target
      ty += link.targetWidth;
    }
  }
  // Set link.width to max for backwards compat (stroke-based renderers)
  for (const link of links) {
    link.width = Math.max(link.sourceWidth ?? 0, link.targetWidth ?? 0);
  }

  // Ribbon path generator: filled shape from source right edge to target left edge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathGen = (link: any) => {
    const sx = (link.source as D3Node).x1 ?? 0;
    const tx = (link.target as D3Node).x0 ?? 0;
    const sTop = link.y0 ?? 0;
    const sBot = sTop + (link.sourceWidth ?? 0);
    const tTop = link.y1 ?? 0;
    const tBot = tTop + (link.targetWidth ?? 0);
    const mx = (sx + tx) / 2;
    // Top curve: source right-top → target left-top
    // Bottom curve: target left-bottom → source right-bottom (reverse)
    return `M${sx},${sTop}C${mx},${sTop} ${mx},${tTop} ${tx},${tTop}`
      + `L${tx},${tBot}`
      + `C${mx},${tBot} ${mx},${sBot} ${sx},${sBot}Z`;
  };

  return { nodes, links, pathGen };
}

function computeLayout(data: TestData, approach: Approach) {
  if (approach.fullCustom) {
    return computeCustomLayout(data);
  }

  const nodes: D3Node[] = data.nodes.map((n) => ({ ...n }));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const links: D3Link[] = data.links
    .filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target))
    .map((l) => ({
      source: nodeMap.get(l.source)!,
      target: nodeMap.get(l.target)!,
      value: l.value,
    }));

  const generator = d3Sankey<D3Node, D3Link>()
    .nodeId((d) => d.id)
    .nodeWidth(NODE_W)
    .nodePadding(NODE_PAD)
    .nodeAlign(approach.align)

    .extent([
      [0, 0],
      [INNER_W, INNER_H],
    ]);

  const graph = generator({ nodes, links });

  if (approach.postProcess) {
    approach.postProcess(graph.nodes, INNER_W, INNER_H);
    // Recompute link widths proportional to new node heights, then recompute y0/y1
    for (const node of graph.nodes) {
      const nodeHeight = (node.y1 ?? 0) - (node.y0 ?? 0);
      const totalSourceValue = (node.sourceLinks ?? []).reduce((s, l) => s + l.value, 0);
      const totalTargetValue = (node.targetLinks ?? []).reduce((s, l) => s + l.value, 0);

      let sy = node.y0 ?? 0;
      for (const link of (node.sourceLinks ?? [])) {
        const proportion = totalSourceValue > 0 ? link.value / totalSourceValue : 0;
        link.width = nodeHeight * proportion;
        link.y0 = sy + link.width / 2;
        sy += link.width;
      }

      let ty = node.y0 ?? 0;
      for (const link of (node.targetLinks ?? [])) {
        const proportion = totalTargetValue > 0 ? link.value / totalTargetValue : 0;
        const w = nodeHeight * proportion;
        link.y1 = ty + w / 2;
        ty += w;
      }
    }
  }

  const pathGen = sankeyLinkHorizontal();

  return {
    nodes: graph.nodes,
    links: graph.links,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pathGen: pathGen as (link: any) => string | null,
  };
}

// ── Color helpers ──

const TYPE_COLORS: Record<string, string> = {
  'ministry-budget': '#4e79a7',
  'project-budget': '#59a14f',
  'project-spending': '#f28e2b',
  'recipient': '#e15759',
  'subcontract-recipient': '#b07aa1',
};

const COLUMN_LABELS = ['省庁', '事業(予算)', '事業(支出)', '支出先'];

// ── Component ──

export default function SankeyLabPage() {
  const [selectedPattern, setSelectedPattern] = useState(0);
  const [selectedApproach, setSelectedApproach] = useState(0);
  const [showAll, setShowAll] = useState(true);

  const results = useMemo(() => {
    if (showAll) {
      return TEST_PATTERNS.map((pattern) =>
        APPROACHES.map((approach) => ({
          pattern,
          approach,
          layout: computeLayout(pattern, approach),
        }))
      );
    }
    const pattern = TEST_PATTERNS[selectedPattern];
    const approach = APPROACHES[selectedApproach];
    return [[{ pattern, approach, layout: computeLayout(pattern, approach) }]];
  }, [showAll, selectedPattern, selectedApproach]);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', background: '#f8f9fa', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>d3-sankey Alignment Lab</h1>

      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          全パターン × 全アプローチを表示
        </label>

        {!showAll && (
          <>
            <select value={selectedPattern} onChange={(e) => setSelectedPattern(Number(e.target.value))}>
              {TEST_PATTERNS.map((p, i) => (
                <option key={i} value={i}>{p.label}</option>
              ))}
            </select>
            <select value={selectedApproach} onChange={(e) => setSelectedApproach(Number(e.target.value))}>
              {APPROACHES.map((a, i) => (
                <option key={i} value={i}>{a.label}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {showAll ? (
        <div style={{ overflowX: 'auto' }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${APPROACHES.length}, 320px)`, gap: 6, marginBottom: 6 }}>
            <div />
            {APPROACHES.map((a) => (
              <div key={a.id} style={{ fontSize: 11, fontWeight: 600, textAlign: 'center' }}>{a.label}</div>
            ))}
          </div>

          {/* Data rows */}
          {results.map((row, ri) => (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: `140px repeat(${APPROACHES.length}, 320px)`, gap: 6, marginBottom: 6 }}>
              <div style={{ fontSize: 11, paddingTop: 8 }}>
                <strong>{row[0].pattern.label}</strong>
                <br />
                <span style={{ color: '#666' }}>{row[0].pattern.description}</span>
              </div>
              {row.map((cell, ci) => (
                <SankeyChart key={ci} layout={cell.layout} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>
            {results[0][0].pattern.label} × {results[0][0].approach.label}
          </h2>
          <p style={{ color: '#666', marginBottom: 12 }}>{results[0][0].pattern.description}</p>
          <SankeyChart layout={results[0][0].layout} large />
          <NodeTable nodes={results[0][0].layout.nodes} />
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 24, display: 'flex', gap: 16, fontSize: 12 }}>
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, background: color, borderRadius: 2 }} />
            {type}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SankeyChart sub-component ──

function SankeyChart({
  layout,
  large,
}: {
  layout: ReturnType<typeof computeLayout>;
  large?: boolean;
}) {
  const w = large ? 600 : SVG_W;
  const h = large ? 400 : SVG_H;
  const scale = large ? 600 / SVG_W : 1;

  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <g transform={`translate(${MARGIN.left * scale},${MARGIN.top * scale})`}>
          {/* Column labels */}
          {COLUMN_LABELS.map((label, i) => {
            const x = (i / 3) * INNER_W * scale;
            return (
              <text key={i} x={x + (NODE_W * scale) / 2} y={-8 * scale} textAnchor="middle" fontSize={10 * scale} fill="#999">
                {label}
              </text>
            );
          })}

          {/* Column guide lines */}
          {[0, 1, 2, 3].map((i) => {
            const x = (i / 3) * INNER_W * scale;
            return (
              <line key={i} x1={x} y1={0} x2={x} y2={INNER_H * scale} stroke="#eee" strokeDasharray="4,4" />
            );
          })}

          {/* Links */}
          {layout.links.map((link, i) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = layout.pathGen(link as any);
            if (!d) return null;

            const scaledPath = large ? scaleSvgPath(d, scale) : d;
            const color = TYPE_COLORS[(link.source as D3Node).type] || '#ccc';
            const isRibbon = (link as D3Link).sourceWidth !== undefined;

            return isRibbon ? (
              <path
                key={i}
                d={scaledPath}
                fill={color}
                fillOpacity={0.3}
                stroke="none"
              />
            ) : (
              <path
                key={i}
                d={scaledPath}
                fill="none"
                stroke={color}
                strokeOpacity={0.3}
                strokeWidth={Math.max(1, (link.width ?? 1) * scale)}
              />
            );
          })}

          {/* Nodes */}
          {layout.nodes.map((node) => (
            <g key={node.id}>
              <rect
                x={(node.x0 ?? 0) * scale}
                y={(node.y0 ?? 0) * scale}
                width={((node.x1 ?? 0) - (node.x0 ?? 0)) * scale}
                height={Math.max(1, ((node.y1 ?? 0) - (node.y0 ?? 0)) * scale)}
                fill={TYPE_COLORS[node.type] || '#ccc'}
                rx={2}
              />
              <text
                x={((node.x1 ?? 0) + 4) * scale}
                y={((node.y0 ?? 0) + ((node.y1 ?? 0) - (node.y0 ?? 0)) / 2) * scale}
                fontSize={9 * scale}
                dominantBaseline="middle"
                fill="#333"
              >
                {node.name}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

// Scale SVG path coordinates by a factor
function scaleSvgPath(d: string, scale: number): string {
  return d.replace(/[\d.]+/g, (match) => {
    const num = parseFloat(match);
    return isNaN(num) ? match : String(num * scale);
  });
}

// ── NodeTable (debug view) ──

function NodeTable({ nodes }: { nodes: D3Node[] }) {
  return (
    <div style={{ marginTop: 16, overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            {['id', 'type', 'depth', 'height', 'layer', 'x0', 'y0', 'value'].map((h) => (
              <th key={h} style={{ padding: '4px 8px', border: '1px solid #ddd', textAlign: 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.id}>
              <td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{node.id}</td>
              <td style={{ padding: '4px 8px', border: '1px solid #ddd', color: TYPE_COLORS[node.type] }}>{node.type}</td>
              <td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{node.depth}</td>
              <td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{node.height}</td>
              <td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{node.layer}</td>
              <td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{node.x0?.toFixed(1)}</td>
              <td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{node.y0?.toFixed(1)}</td>
              <td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{node.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
