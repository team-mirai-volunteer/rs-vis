import type { EconomyState, ModelParameters } from '../../types/fiscal-space';
import { initialEconomy, PARAMETERS } from '../../app/lib/fiscal-space/assumptions';
import { DEMOGRAPHICS_OFF } from '../../app/lib/fiscal-space/demographics';
import { simulate } from '../../app/lib/fiscal-space/simulate';

/** One fiscal year of the 2024 JSNA general-government series (trillion yen; CPI 2020 = 100). */
export interface MacroObservation {
  year: number; gdpTrillion: number;
  taxTrillion: number; finesTrillion: number; socialTrillion: number;
  otherPrimaryRevenueTrillion: number; interestReceivedTrillion: number;
  primaryExpenditureTrillion: number; interestPaidTrillion: number; primaryBalanceTrillion: number;
  grossDebtTrillion: number | null;
  cpiFiscalYear: number; cpiInflation: number;
}
export type MacroSeries = 'nominalGdp' | 'revenue' | 'primaryExpenditure' | 'interestPayments' | 'primaryBalance' | 'debtRatio' | 'cpi';
export type MacroMethod = 'conditional' | 'unconditional' | 'unchanged' | 'linear-trend';
export const MACRO_SERIES: MacroSeries[] = ['nominalGdp', 'revenue', 'primaryExpenditure', 'interestPayments', 'primaryBalance', 'debtRatio', 'cpi'];
export const SERIES_LABELS: Record<MacroSeries, string> = {
  nominalGdp: '名目GDP（兆円）', revenue: '税・社会負担収入（兆円）', primaryExpenditure: '基礎的支出（兆円）',
  interestPayments: '支払利子（兆円）', primaryBalance: 'プライマリーバランス（兆円）', debtRatio: '負債残高/GDP（比率）', cpi: 'CPI（2020年＝100）',
};
export interface MacroCase {
  origin: number; target: number; horizon: number; series: MacroSeries; method: MacroMethod;
  predicted: number; actual: number; error: number; errorPercent: number;
}
export interface MacroSummary { series: MacroSeries; horizon: number; method: MacroMethod; count: number; mae: number; bias: number; rmse: number; mapePercent: number }
export interface OriginRun { origin: number; horizon: number; conditional: { realGrowth: number; inflation: number; nominalGrowth: number } }

const revenue = (r: MacroObservation) => r.taxTrillion + r.finesTrillion + r.socialTrillion;
const observed = (r: MacroObservation, series: MacroSeries): number | null => ({
  nominalGdp: r.gdpTrillion, revenue: revenue(r), primaryExpenditure: r.primaryExpenditureTrillion,
  interestPayments: r.interestPaidTrillion, primaryBalance: r.primaryBalanceTrillion,
  debtRatio: r.grossDebtTrillion === null ? null : r.grossDebtTrillion / r.gdpTrillion, cpi: r.cpiFiscalYear,
}[series]);

function validateRows(rows: MacroObservation[]) {
  if (rows.length < 2) throw new RangeError('At least two consecutive fiscal years are required');
  rows.forEach((r, i) => {
    if (!Number.isInteger(r.year) || (i > 0 && r.year !== rows[i - 1].year + 1)) throw new RangeError('Fiscal years must be consecutive');
    for (const v of [r.gdpTrillion, r.taxTrillion, r.finesTrillion, r.socialTrillion, r.otherPrimaryRevenueTrillion, r.interestReceivedTrillion,
      r.primaryExpenditureTrillion, r.interestPaidTrillion, r.primaryBalanceTrillion, r.cpiFiscalYear, r.cpiInflation]) {
      if (!Number.isFinite(v)) throw new RangeError(`Non-finite observation in ${r.year}`);
    }
    if (r.gdpTrillion <= 0 || r.cpiFiscalYear <= 0 || r.interestPaidTrillion < 0 || revenue(r) <= 0 || r.primaryExpenditureTrillion <= 0) throw new RangeError(`Invalid observation in ${r.year}`);
    if (r.grossDebtTrillion !== null && !(r.grossDebtTrillion > 0)) throw new RangeError(`Invalid debt in ${r.year}`);
  });
}

