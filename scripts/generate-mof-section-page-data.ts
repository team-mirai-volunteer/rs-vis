#!/usr/bin/env npx tsx
/**
 * 財務省 予算書「甲号歳入歳出予算」（一般会計）・「歳入歳出予算」（特別会計）・
 * 「収入支出予算」（政府関係機関）スクレイピング＆JSON生成スクリプト。
 *
 * これらは項単位（事項・目より1段粗い）の集計表で、歳入・歳出（収入・支出）を
 * 1〜数ページの表にまとめている。事項別内訳・科目別内訳とは完全に独立した別帳票
 * （同じdocumentId内の別ページだが、title_for_listで判別できる単独ファイル）。
 * 項コードを持たないため、事項・目のデータとは項名でしか突き合わせられない。
 *
 * 用途: `/mof-kou` の項（MOFSection）自体に出典ページを付ける（今まで事項・目の
 * 明細にしか出典が無かった）。あわせて歳出額を目側合計との一致確認に使える。
 *
 * 歳出側のみを取得する。この表には歳入側の値も載っているが、対応する既存データ
 * （事項・目とも歳出のみ）が無く単独では突合検証できないため見送った。
 *
 * 予算種別の対応状況（帳票の存在・構造を確認済みの範囲のみ対応。年度・予算種別を
 * 増やす場合は先に対象帳票の存在とtitle_for_list・列構成を確認すること）:
 * - 当初予算: 一般会計・特別会計・政府関係機関とも対応（v1）
 * - 補正予算: 一般会計・特別会計とも対応。
 *   一般会計は「甲号　歳入歳出予算補正　歳出」（title_for_list="歳出"）で、
 *   当初予算の帳票と列構成が同じ（所管/組織/項/金額）なので同じパーサで読める。
 *   特別会計は「甲号　歳入歳出予算補正」という別帳票（title_for_list="歳入歳出予算補正"）
 *   で歳入・歳出が同じ列（款=列3・項=列4）に混在し、列2の列内連番（1=特別会計名・
 *   2=勘定名・4=歳入/歳出の区分マーカー）で読み分ける必要があった（parseSpecialRevised）。
 *   政府関係機関の補正は帳票区分自体がこのリポジトリの他のパイプラインでも未対応
 * - 決算: 一般会計・特別会計とも対応。
 *   一般会計は`202{年}72001`の「一般会計歳入歳出決算」（title_for_list="歳出"）で、
 *   当初・補正の「甲号」帳票とは列構成が異なり（所管・組織・項が同じ列(1)に
 *   列内連番だけで積まれる）専用パーサが必要だった（parseGeneralSettlement）。
 *   特別会計は`202{年}75001`。一般会計と違い勘定（特別会計）ごとに個別ファイルが
 *   分かれ、かつ1ファイル中に「所管→特別会計→（勘定→）歳入→歳出」の見出しと表が
 *   交互に並ぶ（複数勘定を持つ会計は同じファイル内でこのサイクルが繰り返される）ため、
 *   title_for_list による帳票判別ができず全ファイル走査＋見出しブロックの逐次読みが
 *   必要だった（parseSpecialSettlementFile）。政府関係機関の決算相当帳票は未調査
 * - 暫定予算: 対応する帳票の存在を確認できていない
 *
 * 使用法:
 *   tsx scripts/generate-mof-section-page-data.ts [FISCAL_YEAR...]
 *   デフォルト: 2017〜2026（10年度分）
 *
 * 出力: public/data/mof-section-pages-{FISCAL_YEAR}.json（年度ごとに1ファイル）
 */

import * as fs from 'fs';
import * as path from 'path';
import { MOF_REVISION_NUMBERS, revisedBudgetType, type MOFAccountType, type MOFBudgetType } from '@/types/mof-jikou';
import type { MOFSectionPageData, MOFSectionPageEntry } from '@/types/mof-section-pages';
import { toEraLabel } from '@/scripts/mof-budget-csv';
import {
  cellText,
  createThrottle,
  extractXmlNames,
  fetchText,
  HttpError,
  listTitle,
  numberAt,
  parseTable,
  splitRunningTitle,
  subAt,
  textAt,
  type ParsedRow,
} from '@/scripts/mof-budget-xml';

const DEFAULT_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** 合計・小計行として除外する項名 */
const SUBTOTAL_LABELS = new Set(['計', '合計', '小計']);

