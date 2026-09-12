#!/usr/bin/env npx tsx
/**
 * 財務省 予算書「科目別内訳」（項・目）データ生成スクリプト。
 *
 * `/mof-jikou`（Web帳票の事項別内訳をスクレイピング）とは別系統で、こちらは
 * ZIP 同梱 CSV（既にローカル取得済み）をそのまま使う。目は事項と違って
 * 支出の性質（庁費・職員基本給…）による分類だが、RS システムの
 * `2-2_予算・執行_予算種別・歳出予算項目` が 所管/組織・勘定/項/目 を同じ語彙で
 * 持つため、目レベルはMOFとRSを名称の揺れなく直接突き合わせられる
 * （docs/tasks/20260826_0809_項の単独事項構造による紐づけ拡張の調査.md の発端）。
 *
 * `/mof-jikou` と同じ予算種別（当初・暫定・補正・決算）を収録する。帳票の suffix 体系は
 * `/mof-jikou` のスクレイパ（generate-mof-jikou-data.ts）と共通。ローカルにZIPが無い
 * 組み合わせ（例: ほとんどの年度の暫定予算）は静かにスキップする。
 *
 * 列構成は予算種別ごとに異なる:
 *   - 当初・暫定（standard）: 本年度額が年度入り見出し列（例: 令和6年度要求額）
 *   - 補正（revised）: 成立予算額／改予算額／差引額の3本。amount=改予算額
 *   - 決算（settlement）: 円単位（他は千円単位）。歳出予算額／歳出予算現額／支出済／
 *     繰越／不用額を持つ
 *
 * 使用法:
 *   tsx scripts/generate-mof-kou-moku-data.ts [FISCAL_YEAR...]
 *   デフォルト: 2017〜2026（10年度分）
 *
 * 出力: public/data/mof-kou-moku-{FISCAL_YEAR}.json（年度ごとに1ファイル）
 *
 * 目レベルの出典ページ番号は主データ（CSV）には無いため、別途Web帳票のXMLを
 * スクレイピングして行単位で突合する（buildGeneralPageMap/buildSpecialPageMap）。
 * CLAUDE.mdのレイヤー規約でscripts/はCSV処理に加えXML取得を明示的に許容している
 * （generate-mof-jikou-data.ts と同じ位置づけ）ため、このファイルに置いている。
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  MOFBudgetType,
  MOFKouMokuAccountType,
  MOFKouMokuData,
  MOFKouMokuGroupSummary,
  MOFKouMokuItem,
} from '@/types/mof-kou-moku';
import { MOF_REVISION_NUMBERS, revisedBudgetType } from '@/types/mof-jikou';
import { amountColumn, readBudgetTables, toEraLabel, yen, zipPath, type CsvRow } from '@/scripts/mof-budget-csv';
import { MAJOR_EXPENSE } from '@/scripts/mof-major-expense';
import { ECONOMIC_NATURE, FISCAL_LAW, OBJECTIVE } from '@/scripts/mof-classification-tables';
import {
  createThrottle,
  extractXmlNames,
  fetchText,
  HttpError,
  listTitle,
  parseTable,
  splitRunningTitle,
  subAt,
  textAt,
} from '@/scripts/mof-budget-xml';

const DEFAULT_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/**
 * 使途別分類コード表（docs/mof-budget-data-guide.md 4-6節）。
 * 表に無いコードは「その他」に混ぜず空文字にする（黙って埋もれさせない）。
 */
const PURPOSE_NAMES: Record<string, string> = {
  '1': '人件費',
  '2': '旅費',
  '3': '物件費',
  '4': '施設費',
  '5': '補助費・委託費',
  '6': '他会計へ繰入',
  '9': 'その他',
};

type Layout = 'standard' | 'revised' | 'settlement';

interface DocumentSpec {
  suffix: string;
  accountType: MOFKouMokuAccountType;
  budgetType: MOFBudgetType;
  layout: Layout;
  title: string;
}

