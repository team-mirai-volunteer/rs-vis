import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../client/lib/fiscal-space-form';
import { OBJECTIVE_IDS, objectiveScore, optimizationDefaults, type ObjectiveId, type ObjectiveValues } from '../client/lib/fiscal-objective';
import { createOptimizationEvaluator, optimizeFiscalPolicy, projectionObjectiveValues, projectionObjectiveScore } from '../client/lib/fiscal-optimizer';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { decodeScenario, decodeScenarioDetailed, encodeScenario } from '../client/lib/fiscal-space-url';
import { policyInputLimitYen } from '../client/lib/fiscal-space-amounts';

const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function only(form: ReturnType<typeof defaults>, metric: ObjectiveId, policies: string[]) {
  for (const id of OBJECTIVE_IDS) form.optimization.objectives[id].weight = id === metric ? 1 : 0;
  for (const id of Object.keys(form.optimization.eligible)) form.optimization.eligible[id] = policies.includes(id);
}

test('objective units, directions, targets, zero weights and missing values are explicit', () => {
  const settings = optimizationDefaults();
  const base = Object.fromEntries(OBJECTIVE_IDS.map(id => [id, 10])) as ObjectiveValues;
  for (const id of OBJECTIVE_IDS) settings.objectives[id].weight = 0;
  settings.objectives.gdp.weight = 2;
  settings.objectives.gdp.scale = 2;
  settings.objectives.poverty.weight = 1;
  const next = { ...base, gdp: 14, poverty: 9, fertility: null };
  near(objectiveScore(next, base, settings).score!, 5 / 3);
  near(objectiveScore(base, base, settings).score!, 0);
  settings.objectives.gdp.weight *= 4; settings.objectives.poverty.weight *= 4;
  near(objectiveScore(next, base, settings).score!, 5 / 3);
  settings.objectives.gdp.direction = 'target'; settings.objectives.gdp.target = 12;
  near(objectiveScore(next, base, settings).contributions.gdp!, 0);
  settings.objectives.fertility.weight = 1;
  assert.equal(objectiveScore(next, base, settings).score, null);
});

test('optimization preferences round-trip and legacy links receive explicit defaults', () => {
  const form = defaults();
  form.optimization.minBudget = 2; form.optimization.maxBudget = 8;
  form.optimization.objectives.cpi.target = 1.5;
  form.optimization.objectives.poverty.weight = 4;
  form.optimization.objectives.burden.weight = 12;
  form.optimization.objectives.childPoverty.weight = 18;
  form.optimization.objectives.disposableIncome.weight = 13;
  form.optimization.eligible.defence = false;
  assert.deepEqual(decodeScenario(encodeScenario(form)), form);
  const payload = JSON.parse(decodeURIComponent(encodeScenario(form).slice(10)));
  delete payload.form.optimization;
  const old = decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify(payload)));
  assert.deepEqual(old.form.optimization, optimizationDefaults());
  assert(old.filled.some(x => x.startsWith('optimization')));
  const previous = JSON.parse(decodeURIComponent(encodeScenario(form).slice(10)));
  delete previous.form.optimization.objectives.burden;
  delete previous.form.optimization.objectives.childPoverty;
  delete previous.form.optimization.objectives.disposableIncome;
  previous.form.optimization.objectives.exports.weight = 1;
  previous.form.optimization.objectives.imports.weight = 2;
  const restored = decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify(previous)));
  assert.equal(restored.form.optimization.objectives.burden.weight, 0);
  assert.deepEqual(restored.form.optimization.objectives.poverty, form.optimization.objectives.poverty);
  assert(restored.filled.some(x => x.includes('burden')));
  for (const id of ['childPoverty', 'disposableIncome'] as const) {
    assert.equal(restored.form.optimization.objectives[id].weight, 0);
    assert(restored.filled.some(x => x.includes(id)));
  }
  assert.equal(restored.form.optimization.objectives.exports.weight, 1);
  assert.equal(restored.form.optimization.objectives.imports.weight, 2);
  form.optimization.objectives.gdp.scale = 0;
  assert.throws(() => decodeScenario(encodeScenario(form)));
  form.optimization.objectives.gdp.scale = 1;
  form.optimization.minBudget = 9;
  assert.throws(() => decodeScenario(encodeScenario(form)));
});

test('candidate metrics match the displayed simulation and target deviations do not cancel across years', () => {
  const form = defaults();
  form.amounts.childcare = 1; form.amounts['social-insurance'] = 2;
  const result = createFiscalEngine()(form);
  const evaluator = createOptimizationEvaluator(form);
  const candidate = evaluator.evaluate(form.amounts);
  assert.deepEqual(candidate.values, projectionObjectiveValues(result.projection, result.poverty, form.optimization));
  near(candidate.values.poverty!, result.poverty.rows.reduce((s, x) => s + x.all * 100, 0) / 5);
  near(candidate.values.childPoverty!, result.poverty.rows.reduce((s, x) => s + x.child * 100, 0) / 5);
  near(candidate.values.disposableIncome!, result.poverty.rows.reduce((s, x) => s + x.medianDisposableIncome / 1e4, 0) / 5);
  near(candidate.values.burden!, result.projection.steps.reduce((sum, s) => sum + s.state.fiscal.taxRevenue / s.state.macro.nominalGdp * 100, 0) / 5);
  only(form, 'burden', ['social-insurance']);
  const burden = createOptimizationEvaluator(form);
  const burdenCandidate = burden.evaluate(form.amounts);
  assert(burdenCandidate.values.burden! < burden.baseline.burden!);
  assert(burdenCandidate.contributions.burden! > 0);
  const modified = structuredClone(result.projection), baseline = structuredClone(result.baseline);
  modified.steps = modified.steps.slice(0, 2); baseline.steps = baseline.steps.slice(0, 2);
  modified.steps[0].state.macro.inflation = .01; modified.steps[1].state.macro.inflation = .03;
  baseline.steps.forEach(s => { s.state.macro.inflation = .02; });
  only(form, 'cpi', ['childcare']);
  form.optimization.objectives.cpi.direction = 'target';
  near(projectionObjectiveScore(modified, result.poverty, baseline, result.poverty, form.optimization).score!, -1);
  form.optimization.aggregation = 'terminal';
  const terminal = createOptimizationEvaluator(form).evaluate(form.amounts);
  near(terminal.values.gdp!, result.projection.steps[4].state.macro.realGdp / 1e12);
  near(terminal.values.childPoverty!, result.poverty.rows[4].child * 100);
  near(terminal.values.disposableIncome!, result.poverty.rows[4].medianDisposableIncome / 1e4);
});

