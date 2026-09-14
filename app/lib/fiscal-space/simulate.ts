import type { EconomyState, ModelParameters, Policy, ProjectionStep, Sector, Shock, Simulation } from '@/types/fiscal-space';
import { NO_SHOCK, PARAMETERS, SECTORS } from './assumptions';
import { allocateDemand } from './demand';
import { financeDebt, fiscalMetrics, rollover } from './debt';
import { positive, productionCapacity } from './production';

const sectorZeros = () => Object.fromEntries(SECTORS.map(s => [s, 0])) as Record<Sector, number>;
const emptyDemand = () => ({ additionalDemand: 0, realOutput: 0, imports: 0, prices: 0, details: [] });

export function snapshot(state: EconomyState, p: ModelParameters): ProjectionStep {
  const production = productionCapacity(state, p, 1);
  return { state, production, demand: emptyDemand(), policyCost: 0,
    metrics: fiscalMetrics(state, state.debtPortfolio.filter(b => b.maturityYear <= state.year + 1).reduce((s, b) => s + b.principal, 0), state.fiscal.grossDebt, state.macro.nominalGdp),
    outputGap: (state.macro.potentialGdp - state.macro.realGdp) / state.macro.potentialGdp,
    maximumGap: (production.maximum - state.macro.realGdp) / production.maximum,
    maturingDebt: 0, energyImportIncrease: 0, inflationPressure: 0, sectorDemand: sectorZeros() };
}

function validate(initial: EconomyState, policies: Policy[], horizon: number, p: ModelParameters, shock: Shock) {
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 100) throw new RangeError('horizon must be 1–100 years');
  positive(initial.macro.realGdp, 'real GDP'); positive(initial.macro.nominalGdp, 'nominal GDP');
  positive(initial.macro.potentialGdp, 'potential GDP');
  positive(initial.energy.importedEnergy, 'base imported energy');
  positive(initial.energy.primaryDemand, 'primary energy demand');
  positive(initial.energy.peakDemand, 'peak demand'); positive(initial.energy.firmCapacity, 'firm capacity');
  positive(initial.labour.labourForce, 'labour force');
  const checkFinite = (value: unknown): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('State values must be finite');
    if (value && typeof value === 'object') Object.values(value).forEach(checkFinite);
  };
  checkFinite(initial);
  if (Math.abs(initial.debtPortfolio.reduce((s, b) => s + b.principal, 0) - initial.fiscal.grossDebt) > 1) throw new RangeError('Debt portfolio must reconcile to gross debt');
  for (const value of [...Object.values(p).filter(v => typeof v === 'number'), ...Object.values(shock)]) {
    if (!Number.isFinite(value)) throw new RangeError('Parameters must be finite');
  }
  positive(1 + p.baselineRealGrowth + shock.realGrowthDelta, 'real growth factor');
  positive(1 + p.baselineInflation, 'inflation factor'); positive(1 + shock.energyPriceChange, 'energy price factor');
  positive(p.supplySlackReference, 'supply slack reference'); positive(p.sectorSlackReference, 'sector slack reference');
  for (const name of ['minimumCapacityFactor', 'overflowImportShare', 'inflationPersistence', 'investmentDepreciation', 'goodsImportShare', 'essentialImportShare'] as const) {
    if (p[name] < 0 || p[name] > 1) throw new RangeError(`${name} must be 0–1`);
  }
  if (p.marketRate + shock.marketRateDelta < 0) throw new RangeError('Negative market rate is outside MVP scope');
  for (const policy of policies) {
    for (const v of Object.values(policy)) if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) throw new RangeError('Policy values must be nonnegative and finite');
    if (policy.importPropensity > 1 || !Number.isInteger(policy.duration) || policy.duration < 1 || !Number.isInteger(policy.implementationLag)) throw new RangeError('Invalid policy assumptions');
  }
}

