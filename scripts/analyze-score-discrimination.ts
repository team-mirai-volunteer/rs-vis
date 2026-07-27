#!/usr/bin/env tsx
//
// AI評価スコアの「弁別力」を測る。
//
//   npx tsx scripts/analyze-score-discrimination.ts tests/benchmark-results/*.json
//   npx tsx scripts/analyze-score-discrimination.ts a.json b.json --axis designClarity
//   npx tsx scripts/analyze-score-discrimination.ts a.json --exclude-pids 1835,4448 --json
//
// 軸E（有効性／成果設計の明確さ）は 2025年度実測で Lv5-8 に85.7%が集中し、両端がほぼ使われない。
// 本スクリプトはその「中央回帰」を数値化し、ルーブリック方式の間で比較できるようにする。
//
// 入力は次の2形式を自動判別する:
//   1) { model, projects: [...] }                 … score-project-quality-ai.py --benchmark の出力
//   2) { runs: [{ model, results: [...] }, ...] }  … 旧・方式比較スクリプトの出力（記録として残る結果ファイル用）
//   3) { runId, results: [...] }                   … 単一ラン形式

import { readFileSync } from 'fs';
import { basename, resolve } from 'path';

type ResultRow = {
  pid: string | number;
  designClarity?: number;
  evidenceReadiness?: number | null;
  effective?: number;
  effectiveLevel?: number;
  axisEffective?: number;
  rank?: number;
};

type Scale = { min: number; max: number };

type Series = {
  label: string;
  file: string;
  model: string | null;
  rubric: string | null;
  scale: Scale;
  scores: Map<string, number>;
};

// ── 引数 ──────────────────────────────────────────────────────────────

function readOption(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0) return process.argv[index + 1];
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return inline?.slice(flag.length + 1);
}