type EntryDraft = Omit<MOFSectionPageEntry, 'budgetType' | 'documentId' | 'sourceUrl'>;

/** 一般会計「甲号歳入歳出予算 歳出」: 所管(1)｜組織(2)｜項(3)｜金額(4) */
function parseGeneralExpenditure(rows: ParsedRow[]): EntryDraft[] {
  const entries: EntryDraft[] = [];
  let ministry = '';
  let organization = '';
  for (const row of rows) {
    const newMinistry = textAt(row, 1);
    if (newMinistry) {
      ministry = newMinistry;
      organization = ''; // 所管が変わったら組織はリセット（皇室費のように組織欄が無い場合もある）
    }
    const newOrg = textAt(row, 2);
    if (newOrg) organization = newOrg;
    const sectionName = textAt(row, 3);
    if (!sectionName || SUBTOTAL_LABELS.has(sectionName)) continue;
    const amount = numberAt(row, 4, 1000);
    if (amount === null) continue;
    entries.push({
      accountType: 'general',
      ministry,
      // 皇室費のように組織欄が無い帳票は、所管をそのまま組織名とする（kou-moku側と同じ規約）
      organization: organization || ministry,
      specialAccount: '',
      subAccount: '',
      agency: '',
      sectionName,
      amount,
      page: row.page,
    });
  }
  return entries;
}

/**
 * 一般会計「歳入歳出決算 歳出」（決算のみに存在する帳票。当初・補正の「甲号歳入歳出予算」
 * とは別物で、所管・組織・項が同じ列(1)に列内連番（sub）だけで積まれる）:
 *   sub=3: 所管、sub=2: 組織（小計行。ラベルだけ使い項としては登録しない）、
 *   sub=1: 「計」（所管合計。スキップ）、sub=5: 項。金額は列2の歳出予算額(円)（単位は円）。
 * 組織欄が無い所管（皇室費等）はsub=2の行が現れず、当初予算の帳票と同じ規約で
 * 所管をそのまま組織名として使う。
 */
function parseGeneralSettlement(rows: ParsedRow[]): EntryDraft[] {
  const entries: EntryDraft[] = [];
  let ministry = '';
  let organization = '';
  for (const row of rows) {
    const label = textAt(row, 1);
    if (!label) continue;
    const sub = subAt(row, 1);
    if (sub === 3) {
      // 決算帳票は所管名に「所管」が付く（例:「国会所管」）。事項別内訳・科目別内訳側の
      // 表記（「国会」）に合わせて外す（generate-mof-jikou-data.ts と同じ規約）
      ministry = label.replace(/所管$/, '');
      organization = '';
      continue;
    }
    if (sub === 2) {
      organization = label;
      continue;
    }
    if (sub !== 5 || SUBTOTAL_LABELS.has(label)) continue;
    const amount = numberAt(row, 2, 1);
    if (amount === null) continue;
    entries.push({
      accountType: 'general',
      ministry,
      organization: organization || ministry,
      specialAccount: '',
      subAccount: '',
      agency: '',
      sectionName: label,
      amount,
      page: row.page,
    });
  }
  return entries;
}

/**
 * 特別会計「歳入歳出予算」: 所管(1)｜特別会計/勘定(2)｜款歳入(3)｜項歳入(4)｜金額歳入(5)｜
 * 項歳出(7)｜金額歳出(8)。列2は特別会計名（列内連番1）と勘定名（列内連番2）を共有する
 * （勘定が無い特別会計は列内連番2が現れない）。
 *
 * 既知の制約: 東日本大震災復興特別会計は、1つの行番号（例: p41-420）の中に列内行連番
 * （420.1・420.2・420.3…）で複数の項をまとめて印字しており、`parseTable()` は
 * ページ・行番号だけで行をグルーピングするため（`mof-budget-xml.ts`参照）これらが
 * 1行に混ざってしまう。事項別内訳・科目別内訳の共通実装への影響を避けるため、
 * この機能ではこの会計だけ突合できないことを許容する（該当4件・データ全体の0.4%）。
 */
