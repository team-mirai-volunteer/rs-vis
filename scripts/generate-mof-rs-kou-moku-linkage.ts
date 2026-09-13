/**
 * MOF目（科目別内訳） ↔ RS事業 紐づけデータ生成スクリプト。
 *
 * RS の `2-2_予算・執行_予算種別・歳出予算項目` は 所管/組織・勘定/項/目（一般会計）・
 * 所管/会計/勘定/項/目（特別会計）を MOF の科目別内訳（mof-kou-moku-{年度}.json）と
 * 同じ語彙で持つため、名前照合や構造キーでの絞り込みは不要で、完全一致キーで
 * 直接突き合わせられる。
 *
 * ## RSシート年度と予算年度（docs/tasks/20260913_0428_財務省予算書とRS事業の完全統合サンキー設計.md 1.5・3.6）
 *
 * RSシートNの 2-2 は予算年度 N-4〜N の行を持つが、項・目が充足しているのは
 * **予算年度N（99%）と、N-1シートで項・目付きで入力されて引き継がれたN-1行**だけ。
 * さらに予算年度N行には **N+1年度の要求額が目単位**で入っている。したがって1枚のシートから
 *   - 予算年度 N-1: 予算（当初・補正）。執行・支出先が揃う年度
 *   - 予算年度 N  : 予算（当初・補正）
 *   - 予算年度 N+1: 要求額（RS）↔ 当初予算（MOF）の「要求→査定」対比
 * の3表を生成する。出力は予算年度ごとに1ファイルで、どのシートを正としたかは metadata に残す。
 *
 * 「前年度から繰越し」「予備費等N」は RS側に所管/組織・勘定/項/目が記録されていない
 * （歳出予算項目ごとの内訳ではなく予算額の合計だけ）ため原理的に突合不可能。
 * この金額は事業ごとに合算して `projects[].rsAmountNoSubject` に残す（統合グラフで
 * 「繰越・予備費等（予算書外）」の流入として使う）。
 *
 * 使用法:
 *   tsx scripts/generate-mof-rs-kou-moku-linkage.ts --sheet 2025 --budget-year 2024
 *   tsx scripts/generate-mof-rs-kou-moku-linkage.ts --sheet 2025 --budget-year 2025
 *   tsx scripts/generate-mof-rs-kou-moku-linkage.ts --sheet 2025 --budget-year 2026   （要求モード）
 *   tsx scripts/generate-mof-rs-kou-moku-linkage.ts 2025   （旧形式: シート2025・予算年度2024）
 *
 * 入力:
 *   public/data/mof-kou-moku-{予算年度}.json  … MOF目（一般会計・特別会計・当初予算＋補正予算を突合、決算は引き継ぎ）
 *   data/year_{シート年度}/1-1 … 予算事業ID → 事業名・府省庁
 *   data/year_{シート年度}/2-2 … 予算事業ID → 歳出予算科目（所管/会計/勘定/組織・勘定/項/目/予算種別/予算額/翌年度要求額）
 *
 * 出力:
 *   public/data/mof-rs-kou-moku-linkage-{予算年度}.json        … 紐づけ本体（.gz で Git 管理）
 *   public/data/mof-rs-linkage-unmatched-{予算年度}.json        … 未一致の全件（ローカル診断用・Git 管理外）
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from '@/scripts/csv-reader';
import type { CSVRow } from '@/types/rs-system';
import type { MOFBudgetType, MOFKouMokuData, MOFKouMokuItem } from '@/types/mof-kou-moku';
import { MOF_REVISION_NUMBERS, revisedBudgetType } from '@/types/mof-jikou';
import type {
  MofRsKouMokuLinkageData,
  MofRsKouMokuLinkageRecord,
  MofRsLinkageProjectTotal,
  MofRsLinkageUnmatchedMof,
  MofRsLinkageUnmatchedRs,
  MofRsUnmatchedReason,
} from '@/types/mof-rs-kou-moku-linkage';

// ─── 引数 ──────────────────────────────────────────────
function parseArgs(argv: string[]): { sheetYear: number; budgetYear: number } {
  const get = (name: string): number | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const v = parseInt(argv[i + 1] ?? '', 10);
    if (isNaN(v)) {
      console.error(`${name} の値が不正です: ${argv[i + 1]}`);
      process.exit(1);
    }
    return v;
  };
  const positional = argv.find(a => /^\d{4}$/.test(a) && argv[argv.indexOf(a) - 1] !== '--sheet' && argv[argv.indexOf(a) - 1] !== '--budget-year');
  const sheetYear = get('--sheet') ?? (positional ? parseInt(positional, 10) : 2025);
  const budgetYear = get('--budget-year') ?? sheetYear - 1;
  for (const [label, y] of [['シート年度', sheetYear], ['予算年度', budgetYear]] as const) {
    if (y < 2000 || y > 2100) {
      console.error(`${label}が不正です: ${y}`);
      process.exit(1);
    }
  }
  if (budgetYear > sheetYear + 1 || budgetYear < sheetYear - 4) {
    console.error(`予算年度 ${budgetYear} はシート ${sheetYear} の範囲外です（${sheetYear - 4}〜${sheetYear + 1}）`);
    process.exit(1);
  }
  return { sheetYear, budgetYear };
}

const { sheetYear: SHEET_YEAR, budgetYear: BUDGET_YEAR } = parseArgs(process.argv.slice(2));
/** 要求モード: 予算年度 = シート年度+1。RS側は予算年度Nの行の「翌年度要求額」、MOF側は N+1 の当初予算 */
const REQUEST_MODE = BUDGET_YEAR === SHEET_YEAR + 1;
/** 2-2 のどの予算年度の行を読むか */
const RS_ROW_YEAR = REQUEST_MODE ? SHEET_YEAR : BUDGET_YEAR;

