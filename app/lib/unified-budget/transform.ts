/**
 * 統合グラフ → 表示グラフ の変換（純関数。React・DOM に依存しない）。
 *
 * パイプライン: toViewGraph → applyFilter → collapseColumns → applyTopN → sortForDisplay
 *   1. toViewGraph: 生成物のノードを表示ノード（details 付き）に写す
 *   2. applyFilter: 会計・所管・非事業ノードの除外。除外後に値を辺から再計算する
 *   3. collapseColumns: 非表示の列を畳む。中間ノードは流入×流出の比例配分で辺を繋ぎ直す
 *   4. applyTopN: 列ごとに上位N件を残し、溢れた分を「N項」のような集約ノードにまとめる
 *
 * 値の再計算: 中間ノードは max(流入, 流出)、流入の無いノードは流出、流出の無いノードは流入。
 * 生成物では RS事業ノードの値（歳出予算現額）＝ 目からの流入 ＋ 擬似ノード outside からの流入
 * で釣り合っているので、辺だけから値を作り直しても事業の値は変わらない。
 */

import type { SankeyLink } from '@/types/sankey';
import type { UnifiedColumn, UnifiedGraph } from '@/types/unified-budget';
import { UNIFIED_COLUMNS } from '@/types/unified-budget';
import {
  AGGREGATE_ID_PREFIX,
  DEFAULT_UNIFIED_TOP_N,
  UNIFIED_AGGREGATE_UNITS,
  aggregateId,
  type UnifiedOffset,
  type UnifiedTopN,
  type UnifiedViewFilter,
  type UnifiedViewGraph,
  type UnifiedViewNode,
} from '@/types/unified-budget-view';

const COLUMN_INDEX = new Map<UnifiedColumn, number>(UNIFIED_COLUMNS.map((c, i) => [c, i]));
export const columnIndex = (c: UnifiedColumn) => COLUMN_INDEX.get(c) ?? 0;

/** 1. 生成物 → 表示ノード */
export function toViewGraph(graph: UnifiedGraph): UnifiedViewGraph {
  const nodes: UnifiedViewNode[] = graph.nodes.map(n => {
    const { id, name, value, col, ...rest } = n;
    return { id, name, value, type: col, details: { ...rest, column: col } };
  });
  const links: SankeyLink[] = graph.edges.map(e => ({ source: e.source, target: e.target, value: e.value }));
  return { nodes, links };
}

/** 辺から値を作り直す（変換のたびに呼ぶ） */
export function recomputeValues(view: UnifiedViewGraph): UnifiedViewGraph {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const l of view.links) {
    inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.value);
    outflow.set(l.source, (outflow.get(l.source) ?? 0) + l.value);
  }
  const nodes = view.nodes
    .map(n => {
      const i = inflow.get(n.id) ?? 0;
      const o = outflow.get(n.id) ?? 0;
      return { ...n, value: Math.max(i, o) };
    })
    .filter(n => n.value > 0);
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, links: view.links.filter(l => ids.has(l.source) && ids.has(l.target) && l.value > 0) };
}

function removeNodes(view: UnifiedViewGraph, remove: Set<string>): UnifiedViewGraph {
  if (remove.size === 0) return view;
  return recomputeValues({
    nodes: view.nodes.filter(n => !remove.has(n.id)),
    links: view.links.filter(l => !remove.has(l.source) && !remove.has(l.target)),
  });
}

/**
 * 2. 絞り込み。
 * - 会計の除外は、その会計に属する 組織/勘定・項・目 も一緒に落とす（ID に会計名が含まれ会計ごとに排他なので正確に落ちる）。
 *   共有ノード（所管・事業区分・事業）は辺が減ったぶん値が再計算で縮む。
 * - 所管の絞り込みは、その所管の 組織〜目 と、そこから流れない事業・支出先を落とす（下流は到達可能性で判定）。
 * - 非事業ノード（np-*）の除外は単純にノードを落とす。
 * - 名前検索は、一致したノードとその祖先・子孫だけを残す（関連フォーカスと同じ集合）。
 */