/**
 * Build a 2024-method EconomyState from one historical fiscal year. Only the macro and fiscal
 * blocks are replaced; labour, energy and external blocks keep the 2024 values, which do not
 * enter the compared fiscal series when no policy is simulated.
 */
export function historicalState(row: MacroObservation, base: EconomyState = initialEconomy('2024'), previous?: MacroObservation): EconomyState {
  const T = 1e12, gdp = row.gdpTrillion * T;
  const debtRatio = row.grossDebtTrillion === null ? base.fiscal.grossDebt / base.macro.nominalGdp : row.grossDebtTrillion / row.gdpTrillion;
  const debt = debtRatio * gdp, interest = row.interestPaidTrillion * T;
  const taxes = (row.taxTrillion + row.finesTrillion) * T, socialContributions = row.socialTrillion * T;
  const assetRatio = base.fiscal.financialAssets / base.fiscal.grossDebt, liquidRatio = base.fiscal.liquidFinancialAssets / base.fiscal.grossDebt;
  const state = structuredClone(base);
  state.year = row.year;
  state.macro = { ...base.macro, nominalGdp: gdp, realGdp: gdp, potentialGdp: gdp, inflation: row.cpiInflation, coreInflation: row.cpiInflation,
    expectedInflation: row.cpiInflation,
    realGrowth: previous ? (row.gdpTrillion / previous.gdpTrillion) / (1 + row.cpiInflation) - 1 : base.macro.realGrowth,
    nominalGrowth: previous ? row.gdpTrillion / previous.gdpTrillion - 1 : base.macro.nominalGrowth };
  state.baseCalendarYear = row.year;
  state.fiscal = { ...base.fiscal, taxRevenue: taxes + socialContributions, taxes, socialContributions,
    otherPrimaryRevenue: row.otherPrimaryRevenueTrillion * T, interestRevenue: row.interestReceivedTrillion * T,
    primaryExpenditure: row.primaryExpenditureTrillion * T, interestPayments: interest,
    primaryBalance: row.primaryBalanceTrillion * T, structuralPrimaryBalance: row.primaryBalanceTrillion * T,
    grossDebt: debt, financialAssets: debt * assetRatio, netDebt: debt * (1 - assetRatio),
    liquidFinancialAssets: debt * liquidRatio, liquidityAdjustedNetDebt: debt * (1 - liquidRatio) };
  // Same synthetic portfolio as the 2024 preset: ten equal buckets, one coupon reconciled to interest paid.
  state.debtPortfolio = Array.from({ length: 10 }, (_, i) => ({ principal: debt / 10, coupon: interest / debt, maturityYear: row.year + i + 1 }));
  return state;
}

/** Constant growth rates that reproduce the observed nominal GDP and CPI at the end of the horizon. */
export function conditionalRates(origin: MacroObservation, end: MacroObservation, horizon: number) {
  const nominalGrowth = (end.gdpTrillion / origin.gdpTrillion) ** (1 / horizon) - 1;
  const inflation = (end.cpiFiscalYear / origin.cpiFiscalYear) ** (1 / horizon) - 1;
  return { nominalGrowth, inflation, realGrowth: (1 + nominalGrowth) / (1 + inflation) - 1 };
}

function predictedSeries(steps: ReturnType<typeof simulate>['steps'], origin: MacroObservation): Record<MacroSeries, number>[] {
  return steps.map(step => {
    const f = step.state.fiscal, gdp = step.state.macro.nominalGdp;
    return { nominalGdp: gdp / 1e12, revenue: f.taxRevenue / 1e12, primaryExpenditure: f.primaryExpenditure / 1e12,
      interestPayments: f.interestPayments / 1e12, primaryBalance: f.primaryBalance / 1e12, debtRatio: f.grossDebt / gdp,
      cpi: origin.cpiFiscalYear * (step.cpiDiagnostics?.priceIndex ?? NaN) };
  });
}

