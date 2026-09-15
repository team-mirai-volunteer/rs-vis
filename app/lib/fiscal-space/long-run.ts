import type { EconomyState, ModelParameters, Policy, Simulation } from '@/types/fiscal-space';
import { financeDebt, rollover } from './debt';
import { supplyTotal } from './supply';
import { projectNetOutput, projectResponses } from './project-response';

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
  const configured = (year: number) => c.realization * (supplyTotal(initial, policies, year, p) + projectResponses(initial, policies, year, p).reduce((s, x) => s + projectNetOutput(x), 0));
  const startBenefit = configured(start.state.year);
  let portfolio = structuredClone(start.state.debtPortfolio), basePortfolio = structuredClone(base.state.debtPortfolio);
  const rows = [];
  const nominalHistory = [initial.macro.nominalGdp, ...short.steps.map(s => s.state.macro.nominalGdp)];
  const baseNominalHistory = [initial.macro.nominalGdp, ...baseline.steps.map(s => s.state.macro.nominalGdp)];
  const revenue = (history: number[], year: number) => initial.fiscal.taxRevenue * (history[Math.max(0, year - p.taxCollectionLag)] / initial.macro.nominalGdp) ** p.taxRevenueElasticity;
  for (let year = start.state.year + 1; year <= c.years; year++) {
    const elapsed = year - start.state.year;
    const active = policies.filter(x => x.kind === 'permanent' || year <= x.duration);
    const benefit = configured(year);
    const fade = Math.max(0, 1 - elapsed / 5);
    const baseReal = base.state.macro.realGdp * (1 + c.realGrowth) ** elapsed;
    const real = baseReal + benefit + (start.state.macro.realGdp - base.state.macro.realGdp - startBenefit) * fade;
    const basePrice = base.state.macro.nominalGdp / base.state.macro.realGdp;
    const price = (basePrice + (start.state.macro.nominalGdp / start.state.macro.realGdp - basePrice) * fade) * (1 + c.inflation) ** elapsed;
    const nominal = real * price, baseNominal = baseReal * (basePrice * (1 + c.inflation) ** elapsed);
    const fiscalTrend = ((1 + c.realGrowth) * (1 + c.inflation)) ** elapsed;
    const cost = active.reduce((s, x) => s + x.annualCost, 0);
    nominalHistory.push(nominal); baseNominalHistory.push(baseNominal);
    const basePb = revenue(baseNominalHistory, year) + base.state.fiscal.otherPrimaryRevenue * fiscalTrend - base.state.fiscal.primaryExpenditure * fiscalTrend;
    const pb = basePb + (revenue(nominalHistory, year) - revenue(baseNominalHistory, year)) - cost;
    const rolled = rollover(portfolio, year, c.rate, p.newDebtMaturity);
    const baseRolled = rollover(basePortfolio, year, c.rate, p.newDebtMaturity);
    const interestRevenue = base.state.fiscal.interestRevenue * fiscalTrend;
    portfolio = financeDebt(rolled.buckets, rolled.interestPayments - interestRevenue - pb + p.stockFlowAdjustmentRatio * nominal, year, c.rate, p.newDebtMaturity).buckets;
    basePortfolio = financeDebt(baseRolled.buckets, baseRolled.interestPayments - interestRevenue - basePb + p.stockFlowAdjustmentRatio * baseNominal, year, c.rate, p.newDebtMaturity).buckets;
    rows.push({ year, policyCost: cost, supplyBenefit: benefit * initialPrice, debtGdp: portfolio.reduce((s, x) => s + x.principal, 0) / nominal,
      baselineDebtGdp: basePortfolio.reduce((s, x) => s + x.principal, 0) / baseNominal, interest: rolled.interestPayments });
  }
  return rows;
}
