'use client';

import { useState, useMemo } from 'react';

// ── Types ──

interface Node {
  id: string;
  name: string;
  type: string;
  value?: number;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  sourceLinks?: Link[];
  targetLinks?: Link[];
}

interface Link {
  source: Node;
  target: Node;
  value: number;
  sourceWidth?: number;
  targetWidth?: number;
  y0?: number; // top edge at source
  y1?: number; // top edge at target
}

interface TestData {
  label: string;
  description: string;
  nodes: { id: string; name: string; type: string }[];
  links: { source: string; target: string; value: number }[];
}

// ── Test Data ──

const PATTERN_SIMPLE: TestData = {
  label: '1:1 接続',
  description: '各ノードが1対1で接続',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (300)', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B (200)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (300)', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2 (200)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (300)', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2 (200)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (300)', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B (200)', type: 'recipient' },
  ],
  links: [
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 300 },
    { source: 'ministry-budget-2', target: 'project-budget-2', value: 200 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 300 },
    { source: 'project-budget-2', target: 'project-spending-2', value: 200 },
    { source: 'project-spending-1', target: 'recipient-1', value: 300 },
    { source: 'project-spending-2', target: 'recipient-2', value: 200 },
  ],
};

const PATTERN_FAN_OUT: TestData = {
  label: '1→N 分岐',
  description: '1つの事業(支出)から3つの支出先へ分岐（100+150+50=300）',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (300)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (300)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (300)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (100)', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B (150)', type: 'recipient' },
    { id: 'recipient-3', name: '支出先C (50)', type: 'recipient' },
  ],
  links: [
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 300 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 300 },
    { source: 'project-spending-1', target: 'recipient-1', value: 100 },
    { source: 'project-spending-1', target: 'recipient-2', value: 150 },
    { source: 'project-spending-1', target: 'recipient-3', value: 50 },
  ],
};

const PATTERN_FAN_IN: TestData = {
  label: 'N→1 合流',
  description: '3つの事業(支出)から1つの支出先へ合流（100+150+50=300）',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (100)', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B (150)', type: 'ministry-budget' },
    { id: 'ministry-budget-3', name: '省庁C (50)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (100)', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2 (150)', type: 'project-budget' },
    { id: 'project-budget-3', name: '事業3 (50)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (100)', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2 (150)', type: 'project-spending' },
    { id: 'project-spending-3', name: '支出3 (50)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (300)', type: 'recipient' },
  ],
  links: [
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 100 },
    { source: 'ministry-budget-2', target: 'project-budget-2', value: 150 },
    { source: 'ministry-budget-3', target: 'project-budget-3', value: 50 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 100 },
    { source: 'project-budget-2', target: 'project-spending-2', value: 150 },
    { source: 'project-budget-3', target: 'project-spending-3', value: 50 },
    { source: 'project-spending-1', target: 'recipient-1', value: 100 },
    { source: 'project-spending-2', target: 'recipient-1', value: 150 },
    { source: 'project-spending-3', target: 'recipient-1', value: 50 },
  ],
};

const PATTERN_MANY_TO_MANY: TestData = {
  label: 'N→M 多対多',
  description: '2事業(支出)→3支出先: 事業1(200→A:80,B:70,C:50) 事業2(150→A:40,B:60,C:50)',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (200)', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B (150)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (200)', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2 (150)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (200)', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2 (150)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (120)', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B (130)', type: 'recipient' },
    { id: 'recipient-3', name: '支出先C (100)', type: 'recipient' },
  ],
  links: [
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 200 },
    { source: 'ministry-budget-2', target: 'project-budget-2', value: 150 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 200 },
    { source: 'project-budget-2', target: 'project-spending-2', value: 150 },
    // Many-to-many: spending → recipients
    { source: 'project-spending-1', target: 'recipient-1', value: 80 },
    { source: 'project-spending-1', target: 'recipient-2', value: 70 },
    { source: 'project-spending-1', target: 'recipient-3', value: 50 },
    { source: 'project-spending-2', target: 'recipient-1', value: 40 },
    { source: 'project-spending-2', target: 'recipient-2', value: 60 },
    { source: 'project-spending-2', target: 'recipient-3', value: 50 },
  ],
};

