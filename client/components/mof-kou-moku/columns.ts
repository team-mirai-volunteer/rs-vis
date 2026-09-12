/**
 * 科目別内訳（項・目）一覧の列定義と並べ替えロジック。
 * `/mof-jikou` の columns.ts と同じ構成。ページ側は状態管理とレイアウトに専念させる。
 */

import type { MOFKouMokuAccountType, MOFKouMokuItem } from '@/types/mof-kou-moku';
import { changeRate, executionRate } from '@/client/components/mof-jikou/format';

export const ACCOUNT_LABEL: Record<MOFKouMokuAccountType, string> = {
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
  | 'objectiveName'
  | 'fiscalLawName'
  | 'economicNatureName'
  | 'purposeName'
  | 'subItemCode'
  | 'subItemName'
  | 'amount'
  | 'previousAmount'
  | 'difference'
  | 'rate'
  | 'currentAmount'
  | 'spent'
  | 'unused'
  | 'executionRate'
  /** 紐づくRS事業数。COLUMNSには含まれない特殊列（値がitem自体には無く、呼び出し側のlinkageByKeyから計算する） */
  | 'rs';

export type SortDir = 'asc' | 'desc';

export interface ColumnSpec {
  key: SortKey;
  label: string;
  width: number;
  numeric?: boolean;
  note?: string;
}

export const COLUMNS: ColumnSpec[] = [
  { key: 'budgetType', label: '予算種別', width: 76 },
  { key: 'accountType', label: '会計区分', width: 64 },
  { key: 'ministry', label: '所管', width: 150, note: '政府関係機関の帳票には所管の欄が無い' },
  {
    key: 'organization',
    label: '組織／特会／機関',
    width: 160,
    note: '一般会計は組織、特別会計は特別会計名、政府関係機関は機関名',
  },
  { key: 'subAccount', label: '勘定／業務', width: 110, note: '特別会計は勘定、政府関係機関は業務区分' },
  { key: 'sectionCode', label: '項', width: 48, note: '項コード（組織・勘定内の連番）' },
  { key: 'sectionName', label: '項名', width: 190 },
  {
    key: 'majorExpenseName',
    label: '主要経費',
    width: 120,
    note: '特別会計・政府関係機関の帳票には無いことがある',
  },
  { key: 'objectiveName', label: '目的別', width: 110, note: '政府関係機関の帳票には無い' },
  { key: 'fiscalLawName', label: '財政法公債金対象', width: 110, note: '一般会計にしか無い' },
  { key: 'economicNatureName', label: '経済性質別', width: 110, note: '政府関係機関の帳票には無い' },
  { key: 'purposeName', label: '使途別', width: 110 },
  { key: 'subItemCode', label: '目コード', width: 64 },
  { key: 'subItemName', label: '目名', width: 220, note: '支出の性質による分類（事項＝目的による分類とは別系統）' },
  { key: 'amount', label: '本年度額', width: 100, numeric: true, note: '補正は改予算額、決算は歳出予算額' },
  {
    key: 'previousAmount',
    label: '比較対象額',
    width: 100,
    numeric: true,
    note: '当初・暫定は前年度予算額、補正は補正前の成立予算額、決算は欄なし',
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
    note: '支出済 ÷ 歳出予算現額（決算のみ）',
  },
];

export const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map(c => [c.key, c.width])
);

/** リサイズで潰しすぎないための下限 */
export const MIN_COLUMN_WIDTH = 40;

/** 一般会計は組織、特別会計は特別会計名、政府関係機関は機関名 */
export function orgColumn(item: MOFKouMokuItem): string {
  if (item.accountType === 'general') return item.organization;
  if (item.accountType === 'special') return item.specialAccount;
  return item.agency;
}

function sortValue(item: MOFKouMokuItem, key: SortKey): string | number | null {
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
    case 'rs':
      // 呼び出し側（page.tsx）がlinkageByKeyを使って別途ソートするため、ここには来ない
      return null;
    default:
      return item[key];
  }
}

/**
 * 並べ替え。渡された配列を破壊的にソートして返す。
 * 項コードは会計により2桁/3桁が混在するため、対象がすべて数字のときだけ数値比較にする。
 */
export function sortItems(rows: MOFKouMokuItem[], sortKey: SortKey, sortDir: SortDir): MOFKouMokuItem[] {
  const numericSectionCode = sortKey === 'sectionCode' && rows.every(r => /^\d+$/.test(r.sectionCode));
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

/** 複数リンクがある場合に列・詳細パネルの代表として使う1件（金額降順） */
export function bestLink<T extends { rsAmount: number }>(links: T[]): T | null {
  if (links.length === 0) return null;
  return [...links].sort((a, b) => b.rsAmount - a.rsAmount)[0];
}
