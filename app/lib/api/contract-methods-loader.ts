/**
 * contract-methods-{シート年度}.json（RS公開APIの契約方式）の読み込みと、支出行への付与。
 * 生成は scripts/generate-contract-methods.ts。ファイルが無い年度は付与しない（行はそのまま返す）。
 */
import { tryReadDataJson } from '@/app/lib/api/data-file';
import { findContract, type ContractMethodsByPid } from '@/app/lib/contract-method';
import { isOthersRowName, matchOthersCount, type OthersCountsByPid } from '@/app/lib/others-count';
import type { RecipientRow } from '@/app/lib/api/quality-recipients-loader';
import type { RecipientExternalFile } from '@/types/recipient-external';

const cache = new Map<string, ContractMethodsByPid | null>();

export function loadContractMethods(sheetYear: string): ContractMethodsByPid | null {
  if (!cache.has(sheetYear)) cache.set(sheetYear, tryReadDataJson<ContractMethodsByPid>(`contract-methods-${sheetYear}.json`));
  return cache.get(sheetYear)!;
}

/** 支出行に契約方式（m・mt・ap・br）を付ける。突き合わせできない行は変えない */
export function withContractMethods(rows: RecipientRow[], pid: string, sheetYear: string): RecipientRow[] {
  const entries = loadContractMethods(sheetYear)?.[pid];
  if (!entries) return rows;
  return rows.map(row => {
    const c = findContract(entries, row);
    if (!c) return row;
    return { ...row, m: c.m, ...(c.mt ? { mt: c.mt } : {}), ...(c.ap !== undefined ? { ap: c.ap } : {}), ...(c.br !== undefined ? { br: c.br } : {}) };
  });
}

const othersCache = new Map<string, OthersCountsByPid | null>();
/** others-counts-{シート年度}.json（その他行にまとめられた件数）。生成は scripts/generate-others-counts.ts */
export function loadOthersCounts(sheetYear: string): OthersCountsByPid | null {
  if (!othersCache.has(sheetYear)) othersCache.set(sheetYear, tryReadDataJson<OthersCountsByPid>(`others-counts-${sheetYear}.json`));
  return othersCache.get(sheetYear)!;
}

/** 「その他」行に件数（oc）とブロックの支出先の数（ot）を付ける。ブロック内のその他行の金額合計が API と一致するときだけ */
export function withOthersCounts(rows: RecipientRow[], pid: string, sheetYear: string): RecipientRow[] {
  const blocks = loadOthersCounts(sheetYear)?.[pid];
  if (!blocks) return rows;
  const sums = new Map<string, number>();
  for (const row of rows) if (isOthersRowName(row.n)) sums.set(row.b, (sums.get(row.b) ?? 0) + (row.a2 ?? Number.NaN));
  return rows.map(row => {
    if (!isOthersRowName(row.n)) return row;
    const c = matchOthersCount(blocks[row.b], sums.get(row.b));
    return c ? { ...row, oc: c.n, ot: c.t } : row;
  });
}

let external: RecipientExternalFile | null | undefined;
/** 支出先の外部情報（recipient-external.json）。年度によらず1ファイル。無ければ null */
export function loadRecipientExternal(): RecipientExternalFile | null {
  if (external === undefined) external = tryReadDataJson<RecipientExternalFile>('recipient-external.json');
  return external;
}

const projectLabels = new Map<string, Map<string, { name: string; ministry: string }> | null>();
/**
 * 事業ID → 事業名・府省（project-quality-scores-{シート年度}.json から名前と府省だけ残す）。
 * 契約方式の推移で、表示中の年度の支出先インデックスに無い事業の名前を引くのに使う。無ければ null
 */
export function loadProjectLabels(sheetYear: string): Map<string, { name: string; ministry: string }> | null {
  if (!projectLabels.has(sheetYear)) {
    const items = tryReadDataJson<Array<{ pid: string; name: string; ministry: string }>>(`project-quality-scores-${sheetYear}.json`);
    projectLabels.set(sheetYear, items ? new Map(items.map(i => [String(i.pid), { name: i.name, ministry: i.ministry }])) : null);
  }
  return projectLabels.get(sheetYear)!;
}
