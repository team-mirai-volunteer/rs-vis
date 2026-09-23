import { POLICIES } from '@/app/lib/fiscal-space/assumptions';

export const OBJECTIVES = {
  gdp: { label: '実質GDP', unit: '兆円', scale: 10, direction: 'increase' },
  poverty: { label: '相対的貧困率（直接効果）', unit: '%', scale: 1, direction: 'decrease' },
  childPoverty: { label: '子どもの貧困率（直接効果）', unit: '%', scale: 1, direction: 'decrease' },
  disposableIncome: { label: '実質可処分所得（固定価格・中央値）', unit: '万円／年', scale: 10, direction: 'increase' },
  burden: { label: '国民負担率（GDP比）', unit: '%', scale: 1, direction: 'decrease' },
  interest: { label: '利払い', unit: '兆円', scale: 1, direction: 'decrease' },
  cpi: { label: 'CPI上昇率', unit: '%', scale: 1, direction: 'decrease' },
  unemployment: { label: '失業率', unit: '%', scale: .5, direction: 'decrease' },
  fertility: { label: '合計特殊出生率', unit: '', scale: .1, direction: 'increase' },
  exports: { label: '輸出（名目）', unit: '兆円', scale: 10, direction: 'increase' },
  imports: { label: '輸入（名目）', unit: '兆円', scale: 10, direction: 'decrease' },
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

/** Editable value judgments, not empirically estimated welfare coefficients. */
export const OBJECTIVE_WEIGHT_PRESETS = {
  living: { label: '暮らしと将来への希望（初期設定）', description: '所得の底上げ・子どもの貧困改善と成長を重視し、出生率・雇用・税と社会保険料の負担軽減も評価します。物価・利払いにも重みを置き、輸出入は補助的に評価します。',
    weights: { gdp: 25, poverty: 10, childPoverty: 15, disposableIncome: 15, burden: 10, unemployment: 10, fertility: 20, cpi: 5, interest: 5, exports: 5, imports: 5 } },
  future: { label: '将来世代重視', description: 'GDPと出生率を最優先に、貧困改善を次に重視します。',
    weights: { gdp: 6, poverty: 4, childPoverty: 6, disposableIncome: 4, burden: 2, unemployment: 2, fertility: 6, cpi: 2, interest: 2, exports: 1, imports: 1 } },
  stability: { label: '安定重視', description: '物価と利払いを最優先に、GDP・貧困改善を次に重視します。',
    weights: { gdp: 4, poverty: 4, childPoverty: 4, disposableIncome: 4, burden: 2, unemployment: 2, fertility: 2, cpi: 6, interest: 6, exports: 1, imports: 1 } },
} satisfies Record<string, { label: string; description: string; weights: Record<ObjectiveId, number> }>;

export function withObjectiveWeights(settings: OptimizationSettings, weights: Record<ObjectiveId, number>): OptimizationSettings {
  return { ...settings, objectives: Object.fromEntries(OBJECTIVE_IDS.map(id => [id, {
    ...settings.objectives[id], weight: weights[id],
  }])) as OptimizationSettings['objectives'] };
}

export function optimizationDefaults(): OptimizationSettings {
  return { minBudget: 0, maxBudget: 15, aggregation: 'average',
    eligible: Object.fromEntries(POLICIES.map(p => [p.id, true])),
    objectives: Object.fromEntries(OBJECTIVE_IDS.map(id => [id, {
      weight: OBJECTIVE_WEIGHT_PRESETS.living.weights[id], scale: OBJECTIVES[id].scale, direction: OBJECTIVES[id].direction,
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
