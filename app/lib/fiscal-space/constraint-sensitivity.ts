import type { ModelParameters, Simulation, Thresholds } from '@/types/fiscal-space';
import { CONSTRAINTS } from './constraints';

/** Difference of future horizon peaks. Not a derivative or a distance to the boundary. */
export function constraintSensitivity(current: Simulation, probe: Simulation | undefined, thresholds: Thresholds, rule: ModelParameters['inflationRule'] = 'peak') {
  return CONSTRAINTS.map(d => {
    const peak = (path: Simulation) => d.id === 'inflation' && rule === 'average'
      ? path.steps.reduce((sum, s) => sum + d.measure(s), 0) / path.steps.length / thresholds[d.id]
      : Math.max(...path.steps.map(s => d.measure(s) / thresholds[d.id]));
    const before = peak(current), after = probe ? peak(probe) : NaN;
    return { id: d.id, delta: Number.isFinite(before) && Number.isFinite(after) ? after - before : null };
  });
}
