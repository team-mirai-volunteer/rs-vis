import test from 'node:test';
import assert from 'node:assert/strict';
import { compareYearsSummary } from '../app/lib/sankey-query';
import type { RawEdge, RawNode } from '../types/sankey-svg';

/** 1事業が各支出先へ支払うグラフ。支出先ノードIDは実データと同じく受領額の大きい順の連番にする */
function graph(recipients: Array<{ name: string; amount: number; aggregated?: boolean; corporateNumber?: string }>): { nodes: RawNode[]; edges: RawEdge[]; excludedIds: null } {
  const total = recipients.reduce((s, r) => s + r.amount, 0);
  const sorted = [...recipients].sort((a, b) => b.amount - a.amount);
  const nodes: RawNode[] = [
    { id: 'project-budget-1', name: '事業1', type: 'project-budget', value: total, projectId: 1 },
    { id: 'project-spending-1', name: '事業1', type: 'project-spending', value: total, projectId: 1 },
    ...sorted.map((r, i): RawNode => ({ id: `r-${i + 1}`, name: r.name, type: 'recipient', value: r.amount, ...(r.aggregated ? { aggregated: true } : {}), ...(r.corporateNumber ? { representativeCorporateNumber: r.corporateNumber, corporateNumberCount: 1 } : {}) })),
  ];
  const edges: RawEdge[] = sorted.map((r, i) => ({ source: 'project-spending-1', target: `r-${i + 1}`, value: r.amount }));
  return { nodes, edges, excludedIds: null };
}

test('年度間で受領額の順位が入れ替わっても、同じ支出先どうしを比較する', () => {
  // base: A社=r-1, B社=r-2 ／ compare: B社=r-1, A社=r-2
  const base = graph([{ name: 'A社', amount: 600 }, { name: 'B社', amount: 500 }]);
  const compare = graph([{ name: 'A社', amount: 550 }, { name: 'B社', amount: 700 }]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.increased, [
    { id: 'r-1', baseId: 'r-2', name: 'B社', otherNames: [], nodeCountBase: 1, nodeCountCompare: 1, inflowBase: 500, inflowCompare: 700, diff: 200, diffRate: 0.4 },
  ]);
  assert.deepEqual(recipients.decreased, [
    { id: 'r-2', baseId: 'r-1', name: 'A社', otherNames: [], nodeCountBase: 1, nodeCountCompare: 1, inflowBase: 600, inflowCompare: 550, diff: -50, diffRate: -0.0833 },
  ]);
  assert.deepEqual(recipients.added, []);
  assert.deepEqual(recipients.removed, []);
});

test('同じノードIDでも支出先名が違えば別の支出先として新規・消滅に分ける', () => {
  const base = graph([{ name: 'A社', amount: 600 }, { name: 'B社', amount: 500 }]);
  const compare = graph([{ name: 'C社', amount: 900 }, { name: 'B社', amount: 500 }]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.added, [{ id: 'r-1', name: 'C社', otherNames: [], nodeCount: 1, inflow: 900 }]);
  assert.deepEqual(recipients.removed, [{ id: 'r-1', name: 'A社', otherNames: [], nodeCount: 1, inflow: 600 }]);
  assert.deepEqual(recipients.increased, []);
  assert.deepEqual(recipients.decreased, []);
});

test('法人番号が同じなら、名前が変わっても同じ支出先として比較する', () => {
  const base = graph([{ name: '株式会社旧社名', amount: 600, corporateNumber: '1000000000001' }, { name: 'B社', amount: 500 }]);
  const compare = graph([{ name: '株式会社新社名', amount: 400, corporateNumber: '1000000000001' }, { name: 'B社', amount: 500 }]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.decreased, [
    { id: 'r-2', baseId: 'r-1', name: '株式会社新社名', otherNames: ['株式会社旧社名'], nodeCountBase: 1, nodeCountCompare: 1, inflowBase: 600, inflowCompare: 400, diff: -200, diffRate: -0.3333 },
  ]);
  assert.deepEqual([...recipients.increased, ...recipients.added, ...recipients.removed], []);
});

