import type { TaxState, TaxView } from '@/types/tax-burden';
import { HOUSEHOLDS, initialTaxState, MODEL_VERSION, REFORM_LIMITS } from './households';
import { BIRTH_AGE_RANGE } from './simulate';
import { WORK_UNTIL_MAX } from './simulate-lifecycle';

export { REFORM_LIMITS };

const VIEWS: TaxView[] = ['curve', 'revenue', 'stats', 'age', 'heatmap'];

export function decodeTaxState(query: string): { state: TaxState; warning: string | null } {
  const state = initialTaxState();
  const q = new URLSearchParams(query);
  // `URLSearchParams.size` is missing in older browsers; toString() is empty when there are no entries.
  if (q.toString() === '') return { state, warning: null };
  if (q.get('v') !== MODEL_VERSION || q.get('fy') !== '2025') {
    return { state, warning: '共有URLのモデル版・制度年に対応していないため、既定の条件を表示しています。' };
  }
  let invalid = false;
  const numeric = (key: string, current: number, min: number, max: number, integer = false) => {
    if (!q.has(key)) return current;
    const raw = q.get(key)!;
    const value = raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      invalid = true; return current;
    }
    return value;
  };
  const view = q.get('view');
  // 'reform' was a separate tab before the policy sliders moved into the curve view; keep old links working.
  if (view === 'reform') state.view = 'curve';
  else if (view && VIEWS.includes(view as TaxView)) state.view = view as TaxView;
  else if (view) invalid = true;
  const household = HOUSEHOLDS.find(h => h.id === q.get('household'));
  if (household) state.household = household.id;
  else if (q.has('household')) invalid = true;
  state.age = numeric('age', state.age, 20, 64, true);
  state.income = numeric('income', state.income, 0, 20000000, true);
  state.share = numeric('share', state.share, 1, 99, true);
  state.continuation = numeric('continuation', state.continuation, 0, 1);
  state.workUntil = numeric('workUntil', state.workUntil, 65, WORK_UNTIL_MAX, true);
  state.corporateShare = numeric('corporateShare', state.corporateShare, 0, 1);
  state.firstBirthAge = numeric('firstBirthAge', state.firstBirthAge, BIRTH_AGE_RANGE[0], BIRTH_AGE_RANGE[1], true);
  state.secondBirthAge = numeric('secondBirthAge', state.secondBirthAge, BIRTH_AGE_RANGE[0], BIRTH_AGE_RANGE[1], true);
  const denominator = q.get('denominator');
  if (denominator === 'career' || denominator === 'income') state.denominator = denominator;
  else if (denominator !== null) invalid = true;
  for (const key of ['bonus', 'showAll', 'includeConsumption', 'showOecd'] as const) {
    if (q.has(key)) {
      if (q.get(key) === '1' || q.get(key) === '0') state[key] = q.get(key) === '1';
      else invalid = true;
    }
  }
  if (q.has('consumption')) {
    const value = q.get('consumption');
    if (value === 'net-fixed' || value === 'gross-fixed') state.consumptionAssumption = value;
    else invalid = true;
  }
  for (const key of Object.keys(REFORM_LIMITS) as (keyof typeof REFORM_LIMITS)[]) {
    const [min, max] = REFORM_LIMITS[key];
    state.reform[key] = numeric(key, state.reform[key], min, max,
      ['basicAllowanceExtra', 'childMonthly', 'creditAnnual', 'creditPhaseoutStart'].includes(key));
  }
  return { state, warning: invalid ? '共有URLの一部の値が範囲外のため、その項目を既定値に戻しました。' : null };
}

export function encodeTaxState(state: TaxState): string {
  const q = new URLSearchParams({ v: MODEL_VERSION, fy: String(state.fy), view: state.view,
    household: state.household, age: String(state.age), income: String(state.income),
    share: String(state.share), bonus: state.bonus ? '1' : '0', showAll: state.showAll ? '1' : '0',
    consumption: state.consumptionAssumption, continuation: String(state.continuation),
    workUntil: String(state.workUntil), corporateShare: String(state.corporateShare), firstBirthAge: String(state.firstBirthAge), secondBirthAge: String(state.secondBirthAge), denominator: state.denominator,
    includeConsumption: state.includeConsumption ? '1' : '0', showOecd: state.showOecd ? '1' : '0' });
  for (const [key, value] of Object.entries(state.reform)) q.set(key, String(value));
  return q.toString();
}
