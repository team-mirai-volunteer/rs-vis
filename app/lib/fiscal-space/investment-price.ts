import type { EconomyState, ModelParameters } from '@/types/fiscal-space';

/** Price at the start of each payment year, in initial real GDP units. */
export type InvestmentPricePath = (paid: number) => number;

export function investmentPricePath(initial: EconomyState, p: ModelParameters): InvestmentPricePath {
  const prices = [initial.macro.nominalGdp / initial.macro.realGdp];
  return paid => {
    while (prices.length < paid) {
      const year = prices.length;
      prices.push(prices[year - 1] * (1 + p.baselineInflation
        + p.inflationPersistence ** year * (initial.macro.inflation - p.baselineInflation)));
    }
    return prices[paid - 1];
  };
}
