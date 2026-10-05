import test from 'node:test';
import assert from 'node:assert/strict';
import { fundSignals, fundsHeldBy, fundsOfProject, spendingYears } from '../app/lib/funds';
import type { Fund, FundYear } from '../types/funds';

const year = (over: Partial<FundYear>): FundYear => ({ sheetYear: 2026, balance: 1000, nationalBalance: null, granted: null, income: null, expense: 100,
  businessExpense: null, adminExpense: null, adminRate: null, returned: null, divergence: null, ownership: null, projectId: 'x', ...over });
const fund = (over: Partial<Fund>, y: Partial<FundYear> = {}): Fund => ({ key: 'k', name: '基金', ministry: 'A省', owner: '株式会社テスト', ownerForm: null,
  sheetNumber: 1, operationForms: [], businessForms: [], createdYear: 2020, endDate: '2030-03-31', newApplicationEndDate: '2029-03-31', necessity: null,
  ownershipBasis: null, inspection: { noRecentResult: false, ceasedOperations: false, lostPurpose: false, ownershipFarAboveOne: false, unlikelyToBeUsed: false },
  inspectionNote: null, overviewUrl: null, compositions: [], relatedPids: ['12'], years: [year(y)], ...over });

test('残高が支出の何年分かと、10年分以上の判定', () => {
  assert.equal(spendingYears(year({})), 10);
  assert.deepEqual(fundSignals(fund({})), ['tenYears']);
  assert.equal(spendingYears(year({ expense: 0 })), null);
  assert.deepEqual(fundSignals(fund({}, { expense: 0 })), ['noSpending']);
});

test('新規受付・終了予定の後の残高は、残高の時点（シート年度の4月1日）で判定する', () => {
  const s = fundSignals(fund({ newApplicationEndDate: '2025-03-31', endDate: '2026-03-31' }, { expense: 500 }));
  assert.ok(s.includes('newApplicationClosed') && s.includes('pastEnd'));
  assert.deepEqual(fundSignals(fund({ newApplicationEndDate: '2025-03-31' }, { balance: 0, expense: 500 })), []);
});

test('国庫返納・保有割合1超・点検の該当', () => {
  const s = fundSignals(fund({ inspection: { noRecentResult: true, ceasedOperations: false, lostPurpose: false, ownershipFarAboveOne: false, unlikelyToBeUsed: false } },
    { expense: 500, returned: 5, ownership: 1.2 }));
  assert.deepEqual(s, ['returned', 'ownershipOverOne', 'inspection']);
});

test('保有法人名・事業IDで基金を引く', () => {
  const funds = [fund({ key: 'a' }), fund({ key: 'b', owner: '別法人', relatedPids: [] })];
  assert.deepEqual(fundsHeldBy(funds, ['株式会社 テスト']).map(f => f.key), ['a']);
  assert.deepEqual(fundsOfProject(funds, '12').map(f => f.key), ['a']);
});
