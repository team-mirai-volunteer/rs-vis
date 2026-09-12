/**
 * 項一覧の列定義と並べ替えロジック。`/mof-kou-moku` の columns.ts と同じ構成。
 */

import type { MOFKouMokuAccountType } from '@/types/mof-kou-moku';
import type { MOFKouSectionSummary } from '@/types/mof-kou';

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
  | 'jikouCount'
  | 'kouMokuCount'
  | 'rsProjectCount'
  | 'amount'
  | 'previousAmount'
  | 'difference'
  | 'rate';

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
  { key: 'sectionName', label: '項名', width: 220 },
  { key: 'jikouCount', label: '事項数', width: 80, numeric: true, note: '目的別内訳（/mof-jikou）での件数' },
  { key: 'kouMokuCount', label: '目数', width: 72, numeric: true, note: '性質別内訳（/mof-kou-moku）での件数' },
  {
    key: 'rsProjectCount',
    label: 'RS事業数',
    width: 90,
    numeric: true,
    note: '目単位の完全一致で紐づいたRS事業の実数（重複除き）。政府関係機関は対象外',
  },
  { key: 'amount', label: '本年度額', width: 110, numeric: true, note: '目（kou-moku）側の合計' },
  { key: 'previousAmount', label: '前年度額', width: 110, numeric: true },
  { key: 'difference', label: '増減額', width: 100, numeric: true },
  { key: 'rate', label: '増減率', width: 84, numeric: true },
];

export const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(COLUMNS.map(c => [c.key, c.width]));

/** リサイズで潰しすぎないための下限 */
export const MIN_COLUMN_WIDTH = 40;

/** 一般会計は組織、特別会計は特別会計名、政府関係機関は機関名 */
export function orgColumn(row: MOFKouSectionSummary): string {
  if (row.accountType === 'general') return row.organization;
  if (row.accountType === 'special') return row.specialAccount;
  return row.agency;
}

function sortValue(row: MOFKouSectionSummary, key: SortKey): string | number | null {
  switch (key) {
    case 'accountType':
      return ACCOUNT_LABEL[row.accountType];
    case 'organization':
      return orgColumn(row);
    case 'rate': {
      if (row.previousAmount === null) return null;
      if (row.previousAmount === 0) return null; // 'new' 相当。数値ソートからは除外
      return (row.amount - row.previousAmount) / row.previousAmount;
    }
    default:
      return row[key];
  }
}

/**
 * 並べ替え。渡された配列を破壊的にソートして返す。
 * 項コードは会計により2桁/3桁が混在するため、対象がすべて数字のときだけ数値比較にする。
 */
export function sortItems(
  rows: MOFKouSectionSummary[],
  sortKey: SortKey,
  sortDir: SortDir
): MOFKouSectionSummary[] {
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
