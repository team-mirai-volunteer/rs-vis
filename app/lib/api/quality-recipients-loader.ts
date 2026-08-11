/**
 * project-quality-recipients-{YEAR}.json（支出行データ）の読み込み・メモリキャッシュ。
 * /api/quality-scores/recipients、/api/search/spending、AIチャットの search_spending ツールが共用する。
 * 型・読み込みロジックの正典はこのファイル（route.ts 側に重複定義を置かないこと）。
 */
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { readDataJson } from '@/app/lib/api/data-file';
import { normalizeQuery } from '@/app/lib/search/project-search';

// フィールド名は短縮形（JSONサイズ削減のため）
// n=name, b=blockNo, s=status, c=cnFilled, cn=法人番号の実値(""=空欄), o=opaque
// a2=金額（個別支出額）, r=isRoot
// chain=ブロック委託チェーン("組織→A→B→C"), d=委託深度
// role=事業を行う上での役割（ブロック単位）, cc=契約概要
// c(bool)は記入有無、cn(string)は値そのもの。c=true かつ cn が無効な形式なら誤記載の可視化に使える
export interface RecipientRow {
  n: string;
  b: string;
  // cn = 有効な法人番号 かつ houjin.db 公式名が支出先名と一致（番号一致で特定可能）
  s: 'valid' | 'gov' | 'supp' | 'cn' | 'invalid' | 'unknown';
  c: boolean;
  cn: string;
  o: boolean;
  a2: number | null;
  r: boolean;
  chain: string;
  d: number;
  role: string;
  cc: string;
}

export type RecipientRowsByPid = Record<string, RecipientRow[]>;

/** 使途検索用に pid・正規化済みテキストを付与した行 */
export interface SpendingSearchRow extends RecipientRow {
  pid: string;
  roleNorm: string;
  ccNorm: string;
}

const dataCache = new Map<string, RecipientRowsByPid>();
const searchRowsCache = new Map<string, SpendingSearchRow[]>();

function loadRaw(year: string): RecipientRowsByPid {
  return readDataJson<RecipientRowsByPid>(
    `project-quality-recipients-${year}.json`,
    `python3 scripts/score-project-quality.py --year ${year} を実行してください。`
  );
}

/** pid → 支出行配列。既存 /api/quality-scores/recipients が使う生データ（応答不変） */
export function loadRecipientRows(year: SupportedYear): RecipientRowsByPid {
  if (dataCache.has(year)) return dataCache.get(year)!;
  const data = loadRaw(year);
  dataCache.set(year, data);
  return data;
}

/**
 * 使途検索用にフラット化 + role/cc を正規化済みの配列（初回構築後キャッシュ）。
 * 検索のたびに7.5万行を正規化しないための事前計算。
 */
export function loadSpendingSearchRows(year: SupportedYear): SpendingSearchRow[] {
  if (searchRowsCache.has(year)) return searchRowsCache.get(year)!;
  const data = loadRecipientRows(year);
  const rows: SpendingSearchRow[] = [];
  for (const [pid, list] of Object.entries(data)) {
    for (const row of list) {
      rows.push({
        ...row,
        pid,
        roleNorm: normalizeQuery(row.role ?? ''),
        ccNorm: normalizeQuery(row.cc ?? ''),
      });
    }
  }
  searchRowsCache.set(year, rows);
  return rows;
}
