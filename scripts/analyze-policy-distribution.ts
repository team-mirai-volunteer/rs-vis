/**
 * 政策評価スクリーニングの分布を確認する調査用スクリプト。
 * 閾値の再調整時に、どの指標がどこに集中しているかを見るために使う。
 *
 *   npx tsx scripts/analyze-policy-distribution.ts [year]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import {
  buildPolicyEvaluations,
  POLICY_CATEGORY_LABELS,
  type PolicyEvaluation,
  type PolicyQualityInput,
} from '../app/lib/policy-evaluation';

const year = process.argv[2] ?? '2025';

function loadQuality(y: string): PolicyQualityInput[] | null {
  const base = path.join(process.cwd(), 'public', 'data', `project-quality-scores-${y}.json`);
  if (fs.existsSync(base)) return JSON.parse(fs.readFileSync(base, 'utf-8'));
  if (fs.existsSync(`${base}.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${base}.gz`)).toString('utf-8'));
  }
  return null;
}

/** 前年度の執行率 pid→rate（/api/execution-history と同じ導出） */
function loadPriorExecutionRates(y: string): Map<string, number> {
  const prior = loadQuality(String(Number(y) - 1));
  const map = new Map<string, number>();
  if (!prior) return map;
  for (const row of prior) {
    if (!(row.budgetAmount > 0 && row.execAmount > 0)) continue;
    map.set(row.pid, Math.round((row.execAmount / row.budgetAmount) * 1000) / 1000);
  }
  return map;
}

const base = loadQuality(year);
if (!base) throw new Error(`project-quality-scores-${year}.json(.gz) が見つかりません`);
const priorRates = loadPriorExecutionRates(year);
const items: PolicyQualityInput[] = base.map((i) => ({
  ...i,
  priorExecutionRate: priorRates.get(i.pid) ?? null,
}));
// AI が付けた0-10の生値。弁別力（σ・最大集中）がここで潰れていないかを最初に見る
percentilesRaw('AI成果設計', base.map((i) => i.designClarity ?? null));
percentilesRaw('AI検証可能性', base.map((i) => i.evidenceReadiness ?? null));
percentilesRaw('AI費用対内容', base.map((i) => i.budgetProportionality ?? null));
percentilesRaw('AI必要性', base.map((i) => i.necessity ?? null));
const rows = buildPolicyEvaluations(items);
const budgetByPid = new Map(items.map((i) => [i.pid, i.budgetAmount]));

function percentilesRaw(label: string, values: (number | null)[]) {
  const v = values.filter((n): n is number => n !== null).sort((a, b) => a - b);
  if (!v.length) { console.log(`${label} なし`); return; }
  const m: Record<number, number> = {};
  v.forEach((x) => { m[x] = (m[x] ?? 0) + 1; });
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s2, x) => s2 + (x - mean) ** 2, 0) / v.length);
  const top = Math.max(...Object.values(m));
  console.log(`${label.padEnd(12)} n=${String(v.length).padStart(5)} 値種=${String(new Set(v).size).padStart(2)}/11 σ=${sd.toFixed(2)} 最大集中=${(top / v.length * 100).toFixed(1)}%`);
}

/** 分位点に加え、弁別力の指標（IQR・標準偏差・天井張り付き率・値の種類数）も出す */
function percentiles(label: string, values: (number | null)[]) {
  const v = values.filter((n): n is number => n !== null).sort((a, b) => a - b);
  if (v.length === 0) {
    console.log(`${label.padEnd(12)} n=    0  （該当データなし）`);
    return;
  }
  const at = (p: number) => v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  const ceiling = v.filter((x) => x >= 100).length;
  console.log(
    `${label.padEnd(12)} n=${String(v.length).padStart(5)}  ` +
      [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]
        .map((p) => `p${String(p * 100).padStart(2)}=${String(at(p)).padStart(3)}`)
        .join('  ') +
      `  IQR=${String(at(0.75) - at(0.25)).padStart(3)} σ=${sd.toFixed(1).padStart(5)}` +
      ` 天井=${((ceiling / v.length) * 100).toFixed(1).padStart(5)}% 値種=${String(new Set(v).size).padStart(4)}`,
  );
}

function tally(label: string, keys: (string | null)[]) {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k ?? '(なし)', (counts.get(k ?? '(なし)') ?? 0) + 1);
  console.log(`\n${label}`);
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`  ${k.padEnd(16)} ${String(n).padStart(5)}  ${((n / keys.length) * 100).toFixed(1)}%`));
}