function parseSpecialSummary(rows: ParsedRow[]): EntryDraft[] {
  const entries: EntryDraft[] = [];
  let ministry = '';
  let specialAccount = '';
  let subAccount = '';
  for (const row of rows) {
    const newMinistry = textAt(row, 1);
    if (newMinistry) {
      ministry = newMinistry;
      specialAccount = '';
      subAccount = '';
    }
    const col2Text = textAt(row, 2);
    if (col2Text) {
      const col2Sub = subAt(row, 2);
      if (col2Sub === 1) {
        specialAccount = col2Text;
        subAccount = '';
      } else if (col2Sub === 2) {
        subAccount = col2Text;
      }
    }
    const sectionName = textAt(row, 7);
    if (!sectionName || SUBTOTAL_LABELS.has(sectionName)) continue;
    const amount = numberAt(row, 8, 1000);
    if (amount === null) continue;
    entries.push({
      accountType: 'special',
      ministry,
      organization: '',
      specialAccount,
      subAccount,
      agency: '',
      sectionName,
      amount,
      page: row.page,
    });
  }
  return entries;
}

/**
 * 特別会計「甲号　歳入歳出予算補正」（補正のみに存在する帳票。当初の「歳入歳出予算」
 * とは列構成が異なり、歳入・歳出を分けた列を持たず同じ列(3=款,4=項)に両方を積み、
 * 列2の列内連番で区分する）:
 *   所管(1・列内連番1)｜特別会計(2・列内連番1)｜勘定(2・列内連番2)｜
 *   「歳入」「歳出」区分マーカー(2・列内連番4)｜款(3)｜項(4)｜補正額の追加額(5)
 * （修正減少額(7)・差引額(9)は使わない。列内連番3はページ再掲のヘッダー行「所管」
 * 「特別会計」でsub=1/2とは無関係なので無視する）。
 * 区分マーカーは款の先頭行にだけ付き、以降の項行には付かないため、直近の区分を
 * 状態として持ち越して「歳出」区分の行だけを拾う。
 */
function parseSpecialRevised(rows: ParsedRow[]): EntryDraft[] {
  const entries: EntryDraft[] = [];
  let ministry = '';
  let specialAccount = '';
  let subAccount = '';
  let section: '歳入' | '歳出' | null = null;
  for (const row of rows) {
    if (subAt(row, 1) === 1) {
      const newMinistry = textAt(row, 1);
      if (newMinistry) {
        ministry = newMinistry;
        specialAccount = '';
        subAccount = '';
        section = null;
      }
    }
    const col2Sub = subAt(row, 2);
    if (col2Sub === 1) {
      specialAccount = textAt(row, 2);
      subAccount = '';
      section = null;
    } else if (col2Sub === 2) {
      subAccount = textAt(row, 2);
      section = null;
    } else if (col2Sub === 4) {
      const label = textAt(row, 2);
      if (label === '歳入' || label === '歳出') section = label;
    }
    if (section !== '歳出') continue;
    const sectionName = textAt(row, 4);
    if (!sectionName || SUBTOTAL_LABELS.has(sectionName)) continue;
    const amount = numberAt(row, 5, 1000);
    if (amount === null) continue;
    entries.push({
      accountType: 'special',
      ministry,
      organization: '',
      specialAccount,
      subAccount,
      agency: '',
      sectionName,
      amount,
      page: row.page,
    });
  }
  return entries;
}

/**
 * 政府関係機関「収入支出予算」: 機関名(1)｜款収入(2)｜項収入(3)｜金額収入(4)｜項支出(6)｜金額支出(7)。
 * 列1は機関名（列内連番1）と業務区分（列内連番3。複数の業務を持つ機関のみ）を共有する
 * （kou-moku側は業務区分を subAccount フィールドに持つのでそれに合わせる）。
 */
function parseAgencySummary(rows: ParsedRow[]): EntryDraft[] {
  const entries: EntryDraft[] = [];
  let agency = '';
  let subAccount = '';
  for (const row of rows) {
    for (const cell of row.cols.get(1) ?? []) {
      const text = cell.text.trim();
      if (!text) continue;
      if (cell.sub === 1) {
        agency = text;
        subAccount = '';
      } else if (cell.sub === 3) {
        subAccount = text;
      }
    }
    const sectionName = textAt(row, 6);
    if (!sectionName || SUBTOTAL_LABELS.has(sectionName)) continue;
    const amount = numberAt(row, 7, 1000);
    if (amount === null) continue;
    entries.push({
      accountType: 'agency',
      ministry: '',
      organization: '',
      specialAccount: '',
      subAccount,
      agency,
      sectionName,
      amount,
      page: row.page,
    });
  }
  return entries;
}