const PATTERN_UNEVEN: TestData = {
  label: '大小混在',
  description: '極端に大きいノードと小さいノードが混在（1000 vs 10）',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (1000)', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B (10)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (1000)', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2 (10)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (1000)', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2 (10)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (600)', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B (400)', type: 'recipient' },
    { id: 'recipient-3', name: '支出先C (10)', type: 'recipient' },
  ],
  links: [
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 1000 },
    { source: 'ministry-budget-2', target: 'project-budget-2', value: 10 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 1000 },
    { source: 'project-budget-2', target: 'project-spending-2', value: 10 },
    { source: 'project-spending-1', target: 'recipient-1', value: 600 },
    { source: 'project-spending-1', target: 'recipient-2', value: 400 },
    { source: 'project-spending-2', target: 'recipient-3', value: 10 },
  ],
};

const PATTERN_LAYER_MISMATCH_1: TestData = {
  label: '列数不一致 (2→3→2→4)',
  description: '省庁2→事業3→支出2→支出先4: 中間層でノード数が増減',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (400)', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B (200)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (300)', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2 (200)', type: 'project-budget' },
    { id: 'project-budget-3', name: '事業3 (100)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (400)', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2 (200)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (150)', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B (200)', type: 'recipient' },
    { id: 'recipient-3', name: '支出先C (100)', type: 'recipient' },
    { id: 'recipient-4', name: '支出先D (150)', type: 'recipient' },
  ],
  links: [
    // 省庁→事業: 1省庁が複数事業に分岐
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 300 },
    { source: 'ministry-budget-1', target: 'project-budget-3', value: 100 },
    { source: 'ministry-budget-2', target: 'project-budget-2', value: 200 },
    // 事業→支出: 複数事業が少ない支出に合流
    { source: 'project-budget-1', target: 'project-spending-1', value: 300 },
    { source: 'project-budget-2', target: 'project-spending-2', value: 200 },
    { source: 'project-budget-3', target: 'project-spending-1', value: 100 },
    // 支出→支出先: 少ない支出から多い支出先へ分岐
    { source: 'project-spending-1', target: 'recipient-1', value: 150 },
    { source: 'project-spending-1', target: 'recipient-2', value: 100 },
    { source: 'project-spending-1', target: 'recipient-4', value: 150 },
    { source: 'project-spending-2', target: 'recipient-2', value: 100 },
    { source: 'project-spending-2', target: 'recipient-3', value: 100 },
  ],
};

const PATTERN_LAYER_MISMATCH_2: TestData = {
  label: '列数不一致 (3→1→3→2)',
  description: '省庁3→事業1→支出3→支出先2: ボトルネック（事業1つに集約）',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (200)', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B (300)', type: 'ministry-budget' },
    { id: 'ministry-budget-3', name: '省庁C (100)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (600)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (200)', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2 (300)', type: 'project-spending' },
    { id: 'project-spending-3', name: '支出3 (100)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (350)', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B (250)', type: 'recipient' },
  ],
  links: [
    // 3省庁 → 1事業
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 200 },
    { source: 'ministry-budget-2', target: 'project-budget-1', value: 300 },
    { source: 'ministry-budget-3', target: 'project-budget-1', value: 100 },
    // 1事業 → 3支出
    { source: 'project-budget-1', target: 'project-spending-1', value: 200 },
    { source: 'project-budget-1', target: 'project-spending-2', value: 300 },
    { source: 'project-budget-1', target: 'project-spending-3', value: 100 },
    // 3支出 → 2支出先
    { source: 'project-spending-1', target: 'recipient-1', value: 200 },
    { source: 'project-spending-2', target: 'recipient-1', value: 150 },
    { source: 'project-spending-2', target: 'recipient-2', value: 150 },
    { source: 'project-spending-3', target: 'recipient-2', value: 100 },
  ],
};

