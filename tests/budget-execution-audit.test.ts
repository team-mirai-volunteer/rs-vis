import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCasesOfProject, loadBudgetExecutionAudit } from '../app/lib/api/budget-execution-audit-loader';

const data = loadBudgetExecutionAudit();

test('予算執行調査: 公表どおりの件数があり、すべて対応表で確認済み', { skip: !data }, () => {
  const byYear = Object.groupBy(data!.cases, c => c.surveyYear);
  assert.deepEqual(Object.fromEntries(Object.entries(byYear).map(([y, cs]) => [y, cs!.length])), { 2024: 31, 2025: 30, 2026: 31 });
  assert.equal(data!.cases.filter(c => c.match === 'pending').length, 0, '対応表に無い事案がある（scripts/data/budget-execution-audit-matches.json を更新）');
});

test('予算執行調査: 反映額の合計が公表の反映額一覧と合う（各行の四捨五入による差のみ）', { skip: !data }, () => {
  const total = (year: number) => data!.cases.filter(c => c.surveyYear === year).reduce((s, c) => s + (c.reflectionAmount ?? 0), 0) / 1e6;
  assert.ok(Math.abs(total(2024) - -4179) <= 3, `令和6年度 ${total(2024)}`);
  assert.ok(Math.abs(total(2025) - -689) <= 3, `令和7年度 ${total(2025)}`);
});

test('予算執行調査: 事業IDから事案を引ける', { skip: !data }, () => {
  const oist = auditCasesOfProject(data!, '185');
  assert.deepEqual(oist.map(c => c.id), ['2025-02']);
  assert.equal(oist[0].reflectionAmount, -515_000_000);
  assert.equal(oist[0].scope, 'same');
  // 横断調査は事業に結びつけない
  assert.deepEqual(data!.cases.find(c => c.id === '2025-30')!.pids, []);
  // byPid は cases の pids と一致する
  for (const c of data!.cases) for (const pid of c.pids) assert.ok(data!.byPid[String(pid)]?.includes(c.id));
});