export function applyFilter(view: UnifiedViewGraph, filter: UnifiedViewFilter): UnifiedViewGraph {
  let current = view;
  const remove = new Set<string>();

  if (!filter.includeCollapsedAccounts) {
    const collapsedAccounts = new Set(current.nodes.filter(n => n.details.column === 'account' && n.details.collapsedByDefault).map(n => n.details.organization ?? n.name));
    for (const n of current.nodes) {
      const d = n.details;
      if (d.column === 'account' && d.collapsedByDefault) remove.add(n.id);
      else if ((d.column === 'organization' || d.column === 'section' || d.column === 'koumoku') && d.accountType === 'special' && d.organization && collapsedAccounts.has(d.organization)) remove.add(n.id);
    }
  }
  if (filter.accountTypes.length > 0) {
    const allowed = new Set<string>(filter.accountTypes);
    for (const n of current.nodes) {
      const d = n.details;
      if ((d.column === 'account' || d.column === 'organization' || d.column === 'section' || d.column === 'koumoku') && d.accountType && !allowed.has(d.accountType)) remove.add(n.id);
    }
  }
  if (filter.ministries.length > 0) {
    const allowed = new Set(filter.ministries);
    for (const n of current.nodes) {
      const d = n.details;
      if ((d.column === 'ministry' || d.column === 'organization' || d.column === 'section' || d.column === 'koumoku') && d.ministry && !allowed.has(d.ministry)) remove.add(n.id);
    }
  }
  if (!filter.showNonRs) {
    for (const n of current.nodes) {
      if (n.details.column === 'program' && n.details.kind && n.details.kind !== 'rs') remove.add(n.id);
    }
  }
  current = removeNodes(current, remove);

  // 所管・会計を絞ったときは、上流から到達できない事業・支出先も落とす（他の所管の事業が残ると図が読めない）。
  // ただし擬似ノード outside からしか流入の無い事業は、上流が無いのが正常なので残す
  if (filter.ministries.length > 0 || filter.accountTypes.length > 0 || !filter.includeCollapsedAccounts) {
    const reachable = new Set<string>();
    const childrenOf = new Map<string, string[]>();
    for (const l of current.links) childrenOf.set(l.source, [...(childrenOf.get(l.source) ?? []), l.target]);
    const roots = current.nodes.filter(n => n.details.column === 'account' || n.details.column === 'ministry' || n.details.standalone).map(n => n.id);
    const stack = [...roots];
    for (const r of roots) reachable.add(r);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      for (const c of childrenOf.get(id) ?? []) {
        if (reachable.has(c)) continue;
        reachable.add(c);
        stack.push(c);
      }
    }
    if (filter.ministries.length > 0 || filter.accountTypes.length > 0) {
      // 所管を絞ったときは outside だけから流入する事業も落とす（所管に属さない事業が全部残ってしまう）
      const outsideOnly = new Set<string>();
      const inflowSources = new Map<string, Set<string>>();
      for (const l of current.links) inflowSources.set(l.target, new Set([...(inflowSources.get(l.target) ?? []), l.source]));
      const standaloneIds = new Set(current.nodes.filter(n => n.details.standalone).map(n => n.id));
      for (const n of current.nodes) {
        if (n.details.column !== 'program') continue;
        const srcs = inflowSources.get(n.id);
        if (srcs && [...srcs].every(s => standaloneIds.has(s))) outsideOnly.add(n.id);
      }
      const drop = new Set(current.nodes.filter(n => !reachable.has(n.id) || outsideOnly.has(n.id)).map(n => n.id));
      current = removeNodes(current, drop);
      // 事業を落としたので、その下流（支出・支出先）で孤立したものを落とす
      current = removeUnreachable(current);
    } else {
      current = removeNodes(current, new Set(current.nodes.filter(n => !reachable.has(n.id)).map(n => n.id)));
    }
  }

  if (filter.nameQuery.trim()) {
    const q = filter.nameQuery.trim();
    const hit = new Set(current.nodes.filter(n => n.name.includes(q)).map(n => n.id));
    if (hit.size > 0) {
      const related = relatedSet(current.links, hit);
      current = removeNodes(current, new Set(current.nodes.filter(n => !related.has(n.id)).map(n => n.id)));
    } else {
      current = { nodes: [], links: [] };
    }
  }
  return current;
}

/** 流入も流出も無くなったノードを落とす（recomputeValues が value=0 で落とすので通常は不要だが、明示） */
function removeUnreachable(view: UnifiedViewGraph): UnifiedViewGraph {
  return recomputeValues(view);
}

/** 集合に連なる全ノード（祖先＋子孫） */
export function relatedSet(links: SankeyLink[], seeds: Set<string>): Set<string> {
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const l of links) {
    parentsOf.set(l.target, [...(parentsOf.get(l.target) ?? []), l.source]);
    childrenOf.set(l.source, [...(childrenOf.get(l.source) ?? []), l.target]);
  }
  const set = new Set(seeds);
  const stack = [...seeds];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const p of parentsOf.get(id) ?? []) {
      if (set.has(p)) continue;
      set.add(p);
      stack.push(p);
    }
    for (const c of childrenOf.get(id) ?? []) {
      if (set.has(c)) continue;
      set.add(c);
      stack.push(c);
    }
  }
  return set;
}