const scored = rows.filter((r) => r.designClarity !== null).length;
console.log(`=== ${year}年度 / ${rows.length}事業 (AI採点済 ${scored}) ===\n`);
percentiles('総合点', rows.map((r) => r.overallScore));
percentiles('成果設計', rows.map((r) => r.designClarityScore));
percentiles('検証可能性', rows.map((r) => r.evidenceScore));
percentiles('執行透明性', rows.map((r) => r.executionTransparency));
percentiles('費用対内容', rows.map((r) => r.proportionalityScore));
percentiles('必要性', rows.map((r) => r.necessityScore));
percentiles('特定可能性', rows.map((r) => r.identifiability));
percentiles('収支整合性', rows.map((r) => r.budgetConsistency));

tally('政策類型', rows.map((r) => r.policyCategoryLabel));

tally('推奨判断', rows.map((r) => r.recommendation));
tally('改善アクション', rows.map((r) => r.improvementAction));

// ── 複数年の不用トレンド ──
console.log(`\n=== 不用の傾向（前年度 ${priorRates.size}事業ぶんの執行実績と突合） ===`);
const TREND_LABEL: Record<string, string> = {
  persistent: '2年連続で不用大',
  single: '当年度のみ不用大',
  unknown: '当年度不用大・前年度なし',
  normal: '不用は上位帯未満',
};
const trendCounts = new Map<string, { n: number; unused: number; budget: number }>();
for (const r of rows) {
  const k = r.unusedTrend;
  const cur = trendCounts.get(k) ?? { n: 0, unused: 0, budget: 0 };
  cur.n += 1;
  cur.unused += r.unusedAmount ?? 0;
  cur.budget += budgetByPid.get(r.pid) ?? 0;
  trendCounts.set(k, cur);
}
for (const [k, v] of [...trendCounts.entries()].sort((a, b) => b[1].unused - a[1].unused)) {
  console.log(
    `  ${(TREND_LABEL[k] ?? k).padEnd(24)} ${String(v.n).padStart(5)}件  ` +
      `不用額 ${(v.unused / 1e12).toFixed(2).padStart(6)}兆  予算 ${(v.budget / 1e12).toFixed(2).padStart(6)}兆`,
  );
}
const withPrior = rows.filter((r) => r.priorExecutionRate !== null).length;
console.log(`  前年度実績あり: ${withPrior} / ${rows.length}（判定不能 ${rows.length - withPrior}）`);
percentiles('前年不用率%', rows.map((r) => (r.priorUnusedRatio === null ? null : Math.round(r.priorUnusedRatio * 100))));

// 金額加重で見た場合の推奨判断（件数より予算インパクトが重要）
const totalBudget = items.reduce((s, i) => s + i.budgetAmount, 0);
const byRecBudget = new Map<string, number>();
for (const r of rows) {
  const k = r.recommendation ?? '(なし)';
  byRecBudget.set(k, (byRecBudget.get(k) ?? 0) + (budgetByPid.get(r.pid) ?? 0));
}
console.log('\n推奨判断（予算金額シェア）');
[...byRecBudget.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${(v / 1e12).toFixed(1).padStart(7)}兆  ${((v / totalBudget) * 100).toFixed(1)}%`));

// 費用対内容と必要性がどちらも低い層＝「そもそも要るのか」が崩れている候補。
// この層が「継続」に落ちているなら、スクリーニングが拾えていない。
const lowBoth = rows.filter(
  (r) => (r.proportionalityScore ?? 100) <= 40 && (r.necessityScore ?? 100) <= 40,
);
console.log(`\n費用対内容<=40 かつ 必要性<=40: ${lowBoth.length}件`);
const rec = new Map<string, number>();
for (const r of lowBoth) rec.set(r.recommendation ?? '(なし)', (rec.get(r.recommendation ?? '(なし)') ?? 0) + 1);
[...rec.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  → 現在の推奨: ${k.padEnd(16)} ${n}`));

const big = (r: PolicyEvaluation) => (budgetByPid.get(r.pid) ?? 0) >= 1e10; // 100億以上
console.log(`\nうち予算100億以上: ${lowBoth.filter(big).length}件`);

// ── 予算規模の評価に使える素材の分布 ──
type Raw = {
  pid: string; name?: string; budgetAmount: number; execAmount: number;
  spendNetTotal: number; gapRatio: number | null;
};
const raws = items as unknown as Raw[];
const withBudget = raws.filter((i) => i.budgetAmount > 0);
console.log(`\n=== 予算規模の評価素材 ===`);
console.log(`予算額>0: ${withBudget.length} / ${raws.length}（予算額0または未設定: ${raws.length - withBudget.length}）`);
console.log(`執行額>0: ${raws.filter((i) => i.execAmount > 0).length}`);

