/**
 * 財務省 予算書・決算書「事項別内訳」スクレイピング＆JSON生成スクリプト
 *
 * 予算書 ZIP に同梱される CSV は科目別内訳（目レベル）のみで、事項名と説明文を含まない。
 * そのため予算書データベースの Web 帳票（XML）から事項を直接取得する。
 *
 * 使用法:
 *   tsx scripts/generate-mof-jikou-data.ts [FISCAL_YEAR...]
 *   例: tsx scripts/generate-mof-jikou-data.ts 2026
 *       tsx scripts/generate-mof-jikou-data.ts 2023 2024 2025 2026
 *   デフォルト: 2017〜2026（10年度分）
 *
 * 出力: public/data/mof-jikou-{FISCAL_YEAR}.json（年度ごとに1ファイル）
 * XMLキャッシュ: data/download/mof_{FISCAL_YEAR}/xml/
 *
 * 取り込む帳票（DOCUMENTS 参照）。年度により存在しないものは 404 でスキップする:
 *   当初予算 一般会計(11001) / 特別会計(12001) / 政府関係機関(13001)
 *   暫定予算 一般会計(31001) / 特別会計(32001) / 政府関係機関(33001)
 *   補正予算 一般会計(21001) / 特別会計(22001)
 *   決算     一般会計(77001)  ※特別会計(78001)・政府関係機関(76001)に事項別内訳は無い
 *
 * 帳票構造・コード表は docs/mof-budget-data-guide.md を参照。
 */

import * as fs from 'fs';
import * as path from 'path';
import { MAJOR_EXPENSE as MOF_MAJOR_EXPENSE } from '@/scripts/mof-major-expense';
import {
  MOF_REVISION_NUMBERS,
  revisedBudgetType,
  type MOFAccountType,
  type MOFBudgetType,
  type MOFJikouData,
  type MOFJikouGroupSummary,
  type MOFJikouItem,
} from '@/types/mof-jikou';

/** 対象年度。引数が無ければ収録済みの全年度 */
const DEFAULT_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const FISCAL_YEARS = (
  process.argv.length > 2 ? process.argv.slice(2).map(v => parseInt(v, 10)) : DEFAULT_YEARS
).sort((a, b) => a - b);
if (FISCAL_YEARS.some(y => isNaN(y) || y < 2000 || y > 2100)) {
  console.error(`Invalid fiscal year: ${process.argv.slice(2).join(' ')}`);
  process.exit(1);
}

/** 年度ごとに変わる置き場をまとめたもの（年度をまたいで生成するため引き回す） */
interface YearContext {
  fiscalYear: number;
  base: string;
  cacheDir: string;
  outputFile: string;
}

function createContext(fiscalYear: number): YearContext {
  return {
    fiscalYear,
    base: `https://www.bb.mof.go.jp/server/${fiscalYear}`,
    cacheDir: path.join(process.cwd(), 'data', 'download', `mof_${fiscalYear}`, 'xml'),
    outputFile: path.join(process.cwd(), 'public', 'data', `mof-jikou-${fiscalYear}.json`),
  };
}

/**
 * 表のレイアウト。
 *
 * - standard: 「事項」が独立した見出し列を持つ（当初予算・暫定予算）。
 *   列位置は <header> から解決する（一般会計と特別会計で1列ずれるため）。
 * - revised: 補正予算。組織・項・事項が1列に畳まれ、金額欄が
 *   成立予算額／補正要求追加額／修正減少額／差引額／改予算額の5本になる。
 * - settlement: 決算。事項表のヘッダ行が <header> ではなく本文中にあり、
 *   ページごとに再出現する。金額は円単位で、予算額から不用額までの9本を持つ。
 */
type TableLayout = 'standard' | 'revised' | 'settlement';

