import type { ConsumptionAssumption, ConsumptionDataset, IncidenceDataset, OecdVatRates } from '@/types/tax-burden';
import { basketForIncome, consumptionTax } from './consumption-tax';

/**
 * OECD Taxing Wages measures income tax plus employee social contributions less cash benefits, and nothing else:
 * no consumption tax, no employer contributions. Our own curve can add an estimated consumption tax and an assumed
 * corporate-tax incidence, and then the two are no longer the same quantity. These helpers add the same two items to
 * the OECD lines so that switching either assumption on moves both sides of the comparison together.
 *
 * The consumption tax uses the Japanese 家計調査 spending basket for every line, because no comparable basket is
 * published per country; only the rate changes. The corporate-tax incidence uses each side's own corporate tax over
 * wages and salaries.
 */
export interface OverlayRates {
  standardVat: number;
  reducedVat: number;
  /** Corporate income tax ÷ wages and salaries, before the incidence share is applied. */
  incidenceRatio: number;
}

export interface OverlayOptions {
  consumption: ConsumptionDataset | null;
  includeConsumption: boolean;
  assumption: ConsumptionAssumption;
  corporateShare: number;
}

/** Japan's own rates, so the OECD Japan line matches the household curve drawn next to it. */
export function japanOverlayRates(vat: OecdVatRates | undefined, incidence: IncidenceDataset | null | undefined): OverlayRates {
  const standardVat = vat?.japanStandard ?? 0.1;
  return {
    standardVat,
    reducedVat: standardVat * (vat?.reducedFactor ?? 0.8),
    incidenceRatio: incidence && incidence.wagesAndSalaries > 0 ? incidence.corporateTaxTotal / incidence.wagesAndSalaries : 0,
  };
}

/** OECD-wide rates: the average standard VAT rate and the average corporate tax over wages across member countries. */
export function oecdOverlayRates(vat: OecdVatRates | undefined, incidence: IncidenceDataset | null | undefined): OverlayRates {
  const standardVat = vat?.averageStandard ?? 0;
  return {
    standardVat,
    reducedVat: standardVat * (vat?.reducedFactor ?? 0.8),
    incidenceRatio: incidence?.oecd?.averageRatio ?? 0,
  };
}

/**
 * Percentage points to add to a net personal average tax rate so that it covers the same items as our curve.
 * Returns 0 when both assumptions are off, so the published OECD values are shown untouched.
 */
export function overlayAddOn(income: number, rates: OverlayRates, options: OverlayOptions): number {
  if (!Number.isFinite(income) || income <= 0) return 0;
  let added = 0;
  if (options.includeConsumption && options.consumption && rates.standardVat > 0) {
    added += consumptionTax(basketForIncome(options.consumption, income), rates.standardVat, rates.reducedVat, options.assumption).tax;
  }
  if (options.corporateShare > 0 && rates.incidenceRatio > 0) {
    if (options.corporateShare > 1) throw new Error('法人税の帰着シェアが有効な範囲にありません');
    added += income * rates.incidenceRatio * options.corporateShare;
  }
  return added / income * 100;
}
