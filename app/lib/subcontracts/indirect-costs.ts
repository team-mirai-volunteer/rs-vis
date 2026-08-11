import type { IndirectCost } from '@/types/subcontract';

/** オフサンキー間接経費（支出先ブロックを持たない＝フロー図に現れない支出）の集計結果 */
export interface IndirectCostSummary {
  /** amount > 0 の合計（円） */
  total: number;
  /** 対象件数（金額0の行も含む） */
  count: number;
  /** 金額降順の対象項目 */
  items: IndirectCost[];
}

/** フロー図の終端ノードに載せる表示名（ラベル・ツールチップ・タブで共通） */
export const INDIRECT_COST_NODE_LABEL = '間接経費';

/**
 * 「サンキーに乗らない間接経費」を集計する。
 *
 * `attachedToBlock === true` の行は支出先ブロックを持ちフロー（blocks/flows）にも現れるため、
 * 二重計上を避けて除外する。フィールドを持たない旧データは実測上すべてブロック無しのため
 * 除外しない。
 */
export function summarizeOffFlowIndirectCosts(costs: IndirectCost[] | undefined): IndirectCostSummary {
  const items = (costs ?? []).filter((c) => c.attachedToBlock !== true);
  const total = items.reduce((sum, c) => sum + Math.max(0, c.amount), 0);
  return {
    total,
    count: items.length,
    items: [...items].sort((a, b) => b.amount - a.amount),
  };
}
