/**
 * 財務省 予算書データベース Web帳票（XML）の共通ユーティリティ。
 *
 * `generate-mof-jikou-data.ts`（事項別内訳）と `generate-mof-kou-moku-data.ts`
 * （科目別内訳のページ特定）の両方が使う、ネットワーク取得・キャッシュ・
 * XMLテーブル復元のロジックをここに集約する。
 *
 * 帳票構造の詳細は docs/mof-budget-data-guide.md を参照。
 */

import * as fs from 'fs';
import * as path from 'path';

/** 1リクエストの上限。応答が止まったまま生成コマンドが固まるのを防ぐ */
export const FETCH_TIMEOUT_MS = 30_000;

/**
 * ブロック判定に使う常設ページ。帳票と無関係に常に 200 を返す。
 */
export const SENTINEL_URL = 'https://www.bb.mof.go.jp/hdocs/bxsselect.html';

/** HTTP エラー。ステータスで「帳票が無い(404)」と障害を区別するために持つ */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string
  ) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
  }
}

/**
 * 連続取得の間隔を制御するスロットラーを作る。呼び出し元ごとに独立した
 * インスタンスを持たせる（事項別内訳と科目別内訳を同一プロセスで両方
 * 走らせても、互いのタイマーを共有して意図せず待ち時間が変わらないように）。
 *
 * 300ms では複数年度を続けて回すと数分でブロックされた（2026-08 実測）ため 1 秒にしている。
 */
export function createThrottle(intervalMs = 1_000) {
  let lastFetchAt = 0;
  return async function throttle(): Promise<void> {
    const wait = lastFetchAt + intervalMs - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastFetchAt = Date.now();
  };
}

/**
 * 配信側が生きているかを確かめる。
 *
 * このサーバは過剰なアクセスを 429 ではなく 404 で弾く。404 をそのまま「帳票なし」と
 * 解釈すると、ブロックされている間は全帳票が欠番に見え、空の JSON が正常終了で出力される。
 * 本当の欠番と区別するために、常設ページを引けるかどうかで判定する。
 */
export async function isServerReachable(throttle: () => Promise<void>): Promise<boolean> {
  await throttle();
  try {
    const res = await fetch(SENTINEL_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 指定エンコーディングでテキストを取得する（キャッシュ名を渡すとXMLはキャッシュする） */
export async function fetchText(
  cacheDir: string,
  url: string,
  encoding: string,
  throttle: () => Promise<void>,
  cacheName?: string
): Promise<string> {
  if (cacheName) {
    const cached = path.join(cacheDir, cacheName);
    if (fs.existsSync(cached)) {
      return new TextDecoder(encoding).decode(fs.readFileSync(cached));
    }
  }
  await throttle();
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new HttpError(res.status, url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (cacheName) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, cacheName), buf);
  }
  return new TextDecoder(encoding).decode(buf);
}

/**
 * 目次 HTML（EUC-JP）から XML ファイル名を抽出する。
 * 目次は LineOut(階層, 子有無, 表題, リンク, 頁) を並べた JavaScript。
 * ここでは絞り込まず全リンクを返し、帳票の判別は XML の中身（title_for_list）で行う
 * （一般会計では目次の表題が組織名になっており、表題では絞れない）。
 */
export function extractXmlNames(menuHtml: string): string[] {
  const names = new Set<string>();
  const re = /LineOut\(\d+,\d+,"(?:.*?)","(.*?)","(?:.*?)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(menuHtml)) !== null) {
    const link = m[1].split('#')[0];
    // リンクはリモートの HTML 由来。そのままキャッシュのファイル名にすると
    // "../../outside.xml" のような値で cacheDir の外を読み書きできてしまうため、
    // ディレクトリ要素を含まない予算書のファイル名だけを通す。
    if (/^\d{9}[0-9a-z]*\.xml$/.test(link)) names.add(link);
  }
  return [...names];
}

/**
 * 表の1行。同じ列に複数のセルが現れうるため配列で持つ。
 * sub は clm の id 末尾の列内連番で、行の種別（例: 項行=1 / 目行=3）を区別する手がかりになる。
 */
export interface Cell {
  sub: number;
  text: string;
}

export interface ParsedRow {
  page: number;
  row: number;
  cols: Map<number, Cell[]>;
}

/** CDATA を連結してセルのテキストを得る（原文の折り返しごとに l 要素が分かれる） */
export function cellText(body: string): string {
  return [...body.matchAll(/CDATA\[([\s\S]*?)\]\]/g)].map(m => m[1]).join('');
}