/** Ordinary least squares line through the last `window` observations, extrapolated `horizon` years. */
export function linearTrend(values: number[], horizon: number, window = 5): number | null {
  const sample = values.slice(-window);
  const n = sample.length;
  if (n < 2) return null;
  const xs = sample.map((_, i) => i), meanX = (n - 1) / 2, meanY = sample.reduce((s, v) => s + v, 0) / n;
  const slope = xs.reduce((s, x, i) => s + (x - meanX) * (sample[i] - meanY), 0) / xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  return meanY + slope * (n - 1 - meanX + horizon);
}

export interface MacroBacktestOptions { horizons?: number[]; maxHorizon?: number; parameters?: ModelParameters; base?: EconomyState; trendWindow?: number }

/**
 * All-series conditional/unconditional backtest of the simulator's no-policy path. Each origin
 * year is simulated once per mode for min(maxHorizon, remaining years); no re-initialisation on
 * intermediate observations. Conditional mode sets constant baseline growth/inflation from the
 * realised end-of-horizon nominal GDP and CPI (an approximation to a year-by-year exogenous path).
 */
export function backtestMacro(rows: MacroObservation[], options: MacroBacktestOptions = {}) {
  validateRows(rows);
  const horizons = options.horizons ?? [1, 3, 5], maxHorizon = options.maxHorizon ?? Math.max(...horizons);
  if (horizons.some(h => !Number.isInteger(h) || h < 1) || !Number.isInteger(maxHorizon) || maxHorizon < 1) throw new RangeError('Invalid horizon');
  // Historical origins (1994–) predate the 2020–2070 population projection; the backtest keeps the flat path.
  const p = { ...(options.parameters ?? PARAMETERS), demographics: DEMOGRAPHICS_OFF }, base = options.base ?? initialEconomy('2024');
  const cases: MacroCase[] = [], runs: OriginRun[] = [];
  const push = (origin: MacroObservation, target: MacroObservation, series: MacroSeries, method: MacroMethod, predicted: number | null) => {
    const actual = observed(target, series);
    if (predicted === null || actual === null || !Number.isFinite(predicted)) return;
    cases.push({ origin: origin.year, target: target.year, horizon: target.year - origin.year, series, method, predicted, actual,
      error: predicted - actual, errorPercent: actual === 0 ? NaN : (predicted / actual - 1) * 100 });
  };
  rows.forEach((origin, i) => {
    const horizon = Math.min(maxHorizon, rows.length - 1 - i);
    if (horizon < 1) return;
    const end = rows[i + horizon];
    const rates = conditionalRates(origin, end, horizon);
    runs.push({ origin: origin.year, horizon, conditional: rates });
    const state = historicalState(origin, base, rows[i - 1]);
    const paths: Record<'conditional' | 'unconditional', Record<MacroSeries, number>[]> = {
      conditional: predictedSeries(simulate(state, [], horizon, { ...p, baselineRealGrowth: rates.realGrowth, baselineInflation: rates.inflation }).steps, origin),
      unconditional: predictedSeries(simulate(state, [], horizon, p).steps, origin),
    };
    for (const h of horizons) {
      if (h > horizon) continue;
      const target = rows[i + h];
      for (const series of MACRO_SERIES) {
        push(origin, target, series, 'conditional', paths.conditional[h - 1][series]);
        push(origin, target, series, 'unconditional', paths.unconditional[h - 1][series]);
        push(origin, target, series, 'unchanged', observed(origin, series));
        const history = rows.slice(0, i + 1).map(r => observed(r, series));
        push(origin, target, series, 'linear-trend', history.some(v => v === null) ? null : linearTrend(history as number[], h, options.trendWindow));
      }
    }
  });
  const summaries: MacroSummary[] = [];
  for (const series of MACRO_SERIES) for (const horizon of horizons) for (const method of ['conditional', 'unconditional', 'unchanged', 'linear-trend'] as MacroMethod[]) {
    const group = cases.filter(c => c.series === series && c.horizon === horizon && c.method === method);
    if (!group.length) continue;
    const mean = (fn: (c: MacroCase) => number) => group.reduce((s, c) => s + fn(c), 0) / group.length;
    const finitePercent = group.filter(c => Number.isFinite(c.errorPercent));
    summaries.push({ series, horizon, method, count: group.length, mae: mean(c => Math.abs(c.error)), bias: mean(c => c.error),
      rmse: Math.sqrt(mean(c => c.error ** 2)),
      mapePercent: finitePercent.length ? finitePercent.reduce((s, c) => s + Math.abs(c.errorPercent), 0) / finitePercent.length : NaN });
  }
  return { cases, summaries, runs };
}

