import { POLICIES } from '@/app/lib/fiscal-space/assumptions';

export const OBJECTIVES = {
  gdp: { label: '実質GDP', unit: '兆円', scale: 1, direction: 'increase' },
  poverty: { label: '相対的貧困率（直接効果）', unit: '%', scale: 1, direction: 'decrease' },
  interest: { label: '利払い', unit: '兆円', scale: 1, direction: 'decrease' },
  cpi: { label: 'CPI上昇率', unit: '%', scale: 1, direction: 'target' },
  unemployment: { label: '失業率', unit: '%', scale: 1, direction: 'decrease' },
  fertility: { label: '合計特殊出生率', unit: '', scale: .1, direction: 'increase' },
  exports: { label: '輸出（名目）', unit: '兆円', scale: 1, direction: 'increase' },
  imports: { label: '輸入（名目）', unit: '兆円', scale: 1, direction: 'decrease' },
} as const;
export type ObjectiveId = keyof typeof OBJECTIVES;
export const OBJECTIVE_IDS = Object.keys(OBJECTIVES) as ObjectiveId[];
export type ObjectiveDirection = 'increase' | 'decrease' | 'target';
export interface ObjectivePreference { weight: number; scale: number; direction: ObjectiveDirection; target: number }
export interface OptimizationSettings {
  minBudget: number; maxBudget: number;
  aggregation: 'average' | 'terminal';
  eligible: Record<string, boolean>;
  objectives: Record<ObjectiveId, ObjectivePreference>;
}
export type ObjectiveValues = Record<ObjectiveId, number | null>;

export function optimizationDefaults(): OptimizationSettings {
  return { minBudget: 0, maxBudget: 15, aggregation: 'average',
    eligible: Object.fromEntries(POLICIES.map(p => [p.id, true])),
    objectives: Object.fromEntries(OBJECTIVE_IDS.map(id => [id, {
      weight: 1, scale: OBJECTIVES[id].scale, direction: OBJECTIVES[id].direction,
      target: id === 'cpi' ? 2 : id === 'fertility' ? 2 : 0,
    }])) as OptimizationSettings['objectives'] };
}

export function validateOptimization(settings: OptimizationSettings) {
  if (!settings || !Number.isFinite(settings.minBudget) || !Number.isFinite(settings.maxBudget)
    || settings.minBudget < 0 || settings.maxBudget > 100 || settings.minBudget > settings.maxBudget
    || !['average', 'terminal'].includes(settings.aggregation)) throw new Error('予算の範囲を0〜100兆円で指定してください。');
  for (const p of POLICIES) if (typeof settings.eligible?.[p.id] !== 'boolean') throw new Error('探索する政策を指定してください。');
  for (const id of OBJECTIVE_IDS) {
    const v = settings.objectives?.[id];
    if (!v || !Number.isFinite(v.weight) || v.weight < 0 || v.weight > 100
      || !Number.isFinite(v.scale) || v.scale < .001 || v.scale > 1000
      || !Number.isFinite(v.target) || Math.abs(v.target) > 10000
      || !['increase', 'decrease', 'target'].includes(v.direction)) throw new Error('重み・改善幅・目標値を確認してください。');
  }
}

/** Scores are baseline-relative and invariant to a common multiplier on all weights. */
export function objectiveScore(values: ObjectiveValues, baseline: ObjectiveValues, settings: OptimizationSettings) {
  const totalWeight = OBJECTIVE_IDS.reduce((sum, id) => sum + settings.objectives[id].weight, 0);
  const contributions = {} as Record<ObjectiveId, number | null>;
  let score = 0;
  for (const id of OBJECTIVE_IDS) {
    const { weight, scale, direction, target } = settings.objectives[id];
    const actual = values[id], base = baseline[id];
    if (!weight) { contributions[id] = 0; continue; }
    if (actual === null || base === null || !Number.isFinite(actual) || !Number.isFinite(base)) {
      contributions[id] = null; continue;
    }
    const gain = direction === 'target' ? Math.abs(base - target) - Math.abs(actual - target)
      : (actual - base) * (direction === 'increase' ? 1 : -1);
    contributions[id] = gain / scale * weight / totalWeight;
    score += contributions[id]!;
  }
  return { score: totalWeight > 0 && OBJECTIVE_IDS.every(id => contributions[id] !== null) ? score : null, contributions };
}
