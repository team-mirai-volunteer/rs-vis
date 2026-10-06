/** fund-payments.json（基金シートの支出先）の読み込み。生成は scripts/generate-funds.ts */
import { tryReadDataJson } from '@/app/lib/api/data-file';
import type { FundPaymentsFile } from '@/types/funds';

let cache: FundPaymentsFile | null | undefined;
export function loadFundPayments(): FundPaymentsFile | null {
  if (cache === undefined) cache = tryReadDataJson<FundPaymentsFile>('fund-payments.json');
  return cache;
}
