import type { EconomyState, FiscalSpaceEstimate, ModelParameters, PolicyShare, Shock, Thresholds } from '@/types/fiscal-space';
import { REFERENCES } from './calibration';
import { allocateMix, estimateFiscalSpace } from './search';
import { simulate } from './simulate';
import { externalStress, STRESS_ASSUMPTIONS } from './external-stress';
import { fiscalExternal } from './fiscal-external';

/** Diagnose the displayed envelope, not the separate policy amount in the controls.
 * An unmodelled risk must never become a zero, a pass, or a claimed safe exchange rate.
 * Threshold alternatives are sensitivity examples, not calibrated safety standards. */
export function auditFiscalSpace(initial: EconomyState, mix: PolicyShare[], estimate: FiscalSpaceEstimate,
  thresholds: Thresholds, horizon: number, p: ModelParameters, shock: Shock) {
  const path = simulate(initial, allocateMix(mix, estimate.recommendedEnvelope), horizon, p, shock);
  const baseline = simulate(initial, [], horizon, p, shock);
  const peak = [path.initial, ...path.steps].reduce((a, b) => a.state.macro.inflation >= b.state.macro.inflation ? a : b);
  const baseAtPeak = peak.state.year === initial.year ? baseline.initial : baseline.steps[peak.state.year - initial.year - 1];
  const cpiLimits = [...new Set([thresholds.inflation, .035, .03, .025])].sort((a, b) => b - a);
  return {
    safety: 'unassessed' as const,
    amount: estimate.recommendedEnvelope,
    gdpShare: estimate.recommendedEnvelope / initial.macro.nominalGdp,
    referenceScale: estimate.recommendedEnvelope / initial.macro.nominalGdp / .01,
    extrapolatedYears: Math.max(0, horizon - REFERENCES[p.referenceModel].years),
    initialCapacityHeadroom: path.initial.production.maximum / initial.macro.realGdp - 1,
    cpi: { peak: peak.state.macro.inflation, year: peak.state.year,
      policyDifference: peak.state.macro.inflation - baseAtPeak.state.macro.inflation, limit: thresholds.inflation },
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
      return { limit, amount: alternate.recommendedEnvelope, status: alternate.status, current: limit === thresholds.inflation };
    }),
  };
}

export type FiscalRiskAudit = ReturnType<typeof auditFiscalSpace>;
