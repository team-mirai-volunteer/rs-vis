import data from './data/poverty-income-2024.json';
import taxData from '@/scripts/data/tax-burden-params-2025.json';
import { computeHousehold, type HouseholdInput } from '../tax-burden/household-tax';
import { baseReform } from '../tax-burden/households';
import { PERSONAL_TAX_REVENUE, SOCIAL_INSURANCE_REVENUE } from './policy-limits';
import type { Policy, SourceValue } from '@/types/fiscal-space';
import type { TaxParameters } from '@/types/tax-burden';

export const POVERTY_DATA = data;
export interface PovertyAssumptions {
  cashTarget: 'universal' | 'low-income' | 'income-tapered' | 'children';
  /** Share of the childcare budget treated as cash, not services. */
  childcareCashShare: number;
}
export const POVERTY_DEFAULTS: PovertyAssumptions = { cashTarget: 'universal', childcareCashShare: 1 };
export const CASH_TARGET_LABELS = { universal: '全国民へ一律（一般世帯で近似）', 'low-income': '政策なしで貧困線未満の人へ一律', 'income-tapered': '所得に合わせて逓減', children: '子ども1人当たり一律（旧条件）' };
const taxParameters = taxData as unknown as TaxParameters;
const reform = baseReform(taxParameters);
const population = data.households * data.meanHouseholdSize;
const children = data.childHouseholds * data.meanChildren;
// Published median/line are independently rounded. Use exactly half the median in the model.
const median = data.publishedMedian;
const line = median / 2;
/** Full per-person grant up to the baseline poverty line, tapering to zero at the median.
 * This is a comparison assumption, not a calibrated tax/benefit schedule. */
export function cashTaperWeight(equivalentIncome: number) {
  return Math.max(0, Math.min(1, (median - equivalentIncome) / (median - line)));
}

const revenue = [PERSONAL_TAX_REVENUE['income-tax'].amount, PERSONAL_TAX_REVENUE['resident-tax'].amount, SOCIAL_INSURANCE_REVENUE.insured];

export function validatePoverty(c: PovertyAssumptions) {
  if (!c || !Object.hasOwn(CASH_TARGET_LABELS, c.cashTarget) || !Number.isFinite(c.childcareCashShare) || c.childcareCashShare < 0 || c.childcareCashShare > 1) {
    throw new RangeError('Invalid poverty assumptions');
  }
}

interface Cell {
  lower: number; upper: number; people: number; children: number;
  size: number; childCount: number; householdWeight: number;
  /** Annual household liability profile, calibrated to national receipts. Not an observed tax bill. */
  taxes: number[];
}
interface Shape { familySize: number; otherSize: number; retiredShare: number; twoEarners: boolean; tail: number }
const shapes: Shape[] = [
  { familySize: 4, otherSize: 2, retiredShare: .4, twoEarners: true, tail: 20e6 },
  { familySize: 3, otherSize: 1, retiredShare: .3, twoEarners: false, tail: 15e6 },
  { familySize: 4, otherSize: 2, retiredShare: .5, twoEarners: false, tail: 30e6 },
];

/** Uniform within published bins, split at the poverty line and median before calibration. */
function distribution(tail: number) {
  const pieces = data.bins.flatMap(b => {
    const upper = b.upper ?? tail;
    const edges = [b.lower, ...[line, median].filter(x => x > b.lower && x < upper), upper];
    return edges.slice(0, -1).map((lower, i) => ({ lower, upper: edges[i + 1],
      all: b.allPercent / 100 * (edges[i + 1] - lower) / (upper - b.lower),
      child: b.childPercent / 100 * (edges[i + 1] - lower) / (upper - b.lower) }));
  });
  const band = (x: number) => x < line ? 0 : x < median ? 1 : 2;
  const allSums = [0, 0, 0], childSums = [0, 0];
  for (const p of pieces) { allSums[band(p.lower)] += p.all; childSums[p.lower < line ? 0 : 1] += p.child; }
  const allTargets = [data.allPovertyRate, .5 - data.allPovertyRate, .5];
  return pieces.map(p => ({ ...p,
    all: p.all * allTargets[band(p.lower)] / allSums[band(p.lower)],
    child: p.child * (p.lower < line ? data.childPovertyRate : 1 - data.childPovertyRate) / childSums[p.lower < line ? 0 : 1],
  }));
}

