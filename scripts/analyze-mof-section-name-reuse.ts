/**
 * MOFの「項」を年度をまたいで追跡するとき、何をキーにできるかを明らかにする調査。
 * `analyze-mof-koumoku-name-reuse.ts`（目名の再利用調査）と同じ手法を項名に適用する。
 *
 * 前提（テーマ1で確認済み）: 項コードは年度ごとに別物という前提に立つ。同じ組織内で
 * コードが玉突きで振り直される事例が当初予算だけで169件中75件（44.4%）ある。
 * したがって年度をまたいで項を追跡するキーの候補は実質「項名」しかない。
 *
 * 実行: npx tsx scripts/analyze-mof-section-name-reuse.ts
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
  amount: number;
}

interface MOFBudgetData {
  sections: MOFSection[];
}

const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const BUDGET_TYPE = '当初予算';
const DATA_DIR = path.join(process.cwd(), 'public', 'data');

function normSpecialAccount(s: string): string {
  return s.replace(/特別会計$/, '');
}

/** 項コードを含めない「組織」スコープ（所管を含む。項の玉突きは所管内で起きるため） */
function orgScopeOf(s: MOFSection): string {
  const org = s.accountType === 'general' ? s.organization : s.accountType === 'special' ? normSpecialAccount(s.specialAccount) : s.agency;
  return [s.accountType, s.ministry, org, s.subAccount].join('|');
}

function loadSections(year: number): MOFSection[] | null {
  const p = path.join(DATA_DIR, `mof-budget-${year}.json`);
  if (!fs.existsSync(p)) return null;
  const data: MOFBudgetData = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return data.sections.filter(s => s.budgetType === BUDGET_TYPE);
}

interface Row {
  year: number;
  orgScope: string;
  sectionCode: string;
  sectionName: string;
  amount: number;
}

function loadAllSections(): Map<number, Row[]> {
  const byYear = new Map<number, Row[]>();
  for (const year of YEARS) {
    const sections = loadSections(year);
    if (!sections) continue;
    byYear.set(
      year,
      sections.map(s => ({ year, orgScope: orgScopeOf(s), sectionCode: s.sectionCode, sectionName: s.sectionName, amount: s.amount }))
    );
  }
  return byYear;
}

