import type { BlockNode, SubcontractGraph } from '@/types/subcontract';
import { blockBalance } from '@/app/lib/subcontracts/block-balance';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

export function BlockBalance({ graph, block }: { graph: Pick<SubcontractGraph, 'blocks' | 'flows'>; block: BlockNode }) {
  const balance = blockBalance(graph, block);
  return <section aria-label="ブロックの差額" className="border-b border-border py-2 text-[11px]">
    <dl>
      <div className="flex justify-between gap-2">
        <dt className="font-bold text-mirai-text-secondary">差額（ブロック単位）</dt>
        <dd className="shrink-0 tabular-nums text-mirai-text-secondary">{balance.difference === null ? '配分不明・算出不可' : formatBudgetFromYen(balance.difference)}</dd>
      </div>
    </dl>
    <p className="mt-2 leading-relaxed text-mirai-text-muted">このブロックの記載額 − 直下の再委託先の記載額。実際の受取額や利益を示すものではありません。</p>
    {balance.difference !== null && balance.downstream !== null && <p className="mt-1 tabular-nums text-mirai-text-muted">{formatBudgetFromYen(balance.recorded)} − {formatBudgetFromYen(balance.downstream)} = {formatBudgetFromYen(balance.difference)}</p>}
    {balance.reason && <p className="mt-1 leading-relaxed text-mirai-text-muted">{balance.reason}</p>}
    {balance.multipleRecipients && <p className="mt-1 leading-relaxed text-mirai-text-muted">複数の支出先を含むため、企業別の再委託額・差額は配分不明です。</p>}
    {balance.hasReference && <p className="mt-1 text-mirai-text-muted">参考フローは計算に含めていません。</p>}
  </section>;
}
