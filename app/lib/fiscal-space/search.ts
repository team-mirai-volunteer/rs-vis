import type { EconomyState, FiscalSpaceEstimate, ModelParameters, PolicyShare, Shock, Thresholds } from '@/types/fiscal-space';
import { NO_SHOCK, PARAMETERS } from './assumptions';
import { peakConstraints } from './constraints';
import { simulate } from './simulate';
import { positive } from './production';
import { policyReliefLimit } from './policy-limits';

export function allocateMix(mix: PolicyShare[], amount: number) {
  if (!Number.isFinite(amount) || amount < 0 || mix.some(x => !Number.isFinite(x.weight) || x.weight < 0)) throw new RangeError('Invalid policy allocation');
  const total = mix.reduce((s, x) => s + x.weight, 0);
  if (total === 0) return [];
  return mix.filter(x => x.weight > 0).map(x => ({ ...x.policy, annualCost: amount * x.weight / total }));
}

/** First observed exit from the safe component connected to zero, not a global nonmonotonic optimum. */
export function estimateFiscalSpace(state: EconomyState, policyMix: PolicyShare[], constraints: Thresholds,
  horizon: number, p: ModelParameters = PARAMETERS, shock: Shock = NO_SHOCK): FiscalSpaceEstimate {
  positive(p.searchCap, 'searchCap'); positive(p.searchStep, 'searchStep'); positive(p.searchTolerance, 'searchTolerance');
  if (p.reserveShare < 0 || p.reserveShare > 1) throw new RangeError('Reserve share must be 0–1');
  allocateMix(policyMix, 0);
  const weight = policyMix.reduce((sum, x) => sum + x.weight, 0);
  let searchCap = p.searchCap;
  let limitingPolicy: string | undefined;
  for (const id of ['consumption-tax', 'social-insurance']) {
    const policyWeight = policyMix.filter(x => x.policy.id === id).reduce((sum, x) => sum + x.weight, 0);
    const cap = policyWeight > 0 ? policyReliefLimit(id, p) * weight / policyWeight : Infinity;
    if (cap <= searchCap) { searchCap = cap; limitingPolicy = id; }
  }
  let evaluations = 0;
  const evaluate = (amount: number) => {
    evaluations++;
    return peakConstraints(simulate(state, allocateMix(policyMix, amount), horizon, p, shock), constraints);
  };
  const base = evaluate(0);
  const result = (amount: number, status: FiscalSpaceEstimate['status'], peaks: FiscalSpaceEstimate['constraints']): FiscalSpaceEstimate => ({
    theoreticalMaximum: amount, emergencyReserve: amount * p.reserveShare, recommendedEnvelope: amount * (1 - p.reserveShare),
    status, limitingPolicy: status === 'revenue-cap' ? limitingPolicy : undefined,
    constraints: peaks, evaluations, tolerance: p.searchTolerance, reserveRule: { method: 'fixed-share', share: p.reserveShare },
  });
  if (base.some(c => c.status === 'violated')) return result(0, 'baseline-violated', base);
  if (!policyMix.some(x => x.weight > 0)) return result(0, 'empty-mix', base);
  let low = 0, high = Math.min(p.searchStep, searchCap), safe = base;
  while (true) {
    const peaks = evaluate(high);
    if (peaks.some(c => c.status === 'violated')) break;
    low = high; safe = peaks;
    if (high === searchCap) return result(low, limitingPolicy ? 'revenue-cap' : 'search-cap', safe);
    high = Math.min(searchCap, high + p.searchStep);
  }
  while (high - low > p.searchTolerance) {
    const mid = (low + high) / 2, peaks = evaluate(mid);
    if (peaks.some(c => c.status === 'violated')) high = mid;
    else { low = mid; safe = peaks; }
  }
  // Rank the first violating endpoint to identify the actual crossing, including ties.
  return result(low, 'boundary', evaluate(high));
}