/**
 * 特別会計「歳入歳出決算」（決算のみに存在する帳票。一般会計の`72001`と違い、
 * 単一の集約帳票ではなく勘定（特別会計）ごとに個別のXMLファイルが分かれている。
 * さらに1ファイルの中に「所管→特別会計→（勘定→）歳入→（表）→歳出→（表）」という
 * 見出しブロックと表が交互に並び、複数勘定を持つ特別会計（年金特会等）は
 * 同じファイル内でこのサイクルが勘定の数だけ繰り返される。
 *
 * <body layer="1"><title>…</title></body> と <body layer="1"><table>…</table></body>
 * が交互に出現する構造を先頭から順に読み、直近の見出しブロックで「歳入」「歳出」の
 * どちらの区分に入ったかを状態として持ちつつ、「歳出」区分の表だけを拾う。
 * 特別会計名（running_titleの2番目）は1ファイルを通して固定、勘定名は見出しブロックで
 * 「歳入」「歳出」でも所管（末尾が「所管」）でも特別会計名でもないラベルが出るたびに更新する。
 * ファイル冒頭には「歳入歳出決算及び各事項の計算」のような、所管・特別会計とは無関係な
 * 章見出しが余分なblkとして付くことがある（所管を跨ぐ最初のファイルに現れる）。
 * 末尾が「所管」のラベルに出会うまでは勘定候補として扱わないことでこれを除外する。
 *
 * DocumentSpec の仕組み（targetTitleで単一の帳票を判別）に乗らないため
 * （ファイルごとにtitle_for_listの付け方が一貫しない: 所管の最初の特別会計だけ
 * 所管名が付き、以降は特別会計名や勘定名になる）、専用の収集関数として別扱いにする。
 */
function parseSpecialSettlementFile(xml: string, ministry: string, specialAccount: string): EntryDraft[] {
  const entries: EntryDraft[] = [];
  let subAccount = '';
  let currentSection: '歳入' | '歳出' | null = null;
  let seenMinistryLabel = false;
  const bodyRe = /<body layer="1">\s*(<title>[\s\S]*?<\/title>|<table>[\s\S]*?<\/table>)\s*<\/body>/g;
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(xml)) !== null) {
    const content = m[1];
    if (content.startsWith('<title>')) {
      const blkRe = /<blk[^>]*>([\s\S]*?)<\/blk>/g;
      let b: RegExpExecArray | null;
      while ((b = blkRe.exec(content)) !== null) {
        const label = cellText(b[1]).trim();
        if (label === '歳入' || label === '歳出') {
          currentSection = label;
        } else if (label.endsWith('所管')) {
          seenMinistryLabel = true;
        } else if (label && seenMinistryLabel && label !== specialAccount) {
          subAccount = label;
        }
      }
      continue;
    }
    if (currentSection !== '歳出') continue;
    const { rows } = parseTable(content);
    for (const row of rows) {
      const sectionName = textAt(row, 1);
      if (!sectionName || SUBTOTAL_LABELS.has(sectionName)) continue;
      const amount = numberAt(row, 2, 1);
      if (amount === null) continue;
      entries.push({
        accountType: 'special',
        ministry,
        organization: '',
        specialAccount,
        subAccount,
        agency: '',
        sectionName,
        amount,
        page: row.page,
      });
    }
  }
  return entries;
}

interface DocumentSpec {
  suffix: string;
  accountType: MOFAccountType;
  budgetType: MOFBudgetType;
  /** 帳票判別に使う title_for_list */
  targetTitle: string;
  parse: (rows: ParsedRow[]) => EntryDraft[];
  title: string;
}

/**
 * 補正予算（一般会計・特別会計）の帳票を号数ぶん並べる。
 *
 * 帳票IDの連番が号数（`21001`/`22001`=第1号、`21002`/`22002`=第2号）。存在しない号数は
 * 404になり、呼び出し側が欠番として飛ばす（generate-mof-jikou-data.ts の
 * revisedDocuments と同じ規約）。
 * 一般会計の帳票「甲号　歳入歳出予算補正　歳出」は title_for_list="歳出" で、列構成
 * （所管/組織/項/金額）が当初予算の帳票と同じため parseGeneralExpenditure を再利用できる。
 * 特別会計の帳票「甲号　歳入歳出予算補正」は title_for_list="歳入歳出予算補正" で、
 * 当初の「歳入歳出予算」とは列構成が異なる（parseSpecialRevised 参照）ため専用パーサを使う。
 * どちらも金額列は「追加額」で、当初予算の「金額」とは意味が異なる点に注意
 * （この表の amount は目側合計との突合には使わずページ番号の取得のみに使う）
 */
