/** vendors.json（事業者別の横断集計）の読み込み。生成は scripts/generate-vendors.ts */
import { tryReadDataJson } from '@/app/lib/api/data-file';
import type { VendorsFile } from '@/types/vendors';

let cache: VendorsFile | null | undefined;
export function loadVendors(): VendorsFile | null {
  if (cache === undefined) cache = tryReadDataJson<VendorsFile>('vendors.json');
  return cache;
}