/** Explicit baseline paths keep temporary demand from becoming permanent growth by accident. */
export function simulate(initial: EconomyState, policies: Policy[], horizon = 10, p: ModelParameters = PARAMETERS, shock: Shock = NO_SHOCK): Simulation {
  validate(initial, policies, horizon, p, shock);
  let previous = structuredClone(initial);
  let potentialAddition = 0, capitalAddition = 0, tfpAddition = 0, energyAddition = 0, productivityAddition = 0;
  const cohorts: { due: number; realCost: number; policy: Policy }[] = [];
  const steps: ProjectionStep[] = [];
  const taxRate = initial.fiscal.taxRevenue / initial.macro.nominalGdp;
  const marketRate = p.marketRate + shock.marketRateDelta;
  for (let t = 1; t <= horizon; t++) {
    const year = initial.year + t;
    const active = policies.filter(policy => policy.kind === 'permanent' || t <= policy.duration);
    const priceBefore = previous.macro.nominalGdp / previous.macro.realGdp;
    const baselineReal = initial.macro.realGdp * (1 + p.baselineRealGrowth + shock.realGrowthDelta) ** t;
    const baselinePotential = initial.macro.potentialGdp * (1 + p.baselineRealGrowth) ** t;
    const decay = 1 - p.investmentDepreciation;
    potentialAddition *= decay; capitalAddition *= decay; tfpAddition *= decay; energyAddition *= decay; productivityAddition *= decay;
    for (const policy of active) {
      if (policy.kind === 'growth') cohorts.push({ due: t + policy.implementationLag, realCost: policy.annualCost / priceBefore, policy });
    }
    for (const c of cohorts.filter(c => c.due === t)) {
      potentialAddition += c.realCost * c.policy.potentialGdpEffect;
      capitalAddition += c.realCost / initial.macro.realGdp * c.policy.capitalEffect;
      tfpAddition += c.realCost / initial.macro.realGdp * c.policy.tfpEffect;
      energyAddition += c.realCost / initial.macro.realGdp * c.policy.energyCapacityEffect;
      productivityAddition += c.realCost / initial.macro.realGdp * c.policy.labourProductivityEffect;
    }
    const potential = (baselinePotential + potentialAddition) * (1 + tfpAddition + productivityAddition);
    // Supply investment expands the baseline tax base with the initial actual/potential ratio.
    const autonomousReal = baselineReal + (potential - baselinePotential) * initial.macro.realGdp / initial.macro.potentialGdp;
    const state = structuredClone(previous);
    state.year = year;
    state.macro = { ...state.macro, realGdp: autonomousReal, nominalGdp: autonomousReal * priceBefore, potentialGdp: potential };
    state.production = { inputs: { ...initial.production.inputs, capital: initial.production.inputs.capital + capitalAddition,
      energy: initial.production.inputs.energy + energyAddition }, tfp: initial.production.tfp * (1 + tfpAddition),
      labourProductivity: initial.production.labourProductivity * (1 + productivityAddition) };
    state.labour.sectorUtilization = { ...initial.labour.sectorUtilization };
    const demand = allocateDemand(state, active, p, t);
    const policyCost = active.reduce((s, policy) => s + policy.annualCost, 0);
    const inflationSensitivity = policyCost > 0 ? active.reduce((s, policy) => s + policy.annualCost * policy.inflationSensitivity, 0) / policyCost : 0;
    const inflationPressure = demand.prices / autonomousReal * p.inflationPassThrough * inflationSensitivity;
    const sectorDemand = sectorZeros();
    let energyDemandIncrease = 0;
    for (const policy of active) {
      const intensity = policy.annualCost / priceBefore / autonomousReal;
      sectorDemand[policy.sector] += intensity * policy.labourDemand;
      energyDemandIncrease += initial.energy.primaryDemand * intensity * policy.energyDemand;
    }
    for (const sector of SECTORS) state.labour.sectorUtilization[sector] += sectorDemand[sector];
    const labourUse = Object.values(sectorDemand).reduce((a, b) => a + b, 0);
    // This is requested labour: it can exceed labour force, which is reported as a violation.
    state.labour.employment = initial.labour.employment + initial.labour.labourForce * labourUse;
    state.labour.unemployment = Math.max(0, state.labour.labourForce - state.labour.employment);
    state.energy.primaryDemand = initial.energy.primaryDemand + energyDemandIncrease;
    state.energy.domesticSupply = initial.energy.domesticSupply * (1 + energyAddition);
    state.energy.importedEnergy = Math.max(0, state.energy.primaryDemand - state.energy.domesticSupply);
    state.energy.firmCapacity = initial.energy.firmCapacity * (1 + energyAddition);
    state.energy.peakDemand = initial.energy.peakDemand * (1 + energyDemandIncrease / initial.energy.primaryDemand);
    state.energy.reserveMargin = (state.energy.firmCapacity - state.energy.peakDemand) / state.energy.peakDemand;
    const baselineEnergyBill = initial.energy.importBill * priceBefore;
    state.energy.importBill = baselineEnergyBill * state.energy.importedEnergy / initial.energy.importedEnergy * (1 + shock.energyPriceChange);
    const energyImportIncrease = state.energy.importBill - baselineEnergyBill;
    // A permanent price-level shock contributes to inflation once; new import demand contributes each year.
    const energyPricePressure = (Math.max(0, energyImportIncrease) - (t > 1 ? baselineEnergyBill * shock.energyPriceChange : 0)) / (autonomousReal * priceBefore) * p.energyPricePassThrough;
    const inflation = p.baselineInflation + inflationPressure + energyPricePressure + p.inflationPersistence * (previous.macro.inflation - p.baselineInflation);
    const realGdp = autonomousReal + demand.realOutput;
    const nominalGdp = realGdp * priceBefore * (1 + inflation);
    state.macro = { nominalGdp, realGdp, potentialGdp: potential, inflation,
      coreInflation: inflation - energyPricePressure, expectedInflation: p.baselineInflation + p.inflationPersistence * (inflation - p.baselineInflation),
      nominalWageGrowth: p.baselineRealGrowth + inflation * p.wageInflationPassThrough,
      realGrowth: realGdp / previous.macro.realGdp - 1, nominalGrowth: nominalGdp / previous.macro.nominalGdp - 1 };
    state.labour.wageGrowth = state.macro.nominalWageGrowth;
    const rolled = rollover(previous.debtPortfolio, year, marketRate, p.newDebtMaturity);
    const fiscalTrend = ((1 + p.baselineRealGrowth) * (1 + p.baselineInflation)) ** t;
    const taxCut = active.filter(x => x.channel === 'tax').reduce((s, x) => s + x.annualCost, 0);
    const expenditure = active.filter(x => x.channel === 'expenditure').reduce((s, x) => s + x.annualCost, 0);
    state.fiscal.taxRevenue = taxRate * nominalGdp - taxCut;
    state.fiscal.primaryExpenditure = initial.fiscal.primaryExpenditure * fiscalTrend + expenditure;
    state.fiscal.primaryBalance = state.fiscal.taxRevenue - state.fiscal.primaryExpenditure;
    state.fiscal.structuralPrimaryBalance = state.fiscal.primaryBalance - taxRate * (realGdp - potential) * nominalGdp / realGdp;
    state.fiscal.interestPayments = rolled.interestPayments;
    const borrowing = rolled.interestPayments - state.fiscal.primaryBalance + p.stockFlowAdjustmentRatio * nominalGdp;
    const financed = financeDebt(rolled.buckets, borrowing, year, marketRate, p.newDebtMaturity);
    state.debtPortfolio = financed.buckets;
    state.fiscal.grossDebt = financed.buckets.reduce((s, b) => s + b.principal, 0);
    state.fiscal.financialAssets += financed.assetAccumulation;
    state.fiscal.liquidFinancialAssets += financed.assetAccumulation;
    state.fiscal.netDebt = state.fiscal.grossDebt - state.fiscal.financialAssets;
    state.fiscal.liquidityAdjustedNetDebt = state.fiscal.grossDebt - state.fiscal.liquidFinancialAssets;
    const nominalImports = demand.imports * priceBefore;
    // Additional energy imports are a distinct resource bill; do not include them in demand.imports twice.
    const importsIncrease = nominalImports + energyImportIncrease;
    state.external.exports = initial.external.exports * fiscalTrend;
    state.external.imports = initial.external.imports * fiscalTrend + importsIncrease;
    state.external.tradeBalance = state.external.exports - state.external.imports;
    state.external.goodsBalance = initial.external.goodsBalance * fiscalTrend - nominalImports * p.goodsImportShare - energyImportIncrease;
    state.external.servicesBalance = state.external.tradeBalance - state.external.goodsBalance;
    state.external.primaryIncomeBalance = initial.external.primaryIncomeBalance * fiscalTrend;
    state.external.secondaryIncomeBalance = initial.external.secondaryIncomeBalance * fiscalTrend;
    state.external.currentAccount = state.external.tradeBalance + state.external.primaryIncomeBalance + state.external.secondaryIncomeBalance;
    state.external.niip = previous.external.niip + state.external.currentAccount;
    state.external.essentialImports = initial.external.essentialImports * fiscalTrend + nominalImports * p.essentialImportShare + energyImportIncrease;
    state.external.termsOfTrade = initial.external.termsOfTrade / (1 + shock.energyPriceChange * initial.energy.importBill / initial.external.imports);
    const production = productionCapacity(state, p, t);
    steps.push({ state, production, demand, policyCost, sectorDemand, maturingDebt: rolled.maturingDebt, energyImportIncrease, inflationPressure,
      outputGap: (potential - realGdp) / potential, maximumGap: (production.maximum - realGdp) / production.maximum,
      // Acquisition of assets after full debt retirement is an SFA for gross (not net) debt.
      metrics: fiscalMetrics(state, rolled.maturingDebt, previous.fiscal.grossDebt, previous.macro.nominalGdp,
        p.stockFlowAdjustmentRatio + financed.assetAccumulation / nominalGdp) });
    previous = state;
  }
  return { initial: snapshot(structuredClone(initial), p), steps };
}
