import type { EconomyState, FiscalSpaceEstimate, ModelParameters, PolicyShare, Shock, Thresholds } from '@/types/fiscal-space';
import { allocateMix, estimateFiscalSpace } from './search';
import { peakConstraints } from './constraints';
import { simulate } from './simulate';
import { externalStress } from './external-stress';

export type StressId = 'baselineInflation' | 'fx' | 'energyPrice' | 'rate';
export type StressSelection = Record<StressId, boolean>;

/** Interpretable stresses replace an arbitrary percentage haircut. Each magnitude is
 * itself an assumption, but "survives a 10% yen depreciation" is a checkable claim
 * where "minus 20%" is not. Magnitudes reuse the existing sensitivity tables. */
export const STRESSES: Record<StressId, { label: string; short: string; note: string }> = {
  baselineInflation: { label: '基準インフレ +0.5ポイント', short: '基準インフレ+0.5pt', note: '政策なしの物価上昇率の想定を0.5ポイント引き上げて再探索。' },
  fx: { label: '円安10%', short: '円安10%', note: '判定用CPIのピーク年に、輸入価格への転嫁100%・CPI水準への転嫁0.13で円安10%が重なっても上限内に収まる額。為替の需要・GDP反応は未推計。' },
  energyPrice: { label: '輸入エネルギー価格 +20%', short: 'エネルギー+20%', note: '本体の輸入エネルギー価格ショックを20ポイント上乗せして再探索。' },
  rate: { label: '借換金利 +100bp', short: '金利+100bp', note: '借換・新発金利の外生ショックを1ポイント上乗せして再探索。公表GDP・CPI反応は変えない。' },
};
// Nothing selected by default: every stress amount is still computed and shown, so the
// user chooses what the envelope must survive with the consequences visible. With a 2.5%
// CPI ceiling and ~2.05% no-policy CPI, +0.5pt inflation or a 10% yen fall leave no room.
export const DEFAULT_STRESSES: StressSelection = { baselineInflation: false, fx: false, energyPrice: false, rate: false };

export interface StressRow { id: StressId; label: string; amount: number; status: FiscalSpaceEstimate['status']; binding?: string; selected: boolean }

/** FX has no in-model demand response, so it is judged on the CPI path of each candidate
 * amount. Same scan-then-bisect discipline as estimateFiscalSpace, same step and tolerance. */
function fxEnvelope(initial: EconomyState, mix: PolicyShare[], thresholds: Thresholds, horizon: number, p: ModelParameters, shock: Shock, cap: number): StressRow {
  const violated = (amount: number) => {
    const path = simulate(initial, allocateMix(mix, amount), horizon, p, shock);
    const peaks = peakConstraints(path, thresholds, p.inflationRule);
    return peaks.some(c => c.status === 'violated') || externalStress(path, .10, 0, thresholds.inflation).exceeds;
  };
  if (cap <= 0) return { id: 'fx', label: STRESSES.fx.label, amount: 0, status: 'empty-mix', selected: false };
  if (violated(0)) return { id: 'fx', label: STRESSES.fx.label, amount: 0, status: 'baseline-violated', binding: '物価（円安10%込み）', selected: false };
  let low = 0, high = Math.min(p.searchStep, cap);
  while (!violated(high)) {
    low = high;
    if (high >= cap) return { id: 'fx', label: STRESSES.fx.label, amount: cap, status: 'boundary', selected: false };
    high = Math.min(cap, high + p.searchStep);
  }
  while (high - low > p.searchTolerance) {
    const mid = (low + high) / 2;
    if (violated(mid)) high = mid; else low = mid;
  }
  return { id: 'fx', label: STRESSES.fx.label, amount: low, status: 'boundary', binding: '物価（円安10%込み）', selected: false };
}

export function stressRows(initial: EconomyState, mix: PolicyShare[], base: FiscalSpaceEstimate, thresholds: Thresholds, horizon: number,
  p: ModelParameters, shock: Shock, selection: StressSelection): StressRow[] {
  const row = (id: StressId, e: FiscalSpaceEstimate): StressRow => ({ id, label: STRESSES[id].label, amount: Math.min(e.theoreticalMaximum, base.theoreticalMaximum),
    status: e.status, binding: e.constraints.find(c => c.status === 'violated')?.label, selected: selection[id] });
  return (Object.keys(STRESSES) as StressId[]).map(id => {
    if (id === 'baselineInflation') return row(id, estimateFiscalSpace(initial, mix, thresholds, horizon, { ...p, baselineInflation: p.baselineInflation + .005 }, shock));
    if (id === 'energyPrice') return row(id, estimateFiscalSpace(initial, mix, thresholds, horizon, p, { ...shock, energyPriceChange: shock.energyPriceChange + .2 }));
    if (id === 'rate') return row(id, estimateFiscalSpace(initial, mix, thresholds, horizon, p, { ...shock, marketRateDelta: shock.marketRateDelta + .01 }));
    return { ...fxEnvelope(initial, mix, thresholds, horizon, p, shock, base.theoreticalMaximum), selected: selection[id] };
  });
}

/** The envelope becomes the smallest amount that survives every selected stress. The
 * implied haircut is an output for display, never an input. */
export function applyStressReserve(initial: EconomyState, mix: PolicyShare[], base: FiscalSpaceEstimate, thresholds: Thresholds, horizon: number,
  p: ModelParameters, shock: Shock, selection: StressSelection): FiscalSpaceEstimate & { stress: StressRow[] } {
  const selected = (Object.keys(STRESSES) as StressId[]).filter(id => selection[id]);
  if (base.status === 'unevaluated' || base.status === 'empty-mix' || base.status === 'baseline-violated') {
    return { ...base, emergencyReserve: 0, recommendedEnvelope: base.theoreticalMaximum,
      reserveRule: { method: 'stress-scenarios', share: 0, scenarios: selected }, stress: [] };
  }
  const stress = stressRows(initial, mix, base, thresholds, horizon, p, shock, selection);
  const recommendedEnvelope = Math.min(base.theoreticalMaximum, ...stress.filter(s => s.selected).map(s => s.amount));
  return { ...base, recommendedEnvelope, emergencyReserve: base.theoreticalMaximum - recommendedEnvelope,
    reserveRule: { method: 'stress-scenarios', share: base.theoreticalMaximum > 0 ? 1 - recommendedEnvelope / base.theoreticalMaximum : 0, scenarios: selected }, stress };
}
