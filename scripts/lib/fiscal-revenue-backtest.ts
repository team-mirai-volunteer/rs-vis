import { projectRevenue } from '../../app/lib/fiscal-space/revenue';

export interface RevenueObservation { year: number; gdpTrillion: number; taxPercentGdp: number; socialPercentGdp: number }
export function backtestRevenue(rows: RevenueObservation[], elasticities: number[], horizons?: number[]) {
  if (rows.length < 2 || rows.some((r, i) => !Number.isInteger(r.year) || (i > 0 && r.year !== rows[i - 1].year + 1)
    || !Number.isFinite(r.gdpTrillion) || r.gdpTrillion <= 0
    || !Number.isFinite(r.taxPercentGdp) || r.taxPercentGdp < 0 || !Number.isFinite(r.socialPercentGdp) || r.socialPercentGdp < 0)
    || elasticities.some(e => !Number.isFinite(e) || e < 0)
    || horizons?.some(h => !Number.isInteger(h) || h < 1)) throw new RangeError('Invalid historical series, elasticity or horizon');
  const revenue = (r: RevenueObservation) => r.gdpTrillion * (r.taxPercentGdp + r.socialPercentGdp) / 100;
  // Each origin uses its own observed revenue. No fitting to future observations.
  // Target GDP is deliberately observed: this checks the revenue equation only.
  const cases = rows.flatMap((origin, i) => rows.slice(i + 1).filter(target => !horizons || horizons.includes(target.year - origin.year)).flatMap(target =>
    [...elasticities.map(elasticity => ({ method: `elasticity-${elasticity}`, elasticity })), { method: 'unchanged', elasticity: 0 }]
      .map(({ method, elasticity }) => {
        const predicted = projectRevenue(revenue(origin), origin.gdpTrillion, target.gdpTrillion, elasticity);
        const actual = revenue(target);
        return { origin: origin.year, target: target.year, horizon: target.year - origin.year, method, elasticity,
          predicted, actual, error: predicted - actual, errorPercent: (predicted / actual - 1) * 100 };
      })));
  const summaries = [...new Set(cases.map(r => r.horizon))].flatMap(horizon => [...new Set(cases.map(r => r.method))].map(method => {
    const group = cases.filter(r => r.horizon === horizon && r.method === method);
    const mean = (fn: (r: typeof group[number]) => number) => group.reduce((sum, r) => sum + fn(r), 0) / group.length;
    return { horizon, method, count: group.length, maeTrillion: mean(r => Math.abs(r.error)), biasTrillion: mean(r => r.error),
      rmseTrillion: Math.sqrt(mean(r => r.error ** 2)), mapePercent: mean(r => Math.abs(r.errorPercent)) };
  }));
  return { cases, summaries };
}
