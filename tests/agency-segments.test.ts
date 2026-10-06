import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAgencySegments, segmentsOfProject } from '../app/lib/api/agency-segments-loader';

const data = loadAgencySegments();

test('セグメントシート: 3年度分を取り込み、事業への対応と法人自身の判定が一貫している', { skip: !data }, () => {
  assert.deepEqual([...new Set(data!.segments.map(s => s.sheetYear))].sort(), [2024, 2025, 2026]);
  for (const s of data!.segments) {
    assert.equal(s.pids.length > 0, s.linkBasis !== null, `${s.id} の対応の根拠`);
    for (const pid of s.pids) assert.ok(data!.byPid[String(pid)]?.includes(s.id));
  }
  assert.ok(data!.segments.some(s => s.groups.some(g => g.self)));
});

test('セグメントシート: 事業IDから指定年度のセグメントを引き、無い年度は最新の年度に戻る', { skip: !data }, () => {
  const jica = segmentsOfProject(data!, '1098', 2025);
  assert.ok(jica.length > 0 && jica.every(s => s.agency === '国際協力機構' && s.sheetYear === 2025));
  for (let i = 1; i < jica.length; i++) assert.ok((jica[i - 1].execution ?? 0) >= (jica[i].execution ?? 0), '執行額の大きい順');
  const fallback = segmentsOfProject(data!, '1098', 2099);
  assert.ok(fallback.length > 0 && fallback.every(s => s.sheetYear === 2026));
});
