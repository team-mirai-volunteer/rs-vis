import type { SubcontractGraph, BlockNode, BlockEdge } from '@/types/subcontract';

// ─── 定数 ──────────────────────────────────────────────

export const NODE_W = 236;
export const NODE_MIN_H = 126;
export const NODE_PAD = 14;
export const COL_GAP = 28;
export const ROW_PAD = 22;
export const DEPTH_GAP = 92;
export const ROOT_W = 300;
export const ROOT_H = 136;
export const SVG_MARGIN = { top: 28, right: 36, bottom: 40, left: 36 };

export const COLOR_DIRECT = '#d94545';
export const COLOR_SUBCONTRACT = '#e07040';
export const COLOR_ROOT = '#3a9a5c';
export const COLOR_EDGE = 'rgba(217,69,69,0.42)';

// ─── 型 ──────────────────────────────────────────────

export interface LayoutBlock {
  blockId: string;
  blockName: string;
  totalAmount: number;
  isDirect: boolean;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  node: BlockNode;
}

export interface LayoutRoot {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutEdge {
  sourceBlock: string | null;
  targetBlock: string;
  note?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** true = バックエッジ（循環・参照フロー） */
  isBackEdge: boolean;
  /** true = 自己ループ（sourceBlock === targetBlock） */
  isSelfLoop: boolean;
}

export interface SubcontractLayout {
  root: LayoutRoot;
  blocks: LayoutBlock[];
  edges: LayoutEdge[];
  svgWidth: number;
  svgHeight: number;
}

// ─── ヘルパー ──────────────────────────────────────────────

function formatYen(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}兆円`;
  if (v >= 1e10) return `${Math.round(v / 1e8).toLocaleString()}億円`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}億円`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}万円`;
  return `${Math.round(v).toLocaleString()}円`;
}
export { formatYen };

const MAX_DEPTH_LIMIT = 30;

/** blockId → depth (BFS、Fan-In: 最大深さ採用、サイクル対策あり) */
function computeDepths(flows: BlockEdge[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const queue: Array<{ blockId: string; depth: number }> = [];
  const children = new Map<string, string[]>();

  for (const f of flows) {
    if (f.sourceBlock === null) {
      queue.push({ blockId: f.targetBlock, depth: 1 });
    } else {
      if (!children.has(f.sourceBlock)) children.set(f.sourceBlock, []);
      children.get(f.sourceBlock)!.push(f.targetBlock);
    }
  }

  while (queue.length > 0) {
    const { blockId, depth } = queue.shift()!;
    // 最小深さ採用: 既訪問ノードはスキップ（サイクル対策）
    if (depthMap.has(blockId) || depth > MAX_DEPTH_LIMIT) continue;
    depthMap.set(blockId, depth);
    for (const child of (children.get(blockId) ?? [])) {
      queue.push({ blockId: child, depth: depth + 1 });
    }
  }

  return depthMap;
}

function mergeParallelFlows(flows: BlockEdge[]): BlockEdge[] {
  const byPair = new Map<string, BlockEdge & { noteSet: Set<string> }>();

  for (const flow of flows) {
    const key = `${flow.sourceBlock ?? '__root__'}->${flow.targetBlock}`;
    const existing = byPair.get(key);
    if (!existing) {
      const noteSet = new Set<string>();
      if (flow.note?.trim()) noteSet.add(flow.note.trim());
      byPair.set(key, { ...flow, noteSet });
      continue;
    }
    if (flow.note?.trim()) existing.noteSet.add(flow.note.trim());
  }

  return [...byPair.values()].map(({ noteSet, ...flow }) => ({
    ...flow,
    note: noteSet.size > 0 ? [...noteSet].join(' / ') : undefined,
  }));
}

// ─── メインレイアウト関数 ──────────────────────────────────────────────

export function computeSubcontractLayout(graph: SubcontractGraph): SubcontractLayout {
  const depthMap = computeDepths(graph.flows);
  const mergedFlows = mergeParallelFlows(graph.flows);

  function rowWidthForDepth(nodeCount: number): number {
    const safeCount = Math.max(1, nodeCount);
    return safeCount * NODE_W + Math.max(0, safeCount - 1) * COL_GAP;
  }

  // ブロックノードをマップ化
  const blockById = new Map<string, BlockNode>();
  for (const b of graph.blocks) blockById.set(b.blockId, b);

  // 深さ別にブロックをグループ化
  const byDepth = new Map<number, BlockNode[]>();
  for (const [blockId, depth] of depthMap) {
    const node = blockById.get(blockId);
    if (!node) continue;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(node);
  }

  // depth-1 を金額降順でソート
  (byDepth.get(1) ?? []).sort((a, b) => b.totalAmount - a.totalAmount);

  // 各ブロックの「即時親」リスト（順方向エッジのみ: sourceDepth < targetDepth）
  const immediateParents = new Map<string, string[]>();
  for (const f of mergedFlows) {
    if (f.sourceBlock === null) continue;
    const sd = depthMap.get(f.sourceBlock) ?? -1;
    const td = depthMap.get(f.targetBlock) ?? -1;
    if (sd >= td) continue; // バックエッジは無視
    if (!immediateParents.has(f.targetBlock)) immediateParents.set(f.targetBlock, []);
    immediateParents.get(f.targetBlock)!.push(f.sourceBlock);
  }

  // 各深さを「親の layout 順位」基準で反復ソート
  // blockPosition: blockId → 当該深さでの順位（0始まり）
  const blockPosition = new Map<string, number>();
  (byDepth.get(1) ?? []).forEach((b, i) => blockPosition.set(b.blockId, i));

  const maxDepthVal = depthMap.size > 0 ? Math.max(...depthMap.values()) : 1;
  for (let depth = 2; depth <= maxDepthVal; depth++) {
    const nodes = byDepth.get(depth);
    if (!nodes) continue;
    nodes.sort((a, b) => {
      // 親の中の最小順位（fan-in 対応: 最も上にいる親に揃える）
      const minPos = (id: string) => {
        const ps = immediateParents.get(id) ?? [];
        return ps.length > 0 ? Math.min(...ps.map(p => blockPosition.get(p) ?? 9999)) : 9999;
      };
      const diff = minPos(a.blockId) - minPos(b.blockId);
      return diff !== 0 ? diff : b.totalAmount - a.totalAmount;
    });
    // ソート結果を次の深さの基準として登録
    nodes.forEach((b, i) => blockPosition.set(b.blockId, i));
  }

  // Y座標計算: depthごとに横一列で並べ、上から下へ流す。
  // 同一階層内で折り返すとリンク矢印が上下に交差して読みにくいため、
  // 横幅は使うが階層の意味が崩れない配置を優先する。
  const layoutBlocks: LayoutBlock[] = [];
  let currentY = SVG_MARGIN.top + ROOT_H + DEPTH_GAP;
  let maxRowWidth = ROOT_W;

  for (const [depth, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const cardsPerRow = Math.max(1, nodes.length);
    const rowWidth = cardsPerRow * NODE_W + Math.max(0, cardsPerRow - 1) * COL_GAP;
    maxRowWidth = Math.max(maxRowWidth, rowWidth);

    nodes.forEach((node, i) => {
      layoutBlocks.push({
        blockId: node.blockId,
        blockName: node.blockName,
        totalAmount: node.totalAmount,
        isDirect: node.isDirect,
        depth,
        x: SVG_MARGIN.left + i * (NODE_W + COL_GAP),
        y: currentY,
        w: NODE_W,
        h: NODE_MIN_H,
        node,
      });
    });

    currentY += NODE_MIN_H + DEPTH_GAP;
  }

  const contentWidth = maxRowWidth;

  const root: LayoutRoot = {
    label: graph.projectName,
    x: SVG_MARGIN.left + Math.max(0, (contentWidth - ROOT_W) / 2),
    y: SVG_MARGIN.top,
    w: ROOT_W,
    h: ROOT_H,
  };

  for (const lb of layoutBlocks) {
    lb.x += Math.max(0, (contentWidth - rowWidthForDepth(byDepth.get(lb.depth)?.length ?? 1)) / 2);
  }

  // LayoutBlock → マップ
  const layoutById = new Map<string, LayoutBlock>();
  for (const lb of layoutBlocks) layoutById.set(lb.blockId, lb);

  // エッジ計算
  const edges: LayoutEdge[] = [];
  for (const f of mergedFlows) {
    const target = layoutById.get(f.targetBlock);
    if (!target) continue;

    const isSelfLoop = f.sourceBlock === f.targetBlock;

    if (f.sourceBlock === null) {
      edges.push({
        ...f,
        x1: root.x + root.w / 2,
        y1: root.y + root.h,
        x2: target.x + target.w / 2,
        y2: target.y,
        isBackEdge: false,
        isSelfLoop: false,
      });
    } else {
      const source = layoutById.get(f.sourceBlock);
      if (!source) continue;

      // source.depth > target.depth のみバックエッジ（同一深さは順方向として扱う）
      const isBackEdge = isSelfLoop || source.depth > target.depth;

      if (isSelfLoop) {
        edges.push({
          ...f,
          x1: source.x + source.w,
          y1: source.y + source.h / 2,
          x2: source.x + source.w,
          y2: source.y + source.h / 2,
          isBackEdge: true,
          isSelfLoop: true,
        });
      } else if (isBackEdge) {
        edges.push({
          ...f,
          x1: source.x,
          y1: source.y + source.h / 2,
          x2: target.x,
          y2: target.y + target.h / 2,
          isBackEdge: true,
          isSelfLoop: false,
        });
      } else {
        edges.push({
          ...f,
          x1: source.x + source.w / 2,
          y1: source.y + source.h,
          x2: target.x + target.w / 2,
          y2: target.y,
          isBackEdge: false,
          isSelfLoop: false,
        });
      }
    }
  }

  // SVGサイズ
  const maxX = SVG_MARGIN.left + contentWidth + SVG_MARGIN.right;
  const maxY = Math.max(
    ...layoutBlocks.map((lb) => lb.y + lb.h),
    root.y + root.h,
    SVG_MARGIN.top + 100
  ) + SVG_MARGIN.bottom;

  return {
    root,
    blocks: layoutBlocks,
    edges,
    svgWidth: maxX,
    svgHeight: maxY,
  };
}

// ─── Squarified Treemap ──────────────────────────────────────────────

export interface TRect { x: number; y: number; w: number; h: number; }
export interface TItem { key: string; value: number; }
export interface TResult { key: string; rect: TRect; }

function _worstRatio(row: TItem[], rowValue: number, side: number, totalValue: number, container: TRect): number {
  if (rowValue <= 0 || side <= 0 || totalValue <= 0) return Infinity;
  const totalArea = container.w * container.h;
  const rowArea = totalArea * (rowValue / totalValue);
  const thickness = rowArea / side;
  let worst = 0;
  for (const item of row) {
    const len = totalArea * (item.value / totalValue) / thickness;
    const r = Math.max(thickness / len, len / thickness);
    if (r > worst) worst = r;
  }
  return worst;
}

/** Squarified Treemap (Bruls et al. 2000) — items を rect 内に面積比例で配置 */
export function squarifiedTreemap(items: TItem[], rect: TRect): TResult[] {
  if (items.length === 0) return [];
  const zeroRect = (it: TItem): TResult => ({ key: it.key, rect: { x: rect.x, y: rect.y, w: 0, h: 0 } });
  if (rect.w <= 0 || rect.h <= 0) return items.map(zeroRect);

  const positive = [...items].filter(it => it.value > 0).sort((a, b) => b.value - a.value);
  const zeros = items.filter(it => it.value <= 0);
  if (positive.length === 0) return items.map(zeroRect);
  const results: TResult[] = [];
  let rem = { ...rect };
  let remValue = positive.reduce((s, it) => s + it.value, 0);
  let idx = 0;

  while (idx < positive.length) {
    const isVert = rem.w >= rem.h;
    const side = isVert ? rem.h : rem.w;
    const row: TItem[] = [positive[idx]];
    let rowValue = positive[idx].value;
    idx++;

    while (idx < positive.length) {
      const cand = positive[idx];
      const newVal = rowValue + cand.value;
      if (_worstRatio([...row, cand], newVal, side, remValue, rem) > _worstRatio(row, rowValue, side, remValue, rem)) break;
      row.push(cand);
      rowValue = newVal;
      idx++;
    }

    const thickness = (rem.w * rem.h) * (rowValue / remValue) / side;
    let offset = 0;
    for (const item of row) {
      const len = side * (item.value / rowValue);
      results.push({
        key: item.key,
        rect: isVert
          ? { x: rem.x, y: rem.y + offset, w: thickness, h: len }
          : { x: rem.x + offset, y: rem.y, w: len, h: thickness },
      });
      offset += len;
    }

    if (isVert) { rem = { x: rem.x + thickness, y: rem.y, w: rem.w - thickness, h: rem.h }; }
    else        { rem = { x: rem.x, y: rem.y + thickness, w: rem.w, h: rem.h - thickness }; }
    remValue -= rowValue;
  }

  for (const item of zeros) {
    results.push({ key: item.key, rect: { x: rect.x, y: rect.y, w: 0, h: 0 } });
  }
  return results;
}

/** 順方向エッジ: ソース右端 → ターゲット左端 */
export function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

/** バックエッジ: 左側を通る弧 (ソース左端 → ターゲット左端) */
export function backEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const arcX = Math.min(x1, x2) - 40;
  return `M ${x1} ${y1} C ${arcX} ${y1}, ${arcX} ${y2}, ${x2} ${y2}`;
}

/** 自己ループ: ノード右端から小さなループを描く */
export function selfLoopPath(x: number, y: number): string {
  const r = 20;
  return `M ${x} ${y - 6} C ${x + r * 2} ${y - r}, ${x + r * 2} ${y + r}, ${x} ${y + 6}`;
}