function revisedDocuments(): DocumentSpec[] {
  const specs: DocumentSpec[] = [];
  for (const revision of MOF_REVISION_NUMBERS) {
    const seq = String(revision).padStart(3, '0');
    specs.push({
      suffix: `21${seq}`,
      accountType: 'general',
      budgetType: revisedBudgetType(revision),
      targetTitle: '歳出',
      parse: parseGeneralExpenditure,
      title: `一般会計 甲号歳入歳出予算補正（第${revision}号・歳出）`,
    });
    specs.push({
      suffix: `22${seq}`,
      accountType: 'special',
      budgetType: revisedBudgetType(revision),
      targetTitle: '歳入歳出予算補正',
      parse: parseSpecialRevised,
      title: `特別会計 甲号歳入歳出予算補正（第${revision}号）`,
    });
  }
  return specs;
}

/** 令和8年度（2026）時点の帳票suffix。年度をまたいでも共通（事項別内訳と同じ規約） */
const DOCUMENTS: DocumentSpec[] = [
  { suffix: '11001', accountType: 'general', budgetType: '当初予算', targetTitle: '歳出', parse: parseGeneralExpenditure, title: '一般会計 甲号歳入歳出予算（歳出）' },
  { suffix: '12001', accountType: 'special', budgetType: '当初予算', targetTitle: '歳入歳出予算', parse: parseSpecialSummary, title: '特別会計 歳入歳出予算' },
  { suffix: '13001', accountType: 'agency', budgetType: '当初予算', targetTitle: '収入支出予算', parse: parseAgencySummary, title: '政府関係機関 収入支出予算' },
  ...revisedDocuments(),
  { suffix: '72001', accountType: 'general', budgetType: '決算', targetTitle: '歳出', parse: parseGeneralSettlement, title: '一般会計 歳入歳出決算（歳出）' },
];

const throttle = createThrottle();
const scrapeCacheDir = (fiscalYear: number) => path.join(process.cwd(), 'data', 'download', `mof_${fiscalYear}`, 'xml');
const scrapeBase = (fiscalYear: number) => `https://www.bb.mof.go.jp/server/${fiscalYear}`;

