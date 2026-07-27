/**
 * AI採点が「所管庁の書いた文章の量」に引っ張られていないかを測る。
 *
 *   npx tsx scripts/analyze-prose-bias.ts [year]
 *
 * 背景:
 *   「well written な事業が過剰に評価されているのでは」という懸念を母集団で検証するもの。
 *   旧ルーブリック（成果指標・ロジックモデルの取り込み前）では、AI採点は構造データより
 *   散文の量と強く相関していた。新ルーブリックはロジックモデルと登録指標をプロンプトへ
 *   投入したので、効いていれば大小が逆転するはず。
 *
 * 合格条件:
 *   成果設計   ロジック接続数との相関 > 散文量との相関
 *   検証可能性 登録実績値との相関   > 散文量との相関
 *
 * ベースライン（2025年度・旧ルーブリック）:
 *   成果設計    散文 +0.315 / ロジック接続 +0.167
 *   検証可能性  散文 +0.326 / 登録実績値   +0.215
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const year = process.argv[2] ?? '2025';
const DATA = path.join(process.cwd(), 'public', 'data');

function loadMaybeGz<T>(base: string): T {
  const plain = path.join(DATA, base);
  if (fs.existsSync(plain)) return JSON.parse(fs.readFileSync(plain, 'utf-8'));
  if (fs.existsSync(`${plain}.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${plain}.gz`)).toString('utf-8'));
  }
  throw new Error(`${base}(.gz) が見つかりません`);
}

function spearman(pairs: Array<readonly [number, number]>): number {
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
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

type Score = {
  pid: string; name: string; budgetAmount: number;
  designClarity: number | null; evidenceReadiness: number | null;
  budgetProportionality: number | null; necessity: number | null;
};
type Detail = { purpose?: string; currentIssues?: string; overview?: string };
type Outcome = {
  indicatorCounts?: { total?: number; withActual?: number; outcomeWithActual?: number };
  logicModel?: { counts?: { total?: number; reachesOutcome?: number } };
};

const scores = loadMaybeGz<Score[]>(`project-quality-scores-${year}.json`);
const details = loadMaybeGz<Record<string, Detail>>(`rs${year}-project-details.json`);
const outcomes = loadMaybeGz<Record<string, Outcome>>(`rs${year}-project-outcomes.json`);

type Row = { len: number; links: number; actuals: number; budget: number } & Pick<
  Score, 'designClarity' | 'evidenceReadiness' | 'budgetProportionality' | 'necessity'
>;

const rows: Row[] = [];
for (const s of scores) {
  if (s.designClarity == null) continue;
  const d = details[s.pid] ?? details[String(s.pid)] ?? {};
  const o = outcomes[String(s.pid)] ?? {};
  rows.push({
    len: `${d.purpose ?? ''}${d.currentIssues ?? ''}${d.overview ?? ''}`.length,
    links: o.logicModel?.counts?.total ?? 0,
    actuals: o.indicatorCounts?.withActual ?? 0,
    budget: s.budgetAmount || 0,
    designClarity: s.designClarity,
    evidenceReadiness: s.evidenceReadiness,
    budgetProportionality: s.budgetProportionality,
    necessity: s.necessity,
  });
}

const pairs = (x: (r: Row) => number, y: (r: Row) => number | null) =>
  rows.map((r) => [x(r), y(r)] as const)
    .filter((p): p is readonly [number, number] => p[1] != null);

const rho = (x: (r: Row) => number, y: (r: Row) => number | null) => {
  const ps = pairs(x, y);
  return { v: spearman(ps), n: ps.length };
};

const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`;

console.log(`=== ${year}年度 / AI採点済 ${rows.length.toLocaleString()}事業 ===\n`);
console.log('AI採点は「散文の量」と「構造データ」のどちらに強く反応しているか');
console.log('（構造 > 散文 なら、投入した登録データが実際に読まれている）\n');

const checks = [
  { axis: '成果設計', pick: (r: Row) => r.designClarity,
    structLabel: 'ロジック接続数', struct: (r: Row) => r.links, baseProse: 0.315, baseStruct: 0.167 },
  { axis: '検証可能性', pick: (r: Row) => r.evidenceReadiness,
    structLabel: '登録実績値の件数', struct: (r: Row) => r.actuals, baseProse: 0.326, baseStruct: 0.215 },
];

for (const c of checks) {
  const prose = rho((r) => r.len, c.pick);
  const struct = rho(c.struct, c.pick);
  const pass = struct.v > prose.v;
  console.log(`■ ${c.axis}  (n=${prose.n.toLocaleString()})`);
  console.log(`    × 記載文字数（散文）      ${fmt(prose.v)}   [旧ルーブリック ${fmt(c.baseProse)}]`);
  console.log(`    × ${c.structLabel.padEnd(14, '　')} ${fmt(struct.v)}   [旧ルーブリック ${fmt(c.baseStruct)}]`);
  console.log(`    → ${pass ? '✅ 構造データが優位（合格）' : '❌ 依然として散文が優位'}`
    + `  差 ${fmt(struct.v - prose.v)}\n`);
}

// 参考: 残り2軸と予算規模。費用対内容と必要性は支出先データが素材なので散文依存は低いはず
console.log('── 参考 ──');
for (const [label, pick] of [
  ['費用対内容', (r: Row) => r.budgetProportionality],
  ['必要性', (r: Row) => r.necessity],
] as const) {
  const p = rho((r) => r.len, pick);
  if (!p.n) { console.log(`  ${label.padEnd(6)} 判定なし`); continue; }
  console.log(`  ${label.padEnd(6)} × 記載文字数 ${fmt(p.v)} (n=${p.n.toLocaleString()})`);
}
for (const [label, pick] of [
  ['成果設計', (r: Row) => r.designClarity],
  ['検証可能性', (r: Row) => r.evidenceReadiness],
] as const) {
  const b = rows.filter((r) => r.budget > 0);
  const ps = b.map((r) => [Math.log10(r.budget), pick(r)] as const)
    .filter((p): p is readonly [number, number] => p[1] != null);
  console.log(`  ${label.padEnd(6)} × log10(予算額) ${fmt(spearman(ps))} (n=${ps.length.toLocaleString()})`);
}

// 記載量の五分位ごとのスコア推移。単調に上がっていれば散文依存が残っている
const sorted = [...rows].sort((a, b) => a.len - b.len);
const q = Math.floor(sorted.length / 5);
console.log('\n── 記載量の五分位ごとの平均スコア（単調増加なら散文依存が残っている）──');
console.log('  文字数レンジ        n     成果設計  検証可能性');
for (let k = 0; k < 5; k += 1) {
  const seg = k < 4 ? sorted.slice(k * q, (k + 1) * q) : sorted.slice(4 * q);
  const avg = (f: (r: Row) => number | null) => {
    const v = seg.map(f).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  console.log(
    `  ${String(seg[0].len).padStart(5)}-${String(seg[seg.length - 1].len).padStart(5)}字  ` +
      `${String(seg.length).padStart(5)}  ${avg((r) => r.designClarity).toFixed(2).padStart(7)}  ` +
      `${avg((r) => r.evidenceReadiness).toFixed(2).padStart(9)}`,
  );
}
