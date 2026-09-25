import type { BlockNode, SubcontractGraph } from '@/types/subcontract';
import { blockBalance } from '@/app/lib/subcontracts/block-balance';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

/**
 * ブロックの差額（記載額 − 直下の再委託先の記載額）。表示は差額と計算式だけに絞り、
 * 定義・注意書きはラベルのツールチップに寄せる。算出できないときだけ理由を 1 行添える。
 */
export function BlockBalance({ graph, block }: { graph: Pick<SubcontractGraph, 'blocks' | 'flows'>; block: BlockNode }) {
  const balance = blockBalance(graph, block);
  const note = [
    'このブロックの記載額 − 直下の再委託先の記載額。実際の受取額や利益を示すものではありません。',
    balance.multipleRecipients ? '複数の支出先を含むため、企業別の再委託額・差額は配分不明です。' : null,
    balance.hasReference ? '参考フローは計算に含めていません。' : null,
  ].filter(Boolean).join('\n');
  return <section aria-label="ブロックの差額" className="border-b border-border py-2 text-[11px]">
    <dl className="flex flex-wrap items-baseline gap-x-2">
      <dt className="cursor-help font-bold text-mirai-text-secondary" title={note}>差額（ブロック単位）</dt>
      {balance.difference !== null && balance.downstream !== null && (
        <dd className="tabular-nums text-mirai-text-muted">
          {formatBudgetFromYen(balance.recorded)} − {formatBudgetFromYen(balance.downstream)} = {formatBudgetFromYen(balance.difference)}
        </dd>
      )}
      <dd className="ml-auto shrink-0 font-bold tabular-nums text-mirai-text-secondary">
        {balance.difference === null ? '算出不可' : formatBudgetFromYen(balance.difference)}
      </dd>
    </dl>
    {balance.difference === null && balance.reason && <p className="mt-1 leading-relaxed text-mirai-text-muted">{balance.reason}</p>}
  </section>;
}
