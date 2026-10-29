import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBudgetBasis } from '../app/lib/subcontract-ribbon-layout';
import type { BudgetBreakdownItem } from '../types/sankey-svg';

const row = (budgetType: string, amount: number | null, note = ''): BudgetBreakdownItem => ({
  fiscalYear: 2024, accountCategory: '特別会計', account: '労働保険', subAccount: '', budgetType,
  jurisdiction: '', organizationAccount: '', item: '', subItem: '', note, amount, nextYearRequestAmount: null,
});

test('マイナスの内訳があると図は当初予算、パネルは予算現額と呼び分け、差額の行を返す（PID 2519 型）', () => {
  const basis = describeBudgetBasis(
    [row('当初予算', 80_000), row('当初予算', 348_959), row('予備費等1', -14_281, '人勧に伴う諸謝金への流用'), row('当初予算', null)],
    414_678,
  );
  assert.equal(basis.drawnTotal, 428_959);
  assert.equal(basis.differs, true);
  assert.equal(basis.drawnLabel, '当初予算');
  assert.equal(basis.totalLabel, '予算現額');
  assert.deepEqual(basis.adjustments, [{ budgetType: '予備費等1', note: '人勧に伴う諸謝金への流用', amount: -14_281 }]);
});

test('プラスの行に当初予算以外が混じるときは「予算内訳の計」と呼ぶ', () => {
  const basis = describeBudgetBasis([row('当初予算', 100), row('補正予算', 50), row('予備費等1', -10)], 140);
  assert.equal(basis.drawnLabel, '予算内訳の計');
});

test('内訳の合計と予算現額が一致する事業は呼び分けない', () => {
  const basis = describeBudgetBasis([row('当初予算', 100), row('補正予算', 50)], 150);
  assert.equal(basis.differs, false);
  assert.equal(basis.drawnLabel, '予算');
  assert.equal(basis.totalLabel, '予算額');
});

test('内訳が無い事業は呼び分けない', () => {
  assert.equal(describeBudgetBasis(undefined, 100).differs, false);
});
