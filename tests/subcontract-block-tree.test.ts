import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockTree, type BlockTreeNode } from '../app/lib/subcontracts/block-tree';
import type { BlockNode, BlockEdge } from '../types/subcontract';

const block = (blockId: string): BlockNode => ({ blockId, blockName: blockId, totalAmount: 1, isDirect: false,
  originKind: 'subcontract', isTerminal: false, recipientCount: 0, hasExpenses: false, recipients: [] });
const edge = (sourceBlock: string, targetBlock: string, isReference = false): BlockEdge => ({ sourceBlock, targetBlock,
  origin: 'subcontract', isReference, targetIncomingBlockCount: 1 });
const shape = (nodes: BlockTreeNode[]): unknown[] => nodes.map(n => [n.block.blockId, shape(n.children)]);

test('nests subcontract chains once even when a block has multiple sources', () => {
  const tree = buildBlockTree({ blocks: ['A', 'B', 'C', 'D'].map(block),
    flows: [edge('A', 'B'), edge('B', 'C'), edge('D', 'C'), edge('A', 'B')] });
  assert.deepEqual(shape(tree), [['A', [['B', [['C', []]]]]], ['D', []]]);
});

test('reference, missing and cyclic edges do not hide blocks or cause recursion', () => {
  const tree = buildBlockTree({ blocks: ['A', 'B', 'C'].map(block),
    flows: [edge('A', 'B'), edge('B', 'A'), edge('B', 'C', true), edge('missing', 'C'), edge('C', 'C')] });
  assert.deepEqual(shape(tree), [['A', [['B', []]]], ['C', []]]);
});