const DATA_DIR = path.join(__dirname, `../data/year_${SHEET_YEAR}`);
const OUTPUT_DIR = path.join(__dirname, '../public/data');
const KOU_MOKU_FILE = path.join(OUTPUT_DIR, `mof-kou-moku-${BUDGET_YEAR}.json`);
const OUTPUT_FILE = path.join(OUTPUT_DIR, `mof-rs-kou-moku-linkage-${BUDGET_YEAR}.json`);
const UNMATCHED_FILE = path.join(OUTPUT_DIR, `mof-rs-linkage-unmatched-${BUDGET_YEAR}.json`);

/**
 * RS側の予算種別表記からMOF側の予算種別を解決する。
 * 対応が無い種別（前年度から繰越し・予備費等N・空欄）は null を返し、呼び出し側で除外する。
 * 要求モードでは当初予算行の翌年度要求額だけを使い、MOF側は翌年度の当初予算に対応づける
 * （補正行の翌年度要求額は実測で全て0）。
 */
function resolveMofBudgetType(rsBudgetType: string): MOFBudgetType | null {
  if (rsBudgetType === '当初予算') return '当初予算';
  if (REQUEST_MODE) return null;
  const m = /^第(\d+)次補正予算$/.exec(rsBudgetType);
  if (m) {
    const n = Number(m[1]);
    const revision = MOF_REVISION_NUMBERS.find(r => r === n);
    if (revision) return revisedBudgetType(revision);
  }
  return null;
}

/** 予算種別が「項・目を持たない種別」（繰越・予備費等）か */
function isNoSubjectBudgetType(rsBudgetType: string): boolean {
  return rsBudgetType === '前年度から繰越し' || /^予備費等\d*$/.test(rsBudgetType);
}

/** 突合用の文字列正規化: NFKC + 空白除去。表記そのものは出力側に生値で残す */
function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

