import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilter, unifiedFilterIssues } from '../app/lib/unified-budget/transform';
import { UNIFIED_FILTER_DEFAULT, type UnifiedViewFilter, type UnifiedViewGraph, type UnifiedViewNode } from '../types/unified-budget-view';

const node = (id: string, column: UnifiedViewNode['details']['column'], value: number, details: Partial<UnifiedViewNode['details']> = {}): UnifiedViewNode => ({
  id,
  name: id,
  value,
  type: column,
  details: { column, ...details },
});
const link = (source: string, target: string, value: number) => ({ source, target, value });

/**
 * 小さな統合グラフ。
 *   所管A → 項A → 目A → 事業1(100) → 事業1(支出)(80) → 支出先X(50), 支出先Y(30)
 *                     → 事業2(300) → 事業2(支出)(200) → 支出先Y(200)
 *   目A → 事業3(50)（支出なし）
 *   国債費（非事業）(1000) も目Aから
 */
function sample(): UnifiedViewGraph {
  const nodes = [
    node('ministry-A', 'ministry', 1450, { ministry: 'A' }),
    node('section-A', 'section', 1450, { ministry: 'A', accountType: 'general' }),
    node('koumoku-A', 'koumoku', 1450, { ministry: 'A', accountType: 'general' }),
    { ...node('project-budget-1', 'program', 100, { kind: 'rs', projectId: 1, subcontractDepth: 3, subcontractRecipients: ['再委託先Z'] }), name: '海洋研究' },
    { ...node('project-budget-2', 'program', 300, { kind: 'rs', projectId: 2 }), name: '道路整備' },
    { ...node('project-budget-3', 'program', 50, { kind: 'rs', projectId: 3, subcontractDepth: 2 }), name: '海岸保全' },
    node('np-debt', 'program', 1000, { kind: 'debt' }),
    node('project-spending-1', 'program-spending', 80, { kind: 'rs', projectId: 1 }),
    node('project-spending-2', 'program-spending', 200, { kind: 'rs', projectId: 2 }),
    { ...node('r-X', 'recipient', 50), name: '株式会社X' },
    { ...node('r-Y', 'recipient', 230), name: '一般財団法人Y' },
  ];
  const links = [
    link('ministry-A', 'section-A', 1450),
    link('section-A', 'koumoku-A', 1450),
    link('koumoku-A', 'project-budget-1', 100),
    link('koumoku-A', 'project-budget-2', 300),
    link('koumoku-A', 'project-budget-3', 50),
    link('koumoku-A', 'np-debt', 1000),
    link('project-budget-1', 'project-spending-1', 80),
    link('project-budget-2', 'project-spending-2', 200),
    link('project-spending-1', 'r-X', 50),
    link('project-spending-1', 'r-Y', 30),
    link('project-spending-2', 'r-Y', 200),
  ];
  return { nodes, links };
}

const f = (patch: Partial<UnifiedViewFilter>): UnifiedViewFilter => ({ ...UNIFIED_FILTER_DEFAULT, ...patch });
const ids = (g: UnifiedViewGraph) => g.nodes.map(n => n.id).sort();
const valueOf = (g: UnifiedViewGraph, id: string) => g.nodes.find(n => n.id === id)?.value;

test('既定の絞り込みではグラフを変えない', () => {
  const out = applyFilter(sample(), f({}));
  assert.deepEqual(ids(out), ids(sample()));
});