const axis = readOption('axis') ?? 'designClarity';
const asJson = process.argv.includes('--json');
const excludePids = new Set(
  (readOption('exclude-pids') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const scaleOverride = (() => {
  const raw = readOption('scale');
  if (!raw) return null;
  const [min, max] = raw.split('-').map(Number);
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('--scale は min-max 形式で指定してください。');
  return { min, max } satisfies Scale;
})();

const optionFlags = new Set(['--axis', '--exclude-pids', '--scale']);
const files = process.argv.slice(2).filter((arg, index, args) => {
  if (arg.startsWith('--')) return false;
  const previous = args[index - 1];
  if (previous && optionFlags.has(previous)) return false;
  return true;
});

if (files.length === 0) {
  console.error('使い方: npx tsx scripts/analyze-score-discrimination.ts <結果JSON> [<結果JSON> ...] [--axis designClarity] [--exclude-pids 1,2] [--scale 0-10] [--json]');
  process.exit(1);
}

// ── 読み込み ──────────────────────────────────────────────────────────

/** ファイル側のメタから尺度を推定する。取れなければ観測値から整数尺度を組む */
function inferScale(fileScale: Scale | undefined, values: number[]): Scale {
  if (scaleOverride) return scaleOverride;
  if (fileScale && Number.isFinite(fileScale.min) && Number.isFinite(fileScale.max)) return fileScale;
  const max = Math.max(...values);
  // 0-4 と 0-10 の判別。4以下しか観測されない0-10尺度は誤判定しうるので --scale で明示できる。
  return { min: 0, max: max > 4 ? 10 : 4 };
}

function pickScore(row: ResultRow): number | null {
  const raw =
    axis === 'designClarity'
      ? (row.designClarity ?? row.effective ?? row.effectiveLevel)
      : axis === 'evidenceReadiness'
        ? row.evidenceReadiness
        : (row as unknown as Record<string, unknown>)[axis];
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function loadSeries(path: string): Series[] {
  const absolute = resolve(path);
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
  // public/data/project-quality-scores-YYYY.json のような素の配列も、全件の対照として読める
  const payload = (Array.isArray(parsed) ? { results: parsed } : parsed) as {
    runs?: Array<{ model?: string; results?: ResultRow[] }>;
    projects?: ResultRow[];
    results?: ResultRow[];
    runId?: string;
    rubric?: string;
    rubricVersion?: string;
    scoreScale?: Scale;
    evidenceScale?: Scale;
  };
  const fileLabel = basename(absolute).replace(/\.json$/, '');
  // 単一ラン形式は rubricVersion にオブジェクトが入ることがあるため文字列だけ採用する
  const rubric = [payload.rubric, payload.rubricVersion].find(
    (value): value is string => typeof value === 'string',
  ) ?? null;
  const fileScale = axis === 'evidenceReadiness' ? payload.evidenceScale : payload.scoreScale;

  const raw: Array<{ model: string | null; results: ResultRow[] }> = payload.projects
    ? [{ model: (payload as { model?: string }).model ?? null, results: payload.projects }]
    : payload.runs
      ? payload.runs.map((run) => ({ model: run.model ?? null, results: run.results ?? [] }))
      : [{ model: payload.runId ?? null, results: payload.results ?? [] }];

  return raw
    .map(({ model, results }) => {
      const scores = new Map<string, number>();
      for (const row of results) {
        const pid = String(row.pid);
        if (excludePids.has(pid)) continue;
        const score = pickScore(row);
        if (score === null) continue;
        scores.set(pid, score);
      }
      return {
        label: model ? `${fileLabel} :: ${model}` : fileLabel,
        file: fileLabel,
        model,
        rubric,
        scale: inferScale(fileScale, [...scores.values()]),
        scores,
      };
    })
    .filter((series) => series.scores.size > 0);
}

const seriesList = files.flatMap(loadSeries);
if (seriesList.length === 0) throw new Error(`軸 ${axis} のスコアが1件も読み取れませんでした。`);

// ── 弁別力の指標 ──────────────────────────────────────────────────────

/** 尺度の整数段階（0-10なら11段階） */
function levelsOf(scale: Scale) {
  const levels: number[] = [];
  for (let value = Math.round(scale.min); value <= Math.round(scale.max); value += 1) levels.push(value);
  return levels;
}

/** 連続量（順位由来スコア等）も段階指標に載せるため、最近傍の整数段階へ丸める */
function toLevel(value: number, scale: Scale) {
  return Math.min(Math.round(scale.max), Math.max(Math.round(scale.min), Math.round(value)));
}

function stdev(values: number[]) {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

/** 同点率: 無作為に選んだ2事業のスコアが一致する確率 */
function tieRate(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const n = values.length;
  if (n < 2) return 0;
  let pairs = 0;
  for (const count of counts.values()) pairs += count * (count - 1);
  return pairs / (n * (n - 1));
}

/** 正規化エントロピー: 全段階が均等に使われていれば1、1段階に集中すれば0 */
function normalizedEntropy(levelCounts: Map<number, number>, levelCount: number, n: number) {
  if (n === 0 || levelCount <= 1) return 0;
  let entropy = 0;
  for (const count of levelCounts.values()) {
    if (count === 0) continue;
    const p = count / n;
    entropy -= p * Math.log(p);
  }
  return entropy / Math.log(levelCount);
}

/** 連続する width 段階で覆える最大シェア */
function maxBandShare(levelCounts: Map<number, number>, levels: number[], n: number, width: number) {
  let best = 0;
  let bestStart = levels[0];
  for (let index = 0; index + width <= levels.length; index += 1) {
    let sum = 0;
    for (let offset = 0; offset < width; offset += 1) sum += levelCounts.get(levels[index + offset]) ?? 0;
    if (sum > best) {
      best = sum;
      bestStart = levels[index];
    }
  }
  return { share: n === 0 ? 0 : best / n, from: bestStart, to: bestStart + width - 1 };
}

/** 全体の targetShare を覆うのに必要な連続段階数（少ないほど中央に潰れている） */
function minWidthCovering(levelCounts: Map<number, number>, levels: number[], n: number, targetShare: number) {
  for (let width = 1; width <= levels.length; width += 1) {
    if (maxBandShare(levelCounts, levels, n, width).share >= targetShare) return width;
  }
  return levels.length;
}

function averageRanks(values: number[]) {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let position = 0;
  while (position < indexed.length) {
    let end = position;
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[position].value) end += 1;
    const rank = (position + end) / 2 + 1;
    for (let index = position; index <= end; index += 1) ranks[indexed[index].index] = rank;
    position = end + 1;
  }
  return ranks;
}

function pearson(a: number[], b: number[]) {
  const statsA = stdev(a);
  const statsB = stdev(b);
  if (statsA.sd === 0 || statsB.sd === 0) return NaN;
  let covariance = 0;
  for (let index = 0; index < a.length; index += 1) {
    covariance += (a[index] - statsA.mean) * (b[index] - statsB.mean);
  }
  covariance /= a.length;
  return covariance / (statsA.sd * statsB.sd);
}

/** 同点補正つき Spearman（平均順位の Pearson） */
function spearman(a: number[], b: number[]) {
  return pearson(averageRanks(a), averageRanks(b));
}

/** Kendall tau-b（同点補正つき） */
function kendallTauB(a: number[], b: number[]) {
  let concordant = 0;
  let discordant = 0;
  let tiedA = 0;
  let tiedB = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 1; j < a.length; j += 1) {
      const da = Math.sign(a[i] - a[j]);
      const db = Math.sign(b[i] - b[j]);
      if (da === 0 && db === 0) continue;
      if (da === 0) tiedA += 1;
      else if (db === 0) tiedB += 1;
      else if (da === db) concordant += 1;
      else discordant += 1;
    }
  }
  const n0 = (a.length * (a.length - 1)) / 2;
  const denominator = Math.sqrt((n0 - tiedA) * (n0 - tiedB));
  return denominator === 0 ? NaN : (concordant - discordant) / denominator;
}

type SeriesMetrics = ReturnType<typeof analyze>;

function analyze(series: Series) {
  const values = [...series.scores.values()];
  const levels = levelsOf(series.scale);
  const levelCounts = new Map<number, number>(levels.map((level) => [level, 0]));
  for (const value of values) {
    const level = toLevel(value, series.scale);
    levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
  }
  const n = values.length;
  const { mean, sd } = stdev(values);
  const span = series.scale.max - series.scale.min;
  const usedLevels = [...levelCounts.values()].filter((count) => count > 0).length;
  const band3 = maxBandShare(levelCounts, levels, n, 3);
  const edgeLow = ((levelCounts.get(levels[0]) ?? 0) + (levelCounts.get(levels[1]) ?? 0)) / n;
  const edgeHigh =
    ((levelCounts.get(levels[levels.length - 1]) ?? 0) +
      (levelCounts.get(levels[levels.length - 2]) ?? 0)) /
    n;

  return {
    label: series.label,
    file: series.file,
    model: series.model,
    rubric: series.rubric,
    scale: series.scale,
    n,
    distinctValues: new Set(values).size,
    usedLevels,
    totalLevels: levels.length,
    mean,
    sd,
    normalizedSd: span === 0 ? 0 : sd / span,
    min: Math.min(...values),
    max: Math.max(...values),
    range: Math.max(...values) - Math.min(...values),
    tieRate: tieRate(values),
    normalizedEntropy: normalizedEntropy(levelCounts, levels.length, n),
    band3,
    width80: minWidthCovering(levelCounts, levels, n, 0.8),
    edgeLowShare: edgeLow,
    edgeHighShare: edgeHigh,
    levelCounts,
    levels,
  };
}

const metrics = seriesList.map(analyze);

// ── 出力 ──────────────────────────────────────────────────────────────

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const fixed = (value: number, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a');

function printDistribution(item: SeriesMetrics) {
  console.log(`\n■ ${item.label}${item.rubric ? `  [${item.rubric}]` : ''}`);
  console.log(
    `  n=${item.n} / 尺度 ${item.scale.min}-${item.scale.max}（${item.totalLevels}段階） / ` +
      `使用段階=${item.usedLevels} / 相異値=${item.distinctValues}`,
  );
  console.log('  分布:');
  for (const level of item.levels) {
    const count = item.levelCounts.get(level) ?? 0;
    const share = item.n === 0 ? 0 : count / item.n;
    const bar = '█'.repeat(Math.round(share * 40));
    console.log(
      `    ${String(level).padStart(2)} | ${String(count).padStart(4)} ${percent(share).padStart(6)} ${bar}`,
    );
  }
  console.log(
    `  平均=${fixed(item.mean)} 標準偏差=${fixed(item.sd)}（正規化 ${fixed(item.normalizedSd, 3)}） ` +
      `レンジ=${fixed(item.min, 1)}〜${fixed(item.max, 1)}（幅${fixed(item.range, 1)}）`,
  );
  console.log(
    `  中央帯: 最も密な連続3段階=${item.band3.from}〜${item.band3.to} に ${percent(item.band3.share)} / ` +
      `全体の80%を覆う最小連続段階数=${item.width80}/${item.totalLevels}`,
  );
  console.log(
    `  両端の使用: 下位2段階=${percent(item.edgeLowShare)} 上位2段階=${percent(item.edgeHighShare)}`,
  );
  console.log(
    `  同点率=${percent(item.tieRate)} / 正規化エントロピー=${fixed(item.normalizedEntropy, 3)}`,
  );
}

function printSummary() {
  console.log('\n=== 弁別力サマリ（同点率が低く、正規化SD・エントロピーが高いほど弁別力が高い） ===');
  const header = [
    'file'.padEnd(22),
    'model'.padEnd(30),
    '  n',
    '使用/段階',
    '  同点率',
    ' 正規化SD',
    ' エントロピー',
    ' 3段階集中',
    ' 80%幅',
  ].join('');
  console.log(header);
  for (const item of [...metrics].sort((a, b) => a.tieRate - b.tieRate)) {
    console.log(
      [
        item.file.slice(0, 21).padEnd(22),
        (item.model ?? '-').slice(0, 29).padEnd(30),
        String(item.n).padStart(3),
        `${item.usedLevels}/${item.totalLevels}`.padStart(9),
        percent(item.tieRate).padStart(8),
        fixed(item.normalizedSd, 3).padStart(9),
        fixed(item.normalizedEntropy, 3).padStart(13),
        percent(item.band3.share).padStart(10),
        `${item.width80}`.padStart(7),
      ].join(''),
    );
  }
}

// 同一モデルで方式だけを比べる場合と、同一方式でモデルを比べる場合の両方で読めるラベル
const distinctModels = new Set(seriesList.map((series) => series.model));
const shortLabel = (series: Series) => {
  const base = series.rubric ?? series.file;
  return distinctModels.size > 1 && series.model ? `${base}/${series.model}` : base;
};

function printAgreement() {
  if (seriesList.length < 2) return;
  console.log('\n=== 系列間の一致度（共通PIDのみ / Spearman ρ・Kendall τ-b） ===');
  for (let i = 0; i < seriesList.length; i += 1) {
    for (let j = i + 1; j < seriesList.length; j += 1) {
      const left = seriesList[i];
      const right = seriesList[j];
      const sharedPids = [...left.scores.keys()].filter((pid) => right.scores.has(pid));
      if (sharedPids.length < 3) continue;
      const a = sharedPids.map((pid) => left.scores.get(pid) as number);
      const b = sharedPids.map((pid) => right.scores.get(pid) as number);
      console.log(
        `  ρ=${fixed(spearman(a, b), 3).padStart(6)} τ=${fixed(kendallTauB(a, b), 3).padStart(6)} ` +
          `n=${String(sharedPids.length).padStart(3)}  ${shortLabel(left)} ⇔ ${shortLabel(right)}`,
      );
    }
  }
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        axis,
        excludedPids: [...excludePids],
        series: metrics.map((item) => ({
          ...item,
          levelCounts: Object.fromEntries(item.levelCounts),
        })),
        agreement: seriesList.flatMap((left, i) =>
          seriesList.slice(i + 1).map((right) => {
            const sharedPids = [...left.scores.keys()].filter((pid) => right.scores.has(pid));
            const a = sharedPids.map((pid) => left.scores.get(pid) as number);
            const b = sharedPids.map((pid) => right.scores.get(pid) as number);
            return {
              a: left.label,
              b: right.label,
              n: sharedPids.length,
              spearman: sharedPids.length >= 3 ? spearman(a, b) : null,
              kendallTauB: sharedPids.length >= 3 ? kendallTauB(a, b) : null,
            };
          }),
        ),
      },
      null,
      2,
    ),
  );
} else {
  console.log(`軸: ${axis}${excludePids.size ? ` / 除外PID: ${[...excludePids].join(', ')}` : ''}`);
  for (const item of metrics) printDistribution(item);
  printSummary();
  printAgreement();
}
