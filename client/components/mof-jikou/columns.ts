/**
 * 事項一覧の列定義と並べ替えロジック。
 * ページ側は状態管理とレイアウトに専念させ、表の構造はここに閉じる。
 */

import type { MOFAccountType, MOFJikouItem } from '@/types/mof-jikou';
import { changeRate, executionRate } from './format';

export const ACCOUNT_LABEL: Record<MOFAccountType, string> = {
  general: '一般会計',
  special: '特別会計',
  agency: '政府関係機関',
};

/** ソート可能な列 */
export type SortKey =
  | 'budgetType'
  | 'accountType'
  | 'ministry'
  | 'organization'
  | 'subAccount'
  | 'sectionCode'
  | 'sectionName'
  | 'majorExpenseName'
  | 'name'
  | 'amount'
  | 'previousAmount'
  | 'difference'
  | 'rate'
  | 'currentAmount'
  | 'spent'
  | 'unused'
  | 'executionRate';

export type SortDir = 'asc' | 'desc';

export interface ColumnSpec {
  key: SortKey;
  label: string;
  /** 既定の列幅（px）。table-fixed なのでソートで中身が変わっても幅は動かない */
  width: number;
  /** 数値列は右寄せ・降順スタート */
  numeric?: boolean;
  note?: string;
}

export const COLUMNS: ColumnSpec[] = [
  { key: 'budgetType', label: '予算種別', width: 96, note: '行頭の▶で年度推移を展開' },
  { key: 'accountType', label: '会計区分', width: 64 },
  { key: 'ministry', label: '所管', width: 150 },
  {
    key: 'organization',
    label: '組織／特会',
    width: 160,
    note: '一般会計は組織、特別会計は会計名、政府関係機関は機関名',
  },
  { key: 'subAccount', label: '勘定／業務', width: 130 },
  { key: 'sectionCode', label: '項', width: 48, note: '項コード（組織・勘定内の連番）' },
  { key: 'sectionName', label: '項名', width: 190 },
  {
    key: 'majorExpenseName',
    label: '主要経費',
    width: 130,
    note: '政府関係機関の帳票には主要経費の列が無い',
  },
  { key: 'name', label: '事項名', width: 340 },
  { key: 'amount', label: '本年度額', width: 100, numeric: true },
  {
    key: 'previousAmount',
    label: '比較対象額',
    width: 100,
    numeric: true,
    note: '当初は前年度予算額、補正は補正前の成立予算額、暫定は欄なし',
  },
  { key: 'difference', label: '増減額', width: 100, numeric: true },
  { key: 'rate', label: '増減率', width: 84, numeric: true },
  // 以下は決算の帳票にだけ値が入る
  {
    key: 'currentAmount',
    label: '現額',
    width: 100,
    numeric: true,
    note: '歳出予算現額（決算のみ）。歳出予算額＋前年度繰越＋予備費使用＋流用等＋移替',
  },
  { key: 'spent', label: '支出済', width: 100, numeric: true, note: '支出済歳出額（決算のみ）' },
  { key: 'unused', label: '不用額', width: 100, numeric: true, note: '決算のみ' },
  {
    key: 'executionRate',
    label: '執行率',
    width: 78,
    numeric: true,
    note: '支出済歳出額 ÷ 歳出予算現額（決算のみ）',
  },
];

export const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map(c => [c.key, c.width])
);

/** リサイズで潰しすぎないための下限 */
export const MIN_COLUMN_WIDTH = 40;

/** 一般会計は組織、特別会計は会計名、政府関係機関は機関名 */
export function orgColumn(item: MOFJikouItem): string {
  if (item.accountType === 'general') return item.organization;
  if (item.accountType === 'special') return item.specialAccount;
  return item.agency;
}

/** ソート用の値を取り出す。sectionCode の数値化は sortItems 側で判定する */
function sortValue(item: MOFJikouItem, key: SortKey): string | number | null {
  switch (key) {
    case 'accountType':
      return ACCOUNT_LABEL[item.accountType];
    case 'organization':
      return orgColumn(item);
    case 'rate': {
      const r = changeRate(item.amount, item.previousAmount);
      return r === null || r === 'new' ? null : r;
    }
    case 'executionRate':
      return executionRate(item);
    default:
      return item[key];
  }
}

/**
 * 並べ替え。渡された配列を破壊的にソートして返す。
 *
 * 項コードは会計により2桁/3桁が混在するため、対象がすべて数字のときだけ数値比較にする
 * （文字列比較だと "01" と "001" のようなゼロ埋めの差で順序が崩れる）。
 * null（該当欄が無い帳票）は方向によらず末尾へ送る。
 */
export function sortItems(
  rows: MOFJikouItem[],
  sortKey: SortKey,
  sortDir: SortDir
): MOFJikouItem[] {
  const numericSectionCode =
    sortKey === 'sectionCode' && rows.every(r => /^\d+$/.test(r.sectionCode));
  const factor = sortDir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const va = numericSectionCode ? Number(a.sectionCode) : sortValue(a, sortKey);
    const vb = numericSectionCode ? Number(b.sectionCode) : sortValue(b, sortKey);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
    return String(va).localeCompare(String(vb), 'ja') * factor;
  });
}

/** その列を新たに選んだときの既定の並び順 */
export function defaultDirFor(column: ColumnSpec): SortDir {
  return column.numeric ? 'desc' : 'asc';
}

