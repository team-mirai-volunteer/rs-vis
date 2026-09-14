/**
 * 統合グラフ（unified-budget-{予算年度}-{basis}-graph.json）の整合性検証。
 *
 * 使用法: tsx scripts/validate-unified-budget-graph.ts --budget-year 2024 [--basis initial|supplementary|settlement] [--max-unmatched-ratio 0.03]
 *
 * 検査:
 *   1. 全エッジの source/target がノードに存在し、列が左→右に並ぶ
 *   2. 中間列（所管・組織/勘定・項・目）は流入 = 流出（1円単位）
 *   3. 会計列は流出 = ノード値、目列も流出 = ノード値（残余は必ずどこかに落ちている）
 *   4. RS事業ノードは 流入 = ノード値（outside で釣り合わせている）
 *   5. 会計列合計 = MOF目（基準予算種別）の正の金額合計
 *   6. 未突合の比率が閾値以下（既定: 予算モード 3%・要求モード 6%。設計 5.2 の置き換え判定基準）
 * いずれか失敗で非0終了。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { MOFKouMokuData } from '@/types/mof-kou-moku';
import type { UnifiedGraph, UnifiedNode } from '@/types/unified-budget';
import { UNIFIED_COLUMNS, unifiedGraphFileName, type UnifiedBasis } from '@/types/unified-budget';

function argNum(name: string, def?: number): number | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  const v = Number(process.argv[i + 1]);
  return isNaN(v) ? def : v;
}
const BUDGET_YEAR = argNum('--budget-year');
if (!BUDGET_YEAR) {
  console.error('使用法: tsx scripts/validate-unified-budget-graph.ts --budget-year <予算年度>');
  process.exit(1);
}
/**
 * 未突合比率の閾値。予算モードは 3%（設計 5.2 の置き換え判定基準）。
 * 要求モード（rsAmountKind = 'request'）は、要求時点の項・目名が当初予算で改称・新設されて
 * 同名キーが無くなる分が構造的に乗るため 6% にする。
 */
const MAX_UNMATCHED_RATIO_ARG = argNum('--max-unmatched-ratio');
const DATA_DIR = path.join(__dirname, '../public/data');

