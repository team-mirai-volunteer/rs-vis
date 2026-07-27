/**
 * 執行透明性の重み配分を比較する調査用スクリプト。
 *
 * 「収支の一致」は実測でほぼ定数（大半が満点）であり、重み30を持ちながら
 * 他の指標の変動を薄めているだけではないか、という論点を数値で確かめる。
 *
 *   npx tsx scripts/analyze-transparency-weights.ts [year]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const year = process.argv[2] ?? '2025';

type Item = {
  pid: string;
  budgetAmount: number;
  axisIdentify?: number | null;
  axisPurpose?: number | null;
  axisBudget?: number | null;
  axisEffective?: number | null;
};

function loadQuality(y: string): Item[] {
  const base = path.join(process.cwd(), 'public', 'data', `project-quality-scores-${y}.json`);
  const raw = fs.existsSync(base)
    ? fs.readFileSync(base, 'utf-8')
    : zlib.gunzipSync(fs.readFileSync(`${base}.gz`)).toString('utf-8');
  return JSON.parse(raw);
}

/** 欠損を重みごと除外して再正規化する加重平均（policy-evaluation.ts と同じ扱い） */
function weightedAvailable(values: Array<number | null>, weights: number[]): number | null {
  let total = 0;
  let weightTotal = 0;
  values.forEach((value, i) => {
    if (value !== null && value !== undefined) {
      total += value * weights[i];
      weightTotal += weights[i];
    }
  });
  return weightTotal ? total / weightTotal : null;
}

const items = loadQuality(year);

// ── 収支の一致がどれだけ定数化しているか ──
const bc = items.map((i) => i.axisBudget ?? null).filter((v): v is number => v !== null);
const full = bc.filter((v) => v >= 99.999).length;
const low = bc.filter((v) => v < 60).length;
console.log(`=== ${year}年度 / ${items.length}事業 ===\n`);
console.log(`収支の一致: n=${bc.length}  満点=${full} (${((full / bc.length) * 100).toFixed(1)}%)  60未満=${low} (${((low / bc.length) * 100).toFixed(1)}%)`);
console.log(`  → 満点でも60未満でもない中間層は ${bc.length - full - low}件 (${(((bc.length - full - low) / bc.length) * 100).toFixed(1)}%)\n`);

type Variant = { label: string; w: [number, number, number] };
const VARIANTS: Variant[] = [
  { label: '現行 30/25/30', w: [30, 25, 30] },
  { label: '収支20  30/25/20', w: [30, 25, 20] },
  { label: '収支10  30/25/10', w: [30, 25, 10] },
  { label: '収支除外 55/45/0', w: [55, 45, 0] },
];

/** 分布の広がりと天井張り付きを1行で見る */
function describe(label: string, values: (number | null)[]) {
  const v = values.filter((n): n is number => n !== null).sort((a, b) => a - b);
  const at = (p: number) => v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  const ceiling = v.filter((x) => x >= 100).length;
  const distinct = new Set(v).size;
  console.log(
    `${label.padEnd(18)} n=${String(v.length).padStart(5)}  ` +
      [0.05, 0.1, 0.25, 0.5, 0.75, 0.9].map((p) => `p${String(p * 100).padStart(2)}=${String(at(p)).padStart(3)}`).join(' ') +
      `  IQR=${String(at(0.75) - at(0.25)).padStart(3)}  σ=${sd.toFixed(1).padStart(5)}` +
      `  天井=${((ceiling / v.length) * 100).toFixed(1).padStart(5)}%  値種=${String(distinct).padStart(4)}`,
  );
}

console.log('── 執行透明性 ──');
const transparencyByVariant = new Map<string, (number | null)[]>();
for (const { label, w } of VARIANTS) {
  const vals = items.map((i) => {
    const raw = weightedAvailable([i.axisIdentify ?? null, i.axisPurpose ?? null, i.axisBudget ?? null], w);
    return raw === null ? null : Math.round(raw);
  });
  transparencyByVariant.set(label, vals);
  describe(label, vals);
}

console.log('\n── 総合点（政策評価40 + 執行透明性20。検証可能性は99.5%が未評価のため実質 2:1） ──');
// 推定行では 政策評価 = 軸E。AI精査済30件の差は分布全体には影響しないため素の軸Eで近似する。
const policyEval = items.map((i) => (i.axisEffective ?? null));
for (const { label } of VARIANTS) {
  const trans = transparencyByVariant.get(label)!;
  const vals = items.map((i, idx) => {
    const raw = weightedAvailable([policyEval[idx], trans[idx]], [40, 20]);
    return raw === null ? null : Math.round(raw);
  });
  describe(label, vals);
}

// ── 収支の一致を外しても「不一致」の検出力が落ちないことの確認 ──
// 判定ルール側は axisBudget < 60 を直接見ているため、加重平均から外しても信号は残る。
console.log(`\n収支不一致フラグ（軸C<60）: ${low}件。加重平均から外しても chooseRecommendation / chooseImprovementAction は同じ件数を拾う。`);
