import type { EconomyState, Input, Inputs, ModelParameters, ProductionResult } from '@/types/fiscal-space';

const INPUTS: Input[] = ['capital', 'labour', 'energy', 'materials'];
export const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
export function positive(n: number, name: string): void {
  if (!Number.isFinite(n) || n <= 0) throw new RangeError(`${name} must be finite and positive`);
}
export function cobbDouglas(inputs: Inputs, weights: ModelParameters['cobbWeights'], a = 1): number {
  positive(a, 'TFP');
  return (Object.keys(weights) as (keyof typeof weights)[]).reduce((y, k) => {
    positive(inputs[k], k); return y * inputs[k] ** weights[k];
  }, a);
}
export function ces(inputs: Inputs, weights: Inputs, sigma: number, a = 1): number {
  positive(sigma, 'sigma'); positive(a, 'TFP');
  INPUTS.forEach(k => { positive(inputs[k], k); positive(weights[k], `weight.${k}`); });
  const total = INPUTS.reduce((s, k) => s + weights[k], 0);
  const rho = 1 - 1 / sigma;
  if (Math.abs(rho) < 1e-8) return a * Math.exp(INPUTS.reduce((s, k) => s + weights[k] / total * Math.log(inputs[k]), 0));
  // Log-sum-exp avoids overflow for very low substitution elasticity.
  const logs = INPUTS.map(k => rho * Math.log(inputs[k]));
  const max = Math.max(...logs);
  return a * Math.exp((max + Math.log(INPUTS.reduce((s, k, i) => s + weights[k] / total * Math.exp(logs[i] - max), 0))) / rho);
}
export function leontief(inputs: Inputs, coefficients: Inputs = { capital: 1, labour: 1, energy: 1, materials: 1 }, actual = 1) {
  INPUTS.forEach(k => { positive(inputs[k], k); positive(coefficients[k], k); });
  const capacities = INPUTS.map(k => ({ k, value: inputs[k] / coefficients[k] })).sort((a, b) => a.value - b.value);
  const utilization = {} as Inputs, remainingSlack = {} as Inputs;
  for (const { k, value } of capacities) { utilization[k] = actual / value; remainingSlack[k] = value - actual; }
  return { maximum: capacities[0].value, binding: capacities[0].k, second: capacities[1].k, utilization, remainingSlack };
}
export function productionIndex(inputs: Inputs, p: ModelParameters): number {
  return p.productionModel === 'leontief' ? leontief(inputs).maximum
    : p.productionModel === 'ces' ? ces(inputs, p.weights, p.cesSigma) : cobbDouglas(inputs, p.cobbWeights);
}

export function productionCapacity(state: EconomyState, p: ModelParameters, _horizon: number): ProductionResult {
  void _horizon; // Kept for callers; time never changes the production function.
  const anchor = state.production.basePotentialGdp ?? state.macro.potentialGdp;
  const productivity = state.production.labourProductivity;
  const inputs = { ...state.production.inputs, labour: state.production.inputs.labour * productivity };
  const normal = state.production.normalInputs;
  const potential = normal ? anchor * state.production.tfp * productionIndex({ ...normal, labour: normal.labour * productivity }, p) : state.macro.potentialGdp;
  const scale = anchor * state.production.tfp;
  const l = leontief(inputs, undefined, state.macro.realGdp / scale);
  const c = ces(inputs, p.weights, p.cesSigma), d = cobbDouglas(inputs, p.cobbWeights);
  const maximum = { leontief: l.maximum, ces: c, cobbDouglas: d }[p.productionModel];
  return { potential, leontief: l.maximum * scale, ces: c * scale, cobbDouglas: d * scale,
    maximum: maximum * scale, binding: l.binding, second: l.second,
    utilization: l.utilization, remainingSlack: l.remainingSlack };
}
