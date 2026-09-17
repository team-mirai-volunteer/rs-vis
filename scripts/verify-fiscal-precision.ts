import { writeFileSync } from 'node:fs';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';
import { initialEconomy, NO_SHOCK } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { estimateFiscalSpace } from '../app/lib/fiscal-space/search';

// Diagnostic scenarios, not an empirical validation or probability distribution.
const form = defaults();
Object.assign(form.amounts, { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 });
const result = createFiscalEngine()(form);
const mix = result.policies.map(policy => ({ policy, weight: policy.annualCost }));
const summary = (e: ReturnType<typeof estimateFiscalSpace>) => ({
  trillionPerYear: e.theoreticalMaximum / 1e12, status: e.status,
  binding: e.constraints.filter(c => c.status === 'violated').map(c => ({ id: c.id, year: c.year })),
});
const cpi = [.02, .025, .03, .035].map(inflation => ({ inflation,
  ...summary(estimateFiscalSpace(result.initial, mix, { ...form.thresholds, inflation }, result.horizon, result.p)),
}));
const searchResolution = [1, .1].map(step => ({ stepTrillion: step,
  ...summary(estimateFiscalSpace(result.initial, mix, form.thresholds, 5, { ...result.p, searchStep: step * 1e12 })),
}));
const noPolicy = (['2024', 'latest'] as const).flatMap(dataset => [1, 1.1, 1.3, 1.7].map(taxRevenueElasticity => {
  const initial = initialEconomy(dataset);
  const path = simulate(initial, [], 15, { ...result.p, taxRevenueElasticity }, NO_SHOCK);
  return { dataset, taxRevenueElasticity, initialDebtGdp: initial.fiscal.grossDebt / initial.macro.nominalGdp,
    years: [5, 15].map(year => { const s = path.steps[year - 1]; return {
      year, debtGdp: s.metrics.grossDebtGdp, revenueTrillion: s.state.fiscal.taxRevenue / 1e12,
      primaryBalanceTrillion: s.state.fiscal.primaryBalance / 1e12,
      labourForce: s.state.labour.labourForce, employment: s.state.labour.employment,
    }; }),
  };
}));
const output = { modelVersion: FISCAL_MODEL_VERSION, form,
  estimate: summary(result.estimate), reserveRule: result.estimate.reserveRule,
  stress: 'stress' in result.estimate ? result.estimate.stress : null,
  baselineSensitivity: result.riskAudit.baselineSensitivity,
  taxElasticitySensitivity: result.taxElasticitySensitivity,
  resourceSensitivity: result.resourceSensitivity.map(r => ({ loadScale: r.loadScale, ...summary(r.space) })),
  modelSensitivity: result.modelSensitivity.map(r => ({ model: r.label, ...summary(r.space) })),
  cpi, searchResolution, noPolicy,
};
writeFileSync('docs/fiscal-space-precision-verification-20260917.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ ...output, form: undefined }, null, 2));
