import { POLICIES, TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { simulate } from '@/app/lib/fiscal-space/simulate';
import { peakConstraints, unemploymentRate } from '@/app/lib/fiscal-space/constraints';
import { povertyScenario } from '@/app/lib/fiscal-space/poverty';
import { externalStress } from '@/app/lib/fiscal-space/external-stress';
import { IMPORT_PRICE_STRESS } from '@/app/lib/fiscal-space/stress-envelope';
import type { Policy, Simulation } from '@/types/fiscal-space';
import type { FiscalForm } from './fiscal-space-form';
import { prepareFiscalScenario } from './fiscal-scenario';
import { policyInputLimitYen } from './fiscal-space-amounts';
import { OBJECTIVE_IDS, OBJECTIVES, objectiveScore, validateOptimization, type ObjectiveValues, type OptimizationSettings } from './fiscal-objective';

export interface OptimizationCandidate {
  amounts: Record<string, number>; total: number; values: ObjectiveValues;
  score: number | null; contributions: ReturnType<typeof objectiveScore>['contributions'];
  feasible: boolean; violations: string[]; penalty: number;
}
export interface OptimizationResult {
  baseline: ObjectiveValues; current: OptimizationCandidate; best: OptimizationCandidate | null;
  evaluations: number; limitReached: boolean; horizon: number; aggregation: OptimizationSettings['aggregation'];
}
export interface OptimizationProgress { evaluations: number; limit: number; bestScore: number | null }

export function projectionObjectiveValues(path: Simulation, poverty: ReturnType<typeof povertyScenario>, settings: OptimizationSettings): ObjectiveValues {
  const years = settings.aggregation === 'terminal' ? [path.steps.length - 1] : path.steps.map((_, i) => i);
  const read = (i: number): ObjectiveValues => {
    const s = path.steps[i];
    return { gdp: s.state.macro.realGdp / TRILLION, poverty: poverty.rows[i].all * 100,
      burden: s.state.fiscal.taxRevenue / s.state.macro.nominalGdp * 100,
      interest: s.state.fiscal.interestPayments / TRILLION, cpi: s.state.macro.inflation * 100,
      unemployment: unemploymentRate(s) * 100, fertility: s.demographics?.tfr ?? null,
      exports: s.state.external.exports / TRILLION, imports: s.state.external.imports / TRILLION };
  };
  const rows = years.map(read);
  return Object.fromEntries(OBJECTIVE_IDS.map(id => [id, rows.some(row => row[id] === null)
    ? null : rows.reduce((sum, row) => sum + row[id]!, 0) / rows.length])) as ObjectiveValues;
}

export function projectionObjectiveScore(path: Simulation, poverty: ReturnType<typeof povertyScenario>, baselinePath: Simulation,
  baselinePoverty: ReturnType<typeof povertyScenario>, settings: OptimizationSettings) {
  if (settings.aggregation === 'terminal') return objectiveScore(projectionObjectiveValues(path, poverty, settings), projectionObjectiveValues(baselinePath, baselinePoverty, settings), settings);
  const scores = path.steps.map((step, i) => objectiveScore(
    projectionObjectiveValues({ ...path, steps: [step] }, { ...poverty, rows: [poverty.rows[i]] }, settings),
    projectionObjectiveValues({ ...baselinePath, steps: [baselinePath.steps[i]] }, { ...baselinePoverty, rows: [baselinePoverty.rows[i]] }, settings), settings));
  const contributions = Object.fromEntries(OBJECTIVE_IDS.map(id => [id, scores.some(s => s.contributions[id] === null)
    ? null : scores.reduce((sum, s) => sum + s.contributions[id]!, 0) / scores.length])) as ReturnType<typeof objectiveScore>['contributions'];
  return { score: scores.some(s => s.score === null) ? null : scores.reduce((sum, s) => sum + s.score!, 0) / scores.length, contributions };
}

/** The same projection, poverty model, revenue caps and constraints as the main screen.
 * Selected stresses are tested individually, matching the reference envelope. */
export function createOptimizationEvaluator(form: FiscalForm) {
  const settings = form.optimization;
  validateOptimization(settings);
  if (settings.objectives.fertility.weight > 0 && form.calibration.demographics.mode === 'off')
    throw new Error('出生率の政策反応が未推計です。人口動態の経路を有効にするか、出生率の重みを0にしてください。');
  const { initial, p, horizon, shock, policyConfigs } = prepareFiscalScenario(form);
  const baselinePath = simulate(initial, [], horizon, p, shock);
  const baselinePoverty = povertyScenario([], horizon, form.poverty, p.employeeReliefShare);
  const baseline = projectionObjectiveValues(baselinePath, baselinePoverty, settings);
  const missing = OBJECTIVE_IDS.filter(id => settings.objectives[id].weight > 0 && baseline[id] === null);
  if (missing.length) throw new Error(`${missing.map(id => OBJECTIVES[id].label).join('・')}が未推計です。対応する計算条件を有効にするか、重みを0にしてください。`);
  const povertyCache = new Map<string, ReturnType<typeof povertyScenario>>();
  const evaluate = (amounts: Record<string, number>): OptimizationCandidate => {
    const policies: Policy[] = policyConfigs.map(policy => ({ ...policy, annualCost: (amounts[policy.id] ?? 0) * TRILLION })).filter(p => p.annualCost > 0);
    const total = POLICIES.reduce((sum, p) => sum + (amounts[p.id] ?? 0), 0);
    const violations: string[] = [];
    let penalty = 0;
    const add = (label: string, amount = 1) => { violations.push(label); penalty += Math.max(1e-9, amount); };
    if (total < settings.minBudget - 1e-8 || total > settings.maxBudget + 1e-8) add('追加予算の範囲', Math.abs(total - Math.max(settings.minBudget, Math.min(settings.maxBudget, total))));
    for (const policy of POLICIES) {
      const amount = amounts[policy.id] ?? 0;
      if (!Number.isFinite(amount) || amount < 0 || amount > 100 || amount * TRILLION > policyInputLimitYen(policy.id, p) + 1)
        throw new Error(`${policy.name}の入力上限を超えています。`);
      if (!settings.eligible[policy.id] && Math.abs(amount - (form.amounts[policy.id] ?? 0)) > 1e-8) add(`${policy.name}の固定額`);
    }
    const path = simulate(initial, policies, horizon, p, shock);
    const inspect = (simulation: Simulation, label = '') => {
      for (const c of peakConstraints(simulation, form.thresholds, p.inflationRule)) {
        if (c.coverageComplete === false || c.status === 'unevaluated') add(`${label}${c.label}が未評価`, 10);
        else if (c.status === 'violated') add(`${label}${c.label}`, Number.isFinite(c.utilization) ? c.utilization - 1 : 100);
      }
      if (simulation.steps.some(s => s.coverage?.fuel === false)) add(`${label}燃料輸入が未評価`, 10);
    };
    inspect(path);
    if (form.stresses.importPrice && externalStress(path, 0, IMPORT_PRICE_STRESS, form.thresholds.inflation).exceeds) add('輸入物価+3%時のCPI');
    if (form.stresses.energyPrice) inspect(simulate(initial, policies, horizon, p, { ...shock, energyPriceChange: shock.energyPriceChange + .2 }), 'エネルギー価格+20%：');
    if (form.stresses.rate) inspect(simulate(initial, policies, horizon, p, { ...shock, marketRateDelta: shock.marketRateDelta + .01 }), '借換金利+100bp：');
    const povertyPolicies = policies.filter(p => ['cash', 'childcare', 'income-tax', 'resident-tax', 'social-insurance'].includes(p.id));
    const povertyKey = JSON.stringify(povertyPolicies.map(p => [p.id, p.annualCost]));
    let poverty = povertyCache.get(povertyKey);
    if (!poverty) { poverty = povertyScenario(povertyPolicies, horizon, form.poverty, p.employeeReliefShare); povertyCache.set(povertyKey, poverty); }
    const values = projectionObjectiveValues(path, poverty, settings);
    const scored = projectionObjectiveScore(path, poverty, baselinePath, baselinePoverty, settings);
    if (scored.score === null) add('評価指標が未推計', 100);
    return { amounts: { ...amounts }, total, values, ...scored, feasible: violations.length === 0, violations, penalty };
  };
  return { evaluate, baseline, horizon };
}

/** Bounded deterministic multi-start pattern search. No global-optimum claim.
 * Starting points cover totals and single-policy mixes; moves add, remove or
 * transfer spending, so a fixed total does not prevent allocation changes. */
export function optimizeFiscalPolicy(form: FiscalForm, progress?: (p: OptimizationProgress) => void, limit = 1800): OptimizationResult {
  const settings = form.optimization;
  validateOptimization(settings);
  if (!OBJECTIVE_IDS.some(id => settings.objectives[id].weight > 0)) throw new Error('少なくとも1つの指標の重みを正にしてください。');
  const eligible = POLICIES.filter(p => settings.eligible[p.id]).map(p => p.id);
  if (!eligible.length) throw new Error('少なくとも1つの政策を探索対象にしてください。');
  const { evaluate, baseline, horizon } = createOptimizationEvaluator(form);
  const fixed = Object.fromEntries(POLICIES.map(p => [p.id, settings.eligible[p.id] ? 0 : form.amounts[p.id] ?? 0]));
  const fixedTotal = Object.values(fixed).reduce((a, b) => a + b, 0);
  if (fixedTotal > settings.maxBudget + 1e-8) throw new Error('固定した政策の合計が追加予算の上限を超えています。');
  const caps = Object.fromEntries(eligible.map(id => [id, Math.floor(Math.min(100, policyInputLimitYen(id, form.calibration) / TRILLION) * 10 + 1e-8) / 10]));
  const maximum = Math.min(settings.maxBudget, fixedTotal + Object.values(caps).reduce((a, b) => a + b, 0));
  if (maximum < settings.minBudget - 1e-8) throw new Error('探索対象の政策上限では、指定した予算の下限に届きません。');
  const cache = new Map<string, OptimizationCandidate>();
  let best: OptimizationCandidate | null = null;
  const better = (a: OptimizationCandidate, b: OptimizationCandidate) => {
    if (a.feasible !== b.feasible) return a.feasible;
    if (!a.feasible && Math.abs(a.penalty - b.penalty) > 1e-10) return a.penalty < b.penalty;
    const delta = (a.score ?? -Infinity) - (b.score ?? -Infinity);
    return delta > 1e-10 || (Math.abs(delta) <= 1e-10 && a.total < b.total - 1e-8);
  };
  const visit = (amounts: Record<string, number>) => {
    const key = JSON.stringify(POLICIES.map(p => amounts[p.id] ?? 0));
    const old = cache.get(key);
    if (old) return old;
    if (cache.size >= limit) return undefined;
    const candidate = evaluate(amounts);
    cache.set(key, candidate);
    if (candidate.feasible && (!best || better(candidate, best))) best = candidate;
    if (cache.size % 20 === 0) progress?.({ evaluations: cache.size, limit, bestScore: best?.score ?? null });
    return candidate;
  };
  const current = visit(form.amounts)!;
  // Quantize only searched amounts, never silently change excluded policies.
  const seed = (total: number, weights: Record<string, number>) => {
    const amounts = { ...fixed };
    let remaining = Math.floor(Math.max(0, total - fixedTotal) * 10 + 1e-8);
    let active = eligible.filter(id => weights[id] > 0);
    while (remaining > 0 && active.length) {
      const sum = active.reduce((s, id) => s + weights[id], 0);
      const before = remaining;
      for (const id of active) {
        const units = Math.min(remaining, Math.floor((caps[id] - amounts[id]) * 10 + 1e-8), Math.max(1, Math.floor(before * weights[id] / sum)));
        amounts[id] = Math.round((amounts[id] + units / 10) * 10) / 10;
        remaining -= units;
      }
      active = active.filter(id => amounts[id] < caps[id] - 1e-8);
    }
    return amounts;
  };
  const equal = Object.fromEntries(eligible.map(id => [id, 1]));
  visit(fixed);
  for (const total of [Math.max(fixedTotal, settings.minBudget), (Math.max(fixedTotal, settings.minBudget) + maximum) / 2, maximum]) {
    visit(seed(total, equal));
    visit(seed(total, form.amounts));
    for (const id of eligible) visit(seed(total, { [id]: 1 }));
  }
  const starts = [...cache.values()].sort((a, b) => better(a, b) ? -1 : better(b, a) ? 1 : 0).slice(0, 3);
  for (let point of starts) {
    for (let step = Math.max(.1, Math.round((maximum - fixedTotal) / 4 * 10) / 10);; step = Math.max(.1, Math.floor(step * 5) / 10)) {
      let improved = true;
      while (improved && cache.size < limit) {
        improved = false;
        let next = point;
        const consider = (amounts: Record<string, number>) => {
          const candidate = visit(amounts);
          if (candidate && better(candidate, next)) next = candidate;
        };
        for (const id of eligible) {
          for (const sign of [-1, 1]) {
            const value = Math.round((point.amounts[id] + sign * step) * 10) / 10;
            if (value >= 0 && value <= caps[id] && point.total + sign * step >= settings.minBudget - 1e-8 && point.total + sign * step <= maximum + 1e-8)
              consider({ ...point.amounts, [id]: value });
          }
          if (point.amounts[id] < step - 1e-8) continue;
          for (const to of eligible) if (to !== id && point.amounts[to] + step <= caps[to] + 1e-8) {
            consider({ ...point.amounts, [id]: Math.round((point.amounts[id] - step) * 10) / 10, [to]: Math.round((point.amounts[to] + step) * 10) / 10 });
          }
        }
        if (better(next, point)) { point = next; improved = true; }
      }
      if (step <= .1 || cache.size >= limit) break;
    }
    if (cache.size >= limit) break;
  }
  progress?.({ evaluations: cache.size, limit, bestScore: (best as OptimizationCandidate | null)?.score ?? null });
  return { baseline, current, best, evaluations: cache.size, limitReached: cache.size >= limit, horizon, aggregation: settings.aggregation };
}

export type OptimizationWorkerResponse = { kind: 'progress'; progress: OptimizationProgress }
  | { kind: 'result'; result: OptimizationResult } | { kind: 'error'; error: string };
