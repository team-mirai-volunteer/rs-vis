/**
 * 項単位「項→目→RS事業→支出先」サンキーの組み立て。
 *
 * 項→目は事項別内訳・科目別内訳（`sectionDetail`）、目→RS事業は目↔RS事業紐づけ
 * （`mof-rs-kou-moku-linkage`）、RS事業→支出先は再委託構造（`subcontracts-{年}.json`）
 * の1階層目（直接支出ブロック）のみを対象にする（再委託先は対象外。
 * docs/tasks/20260904_0759_項単位の目RS事業支出先サンキー設計.md 参照）。
 *
 * 純粋関数で、HTTP もファイル読み込みもしない（読み込みは API 層の責務）。
 */

import type {
  MOFKouSankeyColumn,
  MOFKouSankeyData,
  MOFKouSankeyNode,
} from '@/types/mof-kou-sankey';
import { DEFAULT_MOF_KOU_SANKEY_TOP_N } from '@/types/mof-kou-sankey';
import type { SankeyLink } from '@/types/sankey';
import type { SubcontractGraph } from '@/types/subcontract';

const ROOT_ID = 'root';
const AGGREGATE_TOP_COUNT = 5;

/**
 * RS事業の直接支出先（1階層目。`originKind === 'direct'`のブロック）の支出先を
 * 名前で合算して返す。再委託先（depth2以降のブロック）は対象外
 * （docs/tasks/20260904_0759_項単位の目RS事業支出先サンキー設計.md 参照）。
 */
export function directRecipientsOf(graph: SubcontractGraph): Array<{ name: string; amount: number }> {
  const amountByName = new Map<string, number>();
  for (const block of graph.blocks) {
    if (block.originKind !== 'direct') continue;
    for (const recipient of block.recipients) {
      amountByName.set(recipient.name, (amountByName.get(recipient.name) ?? 0) + recipient.amount);
    }
  }
  return [...amountByName.entries()].map(([name, amount]) => ({ name, amount }));
}

export interface MOFKouSankeyBuildInput {
  fiscalYear: number;
  eraLabel: string;
  budgetType: string;
  /** RS紐づけデータの対象年度。紐づけ未生成の年度は null */
  rsYear: number | null;
  section: { id: string; sectionName: string; ministry: string; amount: number };
  kouMokuItems: Array<{ key: string; subItemName: string; amount: number }>;
  /** 目↔RS事業紐づけ（対象の項に属する目ぶんだけを渡す） */
  rsLinks: Array<{ kouMokuKey: string; projectId: number; projectName: string; kouMokuAmount: number }>;
  /** rsLinks に出てくる全 projectId ぶんの、事業自体の規模・直接支出先 */
  projects: Map<number, { totalBudget: number; recipients: Array<{ name: string; amount: number }> }>;
  topN?: Partial<Record<Exclude<MOFKouSankeyColumn, 'section'>, number>>;
}

interface Candidate {
  id: string;
  name: string;
  value: number;
}

/**
 * 候補を金額の大きい順にTopN件残し、残りを1つの集約ノードにまとめる。
 * 集約ノードのidは `${column}Prefix}__others__`固定（列に1つだけ）。
 */
function splitTopN(
  candidates: Candidate[],
  topN: number
): { kept: Candidate[]; others: { value: number; count: number; top: Array<{ name: string; amount: number }> } | null } {
  const sorted = [...candidates].sort((a, b) => b.value - a.value);
  const kept = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  if (rest.length === 0) return { kept, others: null };
  return {
    kept,
    others: {
      value: rest.reduce((s, c) => s + c.value, 0),
      count: rest.length,
      top: rest.slice(0, AGGREGATE_TOP_COUNT).map(c => ({ name: c.name, amount: c.value })),
    },
  };
}

