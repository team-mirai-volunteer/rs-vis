/**
 * MOF目 ↔ RS事業 紐づけデータの読み込み。
 *
 * 生成は npm run generate-mof-rs-kou-moku-linkage
 * （scripts/generate-mof-rs-kou-moku-linkage.ts）。
 * ファイルは予算年度（= mof-kou-moku の会計年度）ごとに1本。
 * 未生成の年度は「対象外」として扱い、呼び出し側でエラーにしない。
 */

import type { MofRsKouMokuLinkageData, MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import { dataFileExists, readDataJson } from './data-file';

const fileName = (budgetYear: number) => `mof-rs-kou-moku-linkage-${budgetYear}.json`;

const cache = new Map<number, MofRsKouMokuLinkageData>();

/** その予算年度の紐づけデータが生成済みか */
export function linkageAvailable(budgetYear: number): boolean {
  return dataFileExists(fileName(budgetYear));
}

function loadYear(budgetYear: number): MofRsKouMokuLinkageData {
  const cached = cache.get(budgetYear);
  if (cached) return cached;
  const data = readDataJson<MofRsKouMokuLinkageData>(
    fileName(budgetYear),
    `npm run generate-mof-rs-kou-moku-linkage を実行してください（対象年度: ${budgetYear}）。`
  );
  cache.set(budgetYear, data);
  return data;
}

/** その年度の紐づけ全件。一覧側での列表示・詳細パネルの両方をクライアント側の1回のフェッチで賄う */
export function allLinks(budgetYear: number): MofRsKouMokuLinkageRecord[] {
  if (!linkageAvailable(budgetYear)) return [];
  return loadYear(budgetYear).links;
}

/** その年度の紐づけデータの RS 事業年度（/sankey-svg の yr パラメータに使う） */
export function linkageRsYear(budgetYear: number): number | null {
  if (!linkageAvailable(budgetYear)) return null;
  return loadYear(budgetYear).metadata.rsYear;
}

/** その年度の紐づけデータの突合範囲の説明 */
export function linkageScope(budgetYear: number): string | null {
  if (!linkageAvailable(budgetYear)) return null;
  return loadYear(budgetYear).metadata.scope;
}

export interface LinkageResolution {
  available: boolean;
  links: MofRsKouMokuLinkageRecord[];
}

/** 指定年度の紐づけを解決する。その年度自体の紐づけデータが無ければ「対象外」として空を返す */
export function resolveLinks(budgetYear: number): LinkageResolution {
  if (!linkageAvailable(budgetYear)) {
    return { available: false, links: [] };
  }
  return { available: true, links: allLinks(budgetYear) };
}
