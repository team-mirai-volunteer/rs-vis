import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sankeySvgNodeIdToUnified,
  sankeySvgSearchToUnified,
  sheetYearToBudgetYear,
  unifiedProjectNameFilterUrl,
  unifiedProjectUrl,
  unifiedRecipientNameFilterUrl,
} from '../app/lib/unified-budget/links';

test('シート年度は予算年度（執行年度）に写す', () => {
  assert.equal(sheetYearToBudgetYear(2025), 2024);
  assert.equal(sheetYearToBudgetYear('2024'), 2023);
});

test('事業・名前絞り込みのリンクは RSのみ プリセットで統合ビューを開く', () => {
  const u = new URL(unifiedProjectUrl(2826, 2025), 'http://x');
  assert.equal(u.pathname, '/budget-sankey');
  assert.equal(u.searchParams.get('year'), '2024');
  assert.equal(u.searchParams.get('cols'), 'mi,pr,ps,re');
  assert.equal(u.searchParams.get('sel'), 'project-budget-2826');
  assert.equal(u.searchParams.get('fr'), '1');
  assert.equal(new URL(unifiedProjectNameFilterUrl('基礎年金', 2025), 'http://x').searchParams.get('fpq'), '基礎年金');
  assert.equal(new URL(unifiedRecipientNameFilterUrl('年金受給者', 2025), 'http://x').searchParams.get('frq'), '年金受給者');
});

test('旧ノード ID の写像', () => {
  assert.equal(sankeySvgNodeIdToUnified('project-spending-12'), 'project-budget-12');
  assert.equal(sankeySvgNodeIdToUnified('project-budget-12'), 'project-budget-12');
  assert.equal(sankeySvgNodeIdToUnified('r-99'), 'r-99');
  assert.equal(sankeySvgNodeIdToUnified('ministry-厚生労働省'), 'min-rs-厚生労働省'); // 旧省庁は RS の府省庁 → 府省庁基準のノード
  assert.equal(sankeySvgNodeIdToUnified('total'), 'total-rs');
  assert.equal(sankeySvgNodeIdToUnified('__agg-project-budget'), null);
});

test('旧 /sankey-svg のクエリを統合ビューへ写す', () => {
  const q = new URLSearchParams(
    sankeySvgSearchToUnified('yr=2025&sel=project-spending-7&fr=1&tp=60&tr=80&tm=20&po=5&fm=厚生労働省&fm=総務省&ac=gs&fnp=年金&fnpr=1&fmb=100億&fxb=1兆&fso=60-80&fsd=3&fp=1&z=1.5&q=検索語')
  );
  assert.equal(q.get('year'), '2024');
  assert.equal(q.get('b'), 'ministry'); // 旧サンキー図と同じ RS府省庁の紐づけで開く
  assert.equal(q.get('sel'), 'project-budget-7');
  assert.equal(q.get('fr'), '1');
  assert.equal(q.get('tpr'), '60');
  assert.equal(q.get('tps'), '60');
  assert.equal(q.get('tre'), '80');
  assert.equal(q.get('tmi'), '20');
  assert.equal(q.get('opr'), '5');
  assert.deepEqual(q.getAll('fmi'), ['厚生労働省', '総務省']); // 府省庁基準の所管は RS の府省庁名なのでそのまま写る
  assert.deepEqual(q.getAll('fac'), ['general', 'special']);
  assert.equal(q.get('fpq'), '年金');
  assert.equal(q.get('fpr'), '1');
  assert.equal(q.get('fbmin'), '100億');
  assert.equal(q.get('fbmax'), '1兆');
  assert.equal(q.get('fso'), '60-80');
  assert.equal(q.get('fsub'), 'has');
  assert.equal(q.get('fsd'), '3');
  assert.equal(new URLSearchParams(sankeySvgSearchToUnified('fnr=NEDO&fnrs=1')).get('frs'), '1');
  assert.equal(q.get('ffp'), '1');
  assert.equal(q.get('z'), null);
  assert.equal(q.get('q'), null);
});

test('選択が無ければピンから補う。年度未指定はシート 2025（2024年度）', () => {
  const q = new URLSearchParams(sankeySvgSearchToUnified('pp=project-spending-3'));
  assert.equal(q.get('sel'), 'project-budget-3');
  assert.equal(q.get('year'), '2024');
  assert.equal(new URLSearchParams(sankeySvgSearchToUnified('pm=総務省')).get('sel'), 'min-rs-総務省');
  assert.equal(new URLSearchParams(sankeySvgSearchToUnified('sel=total')).get('sel'), 'total-rs');
});