function main() {
  const byYear = loadAllSections();

  // ---------- (A) 年内一意性: (組織スコープ, 項名) は同一年度内で重複するか ----------
  console.log('########## (A) 年内一意性: (組織スコープ, 項名) が同一年度内で重複するか ##########');
  for (const year of YEARS) {
    const rows = byYear.get(year);
    if (!rows) continue;
    const byKey = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.orgScope}|${r.sectionName}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(r);
    }
    let dupKeys = 0;
    let dupItems = 0;
    for (const [, list] of byKey) {
      if (list.length <= 1) continue;
      dupKeys++;
      dupItems += list.length;
    }
    console.log(`  ${year}: 項数=${rows.length} 重複キー=${dupKeys} 重複項=${dupItems}(${((dupItems / rows.length) * 100).toFixed(1)}%)`);
  }

  // ---------- (A2) 年内単一コードの項名だけに絞る ----------
  console.log('\n########## (A2) 年内単一コードの項名（以後の分析対象）の割合 ##########');
  const uniqueOnlyByYear = new Map<number, Row[]>();
  for (const year of YEARS) {
    const rows = byYear.get(year);
    if (!rows) continue;
    const countByKey = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.orgScope}|${r.sectionName}`;
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }
    const uniqueRows = rows.filter(r => countByKey.get(`${r.orgScope}|${r.sectionName}`) === 1);
    uniqueOnlyByYear.set(year, uniqueRows);
    console.log(`  ${year}: 単一コードの項名=${uniqueRows.length}/${rows.length} (${((uniqueRows.length / rows.length) * 100).toFixed(1)}%)`);
  }

  // ---------- (B) 項名の年またぎ持続性 ----------
  console.log('\n########## (B) 項名の持続性（単一コードの項名のみ対象）: (組織スコープ,項名) の出現年パターン ##########');
  const presence = new Map<string, Set<number>>();
  const rowsAtKeyYear = new Map<string, Row>();
  for (const year of YEARS) {
    for (const r of uniqueOnlyByYear.get(year) ?? []) {
      const key = `${r.orgScope}|${r.sectionName}`;
      if (!presence.has(key)) presence.set(key, new Set());
      presence.get(key)!.add(year);
      rowsAtKeyYear.set(`${key}|${year}`, r);
    }
  }
  const availYears = YEARS.filter(y => byYear.get(y));
  const totalYears = availYears.length;
  const allKeys = presence.size;
  let allYearsCount = 0;
  let oneYearOnlyCount = 0;
  let gapCount = 0;
  const gapSamples: string[] = [];
  for (const [key, years] of presence) {
    if (years.size === totalYears) allYearsCount++;
    if (years.size === 1) oneYearOnlyCount++;
    const sorted = [...years].sort((a, b) => a - b);
    let hasGap = false;
    for (let i = 0; i < sorted.length - 1; i++) {
      const idxA = availYears.indexOf(sorted[i]);
      const idxB = availYears.indexOf(sorted[i + 1]);
      if (idxB - idxA > 1) hasGap = true;
    }
    if (hasGap) {
      gapCount++;
      if (gapSamples.length < 15) {
        // orgScope自体が「|」区切り（accountType|ministry|org|subAccount）なので、
        // 最後の区切りで分割しないとorgScopeが途中で切れる
        const sep = key.lastIndexOf('|');
        const orgScope = key.slice(0, sep);
        const sectionName = key.slice(sep + 1);
        gapSamples.push(`  ${sectionName} [${orgScope}] 出現年=${sorted.join(',')}`);
      }
    }
  }
  console.log(`  ユニークな(組織スコープ,項名)総数: ${allKeys}`);
  console.log(`  全${totalYears}年度に存在: ${allYearsCount} (${((allYearsCount / allKeys) * 100).toFixed(1)}%)`);
  console.log(`  1年度だけ存在: ${oneYearOnlyCount} (${((oneYearOnlyCount / allKeys) * 100).toFixed(1)}%)`);
  console.log(`  消滅後に復活（不連続）: ${gapCount} (${((gapCount / allKeys) * 100).toFixed(1)}%)`);
  console.log('  --- 不連続の例 ---');
  for (const s of gapSamples) console.log(s);

  // ---------- (C) 使い回し疑い: 復活時に金額の連続性が無いケース ----------
  console.log('\n########## (C) 使い回し疑い: 復活時に金額の連続性が無いケース（項コードは無視、項名だけで判定） ##########');
  let suspiciousCount = 0;
  const suspiciousSamples: string[] = [];
  for (const [key, years] of presence) {
    const sorted = [...years].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const idxA = availYears.indexOf(sorted[i]);
      const idxB = availYears.indexOf(sorted[i + 1]);
      if (idxB - idxA <= 1) continue;
      const before = rowsAtKeyYear.get(`${key}|${sorted[i]}`)!;
      const after = rowsAtKeyYear.get(`${key}|${sorted[i + 1]}`)!;
      if (before.amount === 0 || after.amount === 0) continue;
      const amountRatio = Math.max(before.amount, after.amount) / Math.min(before.amount, after.amount);
      if (amountRatio > 5) {
        suspiciousCount++;
        if (suspiciousSamples.length < 15) {
          suspiciousSamples.push(
            `  "${before.sectionName}" [${before.orgScope}]: ${sorted[i]}年度 ${before.amount.toLocaleString()}円 ` +
              `-> (空白${idxB - idxA - 1}年度) -> ${sorted[i + 1]}年度 ${after.amount.toLocaleString()}円`
          );
        }
      }
    }
  }
  console.log(`  復活時に金額が5倍以上乖離: ${suspiciousCount}件`);
  for (const s of suspiciousSamples) console.log(s);

  // ---------- (D) 連続出現している項名の項コード揺れ（項名が項コードの振り直しを跨いで生き残るか） ----------
  console.log('\n########## (D) 連続出現している項名の項コード揺れ ##########');
  let stableAcrossCodeChange = 0;
  let totalConsecutivePairs = 0;
  for (const [key, years] of presence) {
    const sorted = [...years].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const idxA = availYears.indexOf(sorted[i]);
      const idxB = availYears.indexOf(sorted[i + 1]);
      if (idxB - idxA !== 1) continue;
      totalConsecutivePairs++;
      const before = rowsAtKeyYear.get(`${key}|${sorted[i]}`)!;
      const after = rowsAtKeyYear.get(`${key}|${sorted[i + 1]}`)!;
      if (before.sectionCode !== after.sectionCode) stableAcrossCodeChange++;
    }
  }
  console.log(
    `  連続年ペア総数=${totalConsecutivePairs} うち項コードが変わっても項名で追跡できたペア=${stableAcrossCodeChange} (${((stableAcrossCodeChange / totalConsecutivePairs) * 100).toFixed(1)}%)`
  );
}

main();
