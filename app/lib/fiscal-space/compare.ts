import type { EconomyState, ModelParameters, Policy, PolicyComparison, Shock, Thresholds } from '@/types/fiscal-space';
import { NO_SHOCK, PARAMETERS, POLICIES, SECTORS, SECTOR_LABELS, THRESHOLDS, TRILLION } from './assumptions';
import { simulate } from './simulate';
import { REFERENCES } from './calibration';
import { policyReliefLimit } from './policy-limits';
import { hasCommercialSupply, SUPPLY_CASES, SUPPLY_UNAVAILABLE } from './supply';
import { investmentAtCommissioning } from './investment';
import { policyProduction } from './policy-production';
import { loadCoverage } from './policy-load';
import { CONSTRAINTS } from './constraints';

/** Marginal one-year 1tn addition on top of the current mix; investment payoffs can arrive later. */
export function compareNextTrillion(initial: EconomyState, current: Policy[], p: ModelParameters = PARAMETERS, shock: Shock = NO_SHOCK, thresholds: Thresholds = THRESHOLDS, candidates: Policy[] = POLICIES,
  evaluationYears?: number) {
  // Beyond the published years the step responses hold their last value: an explicit
  // extrapolation the UI must label, never another observed multiplier.
  const horizon = Math.max(REFERENCES[p.referenceModel].years, evaluationYears ?? 0);
  const baseline = simulate(initial, current, horizon, p, shock);
  // Omit a full extra trillion when it would exceed the remaining revenue base.
  return candidates.filter(policy => current.filter(x => x.id === policy.id).reduce((sum, x) => sum + x.annualCost, 0) + TRILLION <= policyReliefLimit(policy.id, p)).map(policy => {
    const incremental: Policy = { ...policy, annualCost: TRILLION, duration: 1, kind: policy.kind === 'growth' ? 'growth' : 'temporary' };
    const projection = simulate(initial, [...current, incremental], horizon, p, shock);
    // These are conditional scenarios, not a confidence interval. Re-run the
    // full model so production constraints and nominal prices remain consistent.
    const industryConditions = incremental.trade?.kind === 'industry' ? incremental.trade.assumptions : undefined;
    const replacementScenarios = industryConditions && industryConditions.annualSalesPerInvestment !== null
      ? [0, 1].map(domesticReplacementShare => simulate(initial, [...current, { ...incremental,
        trade: { kind: 'industry' as const, assumptions: { ...industryConditions, domesticReplacementShare } },
      }], horizon, p, shock)) : undefined;
    const first = projection.steps[0], baseFirst = baseline.steps[0], last = projection.steps[horizon - 1], baseLast = baseline.steps[horizon - 1];
    // Compare additional physical resource use relative to each configured threshold.
    const coverage = loadCoverage(policy.load);
    const sector = SECTORS.reduce((a, b) => first.sectorDemand[a] - baseFirst.sectorDemand[a] >= first.sectorDemand[b] - baseFirst.sectorDemand[b] ? a : b);
    const consumed = [
      { label: `${SECTOR_LABELS[sector]}の労働・能力`, known: coverage.sector, delta: (first.sectorDemand[sector] - baseFirst.sectorDemand[sector]) / thresholds.sector },
      { label: '電力', known: coverage.energy, delta: (CONSTRAINTS.find(c => c.id === 'energy')!.measure(first) - CONSTRAINTS.find(c => c.id === 'energy')!.measure(baseFirst)) / thresholds.energy },
      { label: '全体の生産能力', known: true, delta: (first.state.macro.realGdp / first.production.maximum - baseFirst.state.macro.realGdp / baseFirst.production.maximum) / thresholds.capacity },
    ].filter(resource => resource.known).sort((a, b) => b.delta - a.delta);
    const unknownLoads = [!coverage.sector && '産業', !coverage.energy && '電力'].filter(Boolean);
    const publishedYears = REFERENCES[p.referenceModel].years;
    const configured = !!policy.supply || hasCommercialSupply(policy) ||
      (policy.kind === 'growth' && [policy.potentialGdpEffect, policy.tfpEffect, policy.labourProductivityEffect].some(v => v > 0)) ||
      (['income-tax', 'resident-tax', 'social-insurance'].includes(policy.id) && (p.hoursElasticity > 0 || p.participationElasticity > 0));
    const row: Omit<PolicyComparison, 'space'> = { policy, publishedYears,
      supplyNote: hasCommercialSupply(policy) ? '事業条件による純輸出・輸入代替の寄与。一般均衡の予測ではない。'
        : policy.supply ? SUPPLY_CASES[policy.id].label + '：支出年別の蓄積・遅れ・減耗を計算。'
        : ['income-tax', 'resident-tax', 'social-insurance'].includes(policy.id) ? '負担軽減中の労働時間・参加。1年限りの追加軽減は2年目以降には終了。'
        : SUPPLY_UNAVAILABLE[policy.id] ?? '供給経路の条件が必要',
      investment: investmentAtCommissioning(initial, current, incremental, p),
      periods: [1, 3, 5, 10, 15].filter(year => year <= horizon).map(year => {
        const step = projection.steps[year - 1], base = baseline.steps[year - 1];
        // Match simulate.ts's nominal import accounting, including the energy
        // price shock. Use each path's PREVIOUS deflator, not current CPI.
        const previous = year === 1 ? initial : projection.steps[year - 2].state;
        const basePrevious = year === 1 ? initial : baseline.steps[year - 2].state;
        const price = previous.macro.nominalGdp / previous.macro.realGdp;
        const basePrice = basePrevious.macro.nominalGdp / basePrevious.macro.realGdp;
        const operating = step.demand.projectOperatingImports * price - base.demand.projectOperatingImports * basePrice;
        const substitution = step.demand.domesticSubstitution * price - base.demand.domesticSubstitution * basePrice;
        const imports = step.state.external.imports - base.state.external.imports;
        const energyOperatingTradeEffect = -(step.demand.projectEnergyNetImports * price
          - base.demand.projectEnergyNetImports * basePrice) * (1 + shock.energyPriceChange);
        return { year,
          industryImports: replacementScenarios ? { operating, substitution, other: imports - operating + substitution,
            noReplacement: replacementScenarios[0].steps[year - 1].state.external.imports - base.state.external.imports,
            fullReplacement: replacementScenarios[1].steps[year - 1].state.external.imports - base.state.external.imports } : undefined,
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
      debtGdpAtHorizon: last.metrics.grossDebtGdp, debtGdpChangeAtHorizon: last.metrics.grossDebtGdp - baseLast.metrics.grossDebtGdp,
      potentialGdpEffect: last.state.macro.potentialGdp - baseLast.state.macro.potentialGdp,
      // Realized (not potential) supply at the horizon, in year-0 real GDP. Non-capital
      // supply cases ramp only after the published years, so this is zero by design there.
      realizedSupplyEffect: (() => {
        const basePotential = initial.macro.potentialGdp * (1 + p.baselineRealGrowth) ** horizon;
        const realized = (policies: Policy[]) => policyProduction(initial, policies, horizon, p, basePotential, undefined, true, false).potential;
        return (realized([...current, incremental]) - realized(current)) * initial.macro.realGdp / initial.macro.potentialGdp;
      })(),
      mainCapacity: `${consumed[0].label} (${consumed[0].delta >= 0 ? '+' : ''}${(consumed[0].delta * 100).toFixed(3)}ポイント)` +
        (unknownLoads.length ? `。${unknownLoads.join('・')}の追加負荷は未評価` : '') };
    return row;
  });
}

export function rateShockComparison(initial: EconomyState, current: Policy[], p: ModelParameters = PARAMETERS) {
  const horizon = REFERENCES[p.referenceModel].years;
  const baseline = simulate(initial, current, horizon, p);
  return [100, 200, 300].map(bp => {
    const projection = simulate(initial, current, horizon, p, { ...NO_SHOCK, marketRateDelta: bp / 10000 });
    return { bp, years: [1, 3, 5].filter(year => year <= horizon).map(year => ({ year,
      interestIncrease: projection.steps[year - 1].state.fiscal.interestPayments - baseline.steps[year - 1].state.fiscal.interestPayments })) };
  });
}