/** Tax law is used only to shape liabilities. Baseline disposable incomes remain the survey distribution.
 * Missing joint data (earnings, benefits, household type) are explicit sensitivity assumptions. */
function taxProfile(disposable: number, size: number, childCount: number, retired: boolean, twoEarners: boolean) {
  const evaluate = (gross: number, localRate = reform.localRate) => {
    const adults = size - childCount;
    const shares = adults === 1 ? [1] : twoEarners && !retired ? [.67, .33] : [1, 0];
    const h: HouseholdInput = { adults: shares.map(share => ({ age: retired ? 70 : 40,
      salary: retired ? 0 : gross * share, pension: retired ? gross * share : 0,
      employeeInsured: !retired && gross * share >= taxParameters.employeeInsuranceThreshold })),
      childAges: Array.from({ length: childCount }, (_, i) => 6 + i * 2), loneParent: false, bonus: false };
    return computeHousehold(h, taxParameters, { ...reform, localRate });
  };
  let lo = 0, hi = Math.max(10e6, disposable * 5);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2, t = evaluate(mid);
    if (t.gross - t.netBurden < disposable) lo = mid; else hi = mid;
  }
  const t = evaluate(hi);
  // Resident-tax policy covers the income levy only, not per-capita or forest taxes.
  return [t.incomeTax, Math.max(0, t.residentTax - evaluate(hi, 0).residentTax), t.pension + t.health + t.care + t.employment];
}

const cellCache = new Map<number, Cell[]>();
function cellsFor(scenario: number): Cell[] {
  const cached = cellCache.get(scenario);
  if (cached) return cached;
  const shape = shapes[scenario], cells: Cell[] = [];
  for (const p of distribution(shape.tail)) {
    const childCount = shape.familySize - 2;
    const familyPeople = p.child * children * shape.familySize / childCount;
    const otherPeople = p.all * population - familyPeople;
    if (otherPeople < -1) throw new Error('Incompatible household and income distributions');
    // 20 subintervals prevent a whole published income band receiving the midpoint's tax liability.
    for (let i = 0; i < 20; i++) {
      const lower = p.lower + (p.upper - p.lower) * i / 20;
      const upper = p.lower + (p.upper - p.lower) * (i + 1) / 20;
      for (const group of [
        { people: familyPeople, size: shape.familySize, childCount, retired: false },
        { people: otherPeople * (1 - shape.retiredShare), size: shape.otherSize, childCount: 0, retired: false },
        { people: otherPeople * shape.retiredShare, size: shape.otherSize, childCount: 0, retired: true },
      ]) {
        const people = Math.max(0, group.people) / 20;
        cells.push({ lower, upper, people, size: group.size, childCount: group.childCount,
          children: people * group.childCount / group.size, householdWeight: people / group.size,
          taxes: taxProfile((lower + upper) / 2 * Math.sqrt(group.size), group.size, group.childCount, group.retired, shape.twoEarners) });
      }
    }
  }
  const totals = revenue.map((_, j) => cells.reduce((sum, c) => sum + c.householdWeight * c.taxes[j], 0));
  for (const c of cells) c.taxes = c.taxes.map((tax, j) => tax * revenue[j] / totals[j]);
  cellCache.set(scenario, cells);
  return cells;
}

interface IncomeCell { lower: number; upper: number; people: number; children: number }
export function povertyMeasures(cells: IncomeCell[], anchoredLine = line) {
  const n = cells.reduce((s, c) => s + c.people, 0), kids = cells.reduce((s, c) => s + c.children, 0);
  if (!(n > 0) || cells.some(c => c.upper <= c.lower || c.people < 0 || c.children < 0 || c.children > c.people)) throw new RangeError('Invalid income distribution');
  const below = (limit: number, key: 'people' | 'children') => cells.reduce((s, c) => s + c[key] * Math.max(0, Math.min(1, (limit - c.lower) / (c.upper - c.lower))), 0);
  let lo = Math.min(...cells.map(c => c.lower)), hi = Math.max(...cells.map(c => c.upper));
  for (let i = 0; i < 55; i++) { const mid = (lo + hi) / 2; if (below(mid, 'people') < n / 2) lo = mid; else hi = mid; }
  const medianDisposableIncome = (lo + hi) / 2;
  const povertyLine = medianDisposableIncome / 2;
  return { povertyLine, medianDisposableIncome, all: below(povertyLine, 'people') / n, child: kids > 0 ? below(povertyLine, 'children') / kids : 0,
    anchoredAll: below(anchoredLine, 'people') / n, anchoredChild: kids > 0 ? below(anchoredLine, 'children') / kids : 0 };
}

