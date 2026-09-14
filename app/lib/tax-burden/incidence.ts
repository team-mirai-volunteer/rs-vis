import type { IncidenceDataset } from '@/types/tax-burden';

/**
 * Corporate income tax is paid by companies, but part of it is thought to be passed on to workers as lower wages.
 * How large that part is has no settled value, so the share is the caller's assumption: 0 means "do not show it".
 * The share is turned into a flat rate on wages using Japan-wide totals (corporate tax revenue ÷ wages and salaries).
 */
export function wageIncidenceRate(data: IncidenceDataset | null | undefined, share: number): number {
  if (!data || !Number.isFinite(share) || share <= 0) return 0;
  if (share > 1 || data.wagesAndSalaries <= 0) throw new Error('法人税の帰着シェアが有効な範囲にありません');
  return data.corporateTaxTotal * share / data.wagesAndSalaries;
}

/** Implicit corporate tax carried by one household's gross wages (0 when the assumption is switched off). */
export function corporateTaxOnWages(data: IncidenceDataset | null | undefined, wages: number, share: number): number {
  if (!Number.isFinite(wages) || wages <= 0) return 0;
  return Math.round(wages * wageIncidenceRate(data, share));
}
