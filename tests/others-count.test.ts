import test from 'node:test';
import assert from 'node:assert/strict';
import { blockOthersCount, isOthersRowName, matchOthersCount, othersCountFromGroup, othersLabel, othersTitle, sumOthersCounts, OTHERS_COUNT_UNKNOWN_NOTE } from '../app/lib/others-count';
import { rsApiToSubcontractGraph } from '../app/lib/unified-budget/rs-api-panel-adapter';
import type { RsApiDetail } from '../types/rs-api';

const pay = (name: string, amount: number | null = 100) => ({ name, total_contract_amount: amount });
const top10 = Array.from({ length: 10 }, (_, i) => pay(`市町村${i}`));

test('その他行の名前は集約表記だけを拾い、「その他労働局」など個別の名前は含めない', () => {
  assert.ok(isOthersRowName('その他'));
  assert.ok(isOthersRowName(' その他 '));
  assert.ok(isOthersRowName('その他の支出先'));
  assert.ok(!isOthersRowName('その他労働局'));
  assert.ok(!isOthersRowName('株式会社その他'));
});

test('支出先の数から個別記載の行数を引いた件数を出す（多面的機能支払交付金 ブロックF の形）', () => {
  const c = othersCountFromGroup({ payment_count: 25413, payments: [...top10, pay('その他', 45182028000)] });
  assert.deepEqual(c, { n: 25403, t: 25413, a: 45182028000 });
});

test('支出先の数が無い・差が1以下・その他行が複数なら件数を出さない', () => {
  assert.equal(othersCountFromGroup({ payment_count: null, payments: [...top10, pay('その他')] }), null);
  assert.equal(othersCountFromGroup({ payments: [...top10, pay('その他')] }), null);
  assert.equal(othersCountFromGroup({ payment_count: 11, payments: [...top10, pay('その他')] }), null);
  assert.equal(othersCountFromGroup({ payment_count: 8, payments: [...top10, pay('その他')] }), null);
  assert.equal(othersCountFromGroup({ payment_count: 50, payments: [...top10, pay('その他'), pay('その他の支出先')] }), null);
  assert.equal(othersCountFromGroup({ payment_count: 50, payments: top10 }), null);
});

test('公式CSV由来の行とは金額が一致したときだけ件数を使う', () => {
  const entry = { n: 1443, t: 1453, a: 43627288000 };
  assert.equal(matchOthersCount(entry, 43627288000), entry);
  assert.equal(matchOthersCount(entry, 43734793000), null);
  assert.equal(matchOthersCount({ ...entry, a: null }, 43627288000), null);
  assert.equal(matchOthersCount(undefined, 1), null);
  assert.equal(blockOthersCount([{ name: '市町村0', amount: 1 }, { name: 'その他', amount: 43627288000 }], entry), entry);
  assert.equal(blockOthersCount([{ name: '市町村0', amount: 43627288000 }], entry), null);
});

test('表示名と注記。件数が分からなければ記載が無い旨を出す', () => {
  assert.equal(othersLabel('その他', { n: 1443 }), 'その他（1,443件）');
  assert.equal(othersLabel('その他', null), 'その他');
  assert.match(othersTitle({ n: 1443, t: 1453 }), /1,453件から、個別に記載された10件を引いた/);
  assert.equal(othersTitle(null), OTHERS_COUNT_UNKNOWN_NOTE);
});

test('複数ブロックは全ブロックの件数が分かるときだけ合計する', () => {
  const known = sumOthersCounts([{ blockId: 'A', count: { n: 10, t: 20, a: 1 } }, { blockId: 'B', count: { n: 5, t: 15, a: 1 } }]);
  assert.equal(known.total, 15);
  assert.match(known.title, /ブロックA: 10件\nブロックB: 5件/);
  const partial = sumOthersCounts([{ blockId: 'A', count: { n: 10, t: 20, a: 1 } }, { blockId: 'B', count: undefined }]);
  assert.equal(partial.total, null);
  assert.match(partial.title, /ブロックB: 件数不明/);
  assert.equal(sumOthersCounts([]).total, null);
});

test('暫定（RS公開API）のブロックにも件数を付ける', () => {
  const payments = [...top10, pay('その他', 500)].map((p, i) => ({ id: `p${i}`, name: p.name, corporate_number: null, is_others: p.name === 'その他',
    type: 'payee', total_contract_amount: p.total_contract_amount, contracts: [] }));
  const detail: RsApiDetail = { id: 'x', projectId: 1, name: '事業', ministry: '省', sourceUrl: '', fiscalYear: 2026, overview: '', purpose: '',
    execution: 1500, paymentStatus: 'available', fetchedAt: null,
    groups: [{ id: 'g1', project_id: 'x', display_code: 'A', name: '市町村', overview: null, payment_count: 1453, total_amount: 1500, payments }],
    edges: [{ source_node_id: null, target_node_id: 'g1', is_connected_to_source_root: true, label: null }] };
  assert.deepEqual(rsApiToSubcontractGraph(detail)?.blocks[0].othersCount, { n: 1443, t: 1453, a: 500 });
});
