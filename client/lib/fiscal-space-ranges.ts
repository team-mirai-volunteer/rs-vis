/** Numeric URL bounds in engine units, matching the editable controls.
 * Fields with no control stay at the versioned default. Unknown nullable fields fail closed.
 * These are input domains, not confidence intervals or plausibility judgements.
 */
import type { ConstraintId } from '@/types/fiscal-space';

type Bounds = readonly [number, number];
/** Editable threshold domains (engine units). Shared by the controls and the URL decoder,
 * so a link cannot carry an arbitrarily large ceiling that the screen would never allow. */
export const THRESHOLD_BOUNDS: Record<ConstraintId, Bounds> = {
  debt: [1, 4], interestGdp: [.01, .15], interestTax: [.05, 1], gfn: [.1, 1], inflation: [.005, .06],
  capacity: [.8, 1.2], labour: [.8, 1.6], sector: [.8, 1.2], energy: [.8, 1.2], external: [.05, .6],
};
const calibration: Record<string, Bounds> = {
  taxRevenueElasticity: [0, 2], socialContributionElasticity: [0, 2], taxCollectionLag: [0, 3], multiplierScale: [0, 3],
  gapDemandSensitivity: [0, 10], gapPriceSensitivity: [0, 10], gapInflationSlope: [0, .2], marketRate: [0, .06],
  structuralUnemployment: [.01, .05],
  hoursElasticity: [0, 1], participationElasticity: [0, 1], employeeReliefShare: [0, 1], employerDemandElasticity: [0, 1],
  netLabourIncomeShare: [.2, .7], employerLabourCostShare: [.3, .9],
  energyPricePassThrough: [0, 1], energyDomesticPricePassThrough: [0, 1], expenditurePriceIndexation: [0, 1],
  capacityPriceSensitivity: [0, .02], capacityPressureStart: [.5, .95], referenceCapacityRatio: [1.01, 1.5],
  'consumptionTax.revenuePerPoint': [1e12, 5e12], 'consumptionTax.cpiShare': [0, 1],
  'consumptionTax.baseRate': [.08, .1], 'consumptionTax.passThrough': [0, 1], 'consumptionTax.referenceDirectCpi': [0, 1],
  'electricity.generationTwh': [1, 3000], 'electricity.thermalShare': [0, 1],
  'electricity.demandGrowth': [-.1, .1], 'electricity.peakGrowth': [-.1, .1],
  'electricity.nonThermalDecline': [0, 1], 'electricity.plannedNonThermalTwh': [0, 100],
  'electricity.fuelImportYenPerKwh': [0, 50], 'electricity.marginalThermalShare': [0, 1],
  'demographics.labourElasticity': [0, 1], 'demographics.fertilityPerGdpPoint': [0, .5], 'demographics.fertilityIncomeElasticity': [0, 2],
  'demographics.ageingShare': [0, .8], 'demographics.childBenefitShare': [0, .2],
};
const supply: Record<string, Bounds> = {
  serviceShare: [0, 1], realizationRate: [0, 1], rampYears: [1, 10], referenceOverlap: [0, 1],
  additionality: [0, 1], lag: [0, 30], depreciation: [0, 1], lifetime: [1, 60], yield: [0, 1],
  unitCost: [.01, 1e8], employment: [0, 1], maintenanceRate: [0, 1], maintenanceImportShare: [0, 1], generationOverlapShare: [0, 1],
};
const industry: Record<string, Bounds> = {
  annualSalesPerInvestment: [0, 10], exportShare: [0, 1], domesticReplacementShare: [0, 1],
  operatingImportShare: [0, 1], capexImportShare: [0, 1], additionality: [0, 1], depreciation: [0, 1], lag: [0, 30], lifetime: [1, 50],
};
const power: Record<string, Bounds> = {
  capexPerKw: [1e4, 5e6], capacityFactor: [0, 1], lag: [0, 30],
  curtailment: [0, 1], thermalReplacement: [0, 1], displacedFuelYenPerKwh: [0, 50],
  operatingImportYenPerKwh: [0, 50], capexImportShare: [0, 1], firmShare: [0, 1],
};
const load: Record<string, Bounds> = {
  sectorUtilizationPerTrillion: [0, .1], peakGwPerTrillion: [0, 10], operatingPeakGwPerTrillion: [0, 10],
  annualGwhPerTrillion: [0, 1e5], operatingAnnualGwhPerTrillion: [0, 1e5], annualConstructionGwh: [0, 1e6],
  lag: [0, 15], lifetime: [1, 60], depreciation: [0, 1],
  budgetTrillion: [.01, 100], workerYears: [0, 1e7], sectorWorkerCapacity: [1, 1e8],
  constructionPeakMw: [0, 1e5], operatingPeakMw: [0, 1e5], annualOperatingGwh: [0, 1e6],
  annualLoadFactor: [.01, 1], peakCoincidence: [0, 1],
};
const root: Record<string, Bounds> = {
  'poverty.childcareCashShare': [0, 1],
  'resource.loadScale': [.25, 2], 'resource.spendingShare': [0, 1], 'resource.priceIndex': [.8, 2],
  'resource.electricityPrice': [5, 50], 'resource.loadFactor': [.2, 1], 'resource.coincidence': [0, 1],
  'resource.operatingOutputRatio': [0, 2],
  gap: [-10, 3], inflation: [-3, 10], rateShock: [0, 300], energyShock: [0, 100],
  construction: [70, 100], firmCapacity: [170, 250], corporateShare: [0, 1],
  'longRun.years': [6, 100], 'longRun.realGrowth': [-.01, .03], 'longRun.inflation': [0, .05],
  'longRun.rate': [0, .06], 'longRun.realization': [0, 1],
};

export function validateScenarioNumber(value: number, template: number | null, path: string) {
  const name = path.slice('form.'.length), key = name.split('.').at(-1)!;
  let bounds: Bounds | undefined;
  if (name.startsWith('calibration.')) bounds = calibration[name.slice('calibration.'.length)];
  else if (name.startsWith('supply.')) bounds = supply[key];
  else if (name.startsWith('trade.industry.')) bounds = industry[key];
  else if (name.startsWith('trade.power')) bounds = power[key];
  else if (name.startsWith('trade.mix.')) bounds = [0, 100];
  else if (name.startsWith('loads.')) bounds = load[key];
  else if (name.startsWith('amounts.')) bounds = [0, 100];
  else if (name.startsWith('inputs.')) bounds = [1, 1.5];
  else if (name.startsWith('thresholds.')) bounds = THRESHOLD_BOUNDS[key as ConstraintId];
  else if (name.startsWith('policySettings.') && key === 'duration') bounds = [1, 10];
  else if (name === 'horizon') bounds = [1, 15];
  else bounds = root[name];
  if (!bounds && template !== null) bounds = [template, template];
  if (!bounds || value < bounds[0] || value > bounds[1]) throw new Error(`Out of range: ${path}`);
}