/** 年度ごとの帳票一覧。ZIPが無い組み合わせは呼び出し側で存在チェックして除く */
function buildDocuments(fiscalYear: number): DocumentSpec[] {
  const specs: DocumentSpec[] = [
    { suffix: '11001', accountType: 'general', budgetType: '当初予算', layout: 'standard', title: '一般会計予算（当初予算）' },
    { suffix: '12001', accountType: 'special', budgetType: '当初予算', layout: 'standard', title: '特別会計予算（当初予算）' },
    { suffix: '13001', accountType: 'agency', budgetType: '当初予算', layout: 'standard', title: '政府関係機関予算（当初予算）' },
    { suffix: '31001', accountType: 'general', budgetType: '暫定予算', layout: 'standard', title: '一般会計予算（暫定予算）' },
    { suffix: '32001', accountType: 'special', budgetType: '暫定予算', layout: 'standard', title: '特別会計予算（暫定予算）' },
    { suffix: '33001', accountType: 'agency', budgetType: '暫定予算', layout: 'standard', title: '政府関係機関予算（暫定予算）' },
    { suffix: '77001', accountType: 'general', budgetType: '決算', layout: 'settlement', title: '一般会計 歳出決算' },
    { suffix: '78001', accountType: 'special', budgetType: '決算', layout: 'settlement', title: '特別会計 歳出決算' },
    { suffix: '76001', accountType: 'agency', budgetType: '決算', layout: 'settlement', title: '政府関係機関 支出決算' },
  ];
  // 補正予算は号数ぶんだけ動的に追加（政府関係機関の補正ZIPは存在しない）
  for (const revision of MOF_REVISION_NUMBERS) {
    const seq = String(revision).padStart(3, '0');
    specs.push({
      suffix: `21${seq}`,
      accountType: 'general',
      budgetType: revisedBudgetType(revision),
      layout: 'revised',
      title: `一般会計予算（補正予算第${revision}号）`,
    });
    specs.push({
      suffix: `22${seq}`,
      accountType: 'special',
      budgetType: revisedBudgetType(revision),
      layout: 'revised',
      title: `特別会計予算（補正予算特第${revision}号）`,
    });
  }
  return specs.filter(s => fs.existsSync(zipPath(fiscalYear, s.suffix)));
}