test('予算額の下限: 事業と事業(支出)の双子を落とし、支出先・上流の値を作り直す', () => {
  const out = applyFilter(sample(), f({ budgetMin: '200' }));
  assert.ok(!out.nodes.some(n => n.id === 'project-budget-1'));
  assert.ok(!out.nodes.some(n => n.id === 'project-spending-1'));
  assert.ok(!out.nodes.some(n => n.id === 'project-budget-3'));
  assert.ok(!out.nodes.some(n => n.id === 'r-X'), '事業1しか流さない支出先Xは消える');
  assert.equal(valueOf(out, 'r-Y'), 200, '支出先Yは事業2の分だけ残る');
  assert.ok(!out.links.some(l => l.target === 'project-budget-1' || l.target === 'project-budget-3'), '目→落ちた事業の辺も消える');
  assert.equal(valueOf(out, 'koumoku-A'), 1450, '目の値は max(流入, 流出) なので上流からの流入は保つ（既存の再計算規則）');
  assert.ok(out.nodes.some(n => n.id === 'np-debt'), '非事業ノードは予算額の絞り込みの対象外');
});

test('予算額は金額表記（億・兆）を解釈し、上限も効く', () => {
  const g = sample();
  g.nodes.find(n => n.id === 'project-budget-2')!.value = 3e10; // 300億
  g.links.find(l => l.target === 'project-budget-2')!.value = 3e10;
  const out = applyFilter(g, f({ budgetMax: '1億' }));
  assert.ok(!out.nodes.some(n => n.id === 'project-budget-2'));
  assert.ok(out.nodes.some(n => n.id === 'project-budget-1'));
});

test('支出額の範囲は事業(支出)の値で判定し、支出の無い事業は下限指定で落ちる', () => {
  const out = applyFilter(sample(), f({ spendingMin: '100' }));
  assert.deepEqual(
    out.nodes.filter(n => n.details.column === 'program' && n.details.kind === 'rs').map(n => n.id),
    ['project-budget-2']
  );
  const onlyMax = applyFilter(sample(), f({ spendingMax: '100' }));
  assert.ok(onlyMax.nodes.some(n => n.id === 'project-budget-3'), '上限のみなら支出の無い事業（0）は残る');
  assert.ok(!onlyMax.nodes.some(n => n.id === 'project-budget-2'));
});

test('事業名: 部分一致は RS事業だけが対象で、大文字小文字を区別しない', () => {
  const out = applyFilter(sample(), f({ projectQuery: '海' }));
  assert.deepEqual(
    out.nodes.filter(n => n.details.column === 'program').map(n => n.id).sort(),
    ['np-debt', 'project-budget-1', 'project-budget-3']
  );
});

test('事業名: 正規表現', () => {
  const out = applyFilter(sample(), f({ projectQuery: '^道路|保全$', projectRegex: true }));
  assert.deepEqual(
    out.nodes.filter(n => n.details.kind === 'rs' && n.details.column === 'program').map(n => n.id).sort(),
    ['project-budget-2', 'project-budget-3']
  );
});

test('事業名: 不正な正規表現は何も一致せず、issues で検出できる', () => {
  const filter = f({ projectQuery: '(', projectRegex: true });
  const out = applyFilter(sample(), filter);
  assert.equal(out.nodes.filter(n => n.details.kind === 'rs').length, 0);
  assert.deepEqual(unifiedFilterIssues(filter), { projectRegexInvalid: true, recipientRegexInvalid: false });
  assert.deepEqual(unifiedFilterIssues(f({ projectQuery: '(', projectRegex: false })), { projectRegexInvalid: false, recipientRegexInvalid: false });
});

test('支出先名: 一致しない支出先を落とし、支出先が残らなかった事業も落とす', () => {
  const out = applyFilter(sample(), f({ recipientQuery: '株式会社' }));
  assert.deepEqual(ids(out).filter(id => id.startsWith('r-')), ['r-X']);
  assert.ok(out.nodes.some(n => n.id === 'project-budget-1'), '事業1は支出先Xへ流すので残る');
  assert.ok(!out.nodes.some(n => n.id === 'project-budget-2'), '事業2は支出先Yしか無いので落ちる');
  assert.ok(!out.nodes.some(n => n.id === 'project-spending-2'));
  assert.equal(valueOf(out, 'project-spending-1'), 80, '事業(支出)の値は流入（事業→事業(支出)）で保つ');
  assert.ok(out.nodes.some(n => n.id === 'project-budget-3'), '支出の記載が無い事業は /sankey-svg と同じく残す');
});

