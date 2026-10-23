import type { SubcontractGraph } from '@/types/subcontract';

/**
 * 直接支出のうち、直接の支出先からさらに先のブロックへ流れた額と、その割合（0〜1）。
 *
 * 「支出額合計」は各段階を足した額で同じお金を二重に数えるため、分母にしない。
 * 分子は直接支出ブロックから 1 段先のブロックの金額だけ（2 段目以降を足すとまた二重になる）。
 * 先のブロックは契約上の再委託とは限らない（補助金の再交付・支出委任なども 5-2 では同じ形で並ぶ）。
 */
export function onwardShare(g: SubcontractGraph): { amount: number; share: number | null } {
  const direct = new Set(g.blocks.filter(b => b.originKind === 'direct').map(b => b.blockId));
  const amountById = new Map(g.blocks.map(b => [b.blockId, b.totalAmount]));
  const firstHop = new Set<string>();
  for (const f of g.flows) {
    if (f.isReference || f.sourceBlock === null || !direct.has(f.sourceBlock) || direct.has(f.targetBlock)) continue;
    firstHop.add(f.targetBlock);
  }
  const amount = [...firstHop].reduce((sum, id) => sum + Math.max(0, amountById.get(id) ?? 0), 0);
  const share = g.directExpenseTotal > 0 ? Math.min(1, amount / g.directExpenseTotal) : null;
  return { amount, share };
}
