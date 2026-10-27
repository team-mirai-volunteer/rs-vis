import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseOptionalAmount } from '../scripts/csv-reader';
import { BudgetExecutionSection } from '../client/components/BudgetExecutionSection';
import type { BudgetBreakdownItem } from '../types/sankey-svg';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

test('budget amounts preserve blanks, explicit zero and yen values', () => {
  for (const v of ['', ' ', undefined, '-', '－', '―']) assert.equal(parseOptionalAmount(v), null);
  assert.equal(parseOptionalAmount('0'), 0);
  assert.equal(parseOptionalAmount('1,053,000'), 1053000);
  assert.equal(parseOptionalAmount('507000'), 507000);
  assert.throws(() => parseOptionalAmount('unknown'));
});

const item: BudgetBreakdownItem = {
  fiscalYear: 2024, accountCategory: '一般会計', account: '一般会計', subAccount: '',
  budgetType: '当初予算', jurisdiction: '文部科学省', organizationAccount: '文化庁',
  item: '文化振興費', subItem: '諸謝金', note: '', amount: null, nextYearRequestAmount: 1053000,
};
function render(row: BudgetBreakdownItem) {
  return renderToStaticMarkup(createElement(BudgetExecutionSection, {
    budgetSummary: null, budgetBreakdown: [row], scaleFont: x => x, presentation: 'tab',
  }));
}
test('missing FY2024 budget is not displayed as zero or replaced by FY2025 request', () => {
  const html = render(item);
  assert.match(html, /2024年度予算：記載なし/);
  assert.match(html, /2025年度要求：/);
  assert.doesNotMatch(html, /2024年度予算：0/);
  assert.doesNotMatch(html, /内訳合計に差/);
});
test('explicit zero remains zero and missing request is not shown', () => {
  const html = render({ ...item, amount: 0, nextYearRequestAmount: null });
  assert.match(html, /2024年度予算：0/);
  assert.doesNotMatch(html, /2025年度要求：/);
});

test('published graph preserves the FY2024 blank and FY2025 request for PID 20464', () => {
  const graph = JSON.parse(gunzipSync(readFileSync('public/data/sankey-svg-2025-graph.json.gz')).toString('utf8'));
  const node = graph.nodes.find((n: { id: string }) => n.id === 'project-budget-20464');
  const honorarium = node.budgetBreakdown.find((r: BudgetBreakdownItem) => r.subItem === '諸謝金');
  assert.equal(honorarium.fiscalYear, 2024);
  assert.equal(honorarium.amount, null);
  assert.equal(honorarium.nextYearRequestAmount, 1053000);
});