test('支出先名: 支出先の列が無い年度では何もしない', () => {
  const g = sample();
  const noSpending: UnifiedViewGraph = {
    nodes: g.nodes.filter(n => n.details.column !== 'recipient' && n.details.column !== 'program-spending'),
    links: g.links.filter(l => !l.source.startsWith('project-spending') && !l.target.startsWith('project-spending')),
  };
  const out = applyFilter(noSpending, f({ recipientQuery: '存在しない' }));
  assert.deepEqual(ids(out), ids(noSpending));
});

test('支出先名（再委託先を含む）: 事業単位の OR 判定で、支出先ノードは隠さない', () => {
  const out = applyFilter(sample(), f({ recipientQuery: 'Z', recipientIncludeSub: true }));
  assert.ok(out.nodes.some(n => n.id === 'project-budget-1'), '再委託先Zを持つ事業1は残る');
  assert.ok(!out.nodes.some(n => n.id === 'project-budget-2'));
  assert.deepEqual(ids(out).filter(id => id.startsWith('r-')), ['r-X', 'r-Y'], '事業1の直接支出先は名前に関係なく残る');
  const direct = applyFilter(sample(), f({ recipientQuery: '株式会社', recipientIncludeSub: true }));
  assert.ok(direct.nodes.some(n => n.id === 'project-budget-1'));
  assert.ok(!direct.nodes.some(n => n.id === 'project-budget-2'));
});

test('再委託: has は階層の下限で、none は記載なしだけを残す', () => {
  const rs = (g: UnifiedViewGraph) => g.nodes.filter(n => n.details.kind === 'rs' && n.details.column === 'program').map(n => n.id).sort();
  assert.deepEqual(rs(applyFilter(sample(), f({ subcontract: 'has' }))), ['project-budget-1', 'project-budget-3']);
  assert.deepEqual(rs(applyFilter(sample(), f({ subcontract: 'has', subcontractMinDepth: 3 }))), ['project-budget-1']);
  assert.deepEqual(rs(applyFilter(sample(), f({ subcontract: 'none' }))), ['project-budget-2']);
  const out = applyFilter(sample(), f({ subcontract: 'none' }));
  assert.ok(!out.nodes.some(n => n.id === 'project-spending-1'), '双子の事業(支出)も落ちる');
  assert.ok(!out.nodes.some(n => n.id === 'r-X'));
});

test('政策評価スコア: ctx.policy があるときだけ効き、評価の無い事業は落とす', () => {
  const filter = f({ scoreO: { min: '60', max: '' } });
  const noCtx = applyFilter(sample(), filter);
  assert.deepEqual(ids(noCtx), ids(sample()), '未取得なら効かない');
  const policy = { '1': { o: 80, x: 50, n: 70 }, '2': { o: 40, x: 90, n: 10 } };
  const out = applyFilter(sample(), filter, { policy });
  const rs = out.nodes.filter(n => n.details.kind === 'rs' && n.details.column === 'program').map(n => n.id);
  assert.deepEqual(rs, ['project-budget-1'], '事業2は 40 点で落ち、事業3は評価が無いので落ちる');
  const both = applyFilter(sample(), f({ scoreX: { min: '', max: '60' }, scoreN: { min: '50', max: '100' } }), { policy });
  assert.deepEqual(both.nodes.filter(n => n.details.kind === 'rs' && n.details.column === 'program').map(n => n.id), ['project-budget-1']);
});

test('複数の絞り込みは AND で重なる', () => {
  const out = applyFilter(sample(), f({ projectQuery: '海', subcontract: 'has', subcontractMinDepth: 3 }));
  assert.deepEqual(out.nodes.filter(n => n.details.kind === 'rs' && n.details.column === 'program').map(n => n.id), ['project-budget-1']);
});