const PATTERN_LAYER_MISMATCH_3: TestData = {
  label: '列数不一致 (1→5→2→1)',
  description: '省庁1→事業5→支出2→支出先1: 中間層が大きく膨らむ',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (500)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (150)', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2 (120)', type: 'project-budget' },
    { id: 'project-budget-3', name: '事業3 (100)', type: 'project-budget' },
    { id: 'project-budget-4', name: '事業4 (80)', type: 'project-budget' },
    { id: 'project-budget-5', name: '事業5 (50)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (300)', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2 (200)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (500)', type: 'recipient' },
  ],
  links: [
    // 1省庁 → 5事業
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 150 },
    { source: 'ministry-budget-1', target: 'project-budget-2', value: 120 },
    { source: 'ministry-budget-1', target: 'project-budget-3', value: 100 },
    { source: 'ministry-budget-1', target: 'project-budget-4', value: 80 },
    { source: 'ministry-budget-1', target: 'project-budget-5', value: 50 },
    // 5事業 → 2支出 (合流)
    { source: 'project-budget-1', target: 'project-spending-1', value: 150 },
    { source: 'project-budget-2', target: 'project-spending-1', value: 120 },
    { source: 'project-budget-3', target: 'project-spending-1', value: 30 },
    { source: 'project-budget-3', target: 'project-spending-2', value: 70 },
    { source: 'project-budget-4', target: 'project-spending-2', value: 80 },
    { source: 'project-budget-5', target: 'project-spending-2', value: 50 },
    // 2支出 → 1支出先
    { source: 'project-spending-1', target: 'recipient-1', value: 300 },
    { source: 'project-spending-2', target: 'recipient-1', value: 200 },
  ],
};

const PATTERN_DEAD_END: TestData = {
  label: '中間止まり',
  description: '一部の事業(支出)に支出先がない（支出2,3は行き止まり）',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (500)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (200)', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2 (200)', type: 'project-budget' },
    { id: 'project-budget-3', name: '事業3 (100)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (200)', type: 'project-spending' },
    { id: 'project-spending-2', name: '支出2 (200) ※行止', type: 'project-spending' },
    { id: 'project-spending-3', name: '支出3 (100) ※行止', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (120)', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B (80)', type: 'recipient' },
  ],
  links: [
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 200 },
    { source: 'ministry-budget-1', target: 'project-budget-2', value: 200 },
    { source: 'ministry-budget-1', target: 'project-budget-3', value: 100 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 200 },
    { source: 'project-budget-2', target: 'project-spending-2', value: 200 },
    { source: 'project-budget-3', target: 'project-spending-3', value: 100 },
    // spending-1 だけ支出先あり、spending-2,3 は行き止まり
    { source: 'project-spending-1', target: 'recipient-1', value: 120 },
    { source: 'project-spending-1', target: 'recipient-2', value: 80 },
  ],
};

const PATTERN_SKIP_LAYER: TestData = {
  label: '中間飛ばし',
  description: '省庁→支出先に直接リンク（事業層を飛ばす）+ 通常ルートが混在',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (300)', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B (200)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (200)', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (200)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (300)', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B (200)', type: 'recipient' },
  ],
  links: [
    // 通常ルート: 省庁A → 事業1 → 支出1 → 支出先A
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 200 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 200 },
    { source: 'project-spending-1', target: 'recipient-1', value: 200 },
    // 飛ばしルート: 省庁A → 支出先A（事業・支出を飛ばす）
    { source: 'ministry-budget-1', target: 'recipient-1', value: 100 },
    // 飛ばしルート: 省庁B → 支出先B（全中間層を飛ばす）
    { source: 'ministry-budget-2', target: 'recipient-2', value: 200 },
  ],
};