export function buildMOFKouSankey(input: MOFKouSankeyBuildInput): MOFKouSankeyData {
  const topN = {
    koumoku: input.topN?.koumoku ?? DEFAULT_MOF_KOU_SANKEY_TOP_N,
    rsStatus: input.topN?.rsStatus ?? DEFAULT_MOF_KOU_SANKEY_TOP_N,
    recipient: input.topN?.recipient ?? DEFAULT_MOF_KOU_SANKEY_TOP_N,
  };

  // --- browse（TopNで絞る前の全件。サイドパネルのタブ用） ---
  const browseNodes: MOFKouSankeyNode[] = [];
  const browseLinks: SankeyLink[] = [];

  browseNodes.push({
    id: ROOT_ID,
    name: input.section.sectionName,
    value: input.section.amount,
    type: 'section',
    details: { column: 'section' },
  });

  for (const item of input.kouMokuItems) {
    browseNodes.push({
      id: item.key,
      name: item.subItemName || input.section.sectionName,
      value: item.amount,
      type: 'koumoku',
      details: { column: 'koumoku', kouMokuKey: item.key },
    });
    browseLinks.push({ source: ROOT_ID, target: item.key, value: item.amount });
  }

  const koumokuKeySet = new Set(input.kouMokuItems.map(i => i.key));
  const rsProjectNodeId = (projectId: number) => `rsproj:${projectId}`;

  // 目→RS事業。同じ(目,事業)ペアで複数行あれば合算する
  const contributionByKey = new Map<string, number>();
  for (const link of input.rsLinks) {
    if (!koumokuKeySet.has(link.kouMokuKey)) continue;
    const key = `${link.kouMokuKey}\0${link.projectId}`;
    contributionByKey.set(key, (contributionByKey.get(key) ?? 0) + link.kouMokuAmount);
  }
  const projectNames = new Map<number, string>();
  for (const link of input.rsLinks) projectNames.set(link.projectId, link.projectName);

  const seenProjectNode = new Set<number>();
  for (const [key, amount] of contributionByKey) {
    const [kouMokuKey, projectIdRaw] = key.split('\0');
    const projectId = Number(projectIdRaw);
    if (!seenProjectNode.has(projectId)) {
      seenProjectNode.add(projectId);
      const project = input.projects.get(projectId);
      browseNodes.push({
        id: rsProjectNodeId(projectId),
        name: projectNames.get(projectId) ?? String(projectId),
        value: project?.totalBudget ?? amount,
        type: 'rsStatus',
        details: { column: 'rsStatus', projectId },
      });
    }
    browseLinks.push({ source: kouMokuKey, target: rsProjectNodeId(projectId), value: amount });
  }

  // RS事業→支出先（1階層目のみ）
  const recipientNodeId = (projectId: number, name: string) => `recipient:${projectId}:${name}`;
  for (const projectId of seenProjectNode) {
    const project = input.projects.get(projectId);
    if (!project) continue;
    for (const recipient of project.recipients) {
      if (recipient.amount <= 0) continue;
      const id = recipientNodeId(projectId, recipient.name);
      browseNodes.push({
        id,
        name: recipient.name,
        value: recipient.amount,
        type: 'recipient',
        details: { column: 'recipient' },
      });
      browseLinks.push({ source: rsProjectNodeId(projectId), target: id, value: recipient.amount });
    }
  }

  // --- sankey（図の表示用。列ごとにTopNで絞り、溢れた分は集約ノードにまとめる） ---
  const sankeyNodes: MOFKouSankeyNode[] = [browseNodes[0]]; // root
  const sankeyLinks: SankeyLink[] = [];

  const koumokuSplit = splitTopN(
    input.kouMokuItems.map(i => ({ id: i.key, name: i.subItemName || input.section.sectionName, value: i.amount })),
    topN.koumoku
  );
  const koumokuOthersId = '__others__koumoku';
  for (const c of koumokuSplit.kept) {
    sankeyNodes.push(browseNodes.find(n => n.id === c.id)!);
    sankeyLinks.push({ source: ROOT_ID, target: c.id, value: c.value });
  }
  if (koumokuSplit.others) {
    sankeyNodes.push({
      id: koumokuOthersId,
      name: `${koumokuSplit.others.count.toLocaleString()}目`,
      value: koumokuSplit.others.value,
      type: 'koumoku',
      details: { column: 'koumoku', aggregated: true, aggregatedCount: koumokuSplit.others.count, aggregatedTop: koumokuSplit.others.top },
    });
    sankeyLinks.push({ source: ROOT_ID, target: koumokuOthersId, value: koumokuSplit.others.value });
  }
  const keptKoumokuIds = new Set(koumokuSplit.kept.map(c => c.id));

  // 保持された目からのRS事業ぶんだけ、事業ごとの寄与額を積み上げてランキングする
  const rsContribution = new Map<number, number>();
  for (const [key, amount] of contributionByKey) {
    const [kouMokuKey, projectIdRaw] = key.split('\0');
    if (!keptKoumokuIds.has(kouMokuKey)) continue;
    const projectId = Number(projectIdRaw);
    rsContribution.set(projectId, (rsContribution.get(projectId) ?? 0) + amount);
  }
  const rsSplit = splitTopN(
    [...rsContribution.entries()].map(([projectId, value]) => ({
      id: rsProjectNodeId(projectId),
      name: projectNames.get(projectId) ?? String(projectId),
      value,
    })),
    topN.rsStatus
  );
  const rsOthersId = '__others__rsStatus';
  const keptProjectIds = new Set(rsSplit.kept.map(c => Number(c.id.replace('rsproj:', ''))));
  for (const [key, amount] of contributionByKey) {
    const [kouMokuKey, projectIdRaw] = key.split('\0');
    if (!keptKoumokuIds.has(kouMokuKey)) continue;
    const projectId = Number(projectIdRaw);
    const target = keptProjectIds.has(projectId) ? rsProjectNodeId(projectId) : rsOthersId;
    sankeyLinks.push({ source: kouMokuKey, target, value: amount });
  }
  for (const c of rsSplit.kept) sankeyNodes.push(browseNodes.find(n => n.id === c.id)!);
  if (rsSplit.others) {
    sankeyNodes.push({
      id: rsOthersId,
      name: `${rsSplit.others.count.toLocaleString()}事業`,
      value: rsSplit.others.value,
      type: 'rsStatus',
      details: { column: 'rsStatus', aggregated: true, aggregatedCount: rsSplit.others.count, aggregatedTop: rsSplit.others.top },
    });
  }

  // 保持されたRS事業の直接支出先だけを候補にし、列全体でTopNを取る
  const recipientCandidates: Array<Candidate & { projectId: number }> = [];
  for (const projectId of keptProjectIds) {
    const project = input.projects.get(projectId);
    if (!project) continue;
    for (const recipient of project.recipients) {
      if (recipient.amount <= 0) continue;
      recipientCandidates.push({ id: recipientNodeId(projectId, recipient.name), name: recipient.name, value: recipient.amount, projectId });
    }
  }
  const recipientSplit = splitTopN(recipientCandidates, topN.recipient);
  const recipientOthersId = '__others__recipient';
  const keptRecipientIds = new Set(recipientSplit.kept.map(c => c.id));
  for (const c of recipientCandidates) {
    const target = keptRecipientIds.has(c.id) ? c.id : recipientOthersId;
    sankeyLinks.push({ source: rsProjectNodeId(c.projectId), target, value: c.value });
  }
  for (const c of recipientSplit.kept) sankeyNodes.push(browseNodes.find(n => n.id === c.id)!);
  if (recipientSplit.others) {
    sankeyNodes.push({
      id: recipientOthersId,
      name: `${recipientSplit.others.count.toLocaleString()}先`,
      value: recipientSplit.others.value,
      type: 'recipient',
      details: { column: 'recipient', aggregated: true, aggregatedCount: recipientSplit.others.count, aggregatedTop: recipientSplit.others.top },
    });
  }

  const columnCounts: Partial<Record<MOFKouSankeyColumn, number>> = {
    section: 1,
    koumoku: input.kouMokuItems.length,
    rsStatus: seenProjectNode.size,
    // 支出先はbrowse側（保持されたRS事業に限らない全件）の件数が正しい母数
    recipient: browseNodes.filter(n => n.details.column === 'recipient').length,
  };

  return {
    metadata: {
      fiscalYear: input.fiscalYear,
      eraLabel: input.eraLabel,
      budgetType: input.budgetType,
      sectionId: input.section.id,
      sectionName: input.section.sectionName,
      ministry: input.section.ministry,
      rsYear: input.rsYear,
      total: input.section.amount,
      topN,
      columnCounts,
      unit: 'yen',
    },
    sankey: { nodes: sankeyNodes, links: sankeyLinks },
    browse: { nodes: browseNodes, links: browseLinks },
  };
}