/**
 * 3. 列の畳み込み。
 * 非表示列のノードを左から順に取り除き、流入 s→h と流出 h→t を s→t（vin × vout / Σout）に繋ぎ直す。
 * - 流出の無いノード（終端。RS事業が無い年度の事業、非事業区分など）は落とす。金額は図から消える
 * - 流入の無いノード（起点。会計、擬似ノード outside）は、standalone なら表示列のうち最も近い左の列へ
 *   移して残す（事業の歳出予算現額を保つため）。会計のような普通の起点は落とし、下流の値は再計算で保つ
 */
export function collapseColumns(view: UnifiedViewGraph, visible: UnifiedColumn[]): UnifiedViewGraph {
  const visibleSet = new Set(visible);
  const hiddenColumns = UNIFIED_COLUMNS.filter(c => !visibleSet.has(c));
  if (hiddenColumns.length === 0) return view;

  let nodes = view.nodes;
  let links = view.links;
  for (const col of hiddenColumns) {
    const hidden = new Set(nodes.filter(n => n.details.column === col && !n.details.standalone).map(n => n.id));
    if (hidden.size === 0) continue;
    const inBy = new Map<string, Array<{ s: string; v: number }>>();
    const outBy = new Map<string, Array<{ t: string; v: number }>>();
    const kept: SankeyLink[] = [];
    for (const l of links) {
      const sh = hidden.has(l.source);
      const th = hidden.has(l.target);
      if (!sh && !th) {
        kept.push(l);
        continue;
      }
      if (th) inBy.set(l.target, [...(inBy.get(l.target) ?? []), { s: l.source, v: l.value }]);
      if (sh) outBy.set(l.source, [...(outBy.get(l.source) ?? []), { t: l.target, v: l.value }]);
    }
    const merged = new Map<string, SankeyLink>();
    const push = (s: string, t: string, v: number) => {
      if (v <= 0) return;
      const k = `${s}→${t}`;
      const e = merged.get(k);
      if (e) e.value += v;
      else merged.set(k, { source: s, target: t, value: v });
    };
    for (const h of hidden) {
      const ins = inBy.get(h) ?? [];
      const outs = outBy.get(h) ?? [];
      if (ins.length === 0 || outs.length === 0) continue; // 起点・終端は落とす
      const total = outs.reduce((s, o) => s + o.v, 0);
      for (const i of ins) for (const o of outs) push(i.s, o.t, (i.v * o.v) / total);
    }
    // 同じ辺（s→t）が畳み込み前から存在していれば合流させる
    for (const l of kept) push(l.source, l.target, l.value);
    links = [...merged.values()];
    nodes = nodes.filter(n => !hidden.has(n.id));
  }

  // standalone（擬似ノード）は、表示列のうち自分の列より左で最も近い列へ移す。無ければ最左の表示列
  const visibleOrdered = UNIFIED_COLUMNS.filter(c => visibleSet.has(c));
  nodes = nodes.map(n => {
    if (!n.details.standalone || visibleSet.has(n.details.column)) return n;
    const myIdx = columnIndex(n.details.column);
    const left = [...visibleOrdered].reverse().find(c => columnIndex(c) < myIdx) ?? visibleOrdered[0];
    return left ? { ...n, type: left, details: { ...n.details, column: left } } : n;
  });
  return recomputeValues({ nodes, links });
}

/**
 * 4. 列ごとの TopN。
 * 値の大きい順に [offset, offset+N) を残し、それ以外を集約ノード「N項」にまとめる。
 * 事業区分ノード（np-*）と擬似ノードは常に残す。事業(支出) は事業（program）と同じ事業IDの集合に揃える
 * （上下の列で同じ事業が出るように。/sankey-svg と同じ）。
 * 集約ノードへ向かう辺・集約ノードから出る辺は同じ相手ごとに合流させる。
 */
