/**
 * /sankey2 レイアウト計算スクリプト（Treemapクラスタ版）
 *
 * sankey2-graph.json からノード座標・エッジBezierパスを事前計算し、
 * sankey2-layout.json に出力する。
 *
 * レイアウト方針:
 *   - 5つのtypeクラスタ（total, ministry, project-budget, project-spending, recipient）
 *   - 各クラスタ内は Squarified Treemap で面積∝金額の矩形配置
 *   - 事業/支出先クラスタは2段階treemap（府省庁グループ→個別ノード）
 *   - エッジ: 右辺中央→左辺中央の3次Bezier曲線
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── 定数 ──────────────────────────────────────────────

/** クラスタ配置 */
const CLUSTER_WIDTH = 4000;    // 各クラスタの幅
const CLUSTER_HEIGHT = 4000;   // 各クラスタの高さ
const CLUSTER_GAP = 1200;      // クラスタ間のギャップ（エッジ描画用）
const NODE_GAP = 1;            // treemap内ノード間のギャップ(px)

/** クラスタ定義（左→右の順序） */
const CLUSTER_TYPES = ['total', 'ministry', 'project-budget', 'project-spending', 'recipient'] as const;

/** Bezier制御点のオフセット比率（水平距離の40%） */
const BEZIER_CONTROL_RATIO = 0.4;

/** Bezierパスの分割数 */
const BEZIER_SEGMENTS = 12;

// ─── 型定義 ──────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  type: string;
  amount: number;
  projectId?: number;
  ministry?: string;
  isIndirect?: boolean;
  chainPaths?: string[];
}

interface GraphEdge {
  source: string;
  target: string;
  value: number;
  edgeType?: 'direct' | 'subcontract';
  projectIds?: number[];
}

interface GraphData {
  metadata: Record<string, unknown>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  subcontractChains?: unknown[];
}

interface LayoutNode {
  id: string;
  label: string;
  type: string;
  amount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  ministry?: string;
  projectId?: number;
  isIndirect?: boolean;
  chainPaths?: string[];
}

interface LayoutEdge {
  source: string;
  target: string;
  value: number;
  path: [number, number][];
  width: number;
  edgeType?: 'direct' | 'subcontract';
  projectIds?: number[];
}