interface DocumentSpec {
  /** 帳票IDの年度に続く部分（例: 11001） */
  suffix: string;
  accountType: MOFAccountType;
  budgetType: MOFBudgetType;
  /**
   * 事項別内訳ページの title_for_list。帳票の判別に使う。
   * 決算は title_for_list が組織名になるため空にし、running_title で判別する。
   */
  listTitle: string;
  layout: TableLayout;
  /** 帳票の金額を円に直す倍率。予算書は千円単位、決算書は円単位 */
  unitScale: number;
  title: string;
}

const DOCUMENTS: DocumentSpec[] = [
  { suffix: '11001', accountType: 'general', budgetType: '当初予算', listTitle: '〔組織別事項別内訳〕', layout: 'standard', unitScale: 1000, title: '一般会計予算（当初予算）' },
  { suffix: '12001', accountType: 'special', budgetType: '当初予算', listTitle: '歳出 事項別内訳', layout: 'standard', unitScale: 1000, title: '特別会計予算（当初予算）' },
  { suffix: '13001', accountType: 'agency', budgetType: '当初予算', listTitle: '支出 事項別内訳', layout: 'standard', unitScale: 1000, title: '政府関係機関予算（当初予算）' },
  { suffix: '31001', accountType: 'general', budgetType: '暫定予算', listTitle: '〔組織別事項別内訳〕', layout: 'standard', unitScale: 1000, title: '一般会計予算（暫定予算）' },
  { suffix: '32001', accountType: 'special', budgetType: '暫定予算', listTitle: '歳出 事項別内訳', layout: 'standard', unitScale: 1000, title: '特別会計予算（暫定予算）' },
  { suffix: '33001', accountType: 'agency', budgetType: '暫定予算', listTitle: '支出 事項別内訳', layout: 'standard', unitScale: 1000, title: '政府関係機関予算（暫定予算）' },
  ...revisedDocuments(),
  { suffix: '77001', accountType: 'general', budgetType: '決算', listTitle: '', layout: 'settlement', unitScale: 1, title: '一般会計 歳出決算報告書' },
];

/**
 * 補正予算の帳票を号数ぶん並べる。
 *
 * 帳票IDの連番が号数（`21001`=第1号、`21002`=第2号）。年度により成立回数が違い、
 * 10年度分では平成30年度・令和2年度・令和4年度に第2号以降がある。
 * 存在しない号数は 404 になり、呼び出し側が欠番として飛ばす。
 */
function revisedDocuments(): DocumentSpec[] {
  const specs: DocumentSpec[] = [];
  for (const revision of MOF_REVISION_NUMBERS) {
    const seq = String(revision).padStart(3, '0');
    specs.push({
      suffix: `21${seq}`,
      accountType: 'general',
      budgetType: revisedBudgetType(revision),
      listTitle: '〔組織別事項別内訳〕',
      layout: 'revised',
      unitScale: 1000,
      title: `一般会計予算（補正予算第${revision}号）`,
    });
    specs.push({
      suffix: `22${seq}`,
      accountType: 'special',
      budgetType: revisedBudgetType(revision),
      listTitle: '歳出 事項別内訳',
      layout: 'revised',
      unitScale: 1000,
      // 特別会計の帳票名は「特第N号」表記
      title: `特別会計予算（補正予算特第${revision}号）`,
    });
  }
  return specs;
}

const MAJOR_EXPENSE = MOF_MAJOR_EXPENSE;

/**
 * 金額列の見出しに現れる年度表記。
 * 平成年度の帳票（平成29年度〜）と令和元年度（「令和1年度」ではなく「令和元年度」）を含む。
 */
const ERA_YEAR_PREFIX = /^(令和|平成)(元|\d+)年度/;

/** 会計年度（西暦）を元号表記に直す。2019年度は改元年で「令和元年度」 */
function toEraLabel(fiscalYear: number): string {
  if (fiscalYear <= 2018) return `平成${fiscalYear - 1988}年度`;
  if (fiscalYear === 2019) return '令和元年度';
  return `令和${fiscalYear - 2018}年度`;
}

/**
 * ネットワーク取得・キャッシュ・XMLテーブル復元は scripts/mof-budget-xml.ts に集約されている
 * （generate-mof-kou-moku-data.ts の科目別内訳ページ特定と共用するため）。
 */
