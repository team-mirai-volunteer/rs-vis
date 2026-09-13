/**
 * MOF 予算全体ビューの集計データ読み込み。
 *
 * 年度ごとに1ファイル（`mof-budget-overview-{YEAR}.json`）。
 * `mof-jikou-loader.ts` と同じ方式で、収録済みの年度を実ファイルの有無から決める。
 */

import type { MOFBudgetOverview } from '@/types/mof-budget-overview';
import { dataFileExists, readDataJson } from './data-file';

/**
 * 収録候補の会計年度（新しい順）。
 * 実際に返せるのは JSON が生成済みの年度だけ。
 */
const CANDIDATE_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017] as const;

const fileName = (year: number) => `mof-budget-overview-${year}.json`;

const cache = new Map<number, MOFBudgetOverview>();
let cachedYears: number[] | null = null;

/** 生成済みの年度（新しい順） */
export function availableYears(): number[] {
  if (!cachedYears) cachedYears = CANDIDATE_YEARS.filter(y => dataFileExists(fileName(y)));
  return cachedYears;
}

/** 1年度分を読む（プロセス内キャッシュ） */
export function loadYear(year: number): MOFBudgetOverview {
  const cached = cache.get(year);
  if (cached) return cached;
  const data = readDataJson<MOFBudgetOverview>(
    fileName(year),
    `npm run generate-mof-data を実行してください（対象年度: ${year}）。`
  );
  cache.set(year, data);
  return data;
}
