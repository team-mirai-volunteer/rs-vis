import type { EconomyState, ModelParameters, Policy, PolicyComparison, Shock, Thresholds } from '@/types/fiscal-space';
import { NO_SHOCK, PARAMETERS, POLICIES, SECTOR_LABELS, THRESHOLDS, TRILLION } from './assumptions';
import { simulate } from './simulate';
import { REFERENCES } from './calibration';
import { hasCommercialSupply, SUPPLY_CASES, SUPPLY_UNAVAILABLE } from './supply';
import { investmentAtCommissioning } from './investment';

/** Marginal one-year 1tn addition on top of the current mix; investment payoffs can arrive later. */
export function compareNextTrillion(initial: EconomyState, current: Policy[], p: ModelParameters = PARAMETERS, shock: Shock = NO_SHOCK, thresholds: Thresholds = THRESHOLDS, candidates: Policy[] = POLICIES) {
  const baseline = simulate(initial, current, 5, p, shock);
  return candidates.map(policy => {
    const incremental: Policy = { ...policy, annualCost: TRILLION, duration: 1, kind: policy.kind === 'growth' ? 'growth' : 'temporary' };
    const projection = simulate(initial, [...current, incremental], 5, p, shock);
    const first = projection.steps[0], baseFirst = baseline.steps[0], last = projection.steps[4], baseLast = baseline.steps[4];
    // Compare additional physical resource use relative to each configured threshold.
    const consumed = [
      { label: `${SECTOR_LABELS[policy.sector]}の労働・能力`, delta: (first.sectorDemand[policy.sector] - baseFirst.sectorDemand[policy.sector]) / thresholds.sector },
      { label: '電力', delta: (first.state.energy.peakDemand / first.state.energy.firmCapacity - baseFirst.state.energy.peakDemand / baseFirst.state.energy.firmCapacity) / thresholds.energy },
      { label: '全体の生産能力', delta: (first.state.macro.realGdp / first.production.maximum - baseFirst.state.macro.realGdp / baseFirst.production.maximum) / thresholds.capacity },
    ].sort((a, b) => b.delta - a.delta);
    const publishedYears = REFERENCES[p.referenceModel].years;
    const configured = !!policy.supply || hasCommercialSupply(policy) ||
      (policy.kind === 'growth' && [policy.potentialGdpEffect, policy.tfpEffect, policy.labourProductivityEffect].some(v => v > 0)) ||
      (['income-tax', 'social-insurance'].includes(policy.id) && (p.hoursElasticity > 0 || p.participationElasticity > 0));
    const row: Omit<PolicyComparison, 'space'> = { policy, publishedYears,
      supplyNote: hasCommercialSupply(policy) ? '事業条件による純輸出・輸入代替の寄与。一般均衡の予測ではない。'
        : policy.supply ? SUPPLY_CASES[policy.id].label + '：支出年別の蓄積・遅れ・減耗を計算。'
        : ['income-tax', 'social-insurance'].includes(policy.id) ? '負担軽減中の労働時間・参加。1年限りの追加軽減は2年目以降には終了。'
        : SUPPLY_UNAVAILABLE[policy.id] ?? '供給経路の条件が必要',
      investment: investmentAtCommissioning(initial, current, incremental, p),
      periods: ([1, 3, 5] as const).map(year => {
        const step = projection.steps[year - 1], base = baseline.steps[year - 1];
        // Match simulate.ts's nominal import accounting, including the energy
        // price shock. Use each path's PREVIOUS deflator, not current CPI.
        const previous = year === 1 ? initial : projection.steps[year - 2].state;
        const basePrevious = year === 1 ? initial : baseline.steps[year - 2].state;
        const energyOperatingTradeEffect = -(step.demand.projectEnergyNetImports * previous.macro.nominalGdp / previous.macro.realGdp
          - base.demand.projectEnergyNetImports * basePrevious.macro.nominalGdp / basePrevious.macro.realGdp) * (1 + shock.energyPriceChange);
        return { year,
          energyOperatingTradeEffect,
          realGdpEffect: step.state.macro.realGdp - base.state.macro.realGdp,
          inflationPressure: step.state.macro.inflation - base.state.macro.inflation,
          exports: step.state.external.exports - base.state.external.exports,
          imports: step.state.external.imports - base.state.external.imports,
          tradeBalanceEffect: step.state.external.tradeBalance - base.state.external.tradeBalance,
          domesticSubstitution: step.demand.domesticSubstitution - base.demand.domesticSubstitution,
          debtGdp: step.metrics.grossDebtGdp, debtGdpChange: step.metrics.grossDebtGdp - base.metrics.grossDebtGdp,
          potentialGdpEffect: step.state.macro.potentialGdp - base.state.macro.potentialGdp };
      }),
      supplyEffectConfigured: configured,
      realGdpEffect: first.state.macro.realGdp - baseFirst.state.macro.realGdp,
      inflationPressure: first.state.macro.inflation - baseFirst.state.macro.inflation,
      exports: first.state.external.exports - baseFirst.state.external.exports,
      imports: first.state.external.imports - baseFirst.state.external.imports,
      tradeBalanceEffect: first.state.external.tradeBalance - baseFirst.state.external.tradeBalance,
      debtGdp5y: last.metrics.grossDebtGdp, debtGdpChange5y: last.metrics.grossDebtGdp - baseLast.metrics.grossDebtGdp,
      potentialGdpEffect: last.state.macro.potentialGdp - baseLast.state.macro.potentialGdp,
      mainCapacity: `${consumed[0].label} (+${(consumed[0].delta * 100).toFixed(3)}%)` };
    return row;
  });
}

export function rateShockComparison(initial: EconomyState, current: Policy[], p: ModelParameters = PARAMETERS) {
  const baseline = simulate(initial, current, 5, p);
  return [100, 200, 300].map(bp => {
    const projection = simulate(initial, current, 5, p, { ...NO_SHOCK, marketRateDelta: bp / 10000 });
    return { bp, years: [1, 3, 5].map(year => ({ year,
      interestIncrease: projection.steps[year - 1].state.fiscal.interestPayments - baseline.steps[year - 1].state.fiscal.interestPayments })) };
  });
}
