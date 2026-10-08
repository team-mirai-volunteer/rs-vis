'use client';

import { BudgetExecutionSection } from '@/client/components/BudgetExecutionSection';
import { UnifiedBlockRecipients, UnifiedProjectBlocks, useProjectBlocks } from '@/client/components/unified-budget/UnifiedProjectBlocks';

export type ScoreRecipientTab = 'recipients' | 'blocks' | 'budget';

/**
 * 評価モーダルの支出先一覧に並ぶ「ブロック・再委託」「予算内訳」タブの中身。サンキー図と同じ部品を使う。
 * ブロックを選ぶと支出先タブをそのブロックで絞り込む（onSelectBlock）。
 */
export function ScoreProjectStructure({ pid, year, tab, onSelectBlock }: {
  pid: string; year: string; tab: Exclude<ScoreRecipientTab, 'recipients'>; onSelectBlock: (blockId: string) => void;
}) {
  const graph = useProjectBlocks(Number(pid), Number(year));
  if (tab === 'blocks') return <UnifiedProjectBlocks graph={graph} year={Number(year)} onSelect={b => onSelectBlock(b.blockId)} />;
  if (graph === undefined) return <p role="status" className="py-2 text-xs">予算内訳を読み込み中…</p>;
  if (graph === null) return <p className="py-2 text-xs">予算内訳を取得できませんでした。</p>;
  return graph.budgetSummary || graph.budgetBreakdown?.length
    ? <BudgetExecutionSection budgetSummary={graph.budgetSummary} budgetBreakdown={graph.budgetBreakdown ?? []} scaleFont={px => px} presentation="tab" />
    : <p className="py-2 text-xs">予算内訳の記載はありません。</p>;
}

/** 支出先タブをブロックで絞り込んでいるときの見出し（ブロック名・委託元・差額・解除） */
export function ScoreBlockFilterHeader({ pid, year, blockId, onClear }: { pid: string; year: string; blockId: string; onClear: () => void }) {
  const graph = useProjectBlocks(Number(pid), Number(year));
  const block = graph?.blocks.find(b => b.blockId === blockId);
  return graph && block ? <UnifiedBlockRecipients graph={graph} block={block} onClear={onClear} /> : null;
}
