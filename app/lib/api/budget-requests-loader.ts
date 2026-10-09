/** 自動取得した概算要求データ。未生成と取得済み0件を区別する。 */
import { dataFileExists, readDataJson } from '@/app/lib/api/data-file';
import { REQUESTED_FY } from '@/app/lib/budget-requests';
import type { BudgetRequestDataset } from '@/types/budget-requests';

let cache: BudgetRequestDataset | undefined;
export function loadBudgetRequests(): BudgetRequestDataset | null {
  if (cache) return cache;
  const fileName = 'budget-requests-2027.json';
  if (!dataFileExists(fileName)) return null;
  const data = readDataJson<BudgetRequestDataset>(fileName, '概算要求取得パイプラインを実行してください。');
  if (data.schemaVersion !== 1 || data.requestedFY !== REQUESTED_FY || !Array.isArray(data.documents) || !Array.isArray(data.records)) {
    throw new Error('Invalid budget request dataset');
  }
  cache = data;
  return cache;
}
