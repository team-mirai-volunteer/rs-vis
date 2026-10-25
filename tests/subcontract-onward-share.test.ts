import test from 'node:test';
import assert from 'node:assert/strict';
import { onwardKind, onwardKindBreakdown, onwardShare } from '../app/lib/subcontract-onward-share';
import type { SubcontractGraph } from '../types/subcontract';
import type { ContractMethodEntry } from '../app/lib/contract-method';

const block = (blockId: string, originKind: 'direct' | 'subcontract', totalAmount: number) =>
  ({ blockId, blockName: blockId, totalAmount, isDirect: originKind === 'direct', originKind, isTerminal: false, recipientCount: 1, hasExpenses: false, recipients: [] });
const flow = (sourceBlock: string | null, targetBlock: string) =>
  ({ sourceBlock, targetBlock, origin: 'subcontract' as const, isReference: false, targetIncomingBlockCount: 1 });

// 国 → A（100）→ B（60）→ C（50）。支出額合計 210 は二重計上なので分母にしない
const graph = {
  directExpenseTotal: 100, totalExpense: 210,
  blocks: [block('A', 'direct', 100), block('B', 'subcontract', 60), block('C', 'subcontract', 50)],
  flows: [flow(null, 'A'), flow('A', 'B'), flow('B', 'C')],
} as unknown as SubcontractGraph;

test('再委託率は直接支出に対する 1 段先の額の割合（2 段目以降は足さない）', () => {
  assert.deepEqual(onwardShare(graph), { amount: 60, share: 0.6 });
});

test('契約方式から再委託の種類を分ける', () => {
  assert.equal(onwardKind({ m: 'subsidy' }), '補助・交付金');
  assert.equal(onwardKind({ m: 'open-tendering-lowest-price' }), '委託・請負');
  assert.equal(onwardKind({ m: 'others', mt: '支出委任' }), '支出委任・その他');
  assert.equal(onwardKind({ m: 'others', mt: '交付金交付' }), '補助・交付金');
  assert.equal(onwardKind({ m: 'others', mt: '再委託' }), '委託・請負');
  assert.equal(onwardKind({ m: 'others' }), '種別の記載なし');
});

test('内訳は 1 段先のブロックの契約だけを金額で按分する', () => {
  const e = (b: string, a: number, m: ContractMethodEntry['m'], mt?: string): ContractMethodEntry => ({ b, n: 'x', cn: '', a, m, ...(mt ? { mt } : {}) });
  const kinds = onwardKindBreakdown(graph, [e('A', 100, 'subsidy'), e('B', 45, 'others', '支出委任'), e('B', 15, 'open-tendering-lowest-price'), e('C', 50, 'subsidy')]);
  assert.deepEqual(kinds, [{ kind: '支出委任・その他', share: 0.75 }, { kind: '委託・請負', share: 0.25 }]);
});