import {
  createThrottle,
  extractXmlNames,
  fetchText as fetchTextRaw,
  HttpError,
  isServerReachable as isServerReachableRaw,
  listTitle,
  numberAt,
  parseTable,
  SENTINEL_URL,
  splitRunningTitle,
  subAt,
  textAt,
  type ParsedRow,
} from '@/scripts/mof-budget-xml';

/**
 * 連続取得の間隔。1年度あたり250ページ超を取りに行くので、
 * 間を空けないと配信側に一時的に弾かれる（実測で 404 が返るようになった）。
 * 300ms では複数年度を続けて回すと数分でブロックされた（2026-08 実測）ため 1 秒にしている。
 */
const FETCH_INTERVAL_MS = 1_000;
const throttle = createThrottle(FETCH_INTERVAL_MS);

/** 指定エンコーディングでテキストを取得する（XMLはキャッシュする） */
async function fetchText(ctx: YearContext, url: string, encoding: string, cacheName?: string): Promise<string> {
  return fetchTextRaw(ctx.cacheDir, url, encoding, throttle, cacheName);
}

async function isServerReachable(): Promise<boolean> {
  return isServerReachableRaw(throttle);
}

interface Scope {
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
}

/** running_title から所管・組織・特会・勘定・機関を割り当てる */
function resolveScope(spec: DocumentSpec, parts: string[]): Scope {
  // running_title は「内閣府所管  内閣本府」の形。末尾の「所管」を落とすと
  // CSV（DL...b.csv）の 所管 列と同じ表記になり、科目データと突き合わせやすい。
  // 決算は「内閣府所管  歳出決算報告書  内閣本府」と帳票名が挟まる。
  const cleaned = parts.filter(p => p !== '歳出決算報告書');
  const first = (cleaned[0] ?? '').replace(/所管$/, '');
  const second = cleaned[1] ?? '';
  const third = cleaned[2] ?? '';
  if (spec.accountType === 'general') {
    // 皇室費のように組織が印字されない帳票は、所管をそのまま組織名とする（CSV も同じ扱い）
    return { ministry: first, organization: second || first, specialAccount: '', subAccount: '', agency: '' };
  }
  if (spec.accountType === 'special') {
    return { ministry: first, organization: '', specialAccount: second, subAccount: third, agency: '' };
  }
  // 政府関係機関は running_title が「沖縄振興開発金融公庫」または「機関名  業務名」
  return { ministry: '', organization: '', specialAccount: '', subAccount: second, agency: cleaned[0] ?? '' };
}

/** 内容ベースの合成キー（MOF は事項に公式なIDを振っていない） */
function buildKey(item: Omit<MOFJikouItem, 'key'>): string {
  return [
    item.accountType,
    item.budgetType,
    item.ministry,
    item.organization,
    item.specialAccount,
    item.subAccount,
    item.agency,
    item.sectionCode,
    item.name,
  ].join('|');
}

/** 実績側のフィールドを持たない（予算の帳票用）空の値 */
const NO_EXECUTION = {
  currentAmount: null,
  spent: null,
  carriedOver: null,
  unused: null,
} as const;

/** 1件分の共通フィールドを組み立てる */
function baseItem(
  spec: DocumentSpec,
  ctx: YearContext,
  scope: Scope,
  row: ParsedRow,
  fileName: string
) {
  return {
    id: `${spec.accountType}-${ctx.fiscalYear}${spec.suffix}-${row.page}-${row.row}`,
    accountType: spec.accountType,
    budgetType: spec.budgetType,
    documentId: `${ctx.fiscalYear}${spec.suffix}`,
    ...scope,
    page: row.page,
    sourceUrl: `${ctx.base}/xml/${fileName}`,
  };
}

