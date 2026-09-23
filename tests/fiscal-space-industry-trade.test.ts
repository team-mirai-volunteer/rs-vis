import test from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRY_TRADE_REFERENCE as io, PROJECT_IMPORT_REFERENCE, RESEARCH_CASE, SEMICONDUCTOR_CASE, industryTrade, industryImportBreakEven, powerCase, powerTrade } from '../app/lib/fiscal-space/policy-trade';
import { SUPPLY_CASES, supplyResponse } from '../app/lib/fiscal-space/supply';
import { projectResponse, projectNetOutput } from '../app/lib/fiscal-space/project-response';
import { initialEconomy, PARAMETERS, POLICIES, TRILLION, NO_SHOCK, THRESHOLDS } from '../app/lib/fiscal-space/assumptions';
import { compareNextTrillion } from '../app/lib/fiscal-space/compare';
import { simulate } from '../app/lib/fiscal-space/simulate';
import type { Policy } from '../types/fiscal-space';
import { defaults } from '../client/lib/fiscal-space-form';
import { decodeScenario } from '../client/lib/fiscal-space-url';

const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const policy: Policy = { ...POLICIES.find(p => p.id === 'semiconductors')!, annualCost: TRILLION, duration: 1,
  trade: { kind: 'industry', assumptions: SEMICONDUCTOR_CASE } };

test('provisional project defaults give complete flows while explicit blanks survive sharing', () => {
  const form = defaults();
  near(PROJECT_IMPORT_REFERENCE.capexImportShare, PROJECT_IMPORT_REFERENCE.directImportShare + PROJECT_IMPORT_REFERENCE.upstreamImportShare);
  assert(PROJECT_IMPORT_REFERENCE.capexImportShare > .17 && PROJECT_IMPORT_REFERENCE.capexImportShare < .18);
  for (const id of ['semiconductors', 'rd']) {
    for (const year of [1, 5, 20]) {
      const row = industryTrade(policy, year, form.trade.industry[id]);
      assert(Object.values(row).every(value => value !== null && Number.isFinite(value)));
    }
    form.trade.industry[id].capexImportShare = null;
    form.trade.industry[id].annualSalesPerInvestment = null;
  }
  for (const technology of ['solar', 'nuclear', 'hydro'] as const) {
    for (const year of [1, 5, 20]) {
      assert(Object.values(powerTrade(policy, year, powerCase(technology))).every(value => value !== null && Number.isFinite(value)));
    }
  }
  form.trade.power.capexImportShare = null;
  const restored = decodeScenario('#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-16.2', form })));
  assert.deepEqual(restored.trade, form.trade);
});

test('research sales proxy preserves the reference net yield without adding knowledge supply twice', () => {
  const initial = initialEconomy();
  const research: Policy = { ...POLICIES.find(p => p.id === 'rd')!, annualCost: TRILLION, kind: 'temporary', duration: 1,
    supply: { ...SUPPLY_CASES.rd.settings }, trade: { kind: 'industry', assumptions: { ...RESEARCH_CASE } } };
  near(projectNetOutput(projectResponse(initial, research, 3, PARAMETERS)), 0);
  for (const year of [4, 5, 10]) {
    near(projectNetOutput(projectResponse(initial, research, year, PARAMETERS)), supplyResponse(initial, { ...research, trade: undefined }, year, PARAMETERS));
    assert.equal(supplyResponse(initial, research, year, PARAMETERS), 0);
  }
});

test('IO benchmark uses domestic production and excludes import taxes from foreign payments', () => {
  near(io.exportShare, 3713.3 / 5369.6);
  near(io.domesticReplacementShare, 2457.6 / (5369.6 - 3713.3 + 2457.6));
  assert(io.directOperatingImportShare > .13 && io.directOperatingImportShare < .14);
  assert(io.operatingImportShare > .19 && io.operatingImportShare < .20);
  assert(io.operatingImportShare > io.directOperatingImportShare, 'upstream imports must be included');
});

test('previous shared scenarios retain the user trade assumptions', () => {
  const form = defaults();
  Object.assign(form.trade.industry.semiconductors, { exportShare: .5, domesticReplacementShare: .5, operatingImportShare: .25 });
  const restored = decodeScenario('#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-16.2', form })));
  assert.deepEqual(restored.trade.industry.semiconductors, form.trade.industry.semiconductors);
});

test('operating import sign depends on replacement, with no payoff before commissioning', () => {
  assert.equal(industryTrade(policy, 3, SEMICONDUCTOR_CASE).substitution, 0);
  const threshold = industryImportBreakEven(SEMICONDUCTOR_CASE)!;
  assert(threshold > .62 && threshold < .63);
  const balanced = industryTrade(policy, 4, { ...SEMICONDUCTOR_CASE, domesticReplacementShare: threshold });
  near(balanced.operatingImports!, balanced.substitution!);
  const full = industryTrade(policy, 4, { ...SEMICONDUCTOR_CASE, domesticReplacementShare: 1 });
  assert(full.substitution! > full.operatingImports!);
  assert.equal(industryImportBreakEven({ ...SEMICONDUCTOR_CASE, exportShare: 1 }), null);
});

test('comparison decomposes nominal imports and recomputes replacement scenarios', () => {
  const initial = initialEconomy();
  const row = compareNextTrillion(initial, [], PARAMETERS, NO_SHOCK, THRESHOLDS, [policy])[0];
  const base = simulate(initial, [], 5, PARAMETERS);
  for (const period of row.periods) {
    const d = period.industryImports!;
    near(period.imports, d.operating - d.substitution + d.other);
    if (period.year < 4) { near(d.operating, 0); near(d.substitution, 0); near(d.noReplacement, d.fullReplacement); }
    for (const replacement of [0, 1]) {
      const result = simulate(initial, [{ ...policy, trade: { kind: 'industry', assumptions: { ...SEMICONDUCTOR_CASE, domesticReplacementShare: replacement } } }], 5, PARAMETERS);
      near(replacement ? d.fullReplacement : d.noReplacement, result.steps[period.year - 1].state.external.imports - base.steps[period.year - 1].state.external.imports);
    }
  }
  assert(row.periods[2].industryImports!.fullReplacement < row.periods[2].industryImports!.noReplacement);
});
