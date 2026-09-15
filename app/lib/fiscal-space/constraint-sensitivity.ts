import type { Simulation, Thresholds } from '@/types/fiscal-space';
import { CONSTRAINTS } from './constraints';

/** Difference of future horizon peaks. Not a derivative or a distance to the boundary. */
export function constraintSensitivity(current: Simulation, probe: Simulation | undefined, thresholds: Thresholds) {
  return CONSTRAINTS.map(d => {
    const peak = (path: Simulation) => Math.max(...path.steps.map(s => d.measure(s) / thresholds[d.id]));
    const before = peak(current), after = probe ? peak(probe) : NaN;
    return { id: d.id, delta: Number.isFinite(before) && Number.isFinite(after) ? after - before : null };
  });
}
