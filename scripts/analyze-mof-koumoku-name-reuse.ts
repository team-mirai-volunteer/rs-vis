/**
 * MOFの「目」を年度をまたいで追跡するとき、何をキーにできるかを明らかにする調査。
 *
 * 前提（既知）:
 * - 目別分類コード（subItemCode）は費目の種類コードであり目のIDではない（1項内で複数の目が
 *   同じコードを共有する。2024年度当初予算で目の71.9%）
 * - 項コードも年度をまたいで安定しない（同じ組織内でコードが玉突きで振り直される。
 *   2020→2021・2022→2023・2025→2026で当初予算169件中75件がこの事例）
 *
 * したがって、年度をまたいで同一の目を指す手がかりとして残るのは実質「目名」だけである。
 * このスクリプトは、目名がどの範囲（スコープ）でなら一意に近いか、年度をまたいでどれだけ
 * 安定して使われているか、そして同じ目名が別の中身に「使い回されている」疑いがある事例を
 * 洗い出す。
 *
 * 実行: npx tsx scripts/analyze-mof-koumoku-name-reuse.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface MOFKouMokuLeaf {
  subItemCode: string;
  subItemName: string;
  amount: number;
}

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
  koumoku: MOFKouMokuLeaf[];
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

/** 項コードを含めない「組織」スコープ（所管は含める。項の玉突きは所管内で起きるため） */
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

interface ItemRow {
  year: number;
  orgScope: string;
  sectionCode: string;
  sectionName: string;
  subItemName: string;
  amount: number;
}

function loadAllItems(): Map<number, ItemRow[]> {
  const byYear = new Map<number, ItemRow[]>();
  for (const year of YEARS) {
    const sections = loadSections(year);
    if (!sections) continue;
    const rows: ItemRow[] = [];
    for (const s of sections) {
      const orgScope = orgScopeOf(s);
      for (const k of s.koumoku) {
        rows.push({ year, orgScope, sectionCode: s.sectionCode, sectionName: s.sectionName, subItemName: k.subItemName, amount: k.amount });
      }
    }
    byYear.set(year, rows);
  }
  return byYear;
}