function evaluate(cells: Cell[], policies: Policy[], year: number, c: PovertyAssumptions, employeeShare: number) {
  const amount = (id: string) => policies.filter(p => p.id === id && (p.kind === 'permanent' || year <= p.duration)).reduce((sum, p) => sum + p.annualCost, 0);
  const cash = amount('cash'), childCash = amount('childcare') * c.childcareCashShare;
  const requested = [amount('income-tax'), amount('resident-tax'), amount('social-insurance') * employeeShare];
  const fractions = requested.map((v, j) => Math.min(1, v / revenue[j]));
  // Preserve the children mode for old shared scenarios; new cash settings use income targeting.
  // Income is fixed before policy. Midpoints approximate the taper within the 20 subintervals.
  const units = (r: Cell) => c.cashTarget === 'children' ? r.childCount
    : r.size * (c.cashTarget === 'low-income' ? (r.upper <= line ? 1 : 0)
      : c.cashTarget === 'income-tapered' ? cashTaperWeight((r.lower + r.upper) / 2) : 1);
  const eligible = cells.reduce((sum, r) => sum + units(r) * r.householdWeight, 0);
  let allocated = 0;
  const after = cells.map(r => {
    const cashUnits = units(r);
    const gain = (eligible > 0 ? cash * cashUnits / eligible : 0) + childCash * r.childCount / children
      + r.taxes.reduce((sum, tax, j) => sum + tax * fractions[j], 0);
    allocated += gain * r.householdWeight;
    const equivalentGain = gain / Math.sqrt(r.size);
    return { ...r, lower: r.lower + equivalentGain, upper: r.upper + equivalentGain };
  });
  return { ...povertyMeasures(after), allocated, requested: cash + childCash + requested.reduce((s, x) => s + x, 0),
    activeBudget: policies.filter(p => p.kind === 'permanent' || year <= p.duration).reduce((s, p) => s + p.annualCost, 0) };
}

/** Static direct-effect comparison using 2024 incomes/prices, not a forecast of future poverty.
 * Changing the distribution settings does not change macro multipliers or fiscal costs. */
export function povertyScenario(policies: Policy[], years: number, c: PovertyAssumptions, employeeShare: number) {
  validatePoverty(c);
  if (!Number.isInteger(years) || years < 1 || years > 15 || !Number.isFinite(employeeShare) || employeeShare < 0 || employeeShare > 1
    || policies.some(p => !Number.isFinite(p.annualCost) || p.annualCost < 0)) throw new RangeError('Invalid poverty policy');
  const cells = shapes.map((_, i) => cellsFor(i));
  const baseline = povertyMeasures(cells[0]);
  const rows = Array.from({ length: years }, (_, i) => {
    const results = cells.map(group => evaluate(group, policies, i + 1, c, employeeShare));
    const range = (key: 'all' | 'child') => ({ min: Math.min(...results.map(r => r[key])), max: Math.max(...results.map(r => r[key])) });
    return { year: i + 1, ...results[0], range: { all: range('all'), child: range('child') } };
  });
  return { baseline, rows, population, children, assumptions: { ...c } };
}

export const POVERTY_RECORDS: SourceValue[] = [
  { key: 'poverty.all', value: data.allPovertyRate, unit: '比率', referenceYear: '2024年所得（2025年調査）', status: 'verified', sourceName: data.sourceName, sourceUrl: data.ratesSourceUrl,
    uncertaintyNote: '再分配後の相対的貧困率。等価可処分所得が中央値の半分未満の世帯員の割合。2026-09-21確認。' },
  { key: 'poverty.child', value: data.childPovertyRate, unit: '比率', referenceYear: '2024年所得（2025年調査）', status: 'verified', sourceName: data.sourceName, sourceUrl: data.ratesSourceUrl,
    uncertaintyNote: '17歳以下の子どもの再分配後相対的貧困率。公表集計の所得階級内を補間し、税負担・家族構成は仮定するため、政策後は条件付き試算。' },
];
