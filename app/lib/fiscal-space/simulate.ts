import type { EconomyState, ModelParameters, Policy, ProjectionStep, Sector, Shock, Simulation } from '@/types/fiscal-space';
import { NO_SHOCK, PARAMETERS, SECTORS } from './assumptions';
import { allocateDemand } from './demand';
import { financeDebt, fiscalMetrics, rollover } from './debt';
import { positive, productionCapacity } from './production';
import { REFERENCES, taxLabourSupply } from './calibration';
import { policyReliefLimit } from './policy-limits';
import { policyLoads } from './policy-load';
import { projectResponses } from './project-response';
import { policyProduction } from './policy-production';
import { ELECTRICITY_BASELINE, electricityBaseline } from './electricity-baseline';
import { resourcePowerBalance, validateResourceAssumptions } from './resource-estimate';

const sectorZeros = () => Object.fromEntries(SECTORS.map(s => [s, 0])) as Record<Sector, number>;
const emptyDemand = () => ({ additionalDemand: 0, realOutput: 0, exports: 0, imports: 0, prices: 0, capacityPriceAdjustment: 0,
  directTaxPriceEffect: 0, directTaxDeflatorEffect: 0, longRateEffect: 0,
  domesticSubstitution: 0, projectEnergyNetImports: 0,
  priceLevelEffect: 0, deflatorLevelEffect: 0, employmentEffect: 0, labourForceEffect: 0, hoursEffect: 0, details: [] });

export function snapshot(state: EconomyState, p: ModelParameters): ProjectionStep {
  const production = productionCapacity(state, p, 1);
  const resourcePower = p.resourceModel?.mode === 'estimated'
    ? resourcePowerBalance(0, 0, 0, p.resourceModel,
      state.energy.firmCapacity / resourcePowerBalance(0, 0, 0, p.resourceModel).nationalSupplyGw) : undefined;
  return { state, production, demand: emptyDemand(), policyCost: 0,
    resourcePower,
    metrics: fiscalMetrics(state, state.debtPortfolio.filter(b => b.maturityYear <= state.year + 1).reduce((s, b) => s + b.principal, 0), state.fiscal.grossDebt, state.macro.nominalGdp),
    outputGap: (state.macro.realGdp - state.macro.potentialGdp) / state.macro.potentialGdp,
    maximumGap: (state.macro.realGdp - production.maximum) / production.maximum,
    maturingDebt: 0, energyImportIncrease: 0, inflationPressure: 0, sectorDemand: sectorZeros() };
}