function readJsonMaybeGz<T>(file: string): T {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  if (fs.existsSync(`${file}.gz`)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${file}.gz`)).toString('utf-8')) as T;
  throw new Error(`${file}(.gz) がありません`);
}

const basisArgIndex = process.argv.indexOf('--basis');
const BASIS_KEY = (basisArgIndex >= 0 ? process.argv[basisArgIndex + 1] : 'initial') as UnifiedBasis;
const graph = readJsonMaybeGz<UnifiedGraph>(path.join(DATA_DIR, unifiedGraphFileName(BUDGET_YEAR, BASIS_KEY)));
const kouMoku = readJsonMaybeGz<MOFKouMokuData>(path.join(DATA_DIR, `mof-kou-moku-${BUDGET_YEAR}.json`));

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`  ❌ ${msg}`);
};
const ok = (msg: string) => console.log(`  ✅ ${msg}`);

const nodeById = new Map<string, UnifiedNode>(graph.nodes.map(n => [n.id, n]));
const colIndex = (c: string) => UNIFIED_COLUMNS.indexOf(c as (typeof UNIFIED_COLUMNS)[number]);
const inflow = new Map<string, number>();
const outflow = new Map<string, number>();

console.log(`=== 統合グラフ検証 (予算年度${BUDGET_YEAR}) ===\n[1] エッジ参照と列順`);
let badRef = 0;
let badOrder = 0;
for (const e of graph.edges) {
  const s = nodeById.get(e.source);
  const t = nodeById.get(e.target);
  if (!s || !t) {
    badRef++;
    continue;
  }
  if (colIndex(s.col) >= colIndex(t.col)) badOrder++;
  outflow.set(e.source, (outflow.get(e.source) ?? 0) + e.value);
  inflow.set(e.target, (inflow.get(e.target) ?? 0) + e.value);
  if (e.value <= 0) fail(`非正のエッジ: ${e.source} → ${e.target} = ${e.value}`);
}
badRef ? fail(`存在しないノードを参照するエッジ ${badRef} 本`) : ok(`全 ${graph.edges.length.toLocaleString()} エッジがノードを参照`);
badOrder ? fail(`列順が左→右でないエッジ ${badOrder} 本`) : ok('全エッジが左→右');

console.log('\n[2] 中間列の流入 = 流出');
for (const col of ['ministry', 'organization', 'section', 'koumoku'] as const) {
  let bad = 0;
  let worst = 0;
  for (const n of graph.nodes) {
    if (n.col !== col || n.standalone) continue;
    const diff = Math.abs((inflow.get(n.id) ?? 0) - (outflow.get(n.id) ?? 0));
    if (diff > 0) {
      bad++;
      worst = Math.max(worst, diff);
    }
  }
  bad ? fail(`${col}: 流入≠流出のノード ${bad} 件（最大差 ${worst.toLocaleString()} 円）`) : ok(`${col}: 全ノードで流入 = 流出`);
}

console.log('\n[3] 会計・目・擬似ノードの流出 = ノード値');
for (const col of ['account', 'koumoku'] as const) {
  let bad = 0;
  for (const n of graph.nodes) {
    if (n.col !== col) continue;
    if ((outflow.get(n.id) ?? 0) !== n.value) bad++;
  }
  bad ? fail(`${col}: 流出≠ノード値 ${bad} 件`) : ok(`${col}: 流出 = ノード値`);
}

console.log('\n[4] RS事業ノードの流入 = ノード値');
{
  let bad = 0;
  let worst = 0;
  for (const n of graph.nodes) {
    if (n.col !== 'program' || n.kind !== 'rs') continue;
    const diff = Math.abs((inflow.get(n.id) ?? 0) - n.value);
    if (diff > 0) {
      bad++;
      worst = Math.max(worst, diff);
    }
  }
  bad ? fail(`RS事業: 流入≠ノード値 ${bad} 件（最大差 ${worst.toLocaleString()} 円）`) : ok('RS事業: 全ノードで流入 = ノード値');
}

console.log('\n[5] 会計列合計 = MOF目合計');
{
  const basis = graph.metadata.basisBudgetType;
  const mofTotal = kouMoku.items
    // 生成側と同じ流量（決算は支出済歳出額、それ以外は目金額）で合計する
    .map(it => ({ ...it, flow: graph.metadata.basis === 'settlement' ? it.spent ?? 0 : it.amount }))
    .filter(it => (it.accountType === 'general' || it.accountType === 'special') && it.budgetType === basis && it.flow > 0)
    .reduce((s, it) => s + it.flow, 0);
  const gross = graph.nodes.filter(n => n.col === 'account').reduce((s, n) => s + n.value, 0);
  gross === mofTotal
    ? ok(`会計列合計 ${(gross / 1e12).toFixed(2)} 兆円 = MOF目（${basis}・正の金額）合計`)
    : fail(`会計列合計 ${gross.toLocaleString()} ≠ MOF目合計 ${mofTotal.toLocaleString()}`);
  if (graph.metadata.totals.gross !== gross) fail('metadata.totals.gross がノード合計と不一致');
  if (graph.metadata.totals.net !== gross - graph.metadata.totals.transfer) fail('metadata.totals.net ≠ gross − transfer');
}

console.log('\n[6] 未突合比率');
{
  const { unmatched } = graph.metadata.totals.byKind;
  // 決算は執行額ベース（RS側の目別リンクは予算額）、補正は「…外N目」に束ねられた目に RS 対応が無いため、当初予算より緩い閾値にする
  const defaultRatio = graph.metadata.rsAmountKind === 'request' || graph.metadata.basis === 'settlement' ? 0.06 : graph.metadata.basis === 'supplementary' ? 0.3 : 0.03;
  const MAX_UNMATCHED_RATIO = MAX_UNMATCHED_RATIO_ARG ?? defaultRatio;
  const ratio = unmatched / Math.max(1, graph.metadata.totals.net);
  const msg = `未突合 ${(unmatched / 1e12).toFixed(2)} 兆円 / 純計 ${(graph.metadata.totals.net / 1e12).toFixed(2)} 兆円 = ${(ratio * 100).toFixed(2)}%（閾値 ${(MAX_UNMATCHED_RATIO * 100).toFixed(0)}%）`;
  ratio <= MAX_UNMATCHED_RATIO ? ok(msg) : fail(msg);
}

console.log(failures ? `\n❌ ${failures} 件の検査に失敗` : '\n✅ 全検査に合格');
process.exit(failures ? 1 : 0);