interface LayoutData {
  metadata: Record<string, unknown> & {
    layout: {
      totalWidth: number;
      totalHeight: number;
      nodeCount: number;
      edgeCount: number;
      clusterWidth: number;
      clusterHeight: number;
      clusterGap: number;
    };
  };
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  subcontractChains?: unknown[];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Squarified Treemap ──────────────────────────────────

interface TreemapItem {
  key: string;
  value: number;
  data?: GraphNode;  // リーフノードの場合
  children?: TreemapItem[];  // サブグループの場合
}

interface TreemapResult {
  key: string;
  rect: Rect;
  data?: GraphNode;
}

/**
 * Squarified Treemap (Bruls et al. 2000)
 * items を rect 内に面積比例で配置する
 */
function squarifiedTreemap(items: TreemapItem[], rect: Rect): TreemapResult[] {
  if (items.length === 0) return [];

  const totalValue = items.reduce((s, it) => s + it.value, 0);
  if (totalValue <= 0) {
    // 全て0のケース: 均等分割
    return items.map((it, i) => ({
      key: it.key,
      rect: {
        x: rect.x,
        y: rect.y + (rect.height / items.length) * i,
        width: rect.width,
        height: rect.height / items.length,
      },
      data: it.data,
    }));
  }

  // value>0のアイテムのみsquarify、value<=0は座標0のノードとして追加
  const positiveItems = items.filter(it => it.value > 0);
  const zeroItems = items.filter(it => it.value <= 0);

  // 面積降順ソート
  const sorted = [...positiveItems].sort((a, b) => b.value - a.value);

  const results: TreemapResult[] = [];
  let remaining = { ...rect };
  let remainingValue = positiveItems.reduce((s, it) => s + it.value, 0);
  let idx = 0;

  while (idx < sorted.length) {
    const isVerticalSlice = remaining.width >= remaining.height;
    const sideLength = isVerticalSlice ? remaining.height : remaining.width;

    // 行を構築: アスペクト比が改善する限り追加
    const row: TreemapItem[] = [sorted[idx]];
    let rowValue = sorted[idx].value;
    idx++;

    while (idx < sorted.length) {
      const candidate = sorted[idx];
      const newRowValue = rowValue + candidate.value;
      if (worstRatio(row, rowValue, sideLength, remainingValue, remaining) <=
          worstRatio([...row, candidate], newRowValue, sideLength, remainingValue, remaining)) {
        break;
      }
      row.push(candidate);
      rowValue = newRowValue;
      idx++;
    }

    // 行を配置
    const rowFraction = rowValue / remainingValue;
    const rowThickness = isVerticalSlice
      ? remaining.width * rowFraction
      : remaining.height * rowFraction;

    let offset = 0;
    for (const item of row) {
      const itemFraction = item.value / rowValue;
      const itemLength = sideLength * itemFraction;

      const itemRect: Rect = isVerticalSlice
        ? {
            x: remaining.x,
            y: remaining.y + offset,
            width: rowThickness,
            height: itemLength,
          }
        : {
            x: remaining.x + offset,
            y: remaining.y,
            width: itemLength,
            height: rowThickness,
          };

      results.push({ key: item.key, rect: itemRect, data: item.data });
      offset += itemLength;
    }

    // 残り領域を更新
    if (isVerticalSlice) {
      remaining = {
        x: remaining.x + rowThickness,
        y: remaining.y,
        width: remaining.width - rowThickness,
        height: remaining.height,
      };
    } else {
      remaining = {
        x: remaining.x,
        y: remaining.y + rowThickness,
        width: remaining.width,
        height: remaining.height - rowThickness,
      };
    }
    remainingValue -= rowValue;
  }

  // value<=0のアイテムを座標0サイズで追加
  for (const item of zeroItems) {
    results.push({
      key: item.key,
      rect: { x: rect.x, y: rect.y, width: 0, height: 0 },
      data: item.data,
    });
  }

  return results;
}

/** 順序保持treemap: squarifyの行構築ロジックを使い、入力順を保持 */
function sliceTreemap(items: TreemapItem[], rect: Rect): TreemapResult[] {
  if (items.length === 0) return [];

  const totalValue = items.reduce((s, it) => s + it.value, 0);
  if (totalValue <= 0) {
    return items.map((it, i) => ({
      key: it.key,
      rect: { x: rect.x, y: rect.y + (rect.height / items.length) * i, width: rect.width, height: rect.height / items.length },
      data: it.data,
    }));
  }

  const positiveItems = items.filter(it => it.value > 0);
  const zeroItems = items.filter(it => it.value <= 0);
  const results: TreemapResult[] = [];

  let remaining = { ...rect };
  let remainingValue = positiveItems.reduce((s, it) => s + it.value, 0);
  let idx = 0;

  while (idx < positiveItems.length) {
    const isVerticalSlice = remaining.width >= remaining.height;
    const sideLength = isVerticalSlice ? remaining.height : remaining.width;

    // 行を構築: アスペクト比が改善する限りアイテムを追加（squarify方式）
    const row: TreemapItem[] = [positiveItems[idx]];
    let rowValue = positiveItems[idx].value;
    idx++;

    while (idx < positiveItems.length) {
      const candidate = positiveItems[idx];
      const newRowValue = rowValue + candidate.value;
      const currentWorst = worstRatio(row, rowValue, sideLength, remainingValue, remaining);
      const newWorst = worstRatio([...row, candidate], newRowValue, sideLength, remainingValue, remaining);
      if (newWorst > currentWorst) break;
      row.push(candidate);
      rowValue = newRowValue;
      idx++;
    }

    // 行を配置
    const rowFraction = rowValue / remainingValue;
    const rowThickness = isVerticalSlice
      ? remaining.width * rowFraction
      : remaining.height * rowFraction;

    let offset = 0;
    for (const item of row) {
      const itemFraction = item.value / rowValue;
      const itemLength = sideLength * itemFraction;

      const itemRect: Rect = isVerticalSlice
        ? { x: remaining.x, y: remaining.y + offset, width: rowThickness, height: itemLength }
        : { x: remaining.x + offset, y: remaining.y, width: itemLength, height: rowThickness };

      results.push({ key: item.key, rect: itemRect, data: item.data });
      offset += itemLength;
    }

    // 残り領域を更新
    if (isVerticalSlice) {
      remaining = { x: remaining.x + rowThickness, y: remaining.y, width: remaining.width - rowThickness, height: remaining.height };
    } else {
      remaining = { x: remaining.x, y: remaining.y + rowThickness, width: remaining.width, height: remaining.height - rowThickness };
    }
    remainingValue -= rowValue;
  }

  for (const item of zeroItems) {
    results.push({ key: item.key, rect: { x: rect.x, y: rect.y, width: 0, height: 0 }, data: item.data });
  }

  return results;
}

/** アスペクト比の最悪値を計算 */
function worstRatio(
  row: TreemapItem[],
  rowValue: number,
  sideLength: number,
  totalValue: number,
  container: Rect
): number {
  if (rowValue <= 0 || sideLength <= 0 || totalValue <= 0) return Infinity;

  const totalArea = container.width * container.height;
  const rowArea = totalArea * (rowValue / totalValue);
  const rowThickness = rowArea / sideLength;

  let worst = 0;
  for (const item of row) {
    const itemArea = totalArea * (item.value / totalValue);
    const itemLength = itemArea / rowThickness;
    const ratio = Math.max(rowThickness / itemLength, itemLength / rowThickness);
    worst = Math.max(worst, ratio);
  }
  return worst;
}

// ─── ユーティリティ ──────────────────────────────────────

/** 3次Bezier補間 */
function cubicBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number
): [number, number] {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    Math.round((mt3 * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t3 * p3[0]) * 10) / 10,
    Math.round((mt3 * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t3 * p3[1]) * 10) / 10,
  ];
}