/** standard レイアウト（当初予算・暫定予算）の1ページを抽出する */
function extractStandard(
  rows: ParsedRow[],
  headerCols: Map<string, number>,
  spec: DocumentSpec,
  ctx: YearContext,
  scope: Scope,
  fileName: string
): Array<Omit<MOFJikouItem, 'key'>> {
  const jikouHeaderCol = headerCols.get('事項');
  if (jikouHeaderCol === undefined) return [];
  // 一般会計・特別会計は「事項」見出しが主要経費コード列にかかっており、事項名は1つ右。
  // 政府関係機関には主要経費の列が無く、事項名が見出しの列にそのまま入る。
  // 見出し列に2桁コードが並んでいるかで判別する。
  const hasMajorExpense = rows.some(r => /^\d{2}$/.test(textAt(r, jikouHeaderCol)));
  const colName = hasMajorExpense ? jikouHeaderCol + 1 : jikouHeaderCol;
  const colMajorExpense = hasMajorExpense ? jikouHeaderCol : undefined;
  const colSectionName = jikouHeaderCol - 1;
  const colSectionCode = jikouHeaderCol - 2;
  // 当初は「令和8年度」、暫定は「令和8年度暫定予算」。前方一致で拾う。
  // 平成年度の帳票と令和元年度（「令和元年度」表記）も拾えるよう元号と「元」を許容する
  const colAmount = [...headerCols.entries()].find(([k]) => ERA_YEAR_PREFIX.test(k))?.[1];
  const colPrev = headerCols.get('前年度予算額') ?? headerCols.get('前年度');
  const colDiff = [...headerCols.entries()].find(([k]) => k.startsWith('比較増'))?.[1];
  const colDescription = headerCols.get('説明');
  if (colAmount === undefined) return [];

  const items: Array<Omit<MOFJikouItem, 'key'>> = [];
  let currentSectionCode = '';
  let currentSectionName = '';

  for (const row of rows) {
    // 項は最初の行にだけ印字され、以降の事項行は空欄で継続する。
    // ただし「説明」欄には数量の内訳表（種別／千トン等）が埋め込まれることがあり、
    // その行も同じ列番号を使うため、項コードが数字であることを条件に取り違えを防ぐ
    // （例: 食料安定供給特別会計 食糧管理勘定 p.348 の「大麦等 172」）。
    // 項コードと項名は必ずセットで印字されるので、両方揃った行でだけ更新する。
    const code = textAt(row, colSectionCode);
    const section = textAt(row, colSectionName);
    if (/^\d+$/.test(code) && section) {
      currentSectionCode = code;
      currentSectionName = section;
    }

    const name = textAt(row, colName);
    const amount = numberAt(row, colAmount, spec.unitScale);
    if (!name || amount === null) continue;

    const majorExpenseCode = textAt(row, colMajorExpense);
    items.push({
      ...baseItem(spec, ctx, scope, row, fileName),
      sectionCode: currentSectionCode,
      sectionName: currentSectionName,
      majorExpenseCode,
      majorExpenseName: MAJOR_EXPENSE[majorExpenseCode] ?? '',
      name,
      amount,
      previousAmount: numberAt(row, colPrev, spec.unitScale),
      difference: numberAt(row, colDiff, spec.unitScale),
      description: textAt(row, colDescription),
      ...NO_EXECUTION,
    });
  }
  return items;
}

/**
 * revised レイアウト（補正予算）の1ページを抽出する。
 *
 * 組織・項・事項が1列に畳まれており、階層は clm の id 末尾の列内連番で表される。
 * 名前列（col 2）の連番が 1 なら項、2 なら事項。一般会計では組織が col 1 だけの行になる。
 * コードの桁数では判別できない（特別会計は項コードも主要経費コードも2桁）。
 *
 * 金額の列位置は帳票により異なる（一般会計は 3〜7、特別会計は 3・4・6・7・9）ため、
 * 見出し行の文字列から解決する。当初予算と揃えるため
 * amount=改予算額、previousAmount=補正前の成立予算額、difference=差引額 とする。
 */