function loadCSV(filename: string): CSVRow[] {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${filePath} がありません。node scripts/download-rs-csv.mjs ${SHEET_YEAR} → python scripts/extract-rs-csv.py ${SHEET_YEAR} を実行してください。`);
    process.exit(1);
  }
  console.log(`  読み込み中: ${filename}`);
  const rows = readShiftJISCSV(filePath);
  console.log(`    → ${rows.length.toLocaleString()} 行`);
  return rows;
}

function kouMokuMatchKey(it: MOFKouMokuItem): string {
  return it.accountType === 'general'
    ? [it.budgetType, norm(it.ministry), norm(it.organization), norm(it.sectionName), norm(it.subItemName)].join('|')
    : [it.budgetType, norm(it.ministry), norm(it.specialAccount), norm(it.subAccount), norm(it.sectionName), norm(it.subItemName)].join('|');
}

function rsMatchKey(row: CSVRow, accountCategory: string, mofBudgetType: MOFBudgetType): string {
  // 一般会計: 所管|組織・勘定|項|目、特別会計: 所管|会計|勘定|項|目
  // （特別会計の「組織・勘定」は「勘定」と重複するため使わず、会計/勘定を個別に使う）
  return accountCategory === '一般会計'
    ? [mofBudgetType, norm(row['所管'] || ''), norm(row['組織・勘定'] || ''), norm(row['項'] || ''), norm(row['目'] || '')].join('|')
    : [mofBudgetType, norm(row['所管'] || ''), norm(row['会計'] || ''), norm(row['勘定'] || ''), norm(row['項'] || ''), norm(row['目'] || '')].join('|');
}

function makeRecord(pid: number, project: { name: string; ministry: string }, it: MOFKouMokuItem, rsAmount: number): MofRsKouMokuLinkageRecord {
  return {
    projectId: pid,
    projectName: project.name,
    projectMinistry: project.ministry,
    kouMokuKey: it.key,
    mofAccountType: it.accountType,
    mofBudgetType: it.budgetType,
    mofMinistry: it.ministry,
    mofOrganization: it.accountType === 'special' ? it.specialAccount : it.organization,
    mofSubAccount: it.subAccount,
    sectionCode: it.sectionCode,
    sectionName: it.sectionName,
    subItemCode: it.subItemCode,
    subItemName: it.subItemName,
    kouMokuAmount: it.amount,
    rsAmount,
  };
}

function main() {
  console.log(
    `=== MOF目↔RS事業 紐づけデータ生成 (予算年度${BUDGET_YEAR} / RSシート${SHEET_YEAR}${REQUEST_MODE ? ' / 要求モード' : ''}) ===\n`
  );

  // 1. MOF目
  console.log('[1/5] MOF目読み込み');
  if (!fs.existsSync(KOU_MOKU_FILE)) {
    console.error(`❌ ${KOU_MOKU_FILE} がありません。generate-mof-kou-moku-data.ts を先に実行するか、.gz を展開してください。`);
    process.exit(1);
  }
  const kouMokuData: MOFKouMokuData = JSON.parse(fs.readFileSync(KOU_MOKU_FILE, 'utf-8'));
  /** 突合対象の予算種別: 当初予算 + 存在する号数ぶんの補正予算（要求モードは当初予算のみ） */
  const supportedBudgetTypes = new Set<MOFBudgetType>(
    REQUEST_MODE ? ['当初予算'] : ['当初予算', ...MOF_REVISION_NUMBERS.map(revisedBudgetType)]
  );
  const kouMokuItems = kouMokuData.items.filter(
    it => (it.accountType === 'general' || it.accountType === 'special') && supportedBudgetTypes.has(it.budgetType)
  );
  for (const budgetType of [...supportedBudgetTypes]) {
    const count = kouMokuItems.filter(i => i.budgetType === budgetType).length;
    if (count > 0) console.log(`  ${budgetType}の目（一般会計＋特別会計）: ${count.toLocaleString()} 件`);
  }
  if (kouMokuItems.length === 0) {
    console.error('❌ 突合対象のMOF目がありません（この年度の当初予算が未収録）');
    process.exit(1);
  }

  /**
   * 完全一致キー → 目の配列。名前一致キーが同じで項・目コードが異なる目が複数あることがある
   * （同一組織内で同名の項×目を別コードで再利用）。以前は最後の1件で上書きしていたが、
   * RS側からはどちらか判別できないため、全件を保持して RS金額を目額比で按分し `ambiguous` を付ける。
   */
  const kouMokuByKey = new Map<string, MOFKouMokuItem[]>();
  for (const it of kouMokuItems) {
    const key = kouMokuMatchKey(it);
    const list = kouMokuByKey.get(key);
    if (list) {
      if (!list.some(x => x.sectionCode === it.sectionCode && x.subItemCode === it.subItemCode)) list.push(it);
      // コードまで同じ完全重複は帳票の重複行なので1件に畳む
    } else {
      kouMokuByKey.set(key, [it]);
    }
  }
  const ambiguousKeys = [...kouMokuByKey.values()].filter(l => l.length > 1).length;
  console.log(`  突合キー: ${kouMokuByKey.size.toLocaleString()} 件（うち項・目コードが異なる同名キー ${ambiguousKeys.toLocaleString()} 件 → 按分）`);

  // 2. RS側: 事業マスタ + 歳出予算科目
  console.log('\n[2/5] RS CSV読み込み');
  const orgRows = loadCSV(`1-1_RS_${SHEET_YEAR}_基本情報_組織情報.csv`);
  const budgetItemRows = loadCSV(`2-2_RS_${SHEET_YEAR}_予算・執行_予算種別・歳出予算項目.csv`);

  const projectMap = new Map<number, { name: string; ministry: string }>();
  for (const row of orgRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    projectMap.set(pid, {
      name: row['事業名'] || '',
      ministry: row['府省庁'] || row['所管府省庁'] || '',
    });
  }
  console.log(`  事業マスタ: ${projectMap.size.toLocaleString()} 事業`);

  // 3. 完全一致キーで直接突合
  console.log(`\n[3/5] 完全一致キーで突合（2-2 の予算年度${RS_ROW_YEAR}行、金額列: ${REQUEST_MODE ? '翌年度要求額' : '予算額'}）`);
  const AMOUNT_COL = REQUEST_MODE ? '翌年度要求額(歳出予算項目ごと)' : '予算額(歳出予算項目ごと)';
  if (budgetItemRows.length > 0 && !(AMOUNT_COL in budgetItemRows[0])) {
    console.error(`❌ 2-2 CSV に列「${AMOUNT_COL}」がありません。ヘッダ: ${Object.keys(budgetItemRows[0]).join(', ')}`);
    process.exit(1);
  }

  const linkMap = new Map<string, MofRsKouMokuLinkageRecord>(); // `${pid}|${kouMokuKey}` → record
  const projectTotals = new Map<number, MofRsLinkageProjectTotal>();
  const unmatchedRsMap = new Map<string, MofRsLinkageUnmatchedRs>(); // `${pid}|${matchKey}` → 集約
  let targetRows = 0;
  let linkedRows = 0;
  let totalAmount = 0;
  let linkedAmount = 0;
  let noSubjectRows = 0;
  let noSubjectAmount = 0;
  let otherAccountRows = 0;

  const totalOf = (pid: number, project: { name: string; ministry: string }): MofRsLinkageProjectTotal => {
    let t = projectTotals.get(pid);
    if (!t) {
      t = {
        projectId: pid,
        projectName: project.name,
        projectMinistry: project.ministry,
        rsAmountTotal: 0,
        rsAmountLinked: 0,
        rsAmountUnmatched: 0,
        rsAmountNoSubject: 0,
      };
      projectTotals.set(pid, t);
    }
    return t;
  };

  for (const row of budgetItemRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid) || !projectMap.has(pid)) continue;
    if (parseInt(row['予算年度'], 10) !== RS_ROW_YEAR) continue;
    const project = projectMap.get(pid)!;
    const accountCategory = (row['会計区分'] || '').trim();
    const rsBudgetType = (row['予算種別'] || '').trim();
    const amount = parseAmount(row[AMOUNT_COL] ?? '');

    // 繰越・予備費等: 項・目が無いので突合対象外だが、事業単位の合計は残す（要求モードでは意味が無いので除く）
    if (!REQUEST_MODE && isNoSubjectBudgetType(rsBudgetType)) {
      noSubjectRows++;
      noSubjectAmount += amount;
      const t = totalOf(pid, project);
      t.rsAmountTotal += amount;
      t.rsAmountNoSubject += amount;
      continue;
    }
    if (accountCategory !== '一般会計' && accountCategory !== '特別会計') {
      otherAccountRows++;
      continue;
    }
    const mofBudgetType = resolveMofBudgetType(rsBudgetType);
    if (!mofBudgetType) continue; // 空欄種別・要求モードの補正行など
    if (REQUEST_MODE && amount === 0) continue; // 要求無し

    targetRows++;
    totalAmount += amount;
    const t = totalOf(pid, project);
    t.rsAmountTotal += amount;

    const key = rsMatchKey(row, accountCategory, mofBudgetType);
    const candidates = kouMokuByKey.get(key);
    if (!candidates) {
      t.rsAmountUnmatched += amount;
      const reason: MofRsUnmatchedReason = !(row['項'] || '').trim() || !(row['目'] || '').trim() ? 'rs-no-subject-code' : 'no-mof-match';
      const uKey = `${pid}|${key}`;
      const u = unmatchedRsMap.get(uKey);
      if (u) {
        u.rsAmount += amount;
        u.rows++;
      } else {
        unmatchedRsMap.set(uKey, {
          projectId: pid,
          projectName: project.name,
          projectMinistry: project.ministry,
          accountCategory,
          rsBudgetType,
          jurisdiction: row['所管'] || '',
          organizationAccount: row['組織・勘定'] || '',
          account: row['会計'] || '',
          subAccount: row['勘定'] || '',
          item: row['項'] || '',
          subItem: row['目'] || '',
          note: row['歳出予算項目の補足情報'] || '',
          rsAmount: amount,
          rows: 1,
          reason,
        });
      }
      continue;
    }

    linkedRows++;
    linkedAmount += amount;
    t.rsAmountLinked += amount;

    // 同名キーの目が複数ある場合は目額比で按分（目額が全て0なら等分）
    const denom = candidates.reduce((s, c) => s + Math.max(0, c.amount), 0);
    for (const it of candidates) {
      const share = candidates.length === 1 ? amount : denom > 0 ? Math.round((amount * Math.max(0, it.amount)) / denom) : Math.round(amount / candidates.length);
      const pairKey = `${pid}|${it.key}`;
      const existing = linkMap.get(pairKey);
      if (existing) {
        existing.rsAmount += share;
      } else {
        const rec = makeRecord(pid, project, it, share);
        if (candidates.length > 1) rec.ambiguous = true;
        linkMap.set(pairKey, rec);
      }
    }
  }
  console.log(`  対象行（予算年度${RS_ROW_YEAR}・一般会計＋特別会計・${REQUEST_MODE ? '当初予算行の要求額' : '当初予算＋補正予算'}）: ${targetRows.toLocaleString()} 行`);
  if (!REQUEST_MODE) console.log(`  繰越・予備費等（項・目無し・事業合計のみ保持）: ${noSubjectRows.toLocaleString()} 行 / ${(noSubjectAmount / 1e12).toFixed(2)} 兆円`);
  if (otherAccountRows > 0) console.log(`  会計区分が一般/特別以外（対象外）: ${otherAccountRows.toLocaleString()} 行`);
  console.log(`  完全一致: ${linkedRows.toLocaleString()} 行 → ${linkMap.size.toLocaleString()} ペア（事業×目）`);

  // 3.5. 決算目への引き継ぎ
  //
  // RSは決算・執行実績を目単位で持たない（2-2 CSVの予算種別は当初/補正/繰越/予備費のみ）ため、
  // 決算目を直接キー一致させることはできない。一方で決算目と予算側（当初・補正）の目は
  // 同一の識別子（会計区分・所管・組織/特会・勘定・項コード・目分類コード・目名。予算種別を
  // 除く）を共有することが多い（`/mof-kou-moku` の年度推移機能と同じ前提）。この識別子で
  // 予算側の既存リンクを決算目に引き継ぐ。
  console.log('\n[4/5] 決算目への引き継ぎ');

  function carryoverIdentity(accountType: string, ministry: string, orgOrSpecial: string, subAccount: string, sectionCode: string, subItemCode: string, subItemName: string): string {
    return [accountType, norm(ministry), norm(orgOrSpecial), norm(subAccount), sectionCode, subItemCode, norm(subItemName)].join('|');
  }

  const budgetLinksByIdentity = new Map<string, Map<number, MofRsKouMokuLinkageRecord>>();
  for (const link of linkMap.values()) {
    const identity = carryoverIdentity(link.mofAccountType, link.mofMinistry, link.mofOrganization, link.mofSubAccount, link.sectionCode, link.subItemCode, link.subItemName);
    const byPid = budgetLinksByIdentity.get(identity) ?? new Map<number, MofRsKouMokuLinkageRecord>();
    const existing = byPid.get(link.projectId);
    if (!existing || link.rsAmount > existing.rsAmount) byPid.set(link.projectId, link);
    budgetLinksByIdentity.set(identity, byPid);
  }

  const settlementItems = REQUEST_MODE
    ? []
    : kouMokuData.items.filter(it => (it.accountType === 'general' || it.accountType === 'special') && it.budgetType === '決算');
  let carriedOverCount = 0;
  for (const it of settlementItems) {
    const identity = carryoverIdentity(it.accountType, it.ministry, it.accountType === 'special' ? it.specialAccount : it.organization, it.subAccount, it.sectionCode, it.subItemCode, it.subItemName);
    const byPid = budgetLinksByIdentity.get(identity);
    if (!byPid) continue;
    for (const source of byPid.values()) {
      const pairKey = `${source.projectId}|${it.key}`;
      if (linkMap.has(pairKey)) continue;
      const rec = makeRecord(source.projectId, { name: source.projectName, ministry: source.projectMinistry }, it, source.rsAmount);
      rec.carriedOverFrom = source.mofBudgetType;
      if (source.ambiguous) rec.ambiguous = true;
      linkMap.set(pairKey, rec);
      carriedOverCount++;
    }
  }
  if (settlementItems.length > 0) {
    console.log(`  決算目: ${settlementItems.length.toLocaleString()} 件中 ${carriedOverCount.toLocaleString()} 件に予算側リンクを引き継ぎ`);
  } else {
    console.log(REQUEST_MODE ? '  要求モードのため決算は対象外' : '  この年度の決算は未収録');
  }

  // 4. 未一致（MOF側）: 突合対象の目のうちRS事業が1件も付かなかったもの
  console.log('\n[5/5] 未一致の集計と出力');
  const links = [...linkMap.values()].sort((a, b) => b.rsAmount - a.rsAmount);
  const linkedKouMokuKeys = new Set(links.map(l => l.kouMokuKey));
  const unmatchedMof: MofRsLinkageUnmatchedMof[] = kouMokuItems
    .filter(it => !linkedKouMokuKeys.has(it.key))
    .map(it => ({
      kouMokuKey: it.key,
      accountType: it.accountType,
      budgetType: it.budgetType,
      ministry: it.ministry,
      organization: it.accountType === 'special' ? it.specialAccount : it.organization,
      subAccount: it.subAccount,
      sectionCode: it.sectionCode,
      sectionName: it.sectionName,
      subItemCode: it.subItemCode,
      subItemName: it.subItemName,
      majorExpenseCode: it.majorExpenseCode,
      purposeCode: it.purposeCode,
      objectiveCode: it.objectiveCode,
      amount: it.amount,
    }))
    .sort((a, b) => b.amount - a.amount);
  const unmatchedRs = [...unmatchedRsMap.values()].sort((a, b) => b.rsAmount - a.rsAmount);
  const unmatchedRsByReason = unmatchedRs.reduce<Record<MofRsUnmatchedReason, { rows: number; amount: number }>>(
    (acc, u) => {
      acc[u.reason].rows += u.rows;
      acc[u.reason].amount += u.rsAmount;
      return acc;
    },
    { 'rs-no-subject-code': { rows: 0, amount: 0 }, 'no-mof-match': { rows: 0, amount: 0 } }
  );
  const unmatchedMofAmount = unmatchedMof.reduce((s, u) => s + u.amount, 0);
  // 補正予算の目額は「改予算額」（その号成立後の全体像）なので当初と足すと二重計上になる。予算種別ごとに分けて持つ
  const kouMokuAmountByBudgetType: Partial<Record<MOFBudgetType, { total: number; linked: number; items: number; itemsLinked: number }>> = {};
  for (const it of kouMokuItems) {
    const e = (kouMokuAmountByBudgetType[it.budgetType] ??= { total: 0, linked: 0, items: 0, itemsLinked: 0 });
    e.total += it.amount;
    e.items++;
    if (linkedKouMokuKeys.has(it.key)) {
      e.linked += it.amount;
      e.itemsLinked++;
    }
  }

  const linkedProjects = new Set(links.map(l => l.projectId));
  const linkedKouMoku = new Set(links.map(l => l.kouMokuKey));
  const projects = [...projectTotals.values()].sort((a, b) => b.rsAmountTotal - a.rsAmountTotal);

  const scope = REQUEST_MODE
    ? `一般会計・特別会計。RSシート${SHEET_YEAR}の予算年度${SHEET_YEAR}行にある翌年度（${BUDGET_YEAR}年度）要求額を、MOF ${BUDGET_YEAR}年度当初予算の目に突き合わせた「要求→査定」対比。rsAmount は要求額であり予算額ではない`
    : `一般会計・特別会計・当初予算＋補正予算（決算は同一識別子で予算側から引き継ぎ）。RSシート${SHEET_YEAR}の予算年度${BUDGET_YEAR}行を使用`;

  const output: MofRsKouMokuLinkageData = {
    metadata: {
      budgetYear: BUDGET_YEAR,
      rsYear: SHEET_YEAR,
      rsSheetYear: SHEET_YEAR,
      rsAmountKind: REQUEST_MODE ? 'request' : 'budget',
      mofEraLabel: kouMokuData.metadata.eraLabel,
      scope,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      counts: {
        links: links.length,
        kouMokuTotal: kouMokuItems.length + settlementItems.length,
        kouMokuLinked: linkedKouMoku.size,
        projectTotal: projectTotals.size,
        projectLinked: linkedProjects.size,
        rowsTotal: targetRows,
        rowsLinked: linkedRows,
        ambiguousLinks: links.filter(l => l.ambiguous).length,
        carriedOverLinks: carriedOverCount,
      },
      coverage: {
        rsAmountTotal: totalAmount,
        rsAmountLinked: linkedAmount,
        rsAmountNoSubject: noSubjectAmount,
        kouMokuAmountByBudgetType,
      },
      unmatched: {
        rs: {
          pairs: unmatchedRs.length,
          byReason: unmatchedRsByReason,
          top: unmatchedRs.slice(0, 50),
        },
        mof: {
          items: unmatchedMof.length,
          amount: unmatchedMofAmount,
          top: unmatchedMof.slice(0, 50),
        },
        file: path.basename(UNMATCHED_FILE),
      },
      notes: [
        '一般会計は所管×組織・勘定×項×目、特別会計は所管×会計×勘定×項×目の完全一致キーで直接突き合わせている（名前照合・語幹一致は使わない）',
        'RS の 2-2 CSV はこれらをMOFの科目別内訳と同じ語彙で持つため、この紐づけに誤検出は原理上ない',
        'RSの「第N次補正予算」はMOFの「補正予算（第N号）」に対応づけている',
        '「前年度から繰越し」「予備費等N」はRS側に所管/組織・勘定/項/目が記録されていないため突合対象外。事業ごとの合計を projects[].rsAmountNoSubject に保持する',
        'RSシートは自年度の行にしか項・目をほぼ完全には持たない（前年度行は前年度シートから引き継がれた場合のみ）。予算年度2023以前の行は旧様式で項・目が半分以上空欄',
        '1つの目に複数のRS事業が計上されることがある（N対N）。rsAmountは同一事業・同一目内の合算',
        '名前一致キーが同じで項・目コードが異なる目が複数ある場合、RS金額を目額比で按分し ambiguous=true を付ける（以前は最後の1件で上書きしていた）',
        '政府関係機関はRSの会計区分に該当値が無いため対象外',
        `未一致はRS側（unmatched.rs: 項・目が空欄の行と、項・目はあるがMOFに同名キーが無い行）とMOF側（unmatched.mof: RS事業が1件も付かない目）に分けて集計。全件は ${path.basename(UNMATCHED_FILE)}（ローカル生成・Git管理外）`,
        ...(REQUEST_MODE
          ? ['要求モード: rsAmount は翌年度要求額。kouMokuAmount（MOF当初予算）との差が査定結果。補正行の要求額は全て0のため当初予算行のみ使用']
          : [
              `決算目はRSが項目別の決算・執行額を持たないため直接一致できず、同一識別子（会計区分・所管・組織/特会・勘定・項コード・目分類コード・目名。予算種別を除く）を持つ当初/補正予算側リンクから rsAmount をそのまま引き継いでいる（carriedOverFrom で判別可能・${carriedOverCount.toLocaleString()}件）。この rsAmount は決算額に対する実際のRS計上額ではなく推定である点に注意`,
            ]),
      ],
    },
    projects,
    links,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 1));
  fs.writeFileSync(
    UNMATCHED_FILE,
    JSON.stringify({ metadata: { budgetYear: BUDGET_YEAR, rsSheetYear: SHEET_YEAR, generatedAt: output.metadata.generatedAt }, unmatchedRs, unmatchedMof }, null, 1)
  );
  const size = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0);
  console.log(`  ✅ ${path.basename(OUTPUT_FILE)} (${size} KB)`);
  console.log(`  ✅ ${path.basename(UNMATCHED_FILE)} (${(fs.statSync(UNMATCHED_FILE).size / 1024).toFixed(0)} KB, Git管理外)`);
  console.log(`\n  リンク: ${links.length.toLocaleString()} 件（按分 ${output.metadata.counts.ambiguousLinks.toLocaleString()} 件・決算引き継ぎ ${carriedOverCount.toLocaleString()} 件）`);
  console.log(`  行カバレッジ: ${linkedRows.toLocaleString()} / ${targetRows.toLocaleString()} 行 (${((linkedRows / Math.max(1, targetRows)) * 100).toFixed(1)}%)`);
  console.log(`  事業カバレッジ: ${linkedProjects.size.toLocaleString()} / ${projectTotals.size.toLocaleString()} 事業`);
  console.log(`  RS金額カバレッジ: ${(linkedAmount / 1e12).toFixed(2)} / ${(totalAmount / 1e12).toFixed(2)} 兆円 (${((linkedAmount / Math.max(1, totalAmount)) * 100).toFixed(1)}%)`);
  for (const [bt, e] of Object.entries(kouMokuAmountByBudgetType)) {
    console.log(`  MOF目カバレッジ（${bt}）: ${e.itemsLinked.toLocaleString()} / ${e.items.toLocaleString()} 目、${(e.linked / 1e12).toFixed(2)} / ${(e.total / 1e12).toFixed(2)} 兆円 (${((e.linked / Math.max(1, e.total)) * 100).toFixed(1)}%)`);
  }
  void unmatchedMofAmount;
  console.log(`  RS未一致: 項・目空欄 ${unmatchedRsByReason['rs-no-subject-code'].rows.toLocaleString()} 行 / ${(unmatchedRsByReason['rs-no-subject-code'].amount / 1e12).toFixed(2)} 兆円、MOFに同名キー無し ${unmatchedRsByReason['no-mof-match'].rows.toLocaleString()} 行 / ${(unmatchedRsByReason['no-mof-match'].amount / 1e12).toFixed(2)} 兆円`);
}

main();