test('household objectives reward improvement and independently drive a policy search', () => {
  const settings = optimizationDefaults();
  assert.equal(settings.objectives.exports.weight, 5);
  assert.equal(settings.objectives.imports.weight, 5);
  assert.equal(settings.objectives.childPoverty.weight, 15);
  assert.equal(settings.objectives.disposableIncome.weight, 15);
  const base = Object.fromEntries(OBJECTIVE_IDS.map(id => [id, 10])) as ObjectiveValues;
  const improved = objectiveScore({ ...base, childPoverty: 9, disposableIncome: 20 }, base, settings);
  assert(improved.contributions.childPoverty! > 0);
  near(improved.contributions.childPoverty!, improved.contributions.disposableIncome!);
  const worse = objectiveScore({ ...base, childPoverty: 11, disposableIncome: 0 }, base, settings);
  near(worse.score!, -improved.score!);
  for (const id of ['childPoverty', 'disposableIncome'] as const) {
    const form = defaults();
    form.optimization.maxBudget = 1;
    only(form, id, ['childcare', 'cash']);
    const result = optimizeFiscalPolicy(form, undefined, 100);
    assert(result.best && result.best.score! > 0);
    assert(result.best.contributions[id]! > 0);
    const evaluator = createOptimizationEvaluator(form);
    near(evaluator.evaluate(result.best.amounts).score!, result.best.score!);
  }
});

test('search respects fixed policies, budget and revenue caps and can change total and allocation', () => {
  const form = defaults();
  form.optimization.minBudget = 1; form.optimization.maxBudget = 2;
  form.amounts.healthcare = .2;
  only(form, 'gdp', ['childcare', 'social-insurance']);
  const a = optimizeFiscalPolicy(form, undefined, 180);
  assert(a.best && a.best.feasible);
  assert(a.best.total >= 1 - 1e-8 && a.best.total <= 2 + 1e-8);
  assert.equal(a.best.amounts.healthcare, .2);
  for (const [id, amount] of Object.entries(a.best.amounts)) assert(amount * 1e12 <= policyInputLimitYen(id, form.calibration) + 1);
  assert.deepEqual(optimizeFiscalPolicy(form, undefined, 180), a);
  assert(createOptimizationEvaluator(form).evaluate(a.best.amounts).feasible);
  form.optimization.minBudget = form.optimization.maxBudget = 1;
  const fixed = optimizeFiscalPolicy(form, undefined, 100);
  assert(fixed.best); near(fixed.best.total, 1);
});

test('poverty preference finds a different allocation from real GDP preference', () => {
  const form = defaults();
  form.poverty.cashTarget = 'income-tapered';
  form.optimization.maxBudget = 2;
  only(form, 'poverty', ['cash', 'semiconductors']);
  const poverty = optimizeFiscalPolicy(form, undefined, 130);
  assert(poverty.best && poverty.best.amounts.cash > 0);
  only(form, 'gdp', ['cash', 'semiconductors']);
  const gdp = optimizeFiscalPolicy(form, undefined, 130);
  assert(gdp.best);
  assert.notDeepEqual(poverty.best.amounts, gdp.best.amounts);
});

test('unmet constraints, missing data and invalid preferences cannot be applied as successful results', () => {
  const form = defaults();
  form.optimization.maxBudget = .2;
  only(form, 'gdp', ['cash']);
  form.thresholds.inflation = .005;
  assert.equal(optimizeFiscalPolicy(form, undefined, 20).best, null);
  form.thresholds.inflation = .025; form.resource.mode = 'manual';
  form.amounts.cash = .1;
  assert.equal(createOptimizationEvaluator(form).evaluate(form.amounts).feasible, false);
  form.resource.mode = 'estimated'; form.optimization.objectives.gdp.weight = 0;
  assert.throws(() => optimizeFiscalPolicy(form), /重み/);
  form.optimization.objectives.fertility.weight = 1; form.calibration.demographics.mode = 'off';
  assert.throws(() => optimizeFiscalPolicy(form), /未推計/);
  form.optimization.eligible.cash = false;
  form.optimization.eligible.childcare = true;
  form.optimization.maxBudget = 0;
  form.optimization.objectives.fertility.weight = 0; form.optimization.objectives.gdp.weight = 1;
  assert.throws(() => optimizeFiscalPolicy(form), /固定/);
});

test('selected stress tests tighten feasibility without silently changing the objective', () => {
  const form = defaults();
  form.thresholds.inflation = .022;
  const plain = createOptimizationEvaluator(form).evaluate(form.amounts);
  form.stresses.importPrice = true;
  const stressed = createOptimizationEvaluator(form).evaluate(form.amounts);
  assert.equal(plain.feasible, true);
  assert.equal(stressed.feasible, false);
  assert(stressed.violations.some(x => x.includes('輸入物価')));
  assert.deepEqual(stressed.values, plain.values);
});