function extractRevised(
  rows: ParsedRow[],
  spec: DocumentSpec,
  ctx: YearContext,
  scope: Scope,
  fileName: string
): Array<Omit<MOFJikouItem, 'key'>> {
  // 見出し行（col 1 に「事項」を含む行）から金額列を解決する
  const header = rows.find(r => textAt(r, 1).includes('事項'));
  if (!header) return [];
  const label = (col: number) => textAt(header, col);
  const findCol = (match: (s: string) => boolean) =>
    [...header.cols.keys()].sort((a, b) => a - b).find(c => match(label(c)));
  const colSettled = findCol(s => s.includes('成立予算額'));
  const colDiff = findCol(s => s.includes('差引額'));
  const colRevised = findCol(s => /^改(令和|平成)(元|\d+)年度/.test(s));
  const colDescription = findCol(s => s === '説明');
  if (colRevised === undefined) return [];

  const items: Array<Omit<MOFJikouItem, 'key'>> = [];
  let currentSectionCode = '';
  let currentSectionName = '';

  for (const row of rows) {
    if (row === header) continue;
    const name = textAt(row, 2);
    if (!name) continue; // 組織だけの行
    const level = subAt(row, 2);
    const code = textAt(row, 1);
    if (level === 1) {
      currentSectionCode = code;
      currentSectionName = name;
      continue;
    }
    if (level !== 2) continue;

    const amount = numberAt(row, colRevised, spec.unitScale);
    if (amount === null) continue;
    items.push({
      ...baseItem(spec, ctx, scope, row, fileName),
      sectionCode: currentSectionCode,
      sectionName: currentSectionName,
      majorExpenseCode: code,
      majorExpenseName: MAJOR_EXPENSE[code] ?? '',
      name,
      amount,
      previousAmount: numberAt(row, colSettled, spec.unitScale),
      difference: numberAt(row, colDiff, spec.unitScale),
      description: textAt(row, colDescription),
      ...NO_EXECUTION,
    });
  }
  return items;
}

/**
 * settlement レイアウト（決算）の1ページを抽出する。
 *
 * 決算では事項表のヘッダ行が <header> に入っていない。<header> にあるのは組織単位の
 * 総括表の見出しだけで、事項表の見出しは本文の行として現れ、しかもページごとに
 * 再出現する。そのため本文を走査してヘッダ行を見つけるたびに列位置を取り直す。
 * これをやらないと総括表や小計の行まで拾って総額が2倍以上に膨れる。
 */
function extractSettlement(
  rows: ParsedRow[],
  spec: DocumentSpec,
  ctx: YearContext,
  scope: Scope,
  fileName: string
): Array<Omit<MOFJikouItem, 'key'>> {
  const items: Array<Omit<MOFJikouItem, 'key'>> = [];
  let cols: Map<string, number> | null = null;
  let currentSectionCode = '';
  let currentSectionName = '';

  for (const row of rows) {
    // ヘッダ行の判定: 「事項」と「支出済歳出額(円)」の両方を持つ行
    const labels = new Map<string, number>();
    for (const col of row.cols.keys()) {
      const label = textAt(row, col);
      if (label && !labels.has(label)) labels.set(label, col);
    }
    if (labels.has('事項') && labels.has('支出済歳出額(円)')) {
      cols = labels;
      currentSectionCode = '';
      currentSectionName = '';
      continue;
    }
    if (!cols) continue;

    const jikouCol = cols.get('事項')!;
    const code = textAt(row, jikouCol - 2);
    const section = textAt(row, jikouCol - 1);
    if (/^\d+$/.test(code) && section) {
      currentSectionCode = code;
      currentSectionName = section;
    }

    const name = textAt(row, jikouCol + 1);
    // 事項名が空・数字のみの行は小計や見出しなので捨てる
    if (!name || /^[\d,]+$/.test(name)) continue;
    const amount = numberAt(row, cols.get('歳出予算額(円)'), spec.unitScale);
    if (amount === null) continue;

    const majorExpenseCode = textAt(row, jikouCol);
    items.push({
      ...baseItem(spec, ctx, scope, row, fileName),
      sectionCode: currentSectionCode,
      sectionName: currentSectionName,
      majorExpenseCode,
      majorExpenseName: MAJOR_EXPENSE[majorExpenseCode] ?? '',
      name,
      amount,
      // 決算に前年度比の欄は無い
      previousAmount: null,
      difference: null,
      // 決算の説明欄は組織単位の備考しかなく、事項には付かない
      description: '',
      currentAmount: numberAt(row, cols.get('歳出予算現額(円)'), spec.unitScale),
      spent: numberAt(row, cols.get('支出済歳出額(円)'), spec.unitScale),
      carriedOver: numberAt(row, cols.get('翌年度繰越額(円)'), spec.unitScale),
      unused: numberAt(row, cols.get('差引額(円)'), spec.unitScale),
    });
  }
  return items;
}

