import type {
  SubcontractGraph,
  BlockNode,
  BlockEdge,
  BlockOriginKind,
  FlowOrigin,
} from '@/types/subcontract';
export { formatYen } from '@/app/lib/sankey-svg-constants';
import { SEMANTIC_DIRECT, SEMANTIC_SUBCONTRACT, SEMANTIC_PROJECT_DEEP } from '@/app/lib/semantic-colors';

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

export const COLOR_DIRECT = SEMANTIC_DIRECT;
export const COLOR_SUBCONTRACT = SEMANTIC_SUBCONTRACT;
export const COLOR_ROOT = SEMANTIC_PROJECT_DEEP;
export const COLOR_EDGE = 'rgba(217,69,69,0.42)';

// ─── 型 ──────────────────────────────────────────────

export interface LayoutBlock {
  blockId: string;
  blockName: string;
  totalAmount: number;
  isDirect: boolean;
  originKind: BlockOriginKind;
  isTerminal: boolean;
  isZeroAmount: boolean;
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
  origin: FlowOrigin;
  isReference: boolean;
  targetIncomingBlockCount: number;
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

const MAX_DEPTH_LIMIT = 30;

/**
 * blockId → depth を BFS で計算する。
 *
 * 起点は2種類:
 *  - `f.sourceBlock === null` の direct ルート
 *  - `origin === 'separate-origin'` の別起点ブロック（5-2上で支出元として現れるが
 *    どの target としても現れない broad/strong 別起点）
 *
 * いずれも depth=1 から流す。
 */
export function computeDepths(flows: BlockEdge[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const queue: Array<{ blockId: string; depth: number }> = [];
  const children = new Map<string, string[]>();
  const separateOriginRoots = new Set<string>();

  for (const f of flows) {
    if (f.sourceBlock === null) {
      queue.push({ blockId: f.targetBlock, depth: 1 });
    } else {
      if (!children.has(f.sourceBlock)) children.set(f.sourceBlock, []);
      children.get(f.sourceBlock)!.push(f.targetBlock);
      if (f.origin === 'separate-origin') separateOriginRoots.add(f.sourceBlock);
    }
  }
  for (const root of separateOriginRoots) {
    queue.push({ blockId: root, depth: 1 });
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

export function mergeParallelFlows(flows: BlockEdge[]): BlockEdge[] {
  const byPair = new Map<string, BlockEdge & { noteSet: Set<string> }>();

  for (const flow of flows) {
    const key = [
      flow.sourceBlock ?? '__root__',
      flow.targetBlock,
      flow.origin,
      flow.isReference ? 'ref' : 'plain',
    ].join('->');
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

  // depth-1 を「direct/subcontract 群 → 別起点群」の順で並べ、各群内では金額降順
  const originRank = (k: BlockOriginKind): number =>
    k === 'separate-origin-strong' ? 2 : k === 'separate-origin-broad' ? 1 : 0;
  (byDepth.get(1) ?? []).sort((a, b) => {
    const r = originRank(a.originKind) - originRank(b.originKind);
    return r !== 0 ? r : b.totalAmount - a.totalAmount;
  });

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

  // ─── サブツリー帯（バンド）配置 ──────────────────────────────────
  // 各ノードを「最大金額の親」に付けてツリー化し、ノードは自分の子孫全体の幅（バンド）を
  // 専有する。あるブロックのバンドに他ブロックの子孫が入り込まないため、
  // 「無関係なブロックの真下に再々委託が来る」ことがない（横伸びは許容する設計判断）。
  // 親は自分のバンドの中央に置く（単一子の連鎖は真下に一直線になる）。
  const maxDepthVal = depthMap.size > 0 ? Math.max(...depthMap.values()) : 1;
  const nodeX = new Map<string, number>();

  const childrenOf = new Map<string, BlockNode[]>();
  const orphans: BlockNode[] = [];
  for (let depth = 2; depth <= maxDepthVal; depth++) {
    for (const node of byDepth.get(depth) ?? []) {
      const parents = immediateParents.get(node.blockId) ?? [];
      if (parents.length === 0) {
        // 順方向の親が特定できない（バックエッジ経由の到達等）→ 独立バンドとして右端に置く
        orphans.push(node);
        continue;
      }
      // fan-in（複数親）は最大金額の親のバンドに所属させる。他の親からのエッジは描画のみ
      let bestParentId = parents[0];
      let bestAmount = -Infinity;
      for (const pid of parents) {
        const amt = blockById.get(pid)?.totalAmount ?? -Infinity;
        if (amt > bestAmount) { bestAmount = amt; bestParentId = pid; }
      }
      if (!childrenOf.has(bestParentId)) childrenOf.set(bestParentId, []);
      childrenOf.get(bestParentId)!.push(node);
    }
  }
  for (const kids of childrenOf.values()) kids.sort((a, b) => b.totalAmount - a.totalAmount);

  // サブツリー幅の再帰計算（childrenOf は各ノード単一親のためforest。循環しない）
  const subtreeW = new Map<string, number>();
  const calcSubtreeW = (node: BlockNode): number => {
    const kids = childrenOf.get(node.blockId) ?? [];
    const w = kids.length === 0
      ? NODE_W
      : Math.max(NODE_W, kids.reduce((sum, k) => sum + calcSubtreeW(k), 0) + COL_GAP * (kids.length - 1));
    subtreeW.set(node.blockId, w);
    return w;
  };
  // バンド左端を起点にノードをバンド中央へ置き、子へ左から帯を配る
  const placeSubtree = (node: BlockNode, bandLeft: number): void => {
    const w = subtreeW.get(node.blockId) ?? NODE_W;
    nodeX.set(node.blockId, bandLeft + (w - NODE_W) / 2);
    let cursor = bandLeft;
    for (const kid of childrenOf.get(node.blockId) ?? []) {
      placeSubtree(kid, cursor);
      cursor += (subtreeW.get(kid.blockId) ?? NODE_W) + COL_GAP;
    }
  };

  const depth1Nodes = byDepth.get(1) ?? [];
  let bandCursor = SVG_MARGIN.left;
  for (const node of depth1Nodes) {
    calcSubtreeW(node);
    placeSubtree(node, bandCursor);
    bandCursor += subtreeW.get(node.blockId)! + COL_GAP;
  }
  for (const node of orphans) {
    calcSubtreeW(node);
    placeSubtree(node, bandCursor);
    bandCursor += subtreeW.get(node.blockId)! + COL_GAP;
  }

  // Y座標計算: depthごとに横一列で並べ、上から下へ流す。
  const layoutBlocks: LayoutBlock[] = [];
  let currentY = SVG_MARGIN.top + ROOT_H + DEPTH_GAP;

  for (const [depth, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    for (const node of nodes) {
      layoutBlocks.push({
        blockId: node.blockId,
        blockName: node.blockName,
        totalAmount: node.totalAmount,
        isDirect: node.isDirect,
        originKind: node.originKind,
        isTerminal: node.isTerminal,
        isZeroAmount: node.totalAmount === 0 && node.recipientCount === 0,
        depth,
        x: nodeX.get(node.blockId) ?? SVG_MARGIN.left,
        y: currentY,
        w: NODE_W,
        h: NODE_MIN_H,
        node,
      });
    }
    currentY += NODE_MIN_H + DEPTH_GAP;
  }

  // ルート: 全バンド（子孫を含む水平範囲全体）の中央（子が1個ならその真上になる）
  const hasBands = depth1Nodes.length > 0 || orphans.length > 0;
  const depth1MinX = SVG_MARGIN.left;
  const depth1MaxX = hasBands ? bandCursor - COL_GAP : SVG_MARGIN.left + ROOT_W;

  const root: LayoutRoot = {
    label: graph.projectName,
    x: (depth1MinX + depth1MaxX) / 2 - ROOT_W / 2,
    y: SVG_MARGIN.top,
    w: ROOT_W,
    h: ROOT_H,
  };

  // ルートが左マージンをはみ出す場合（深度1が単一ブロック等でROOT_Wの方が広いケース）は
  // 全体を右へシフトして左マージンを維持する
  const overhang = SVG_MARGIN.left - root.x;
  if (overhang > 0) {
    root.x += overhang;
    for (const lb of layoutBlocks) lb.x += overhang;
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
  const maxRight = Math.max(
    root.x + root.w,
    ...layoutBlocks.map((lb) => lb.x + lb.w),
    SVG_MARGIN.left + 100,
  );
  const maxX = maxRight + SVG_MARGIN.right;
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
