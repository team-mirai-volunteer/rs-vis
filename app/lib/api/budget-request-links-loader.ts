/** 概算要求と RS 事業の対応（scripts/generate-budget-request-links.ts の生成物）。未生成なら null */
import { dataFileExists, readDataJson } from '@/app/lib/api/data-file';
import type { BudgetRequestLinksFile, BudgetRequestProjectLinks } from '@/types/budget-request-links';

export const BUDGET_REQUEST_LINKS_FY = 2027;
const FILE = `budget-request-links-${BUDGET_REQUEST_LINKS_FY}.json`;

let cache: BudgetRequestLinksFile | null | undefined;
export function loadBudgetRequestLinks(): BudgetRequestLinksFile | null {
  // 開発中は生成し直した結果をすぐ見たいので、本番だけモジュール内に保持する
  if (cache !== undefined && process.env.NODE_ENV === 'production') return cache;
  if (!dataFileExists(FILE)) { cache = null; return cache; }
  const data = readDataJson<BudgetRequestLinksFile>(FILE, 'npm run generate-budget-request-links');
  if (data.schemaVersion !== 1 || !data.byPid || !Array.isArray(data.ministries)) throw new Error('Invalid budget request links dataset');
  cache = data;
  return cache;
}

/** 事業の対応。データ未生成は null、生成済みで事業に行が無いときは coverage 'no-line-items' */
export function budgetRequestLinksFor(pid: string | number): BudgetRequestProjectLinks | null {
  const data = loadBudgetRequestLinks();
  if (!data) return null;
  return data.byPid[String(pid)] ?? { coverage: 'no-line-items', items: [], unmatched: [] };
}
