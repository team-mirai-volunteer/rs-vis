/**
 * RS 公開 API の暫定データ（RsApiDetail）を、統合ビューのサイドパネルが使う既存の型へ写す（Pure 層）。
 * 新規事業（前年度シートに無い事業）でも、事業概要・ブロック・支出先をいつもの場所に出すためのもの。
 *
 * API の金額は null = 未確認（0円ではない）。既存の型は number なので NaN で表し、表示側で「未確認」と出す。
 */
import type { ProjectDetail } from '@/types/project-details';
import type { RsApiDetail } from '@/types/rs-api';
import type { BlockEdge, BlockNode, SubcontractGraph } from '@/types/subcontract';

const amountOrUnknown = (amount: number | null | undefined) => (amount === null || amount === undefined || amount < 0 ? Number.NaN : amount);
const finiteSum = (values: number[]) => values.filter(Number.isFinite).reduce((sum, value) => sum + value, 0);

/** 事業概要セクション（ProjectOverviewSection / ProjectDescription）用。API に無い項目は空にする */
export function rsApiToProjectDetail(detail: RsApiDetail): ProjectDetail {
  return {
    projectId: detail.projectId,
    projectName: detail.name,
    ministry: detail.ministry,
    bureau: '',
    purpose: detail.purpose ?? '',
    currentIssues: '',
    overview: detail.overview ?? '',
    url: detail.sourceUrl,
    category: '',
    startYear: null,
    startYearUnknown: false,
    endYear: null,
    noEndDate: false,
    majorExpense: '',
    remarks: '',
    implementationMethods: [],
    oldProjectNumber: '',
  };
}

/**
 * ブロック・支出先タブ（UnifiedProjectBlocks / UnifiedBlockRecipients）用。
 * 担当組織から直接つながるブロックは direct、他ブロックからの流入だけのブロックは subcontract とみなす。
 * 支出先が未取得（paymentStatus = missing）なら null（「取得できない」であって「記載なし」ではない）。
 */
export function rsApiToSubcontractGraph(detail: RsApiDetail): SubcontractGraph | null {
  if (detail.paymentStatus !== 'available') return null;
  const codeById = new Map(detail.groups.map(group => [group.id, group.display_code]));
  const flows: BlockEdge[] = [];
  for (const edge of detail.edges) {
    const target = codeById.get(edge.target_node_id);
    if (!target) continue;
    const source = edge.is_connected_to_source_root ? null : codeById.get(edge.source_node_id ?? '') ?? null;
    if (!edge.is_connected_to_source_root && source === null) continue;
    flows.push({
      sourceBlock: source,
      targetBlock: target,
      note: edge.label ?? undefined,
      origin: source === null ? 'direct' : 'subcontract',
      isReference: false,
      targetIncomingBlockCount: 0,
    });
  }
  for (const flow of flows) {
    flow.targetIncomingBlockCount = flows.filter(other => other.targetBlock === flow.targetBlock && other.sourceBlock !== null).length;
  }
  const hasSubcontractSource = new Set(flows.filter(flow => flow.sourceBlock !== null).map(flow => flow.targetBlock));
  const hasDirectSource = new Set(flows.filter(flow => flow.sourceBlock === null).map(flow => flow.targetBlock));
  const hasOutgoing = new Set(flows.map(flow => flow.sourceBlock).filter((id): id is string => id !== null));

  const blocks: BlockNode[] = detail.groups.map(group => {
    const direct = hasDirectSource.has(group.display_code) || !hasSubcontractSource.has(group.display_code);
    return {
      blockId: group.display_code,
      blockName: group.name,
      totalAmount: amountOrUnknown(group.total_amount),
      isDirect: direct,
      originKind: direct ? 'direct' : 'subcontract',
      isTerminal: !hasOutgoing.has(group.display_code),
      recipientCount: group.payments.length,
      hasExpenses: group.payments.some(payment => payment.contracts.some(contract => contract.amount_breakdown.length > 0)),
      role: group.overview ?? undefined,
      recipients: group.payments.map(payment => ({
        name: payment.name,
        corporateNumber: payment.corporate_number ?? '',
        amount: amountOrUnknown(payment.total_contract_amount),
        contractSummaries: payment.contracts.map(contract => contract.overview).filter((text): text is string => !!text),
        expenses: payment.contracts.flatMap(contract => contract.amount_breakdown
          .filter(item => item.amount !== null)
          .map(item => ({ category: item.name, purpose: item.purpose, amount: item.amount as number }))),
      })),
    };
  });

  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 1;
    seen.add(id);
    const parents = flows.filter(flow => flow.targetBlock === id && flow.sourceBlock !== null).map(flow => flow.sourceBlock as string);
    const value = parents.length === 0 ? 1 : 1 + Math.max(...parents.map(parent => depthOf(parent, seen)));
    depth.set(id, value);
    return value;
  };
  const directBlocks = blocks.filter(block => block.originKind === 'direct');

  return {
    projectId: detail.projectId,
    projectName: detail.name,
    ministry: detail.ministry,
    bureau: '',
    accountCategory: '',
    budget: Number.NaN,
    execution: amountOrUnknown(detail.execution),
    directExpenseTotal: finiteSum(directBlocks.map(block => block.totalAmount)),
    totalExpense: finiteSum(blocks.map(block => block.totalAmount)),
    blocks,
    flows,
    maxDepth: blocks.length === 0 ? 0 : Math.max(...blocks.map(block => depthOf(block.blockId))),
    directBlockCount: directBlocks.length,
    totalBlockCount: blocks.length,
    totalRecipientCount: blocks.reduce((sum, block) => sum + block.recipients.length, 0),
    indirectCosts: [],
    hasSeparateOrigin: false,
    separateOriginCount: 0,
    strongSeparateOriginCount: 0,
    separateOriginAmount: 0,
    hasMerge: flows.some(flow => flow.targetIncomingBlockCount > 1),
    mergeTargetCount: new Set(flows.filter(flow => flow.targetIncomingBlockCount > 1).map(flow => flow.targetBlock)).size,
    maxMergeWidth: Math.max(0, ...flows.map(flow => flow.targetIncomingBlockCount)),
    branchingBlockCount: [...hasOutgoing].filter(id => flows.filter(flow => flow.sourceBlock === id).length > 1).length,
    maxBranchWidth: Math.max(0, ...[...hasOutgoing].map(id => flows.filter(flow => flow.sourceBlock === id).length)),
    hasReferenceFlow: false,
    isInstitutionalFlowOnly: blocks.length > 0 && blocks.every(block => block.totalAmount === 0 && block.recipients.length === 0),
  };
}
