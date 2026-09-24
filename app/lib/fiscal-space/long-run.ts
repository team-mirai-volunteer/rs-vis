import type { EconomyState, ModelParameters, Policy, Simulation } from '@/types/fiscal-space';
import { insuranceIncidence } from './insurance-response';
import { financeDebt, rollover } from './debt';
import { policyProduction } from './policy-production';
import { investmentPricePath } from './investment-price';
import { projectRevenueComponents } from './revenue';
import { demographicPath, expenditureDemographicFactor, type BirthDriver } from './demographics';

export interface LongRunAssumptions { years: number; realGrowth: number; inflation: number; rate: number; realization: number }
export const LONG_RUN: LongRunAssumptions = { years: 30, realGrowth: .01, inflation: .02, rate: .03, realization: .5 };

/** Separate closure after the published horizon. No macro multiplier tail.
 * Short-term demand deviations fade over five years. Only configured operating
 * benefits survive, with their own commissioning, lifetime and depreciation. */
export function longRunScenario(initial: EconomyState, policies: Policy[], short: Simulation, baseline: Simulation,
  p: ModelParameters, c: LongRunAssumptions) {
  if (!Number.isInteger(c.years) || c.years <= short.steps.length || c.years > 100 ||
    Object.values(c).some(x => !Number.isFinite(x)) || c.realGrowth <= -1 || c.inflation <= -1 || c.rate < 0 || c.realization < 0 || c.realization > 1) throw new RangeError('Invalid long-run scenario');
  const start = short.steps.at(-1)!, base = baseline.steps.at(-1)!;
  const initialPrice = initial.macro.nominalGdp / initial.macro.realGdp;
  const shortPrices = investmentPricePath(initial, p);
  const shortYears = short.steps.length;
  const terminalPrice = base.state.macro.nominalGdp / base.state.macro.realGdp;
  // Keep already-paid vintages unchanged. Future nominal budgets buy quantities
  // at the common no-policy price at the start of their own payment year.
  const prices = (paid: number) => paid <= shortYears ? shortPrices(paid)
    : terminalPrice * (1 + c.inflation) ** (paid - shortYears - 1);
  const configured = (year: number) => {
    const potential = base.state.macro.potentialGdp * (1 + c.realGrowth) ** Math.max(0, year - shortYears);
    return c.realization * (policyProduction(initial, policies, year, p, potential, prices).potential - potential);
  };
  const startBenefit = configured(start.state.year);
  // Population paths continue from the short run: the policy path keeps its recorded birth drivers
  // and adds permanent family spending; the no-policy path has none. Indices are relative to the short-run end.
  const policyDrivers: BirthDriver[] = short.steps.map(s => s.demographics?.driver).filter((d): d is BirthDriver => !!d);
  const demo = (year: number, drivers: BirthDriver[]) => demographicPath(initial.baseCalendarYear, initial.baseCalendarYear + year, p.demographics, drivers);
  const startBaseDemo = demo(start.state.year, []);
  const labourRatio = (d: ReturnType<typeof demo>, at: ReturnType<typeof demo>) => (d.labourForceIndex / at.labourForceIndex) ** p.demographics.labourElasticity;
  const expenditureRatio = (d: ReturnType<typeof demo>, at: ReturnType<typeof demo>) => expenditureDemographicFactor(d, p.demographics) / expenditureDemographicFactor(at, p.demographics);
  const relativeCpi = short.steps.reduce((index, step, i) => index * (1 + step.state.macro.inflation)
    / (1 + baseline.steps[i].state.macro.inflation), 1);
  let portfolio = structuredClone(start.state.debtPortfolio), basePortfolio = structuredClone(base.state.debtPortfolio);
  const rows = [];
  const nominalHistory = [initial.macro.nominalGdp, ...short.steps.map(s => s.state.macro.nominalGdp)];
  const baseNominalHistory = [initial.macro.nominalGdp, ...baseline.steps.map(s => s.state.macro.nominalGdp)];
  const revenue = (history: number[], year: number) => projectRevenueComponents(initial.fiscal, initial.macro.nominalGdp,
    history[Math.max(0, year - p.taxCollectionLag)], { taxes: p.taxRevenueElasticity, socialContributions: p.socialContributionElasticity }).total;
  for (let year = start.state.year + 1; year <= c.years; year++) {
    const elapsed = year - start.state.year;
    const active = policies.filter(x => x.kind === 'permanent' || year <= x.duration);
    const benefit = configured(year);
    const fade = Math.max(0, 1 - elapsed / 5);
    // Carry the published long-rate response at the end of the short run into
    // policy-path refinancing with the same fade as other short-run deviations.
    const policyRate = c.rate + (start.referenceRateEffect ?? 0) * fade;
    const basePrice0 = base.state.macro.nominalGdp / base.state.macro.realGdp;
    const familyShare = active.filter(x => x.id === 'childcare').reduce((s, x) => s + x.annualCost, 0)
      / (base.state.macro.nominalGdp * ((1 + c.realGrowth) * (1 + c.inflation)) ** elapsed);
    const incidence = insuranceIncidence(policies, year, p.employeeReliefShare, p.insurance);
    const insuranceShare = (incidence.employee + incidence.netWage)
      / (p.netLabourIncomeShare * base.state.macro.nominalGdp * ((1 + c.realGrowth) * (1 + c.inflation)) ** elapsed);
    policyDrivers.push({ calendarYear: initial.baseCalendarYear + year, familySpendingGdpShare: familyShare, netIncomeChange: insuranceShare });
    const policyDemo = demo(year, policyDrivers), baseDemo = demo(year, []);
    void basePrice0;
    const baseReal = base.state.macro.realGdp * (1 + c.realGrowth) ** elapsed * labourRatio(baseDemo, startBaseDemo);
    const policyBaseReal = base.state.macro.realGdp * (1 + c.realGrowth) ** elapsed * labourRatio(policyDemo, startBaseDemo);
    const real = policyBaseReal + benefit + (start.state.macro.realGdp - base.state.macro.realGdp - startBenefit) * fade;
    const basePrice = base.state.macro.nominalGdp / base.state.macro.realGdp;
    const price = (basePrice + (start.state.macro.nominalGdp / start.state.macro.realGdp - basePrice) * fade) * (1 + c.inflation) ** elapsed;
    const nominal = real * price, baseNominal = baseReal * (basePrice * (1 + c.inflation) ** elapsed);
    const fiscalTrend = ((1 + c.realGrowth) * (1 + c.inflation)) ** elapsed;
    const cost = active.reduce((s, x) => s + x.annualCost, 0);
    nominalHistory.push(nominal); baseNominalHistory.push(baseNominal);
    const baseExpenditure = base.state.fiscal.primaryExpenditure * fiscalTrend * expenditureRatio(baseDemo, startBaseDemo);
    const basePb = revenue(baseNominalHistory, year) + base.state.fiscal.otherPrimaryRevenue * fiscalTrend - baseExpenditure;
    // Extra births raise child-linked spending on the policy path; the ageing share is the same population.
    const demographicExpenditureGap = base.state.fiscal.primaryExpenditure * fiscalTrend * (expenditureRatio(policyDemo, startBaseDemo) - expenditureRatio(baseDemo, startBaseDemo));
    // Carry the short-run CPI effect into indexed existing expenditure, using
    // the same explicit five-year fade as other short-run price deviations.
    const indexedExpenditure = base.state.fiscal.primaryExpenditure * fiscalTrend
      * ((1 + (relativeCpi - 1) * fade) ** p.expenditurePriceIndexation - 1);
    const pb = basePb + (revenue(nominalHistory, year) - revenue(baseNominalHistory, year)) - cost - indexedExpenditure - demographicExpenditureGap;
    const rolled = rollover(portfolio, year, policyRate, p.newDebtMaturity);
    const baseRolled = rollover(basePortfolio, year, c.rate, p.newDebtMaturity);
    const interestRevenue = base.state.fiscal.interestRevenue * fiscalTrend;
    portfolio = financeDebt(rolled.buckets, rolled.interestPayments - interestRevenue - pb + p.stockFlowAdjustmentRatio * nominal, year, policyRate, p.newDebtMaturity).buckets;
    basePortfolio = financeDebt(baseRolled.buckets, baseRolled.interestPayments - interestRevenue - basePb + p.stockFlowAdjustmentRatio * baseNominal, year, c.rate, p.newDebtMaturity).buckets;
    rows.push({ year, taxRevenue: revenue(nominalHistory, year), realGdp: real, demographics: policyDemo, policyCost: cost, supplyBenefit: benefit * initialPrice, debtGdp: portfolio.reduce((s, x) => s + x.principal, 0) / nominal,
      baselineDebtGdp: basePortfolio.reduce((s, x) => s + x.principal, 0) / baseNominal, interest: rolled.interestPayments,
      rate: policyRate, baselineInterest: baseRolled.interestPayments,
      labourForceIndex: policyDemo.labourForceIndex, baselineLabourForceIndex: baseDemo.labourForceIndex,
      population65Index: baseDemo.population65Index, extraBirths: policyDemo.cumulativeExtraBirths, beyondProjection: policyDemo.beyondProjection });
  }
  return rows;
}
