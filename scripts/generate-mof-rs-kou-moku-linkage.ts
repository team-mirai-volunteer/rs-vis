/**
 * MOF目（科目別内訳） ↔ RS事業 紐づけデータ生成スクリプト。
 *
 * `generate-mof-rs-linkage.ts`（事項＝目的別）と対になる、目＝性質別の紐づけ。
 * RS の `2-2_予算・執行_予算種別・歳出予算項目` は 所管/組織・勘定/項/目（一般会計）・
 * 所管/会計/勘定/項/目（特別会計）を MOF の科目別内訳（mof-kou-moku-{年度}.json）と
 * 同じ語彙で持つため、名前照合や構造キーでの絞り込みは不要で、完全一致キーで
 * 直接突き合わせられる（実測: 一般会計・当初予算でRS行の92.7%・金額の97.9%、
 * 特別会計・当初予算で行の86.6%・金額の98.9%が一致。
 * docs/tasks/20260826_0809_項の単独事項構造による紐づけ拡張の調査.md 参照）。
 *
 * 一般会計はRSの `所管/組織・勘定` が MOF の `ministry/organization` に、
 * 特別会計はRSの `所管/会計/勘定` が MOF の `ministry/specialAccount/subAccount` に
 * それぞれ対応する（RSの `組織・勘定` 列は特別会計だと `勘定` と重複するため使わない）。
 * 政府関係機関はRSの `会計区分` に該当値が無く対象外。
 *
 * 予算種別は「当初予算」に加え「第N次補正予算」（RS）↔「補正予算（第N号）」（MOF）を対象にする
 * （実測: 第1次補正予算で行の94.4%・金額の88.5%が一致）。「前年度から繰越し」「予備費等N」は
 * **RS側に所管/組織・勘定/項/目が記録されていない**（値が空欄）ため原理的に突合不可能で対象外
 * （実測で確認済み。歳出予算項目ごとの内訳ではなく予算額の合計だけが記録されている）。
 *
 * 使用法:
 *   tsx scripts/generate-mof-rs-kou-moku-linkage.ts [RS_YEAR]
 *   例: tsx scripts/generate-mof-rs-kou-moku-linkage.ts 2025
 *   デフォルト: 2025（RS事業年度。予算年度・MOF会計年度はその前年）
 *
 * 入力:
 *   public/data/mof-kou-moku-{予算年度}.json  … MOF目（一般会計・特別会計・当初予算＋補正予算のみ使用）
 *   data/year_{RS_YEAR}/1-1 … 予算事業ID → 事業名・府省庁
 *   data/year_{RS_YEAR}/2-2 … 予算事業ID → 歳出予算科目（所管/会計/勘定/組織・勘定/項/目/予算種別）
 *
 * 出力: public/data/mof-rs-kou-moku-linkage-{予算年度}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from '@/scripts/csv-reader';
import type { CSVRow } from '@/types/rs-system';
import type { MOFBudgetType, MOFKouMokuData, MOFKouMokuItem } from '@/types/mof-kou-moku';
import { MOF_REVISION_NUMBERS, revisedBudgetType } from '@/types/mof-jikou';
import type { MofRsKouMokuLinkageData, MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';

/**
 * RS側の予算種別表記からMOF側の予算種別を解決する。
 * 対応が無い種別（前年度から繰越し・予備費等N・空欄）は null を返し、呼び出し側で除外する。
 */
function resolveMofBudgetType(rsBudgetType: string): MOFBudgetType | null {
  if (rsBudgetType === '当初予算') return '当初予算';
  const m = /^第(\d+)次補正予算$/.exec(rsBudgetType);
  if (m) {
    const n = Number(m[1]);
    const revision = MOF_REVISION_NUMBERS.find(r => r === n);
    if (revision) return revisedBudgetType(revision);
  }
  return null;
}

// ─── 年度設定 ──────────────────────────────────────────────
const RS_YEAR = parseInt(process.argv[2] || '2025', 10);
if (isNaN(RS_YEAR) || RS_YEAR < 2000 || RS_YEAR > 2100) {
  console.error(`Invalid year: ${process.argv[2]}`);
  process.exit(1);
}
/** 予算年度 = MOF会計年度。RS事業年度シートは前年度の予算・執行を記録する */
const BUDGET_YEAR = RS_YEAR - 1;

const DATA_DIR = path.join(__dirname, `../data/year_${RS_YEAR}`);
const OUTPUT_DIR = path.join(__dirname, '../public/data');
const KOU_MOKU_FILE = path.join(OUTPUT_DIR, `mof-kou-moku-${BUDGET_YEAR}.json`);
const OUTPUT_FILE = path.join(OUTPUT_DIR, `mof-rs-kou-moku-linkage-${BUDGET_YEAR}.json`);

