/** Contribution fractions refer to ALL-items year-on-year CPI, not energy CPI.
 * Both periods' index levels must be adjusted before computing the new rate. */
export function adjustEnergyCpi(c: { observedRate: number; energyIndex: number; previousAllItemsIndex: number;
  energyWeight: number; currentContribution: number; previousContribution: number }) {
  if (Object.values(c).some(v => !Number.isFinite(v)) || c.observedRate <= -1 || c.energyIndex <= 0
    || c.previousAllItemsIndex <= 0 || c.energyWeight <= 0 || c.energyWeight > 1) throw new RangeError('Invalid energy CPI adjustment');
  const previousEnergyIndex = c.energyIndex / (1 + c.observedRate);
  const conversion = c.previousAllItemsIndex / c.energyWeight;
  const currentAdjusted = c.energyIndex - c.currentContribution * conversion;
  const previousAdjusted = previousEnergyIndex - c.previousContribution * conversion;
  if (currentAdjusted <= 0 || previousAdjusted <= 0) throw new RangeError('Nonpositive adjusted energy CPI');
  return currentAdjusted / previousAdjusted - 1;
}

// Statistics Bureau, July 2026 nationwide CPI, published 2026-08-21:
// p1: July 2025 all-items index 100.1; p3: energy weight 749/10000,
// current policy contribution -0.35%, prior-year unwinding +0.13%; p7: index 102.2.
// This includes gasoline tax abolition. It cannot identify subsidies alone.
export const JULY_2026_ENERGY_ADJUSTMENT = {
  observedRate: .006, energyIndex: 102.2, previousAllItemsIndex: 100.1,
  energyWeight: .0749, currentContribution: -.0035, previousContribution: -.0013,
};
