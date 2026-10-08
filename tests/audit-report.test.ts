import test from 'node:test';
import assert from 'node:assert/strict';
import { auditItemsOfProject, loadAuditReport } from '../app/lib/api/audit-report-loader';

const data = loadAuditReport();

test('決算検査報告: 令和5・6年度の第3章の指摘を取り込み、府省ごとのまとめページは含めない', { skip: !data }, () => {
  const years = new Set(data!.items.map(i => i.fiscalYear));
  assert.deepEqual([...years].sort(), [2023, 2024]);
  assert.ok(data!.items.length > 250);
  assert.ok(!data!.items.some(i => /の実施及び経理が不当と認められるもの$/.test(i.title)));
  // 金額は不当事項にだけ持たせる（意見・処置要求の金額は意味が事項ごとに違う）
  assert.ok(data!.items.every(i => i.amount === null || i.kind === '不当事項'));
});

test('決算検査報告: 事業IDから指摘を引ける', { skip: !data }, () => {
  const items = auditItemsOfProject(data!, '470');
  assert.deepEqual(items.map(i => i.id), ['2024-0042-0']);
  assert.equal(items[0].amount, 13_587_239);
  for (const i of data!.items) for (const pid of i.pids) assert.ok(data!.byPid[String(pid)]?.includes(i.id));
});