/** Bezierパス生成（S字カーブ） */
function generateBezierPath(
  sx: number, sy: number, tx: number, ty: number
): [number, number][] {
  const dx = tx - sx;
  const offset = Math.abs(dx) * BEZIER_CONTROL_RATIO;
  const p0: [number, number] = [sx, sy];
  const p1: [number, number] = [sx + offset, sy];
  const p2: [number, number] = [tx - offset, ty];
  const p3: [number, number] = [tx, ty];

  const points: [number, number][] = [];
  for (let i = 0; i <= BEZIER_SEGMENTS; i++) {
    points.push(cubicBezier(p0, p1, p2, p3, i / BEZIER_SEGMENTS));
  }
  return points;
}

/** エッジ幅の計算（対数スケール） */
function valueToWidth(value: number, maxValue: number): number {
  if (value <= 0 || maxValue <= 0) return 0.5;
  const logScale = Math.log10(value + 1) / Math.log10(maxValue + 1);
  return Math.max(0.5, logScale * 20);
}

/** treemap矩形にGAPパディングを適用（比例gap: ノード寸法の20%以上は取らない） */
const GAP_RATIO = 0.2;
function applyGap(rect: Rect, gap: number): Rect {
  const effectiveGap = Math.min(gap, Math.min(rect.width, rect.height) * GAP_RATIO);
  const half = effectiveGap / 2;
  const w = rect.width - effectiveGap;
  const h = rect.height - effectiveGap;
  return { x: rect.x + half, y: rect.y + half, width: w, height: h };
}

// ─── メイン処理 ──────────────────────────────────────────

