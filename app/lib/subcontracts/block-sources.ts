import type { SubcontractGraph } from '@/types/subcontract';

/** 参考線は実際の委託元として扱わない。合流元は省略せず番号で区別する。 */
export function subcontractSources(graph: Pick<SubcontractGraph, 'blocks' | 'flows'>, blockId: string): string[] {
  const ids = new Set(graph.flows.filter(flow => flow.targetBlock === blockId && flow.sourceBlock !== null
    && flow.origin === 'subcontract' && !flow.isReference).map(flow => flow.sourceBlock!));
  return [...ids].sort((a, b) => a.localeCompare(b, 'ja')).map(id => {
    const block = graph.blocks.find(candidate => candidate.blockId === id);
    return block ? `${id} ${block.blockName}` : id;
  });
}