/** 突合用の文字列正規化: NFKC + 空白除去。表記そのものは出力側に生値で残す */
function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

function loadCSV(filename: string): CSVRow[] {
  const filePath = path.join(DATA_DIR, filename);
  console.log(`  読み込み中: ${filename}`);
  const rows = readShiftJISCSV(filePath);
  console.log(`    → ${rows.length.toLocaleString()} 行`);
  return rows;
}

function main() {
  console.log(`=== MOF目↔RS事業 紐づけデータ生成 (予算年度${BUDGET_YEAR} / RS_${RS_YEAR}) ===\n`);

  // 1. MOF目（一般会計）
  console.log('[1/4] MOF目読み込み');
  if (!fs.existsSync(KOU_MOKU_FILE)) {
    console.error(`❌ ${KOU_MOKU_FILE} がありません。generate-mof-kou-moku-data.ts を先に実行してください。`);
    process.exit(1);
  }
  const kouMokuData: MOFKouMokuData = JSON.parse(fs.readFileSync(KOU_MOKU_FILE, 'utf-8'));
  /** 対象とする予算種別: 当初予算 + 存在する号数ぶんの補正予算 */
  const supportedBudgetTypes = new Set<MOFBudgetType>(['当初予算', ...MOF_REVISION_NUMBERS.map(revisedBudgetType)]);
  const kouMokuItems = kouMokuData.items.filter(
    it => (it.accountType === 'general' || it.accountType === 'special') && supportedBudgetTypes.has(it.budgetType)
  );
  for (const budgetType of [...supportedBudgetTypes]) {
    const count = kouMokuItems.filter(i => i.budgetType === budgetType).length;
    if (count > 0) console.log(`  ${budgetType}の目（一般会計＋特別会計）: ${count.toLocaleString()} 件`);
  }

  /**
   * 完全一致キー。予算種別ごとに分けて持つ（一般会計は 所管|組織|項名|目名、
   * 特別会計は 所管|会計|勘定|項名|目名。異なる予算種別で同じ項×目キーが
   * 再利用されることがあるため、budgetTypeを先頭に含めて衝突を避ける）。
   */
  const kouMokuByKey = new Map<string, MOFKouMokuItem>();
  let keyCollisions = 0;
  for (const it of kouMokuItems) {
    const key =
      it.accountType === 'general'
        ? [it.budgetType, norm(it.ministry), norm(it.organization), norm(it.sectionName), norm(it.subItemName)].join('|')
        : [
            it.budgetType,
            norm(it.ministry),
            norm(it.specialAccount),
            norm(it.subAccount),
            norm(it.sectionName),
            norm(it.subItemName),
          ].join('|');
    const existing = kouMokuByKey.get(key);
    if (existing && (existing.sectionCode !== it.sectionCode || existing.subItemCode !== it.subItemCode)) {
      keyCollisions++;
      console.warn(`  ⚠ 突合キーの衝突（項・目コードが異なるのに名前一致キーが同じ）: ${key}`);
    }
    kouMokuByKey.set(key, it); // 同一キーが複数ある場合は最後の1件のみRS突合の対象になる
  }
  if (keyCollisions > 0) {
    console.log(`  突合キー衝突: ${keyCollisions.toLocaleString()} 件（コード相違・要確認）`);
  }

  // 2. RS側: 事業マスタ + 歳出予算科目
  console.log('\n[2/4] RS CSV読み込み');
  const orgRows = loadCSV(`1-1_RS_${RS_YEAR}_基本情報_組織情報.csv`);
  const budgetItemRows = loadCSV(`2-2_RS_${RS_YEAR}_予算・執行_予算種別・歳出予算項目.csv`);

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
  console.log('\n[3/4] 完全一致キーで突合');
  const linkMap = new Map<string, MofRsKouMokuLinkageRecord>(); // `${pid}|${kouMokuKey}` → record
  let targetRows = 0;
  let linkedRows = 0;
  let totalAmount = 0;
  let linkedAmount = 0;
  const totalProjects = new Set<number>();

  let skippedNoBudgetTypeMapping = 0;
  for (const row of budgetItemRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid) || !projectMap.has(pid)) continue;
    if (parseInt(row['予算年度'], 10) !== BUDGET_YEAR) continue;
    const accountCategory = (row['会計区分'] || '').trim();
    if (accountCategory !== '一般会計' && accountCategory !== '特別会計') continue;
    const mofBudgetType = resolveMofBudgetType((row['予算種別'] || '').trim());
    if (!mofBudgetType) {
      skippedNoBudgetTypeMapping++;
      continue; // 前年度から繰越し・予備費等N等（RS側に所管/組織・勘定/項/目が無く突合不可能）
    }
    targetRows++;
    totalProjects.add(pid);
    const amount = parseAmount(row['予算額(歳出予算項目ごと)']);
    totalAmount += amount;

    // 一般会計: 所管|組織・勘定|項|目、特別会計: 所管|会計|勘定|項|目
    // （特別会計の「組織・勘定」は「勘定」と重複するため使わず、会計/勘定を個別に使う）
    const key =
      accountCategory === '一般会計'
        ? [mofBudgetType, norm(row['所管'] || ''), norm(row['組織・勘定'] || ''), norm(row['項'] || ''), norm(row['目'] || '')].join('|')
        : [
            mofBudgetType,
            norm(row['所管'] || ''),
            norm(row['会計'] || ''),
            norm(row['勘定'] || ''),
            norm(row['項'] || ''),
            norm(row['目'] || ''),
          ].join('|');
    const kouMoku = kouMokuByKey.get(key);
    if (!kouMoku) continue;

    linkedRows++;
    linkedAmount += amount;
    const project = projectMap.get(pid)!;
    const pairKey = `${pid}|${kouMoku.key}`;
    const existing = linkMap.get(pairKey);
    if (existing) {
      existing.rsAmount += amount;
    } else {
      linkMap.set(pairKey, {
        projectId: pid,
        projectName: project.name,
        projectMinistry: project.ministry,
        kouMokuKey: kouMoku.key,
        mofAccountType: kouMoku.accountType,
        mofBudgetType: kouMoku.budgetType,
        mofMinistry: kouMoku.ministry,
        mofOrganization: kouMoku.accountType === 'special' ? kouMoku.specialAccount : kouMoku.organization,
        mofSubAccount: kouMoku.subAccount,
        sectionCode: kouMoku.sectionCode,
        sectionName: kouMoku.sectionName,
        subItemCode: kouMoku.subItemCode,
        subItemName: kouMoku.subItemName,
        kouMokuAmount: kouMoku.amount,
        rsAmount: amount,
      });
    }
  }
  console.log(`  対象行（予算年度${BUDGET_YEAR}・一般会計＋特別会計・当初予算＋補正予算）: ${targetRows.toLocaleString()} 行`);
  console.log(`  対象外（前年度繰越・予備費等など突合不可能な予算種別）: ${skippedNoBudgetTypeMapping.toLocaleString()} 行`);
  console.log(`  完全一致: ${linkedRows.toLocaleString()} 行 → ${linkMap.size.toLocaleString()} ペア（事業×目）`);

  // 3.5. 決算目への引き継ぎ
  //
  // RSは決算・執行実績を目単位で持たない（2-2 CSVの予算種別は当初/補正/繰越/予備費のみ）ため、
  // 決算目を直接キー一致させることはできない。一方で決算目と予算側（当初・補正）の目は
  // 同一の識別子（会計区分・所管・組織/特会・勘定・項コード・目分類コード・目名。予算種別を
  // 除く）を共有することが多い（`/mof-kou-moku` の年度推移機能と同じ前提）。この識別子で
  // 予算側の既存リンクを決算目に引き継ぐ。
  console.log('\n[3.5/4] 決算目への引き継ぎ');

  /** 予算種別を除いた識別子（引き継ぎ専用。既存リンクのmof*フィールドから作る） */
  function carryoverIdentity(
    accountType: string,
    ministry: string,
    orgOrSpecial: string,
    subAccount: string,
    sectionCode: string,
    subItemCode: string,
    subItemName: string
  ): string {
    return [accountType, norm(ministry), norm(orgOrSpecial), norm(subAccount), sectionCode, subItemCode, norm(subItemName)].join(
      '|'
    );
  }

  // 識別子 → 予算側リンクのうち代表1件/pid（同一pidが当初・補正の両方にリンクしていれば金額の大きい方を採用）
  const budgetLinksByIdentity = new Map<string, Map<number, MofRsKouMokuLinkageRecord>>();
  for (const link of linkMap.values()) {
    const identity = carryoverIdentity(
      link.mofAccountType,
      link.mofMinistry,
      link.mofOrganization,
      link.mofSubAccount,
      link.sectionCode,
      link.subItemCode,
      link.subItemName
    );
    const byPid = budgetLinksByIdentity.get(identity) ?? new Map<number, MofRsKouMokuLinkageRecord>();
    const existing = byPid.get(link.projectId);
    if (!existing || link.rsAmount > existing.rsAmount) byPid.set(link.projectId, link);
    budgetLinksByIdentity.set(identity, byPid);
  }

  const settlementItems = kouMokuData.items.filter(
    it => (it.accountType === 'general' || it.accountType === 'special') && it.budgetType === '決算'
  );
  let carriedOverCount = 0;
  for (const it of settlementItems) {
    const identity = carryoverIdentity(
      it.accountType,
      it.ministry,
      it.accountType === 'special' ? it.specialAccount : it.organization,
      it.subAccount,
      it.sectionCode,
      it.subItemCode,
      it.subItemName
    );
    const byPid = budgetLinksByIdentity.get(identity);
    if (!byPid) continue;
    for (const source of byPid.values()) {
      const pairKey = `${source.projectId}|${it.key}`;
      if (linkMap.has(pairKey)) continue; // 決算目自体が万一直接一致していれば上書きしない
      linkMap.set(pairKey, {
        projectId: source.projectId,
        projectName: source.projectName,
        projectMinistry: source.projectMinistry,
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
        rsAmount: source.rsAmount,
        carriedOverFrom: source.mofBudgetType,
      });
      carriedOverCount++;
    }
  }
  console.log(`  決算目: ${settlementItems.length.toLocaleString()} 件中 ${carriedOverCount.toLocaleString()} 件に予算側リンクを引き継ぎ`);

  // 4. 出力
  console.log('\n[4/4] 出力');
  const links = [...linkMap.values()].sort((a, b) => b.rsAmount - a.rsAmount);
  const linkedProjects = new Set(links.map(l => l.projectId));
  const linkedKouMoku = new Set(links.map(l => l.kouMokuKey));

  const output: MofRsKouMokuLinkageData = {
    metadata: {
      budgetYear: BUDGET_YEAR,
      rsYear: RS_YEAR,
      mofEraLabel: kouMokuData.metadata.eraLabel,
      scope: '一般会計・特別会計・当初予算＋補正予算（決算は同一識別子で予算側から引き継ぎ）',
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      counts: {
        links: links.length,
        kouMokuTotal: kouMokuItems.length + settlementItems.length,
        kouMokuLinked: linkedKouMoku.size,
        projectTotal: totalProjects.size,
        projectLinked: linkedProjects.size,
        rowsTotal: targetRows,
        rowsLinked: linkedRows,
      },
      coverage: {
        rsAmountTotal: totalAmount,
        rsAmountLinked: linkedAmount,
      },
      notes: [
        '一般会計は所管×組織・勘定×項×目、特別会計は所管×会計×勘定×項×目の完全一致キーで直接突き合わせている（名前照合・語幹一致は使わない）',
        'RS の 2-2 CSV はこれらをMOFの科目別内訳と同じ語彙で持つため、この紐づけに誤検出は原理上ない',
        'RSの「第N次補正予算」はMOFの「補正予算（第N号）」に対応づけている',
        '「前年度から繰越し」「予備費等N」はRS側に所管/組織・勘定/項/目が記録されていないため対象外（実測で確認済み）',
        '1つの目に複数のRS事業が計上されることがある（N対N）。rsAmountは同一事業・同一目内の合算',
        '政府関係機関はRSの会計区分に該当値が無いため対象外',
        '一致しない行（金額の数%）は主に組織名・目名の表記差やRS側の独自科目が原因（要精査）',
        `決算目はRSが項目別の決算・執行額を持たないため直接一致できず、同一識別子（会計区分・所管・組織/特会・勘定・項コード・目分類コード・目名。予算種別を除く）を持つ当初/補正予算側リンクから rsAmount をそのまま引き継いでいる（carriedOverFrom で判別可能・${carriedOverCount.toLocaleString()}件）。この rsAmount は決算額に対する実際のRS計上額ではなく推定である点に注意`,
      ],
    },
    links,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 1));
  const size = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0);
  console.log(`  ✅ ${path.basename(OUTPUT_FILE)} (${size} KB)`);
  console.log(`\n  リンク: ${links.length.toLocaleString()} 件`);
  console.log(`  行カバレッジ: ${linkedRows.toLocaleString()} / ${targetRows.toLocaleString()} 行` +
    ` (${(linkedRows / targetRows * 100).toFixed(1)}%)`);
  console.log(`  事業カバレッジ: ${linkedProjects.size.toLocaleString()} / ${totalProjects.size.toLocaleString()} 事業`);
  console.log(`  金額カバレッジ: ${(linkedAmount / 1e12).toFixed(2)} / ${(totalAmount / 1e12).toFixed(2)} 兆円` +
    ` (${(linkedAmount / totalAmount * 100).toFixed(1)}%)`);
  console.log(`  目カバレッジ: ${linkedKouMoku.size.toLocaleString()} / ${kouMokuItems.length.toLocaleString()} 目`);
}

main();
