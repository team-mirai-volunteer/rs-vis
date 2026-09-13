/**
 * 項の年度横断識別子（sectionIdentity = 会計区分・組織/特会/機関・勘定・項コード。
 * 所管・予算種別を除外）が、実際にどれだけ「同じ実体」を指し続けているかを検証する。
 *
 * mof-kou-loader.ts の sectionIdentity() は所管表記の変更をまたぐために所管を除外して
 * いるが、項コード自体が年度で振り直される（＝別の実体に再利用される）ケースがあると、
 * sectionIdentity だけでは無関係な項の推移を1本の系列に接続してしまう。
 *
 * 判定方法: sectionIdentity が同じで sectionName が変わった年度ペアについて、同じ
 * スコープ（会計区分・組織/特会/機関・勘定）内の「別の項コード」で、旧項名・新項名が
 * 入れ替わるように出現していないかを調べる（コードの交換＝振り直しの直接証拠）。
 * 該当しない場合は正規化（全角半角・長音・中黒等）で改称かどうかを判定する。
 *
 * 実行: npx tsx scripts/analyze-mof-section-identity-stability.ts
 * 出力: data/result/mof-section-identity-name-changes.csv
 */

import * as fs from 'fs';
import * as path from 'path';

interface MOFSection {
  accountType: string;
  budgetType: string;
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
  sectionCode: string;
  sectionName: string;
}

interface MOFBudgetData {
  sections: MOFSection[];
}

const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const BUDGET_TYPE = '当初予算';
const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const RESULT_DIR = path.join(process.cwd(), 'data', 'result');

function normSpecialAccount(s: string): string {
  return s.replace(/特別会計$/, '');
}

function orgOf(s: MOFSection): string {
  return s.accountType === 'general' ? s.organization : s.accountType === 'special' ? normSpecialAccount(s.specialAccount) : s.agency;
}

/** mof-kou-loader.ts の sectionIdentity() と同一ロジック（所管・予算種別を除く） */
function sectionIdentity(s: MOFSection): string {
  return [s.accountType, orgOf(s), s.subAccount, s.sectionCode].join('|');
}

/** 項コードを除いた「同じ組織」スコープ。振り直し検出（同スコープ内でのコード交換）に使う */
function scopeOf(s: MOFSection): string {
  return [s.accountType, orgOf(s), s.subAccount].join('|');
}

function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s　・･]/g, '')
    .replace(/[ー−―]/g, '-');
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function loadSections(year: number): MOFSection[] | null {
  const p = path.join(DATA_DIR, `mof-budget-${year}.json`);
  if (!fs.existsSync(p)) return null;
  const data: MOFBudgetData = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return data.sections.filter(s => s.budgetType === BUDGET_TYPE);
}

interface NameChangeRow {
  yearA: number;
  yearB: number;
  identity: string;
  scope: string;
  sectionCode: string;
  oldName: string;
  newName: string;
  category: '表記ゆれ' | '振り直し疑い' | '改称・継承';
  detail: string;
}

function main() {
  const rows: NameChangeRow[] = [];
  const categoryCounts = new Map<string, number>();

  for (let i = 0; i < YEARS.length - 1; i++) {
    const yearA = YEARS[i];
    const yearB = YEARS[i + 1];
    const A = loadSections(yearA);
    const B = loadSections(yearB);
    if (!A || !B) continue;

    // スコープ単位で「項コード -> 項名」の対応を年度A・年度Bそれぞれ作る（振り直し検出用）
    const scopeNamesA = new Map<string, Map<string, string>>();
    const scopeNamesB = new Map<string, Map<string, string>>();
    for (const s of A) {
      const scope = scopeOf(s);
      if (!scopeNamesA.has(scope)) scopeNamesA.set(scope, new Map());
      scopeNamesA.get(scope)!.set(s.sectionCode, s.sectionName);
    }
    for (const s of B) {
      const scope = scopeOf(s);
      if (!scopeNamesB.has(scope)) scopeNamesB.set(scope, new Map());
      scopeNamesB.get(scope)!.set(s.sectionCode, s.sectionName);
    }

    const byIdentityA = new Map<string, MOFSection>();
    for (const s of A) byIdentityA.set(sectionIdentity(s), s);
    const byIdentityB = new Map<string, MOFSection>();
    for (const s of B) byIdentityB.set(sectionIdentity(s), s);

    for (const [identity, sa] of byIdentityA) {
      const sb = byIdentityB.get(identity);
      if (!sb) continue; // 消滅（新規/消滅の集計は別テーマ）
      if (sa.sectionName === sb.sectionName) continue; // 変化なし

      const scope = scopeOf(sa);
      const namesA = scopeNamesA.get(scope) ?? new Map();
      const namesB = scopeNamesB.get(scope) ?? new Map();

      // 振り直し疑い: 旧項名(sa.sectionName)が「別の項コード」として年度Bに新規出現している
      // （＝旧項名の実体が別コードへ移り、当該コードは別の実体（新項名）に置き換わった）
      let swapDetail = '';
      for (const [code, name] of namesB) {
        if (code === sa.sectionCode) continue;
        if (name !== sa.sectionName) continue;
        const existedBeforeAtSameName = namesA.get(code) === name;
        if (existedBeforeAtSameName) continue; // 元々別コードにも同名項があっただけ
        swapDetail = `旧項名「${sa.sectionName}」が別コード${code}に新規出現`;
        break;
      }

      let category: NameChangeRow['category'];
      let detail = '';
      if (swapDetail) {
        category = '振り直し疑い';
        detail = swapDetail;
      } else if (normalizeName(sa.sectionName) === normalizeName(sb.sectionName)) {
        category = '表記ゆれ';
      } else {
        const dist = levenshtein(sa.sectionName, sb.sectionName);
        category = '改称・継承';
        detail = `編集距離=${dist}`;
      }

      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      rows.push({
        yearA,
        yearB,
        identity,
        scope,
        sectionCode: sa.sectionCode,
        oldName: sa.sectionName,
        newName: sb.sectionName,
        category,
        detail,
      });
    }
  }

  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const csvPath = path.join(RESULT_DIR, 'mof-section-identity-name-changes.csv');
  const header = ['yearA', 'yearB', 'identity', 'scope', 'sectionCode', 'oldName', 'newName', 'category', 'detail'];
  const csvLines = [header.join(',')];
  for (const r of rows) {
    csvLines.push(
      [r.yearA, r.yearB, r.identity, r.scope, r.sectionCode, r.oldName, r.newName, r.category, r.detail]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
  }
  fs.writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf-8');

  console.log(`当初予算 sectionIdentity 単位の項名変化: 全${rows.length}件`);
  for (const [cat, n] of categoryCounts) {
    console.log(`  ${cat}: ${n}件 (${((n / rows.length) * 100).toFixed(1)}%)`);
  }

  console.log('\n--- 振り直し疑い（全件） ---');
  for (const r of rows.filter(r => r.category === '振り直し疑い')) {
    console.log(`  [${r.yearA}->${r.yearB}] ${r.scope} コード${r.sectionCode}: "${r.oldName}" -> "${r.newName}" | ${r.detail}`);
  }

  console.log('\n--- 年度ペアごとの件数 ---');
  const byPair = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.yearA}->${r.yearB}`;
    byPair.set(k, (byPair.get(k) ?? 0) + 1);
  }
  for (const [k, n] of byPair) console.log(`  ${k}: ${n}件`);

  console.log(`\nCSV出力: ${path.relative(process.cwd(), csvPath)}`);
}

main();
