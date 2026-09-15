import type { EconomyState, ModelParameters, Policy, Simulation } from '@/types/fiscal-space';
import { adjustedResponse, projectResponse } from './project-response';
import { STRESS_ASSUMPTIONS } from './external-stress';

/** Public reference FX response, converted into a separate nominal trade diagnostic.
 * CPI already contains the reference model's FX channel: never add it again.
 * The original macro GDP, debt and external constraints are not overwritten. */
export function fiscalExternal(initial: EconomyState, policies: Policy[], path: Simulation, baseline: Simulation, p: ModelParameters) {
  let previousImportPrice = 0;
  return path.steps.map((step, i) => {
    const fx = policies.reduce((sum, policy) => sum + adjustedResponse(initial, policy, i + 1, p, projectResponse(initial, policy, i + 1, p)).exchangeRate, 0);
    const importPrice = fx * STRESS_ASSUMPTIONS.importFxExposure;
    const exportPrice = fx * STRESS_ASSUMPTIONS.exportFxExposure;
    if (importPrice <= -1 || exportPrice <= -1) throw new RangeError('FX response outside positive price domain');
    const importInflation = (1 + importPrice) / (1 + previousImportPrice) - 1;
    previousImportPrice = importPrice;
    const b = baseline.steps[i];
    const importPriceBill = step.state.external.imports * importPrice;
    const exportPriceReceipts = step.state.external.exports * exportPrice;
    const imports = step.state.external.imports - b.state.external.imports + importPriceBill;
    const exports = step.state.external.exports - b.state.external.exports + exportPriceReceipts;
    return { year: step.state.year, fx, importPrice, importInflation, importPriceBill, exportPriceReceipts, imports, exports,
      trade: exports - imports, cpi: step.state.macro.inflation,
      cpiDifference: step.state.macro.inflation - b.state.macro.inflation };
  });
}
