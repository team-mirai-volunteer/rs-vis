import type { Simulation, SourceValue } from '@/types/fiscal-space';
import { constraintInflation } from './constraints';

export const IMPORT_COST_SOURCE = 'https://www.boj.or.jp/mopo/outlook/gor2601b.pdf';
export const FX_RISK_SOURCE = 'https://www.boj.or.jp/mopo/outlook/gor2604b.pdf';
export const STRESS_ASSUMPTIONS = {
  importFxExposure: 1, exportFxExposure: .5, cpiPass: .13, foodPass: .3,
};

export function externalStressRecords(): SourceValue[] {
  return Object.entries(STRESS_ASSUMPTIONS).map(([key, value]) => ({ key: `externalStress.${key}`, value, unit: '比率',
    referenceYear: '2026-09-15の感度仮定', sourceName: '日銀研究を参考にした条件付きストレス', sourceUrl: IMPORT_COST_SOURCE,
    status: 'assumption', uncertaintyNote: '本体の因果推定係数ではない。輸入への円安転嫁100%、輸出円換算50%、CPI水準への転嫁0.13、食品水準への転嫁0.30。最も物価の高い将来年に1年で転嫁する仮定。本文の感度幅は信頼区間ではない。' }));
}

/** Conditional cost stress, not a forecast of the currency or a new equilibrium.
 * FX means an increase in yen per foreign-currency unit, not a % fall in the inverse.
 * All cumulative pass-through hits one selected year, then the price level persists.
 * Input-output historical cost contributions motivate sensitivity checks but do NOT
 * identify a causal elasticity: every stress coefficient remains an assumption. */
export function externalStress(path: Simulation, fx: number, foreignPrice: number, inflationLimit: number,
  assumptions = STRESS_ASSUMPTIONS) {
  const values = [fx, foreignPrice, inflationLimit, ...Object.values(assumptions)];
  if (values.some(v => !Number.isFinite(v)) || fx < 0 || foreignPrice < 0 ||
      Object.values(assumptions).some(v => v < 0 || v > 1)) throw new RangeError('Invalid stress assumptions');
  const peak = path.steps.reduce((a, b) => constraintInflation(a) >= constraintInflation(b) ? a : b);
  const importPrice = (1 + fx * assumptions.importFxExposure) * (1 + foreignPrice) - 1;
  const priceLevel = importPrice * assumptions.cpiPass;
  const years = path.steps.map(s => {
    const currentLevel = s.state.year >= peak.state.year ? priceLevel : 0;
    const previousLevel = s.state.year > peak.state.year ? priceLevel : 0;
    return { year: s.state.year, inflation: (1 + constraintInflation(s)) * (1 + currentLevel) / (1 + previousLevel) - 1 };
  });
  const cpiPeak = Math.max(...years.map(s => s.inflation));
  const importBill = peak.state.external.imports * importPrice;
  const exportReceipts = peak.state.external.exports * fx * assumptions.exportFxExposure;
  return { fx, foreignPrice, importPrice, priceLevel, foodPriceLevel: importPrice * assumptions.foodPass,
    cpiPeak, exceeds: cpiPeak > inflationLimit, year: peak.state.year, years,
    importBill, exportReceipts, tradeBalance: exportReceipts - importBill,
    // Extremes for translation of existing exports, not estimates of export volume.
    tradeRange: [-importBill, peak.state.external.exports * fx - importBill],
  };
}