function main() {
  console.log('=== sankey2 Treemapクラスタレイアウト計算 ===\n');

  // 1. グラフデータ読み込み
  const inputPath = path.join(__dirname, '../public/data/sankey2-graph.json');
  console.log('[1/5] グラフデータ読み込み');
  const graph: GraphData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  console.log(`  ノード: ${graph.nodes.length.toLocaleString()}`);
  console.log(`  エッジ: ${graph.edges.length.toLocaleString()}`);

  const nodeMap = new Map<string, GraphNode>();
  for (const node of graph.nodes) nodeMap.set(node.id, node);

  // 2. 支出先→府省庁の帰属計算（最大フロー元）
  console.log('\n[2/5] 支出先の府省庁帰属計算');
  const recipientMinistry = new Map<string, string>();
  const recipientMinistryTotals = new Map<string, Map<string, number>>();

  for (const edge of graph.edges) {
    if (!edge.source.startsWith('project-spending-')) continue;
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode?.ministry) continue;
    const totals = recipientMinistryTotals.get(edge.target) ?? new Map<string, number>();
    totals.set(
      sourceNode.ministry,
      (totals.get(sourceNode.ministry) ?? 0) + edge.value,
    );
    recipientMinistryTotals.set(edge.target, totals);
  }
  for (const [recipientId, totals] of recipientMinistryTotals) {
    const winner = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    if (winner) recipientMinistry.set(recipientId, winner[0]);
  }
  console.log(`  帰属決定: ${recipientMinistry.size.toLocaleString()} 支出先`);

  // 3. クラスタ内ノードグルーピング
  console.log('\n[3/5] Treemapクラスタ配置');

  // 府省庁→ノードリスト（type別）
  const ministryGroups = new Map<string, Map<string, GraphNode[]>>();
  for (const node of graph.nodes) {
    if (node.type === 'total') continue;

    let ministry: string | undefined;
    if (node.type === 'ministry') {
      ministry = node.label;
    } else if (node.type === 'recipient') {
      ministry = recipientMinistry.get(node.id);
    } else {
      ministry = node.ministry;
    }
    if (!ministry) continue;

    if (!ministryGroups.has(ministry)) {
      ministryGroups.set(ministry, new Map());
    }
    const typeMap = ministryGroups.get(ministry)!;
    if (!typeMap.has(node.type)) typeMap.set(node.type, []);
    typeMap.get(node.type)!.push(node);
  }

  // 府省庁を予算額降順ソート
  const ministryNodes = graph.nodes
    .filter(n => n.type === 'ministry')
    .sort((a, b) => b.amount - a.amount);

  // 4. 各クラスタのTreemap配置
  const layoutNodes: LayoutNode[] = [];
  const layoutNodeMap = new Map<string, LayoutNode>();

  for (let ci = 0; ci < CLUSTER_TYPES.length; ci++) {
    const clusterType = CLUSTER_TYPES[ci];
    const clusterX = ci * (CLUSTER_WIDTH + CLUSTER_GAP);
    const clusterRect: Rect = {
      x: clusterX,
      y: 0,
      width: CLUSTER_WIDTH,
      height: CLUSTER_HEIGHT,
    };

    if (clusterType === 'total') {
      // totalクラスタ: 1ノード = クラスタ全体
      const totalNode = graph.nodes.find(n => n.type === 'total');
      if (totalNode) {
        const ln: LayoutNode = {
          id: totalNode.id,
          label: totalNode.label,
          type: totalNode.type,
          amount: totalNode.amount,
          x: clusterRect.x,
          y: clusterRect.y,
          width: clusterRect.width,
          height: clusterRect.height,
          area: clusterRect.width * clusterRect.height,
        };
        layoutNodes.push(ln);
        layoutNodeMap.set(ln.id, ln);
      }
    } else if (clusterType === 'ministry') {
      // ministryクラスタ: 37ノードを直接treemap
      const items: TreemapItem[] = ministryNodes.map(n => ({
        key: n.id,
        value: n.amount,
        data: n,
      }));

      const results = squarifiedTreemap(items, clusterRect);
      for (const res of results) {
        if (!res.data) continue;
        const r = applyGap(res.rect, NODE_GAP);
        const ln: LayoutNode = {
          id: res.data.id,
          label: res.data.label,
          type: res.data.type,
          amount: res.data.amount,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          area: r.width * r.height,
        };
        layoutNodes.push(ln);
        layoutNodeMap.set(ln.id, ln);
      }
    } else if (clusterType === 'recipient') {
      // recipient: 金額降順の1段階スライスレイアウト（府省庁グループなし）
      const allRecipients = graph.nodes
        .filter(n => n.type === 'recipient')
        .sort((a, b) => b.amount - a.amount);

      const items: TreemapItem[] = allRecipients.map(n => ({
        key: n.id,
        value: n.amount,
        data: n,
      }));

      const results = sliceTreemap(items, clusterRect);
      for (const res of results) {
        if (!res.data) continue;
        const r = applyGap(res.rect, NODE_GAP);
        const ministry = recipientMinistry.get(res.data.id);
        const ln: LayoutNode = {
          id: res.data.id,
          label: res.data.label,
          type: res.data.type,
          amount: res.data.amount,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          area: r.width * r.height,
          ...(ministry && { ministry }),
          ...(res.data.isIndirect && { isIndirect: true }),
          ...(res.data.chainPaths && res.data.chainPaths.length > 0 && { chainPaths: res.data.chainPaths }),
        };
        layoutNodes.push(ln);
        layoutNodeMap.set(ln.id, ln);
      }
    } else {
      // project-budget, project-spending: 2段階treemap

      // 第1層: 府省庁グループのtreemap
      const ministryItems: TreemapItem[] = [];
      for (const mn of ministryNodes) {
        const typeMap = ministryGroups.get(mn.label);
        const nodes = typeMap?.get(clusterType) || [];
        const groupValue = nodes.reduce((s, n) => s + n.amount, 0);
        if (nodes.length > 0) {
          ministryItems.push({
            key: mn.label,
            value: groupValue,
            children: nodes.map(n => ({ key: n.id, value: n.amount, data: n })),
          });
        }
      }

      const layer1 = squarifiedTreemap(ministryItems, clusterRect);

      // 第2層: 各府省庁矩形内でノードをtreemap
      for (const group of layer1) {
        const ministryItem = ministryItems.find(m => m.key === group.key);
        if (!ministryItem?.children) continue;

        const layer2 = squarifiedTreemap(ministryItem.children, group.rect);
        for (const res of layer2) {
          if (!res.data) continue;
          const r = applyGap(res.rect, NODE_GAP);
          const ln: LayoutNode = {
            id: res.data.id,
            label: res.data.label,
            type: res.data.type,
            amount: res.data.amount,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            area: r.width * r.height,
            ...(res.data.ministry && { ministry: res.data.ministry }),
            ...(res.data.projectId !== undefined && { projectId: res.data.projectId }),
            ...(res.data.isIndirect && { isIndirect: true }),
            ...(res.data.chainPaths && res.data.chainPaths.length > 0 && { chainPaths: res.data.chainPaths }),
          };
          layoutNodes.push(ln);
          layoutNodeMap.set(ln.id, ln);
        }
      }
    }
  }

  console.log(`  配置済みノード: ${layoutNodes.length.toLocaleString()}`);

  // クラスタ別統計
  for (const ct of CLUSTER_TYPES) {
    const nodes = layoutNodes.filter(n => n.type === ct);
    console.log(`    ${ct}: ${nodes.length.toLocaleString()} ノード`);
  }

  // 5. エッジBezierパス計算
  console.log('\n[4/5] エッジパス計算');
  const maxEdgeValue = graph.edges.length > 0
    ? Math.max(...graph.edges.map(e => e.value))
    : 1;
  const layoutEdges: LayoutEdge[] = [];

  for (const edge of graph.edges) {
    const source = layoutNodeMap.get(edge.source);
    const target = layoutNodeMap.get(edge.target);
    if (!source || !target) continue;

    const isSubcontract = edge.edgeType === 'subcontract';

    let pathPoints: [number, number][];
    if (isSubcontract) {
      // 委託エッジ: ソース右辺中央 → ターゲット上辺or下辺中央
      const sx = source.x + source.width;
      const sy = source.y + source.height / 2;
      // ターゲット: ソースが上なら上辺、下なら下辺で接続
      const sourceAbove = source.y + source.height / 2 < target.y + target.height / 2;
      const tx = target.x + target.width / 2;
      const ty = sourceAbove ? target.y : target.y + target.height;
      const dx = Math.abs(tx - sx);
      const dy = Math.abs(ty - sy);
      const offset = Math.max(Math.max(dx, dy) * 0.4, 30);
      const p0: [number, number] = [sx, sy];
      const p1: [number, number] = [sx + offset, sy];
      const p2: [number, number] = [tx, sourceAbove ? ty - offset : ty + offset];
      const p3: [number, number] = [tx, ty];
      pathPoints = [];
      for (let i = 0; i <= BEZIER_SEGMENTS; i++) {
        pathPoints.push(cubicBezier(p0, p1, p2, p3, i / BEZIER_SEGMENTS));
      }
    } else {
      // クラスタ間エッジ: ソースの右辺中央 → ターゲットの左辺中央
      const sx = source.x + source.width;
      const sy = source.y + source.height / 2;
      const tx = target.x;
      const ty = target.y + target.height / 2;
      pathPoints = generateBezierPath(sx, sy, tx, ty);
    }

    layoutEdges.push({
      source: edge.source,
      target: edge.target,
      value: edge.value,
      path: pathPoints,
      width: valueToWidth(edge.value, maxEdgeValue),
      ...(isSubcontract && { edgeType: 'subcontract' as const }),
      ...(edge.projectIds && { projectIds: edge.projectIds }),
    });
  }
  console.log(`  エッジパス: ${layoutEdges.length.toLocaleString()} 件`);

  // 6. 出力
  console.log('\n[5/5] JSON出力');
  const totalWidth = CLUSTER_TYPES.length * CLUSTER_WIDTH + (CLUSTER_TYPES.length - 1) * CLUSTER_GAP;
  const totalHeight = CLUSTER_HEIGHT;

  const layoutData: LayoutData = {
    metadata: {
      ...graph.metadata,
      layout: {
        totalWidth,
        totalHeight,
        nodeCount: layoutNodes.length,
        edgeCount: layoutEdges.length,
        clusterWidth: CLUSTER_WIDTH,
        clusterHeight: CLUSTER_HEIGHT,
        clusterGap: CLUSTER_GAP,
      },
    },
    nodes: layoutNodes,
    edges: layoutEdges,
    ...(graph.subcontractChains && { subcontractChains: graph.subcontractChains }),
  };

  const outputPath = path.join(__dirname, '../public/data/sankey2-layout.json');
  fs.writeFileSync(outputPath, JSON.stringify(layoutData));

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

  console.log(`  出力: ${outputPath}`);
  console.log(`  サイズ: ${sizeMB} MB`);
  console.log(`  仮想空間: ${totalWidth.toLocaleString()} × ${totalHeight.toLocaleString()} px`);
  console.log(`
=== サマリ ===
  クラスタ: ${CLUSTER_TYPES.length}面 (${CLUSTER_WIDTH}×${CLUSTER_HEIGHT}px)
  ノード: ${layoutNodes.length.toLocaleString()} 件
  エッジ: ${layoutEdges.length.toLocaleString()} 件
  仮想空間: ${totalWidth.toLocaleString()} × ${totalHeight.toLocaleString()} px
  ファイルサイズ: ${sizeMB} MB
`);
}

main();
