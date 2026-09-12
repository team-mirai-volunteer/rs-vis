/**
 * 項単位「項→目→RS事業→支出先」サンキーの絞り込み（サイドパネルのタブ用の集計）。
 *
 * 列の並びは 項(root, 常に1件) → 目 → RS事業 → 支出先 という単純な直線構造だが、
 * 目↔RS事業の間だけは1つのRS事業が複数の目から計上されうる（多対多）。
 * ノード自身の value（RS事業なら事業全体の予算額）を祖先・子孫の内訳に使うと
 * 実態より大きく見えるため、この区間だけは常にエッジの value（寄与額）を使う
 * （`app/lib/mof-section-rs-focus.ts` で確立した考え方と同じ）。
 * 項→目、RS事業→支出先（支出先は事業ごとにIDを分けているため親は必ず1つ）は
 * 木構造なので、ノード自身の value をそのまま使ってよい。
 *
 * 純粋関数で React にも DOM にも依存しない。
 */

import type { MOFKouSankeyNode } from '@/types/mof-kou-sankey';
import type { SankeyLink } from '@/types/sankey';

/**
 * 与えた目（複数可）から計上されているRS事業を、事業ごとに寄与額を合算してまとめる。
 * 項（root）を選んだときは項配下の目すべてを、目を選んだときはその目1件だけを渡す。
 */
export function rsStatusBreakdown(nodes: MOFKouSankeyNode[], links: SankeyLink[], koumokuIds: string[]): MOFKouSankeyNode[] {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const koumokuIdSet = new Set(koumokuIds);
  const weightById = new Map<string, number>();
  for (const link of links) {
    if (!koumokuIdSet.has(link.source)) continue;
    const target = nodeById.get(link.target);
    if (!target || target.details.column !== 'rsStatus') continue;
    weightById.set(link.target, (weightById.get(link.target) ?? 0) + link.value);
  }
  return [...weightById.entries()]
    .map(([id, value]) => ({ ...(nodeById.get(id) as MOFKouSankeyNode), value }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/**
 * 与えたRS事業（複数可）の支出先をまとめる。支出先IDは事業ごとに分けている
 * （`recipient:${projectId}:${name}`）ため親は必ず1つで、ノード自身の value を
 * そのまま使える。項（root）・目を選んだときは、対応するRS事業ID群（上の
 * rsStatusBreakdown の結果）をそのまま渡す。
 */
export function recipientBreakdown(nodes: MOFKouSankeyNode[], links: SankeyLink[], rsStatusIds: string[]): MOFKouSankeyNode[] {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const rsStatusIdSet = new Set(rsStatusIds);
  const items: MOFKouSankeyNode[] = [];
  for (const link of links) {
    if (!rsStatusIdSet.has(link.source)) continue;
    const target = nodeById.get(link.target);
    if (!target || target.details.column !== 'recipient') continue;
    items.push(target);
  }
  return items.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/** 選んだRS事業に計上している目を、エッジの寄与額の大きい順で返す（rsStatusBreakdownの逆方向） */
export function koumokuAncestorsOfRsStatus(nodes: MOFKouSankeyNode[], links: SankeyLink[], rsStatusId: string): MOFKouSankeyNode[] {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const items: MOFKouSankeyNode[] = [];
  for (const link of links) {
    if (link.target !== rsStatusId) continue;
    const source = nodeById.get(link.source);
    if (!source || source.details.column !== 'koumoku') continue;
    items.push({ ...source, value: link.value });
  }
  return items.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/** 選んだ支出先が属するRS事業を1件返す（支出先は必ず単一のRS事業にぶら下がる） */
export function rsStatusAncestorOfRecipient(nodes: MOFKouSankeyNode[], links: SankeyLink[], recipientId: string): MOFKouSankeyNode | null {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const link = links.find(l => l.target === recipientId);
  if (!link) return null;
  const source = nodeById.get(link.source);
  return source && source.details.column === 'rsStatus' ? source : null;
}

/** 選択したノードに連なる集合（自分・すべての祖先・すべての子孫）。図の淡色表示に使う */
export function relatedNodeIds(links: SankeyLink[], selectedId: string): Set<string> {
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const link of links) {
    parentsOf.set(link.target, [...(parentsOf.get(link.target) ?? []), link.source]);
    childrenOf.set(link.source, [...(childrenOf.get(link.source) ?? []), link.target]);
  }
  const set = new Set<string>([selectedId]);
  const up = [selectedId];
  while (up.length > 0) {
    const id = up.pop() as string;
    for (const parent of parentsOf.get(id) ?? []) {
      if (set.has(parent)) continue;
      set.add(parent);
      up.push(parent);
    }
  }
  const down = [selectedId];
  while (down.length > 0) {
    const id = down.pop() as string;
    for (const child of childrenOf.get(id) ?? []) {
      if (set.has(child)) continue;
      set.add(child);
      down.push(child);
    }
  }
  return set;
}
