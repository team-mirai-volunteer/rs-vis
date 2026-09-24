'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { BudgetExecutionSection } from '@/client/components/BudgetExecutionSection';
import { UnifiedBlockRecipients, UnifiedProjectBlocks, useProjectBlocks } from '@/client/components/unified-budget/UnifiedProjectBlocks';

/** 評価モーダルでも、サンキー図と同じ予算内訳・委託元・支出先をたどれるようにする。 */
export function ScoreProjectStructure({ pid, year }: { pid: string; year: string }) {
  const graph = useProjectBlocks(Number(pid), Number(year));
  const [tab, setTab] = useState('ブロック・再委託');
  const [blockId, setBlockId] = useState<string | null>(null);
  const block = graph?.blocks.find(b => b.blockId === blockId);
  return <div>
    <div className="flex flex-wrap gap-2 border-b border-mirai-border pb-2" aria-label="構造の表示切り替え">
      {['ブロック・再委託', '予算内訳'].map(label => <Button key={label} variant={tab === label ? 'outline' : 'ghost'} size="xs"
        aria-pressed={tab === label} onClick={() => setTab(label)}>{label}</Button>)}
    </div>
    {tab === 'ブロック・再委託' ? block && graph
      ? <UnifiedBlockRecipients graph={graph} block={block} onClear={() => setBlockId(null)} />
      : <UnifiedProjectBlocks graph={graph} year={Number(year)} onSelect={b => setBlockId(b.blockId)} />
      : graph === undefined ? <p role="status" className="py-2 text-xs">予算内訳を読み込み中…</p>
      : graph === null ? <p className="py-2 text-xs">予算内訳を取得できませんでした。</p>
      : graph.budgetSummary || graph.budgetBreakdown?.length
        ? <BudgetExecutionSection budgetSummary={graph.budgetSummary} budgetBreakdown={graph.budgetBreakdown ?? []} scaleFont={px => px} presentation="tab" />
        : <p className="py-2 text-xs">予算内訳の記載はありません。</p>}
  </div>;
}
