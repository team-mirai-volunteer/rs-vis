import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fiscalYear, sheetYearFromParams, rsViewUrl } from '../app/lib/rs-fiscal-year';
import { subcontractSources } from '../app/lib/subcontracts/block-sources';
import type { SubcontractIndex, BlockEdge, BlockNode } from '../types/subcontract';

test('実績年度と旧シート年度URLが同じデータを選び、要求年度は減算しない', () => {
  for (const sheet of [2024, 2025]) {
    const url = new URL(rsViewUrl('/quality?pid=1503', sheet), 'http://localhost');
    assert.equal(url.searchParams.get('fiscalYear'), String(sheet - 1));
    assert.equal(sheetYearFromParams(url.searchParams), String(sheet));
    assert.equal(sheetYearFromParams(new URLSearchParams(`year=${sheet}`)), String(sheet));
    assert.equal(sheetYearFromParams(new URLSearchParams(`yr=${sheet}`), 'yr'), String(sheet));
  }
  assert.equal(fiscalYear(2026), 2026);
  assert.equal(sheetYearFromParams(new URLSearchParams('fiscalYear=2026'), 'year', true), '2026');
  assert.equal(sheetYearFromParams(new URLSearchParams('fiscalYear=2024&year=2024')), '2025');
});

test('再委託元は同名・複数元を番号で区別し、参考線と直接支出を除く', () => {
  const flow = (sourceBlock: string | null, origin: BlockEdge['origin'] = 'subcontract', isReference = false): BlockEdge =>
    ({ sourceBlock, targetBlock: 'C', origin, isReference, targetIncomingBlockCount: 2 });
  assert.deepEqual(subcontractSources({
    blocks: [{ blockId: 'A', blockName: '同名' }, { blockId: 'B', blockName: '同名' }] as BlockNode[],
    flows: [flow('B'), flow('A'), flow('B'), flow('D', 'subcontract', true), flow(null, 'direct'), flow('E', 'reference')],
  }, 'C'), ['A 同名', 'B 同名']);
});

for (const year of [2024, 2025]) test(`${year}シートの全評価でブロック数が委託構造と一致する`, () => {
  const read = (name: string) => JSON.parse(gunzipSync(readFileSync(`public/data/${name}.json.gz`)).toString());
  const graphs = read(`subcontracts-${year}`) as SubcontractIndex;
  const scores = read(`project-quality-scores-${year}`) as Array<{ pid: string; blockCount: number }>;
  let checked = 0;
  for (const score of scores) {
    if (!graphs[score.pid]) continue;
    assert.equal(score.blockCount, new Set(graphs[score.pid].blocks.map(block => block.blockId)).size, score.pid);
    checked++;
  }
  assert.ok(checked > 4000);
});