function validate(initial: EconomyState, policies: Policy[], horizon: number, p: ModelParameters, shock: Shock) {
  if (p.resourceModel) validateResourceAssumptions(p.resourceModel);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 100) throw new RangeError('horizon must be 1–100 years');
  positive(initial.macro.realGdp, 'real GDP'); positive(initial.macro.nominalGdp, 'nominal GDP');
  positive(initial.macro.potentialGdp, 'potential GDP');
  positive(initial.energy.importedEnergy, 'base imported energy');
  positive(initial.energy.primaryDemand, 'primary energy demand');
  positive(initial.energy.peakDemand, 'peak demand'); positive(initial.energy.firmCapacity, 'firm capacity');
  positive(initial.labour.labourForce, 'labour force');
  positive(p.netLabourIncomeShare, 'net labour income share');
  positive(p.employerLabourCostShare, 'employer payroll share');
  if (p.employeeReliefShare < 0 || p.employeeReliefShare > 1 || p.employerDemandElasticity < 0 || p.employerLabourCostShare > 1) throw new RangeError('Invalid employer sensitivity');
  if (!REFERENCES[p.referenceModel] || p.multiplierScale < 0 || p.hoursElasticity < 0 || p.participationElasticity < 0 || p.netLabourIncomeShare > 1) throw new RangeError('Invalid calibration sensitivity');
  const checkFinite = (value: unknown): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('State values must be finite');
    if (value && typeof value === 'object') Object.values(value).forEach(checkFinite);
  };
  checkFinite(initial);
  checkFinite(p);
  if (p.capacityPriceSensitivity < 0 || p.capacityPriceSensitivity > .1 || p.capacityPressureStart < 0 || p.capacityPressureStart >= 1 || p.referenceCapacityRatio <= 1) throw new RangeError('Invalid capacity price sensitivity');
  if (p.taxRevenueElasticity < 0 || p.taxRevenueElasticity > 3 || !Number.isInteger(p.taxCollectionLag) || p.taxCollectionLag < 0 || p.taxCollectionLag > 5) throw new RangeError('Invalid tax revenue sensitivity');
  if (!['leontief', 'ces', 'cobbDouglas'].includes(p.productionModel)) throw new RangeError('Invalid production model');
  for (const n of [p.gapDemandSensitivity, p.gapPriceSensitivity, p.gapInflationSlope]) if (n < 0) throw new RangeError('Invalid gap sensitivity');
  positive(p.consumptionTax.revenuePerPoint, 'tax revenue per point');
  positive(p.consumptionTax.baseRate, 'base consumption tax rate');
  for (const n of [p.consumptionTax.cpiShare, p.consumptionTax.passThrough]) if (n < 0 || n > 1) throw new RangeError('Invalid tax price assumptions');
  for (const id of ['consumption-tax', 'social-insurance']) {
    if (policies.filter(x => x.id === id).reduce((sum, x) => sum + x.annualCost, 0) > policyReliefLimit(id, p) + 1)
      throw new RangeError(`${id} relief exceeds the revenue base`);
  }
  if (Math.abs(initial.debtPortfolio.reduce((s, b) => s + b.principal, 0) - initial.fiscal.grossDebt) > 1) throw new RangeError('Debt portfolio must reconcile to gross debt');
  for (const value of [...Object.values(p).filter(v => typeof v === 'number'), ...Object.values(shock)]) {
    if (!Number.isFinite(value)) throw new RangeError('Parameters must be finite');
  }
  positive(1 + p.baselineRealGrowth + shock.realGrowthDelta, 'real growth factor');
  positive(1 + p.baselineInflation, 'inflation factor'); positive(1 + shock.energyPriceChange, 'energy price factor');
  for (const name of ['overflowImportShare', 'inflationPersistence', 'investmentDepreciation', 'goodsImportShare', 'essentialImportShare', 'energyPricePassThrough', 'energyDomesticPricePassThrough', 'expenditurePriceIndexation'] as const) {
    if (p[name] < 0 || p[name] > 1) throw new RangeError(`${name} must be 0–1`);
  }
  if (p.marketRate + shock.marketRateDelta < 0) throw new RangeError('Negative market rate is outside MVP scope');
  for (const policy of policies) {
    for (const v of Object.values(policy)) if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) throw new RangeError('Policy values must be nonnegative and finite');
    if (!Number.isInteger(policy.duration) || policy.duration < 1 || !Number.isInteger(policy.implementationLag)) throw new RangeError('Invalid policy assumptions');
  }
}

