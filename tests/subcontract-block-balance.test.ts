import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockBalance } from '../app/lib/subcontracts/block-balance';
import type { BlockNode, BlockEdge } from '../types/subcontract';

const block = (blockId: string, totalAmount: number, recipientCount = 1): BlockNode => ({
  blockId, blockName: blockId, totalAmount, recipientCount, recipients: [], isDirect: blockId === 'A',
  originKind: blockId === 'A' ? 'direct' : 'subcontract', isTerminal: false, hasExpenses: false,
});
const flow = (sourceBlock: string | null, targetBlock: string, extra: Partial<BlockEdge> = {}): BlockEdge => ({
  sourceBlock, targetBlock, origin: 'subcontract', isReference: false, targetIncomingBlockCount: 1, ...extra,
});
const a = block('A', 100);
const b = block('B', 60);
const c = block('C', 20);

test('difference subtracts direct children once, not grandchildren or reference flows', () => {
  const result = blockBalance({ blocks: [a, b, c], flows: [flow('A', 'B'), flow('A', 'B'), flow('B', 'C'), flow('A', 'C', { isReference: true })] }, a);
  assert.equal(result.difference, 40);
  assert.equal(result.downstream, 60);
  assert.equal(result.hasReference, true);
  assert.equal(blockBalance({ blocks: [a, b, c], flows: [flow('A', 'B'), flow('A', 'C')] }, a).difference, 20);
});

test('merged funding, including funding from the government, cannot be allocated', () => {
  for (const other of ['C', null]) {
    const result = blockBalance({ blocks: [a, b, c], flows: [flow('A', 'B'), flow(other, 'B')] }, a);
    assert.equal(result.difference, null);
    assert.match(result.reason!, /配分不明/);
  }
});

test('missing downstream amounts and absent flows do not imply zero subcontracting', () => {
  for (const blocks of [[a], [a, block('B', 0)]]) {
    assert.equal(blockBalance({ blocks, flows: [flow('A', 'B')] }, a).difference, null);
  }
  assert.equal(blockBalance({ blocks: [a], flows: [] }, a).difference, null);
});

test('cycles and inconsistent amounts cannot produce a retained amount', () => {
  assert.equal(blockBalance({ blocks: [a, b], flows: [flow('A', 'B'), flow('B', 'A')] }, a).difference, null);
  assert.equal(blockBalance({ blocks: [a, block('B', 120)], flows: [flow('A', 'B')] }, a).difference, null);
  assert.equal(blockBalance({ blocks: [a, block('B', 100)], flows: [flow('A', 'B')] }, a).difference, 0);
});

test('multiple recipients only allow a block-level difference', () => {
  const multi = block('A', 100, 2);
  const result = blockBalance({ blocks: [multi, b], flows: [flow('A', 'B')] }, multi);
  assert.equal(result.difference, 40);
  assert.equal(result.multipleRecipients, true);
});
