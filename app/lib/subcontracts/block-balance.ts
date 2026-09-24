import type { BlockNode, SubcontractGraph } from '@/types/subcontract';

/** 金額はブロック単位。直下だけを合計し、孫ブロックとの二重計上を避ける。 */
export function blockBalance(graph: Pick<SubcontractGraph, 'blocks' | 'flows'>, block: BlockNode) {
  const flows = graph.flows.filter(flow => !flow.isReference && flow.origin !== 'reference');
  const targets = [...new Set(flows.filter(flow => flow.sourceBlock === block.blockId).map(flow => flow.targetBlock))];
  const result = (paid: number | null, difference: number | null, reason: string | null) => ({
    recorded: block.totalAmount, downstream: paid, difference, reason,
    hasReference: graph.flows.some(flow => flow.sourceBlock === block.blockId && (flow.isReference || flow.origin === 'reference')),
    multipleRecipients: Math.max(block.recipientCount, block.recipients.length) > 1,
  });
  if (targets.length === 0) return result(null, null, '直下の再委託先の記載がないため、差額は算出できません。');
  const byId = new Map(graph.blocks.map(item => [item.blockId, item]));
  // 循環する資金移動は、単純な再委託の差引きとして扱わない。
  const pending = [...targets];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === block.blockId) return result(null, null, '循環するフローがあるため、支払額の配分を確定できません。');
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...flows.filter(flow => flow.sourceBlock === id).map(flow => flow.targetBlock));
  }
  let paid = 0;
  for (const id of targets) {
    const target = byId.get(id);
    const incoming = flows.filter(flow => flow.targetBlock === id);
    if (incoming.some(flow => flow.sourceBlock !== block.blockId || flow.targetIncomingBlockCount > 1)) {
      return result(null, null, '再委託先に複数の支出元があり、このブロックからの支払額は配分不明です。');
    }
    if (!target || !Number.isFinite(target.totalAmount) || target.totalAmount <= 0) {
      return result(null, null, '再委託先の金額が未記載または0円のため、支払額を確定できません。');
    }
    paid += target.totalAmount;
  }
  if (!Number.isFinite(block.totalAmount) || block.totalAmount <= 0 || paid > block.totalAmount) {
    return result(paid, null, 'このブロックの記載額が未記載・0円、または直下の記載額の合計が上回るため、差額は算出できません。');
  }
  return result(paid, block.totalAmount - paid, null);
}
