import test from 'node:test';
import assert from 'node:assert/strict';
import { loadQualityScores } from '../app/lib/api/quality-scores-loader';
import { loadPolicyEvaluations } from '../app/lib/api/policy-evaluations-loader';
import { priorBudgetHistory } from '../app/lib/api/prior-budget-history';
import { buildPolicyEvaluations } from '../app/lib/policy-evaluation';
import { recomputeValues, applyFilter, toViewGraph, toRsMinistryGraph } from '../app/lib/unified-budget/transform';
import { computeMOFSankeyLayout } from '../app/lib/mof-sankey-layout';
import { UNIFIED_FILTER_DEFAULT } from '../types/unified-budget-view';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { decodeScenario } from '../client/lib/fiscal-space-url';
import { lifecycleSeries } from '../app/lib/tax-burden/simulate-lifecycle';
import { initialTaxState } from '../app/lib/tax-burden/households';
import parameters from '../scripts/data/tax-burden-params-2025.json';
import type { TaxParameters } from '../types/tax-burden';

const data = (file: string) => JSON.parse(gunzipSync(readFileSync(new URL(`../public/data/${file}.json.gz`, import.meta.url))).toString());

test('PID 179 excludes next-year carryover in current and prior-year decisions', () => {
  const item = loadQualityScores('2025').items.find(i => i.pid === '179')!;
  const evaluation = loadPolicyEvaluations('2025').get('179')!;
  assert(Math.abs(item.carryoverToNext! / 1e8 - 30.31) < .01);
  assert(Math.abs(evaluation.unusedAmount! / 1e8 - 2.25) < .01);
  assert(Math.abs(evaluation.unusedRatio! - .0265) < .001);
  assert.notEqual(evaluation.recommendation, '縮小');
  const prior = loadQualityScores('2024').items.find(i => i.pid === '179')!;
  assert.equal(evaluation.priorUnusedRatio, Math.max(0, prior.budgetAmount - prior.execAmount! - prior.carryoverToNext!) / prior.budgetAmount);
  assert.equal(evaluation.priorUnusedRatio, priorBudgetHistory('2025').priorUnusedRatios['179']);
  const missing = buildPolicyEvaluations([{ pid: 'missing', budgetAmount: 100, execAmount: 50, priorExecutionRate: .5 }])[0];
  assert.equal(missing.unusedAmount, null);
  assert.equal(missing.priorUnusedRatio, null);
});

test('PID 1503 budget survives repeated recomputation and the 1-billion-yen filter', () => {
  const graph = data('unified-budget-2024-initial-graph');
  const original = toViewGraph(graph);
  const view = recomputeValues(recomputeValues(original));
  const program = view.nodes.find(n => n.details.column === 'program' && n.details.projectId === 1503)!;
  assert(Math.abs(program.value / 1e8 - 5.08) < .01);
  assert(program.layoutValue! > 2000e8);
  assert(view.nodes.some(n => n.id === program.id));
  const filtered = applyFilter(view, { ...UNIFIED_FILTER_DEFAULT, budgetMax: '10億', includeCollapsedAccounts: true });
  assert.equal(filtered.nodes.find(n => n.id === program.id)?.value, program.value);
  assert.equal(original.nodes.find(n => n.id === program.id)?.value, program.value, 'source graph is immutable');
  const ministry = toRsMinistryGraph(original).nodes.find(n => n.id === program.id)!;
  assert.equal(ministry.value, program.details.rsCurrentBudget, 'RS view retains its different current-budget basis');
  const tiny = recomputeValues({ nodes: [program, { id: 'spent', name: 'spent', type: 'program-spending', value: program.layoutValue!, details: { column: 'program-spending' } }],
    links: [{ source: program.id, target: 'spent', value: program.layoutValue! }] });
  const layout = computeMOFSankeyLayout(tiny, { width: 1000, height: 500, margin: { top: 10, right: 10, bottom: 10, left: 10 }, nodeWidth: 20, nodePadding: 10 });
  assert.equal(layout.nodes[0].value, program.value);
  assert(layout.nodes[0].height >= layout.links[0].width, 'spending fits within drawing capacity');
  assert.equal(recomputeValues({ nodes: [program], links: [] }).nodes.length, 0, 'filtering all flows still prunes disconnected budgets');
});

test('corporate incidence changes estimated burden but not fixed-salary cash disposable income', () => {
  const incidence = data('tax-burden-incidence');
  const state = { ...initialTaxState(), income: 5e6, household: 'one-earner-children' as const };
  const at40 = (share: number) => lifecycleSeries({ ...state, corporateShare: share }, parameters as unknown as TaxParameters, undefined, undefined, incidence).find(y => y.ageAt === 40)!;
  const zero = at40(0), quarter = at40(.25);
  assert.equal(quarter.income, zero.income);
  assert.equal(quarter.disposable, zero.disposable);
  assert.equal(quarter.disposable, quarter.income - quarter.incomeTax - quarter.residentTax - quarter.pension - quarter.health - quarter.care - quarter.employment + quarter.benefits);
  assert.equal(quarter.netBurden - zero.netBurden, quarter.corporateTax);
  assert(quarter.corporateTax > 0);
});

test('old manual links stop exploration and historical year zero does not force zero', () => {
  const form = defaults('2024');
  Object.assign(form.amounts, { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 });
  const calculate = createFiscalEngine();
  const evaluated = calculate(form);
  assert(Math.abs(evaluated.initial.macro.inflation - .027) < 1e-12);
  assert(evaluated.estimate.theoreticalMaximum > 0);
  assert(evaluated.estimate.constraints.every(c => c.year > 0));
  const old = structuredClone(form) as Partial<typeof form>;
  delete old.resource;
  const decoded = decodeScenario('#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-15.2', form: old })));
  const unknown = calculate(decoded);
  assert.equal(unknown.estimate.status, 'unevaluated');
  assert.equal(unknown.estimate.theoreticalMaximum, 0);
  assert(unknown.estimate.constraints.some(c => c.coverageComplete === false));
  const amounts = evaluated.riskAudit.baselineSensitivity.filter(r => [ .015, .02, .025 ].includes(r.inflation)).map(r => r.amount);
  assert(amounts[0] > amounts[1] && amounts[1] > amounts[2]);
});
