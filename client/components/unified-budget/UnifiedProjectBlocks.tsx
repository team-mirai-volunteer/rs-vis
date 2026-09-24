import type { SubcontractGraph, BlockNode } from '@/types/subcontract';
import type { BudgetSummary, BudgetBreakdownItem } from '@/types/sankey-svg';
import { Button } from '@/components/ui/button';
import { TagChip } from '@/client/components/TagChip';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { useCached } from './policy-summary-cache';
import { BlockBalance } from '@/client/components/subcontract/BlockBalance';
import { BlockSources } from '@/client/components/subcontract/BlockSources';
import { rsViewUrl } from '@/app/lib/rs-fiscal-year';

type ProjectBlocks = SubcontractGraph & { budgetSummary?: BudgetSummary; budgetBreakdown?: BudgetBreakdownItem[] };
const cache = new Map<string, ProjectBlocks | null>();
const extract = (data: unknown) => data as ProjectBlocks;

export function useProjectBlocks(pid: number | undefined, year: number) {
  return useCached(cache, pid === undefined ? null : `${year}-${pid}`, `/api/subcontracts/${pid}?year=${year}`, extract);
}

export function UnifiedProjectBlocks({ graph, year, onSelect }: {
  graph: ProjectBlocks | null | undefined;
  year: number;
  onSelect: (block: BlockNode) => void;
}) {
  if (graph === undefined) return <p role="status" className="py-2 text-xs text-mirai-text-muted">ブロックを読み込み中…</p>;
  if (graph === null) return <p className="py-2 text-xs text-mirai-text-muted">ブロック情報を取得できませんでした。</p>;
  if (graph.blocks.length === 0) return <p className="py-2 text-xs text-mirai-text-muted">ブロックの記載はありません。</p>;
  const direct = graph.blocks.filter(block => block.originKind === 'direct').length;
  const subcontract = graph.blocks.filter(block => block.originKind === 'subcontract').length;
  const separate = graph.blocks.length - direct - subcontract;
  return <>
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border py-2 text-[11px] text-mirai-text-muted">
      <TagChip kind="direct">直接 {direct}</TagChip>
      {subcontract > 0 && <TagChip kind="subcontract">再委託 {subcontract}</TagChip>}
      {separate > 0 && <TagChip kind="separate-origin">別財源 {separate}</TagChip>}
      <span>階層 {graph.maxDepth}</span>
      <a href={rsViewUrl(`/subcontracts/${graph.projectId}`, year)} className="ml-auto text-primary hover:underline">フローを見る ↗</a>
    </div>
    {graph.blocks.map(block => <Button key={block.blockId} variant="ghost" onClick={() => onSelect(block)}
      className="flex h-auto w-full flex-col items-stretch gap-1 whitespace-normal rounded-none border-b border-border px-1 py-1.5 text-left font-normal hover:bg-mirai-surface">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-xs text-mirai-text-secondary">{block.blockId} {block.blockName}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">{formatBudgetFromYen(block.totalAmount)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-mirai-text-muted">
        <TagChip kind={block.originKind === 'direct' ? 'direct' : block.originKind === 'subcontract' ? 'subcontract' : 'separate-origin'}>
          {block.originKind === 'direct' ? '直接' : block.originKind === 'subcontract' ? '再委託' : '別財源'}
        </TagChip>
        <span>支出先 {block.recipients.length.toLocaleString()}件</span>
      </span>
      <BlockSources graph={graph} blockId={block.blockId} />
      {block.role && <span className="text-[11px] leading-relaxed text-mirai-text-muted">{block.role}</span>}
    </Button>)}
  </>;
}

export function UnifiedBlockRecipients({ graph, block, onClear }: { graph: SubcontractGraph; block: BlockNode; onClear: () => void }) {
  return <>
    <div className="flex items-start justify-between gap-2 border-b border-border py-2 text-xs">
      <span className="text-mirai-text-secondary">ブロック {block.blockId} {block.blockName}</span>
      <Button variant="ghost" size="xs" onClick={onClear} className="shrink-0 text-[11px] text-primary">絞り込みを解除</Button>
    </div>
    <BlockSources graph={graph} blockId={block.blockId} />
    <BlockBalance graph={graph} block={block} />
    {block.recipients.length === 0 && <p className="py-2 text-xs text-mirai-text-muted">このブロックに支出先の記載はありません。</p>}
    {block.recipients.map((recipient, index) => <div key={`${recipient.name}-${index}`} className="border-b border-border px-1 py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-xs text-mirai-text-secondary">{recipient.name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">{formatBudgetFromYen(recipient.amount)}</span>
      </div>
      {recipient.corporateNumber && <div className="mt-1 text-[11px] text-mirai-text-muted">法人番号 {recipient.corporateNumber}</div>}
      {recipient.contractSummaries.map((summary, i) => <p key={i} className="mt-1 text-[11px] leading-relaxed text-mirai-text-muted">{summary}</p>)}
    </div>)}
  </>;
}