export function applyTopN(view: UnifiedViewGraph, topN: UnifiedTopN, offset: UnifiedOffset): UnifiedViewGraph {
  let nodes = view.nodes;
  let links = view.links;
  const keptProjectIds = new Set<number>();
  const columnCounts = new Map<UnifiedColumn, number>();

  for (const col of UNIFIED_COLUMNS) {
    const limit = topN[col] ?? DEFAULT_UNIFIED_TOP_N[col];
    const candidates = nodes.filter(n => n.details.column === col && !n.details.standalone && !(n.details.kind && n.details.kind !== 'rs'));
    columnCounts.set(col, candidates.length);
    if (limit <= 0 || candidates.length <= limit) {
      if (col === 'program') for (const n of candidates) if (n.details.projectId !== undefined) keptProjectIds.add(n.details.projectId);
      continue;
    }
    let keep: Set<string>;
    if (col === 'program-spending') {
      keep = new Set(candidates.filter(n => n.details.projectId !== undefined && keptProjectIds.has(n.details.projectId)).map(n => n.id));
    } else {
      const sorted = [...candidates].sort((a, b) => b.value - a.value);
      const start = Math.max(0, Math.min(offset[col] ?? 0, Math.max(0, sorted.length - limit)));
      keep = new Set(sorted.slice(start, start + limit).map(n => n.id));
      if (col === 'program') for (const id of keep) {
        const pid = candidates.find(n => n.id === id)?.details.projectId;
        if (pid !== undefined) keptProjectIds.add(pid);
      }
    }
    const overflow = candidates.filter(n => !keep.has(n.id));
    if (overflow.length === 0) continue;
    const aggId = aggregateId(col);
    const overflowIds = new Set(overflow.map(n => n.id));
    const total = overflow.reduce((s, n) => s + n.value, 0);
    const top = [...overflow].sort((a, b) => b.value - a.value).slice(0, 20).map(n => ({ id: n.id, name: n.name, amount: n.value }));
    const aggNode: UnifiedViewNode = {
      id: aggId,
      name: `${overflow.length.toLocaleString()}${UNIFIED_AGGREGATE_UNITS[col]}`,
      value: total,
      type: col,
      details: { column: col, aggregated: true, aggregatedCount: overflow.length, aggregatedTop: top },
    };
    const merged = new Map<string, SankeyLink>();
    for (const l of links) {
      const s = overflowIds.has(l.source) ? aggId : l.source;
      const t = overflowIds.has(l.target) ? aggId : l.target;
      if (s === t) continue;
      const k = `${s}→${t}`;
      const e = merged.get(k);
      if (e) e.value += l.value;
      else merged.set(k, { source: s, target: t, value: l.value });
    }
    links = [...merged.values()];
    nodes = [...nodes.filter(n => !overflowIds.has(n.id)), aggNode];
  }
  void columnCounts;
  return recomputeValues({ nodes, links });
}

/** 列ごとの候補件数（TopN スライダーの分母）。applyTopN の前のグラフに対して数える */
export function countByColumn(view: UnifiedViewGraph): Partial<Record<UnifiedColumn, number>> {
  const counts: Partial<Record<UnifiedColumn, number>> = {};
  for (const n of view.nodes) {
    if (n.details.standalone || (n.details.kind && n.details.kind !== 'rs')) continue;
    counts[n.details.column] = (counts[n.details.column] ?? 0) + 1;
  }
  return counts;
}

export const isAggregateId = (id: string) => id.startsWith(AGGREGATE_ID_PREFIX);

/**
 * 5. sortForDisplay: 列内の並び順を決める（レイアウトは入力順に上から積む）。
 *
 * - 基本は金額の大きい順
 * - 事業列は RS事業を上、事業区分ノード（np-*: 国債費・繰入・人件費・未突合 など）と擬似ノード（outside）を下に置く
 *   （読者が見たいのは個々の事業で、区分ノードは「残り」の説明だから）
 * - 集約ノード（「N項」など）は各列の最下段
 * - 事業(支出) は事業と同じ事業IDの並びに揃え、事業→事業(支出) の帯が平行に流れるようにする
 */
export function sortForDisplay(view: UnifiedViewGraph): UnifiedViewGraph {
  const rank = (n: UnifiedViewNode): number => {
    if (n.details.aggregated) return 2;
    if (n.details.standalone) return 1;
    if (n.details.kind && n.details.kind !== 'rs') return 1;
    return 0;
  };
  const byValue = (a: UnifiedViewNode, b: UnifiedViewNode) => rank(a) - rank(b) || b.value - a.value || a.id.localeCompare(b.id);

  const programOrder = new Map<number, number>();
  view.nodes
    .filter(n => n.details.column === 'program')
    .sort(byValue)
    .forEach((n, i) => {
      if (n.details.projectId !== undefined) programOrder.set(n.details.projectId, i);
    });
  const bySpending = (a: UnifiedViewNode, b: UnifiedViewNode) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const pa = a.details.projectId !== undefined ? programOrder.get(a.details.projectId) : undefined;
    const pb = b.details.projectId !== undefined ? programOrder.get(b.details.projectId) : undefined;
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return b.value - a.value || a.id.localeCompare(b.id);
  };

  const nodes = UNIFIED_COLUMNS.flatMap(col =>
    view.nodes.filter(n => n.details.column === col).sort(col === 'program-spending' ? bySpending : byValue)
  );
  // 列に属さないノードは無いはずだが、落とさないよう末尾に付ける
  const placed = new Set(nodes.map(n => n.id));
  for (const n of view.nodes) if (!placed.has(n.id)) nodes.push(n);
  return { nodes, links: view.links };
}