const unusedRatio = (i: Raw) => Math.max(0, Math.min(1, (i.budgetAmount - i.execAmount) / i.budgetAmount));
percentiles('不用率%', withBudget.map((i) => Math.round(unusedRatio(i) * 100)));
percentiles('執行率%', withBudget.map((i) => Math.round((i.execAmount / i.budgetAmount) * 100)));

const totalUnused = withBudget.reduce((s, i) => s + Math.max(0, i.budgetAmount - i.execAmount), 0);
const totalBudgetAll = withBudget.reduce((s, i) => s + i.budgetAmount, 0);
console.log(`不用額 合計: ${(totalUnused / 1e12).toFixed(1)}兆 / 予算 ${(totalBudgetAll / 1e12).toFixed(1)}兆 = ${((totalUnused / totalBudgetAll) * 100).toFixed(1)}%`);

for (const th of [0.1, 0.2, 0.3, 0.5]) {
  const hit = withBudget.filter((i) => unusedRatio(i) >= th);
  const amt = hit.reduce((s, i) => s + (i.budgetAmount - i.execAmount), 0);
  console.log(`  不用率>=${(th * 100).toFixed(0)}%: ${String(hit.length).padStart(5)}件  不用額計 ${(amt / 1e12).toFixed(2)}兆`);
}

// 縮小候補として意味のある層: 不用率が高く、かつ総合点が下位帯
const pctByPid = new Map(rows.map((r) => [r.pid, r.overallPercentile ?? 100]));
for (const [uth, pth] of [[0.2, 10], [0.2, 25], [0.3, 25]] as const) {
  const hit = withBudget.filter((i) => unusedRatio(i) >= uth && (pctByPid.get(i.pid) ?? 100) <= pth);
  const amt = hit.reduce((s, i) => s + (i.budgetAmount - i.execAmount), 0);
  console.log(`不用率>=${uth * 100}% かつ 総合点下位${pth}%: ${hit.length}件  不用額計 ${(amt / 1e12).toFixed(2)}兆`);
}

// ── 軸間の相関（ハロー効果の測定） ──
// 独立に採らせている軸が実は同じものを測っているなら、重みを分ける意味が無い。
function spearman(xs: (number | null)[], ys: (number | null)[]): number | null {
  const pairs = xs.map((x, i) => [x, ys[i]] as const).filter((p): p is readonly [number, number] =>
    p[0] !== null && p[1] !== null);
  if (pairs.length < 3) return null;
  const rank = (vals: number[]) => {
    const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(vals.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(pairs.map((p) => p[0]));
  const ry = rank(pairs.map((p) => p[1]));
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

const AXES = [
  ['成果設計', (r: PolicyEvaluation) => r.designClarityScore],
  ['検証可能性', (r: PolicyEvaluation) => r.evidenceScore],
  ['執行透明性', (r: PolicyEvaluation) => r.executionTransparency],
  ['費用対内容', (r: PolicyEvaluation) => r.proportionalityScore],
  ['必要性', (r: PolicyEvaluation) => r.necessityScore],
] as const;
console.log('\n=== 軸間の順位相関（高すぎる組は同じものを測っている疑い） ===');
for (let a = 0; a < AXES.length; a += 1) {
  for (let b = a + 1; b < AXES.length; b += 1) {
    const rho = spearman(rows.map(AXES[a][1]), rows.map(AXES[b][1]));
    console.log(`  ${AXES[a][0]} × ${AXES[b][0]}`.padEnd(28) + (rho === null ? 'n/a' : rho.toFixed(3)));
  }
}

// 類型ごとの総合点（特定の類型だけ構造的に高く/低く出ていないか）
const byCat = new Map<string, number[]>();
for (const r of rows) {
  if (r.overallScore === null) continue;
  const k = r.policyCategoryLabel ?? '(未分類)';
  (byCat.get(k) ?? byCat.set(k, []).get(k)!).push(r.overallScore);
}
console.log(`\n=== 政策類型ごとの総合点（全${Object.keys(POLICY_CATEGORY_LABELS).length}類型中、該当ありのみ） ===`);
[...byCat.entries()]
  .map(([k, v]) => [k, v.length, v.reduce((a, b) => a + b, 0) / v.length] as const)
  .sort((x, y) => x[2] - y[2])
  .forEach(([k, n, avg]) => console.log(`  ${k.padEnd(22)} ${String(n).padStart(5)}件  平均 ${avg.toFixed(1)}`));
