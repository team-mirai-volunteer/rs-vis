/**
 * contract-methods-{シート年度}.json（RS公開APIの契約方式）の読み込みと、支出行への付与。
 * 生成は scripts/generate-contract-methods.ts。ファイルが無い年度は付与しない（行はそのまま返す）。
 */
import { tryReadDataJson } from '@/app/lib/api/data-file';
import { findContract, type ContractMethodsByPid } from '@/app/lib/contract-method';
import type { RecipientRow } from '@/app/lib/api/quality-recipients-loader';

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