const PATTERN_MIXED_EDGE: TestData = {
  label: '混合（行止+飛ばし+通常）',
  description: '行き止まり・中間飛ばし・通常ルートが全て混在',
  nodes: [
    { id: 'ministry-budget-1', name: '省庁A (400)', type: 'ministry-budget' },
    { id: 'ministry-budget-2', name: '省庁B (150)', type: 'ministry-budget' },
    { id: 'project-budget-1', name: '事業1 (250)', type: 'project-budget' },
    { id: 'project-budget-2', name: '事業2 (150) ※行止', type: 'project-budget' },
    { id: 'project-spending-1', name: '支出1 (250)', type: 'project-spending' },
    { id: 'recipient-1', name: '支出先A (200)', type: 'recipient' },
    { id: 'recipient-2', name: '支出先B (150)', type: 'recipient' },
    { id: 'recipient-3', name: '支出先C (150)', type: 'recipient' },
  ],
  links: [
    // 通常: 省庁A → 事業1 → 支出1 → 支出先A,B
    { source: 'ministry-budget-1', target: 'project-budget-1', value: 250 },
    { source: 'project-budget-1', target: 'project-spending-1', value: 250 },
    { source: 'project-spending-1', target: 'recipient-1', value: 150 },
    { source: 'project-spending-1', target: 'recipient-2', value: 100 },
    // 行き止まり: 省庁A → 事業2（支出先なし）
    { source: 'ministry-budget-1', target: 'project-budget-2', value: 150 },
    // 飛ばし: 省庁B → 支出先B,C（中間層を全て飛ばす）
    { source: 'ministry-budget-2', target: 'recipient-2', value: 50 },
    { source: 'ministry-budget-2', target: 'recipient-3', value: 100 },
  ],
};

const TEST_PATTERNS = [
  PATTERN_SIMPLE, PATTERN_FAN_OUT, PATTERN_FAN_IN, PATTERN_MANY_TO_MANY, PATTERN_UNEVEN,
  PATTERN_LAYER_MISMATCH_1, PATTERN_LAYER_MISMATCH_2, PATTERN_LAYER_MISMATCH_3,
  PATTERN_DEAD_END, PATTERN_SKIP_LAYER, PATTERN_MIXED_EDGE,
];

// ── Layout constants ──

const COL_MAP: Record<string, number> = {
  'ministry-budget': 0,
  'project-budget': 1,
  'project-spending': 2,
  'recipient': 3,
};

const SVG_W = 700;
const SVG_H = 400;
const MARGIN = { top: 30, right: 90, bottom: 10, left: 70 };
const INNER_W = SVG_W - MARGIN.left - MARGIN.right;
const INNER_H = SVG_H - MARGIN.top - MARGIN.bottom;
const NODE_W = 24;
const NODE_PAD = 14;

const TYPE_COLORS: Record<string, string> = {
  'ministry-budget': '#4e79a7',
  'project-budget': '#59a14f',
  'project-spending': '#f28e2b',
  'recipient': '#e15759',
};

const COLUMN_LABELS = ['省庁', '事業(予算)', '事業(支出)', '支出先'];

// ── Custom Layout Engine ──

/** Stack nodes vertically with value-proportional heights, aligned to top */
function stackColumn(colNodes: Node[], ky: number) {
  let y = 0;
  for (const node of colNodes) {
    const h = Math.max(2, (node.value ?? 1) * ky);
    node.y0 = y;
    node.y1 = y + h;
    y += h + NODE_PAD;
  }
}