function group(items: MOFKouMokuItem[], keyOf: (item: MOFKouMokuItem) => string): MOFKouMokuGroupSummary[] {
  const map = new Map<string, MOFKouMokuGroupSummary>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const existing = map.get(key) ?? { key, count: 0, amount: 0 };
    existing.count++;
    existing.amount += item.amount;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** 決算（settlement）は円単位で印字されるため、他と違い1000倍しない */
function yenAsIs(row: CsvRow, column: string | undefined): number {
  if (!column) return 0;
  const raw = row[column];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** 見出し文字列から列名を解決する（列位置が帳票により動くため） */
function findColumn(headers: string[], match: (h: string) => boolean): string | undefined {
  return headers.find(match);
}

/**
 * 出典帳票トップページのURL（フォールバック）。ページ番号までは特定できない場合に使う。
 * 一般会計は `buildGeneralPageMap` で行単位のページURLに差し替えられる。
 */
function documentUrl(fiscalYear: number, suffix: string): string {
  return `https://www.bb.mof.go.jp/server/${fiscalYear}/html/${fiscalYear}${suffix}Main.html`;
}

// ─── 科目別内訳Webページの行単位スキャン（一般会計のみ） ────────────────────
//
// 科目別内訳はZIP同梱CSVとは別に、事項別内訳と同じ帳票ファミリーのWeb帳票
// （XML）としても公開されている（title_for_list=「科目別内訳」）。/mof-jikou の
// スクレイピングで data/download/mof_{年度}/xml/ に大半のページが既にキャッシュ
// されているため、一般会計はネットワーク要求なしでページ単位のURLを特定できる
// （docs/tasks/20260826_0809_項の単独事項構造による紐づけ拡張の調査.md 参照）。
//
// 表の列位置（一般会計・当初/暫定/補正で共通、複数所管で実測確認済み）:
//   col1(sub=1) = 項コード（項の行にだけ印字）／col1(sub=2,3) = 主要経費等の合成コード（目の行）
//   col2        = 項名（項の行にだけ印字）
//   col3        = 目名（目の行にだけ印字。項に目が1件しかない場合は目の行自体が無い）
//   col4以降    = 金額（ここでは使わない。金額はCSVを正とする）

const throttle = createThrottle();
const scrapeCacheDir = (fiscalYear: number) =>
  path.join(process.cwd(), 'data', 'download', `mof_${fiscalYear}`, 'xml');
const scrapeBase = (fiscalYear: number) => `https://www.bb.mof.go.jp/server/${fiscalYear}`;

/** 突合用の文字列正規化: NFKC + 空白除去 */
function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

/** 一般会計の running_title「内閣府所管  内閣本府」から所管・組織を割り当てる（jikou と同じ規約） */
function resolveGeneralScope(parts: string[]): { ministry: string; organization: string } {
  const first = (parts[0] ?? '').replace(/所管$/, '');
  const second = parts[1] ?? '';
  // 皇室費のように組織が印字されない帳票は、所管をそのまま組織名とする（CSV も同じ扱い）
  return { ministry: first, organization: second || first };
}

/** 突合キー（budgetType|所管|組織|項コード|目名） */
function pageMapKey(budgetType: string, ministry: string, organization: string, sectionCode: string, subItemName: string): string {
  return [budgetType, norm(ministry), norm(organization), sectionCode, norm(subItemName)].join('|');
}

/** 突合キー（budgetType|所管|特別会計|勘定|項コード|目名） */
function specialPageMapKey(
  budgetType: string,
  ministry: string,
  specialAccount: string,
  subAccount: string,
  sectionCode: string,
  subItemName: string
): string {
  return [budgetType, norm(ministry), norm(specialAccount), norm(subAccount), sectionCode, norm(subItemName)].join('|');
}

/** 特別会計の running_title「財務省所管  地震再保険特別会計」「内閣府及び厚生労働省所管  年金特別会計  基礎年金勘定」を割り当てる（jikou と同じ規約） */
function resolveSpecialScope(parts: string[]): { ministry: string; specialAccount: string; subAccount: string } {
  const first = (parts[0] ?? '').replace(/所管$/, '');
  // CSV（科目別内訳）の特別会計名には「特別会計」接尾辞が無いため、突合のためここで外す
  const second = (parts[1] ?? '').replace(/特別会計$/, '');
  const third = parts[2] ?? '';
  return { ministry: first, specialAccount: second, subAccount: third };
}

/**
 * 1年度・1帳票（suffix）ぶんの科目別内訳ページを走査し、突合キー→出典URLの
 * マップを作る。メニュー・XMLともキャッシュ優先（`fetchText`）で、jikou が
 * 既に取得済みの年度・帳票ならネットワークアクセスは発生しない。
 * 404（帳票なし）は空マップを返す。それ以外の通信エラーは警告して空マップにする
 * （スクレイピングはページURLの精度を上げる付加機能で、失敗しても本体データの
 * 生成は止めない）。
 */
interface PageEntry {
  sourceUrl: string;
  page: number;
}

async function buildGeneralPageMap(
  fiscalYear: number,
  suffix: string,
  budgetType: MOFBudgetType
): Promise<Map<string, PageEntry>> {
  const map = new Map<string, PageEntry>();
  const cacheDir = scrapeCacheDir(fiscalYear);
  const base = scrapeBase(fiscalYear);
  const documentId = `${fiscalYear}${suffix}`;
  let menu: string;
  try {
    menu = await fetchText(cacheDir, `${base}/html/${documentId}menu.html`, 'euc-jp', throttle, `${documentId}menu.html`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return map;
    console.warn(`  ⚠ [${documentId}] 目次の取得に失敗（ページ単位リンクは帳票単位にフォールバック）: ${(error as Error).message}`);
    return map;
  }

  for (const name of extractXmlNames(menu)) {
    let xml: string;
    try {
      xml = await fetchText(cacheDir, `${base}/xml/${name}`, 'shift_jis', throttle, name);
    } catch (error) {
      if (error instanceof HttpError) continue; // 個別ページの欠番はスキップ
      console.warn(`  ⚠ [${documentId}] ${name} の取得に失敗: ${(error as Error).message}`);
      continue;
    }
    if (listTitle(xml) !== '科目別内訳') continue;

    const { ministry, organization } = resolveGeneralScope(splitRunningTitle(xml));
    const { rows } = parseTable(xml);
    const sourceUrl = `${base}/xml/${name}`;
    let sectionCode = '';
    let sectionName = '';
    for (const row of rows) {
      const entry: PageEntry = { sourceUrl, page: row.page };
      // 項に目が1件しかない行は、同じ(page,row)に項コード(colSub=1)と
      // プレースホルダの合成コード(colSub=2)の2セルが同居し、textAt()は両方を
      // 連結してしまう（例: "001(95011-2129-‥)"）。項コードの判定は
      // 先頭セル（colSub=1）のテキストだけを見る必要がある。
      const code = (row.cols.get(1) ?? [])[0]?.text.trim() ?? '';
      const section = textAt(row, 2);
      // 項の行（col1が項コード・col2に項名）。目の行はcol1が合成コード文字列で数字のみにならない
      if (/^\d+$/.test(code) && section && subAt(row, 1) === 1) {
        sectionCode = code;
        sectionName = section;
        // 項に目が1件しかない場合、目の行自体が無い。CSVでのプレースホルダ表現は
        // レイアウトにより異なる（当初/暫定=「(項名)」、補正=空文字）ため両方登録しておく。
        // 先に登録しておき、実際に目の行があれば下で正しい目名のキーが別途登録される。
        map.set(pageMapKey(budgetType, ministry, organization, sectionCode, `(${sectionName})`), entry);
        map.set(pageMapKey(budgetType, ministry, organization, sectionCode, ''), entry);
        continue;
      }
      const subItemName = textAt(row, 3);
      if (subItemName && sectionCode) {
        map.set(pageMapKey(budgetType, ministry, organization, sectionCode, subItemName), entry);
      }
    }
  }
  return map;
}

/**
 * 1年度・1帳票（suffix）ぶんの特別会計・勘定ごとの項/目内訳を走査し、突合キー→
 * 出典URLのマップを作る。一般会計の科目別内訳とは別の帳票（title_for_list）・
 * 列構成なので専用に実装する。歳出区分のみ対象。
 *
 * 当初・暫定（`歳入歳出予定額科目別表`）と補正（`歳入歳出予算補正予定額科目別表`）は
 * 別帳票で列数が異なる（補正は金額列が5本: 成立予算額/追加額/修正減少額/差引額/予定額）
 * ため、`listTitleMatch`（帳票判別用のtitle_for_list）と`subItemNameCol`（目名の列番号。
 * 当初・暫定は5、補正は6）を呼び出し側で切り替える。
 *
 * 行構成（歳出区分）:
 *   項の行: col1(colSub=2)=項コード, col2(colSub=1)=項名。複数目を持つ項は
 *           このままだが、末尾の金額列に項の小計が乗る場合もある。
 *   目の行: col1(colSub=3)=合成分類コード, subItemNameCol(colSub=2)=目名
 *   項に目が1件も続かない場合（例: 予備費）は項の行自体に金額が乗り、
 *   そのまま項名を目名とみなして登録する（次の項行 or 歳出合計で確定させる）。
 */
async function buildSpecialPageMap(
  fiscalYear: number,
  suffix: string,
  budgetType: MOFBudgetType,
  listTitleMatch: string,
  subItemNameCol: number
): Promise<Map<string, PageEntry>> {
  const map = new Map<string, PageEntry>();
  const cacheDir = scrapeCacheDir(fiscalYear);
  const base = scrapeBase(fiscalYear);
  const documentId = `${fiscalYear}${suffix}`;
  let menu: string;
  try {
    menu = await fetchText(cacheDir, `${base}/html/${documentId}menu.html`, 'euc-jp', throttle, `${documentId}menu.html`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return map;
    console.warn(`  ⚠ [${documentId}] 目次の取得に失敗（特別会計の行単位リンクは帳票単位にフォールバック）: ${(error as Error).message}`);
    return map;
  }

  for (const name of extractXmlNames(menu)) {
    let xml: string;
    try {
      xml = await fetchText(cacheDir, `${base}/xml/${name}`, 'shift_jis', throttle, name);
    } catch (error) {
      if (error instanceof HttpError) continue;
      console.warn(`  ⚠ [${documentId}] ${name} の取得に失敗: ${(error as Error).message}`);
      continue;
    }
    if (listTitle(xml) !== listTitleMatch) continue;

    const { ministry, specialAccount, subAccount } = resolveSpecialScope(splitRunningTitle(xml));
    const { rows } = parseTable(xml);
    const sourceUrl = `${base}/xml/${name}`;

    let inExpenditure = false;
    let sectionCode = '';
    let sectionName = '';
    let sectionPage = 0;
    let sectionHasChild = false;
    const flushSection = () => {
      if (sectionCode && !sectionHasChild && sectionName) {
        const entry: PageEntry = { sourceUrl, page: sectionPage };
        // 項に目が1件も続かない場合、CSVの目名は「(項名)」というプレースホルダになる
        // （一般会計の科目別内訳と同じ規約）。生の項名でも念のため登録しておく
        map.set(specialPageMapKey(budgetType, ministry, specialAccount, subAccount, sectionCode, `(${sectionName})`), entry);
        map.set(specialPageMapKey(budgetType, ministry, specialAccount, subAccount, sectionCode, ''), entry);
        map.set(specialPageMapKey(budgetType, ministry, specialAccount, subAccount, sectionCode, sectionName), entry);
      }
    };

    for (const row of rows) {
      const col1Text = textAt(row, 1);
      if (col1Text === '歳出') {
        inExpenditure = true;
        continue;
      }
      if (col1Text === '歳出合計') {
        flushSection();
        inExpenditure = false;
        sectionCode = '';
        continue;
      }
      if (!inExpenditure) continue;

      const firstCell = (row.cols.get(1) ?? [])[0];
      if (!firstCell) continue;
      const cellText = firstCell.text.trim();

      // 目の行は分類コードがハイフン区切りの合成コード（例: "02081-509-21"）。
      // 項の行は数字のみ（プレースホルダが付く場合あり: "09(98110-959-‥)"）。
      // colSubの割り当ては年度により変わる（2024はcol1=sub2/3、2017はsub2/4など）ため
      // sub番号には依存せず、コードの見た目だけで判定する。
      if (cellText.includes('-')) {
        const subItemName = textAt(row, subItemNameCol);
        if (subItemName && sectionCode) {
          map.set(specialPageMapKey(budgetType, ministry, specialAccount, subAccount, sectionCode, subItemName), {
            sourceUrl,
            page: row.page,
          });
          sectionHasChild = true;
        }
        continue;
      }

      const code = /^(\d+)/.exec(cellText)?.[1] ?? '';
      if (code) {
        flushSection();
        sectionCode = code;
        sectionName = textAt(row, 2);
        sectionPage = row.page;
        sectionHasChild = false;
      }
    }
    flushSection();
  }
  return map;
}

/** 会計区分ごとの列名の違いを吸収する */
function rowFields(row: CsvRow, accountType: MOFKouMokuAccountType, layout: Layout) {
  const subItemCodeCol = layout === 'settlement' ? '目番号' : accountType === 'agency' ? '目コード' : '目別分類コード';
  return {
    ministry: accountType === 'agency' ? '' : row['所管'] ?? '',
    organization: accountType === 'general' ? row['組織'] ?? '' : '',
    specialAccount: accountType === 'special' ? row['特別会計'] ?? '' : '',
    subAccount: accountType === 'special' ? row['勘定'] ?? '' : accountType === 'agency' ? row['業務'] ?? '' : '',
    agency: accountType === 'agency' ? row['政府関係機関'] ?? '' : '',
    sectionCode: row['項コード'] ?? '',
    sectionName: row['項名'] ?? '',
    majorExpenseCode: row['主要経費別分類コード'] ?? '',
    // 目的別・財政法公債金対象非対象別・経済性質別の3分類は政府関係機関の帳票に無い。
    // 財政法公債金対象非対象別はさらに特別会計にも無い（複合コードが1桁少ない理由）
    objectiveCode: row['目的別分類コード'] ?? '',
    fiscalLawCode: row['財政法公債金対象非対象別分類コード'] ?? '',
    economicNatureCode: row['経済性質別分類コード'] ?? '',
    subItemCode: row[subItemCodeCol] ?? '',
    subItemName: row['目名'] ?? '',
    purposeCode: row['使途別分類コード'] ?? '',
  };
}

function extractStandard(
  rows: CsvRow[],
  spec: DocumentSpec,
  fiscalYear: number
): Array<Omit<MOFKouMokuItem, 'key' | 'majorExpenseName' | 'objectiveName' | 'fiscalLawName' | 'economicNatureName' | 'purposeName'>> {
  const col = amountColumn(rows);
  const documentId = `${fiscalYear}${spec.suffix}`;
  const sourceUrl = documentUrl(fiscalYear, spec.suffix);
  // 暫定予算のCSVには前年度比較列が無い。列自体が無い場合はyen()の0円ではなくnull（未取得）にする
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const hasPreviousAmount = headers.includes('前年度予算額(千円)');
  const hasDifference = headers.includes('比較増△減額(千円)');
  return rows.map((row, i) => {
    const f = rowFields(row, spec.accountType, spec.layout);
    return {
      id: `${spec.accountType}-${spec.budgetType}-${i}`,
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      ...f,
      amount: yen(row, col),
      previousAmount: hasPreviousAmount ? yen(row, '前年度予算額(千円)') : null,
      difference: hasDifference ? yen(row, '比較増△減額(千円)') : null,
      currentAmount: null,
      spent: null,
      carriedOver: null,
      unused: null,
      documentId,
      page: null,
      sourceUrl,
    };
  });
}

function extractRevised(
  rows: CsvRow[],
  spec: DocumentSpec,
  fiscalYear: number
): Array<Omit<MOFKouMokuItem, 'key' | 'majorExpenseName' | 'objectiveName' | 'fiscalLawName' | 'economicNatureName' | 'purposeName'>> {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const colRevised = findColumn(headers, h => /^改(令和|平成)(元|\d+)年度/.test(h));
  const colSettled = findColumn(headers, h => h.includes('成立予算額'));
  const colDiff = findColumn(headers, h => h.includes('差引額'));
  if (!colRevised) return [];
  const documentId = `${fiscalYear}${spec.suffix}`;
  const sourceUrl = documentUrl(fiscalYear, spec.suffix);
  return rows.map((row, i) => {
    const f = rowFields(row, spec.accountType, spec.layout);
    return {
      id: `${spec.accountType}-${spec.budgetType}-${i}`,
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      ...f,
      amount: yen(row, colRevised),
      previousAmount: colSettled ? yen(row, colSettled) : null,
      difference: colDiff ? yen(row, colDiff) : null,
      currentAmount: null,
      spent: null,
      carriedOver: null,
      unused: null,
      documentId,
      page: null,
      sourceUrl,
    };
  });
}

function extractSettlement(
  rows: CsvRow[],
  spec: DocumentSpec,
  fiscalYear: number
): Array<Omit<MOFKouMokuItem, 'key' | 'majorExpenseName' | 'objectiveName' | 'fiscalLawName' | 'economicNatureName' | 'purposeName'>> {
  const documentId = `${fiscalYear}${spec.suffix}`;
  const sourceUrl = documentUrl(fiscalYear, spec.suffix);
  return rows.map((row, i) => {
    const f = rowFields(row, spec.accountType, spec.layout);
    // 決算の「歳出予算額」列は会計区分により語尾が違う（歳出/支出）
    const amountCol = findColumn(Object.keys(row), h => /^(歳出|支出)予算額\(円\)$/.test(h));
    return {
      id: `${spec.accountType}-${spec.budgetType}-${i}`,
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      ...f,
      amount: yenAsIs(row, amountCol),
      previousAmount: null,
      difference: null,
      currentAmount: yenAsIs(row, findColumn(Object.keys(row), h => /^(歳出|支出)予算現額\(円\)$/.test(h))),
      spent: yenAsIs(row, findColumn(Object.keys(row), h => /^(支出済歳出額|支出済額)\(円\)$/.test(h))),
      carriedOver: yenAsIs(row, '翌年度繰越額(円)'),
      unused: yenAsIs(row, '不用額(円)'),
      documentId,
      page: null,
      sourceUrl,
    };
  });
}

async function generateYear(fiscalYear: number): Promise<void> {
  const eraLabel = toEraLabel(fiscalYear);
  console.log(`\n=== ${eraLabel}（${fiscalYear}） 科目別内訳 ===`);

  const documents = buildDocuments(fiscalYear);
  if (documents.length === 0) {
    console.warn(`  ⚠️  ${fiscalYear}年度はローカルにZIPがありません。スキップします。`);
    return;
  }
  const items: Array<Omit<MOFKouMokuItem, 'key' | 'majorExpenseName' | 'objectiveName' | 'fiscalLawName' | 'economicNatureName' | 'purposeName'>> = [];
  const documentSummaries: MOFKouMokuData['metadata']['documents'] = [];

  for (const spec of documents) {
    const { expenditure } = readBudgetTables(fiscalYear, spec.suffix);
    const extracted =
      spec.layout === 'standard'
        ? extractStandard(expenditure, spec, fiscalYear)
        : spec.layout === 'revised'
          ? extractRevised(expenditure, spec, fiscalYear)
          : extractSettlement(expenditure, spec, fiscalYear);
    items.push(...extracted);
    documentSummaries.push({
      accountType: spec.accountType,
      budgetType: spec.budgetType,
      title: spec.title,
      count: extracted.length,
      url: documentUrl(fiscalYear, spec.suffix),
    });
    console.log(`  ${spec.title}: ${extracted.length.toLocaleString()} 件`);
  }

  // 一般会計は科目別内訳のWebページを走査して、行単位の正確な出典URLに差し替える
  // （standard/revisedレイアウトのみ対象。決算は別調査が必要なため対象外・帳票単位のまま）。
  const generalSpecs = documents.filter(s => s.accountType === 'general' && s.layout !== 'settlement');
  const pageMap = new Map<string, PageEntry>();
  for (const spec of generalSpecs) {
    const specMap = await buildGeneralPageMap(fiscalYear, spec.suffix, spec.budgetType);
    for (const [k, v] of specMap) pageMap.set(k, v);
  }
  let pageMatched = 0;
  for (const item of items) {
    if (item.accountType !== 'general') continue;
    const key = pageMapKey(item.budgetType, item.ministry, item.organization, item.sectionCode, item.subItemName);
    const entry = pageMap.get(key);
    if (entry) {
      item.sourceUrl = entry.sourceUrl;
      item.page = entry.page;
      pageMatched++;
    }
  }
  const generalCount = items.filter(i => i.accountType === 'general').length;
  if (generalCount > 0) {
    console.log(
      `  科目別内訳ページ走査: 一般会計 ${generalCount.toLocaleString()} 件中 ${pageMatched.toLocaleString()} 件で行単位のURLを特定`
    );
  }

  // 特別会計は勘定ごとの科目別表を走査して行単位のURLに差し替える
  // （決算は事項レベルの歳出報告書しか無く目レベルの科目別表が存在しないため対象外・帳票単位のまま）
  const specialSpecs = documents.filter(s => s.accountType === 'special' && s.layout !== 'settlement');
  const specialPageMap = new Map<string, PageEntry>();
  for (const spec of specialSpecs) {
    const [listTitleMatch, subItemNameCol] =
      spec.layout === 'standard' ? (['歳入歳出予定額科目別表', 5] as const) : (['歳入歳出予算補正予定額科目別表', 6] as const);
    const specMap = await buildSpecialPageMap(fiscalYear, spec.suffix, spec.budgetType, listTitleMatch, subItemNameCol);
    for (const [k, v] of specMap) specialPageMap.set(k, v);
  }
  let specialPageMatched = 0;
  for (const item of items) {
    if (item.accountType !== 'special') continue;
    const key = specialPageMapKey(item.budgetType, item.ministry, item.specialAccount, item.subAccount, item.sectionCode, item.subItemName);
    const entry = specialPageMap.get(key);
    if (entry) {
      item.sourceUrl = entry.sourceUrl;
      item.page = entry.page;
      specialPageMatched++;
    }
  }
  const specialCount = items.filter(i => i.accountType === 'special').length;
  if (specialCount > 0) {
    console.log(
      `  科目別内訳ページ走査: 特別会計 ${specialCount.toLocaleString()} 件中 ${specialPageMatched.toLocaleString()} 件で行単位のURLを特定`
    );
  }

  const fullItems: MOFKouMokuItem[] = items.map(item => ({
    ...item,
    key: [
      item.accountType,
      item.budgetType,
      item.ministry,
      item.organization,
      item.specialAccount,
      item.subAccount,
      item.agency,
      item.sectionCode,
      item.subItemCode,
      item.subItemName,
    ].join('|'),
    majorExpenseName: item.majorExpenseCode ? MAJOR_EXPENSE[item.majorExpenseCode] ?? '' : '',
    objectiveName: item.objectiveCode ? OBJECTIVE[item.objectiveCode] ?? '' : '',
    fiscalLawName: item.fiscalLawCode ? FISCAL_LAW[item.fiscalLawCode] ?? '' : '',
    economicNatureName: item.economicNatureCode ? ECONOMIC_NATURE[item.economicNatureCode] ?? '' : '',
    purposeName: PURPOSE_NAMES[item.purposeCode] ?? '',
  }));

  const budgetTypes = [...new Set(fullItems.map(i => i.budgetType))];

  const data: MOFKouMokuData = {
    metadata: {
      fiscalYear,
      eraLabel,
      budgetTypes,
      documents: documentSummaries,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      notes: [
        '全金額は円単位です（予算書の印字は千円単位・決算は円単位。生成時に千円分は1000倍しています）',
        '目は支出の性質による分類です（事項は目的による分類で、`/mof-jikou` が扱います）',
        '目と事項は項の下に並列にぶら下がる別系統の内訳で、対応表はありません',
        '政府関係機関の帳票には主要経費別分類の列がありません',
        '補正予算は amount=改予算額（その号の成立後の姿）／previousAmount=補正前の成立予算額／difference=差引額です',
        '決算の帳票には比較対象額・増減額が無いため previousAmount/difference は null です',
        '暫定予算・補正予算はローカルにZIPがある年度のみ収録しています（暫定は令和8年度のみ）',
      ],
    },
    summary: {
      count: fullItems.length,
      byAccountType: group(fullItems, i => i.accountType),
      byBudgetType: group(fullItems, i => i.budgetType),
      byMinistry: group(fullItems, i => i.ministry || i.agency),
      byMajorExpense: group(fullItems, i => i.majorExpenseName),
      byPurpose: group(fullItems, i => i.purposeName),
    },
    items: fullItems,
  };

  const outputFile = path.join(process.cwd(), 'public', 'data', `mof-kou-moku-${fiscalYear}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 1));
  const t = (v: number) => (v / 1e12).toFixed(2);
  const initialTotal = fullItems.filter(i => i.budgetType === '当初予算').reduce((s, i) => s + i.amount, 0);
  console.log(`  合計 ${fullItems.length.toLocaleString()}件（うち当初予算 ${t(initialTotal)}兆円）`);
  console.log(`  出力: ${path.basename(outputFile)}`);
}

async function main(): Promise<void> {
  const years = process.argv.length > 2 ? process.argv.slice(2).map(v => parseInt(v, 10)) : DEFAULT_YEARS;
  if (years.some(y => isNaN(y) || y < 2000 || y > 2100)) {
    console.error(`Invalid fiscal year: ${process.argv.slice(2).join(' ')}`);
    process.exit(1);
  }
  console.log(`=== MOF 科目別内訳（項・目）生成（対象: ${years.join(', ')}） ===`);
  for (const year of years) await generateYear(year);
  console.log(`\n完了: ${years.length} 年度分を生成しました。`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