function groupBy(
  items: MOFJikouItem[],
  key: (i: MOFJikouItem) => string
): MOFJikouGroupSummary[] {
  const map = new Map<string, MOFJikouGroupSummary>();
  for (const item of items) {
    const k = key(item);
    const cur = map.get(k) ?? { key: k, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += item.amount;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

const ACCOUNT_LABEL: Record<MOFAccountType, string> = {
  general: '一般会計',
  special: '特別会計',
  agency: '政府関係機関',
};

/** そのページが対象の帳票かを判定する */
function matchesDocument(spec: DocumentSpec, xml: string): boolean {
  if (spec.layout === 'settlement') {
    // 決算は title_for_list が組織名になるため running_title で判別する
    return splitRunningTitle(xml).includes('歳出決算報告書');
  }
  return listTitle(xml) === spec.listTitle;
}

async function collect(
  ctx: YearContext,
  spec: DocumentSpec
): Promise<{ items: MOFJikouItem[]; pages: number }> {
  const documentId = `${ctx.fiscalYear}${spec.suffix}`;
  const menu = await fetchText(
    ctx,
    `${ctx.base}/html/${documentId}menu.html`,
    'euc-jp',
    `${documentId}menu.html`
  );
  const names = extractXmlNames(menu);

  const items: MOFJikouItem[] = [];
  let pages = 0;
  for (const name of names) {
    const xml = await fetchText(ctx, `${ctx.base}/xml/${name}`, 'shift_jis', name);
    if (!matchesDocument(spec, xml)) continue;
    pages += 1;
    const { rows, headerCols } = parseTable(xml);
    const scope = resolveScope(spec, splitRunningTitle(xml));
    const raw =
      spec.layout === 'revised'
        ? extractRevised(rows, spec, ctx, scope, name)
        : spec.layout === 'settlement'
          ? extractSettlement(rows, spec, ctx, scope, name)
          : extractStandard(rows, headerCols, spec, ctx, scope, name);
    items.push(...raw.map(i => ({ ...i, key: buildKey(i) })));
  }
  console.log(
    `  [${documentId}] ${spec.title}: ${pages} ページ / 事項 ${items.length} 件 ` +
      `/ ${(items.reduce((s, i) => s + i.amount, 0) / 1e12).toFixed(1)} 兆円`
  );
  return { items, pages };
}

async function generateYear(fiscalYear: number): Promise<boolean> {
  const ctx = createContext(fiscalYear);
  const eraLabel = toEraLabel(fiscalYear);
  console.log(`\n=== ${eraLabel}（${fiscalYear}） ===`);

  const items: MOFJikouItem[] = [];
  const documents: MOFJikouData['metadata']['documents'] = [];

  for (const spec of DOCUMENTS) {
    const documentId = `${fiscalYear}${spec.suffix}`;
    try {
      const { items: docItems, pages } = await collect(ctx, spec);
      items.push(...docItems);
      documents.push({
        documentId,
        accountType: spec.accountType,
        budgetType: spec.budgetType,
        title: spec.title,
        url: `${ctx.base}/html/${documentId}Main.html`,
        pages,
        count: docItems.length,
      });
    } catch (error) {
      // 年度によっては暫定予算・補正予算・決算が存在しない。その 404 だけを欠番として飛ばし、
      // 通信障害・サーバエラー・パーサの退行は握り潰さずに失敗させる
      // （部分的な JSON が正常終了で出力されるのを防ぐ）。
      if (error instanceof HttpError && error.status === 404) {
        // 404 は「帳票なし」とアクセス制限の両方で返る。常設ページで切り分ける
        if (!(await isServerReachable())) {
          throw new Error(
            `[${documentId}] が 404 になり、常設ページ（${SENTINEL_URL}）も引けません。` +
              'アクセスを制限されている可能性が高いため中断します。' +
              `時間を空けてから再実行してください（現在の取得間隔 ${FETCH_INTERVAL_MS}ms）。`
          );
        }
        console.log(`  [${documentId}] 帳票なし（404）`);
        continue;
      }
      throw error;
    }
  }

  if (items.length === 0) {
    console.warn(`  ⚠️  ${fiscalYear}年度は事項が1件も取得できませんでした。スキップします。`);
    return false;
  }

  const duplicates = items.length - new Set(items.map(i => i.key)).size;
  if (duplicates > 0) console.warn(`  ⚠️  合成キーの重複が ${duplicates} 件あります`);

  const data: MOFJikouData = {
    metadata: {
      fiscalYear,
      eraLabel,
      budgetTypes: [...new Set(documents.filter(d => d.count > 0).map(d => d.budgetType))],
      documents,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      notes: [
        '全金額は円単位です（予算書の印字は千円単位、決算書は円単位。生成時に円へ揃えています）',
        '事項は「項の下に置かれた経費のまとまり」で、行政事業レビューの事業とは1対1に対応しません（1事項あたり平均4事業）',
        '当初予算・暫定予算・補正予算・決算は別々の帳票です。予算種別をまたいで合算しないでください',
        '一般会計・特別会計・政府関係機関の金額を単純合算すると会計間の繰入が二重計上されます',
        '補正予算の金額は amount=改予算額 / previousAmount=補正前の成立予算額 / difference=差引額 です',
        '決算の amount は歳出予算額です。現額・支出済・翌年度繰越・不用額は別フィールドに入ります',
        '決算の事項別内訳は一般会計にしかありません（特別会計・政府関係機関の決算は科目レベルまで）',
        '暫定予算には比較欄が無いため previousAmount と difference は null です',
        '出典は財務省 予算書・決算書データベースの Web 帳票です（ZIP同梱のCSVには事項名・説明文が含まれないため）',
      ],
    },
    summary: {
      count: items.length,
      byAccountType: groupBy(items, i => ACCOUNT_LABEL[i.accountType]),
      byBudgetType: groupBy(items, i => i.budgetType),
      byMinistry: groupBy(items, i => i.ministry || i.agency),
      byMajorExpense: groupBy(items, i => i.majorExpenseName || `(未定義:${i.majorExpenseCode})`),
    },
    items,
  };

  fs.mkdirSync(path.dirname(ctx.outputFile), { recursive: true });
  fs.writeFileSync(ctx.outputFile, JSON.stringify(data), 'utf-8');
  const sizeKB = (fs.statSync(ctx.outputFile).size / 1024).toFixed(0);
  console.log(`  出力: ${path.basename(ctx.outputFile)} (${sizeKB} KB) / 事項 ${items.length} 件`);
  for (const g of data.summary.byBudgetType) {
    console.log(`    ${g.key}: ${g.count} 件 / ${(g.amount / 1e12).toFixed(1)} 兆円`);
  }
  return true;
}

async function main() {
  console.log(`=== MOF 事項別内訳データ生成（対象: ${FISCAL_YEARS.join(', ')}） ===`);
  let generated = 0;
  for (const year of FISCAL_YEARS) {
    if (await generateYear(year)) generated += 1;
  }
  if (generated === 0) {
    console.error('\n事項を1件も取得できませんでした。年度または帳票構造を確認してください。');
    process.exit(1);
  }
  console.log(`\n完了: ${generated} 年度分を生成しました。`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