test('同じ名前でも法人番号が違えば別の支出先として扱う', () => {
  const base = graph([{ name: '東海建設株式会社', amount: 600, corporateNumber: '1000000000001' }]);
  const compare = graph([{ name: '東海建設株式会社', amount: 700, corporateNumber: '2000000000002' }]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.added.map(r => r.inflow), [700]);
  assert.deepEqual(recipients.removed.map(r => r.inflow), [600]);
  assert.deepEqual([...recipients.increased, ...recipients.decreased], []);
});

test('同じ法人番号のノードが年度内に複数あれば合算し、受領額が最大のノードのIDと名前、残りの名前と件数を返す', () => {
  const base = graph([{ name: '株式会社ウミライ', amount: 300, corporateNumber: '1000000000001' }]);
  const compare = graph([
    { name: '株式会社ウミライ', amount: 250, corporateNumber: '1000000000001' },
    { name: 'ウミライ九州支店', amount: 100, corporateNumber: '1000000000001' },
  ]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.increased, [
    { id: 'r-1', baseId: 'r-1', name: '株式会社ウミライ', otherNames: ['ウミライ九州支店'], nodeCountBase: 1, nodeCountCompare: 2, inflowBase: 300, inflowCompare: 350, diff: 50, diffRate: 0.1667 },
  ]);
  assert.deepEqual([...recipients.decreased, ...recipients.added, ...recipients.removed], []);
});

test('片方の年度にしか法人番号の記載が無い支出先も、同じ法人番号の支出先として合算する', () => {
  // base は本省・地方機関とも本省の法人番号つき、compare は地方機関の法人番号が空欄
  const base = graph([
    { name: '農林水産省', amount: 300, corporateNumber: '5000012080001' },
    { name: '東北農政局', amount: 200, corporateNumber: '5000012080001' },
  ]);
  const compare = graph([
    { name: '農林水産省', amount: 280, corporateNumber: '5000012080001' },
    { name: '東北農政局', amount: 250 },
  ]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.increased, [
    { id: 'r-1', baseId: 'r-1', name: '農林水産省', otherNames: ['東北農政局'], nodeCountBase: 2, nodeCountCompare: 2, inflowBase: 500, inflowCompare: 530, diff: 30, diffRate: 0.06 },
  ]);
  assert.deepEqual([...recipients.decreased, ...recipients.added, ...recipients.removed], []);
});

test('法人番号の無い支出先は、表記ゆれを正規化した名前で突き合わせる', () => {
  const base = graph([{ name: '(株)和田商会', amount: 100 }, { name: 'ＩＣＴ CONNECT 21', amount: 50 }]);
  const compare = graph([{ name: '株式会社和田商会', amount: 120 }, { name: 'ICT CONNECT21', amount: 40 }]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.increased.map(r => [r.name, r.diff]), [['株式会社和田商会', 20]]);
  assert.deepEqual(recipients.decreased.map(r => [r.name, r.diff]), [['ICT CONNECT21', -10]]);
  assert.deepEqual([...recipients.added, ...recipients.removed], []);
});

test('法人番号の無い支出先は、名称が変わると新規・消滅に分かれる', () => {
  const base = graph([{ name: '米空軍省', amount: 490 }]);
  const compare = graph([{ name: '米国(空軍省)', amount: 540 }]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.added.map(r => r.name), ['米国(空軍省)']);
  assert.deepEqual(recipients.removed.map(r => r.name), ['米空軍省']);
});

test('支出先名「その他」は個社として扱えないので差分に含めない', () => {
  const base = graph([{ name: 'その他', amount: 900 }, { name: 'A社', amount: 600 }]);
  const compare = graph([{ name: 'その他', amount: 100 }, { name: 'A社', amount: 700 }]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.increased.map(r => r.name), ['A社']);
  assert.deepEqual([...recipients.decreased, ...recipients.added, ...recipients.removed], []);
});

test('集計ノードは支出先の差分に含めない', () => {
  const base = graph([{ name: 'A社', amount: 600 }, { name: 'その他の支出先', amount: 100, aggregated: true }]);
  const compare = graph([{ name: 'A社', amount: 700 }, { name: 'その他の支出先', amount: 300, aggregated: true }]);
  const { recipients } = compareYearsSummary(base, compare).diff;

  assert.deepEqual(recipients.increased.map(r => r.name), ['A社']);
  assert.deepEqual([...recipients.decreased, ...recipients.added, ...recipients.removed], []);
});