/**
 * 本文 XML を表として復元する。
 *
 * セルは clm 要素の id="p{頁}-{行}.{行内連番}-{列}.{列内連番}" から位置が復元でき、
 * XSL を適用しなくても表を組み立てられる。
 *
 * 同じ (頁,行,列) に複数のセルが現れることがある（折り返し・「うち」書き）。
 * テキスト列は連結しないと名前が途中で切れるが、金額列を連結すると別の金額と
 * 繋がって桁が壊れる。そのため値は配列のまま保持し、textAt()（連結）と
 * numberAt()（先頭のみ）で使い分ける。
 */
export function parseTable(xml: string): { rows: ParsedRow[]; headerCols: Map<string, number> } {
  const rowMap = new Map<string, ParsedRow>();
  // id 属性の後に href 等の別属性が付くセルがある（決算帳票の所管・小計行が他ページへの
  // リンクを持つ等）。id="..." の直後に他属性が来ても拾えるよう空白+属性の並びを許容する。
  // ただし自己終了タグ `<clm .../>` まで拾うと、閉じタグを持たないためこのグループが
  // 次のセルの `</clm>` まで飲み込んでしまい、次のセルの内容がこちらに付き、次のセル
  // 自体が読み飛ばされる（セルがずれる）ため、`/>` は明示的に除外する
  const re = /<clm id="p(\d+)-(\d+)\.(\d+)-(\d+)\.(\d+)"(?:\s+[^>]*)?>([\s\S]*?)<\/clm>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const page = parseInt(m[1], 10);
    const row = parseInt(m[2], 10);
    const col = parseInt(m[4], 10);
    const key = `${page}:${row}`;
    let entry = rowMap.get(key);
    if (!entry) {
      entry = { page, row, cols: new Map() };
      rowMap.set(key, entry);
    }
    const cell: Cell = { sub: parseInt(m[5], 10), text: cellText(m[6]) };
    const values = entry.cols.get(col);
    if (values) values.push(cell);
    else entry.cols.set(col, [cell]);
  }
  const rows = [...rowMap.values()].sort((a, b) => a.page - b.page || a.row - b.row);

  // ヘッダ行の列位置（見出し文字列 -> 列番号）
  const headerCols = new Map<string, number>();
  const headerMatch = xml.match(/<header>([\s\S]*?)<\/header>/);
  if (headerMatch) {
    const hre = /<clm id="p\d+-\d+\.\d+-(\d+)\.\d+"(?:\s+[^>]*)?>([\s\S]*?)<\/clm>/g;
    let h: RegExpExecArray | null;
    while ((h = hre.exec(headerMatch[1])) !== null) {
      const label = cellText(h[2]).trim();
      if (label && !headerCols.has(label)) headerCols.set(label, parseInt(h[1], 10));
    }
  }
  return { rows, headerCols };
}

/** テキストとして読む（同一セルの複数候補を連結） */
export function textAt(row: ParsedRow, col: number | undefined): string {
  if (col === undefined) return '';
  return (row.cols.get(col) ?? []).map(c => c.text).join('').trim();
}

/** そのセルの列内連番。行の種別判定に使う */
export function subAt(row: ParsedRow, col: number): number | null {
  return (row.cols.get(col) ?? [])[0]?.sub ?? null;
}

/**
 * 金額として読む（先頭の候補のみ。連結すると桁が壊れる）。
 * scale は帳票の単位を円に直す倍率（予算書は千円単位なので 1000、決算書は 1）。
 */
export function numberAt(row: ParsedRow, col: number | undefined, scale: number): number | null {
  if (col === undefined) return null;
  const first = (row.cols.get(col) ?? [])[0]?.text.trim() ?? '';
  const negative = first.includes('△');
  const digits = first.replace(/[△\s,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = parseInt(digits, 10) * scale;
  return negative ? -value : value;
}

/** running_title「内閣府所管  内閣本府」を階層に分解する */
export function splitRunningTitle(xml: string): string[] {
  const m = xml.match(/<running_title>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (!m) return [];
  return m[1]
    .trim()
    .split(/[ \t　]{2,}|　/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** title_for_list を取り出す（帳票の判別に使う） */
export function listTitle(xml: string): string {
  const m = xml.match(/<title_for_list>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1].trim() : '';
}
