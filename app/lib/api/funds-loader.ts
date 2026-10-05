/** funds.json（基金シートのまとめ）の読み込み。生成は scripts/generate-funds.ts */
import { tryReadDataJson } from '@/app/lib/api/data-file';
import type { FundsFile } from '@/types/funds';

let cache: FundsFile | null | undefined;
export function loadFunds(): FundsFile | null {
  if (cache === undefined) cache = tryReadDataJson<FundsFile>('funds.json');
  return cache;
}