// ---- Component elasticities (Goal B) ----
export interface ElasticityEstimate {
  component: 'taxes' | 'socialContributions' | 'total'; window: string; from: number; to: number; count: number;
  /** OLS through the origin on Δln(component) = β·Δln(GDP). */
  elasticity: number; standardError: number; rSquared: number;
  bootstrap: { replications: number; percentile5: number; percentile95: number; standardDeviation: number };
  /** Reference: simple ratio of cumulative log changes over the window. */
  cumulativeLogRatio: number;
}

/** Deterministic 32-bit generator (mulberry32) so the bootstrap is reproducible in tests. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function throughOrigin(x: number[], y: number[]) {
  const sxx = x.reduce((s, v) => s + v * v, 0), sxy = x.reduce((s, v, i) => s + v * y[i], 0);
  return sxy / sxx;
}
/**
 * Pooled one-year log-change elasticity per revenue component. Windows are labelled by target
 * fiscal year (the change from year t−1 to t belongs to t). Not adjusted for tax-rate changes.
 */
export function componentElasticities(rows: MacroObservation[], windows: [number, number][] = [[1995, 2024], [2005, 2024], [2015, 2024]],
  replications = 2000, seed = 20260917): ElasticityEstimate[] {
  validateRows(rows);
  if (rows.some(r => r.socialTrillion <= 0 || r.taxTrillion + r.finesTrillion <= 0)) throw new RangeError('Components must be positive for log changes');
  const component = (r: MacroObservation, c: ElasticityEstimate['component']) =>
    c === 'taxes' ? r.taxTrillion + r.finesTrillion : c === 'socialContributions' ? r.socialTrillion : revenue(r);
  const estimates: ElasticityEstimate[] = [];
  for (const [from, to] of windows) for (const c of ['taxes', 'socialContributions', 'total'] as const) {
    const pairs = rows.slice(1).map((r, i) => ({ target: r.year, x: Math.log(r.gdpTrillion / rows[i].gdpTrillion), y: Math.log(component(r, c) / component(rows[i], c)) }))
      .filter(pair => pair.target >= from && pair.target <= to);
    if (pairs.length < 3) throw new RangeError(`Window ${from}-${to} has fewer than 3 changes`);
    const x = pairs.map(pt => pt.x), y = pairs.map(pt => pt.y);
    const elasticity = throughOrigin(x, y);
    const residuals = y.map((v, i) => v - elasticity * x[i]);
    const sse = residuals.reduce((s, e) => s + e * e, 0), sxx = x.reduce((s, v) => s + v * v, 0);
    const standardError = Math.sqrt(sse / (pairs.length - 1) / sxx);
    const syy = y.reduce((s, v) => s + v * v, 0);
    const random = mulberry32(seed + from * 7 + c.length);
    const draws = Array.from({ length: replications }, () => {
      const idx = Array.from({ length: pairs.length }, () => Math.floor(random() * pairs.length));
      return throughOrigin(idx.map(k => x[k]), idx.map(k => y[k]));
    }).sort((a, b) => a - b);
    const meanDraw = draws.reduce((s, v) => s + v, 0) / draws.length;
    const first = rows.find(r => r.year === from - 1)!, last = rows.find(r => r.year === to)!;
    estimates.push({ component: c, window: `${from}-${to}`, from, to, count: pairs.length, elasticity, standardError, rSquared: 1 - sse / syy,
      bootstrap: { replications, percentile5: draws[Math.floor(.05 * (draws.length - 1))], percentile95: draws[Math.ceil(.95 * (draws.length - 1))],
        standardDeviation: Math.sqrt(draws.reduce((s, v) => s + (v - meanDraw) ** 2, 0) / (draws.length - 1)) },
      cumulativeLogRatio: Math.log(component(last, c) / component(first, c)) / Math.log(last.gdpTrillion / first.gdpTrillion) });
  }
  return estimates;
}
