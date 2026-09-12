#!/usr/bin/env npx tsx
/**
 * MOF予算データの正準統合JSON生成スクリプト。
 *
 * 既存の3系統の生成物（mof-jikou-{年度}.json・mof-kou-moku-{年度}.json・
 * mof-section-pages-{年度}.json）を、項を頂点に事項・目を子として持つ1本の
 * 階層JSON（mof-budget-{年度}.json）へ統合する。スクレイピング・CSV解析自体は
 * 行わない（それぞれの生成スクリプトを先に実行しておくこと）。
 *
 * 設計: types/mof-budget.ts、docs/tasks/20260828_1719_MOF予算データの階層JSONスキーマ案.md
 *
 * 使用法:
 *   tsx scripts/generate-mof-budget-data.ts [FISCAL_YEAR...]
 *   デフォルト: 2017〜2026（10年度分）
 *
 * 出力:
 *   public/data/mof-budget-{FISCAL_YEAR}.json
 *   public/data/mof-budget-descriptions-{FISCAL_YEAR}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MOFAccountType, MOFBudgetType } from '@/types/mof-jikou';
import type { MOFJikouData } from '@/types/mof-jikou';
import type { MOFKouMokuData } from '@/types/mof-kou-moku';
import type { MOFSectionPageData } from '@/types/mof-section-pages';
import type { MOFBudgetData, MOFDescriptionData, MOFJikouLeaf, MOFKouMokuLeaf, MOFSection } from '@/types/mof-budget';

const DEFAULT_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const DATA_DIR = path.join(process.cwd(), 'public', 'data');

function readJson<T>(fileName: string): T | null {
  const p = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
}

/** 特別会計名の接尾辞を外す。事項別内訳（Web帳票）は「〜特別会計」付き、科目別内訳（CSV）は無し */
function normSpecialAccount(s: string): string {
  return s.replace(/特別会計$/, '');
}

/** 突合用の文字列正規化: NFKC + 空白除去 */
function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

function sectionKey(
  accountType: string,
  budgetType: string,
  ministry: string,
  org: string,
  subAccount: string,
  sectionCode: string
): string {
  return [accountType, budgetType, ministry, org, subAccount, sectionCode].join('|');
}

function pageLookupKey(
  accountType: string,
  budgetType: string,
  ministry: string,
  org: string,
  subAccount: string,
  sectionName: string
): string {
  return [accountType, budgetType, norm(ministry), norm(org), norm(subAccount), norm(sectionName)].join('|');
}

interface SectionBuild extends Omit<MOFSection, 'jikou' | 'koumoku'> {
  jikou: MOFJikouLeaf[];
  koumoku: MOFKouMokuLeaf[];
}

function ensureSection(
  sections: Map<string, SectionBuild>,
  accountType: MOFAccountType,
  budgetType: MOFBudgetType,
  ministry: string,
  org: string,
  subAccount: string,
  sectionCode: string,
  sectionName: string,
  organization: string,
  specialAccount: string,
  agency: string
): SectionBuild {
  const key = sectionKey(accountType, budgetType, ministry, org, subAccount, sectionCode);
  const existing = sections.get(key);
  if (existing) return existing;
  const row: SectionBuild = {
    id: key,
    accountType,
    budgetType,
    ministry,
    organization,
    specialAccount,
    subAccount,
    agency,
    sectionCode,
    sectionName,
    amount: 0,
    previousAmount: null,
    difference: null,
    page: null,
    sourceUrl: '',
    jikou: [],
    koumoku: [],
  };
  sections.set(key, row);
  return row;
}

