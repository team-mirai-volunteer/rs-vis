import type { EconomyState, FiscalSpaceEstimate, ModelParameters, PolicyShare, Shock, Thresholds } from '@/types/fiscal-space';
import { REFERENCES } from './calibration';
import { allocateMix, estimateFiscalSpace } from './search';
import { simulate } from './simulate';
import { externalStress, STRESS_ASSUMPTIONS } from './external-stress';
import { fiscalExternal } from './fiscal-external';
import { constraintInflation } from './constraints';
import { TRILLION } from './assumptions';

/** Diagnose the displayed envelope, not the separate policy amount in the controls.
 * An unmodelled risk must never become a zero, a pass, or a claimed safe exchange rate.
 * Threshold alternatives are sensitivity examples, not calibrated safety standards. */
export function auditFiscalSpace(initial: EconomyState, mix: PolicyShare[], estimate: FiscalSpaceEstimate,
  thresholds: Thresholds, horizon: number, p: ModelParameters, shock: Shock) {
  const path = simulate(initial, allocateMix(mix, estimate.recommendedEnvelope), horizon, p, shock);
  const baseline = simulate(initial, [], horizon, p, shock);
  const peak = path.steps.reduce((a, b) => constraintInflation(a) >= constraintInflation(b) ? a : b);
  const baseAtPeak = peak.state.year === initial.year ? baseline.initial : baseline.steps[peak.state.year - initial.year - 1];
  const cpiLimits = [...new Set([thresholds.inflation, .035, .03, .025])].sort((a, b) => b - a);
  const binding = estimate.constraints.find(c => c.status === 'violated');
  // A one-trillion secant at the actual crossing year is an explanation aid,
  // not an alternative solver: peak switching and supply caps can be nonlinear.
  const probe = simulate(initial, allocateMix(mix, Math.min(TRILLION, estimate.theoreticalMaximum)), horizon, p, shock);
  const crossingYear = binding?.id === 'inflation' ? binding.year : undefined;
  const baseCpi = crossingYear ? constraintInflation(baseline.steps[crossingYear - initial.year - 1]) : undefined;
  const probeCpi = crossingYear ? constraintInflation(probe.steps[crossingYear - initial.year - 1]) : undefined;
  const probeAmount = Math.min(TRILLION, estimate.theoreticalMaximum);
  const slope = baseCpi !== undefined && probeCpi !== undefined && probeAmount > 0
    ? (probeCpi - baseCpi) / (probeAmount / TRILLION) : 0;
  return {
    safety: 'unassessed' as const,
    baselineSensitivity: [...new Set([.01, .015, .018, .02, .022, .025, p.baselineInflation])].sort((a, b) => a - b).map(inflation => {
      const alternate = inflation === p.baselineInflation ? estimate : estimateFiscalSpace(initial, mix, thresholds, horizon, { ...p, baselineInflation: inflation }, shock);
      return { inflation, amount: alternate.theoreticalMaximum, status: alternate.status, current: inflation === p.baselineInflation,
        limitingPolicy: alternate.limitingPolicy,
        binding: alternate.constraints.filter(c => c.status === 'violated').map(c => c.label) };
    }),
    amount: estimate.recommendedEnvelope,
    terminalGdpEffect: path.steps[horizon - 1].state.macro.realGdp - baseline.steps[horizon - 1].state.macro.realGdp,
    cpiApproximation: slope > 0 && baseCpi !== undefined ? {
      year: crossingYear, baseline: baseCpi, slope,
      amount: (thresholds.inflation - baseCpi) / slope * TRILLION,
    } : undefined,
    gdpShare: estimate.recommendedEnvelope / initial.macro.nominalGdp,
    referenceScale: estimate.recommendedEnvelope / initial.macro.nominalGdp / .01,
    extrapolatedYears: Math.max(0, horizon - REFERENCES[p.referenceModel].years),
    initialCapacityHeadroom: path.initial.production.maximum / initial.macro.realGdp - 1,
    cpi: { peak: constraintInflation(peak), year: peak.state.year,
      policyDifference: constraintInflation(peak) - constraintInflation(baseAtPeak), limit: thresholds.inflation },
    fiscalExternal: fiscalExternal(initial, allocateMix(mix, estimate.recommendedEnvelope), path, baseline, p),
    referenceModel: p.referenceModel,
    energyPriceShock: shock.energyPriceChange,
    externalStress: [0, .05, .10, .20].map(fx => externalStress(path, fx, 0, thresholds.inflation)),
    combinedStress: externalStress(path, .10, .10, thresholds.inflation),
    passThroughSensitivity: [.08, .13, .20].map(cpiPass => ({ cpiPass,
      ...externalStress(path, .10, 0, thresholds.inflation, { ...STRESS_ASSUMPTIONS, cpiPass }) })),
    sensitivity: cpiLimits.map(limit => {
      const alternate = limit === thresholds.inflation ? estimate :
        estimateFiscalSpace(initial, mix, { ...thresholds, inflation: limit }, horizon, p, shock);
      return { limit, amount: alternate.recommendedEnvelope, beforeReserve: alternate.theoreticalMaximum, status: alternate.status, current: limit === thresholds.inflation };
    }),
  };
}

export type FiscalRiskAudit = ReturnType<typeof auditFiscalSpace>;
