import type { SubcontractGraph } from '@/types/subcontract';
import { subcontractSources } from '@/app/lib/subcontracts/block-sources';

export function BlockSources({ graph, blockId }: { graph: Pick<SubcontractGraph, 'blocks' | 'flows'>; blockId: string }) {
  const sources = subcontractSources(graph, blockId);
  if (!sources.length) return null;
  return <span className="block whitespace-normal text-left text-[11px] leading-relaxed text-mirai-text-subtle">委託元：{sources.join(' ／ ')}</span>;
}