function generateYear(fiscalYear: number): void {
  const jikouData = readJson<MOFJikouData>(`mof-jikou-${fiscalYear}.json`);
  const kouMokuData = readJson<MOFKouMokuData>(`mof-kou-moku-${fiscalYear}.json`);
  if (!jikouData || !kouMokuData) {
    console.warn(`  ⚠️  ${fiscalYear}年度: mof-jikou・mof-kou-mokuのどちらかが無いためスキップします。`);
    return;
  }
  const sectionPages = readJson<MOFSectionPageData>(`mof-section-pages-${fiscalYear}.json`);

  console.log(`\n=== ${kouMokuData.metadata.eraLabel}（${fiscalYear}） 統合 ===`);

  const sections = new Map<string, SectionBuild>();

  for (const it of jikouData.items) {
    const org =
      it.accountType === 'general' ? it.organization : it.accountType === 'special' ? normSpecialAccount(it.specialAccount) : it.agency;
    const row = ensureSection(
      sections,
      it.accountType,
      it.budgetType,
      it.ministry,
      org,
      it.subAccount,
      it.sectionCode,
      it.sectionName,
      it.accountType === 'general' ? it.organization : '',
      it.accountType === 'special' ? normSpecialAccount(it.specialAccount) : '',
      it.accountType === 'agency' ? it.agency : ''
    );
    row.jikou.push({
      id: it.id,
      name: it.name,
      majorExpenseCode: it.majorExpenseCode,
      majorExpenseName: it.majorExpenseName,
      amount: it.amount,
      previousAmount: it.previousAmount,
      difference: it.difference,
      currentAmount: it.currentAmount,
      spent: it.spent,
      carriedOver: it.carriedOver,
      unused: it.unused,
      documentId: it.documentId,
      page: it.page,
      sourceUrl: it.sourceUrl,
    });
  }

  for (const it of kouMokuData.items) {
    const org =
      it.accountType === 'general' ? it.organization : it.accountType === 'special' ? normSpecialAccount(it.specialAccount) : it.agency;
    const row = ensureSection(
      sections,
      it.accountType,
      it.budgetType,
      it.ministry,
      org,
      it.subAccount,
      it.sectionCode,
      it.sectionName,
      it.accountType === 'general' ? it.organization : '',
      it.accountType === 'special' ? normSpecialAccount(it.specialAccount) : '',
      it.accountType === 'agency' ? it.agency : ''
    );
    row.koumoku.push({
      id: it.id,
      subItemCode: it.subItemCode,
      subItemName: it.subItemName,
      majorExpenseCode: it.majorExpenseCode,
      majorExpenseName: it.majorExpenseName,
      objectiveCode: it.objectiveCode,
      objectiveName: it.objectiveName,
      fiscalLawCode: it.fiscalLawCode,
      fiscalLawName: it.fiscalLawName,
      economicNatureCode: it.economicNatureCode,
      economicNatureName: it.economicNatureName,
      purposeCode: it.purposeCode,
      purposeName: it.purposeName,
      amount: it.amount,
      previousAmount: it.previousAmount,
      difference: it.difference,
      currentAmount: it.currentAmount,
      spent: it.spent,
      carriedOver: it.carriedOver,
      unused: it.unused,
      documentId: it.documentId,
      page: it.page,
      // page が無いときは帳票トップURLでは埋めない（飛んでも検索できずノイズになるため）
      sourceUrl: it.page !== null ? it.sourceUrl : '',
    });
  }

  // 項自体の出典ページ（甲号歳入歳出予算等）を名前一致で突合
  if (sectionPages) {
    const pageLookup = new Map<string, SectionBuild>();
    for (const row of sections.values()) {
      const org =
        row.accountType === 'general' ? row.organization : row.accountType === 'special' ? normSpecialAccount(row.specialAccount) : row.agency;
      const key = pageLookupKey(row.accountType, row.budgetType, row.ministry, org, row.subAccount, row.sectionName);
      if (!pageLookup.has(key)) pageLookup.set(key, row); // 同名衝突は最初の1件のみ対象
    }
    for (const entry of sectionPages.entries) {
      const org =
        entry.accountType === 'general' ? entry.organization : entry.accountType === 'special' ? normSpecialAccount(entry.specialAccount) : entry.agency;
      const key = pageLookupKey(entry.accountType, entry.budgetType, entry.ministry, org, entry.subAccount, entry.sectionName);
      const row = pageLookup.get(key);
      if (row && row.page === null) {
        row.page = entry.page;
        row.sourceUrl = entry.sourceUrl;
      }
    }
  }

  // 項の金額は目側合計（事項側合計とほぼ一致することを実測済み。docs/tasks参照）。
  // 目が1件も無い項（事項側にしか計上が無い項。年度によって少数存在）は目側合計が0に
  // なってしまうため、事項側合計にフォールバックする
  for (const row of sections.values()) {
    const useJikou = row.koumoku.length === 0 && row.jikou.length > 0;
    const breakdown = useJikou ? row.jikou : row.koumoku;
    row.amount = breakdown.reduce((sum, i) => sum + i.amount, 0);
    const hasAllPrevious = breakdown.length > 0 && breakdown.every(i => i.previousAmount !== null);
    row.previousAmount = hasAllPrevious ? breakdown.reduce((sum, i) => sum + (i.previousAmount ?? 0), 0) : null;
    row.difference = row.previousAmount === null ? null : row.amount - row.previousAmount;
  }

  const sectionList: MOFSection[] = [...sections.values()];
  const accountTypes = [...new Set(sectionList.map(s => s.accountType))];
  const budgetTypes = [...new Set([...jikouData.metadata.budgetTypes, ...kouMokuData.metadata.budgetTypes])];

  const data: MOFBudgetData = {
    metadata: {
      fiscalYear,
      eraLabel: kouMokuData.metadata.eraLabel,
      accountTypes,
      budgetTypes,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      notes: [
        '事項（目的別内訳）と目（性質別内訳）は項の下に並列にぶら下がる別系統の内訳で、対応表はありません',
        '項の本年度額・前年度額・増減額は目（kou-moku）側の合計です（事項側の合計とほぼ一致することを実測済み。不一致は東日本大震災復興特別会計のごく一部のみ）',
        '項自体の出典ページは「甲号歳入歳出予算」等の別帳票（項コードを持たないため名前一致でのみ突合）から取得しています。突合できない項はpage=nullです',
        '事項の説明（所掌事務・根拠法等）は本体には含めず mof-budget-descriptions-{年度}.json に分離しています（id で参照）',
        'この統合ファイルはmof-jikou-{年度}.json・mof-kou-moku-{年度}.json・mof-section-pages-{年度}.jsonから機械的に組み立てたもので、独自のスクレイピング・解析は行っていません',
      ],
    },
    sections: sectionList,
  };

  const descriptions: MOFDescriptionData = {};
  for (const it of jikouData.items) {
    if (it.description) descriptions[it.id] = it.description;
  }

  const outputFile = path.join(DATA_DIR, `mof-budget-${fiscalYear}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 1));
  const descFile = path.join(DATA_DIR, `mof-budget-descriptions-${fiscalYear}.json`);
  fs.writeFileSync(descFile, JSON.stringify(descriptions, null, 1));

  console.log(`  項: ${sectionList.length.toLocaleString()}件（事項${jikouData.items.length.toLocaleString()}件・目${kouMokuData.items.length.toLocaleString()}件）`);
  console.log(`  説明: ${Object.keys(descriptions).length.toLocaleString()}件`);
  console.log(`  出力: ${path.basename(outputFile)}, ${path.basename(descFile)}`);
}

function main(): void {
  const years = process.argv.length > 2 ? process.argv.slice(2).map(v => parseInt(v, 10)) : DEFAULT_YEARS;
  if (years.some(y => isNaN(y) || y < 2000 || y > 2100)) {
    console.error(`Invalid fiscal year: ${process.argv.slice(2).join(' ')}`);
    process.exit(1);
  }
  console.log(`=== MOF予算データ統合（対象: ${years.join(', ')}） ===`);
  for (const year of years) generateYear(year);
  console.log(`\n完了: ${years.length} 年度分を生成しました。`);
}

main();