function computeLayout(data: TestData) {
  const colSpacing = (INNER_W - NODE_W) / 3;

  // Build nodes
  const nodeMap = new Map<string, Node>();
  for (const n of data.nodes) {
    nodeMap.set(n.id, { ...n, value: 0, sourceLinks: [], targetLinks: [] });
  }

  // Build links
  const links: Link[] = [];
  for (const l of data.links) {
    const src = nodeMap.get(l.source);
    const tgt = nodeMap.get(l.target);
    if (!src || !tgt) continue;
    const link: Link = { source: src, target: tgt, value: l.value };
    links.push(link);
    src.sourceLinks!.push(link);
    tgt.targetLinks!.push(link);
  }

  const nodes = Array.from(nodeMap.values());

  // Node values = max(in, out)
  for (const node of nodes) {
    const srcSum = node.sourceLinks!.reduce((s, l) => s + l.value, 0);
    const tgtSum = node.targetLinks!.reduce((s, l) => s + l.value, 0);
    node.value = Math.max(srcSum, tgtSum);
  }

  // Group by column
  const columns: Map<number, Node[]> = new Map();
  for (const node of nodes) {
    const col = COL_MAP[node.type] ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  // Global ky (same scale for all columns)
  let ky = Infinity;
  for (const [, colNodes] of columns) {
    const totalValue = colNodes.reduce((s, n) => s + (n.value ?? 1), 0);
    const totalPadding = Math.max(0, (colNodes.length - 1) * NODE_PAD);
    const available = INNER_H - totalPadding;
    if (totalValue > 0) ky = Math.min(ky, available / totalValue);
  }
  if (!isFinite(ky)) ky = 1;

  // Assign x and initial y (stacked)
  const sortedCols = Array.from(columns.entries()).sort((a, b) => a[0] - b[0]);
  for (const [col, colNodes] of sortedCols) {
    for (const node of colNodes) {
      node.x0 = col * colSpacing;
      node.x1 = node.x0 + NODE_W;
    }
    stackColumn(colNodes, ky);
  }


  // Compute link widths and y positions
  for (const node of nodes) {
    const nodeHeight = (node.y1 ?? 0) - (node.y0 ?? 0);
    const totalSrcValue = node.sourceLinks!.reduce((s, l) => s + l.value, 0);
    const totalTgtValue = node.targetLinks!.reduce((s, l) => s + l.value, 0);

    let sy = node.y0 ?? 0;
    for (const link of node.sourceLinks!) {
      const proportion = totalSrcValue > 0 ? link.value / totalSrcValue : 0;
      link.sourceWidth = nodeHeight * proportion;
      link.y0 = sy;
      sy += link.sourceWidth;
    }

    let ty = node.y0 ?? 0;
    for (const link of node.targetLinks!) {
      const proportion = totalTgtValue > 0 ? link.value / totalTgtValue : 0;
      link.targetWidth = nodeHeight * proportion;
      link.y1 = ty;
      ty += link.targetWidth;
    }
  }

  return { nodes, links, ky };
}

// Ribbon path: source right edge → target left edge
function ribbonPath(link: Link): string {
  const sx = link.source.x1 ?? 0;
  const tx = link.target.x0 ?? 0;
  const sTop = link.y0 ?? 0;
  const sBot = sTop + (link.sourceWidth ?? 0);
  const tTop = link.y1 ?? 0;
  const tBot = tTop + (link.targetWidth ?? 0);
  const mx = (sx + tx) / 2;
  return `M${sx},${sTop}C${mx},${sTop} ${mx},${tTop} ${tx},${tTop}`
    + `L${tx},${tBot}`
    + `C${mx},${tBot} ${mx},${sBot} ${sx},${sBot}Z`;
}

// ── Component ──

export default function CustomSankeyLabPage() {
  const [selectedPattern, setSelectedPattern] = useState(3); // default: many-to-many

  const layout = useMemo(() => computeLayout(TEST_PATTERNS[selectedPattern]), [selectedPattern]);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', background: '#f8f9fa', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Custom Sankey Lab</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>d3-sankey 不使用 — 自前レイアウト + リボンエッジ</p>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TEST_PATTERNS.map((p, i) => (
          <button
            key={i}
            onClick={() => setSelectedPattern(i)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              border: '1px solid #ccc',
              borderRadius: 4,
              background: i === selectedPattern ? '#333' : '#fff',
              color: i === selectedPattern ? '#fff' : '#333',
              cursor: 'pointer',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <p style={{ fontSize: 13, marginBottom: 12 }}>{TEST_PATTERNS[selectedPattern].description}</p>

      {/* Sankey SVG */}
      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 4, display: 'inline-block' }}>
        <svg width={SVG_W} height={SVG_H}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Column labels */}
            {COLUMN_LABELS.map((label, i) => {
              const x = (i / 3) * INNER_W;
              return (
                <text key={i} x={x + NODE_W / 2} y={-10} textAnchor="middle" fontSize={11} fill="#999">
                  {label}
                </text>
              );
            })}

            {/* Column guide lines */}
            {[0, 1, 2, 3].map((i) => {
              const x = (i / 3) * INNER_W;
              return <line key={i} x1={x} y1={0} x2={x} y2={INNER_H} stroke="#f0f0f0" strokeDasharray="4,4" />;
            })}

            {/* Links */}
            {layout.links.map((link, i) => (
              <path
                key={i}
                d={ribbonPath(link)}
                fill={TYPE_COLORS[link.source.type] || '#ccc'}
                fillOpacity={0.35}
                stroke={TYPE_COLORS[link.source.type] || '#ccc'}
                strokeOpacity={0.15}
                strokeWidth={0.5}
              />
            ))}

            {/* Nodes */}
            {layout.nodes.map((node) => (
              <g key={node.id}>
                <rect
                  x={node.x0}
                  y={node.y0}
                  width={(node.x1 ?? 0) - (node.x0 ?? 0)}
                  height={Math.max(1, (node.y1 ?? 0) - (node.y0 ?? 0))}
                  fill={TYPE_COLORS[node.type] || '#ccc'}
                  rx={2}
                />
                <text
                  x={(node.x1 ?? 0) + 4}
                  y={(node.y0 ?? 0) + ((node.y1 ?? 0) - (node.y0 ?? 0)) / 2}
                  fontSize={10}
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

      {/* Link detail table */}
      <h2 style={{ fontSize: 14, marginTop: 20, marginBottom: 8 }}>エッジ詳細（Out-In値の検証）</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              {['Source', 'Target', 'Value', 'Source幅(px)', 'Target幅(px)', 'Source Y範囲', 'Target Y範囲', 'Source側%', 'Target側%'].map((h) => (
                <th key={h} style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {layout.links.map((link, i) => {
              const srcTotal = link.source.sourceLinks!.reduce((s, l) => s + l.value, 0);
              const tgtTotal = link.target.targetLinks!.reduce((s, l) => s + l.value, 0);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd' }}>{link.source.name}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd' }}>{link.target.name}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{link.value}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{link.sourceWidth?.toFixed(1)}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{link.targetWidth?.toFixed(1)}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd' }}>{link.y0?.toFixed(1)} → {((link.y0 ?? 0) + (link.sourceWidth ?? 0)).toFixed(1)}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd' }}>{link.y1?.toFixed(1)} → {((link.y1 ?? 0) + (link.targetWidth ?? 0)).toFixed(1)}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{srcTotal > 0 ? ((link.value / srcTotal) * 100).toFixed(1) : 0}%</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{tgtTotal > 0 ? ((link.value / tgtTotal) * 100).toFixed(1) : 0}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Node detail table */}
      <h2 style={{ fontSize: 14, marginTop: 20, marginBottom: 8 }}>ノード詳細</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              {['Node', 'Type', 'Value', 'Height(px)', 'Y範囲', 'Out合計', 'In合計', 'OutLinks', 'InLinks'].map((h) => (
                <th key={h} style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {layout.nodes.map((node, i) => {
              const outSum = node.sourceLinks!.reduce((s, l) => s + l.value, 0);
              const inSum = node.targetLinks!.reduce((s, l) => s + l.value, 0);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd' }}>{node.name}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', color: TYPE_COLORS[node.type] }}>{node.type}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{node.value}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{((node.y1 ?? 0) - (node.y0 ?? 0)).toFixed(1)}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd' }}>{node.y0?.toFixed(1)} → {node.y1?.toFixed(1)}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{outSum}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{inSum}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{node.sourceLinks!.length}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #ddd', textAlign: 'right' }}>{node.targetLinks!.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 20, display: 'flex', gap: 16, fontSize: 12 }}>
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