/** Explicit baseline paths keep temporary demand from becoming permanent growth by accident. */
export function simulate(initial: EconomyState, policies: Policy[], horizon = 10, p: ModelParameters = PARAMETERS, shock: Shock = NO_SHOCK): Simulation {
  validate(initial, policies, horizon, p, shock);
  let previous = structuredClone(initial);
  const steps: ProjectionStep[] = [];
  const taxRate = initial.fiscal.taxRevenue / initial.macro.nominalGdp;
  const baseMarketRate = p.marketRate + shock.marketRateDelta;
  let previousPriceEffect = 0, previousDeflatorEffect = 0, previousUnderlyingInflation = initial.macro.inflation;
  let commonPriceIndex = 1, previousCommonFuelIncrease = 0;
  let previousDomesticInflation = initial.macro.inflation, previousEnergyDeflatorEffect = 0, consumerPriceIndex = 1;
  let previousTaxAdjustedPrice = 0;
  for (let t = 1; t <= horizon; t++) {
    const year = initial.year + t;
    const active = policies.filter(policy => policy.kind === 'permanent' || t <= policy.duration);
    const priceBefore = previous.macro.nominalGdp / previous.macro.realGdp;
    const electricity = electricityBaseline(p.electricity, t);
    const commonFuelIncrease = electricity.additionalFuelBill * commonPriceIndex * (1 + shock.energyPriceChange);
    const baselineReal = initial.macro.realGdp * (1 + p.baselineRealGrowth + shock.realGrowthDelta) ** t;
    const baselinePotential = initial.macro.potentialGdp * (1 + p.baselineRealGrowth) ** t;
    const supply = taxLabourSupply(initial, policies, t, p);
    const projects = projectResponses(initial, policies, t, p);
    const capacity = policyProduction(initial, policies, t, p, baselinePotential);
    const potential = capacity.potential, energyAddition = capacity.manualEnergy;
    // Only post-reference realization enters autonomous output; project
    // operations remain in demand, exactly once.
    const realized = policyProduction(initial, policies, t, p, baselinePotential, undefined, true, false);
    const autonomousReal = baselineReal + (realized.potential - baselinePotential) * initial.macro.realGdp / initial.macro.potentialGdp;
    const state = structuredClone(previous);
    state.year = year;
    state.macro = { ...state.macro, realGdp: autonomousReal, nominalGdp: autonomousReal * priceBefore, potentialGdp: potential };
    state.production = capacity.production;
    state.labour.sectorUtilization = { ...initial.labour.sectorUtilization };
    const demand = allocateDemand(state, policies, p, t, initial, { real: baselineReal, potential: baselinePotential });
    const policyCost = active.reduce((s, policy) => s + policy.annualCost, 0);
    const inflationPressure = demand.prices / autonomousReal * p.inflationPassThrough;
    const { sectorDemand, peakGw, coverage } = policyLoads(initial, policies, t, p);
    let energyDemandIncrease = 0;
    for (const policy of active) {
      const intensity = policy.annualCost / priceBefore / autonomousReal;
      energyDemandIncrease += initial.energy.primaryDemand * intensity * policy.energyDemand;
    }
    for (const sector of SECTORS) state.labour.sectorUtilization[sector] += sectorDemand[sector];
    state.labour.labourForce = Math.min(initial.labour.labourForce / initial.labour.participation,
      initial.labour.labourForce * (1 + demand.labourForceEffect) * supply.participation);
    state.labour.participation = Math.min(1, initial.labour.participation * state.labour.labourForce / initial.labour.labourForce);
    state.labour.hoursWorked = initial.labour.hoursWorked * (1 + demand.hoursEffect) * supply.hours;
    // Calibrated headcount response, with extra hours meeting part of labour demand.
    state.labour.employment = initial.labour.employment * (1 + demand.employmentEffect) * supply.employerDemand / supply.hours;
    state.labour.unemployment = Math.max(0, state.labour.labourForce - state.labour.employment);
    state.energy.primaryDemand = initial.energy.primaryDemand + energyDemandIncrease;
    state.energy.domesticSupply = initial.energy.domesticSupply * (1 + energyAddition);
    state.energy.importedEnergy = Math.max(0, state.energy.primaryDemand - state.energy.domesticSupply);
    state.energy.firmCapacity = initial.energy.firmCapacity * (1 + energyAddition) + projects.reduce((sum, project) => sum + project.firmGw, 0);
    state.energy.peakDemand = initial.energy.peakDemand * (1 + p.electricity.peakGrowth) ** t * (1 + energyDemandIncrease / initial.energy.primaryDemand) + peakGw;
    const resourcePower = p.resourceModel?.mode === 'estimated' ? resourcePowerBalance(t,
      peakGw + initial.energy.peakDemand * energyDemandIncrease / initial.energy.primaryDemand,
      state.energy.firmCapacity - initial.energy.firmCapacity, p.resourceModel,
      initial.energy.firmCapacity / resourcePowerBalance(0, 0, 0, p.resourceModel).nationalSupplyGw,
      ((1 + p.electricity.peakGrowth) / (1 + ELECTRICITY_BASELINE.peakGrowth)) ** t) : undefined;
    if (resourcePower) {
      state.energy.peakDemand = resourcePower.nationalDemandGw;
      state.energy.firmCapacity = resourcePower.nationalSupplyGw;
    }
    state.energy.reserveMargin = (state.energy.firmCapacity - state.energy.peakDemand) / state.energy.peakDemand;
    // Import prices follow the common external price path, not domestic value added.
    const baselineEnergyBill = initial.energy.importBill * commonPriceIndex;
    state.energy.importBill = baselineEnergyBill * state.energy.importedEnergy / initial.energy.importedEnergy * (1 + shock.energyPriceChange);
    state.energy.importBill = Math.max(0, state.energy.importBill + demand.projectEnergyNetImports * priceBefore * (1 + shock.energyPriceChange));
    state.energy.importBill = Math.max(0, state.energy.importBill + commonFuelIncrease);
    const energyImportIncrease = state.energy.importBill - baselineEnergyBill;
    // A permanent price-level shock contributes to inflation once; new import demand contributes each year.
    // The common fuel path is a level: only its annual change adds inflation.
    const energyPricePressure = (energyImportIncrease - commonFuelIncrease - (t > 1 ? baselineEnergyBill * shock.energyPriceChange : 0)
      + commonFuelIncrease - previousCommonFuelIncrease) / (autonomousReal * priceBefore) * p.energyPricePassThrough;
    // Baseline gap only: the policy response already embeds its own gap/price channel.
    const baselineGap = baselineReal / baselinePotential - 1;
    const gapInflation = p.gapInflationSlope * baselineGap;
    const underlyingInflation = p.baselineInflation + gapInflation + inflationPressure + energyPricePressure + p.inflationPersistence * (previousUnderlyingInflation - p.baselineInflation);
    const domesticInflation = p.baselineInflation + gapInflation + inflationPressure + p.inflationPersistence * (previousDomesticInflation - p.baselineInflation);
    const taxAdjustedPrice = demand.priceLevelEffect;
    demand.priceLevelEffect += demand.directTaxPriceEffect;
    demand.deflatorLevelEffect += demand.directTaxDeflatorEffect;
    positive(1 + demand.priceLevelEffect, 'consumer price level');
    positive(1 + demand.deflatorLevelEffect, 'GDP deflator level');
    const inflation = (1 + underlyingInflation) * (1 + demand.priceLevelEffect) / (1 + previousPriceEffect) - 1;
    const taxAdjustedInflation = (1 + underlyingInflation) * (1 + taxAdjustedPrice) / (1 + previousTaxAdjustedPrice) - 1;
    const realGdp = autonomousReal + demand.realOutput;
    // Quantity held fixed: the higher import bill reduces domestic value added
    // except for the part recovered through domestic final prices. This is a
    // level effect, not an annual compounding loss or a CPI-to-GDP passthrough.
    const importPriceBill = state.energy.importBill * shock.energyPriceChange / (1 + shock.energyPriceChange);
    const domesticPriceRecovery = importPriceBill * p.energyDomesticPricePassThrough;
    const nominalBeforeImportPrices = realGdp * priceBefore / (1 + previousEnergyDeflatorEffect)
      * (1 + domesticInflation) * (1 + demand.deflatorLevelEffect) / (1 + previousDeflatorEffect);
    const nominalGdp = nominalBeforeImportPrices - importPriceBill + domesticPriceRecovery;
    positive(nominalGdp, 'nominal GDP after import prices');
    const energyDeflatorEffect = nominalGdp / nominalBeforeImportPrices - 1;
    // Fixed domestic-price numeraire approximation to the change in trading income.
    // No unidentified consumption/production response is inferred from this loss.
    const tradingIncomeChange = -importPriceBill / (nominalBeforeImportPrices / realGdp);
    consumerPriceIndex *= 1 + inflation;
    const expenditureIndex = (consumerPriceIndex / (1 + p.baselineInflation) ** t) ** p.expenditurePriceIndexation;
    state.macro = { nominalGdp, realGdp, potentialGdp: potential, inflation,
      coreInflation: inflation - energyPricePressure, expectedInflation: p.baselineInflation + p.inflationPersistence * (inflation - p.baselineInflation),
      nominalWageGrowth: p.baselineRealGrowth + inflation * p.wageInflationPassThrough,
      realGrowth: realGdp / previous.macro.realGdp - 1, nominalGrowth: nominalGdp / previous.macro.nominalGdp - 1 };
    state.labour.wageGrowth = state.macro.nominalWageGrowth;
    // Monetary tightening in the published GDP/CPI response is already included.
    // Pass its long yield to new/rolled debt without applying a second GDP shock.
    const marketRate = Math.max(0, baseMarketRate + demand.longRateEffect);
    const rolled = rollover(previous.debtPortfolio, year, marketRate, p.newDebtMaturity);
    const fiscalTrend = ((1 + p.baselineRealGrowth) * (1 + p.baselineInflation)) ** t;
    const taxCut = active.filter(x => x.channel === 'tax').reduce((s, x) => s + x.annualCost, 0);
    const expenditure = active.filter(x => x.channel === 'expenditure').reduce((s, x) => s + x.annualCost, 0);
    const revenueYear = t - p.taxCollectionLag;
    const revenueBase = revenueYear <= 0 ? initial.macro.nominalGdp : revenueYear === t ? nominalGdp : steps[revenueYear - 1].state.macro.nominalGdp;
    state.fiscal.taxRevenue = initial.fiscal.taxRevenue * (revenueBase / initial.macro.nominalGdp) ** p.taxRevenueElasticity - taxCut;
    state.fiscal.otherPrimaryRevenue = initial.fiscal.otherPrimaryRevenue * fiscalTrend;
    state.fiscal.interestRevenue = initial.fiscal.interestRevenue * fiscalTrend;
    state.fiscal.primaryExpenditure = initial.fiscal.primaryExpenditure * fiscalTrend * expenditureIndex + expenditure;
    state.fiscal.primaryBalance = state.fiscal.taxRevenue + state.fiscal.otherPrimaryRevenue - state.fiscal.primaryExpenditure;
    state.fiscal.structuralPrimaryBalance = state.fiscal.primaryBalance - taxRate * (realGdp - potential) * nominalGdp / realGdp;
    state.fiscal.interestPayments = rolled.interestPayments;
    const borrowing = rolled.interestPayments - state.fiscal.interestRevenue - state.fiscal.primaryBalance + p.stockFlowAdjustmentRatio * nominalGdp;
    const financed = financeDebt(rolled.buckets, borrowing, year, marketRate, p.newDebtMaturity);
    state.debtPortfolio = financed.buckets;
    state.fiscal.grossDebt = financed.buckets.reduce((s, b) => s + b.principal, 0);
    state.fiscal.financialAssets += financed.assetAccumulation;
    state.fiscal.liquidFinancialAssets += financed.assetAccumulation;
    state.fiscal.netDebt = state.fiscal.grossDebt - state.fiscal.financialAssets;
    state.fiscal.liquidityAdjustedNetDebt = state.fiscal.grossDebt - state.fiscal.liquidFinancialAssets;
    const nominalImports = demand.imports * priceBefore;
    // Additional energy imports are a distinct resource bill; do not include them in demand.imports twice.
    // Replace the thermal component's generic GDP growth with the explicit
    // electricity path. Otherwise demand growth would enter imports twice.
    const thermalTrendCorrection = electricity.initialFuelBill * (commonPriceIndex - fiscalTrend);
    const energyOutsideDemand = energyImportIncrease - demand.projectEnergyNetImports * priceBefore + thermalTrendCorrection;
    const importsIncrease = nominalImports + energyOutsideDemand;
    state.external.exports = initial.external.exports * fiscalTrend + demand.exports * priceBefore;
    state.external.imports = initial.external.imports * fiscalTrend + importsIncrease;
    state.external.tradeBalance = state.external.exports - state.external.imports;
    // The reference does not identify a goods/services split for additional exports.
    // Use the same explicit split assumption as imports, keeping total trade exact.
    state.external.goodsBalance = initial.external.goodsBalance * fiscalTrend + (demand.exports * priceBefore - nominalImports) * p.goodsImportShare - energyOutsideDemand - demand.projectEnergyNetImports * priceBefore * (1 - p.goodsImportShare);
    state.external.servicesBalance = state.external.tradeBalance - state.external.goodsBalance;
    state.external.primaryIncomeBalance = initial.external.primaryIncomeBalance * fiscalTrend;
    state.external.secondaryIncomeBalance = initial.external.secondaryIncomeBalance * fiscalTrend;
    state.external.currentAccount = state.external.tradeBalance + state.external.primaryIncomeBalance + state.external.secondaryIncomeBalance;
    state.external.niip = previous.external.niip + state.external.currentAccount;
    state.external.essentialImports = Math.max(0, initial.external.essentialImports * fiscalTrend + nominalImports * p.essentialImportShare + energyOutsideDemand + demand.projectEnergyNetImports * priceBefore * (1 - p.essentialImportShare));
    state.external.termsOfTrade = initial.external.termsOfTrade / (1 + shock.energyPriceChange * initial.energy.importBill / initial.external.imports);
    const production = productionCapacity(state, p, t);
    steps.push({ state, production, demand, policyCost, sectorDemand, maturingDebt: rolled.maturingDebt, energyImportIncrease, inflationPressure,
      resourcePower, estimatedLoads: policies.some(policy => policy.load?.estimated),
      importPriceEffects: { domesticPriceRecovery, gdpDeflatorLevelEffect: energyDeflatorEffect,
        tradingIncomeChange, realDomesticIncome: realGdp + tradingIncomeChange, expenditureIndex },
      taxAdjustedInflation, refinancingRate: marketRate, referenceRateEffect: demand.longRateEffect, coverage,
      electricity: { demandTwh: electricity.demandTwh, thermalTwh: electricity.thermalTwh, thermalIncreaseTwh: electricity.thermalIncreaseTwh,
        commonFuelIncrease, operatingImportReduction: demand.projectEnergyNetImports === 0 ? 0 : -demand.projectEnergyNetImports * priceBefore * (1 + shock.energyPriceChange) },
      outputGap: (realGdp - potential) / potential, maximumGap: (realGdp - production.maximum) / production.maximum,
      // Acquisition of assets after full debt retirement is an SFA for gross (not net) debt.
      metrics: fiscalMetrics(state, rolled.maturingDebt, previous.fiscal.grossDebt, previous.macro.nominalGdp,
        p.stockFlowAdjustmentRatio + financed.assetAccumulation / nominalGdp) });
    previous = state;
    previousPriceEffect = demand.priceLevelEffect; previousDeflatorEffect = demand.deflatorLevelEffect;
    previousTaxAdjustedPrice = taxAdjustedPrice;
    previousUnderlyingInflation = underlyingInflation;
    previousDomesticInflation = domesticInflation; previousEnergyDeflatorEffect = energyDeflatorEffect;
    previousCommonFuelIncrease = commonFuelIncrease;
    commonPriceIndex *= 1 + p.baselineInflation + p.inflationPersistence ** t * (initial.macro.inflation - p.baselineInflation);
  }
  return { initial: snapshot(structuredClone(initial), p), steps };
}