async function collectEntries(fiscalYear: number, spec: DocumentSpec): Promise<MOFSectionPageEntry[]> {
  const cacheDir = scrapeCacheDir(fiscalYear);
  const base = scrapeBase(fiscalYear);
  const documentId = `${fiscalYear}${spec.suffix}`;
  let menu: string;
  try {
    menu = await fetchText(cacheDir, `${base}/html/${documentId}menu.html`, 'euc-jp', throttle, `${documentId}menu.html`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return [];
    console.warn(`  ⚠ [${documentId}] 目次の取得に失敗: ${(error as Error).message}`);
    return [];
  }

  const results: MOFSectionPageEntry[] = [];
  for (const name of extractXmlNames(menu)) {
    let xml: string;
    try {
      xml = await fetchText(cacheDir, `${base}/xml/${name}`, 'shift_jis', throttle, name);
    } catch (error) {
      if (error instanceof HttpError) continue;
      console.warn(`  ⚠ [${documentId}] ${name} の取得に失敗: ${(error as Error).message}`);
      continue;
    }
    if (listTitle(xml) !== spec.targetTitle) continue;

    const { rows } = parseTable(xml);
    const sourceUrl = `${base}/xml/${name}`;
    for (const draft of spec.parse(rows)) {
      results.push({ ...draft, budgetType: spec.budgetType, documentId, sourceUrl });
    }
  }
  return results;
}

/** running_title「財務省所管　国債整理基金」を所管・特別会計名に分解する（所管の「所管」接尾辞を外す） */
function resolveSpecialScope(parts: string[]): { ministry: string; specialAccount: string } {
  const ministry = (parts[0] ?? '').replace(/所管$/, '');
  const specialAccount = parts[1] ?? '';
  return { ministry, specialAccount };
}

/**
 * 特別会計の決算（`75001`）を収集する。単一の集約帳票が無いため、メニューの
 * 全ファイルを対象に、running_titleから所管・特別会計名を取り、
 * parseSpecialSettlementFile で歳出区分の表だけを拾う（詳細は同関数のコメント参照）。
 * title_for_listの付け方がファイルごとに一貫しないため、当初予算・補正予算のように
 * targetTitleで絞り込むことができない
 */
async function collectSpecialSettlementEntries(fiscalYear: number): Promise<MOFSectionPageEntry[]> {
  const suffix = '75001';
  const budgetType: MOFBudgetType = '決算';
  const cacheDir = scrapeCacheDir(fiscalYear);
  const base = scrapeBase(fiscalYear);
  const documentId = `${fiscalYear}${suffix}`;
  let menu: string;
  try {
    menu = await fetchText(cacheDir, `${base}/html/${documentId}menu.html`, 'euc-jp', throttle, `${documentId}menu.html`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return [];
    console.warn(`  ⚠ [${documentId}] 目次の取得に失敗: ${(error as Error).message}`);
    return [];
  }

  const results: MOFSectionPageEntry[] = [];
  for (const name of extractXmlNames(menu)) {
    let xml: string;
    try {
      xml = await fetchText(cacheDir, `${base}/xml/${name}`, 'shift_jis', throttle, name);
    } catch (error) {
      if (error instanceof HttpError) continue;
      console.warn(`  ⚠ [${documentId}] ${name} の取得に失敗: ${(error as Error).message}`);
      continue;
    }
    const parts = splitRunningTitle(xml);
    if (parts.length < 2) continue; // 目次・索引等、勘定を持たないページはスキップ
    const { ministry, specialAccount } = resolveSpecialScope(parts);
    if (!ministry || !specialAccount) continue;

    const sourceUrl = `${base}/xml/${name}`;
    for (const draft of parseSpecialSettlementFile(xml, ministry, specialAccount)) {
      results.push({ ...draft, budgetType, documentId, sourceUrl });
    }
  }
  return results;
}

async function generateYear(fiscalYear: number): Promise<void> {
  const eraLabel = toEraLabel(fiscalYear);
  console.log(`\n=== ${eraLabel}（${fiscalYear}） 項の出典ページ ===`);

  const entries: MOFSectionPageEntry[] = [];
  for (const spec of DOCUMENTS) {
    const found = await collectEntries(fiscalYear, spec);
    entries.push(...found);
    console.log(`  ${spec.title}: ${found.length.toLocaleString()} 件`);
  }
  {
    const found = await collectSpecialSettlementEntries(fiscalYear);
    entries.push(...found);
    console.log(`  特別会計 歳入歳出決算（歳出）: ${found.length.toLocaleString()} 件`);
  }

  if (entries.length === 0) {
    console.warn(`  ⚠️  ${fiscalYear}年度は1件も取得できませんでした。スキップします。`);
    return;
  }

  const data: MOFSectionPageData = {
    metadata: {
      fiscalYear,
      eraLabel,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      notes: [
        '出典は「甲号歳入歳出予算」（一般会計）・「歳入歳出予算」（特別会計）・「収入支出予算」（政府関係機関）。' +
          '事項別内訳・科目別内訳とは独立した別帳票で、項コードを持たないため項名での一致でのみ突き合わせられる',
        '歳出側のみ収録。歳入側の値もこの表にあるが対応する既存データが無いため未取得',
        '予算種別は当初予算（一般会計・特別会計・政府関係機関）、補正予算（一般会計・特別会計）、' +
          '決算（一般会計・特別会計）に対応。政府関係機関の補正・決算、暫定予算は' +
          '対応する帳票が無い/構造が未調査のため未収録',
      ],
    },
    entries,
  };

  const outputFile = path.join(process.cwd(), 'public', 'data', `mof-section-pages-${fiscalYear}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 1));
  console.log(`  合計 ${entries.length.toLocaleString()}件`);
  console.log(`  出力: ${path.basename(outputFile)}`);
}

async function main(): Promise<void> {
  const years = process.argv.length > 2 ? process.argv.slice(2).map(v => parseInt(v, 10)) : DEFAULT_YEARS;
  if (years.some(y => isNaN(y) || y < 2000 || y > 2100)) {
    console.error(`Invalid fiscal year: ${process.argv.slice(2).join(' ')}`);
    process.exit(1);
  }
  console.log(`=== MOF 項の出典ページ 生成（対象: ${years.join(', ')}） ===`);
  for (const year of years) await generateYear(year);
  console.log(`\n完了: ${years.length} 年度分を生成しました。`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
