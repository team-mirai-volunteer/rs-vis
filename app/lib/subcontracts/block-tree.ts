import type { BlockNode, SubcontractGraph } from '@/types/subcontract';

export interface BlockTreeNode { block: BlockNode; children: BlockTreeNode[] }

/** 各ブロックは1回だけ表示。合流先は最初の委託元の下に置き、他の委託元は BlockSources で示す。 */
export function buildBlockTree(graph: Pick<SubcontractGraph, 'blocks' | 'flows'>): BlockTreeNode[] {
  const nodes = new Map(graph.blocks.map(block => [block.blockId, { block, children: [] } as BlockTreeNode]));
  const parents = new Map<string, string>();
  for (const flow of graph.flows) {
    const { sourceBlock: source, targetBlock: target } = flow;
    if (!source || flow.origin !== 'subcontract' || flow.isReference || !nodes.has(source) || !nodes.has(target) || parents.has(target)) continue;
    let ancestor: string | undefined = source;
    while (ancestor !== undefined && ancestor !== target) ancestor = parents.get(ancestor);
    if (ancestor === target) continue; // 循環・自己参照では階層を作らない。
    parents.set(target, source);
  }
  const roots: BlockTreeNode[] = [];
  for (const [id, node] of nodes) {
    const parent = parents.get(id);
    if (parent) nodes.get(parent)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}
