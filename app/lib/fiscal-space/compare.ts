import type { EconomyState, ModelParameters, Policy, PolicyComparison, Shock, Thresholds } from '@/types/fiscal-space';
import { NO_SHOCK, PARAMETERS, POLICIES, SECTOR_LABELS, THRESHOLDS, TRILLION } from './assumptions';
import { simulate } from './simulate';

/** Marginal one-year 1tn addition on top of the current mix; investment payoffs can arrive later. */
export function compareNextTrillion(initial: EconomyState, current: Policy[], p: ModelParameters = PARAMETERS, shock: Shock = NO_SHOCK, thresholds: Thresholds = THRESHOLDS, candidates: Policy[] = POLICIES) {
  const baseline = simulate(initial, current, 10, p, shock);
  return candidates.map(policy => {
    const incremental: Policy = { ...policy, annualCost: TRILLION, duration: 1, kind: policy.kind === 'growth' ? 'growth' : 'temporary' };
    const projection = simulate(initial, [...current, incremental], 10, p, shock);
    const first = projection.steps[0], baseFirst = baseline.steps[0], last = projection.steps[9], baseLast = baseline.steps[9];
    // Compare additional physical resource use relative to each configured threshold.
    const consumed = [
      { label: `${SECTOR_LABELS[policy.sector]}の労働・能力`, delta: (first.sectorDemand[policy.sector] - baseFirst.sectorDemand[policy.sector]) / thresholds.sector },
      { label: '電力', delta: (first.state.energy.peakDemand / first.state.energy.firmCapacity - baseFirst.state.energy.peakDemand / baseFirst.state.energy.firmCapacity) / thresholds.energy },
      { label: '全体の生産能力', delta: (first.state.macro.realGdp / first.production.maximum - baseFirst.state.macro.realGdp / baseFirst.production.maximum) / thresholds.capacity },
    ].sort((a, b) => b.delta - a.delta);
    const row: Omit<PolicyComparison, 'space'> = { policy,
      realGdpEffect: first.state.macro.realGdp - baseFirst.state.macro.realGdp,
      inflationPressure: first.state.macro.inflation - baseFirst.state.macro.inflation,
      imports: first.state.external.imports - baseFirst.state.external.imports,
      tradeBalanceEffect: first.state.external.tradeBalance - baseFirst.state.external.tradeBalance,
      debtGdp10y: last.metrics.grossDebtGdp, debtGdpChange10y: last.metrics.grossDebtGdp - baseLast.metrics.grossDebtGdp,
      potentialGdpEffect: last.state.macro.potentialGdp - baseLast.state.macro.potentialGdp,
      mainCapacity: `${consumed[0].label} (+${(consumed[0].delta * 100).toFixed(3)}pt)` };
    return row;
  });
}

export function rateShockComparison(initial: EconomyState, current: Policy[], p: ModelParameters = PARAMETERS) {
  const baseline = simulate(initial, current, 10, p);
  return [100, 200, 300].map(bp => {
    const projection = simulate(initial, current, 10, p, { ...NO_SHOCK, marketRateDelta: bp / 10000 });
    return { bp, years: [1, 5, 10].map(year => ({ year,
      interestIncrease: projection.steps[year - 1].state.fiscal.interestPayments - baseline.steps[year - 1].state.fiscal.interestPayments })) };
  });
}