function main() {
  const byYear = loadAllItems();

  // ---------- (A) 年内一意性: (組織スコープ, 目名) は年内で一意か ----------
  console.log('########## (A) 年内一意性: (組織スコープ, 目名) が同一年度内で重複するか ##########');
  for (const year of YEARS) {
    const rows = byYear.get(year);
    if (!rows) continue;
    const byKey = new Map<string, ItemRow[]>();
    for (const r of rows) {
      const key = `${r.orgScope}|${r.subItemName}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(r);
    }
    let dupKeys = 0;
    let dupItems = 0;
    let crossSectionDup = 0; // 同名だが異なる項コードにまたがる重複（真に紛らわしいケース）
    for (const [, list] of byKey) {
      if (list.length <= 1) continue;
      dupKeys++;
      dupItems += list.length;
      if (new Set(list.map(r => r.sectionCode)).size > 1) crossSectionDup++;
    }
    console.log(
      `  ${year}: 目数=${rows.length} 重複キー=${dupKeys} 重複目=${dupItems}(${((dupItems / rows.length) * 100).toFixed(1)}%) うち異なる項にまたがる重複=${crossSectionDup}`
    );
  }

  // ---------- (A2) 上記の重複を除いた「年内で単一項にしか属さない目名」だけを以後の対象にする ----------
  // (A)で見た重複の大半は「庁費」「施設整備費」等、複数の項に同時並行で存在する汎用名。
  // これらは(組織スコープ,目名)だけでは1本の項を指せず、B以降の「持続性・使い回し」判定の
  // 前提（1キー=1つの実体）が成り立たない。年内で単一項にしか出現しない目名だけに絞る。
  console.log('\n########## (A2) 年内単一項の目名（以後の分析対象）の割合 ##########');
  const uniqueOnlyByYear = new Map<number, ItemRow[]>();
  for (const year of YEARS) {
    const rows = byYear.get(year);
    if (!rows) continue;
    const countByKey = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.orgScope}|${r.subItemName}`;
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }
    const uniqueRows = rows.filter(r => countByKey.get(`${r.orgScope}|${r.subItemName}`) === 1);
    uniqueOnlyByYear.set(year, uniqueRows);
    console.log(`  ${year}: 単一項の目名=${uniqueRows.length}/${rows.length} (${((uniqueRows.length / rows.length) * 100).toFixed(1)}%)`);
  }

  // ---------- (B) 目名の年またぎ持続性: 同じ(組織スコープ,目名)が何年連続で存在するか ----------
  console.log('\n########## (B) 目名の持続性（単一項の目名のみ対象）: (組織スコープ,目名) の出現年パターン ##########');
  const allKeys = new Set<string>();
  const presence = new Map<string, Set<number>>(); // key -> 出現年集合
  const rowsAtKeyYear = new Map<string, ItemRow>(); // `${key}|${year}` -> 代表行
  for (const year of YEARS) {
    for (const r of uniqueOnlyByYear.get(year) ?? []) {
      const key = `${r.orgScope}|${r.subItemName}`;
      allKeys.add(key);
      if (!presence.has(key)) presence.set(key, new Set());
      presence.get(key)!.add(year);
      rowsAtKeyYear.set(`${key}|${year}`, r);
    }
  }
  const availYears = YEARS.filter(y => byYear.get(y));
  const totalYears = availYears.length;
  let allYearsCount = 0;
  let oneYearOnlyCount = 0;
  let gapCount = 0; // 途中で消えて後に復活（連続でない）
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
        const subItemName = key.slice(sep + 1);
        gapSamples.push(`  ${subItemName} [${orgScope}] 出現年=${sorted.join(',')}`);
      }
    }
  }
  console.log(`  ユニークな(組織スコープ,目名)総数: ${allKeys.size}`);
  console.log(`  全${totalYears}年度に存在: ${allYearsCount} (${((allYearsCount / allKeys.size) * 100).toFixed(1)}%)`);
  console.log(`  1年度だけ存在: ${oneYearOnlyCount} (${((oneYearOnlyCount / allKeys.size) * 100).toFixed(1)}%)`);
  console.log(`  消滅後に復活（不連続）: ${gapCount} (${((gapCount / allKeys.size) * 100).toFixed(1)}%)`);
  console.log('  --- 不連続の例 ---');
  for (const s of gapSamples) console.log(s);

  // ---------- (C) 使い回し疑い: 消滅→復活の間で項コードが変わり、かつ金額が大きく飛躍 ----------
  console.log('\n########## (C) 使い回し疑い: 復活時に項コード・金額の連続性が無いケース ##########');
  let suspiciousCount = 0;
  const suspiciousSamples: string[] = [];
  for (const [key, years] of presence) {
    const sorted = [...years].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const idxA = availYears.indexOf(sorted[i]);
      const idxB = availYears.indexOf(sorted[i + 1]);
      if (idxB - idxA <= 1) continue; // 連続（ギャップなし）
      const before = rowsAtKeyYear.get(`${key}|${sorted[i]}`)!;
      const after = rowsAtKeyYear.get(`${key}|${sorted[i + 1]}`)!;
      const sectionChanged = before.sectionName !== after.sectionName;
      if (before.amount === 0 || after.amount === 0) continue; // 金額0は判定材料にならないため除外
      const amountRatio = Math.max(before.amount, after.amount) / Math.min(before.amount, after.amount);
      if (sectionChanged && amountRatio > 5) {
        suspiciousCount++;
        if (suspiciousSamples.length < 15) {
          suspiciousSamples.push(
            `  "${before.subItemName}" [${before.orgScope}]: ${sorted[i]}年度[${before.sectionName}]${before.amount.toLocaleString()}円 ` +
              `-> (空白${idxB - idxA - 1}年度) -> ${sorted[i + 1]}年度[${after.sectionName}]${after.amount.toLocaleString()}円`
          );
        }
      }
    }
  }
  console.log(`  復活時に項名も変わり金額が5倍以上乖離: ${suspiciousCount}件`);
  for (const s of suspiciousSamples) console.log(s);

  // ---------- (D) 目名の連続出現年での金額推移の連続性（安定利用の裏付け） ----------
  console.log('\n########## (D) 連続出現している目名の項コード揺れ（目名が項の再編を跨いで生き残るか） ##########');
  let stableAcrossSectionChange = 0;
  let totalConsecutivePairs = 0;
  for (const [key, years] of presence) {
    const sorted = [...years].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const idxA = availYears.indexOf(sorted[i]);
      const idxB = availYears.indexOf(sorted[i + 1]);
      if (idxB - idxA !== 1) continue; // 連続年のみ
      totalConsecutivePairs++;
      const before = rowsAtKeyYear.get(`${key}|${sorted[i]}`)!;
      const after = rowsAtKeyYear.get(`${key}|${sorted[i + 1]}`)!;
      if (before.sectionCode !== after.sectionCode) stableAcrossSectionChange++;
    }
  }
  console.log(
    `  連続年ペア総数=${totalConsecutivePairs} うち項コードが変わっても目名で追跡できたペア=${stableAcrossSectionChange} (${((stableAcrossSectionChange / totalConsecutivePairs) * 100).toFixed(1)}%)`
  );
}

main();
