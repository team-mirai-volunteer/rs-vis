/**
 * 項レベルの集計。正準データ `mof-budget-{年度}.json`（項を頂点に事項・目を子として持つ
 * 統合JSON。generate-mof-budget-data.ts が事項別内訳・科目別内訳・項の出典ページを
 * 事前に結合したもの）を読み、RS紐づけ（`mof-rs-kou-moku-linkage`）だけをリクエスト時に
 * 上乗せする。RS紐づけは更新サイクルがMOFデータと独立しているため、静的ファイルには
 * 焼き込まず実行時オーバーレイのままにしている。
 */

import type { MOFBudgetType } from '@/types/mof-jikou';
import type { MOFJikouItem } from '@/types/mof-jikou';
import type { MOFKouMokuAccountType, MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import type { MOFBudgetData, MOFDescriptionData, MOFJikouLeaf, MOFKouMokuLeaf, MOFSection } from '@/types/mof-budget';
import type { MOFKouData, MOFKouSectionDetail, MOFKouSectionHistory, MOFKouSectionHistoryYear, MOFKouSectionSummary } from '@/types/mof-kou';
import { resolveLinks } from './mof-rs-kou-moku-linkage-loader';
import { dataFileExists, readDataJson, tryReadDataJson } from './data-file';

/** 特別会計名の接尾辞を外す。事項別内訳（Web帳票）は「〜特別会計」付き、科目別内訳（CSV）は無し */
function normSpecialAccount(s: string): string {
  return s.replace(/特別会計$/, '');
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

interface SectionAgg extends MOFSection {
  rsLinks: MofRsKouMokuLinkageRecord[];
}

interface BuiltYear {
  fiscalYear: number;
  eraLabel: string;
  budgetTypes: MOFBudgetType[];
  linkage: MOFKouData['metadata']['linkage'];
  sections: Map<string, SectionAgg>;
}

const cache = new Map<number, BuiltYear>();
const CANDIDATE_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017] as const;
let cachedYears: number[] | null = null;

/** 生成済みの年度（新しい順） */
export function availableYears(): number[] {
  if (!cachedYears) cachedYears = CANDIDATE_YEARS.filter(y => dataFileExists(`mof-budget-${y}.json`));
  return cachedYears;
}

function buildYear(fiscalYear: number): BuiltYear {
  const cached = cache.get(fiscalYear);
  if (cached) return cached;

  const budgetData = readDataJson<MOFBudgetData>(
    `mof-budget-${fiscalYear}.json`,
    `npm run generate-mof-budget を実行してください（対象年度: ${fiscalYear}）。`
  );
  const linkage = resolveLinks(fiscalYear);

  const sections = new Map<string, SectionAgg>();
  for (const s of budgetData.sections) {
    sections.set(s.id, { ...s, rsLinks: [] });
  }

  // RS紐づけは一般会計・特別会計のみ（政府関係機関はRSの会計区分に該当値が無く対象外）
  for (const link of linkage.links) {
    const org = link.mofAccountType === 'special' ? normSpecialAccount(link.mofOrganization) : link.mofOrganization;
    const key = sectionKey(link.mofAccountType, link.mofBudgetType, link.mofMinistry, org, link.mofSubAccount, link.sectionCode);
    const row = sections.get(key);
    // 対応する目が必ずmof-budget側に存在するはずだが、無ければ黙って捨てる（不整合を握りつぶさず件数として見えなくするだけ）
    if (row) row.rsLinks.push(link);
  }

  const built: BuiltYear = {
    fiscalYear,
    eraLabel: budgetData.metadata.eraLabel,
    budgetTypes: budgetData.metadata.budgetTypes,
    linkage: {
      available: linkage.available,
      rsYear: null, // ルート層で linkageRsYear() を使って埋める
    },
    sections,
  };
  cache.set(fiscalYear, built);
  return built;
}

/** 項内で金額最大の値を代表値として選ぶ汎用ヘルパ（主要経費・使途別分類で共用） */
function representativeClassification(
  items: MOFKouMokuLeaf[],
  codeOf: (item: MOFKouMokuLeaf) => string,
  nameOf: (item: MOFKouMokuLeaf) => string
): { name: string; mixed: boolean } {
  const byCode = new Map<string, { name: string; amount: number }>();
  for (const it of items) {
    const code = codeOf(it);
    if (!code) continue;
    const existing = byCode.get(code) ?? { name: nameOf(it), amount: 0 };
    existing.amount += it.amount;
    byCode.set(code, existing);
  }
  if (byCode.size === 0) return { name: '', mixed: false };
  const top = [...byCode.values()].sort((a, b) => b.amount - a.amount)[0];
  return { name: top.name, mixed: byCode.size > 1 };
}

function toSummary(row: SectionAgg): MOFKouSectionSummary {
  const majorExpense = representativeClassification(row.koumoku, i => i.majorExpenseCode, i => i.majorExpenseName);
  const purpose = representativeClassification(row.koumoku, i => i.purposeCode, i => i.purposeName);
  return {
    id: row.id,
    accountType: row.accountType,
    budgetType: row.budgetType,
    ministry: row.ministry,
    organization: row.organization,
    specialAccount: row.specialAccount,
    subAccount: row.subAccount,
    agency: row.agency,
    sectionCode: row.sectionCode,
    sectionName: row.sectionName,
    page: row.page,
    sourceUrl: row.sourceUrl,
    majorExpenseName: majorExpense.name,
    majorExpenseMixed: majorExpense.mixed,
    purposeName: purpose.name,
    purposeMixed: purpose.mixed,
    jikouCount: row.jikou.length,
    kouMokuCount: row.koumoku.length,
    detailNames: [...new Set([...row.jikou.map(i => i.name), ...row.koumoku.map(i => i.subItemName)])],
    rsProjectCount: new Set(row.rsLinks.map(l => l.projectId)).size,
    amount: row.amount,
    previousAmount: row.previousAmount,
    difference: row.difference,
  };
}

/**
 * その年度の項一覧（一覧表示用の集計行のみ。事項・目・RS事業の内訳は含まない）。
 * `metadata.linkage.rsYear` はここでは常に null。呼び出し側（route.ts）が
 * mof-rs-kou-moku-linkage-loader.linkageRsYear() で埋める。
 */
export function listSections(fiscalYear: number): MOFKouData {
  const built = buildYear(fiscalYear);
  const sections = [...built.sections.values()].map(toSummary);
  const byAccountType = groupBy(sections, s => s.accountType, s => s.amount);
  const byBudgetType = groupBy(sections, s => s.budgetType, s => s.amount);
  return {
    metadata: {
      fiscalYear: built.fiscalYear,
      eraLabel: built.eraLabel,
      budgetTypes: built.budgetTypes,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      linkage: built.linkage,
      notes: [
        '事項（目的別内訳）と目（性質別内訳）は項の下に並列にぶら下がる別系統の内訳で、対応表はありません。事項数・目数は同じ項を2つの異なる切り口で数えた別々の件数です',
        'RS紐づけ事業数は、目単位の完全一致キー突合（mof-rs-kou-moku-linkage）で紐づいたRS事業の実数（重複除き）です。政府関係機関はRSの会計区分に該当値が無く対象外です',
        '本年度額・前年度額・増減額は目（kou-moku）側の合計です（事項側の合計と一致することを確認済み）',
        '前年度額は項内のいずれかの目で比較対象額が無い場合（決算・暫定予算等）null にしています',
        '主要経費・使途別分類はいずれも項と1対1ではありません（実測: 2024年度でkou-mokuの項の約9%が複数の主要経費を含む）。表示は項内で金額最大のもので、複数混在する場合は「他」を付けています',
        '使途別分類コードは目（kou-moku）にしか無いフィールドのため、事項側の内訳からは算出していません',
        '項自体の出典ページは「甲号歳入歳出予算」等の別帳票（項コードを持たないため名前一致でのみ突合）から取得しています。突合できない項はpage=nullです',
      ],
    },
    summary: {
      count: sections.length,
      byAccountType,
      byBudgetType,
    },
    sections,
  };
}

/** MOFJikouLeaf（項の子要素）から、既存の /mof-jikou と同じ形の MOFJikouItem を復元する */
function hydrateJikou(section: SectionAgg, leaf: MOFJikouLeaf, description: string): MOFJikouItem {
  return {
    id: leaf.id,
    key: [
      section.accountType,
      section.budgetType,
      section.ministry,
      section.organization,
      section.specialAccount,
      section.subAccount,
      section.agency,
      section.sectionCode,
      leaf.name,
    ].join('|'),
    accountType: section.accountType,
    budgetType: section.budgetType,
    documentId: leaf.documentId,
    ministry: section.ministry,
    organization: section.organization,
    specialAccount: section.specialAccount,
    subAccount: section.subAccount,
    agency: section.agency,
    sectionCode: section.sectionCode,
    sectionName: section.sectionName,
    majorExpenseCode: leaf.majorExpenseCode,
    majorExpenseName: leaf.majorExpenseName,
    name: leaf.name,
    amount: leaf.amount,
    previousAmount: leaf.previousAmount,
    difference: leaf.difference,
    currentAmount: leaf.currentAmount,
    spent: leaf.spent,
    carriedOver: leaf.carriedOver,
    unused: leaf.unused,
    description,
    page: leaf.page,
    sourceUrl: leaf.sourceUrl,
  };
}

/** MOFKouMokuLeaf（項の子要素）から、既存の /mof-kou-moku と同じ形の MOFKouMokuItem を復元する */
function hydrateKouMoku(section: SectionAgg, leaf: MOFKouMokuLeaf): MOFKouMokuItem {
  // section.specialAccount は「先に登場したソース（事項・目のどちらか）の生値」を持つため、
  // 事項側が先に登場した項では「〜特別会計」付きになっている（事項別内訳＝Web帳票の慣習）。
  // kou-mokuの元データ（CSVには接尾辞が無い）・RS紐づけのkouMokuKeyと一致させるため、
  // ここでは正規化（接尾辞除去）した値を使う。特別会計名以外に両ソース間の表記差は無い
  const specialAccount = normSpecialAccount(section.specialAccount);
  return {
    id: leaf.id,
    key: [
      section.accountType,
      section.budgetType,
      section.ministry,
      section.organization,
      specialAccount,
      section.subAccount,
      section.agency,
      section.sectionCode,
      leaf.subItemCode,
      leaf.subItemName,
    ].join('|'),
    accountType: section.accountType as MOFKouMokuAccountType,
    budgetType: section.budgetType,
    ministry: section.ministry,
    organization: section.organization,
    specialAccount,
    subAccount: section.subAccount,
    agency: section.agency,
    sectionCode: section.sectionCode,
    sectionName: section.sectionName,
    majorExpenseCode: leaf.majorExpenseCode,
    majorExpenseName: leaf.majorExpenseName,
    objectiveCode: leaf.objectiveCode,
    objectiveName: leaf.objectiveName,
    fiscalLawCode: leaf.fiscalLawCode,
    fiscalLawName: leaf.fiscalLawName,
    economicNatureCode: leaf.economicNatureCode,
    economicNatureName: leaf.economicNatureName,
    subItemCode: leaf.subItemCode,
    subItemName: leaf.subItemName,
    purposeCode: leaf.purposeCode,
    purposeName: leaf.purposeName,
    amount: leaf.amount,
    previousAmount: leaf.previousAmount,
    difference: leaf.difference,
    currentAmount: leaf.currentAmount,
    spent: leaf.spent,
    carriedOver: leaf.carriedOver,
    unused: leaf.unused,
    documentId: leaf.documentId,
    page: leaf.page,
    sourceUrl: leaf.sourceUrl,
  };
}

/** 1項ぶんの詳細（行の展開時に取得） */
export function sectionDetail(fiscalYear: number, id: string): MOFKouSectionDetail | null {
  const built = buildYear(fiscalYear);
  const row = built.sections.get(id);
  if (!row) return null;

  const descriptions = tryReadDataJson<MOFDescriptionData>(`mof-budget-descriptions-${fiscalYear}.json`) ?? {};
  const jikouItems = row.jikou.map(leaf => hydrateJikou(row, leaf, descriptions[leaf.id] ?? ''));
  const kouMokuItems = row.koumoku.map(leaf => hydrateKouMoku(row, leaf));

  return {
    id,
    jikouItems,
    kouMokuItems,
    rsLinks: row.rsLinks,
  };
}

/** 複数項ぶんの目一覧をまとめた1行（/api/mof-kou/detail-batch のレスポンス用） */
export interface MOFKouSectionBatchRow {
  sectionName: string;
  subItemName: string;
  amount: number;
  rsProjectNames?: string[];
  /** 目の出典ページ番号。突合できない場合は null */
  page: number | null;
  /** page が null のときは空文字列 */
  sourceUrl: string;
}

/**
 * 複数項ぶんの目一覧をまとめて、金額の大きい順に返す。
 * /mof-sankey のサイドパネルで所管・組織/特会・勘定/業務ノードを選んだときの
 * 「目」タブ用（配下の項すべてを合算して見せる）。sectionDetail が呼ぶ buildYear は
 * 年度ごとに一度読み込んだ結果をキャッシュして使い回すため、項の数だけ繰り返し
 * 呼んでも実質1回の読み込みで済む。
 */
export function sectionDetailBatchRows(fiscalYear: number, ids: string[]): MOFKouSectionBatchRow[] {
  const rows: MOFKouSectionBatchRow[] = [];
  for (const id of ids) {
    const detail = sectionDetail(fiscalYear, id);
    if (!detail) continue;
    const rsByKey = new Map<string, string[]>();
    for (const link of detail.rsLinks) {
      const list = rsByKey.get(link.kouMokuKey) ?? [];
      list.push(link.projectName);
      rsByKey.set(link.kouMokuKey, list);
    }
    for (const item of detail.kouMokuItems) {
      rows.push({
        sectionName: item.sectionName,
        subItemName: item.subItemName,
        amount: item.amount,
        rsProjectNames: rsByKey.get(item.key),
        page: item.page,
        sourceUrl: item.sourceUrl,
      });
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  return rows;
}

/** 予算種別・所管を除いた「同じ項」の識別子。所管表記の変更をまたいで継続扱いにする（jikou/kou-mokuのidentityKeyと同じ考え方） */
function sectionIdentity(row: {
  accountType: MOFKouMokuAccountType;
  organization: string;
  specialAccount: string;
  agency: string;
  subAccount: string;
  sectionCode: string;
}): string {
  const org =
    row.accountType === 'general'
      ? row.organization
      : row.accountType === 'special'
        ? normSpecialAccount(row.specialAccount)
        : row.agency;
  return [row.accountType, org, row.subAccount, row.sectionCode].join('|');
}

/**
 * 項の経年推移を組み立てる。
 * `id`（会計区分・予算種別・所管・組織/特会/機関・勘定・項コード）から予算種別・所管を
 * 除いた識別子に落とし、全年度を横断して同じ識別子を持つ行を集める。
 */
export function sectionHistory(fiscalYear: number, id: string): MOFKouSectionHistory | null {
  const built = buildYear(fiscalYear);
  const startRow = built.sections.get(id);
  if (!startRow) return null;
  const identity = sectionIdentity(startRow);

  const years: MOFKouSectionHistoryYear[] = [];
  let sectionName = '';
  for (const year of [...availableYears()].sort((a, b) => a - b)) {
    const y = buildYear(year);
    const matches = [...y.sections.values()].filter(r => sectionIdentity(r) === identity).map(toSummary);
    if (matches.length === 0) continue;
    if (!sectionName) sectionName = matches[0].sectionName;
    years.push({ fiscalYear: year, eraLabel: y.eraLabel, rows: matches });
  }

  return { id, identity, sectionName, availableYears: availableYears(), years };
}

function groupBy<T>(
  rows: T[],
  keyOf: (row: T) => string,
  amountOf: (row: T) => number
): { key: string; count: number; amount: number }[] {
  const map = new Map<string, { key: string; count: number; amount: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const existing = map.get(key) ?? { key, count: 0, amount: 0 };
    existing.count++;
    existing.amount += amountOf(row);
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}
