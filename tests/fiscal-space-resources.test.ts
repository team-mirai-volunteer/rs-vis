import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_DEFAULTS, RESOURCE_REFERENCE, RESOURCE_SECTORS, estimatePolicyLoad, resourcePowerBalance, resourceRecords } from '../app/lib/fiscal-space/resource-estimate';
import { initialEconomy, PARAMETERS, POLICIES } from '../app/lib/fiscal-space/assumptions';
import { policyLoads } from '../app/lib/fiscal-space/policy-load';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { defaults } from '../client/lib/fiscal-space-form';
import { decodeScenario, encodeScenario } from '../client/lib/fiscal-space-url';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { powerCase, policyTradeRecords } from '../app/lib/fiscal-space/policy-trade';
import { configuredPower } from '../client/lib/fiscal-space-trade';

const initial = initialEconomy('latest');
const publicInvestment = { ...POLICIES.find(p => p.id === 'public-investment')!, annualCost: 1e12 };
const close = (a: number, b: number) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('default generation investment adds firm supply after commissioning and relieves regional power constraints', () => {
  for (const mode of ['estimated', 'manual'] as const) {
    const resource = { ...RESOURCE_DEFAULTS, mode };
    const parameters = { ...PARAMETERS, resourceModel: resource };
    const baseline = simulate(initial, [], 12, parameters);
    for (const technology of ['solar', 'nuclear', 'hydro'] as const) {
      const assumptions = powerCase(technology);
      const policy = { ...POLICIES.find(p => p.id === 'generation')!, annualCost: 1e12, duration: 1,
        trade: { kind: 'power' as const, assumptions } };
      const investment = { ...policy, load: estimatePolicyLoad(policy, initial, resource) };
      const path = simulate(initial, [investment], 12, parameters);
      close(path.steps[assumptions.lag - 1].state.energy.firmCapacity, baseline.steps[assumptions.lag - 1].state.energy.firmCapacity);
      const commissioned = path.steps[assumptions.lag], base = baseline.steps[assumptions.lag];
      assert(commissioned.state.energy.firmCapacity > base.state.energy.firmCapacity, `${mode}/${technology}`);
      assert(commissioned.state.energy.reserveMargin > base.state.energy.reserveMargin);
      if (mode === 'estimated') {
        assert(path.steps[0].resourcePower!.utilization > baseline.steps[0].resourcePower!.utilization, 'construction uses electricity before commissioning');
        assert(commissioned.resourcePower!.utilization < base.resourcePower!.utilization);
      }
      for (const firmShare of [0, null]) {
        const withoutFirm = simulate(initial, [{ ...investment, trade: { kind: 'power', assumptions: { ...assumptions, firmShare } } }], 12, parameters);
        close(withoutFirm.steps[assumptions.lag].state.energy.firmCapacity, base.state.energy.firmCapacity);
      }
      const record = policyTradeRecords({ industry: {}, power: assumptions }).find(r => r.key === 'policyTrade.power.firmShare')!;
      assert.equal(record.status, 'assumption'); assert.equal(record.sourceUrl, null);
    }
  }
});

test('form defaults and mixed generation retain commissioned supply including after spending ends', () => {
  const f = defaults();
  f.trade.mix = { solar: .5, nuclear: .5, hydro: 0 };
  const assumptions = configuredPower(f.trade);
  const p = { ...PARAMETERS, resourceModel: f.resource };
  const policy = { ...POLICIES.find(p => p.id === 'generation')!, annualCost: 1e12, duration: 1,
    trade: { kind: 'power' as const, assumptions } };
  const baseline = simulate(initial, [], 11, p), mix = simulate(initial, [policy], 11, p);
  const solar = simulate(initial, [{ ...policy, annualCost: .5e12, trade: { kind: 'power', assumptions: powerCase('solar') } }], 11, p);
  close(mix.steps[2].state.energy.firmCapacity, solar.steps[2].state.energy.firmCapacity);
  assert(mix.steps[2].state.energy.firmCapacity > baseline.steps[2].state.energy.firmCapacity);
  assert(mix.steps[10].state.energy.firmCapacity > solar.steps[10].state.energy.firmCapacity);
  f.trade.power.firmShare = null;
  assert.equal(decodeScenario(encodeScenario(f)).trade.power.firmShare, null, 'saved unknowns stay unknown');
});

test('official IO units and employment aggregation pin direct and upstream loads', () => {
  assert.equal(Object.values(RESOURCE_REFERENCE.sectorWorkers).reduce((a, b) => a + b, 0), 68_707_839);
  const c = { ...RESOURCE_DEFAULTS, priceIndex: 1 };
  const load = estimatePolicyLoad(publicInvestment, initial, c)!;
  // Independent reference amounts: people per 2020-price trillion, not billion.
  close(load.workerYears!.construction, 55_107.172176);
  close(load.workerYears!.general, 52_256.593379);
  close(load.peakGwPerTrillion!, 16_883_803_714.03 / 20 / 8760 / 1e6 / .6);
  const one = policyLoads(initial, [{ ...publicInvestment, load }], 1, PARAMETERS);
  const two = policyLoads(initial, [{ ...publicInvestment, annualCost: 2e12, load }], 1, PARAMETERS);
  assert(one.sectorDemand.general > 0 && one.sectorDemand.construction > 0);
  for (const s of RESOURCE_SECTORS) close(two.sectorDemand[s], one.sectorDemand[s] * 2);
  close(two.peakGw, one.peakGw * 2);
  const expensive = policyLoads(initial, [{ ...publicInvestment, load: { ...load, priceIndex: 2 } }], 1, PARAMETERS);
  close(expensive.peakGw, one.peakGw / 2);
  close(expensive.sectorDemand.general, one.sectorDemand.general / 2);
  assert.throws(() => policyLoads(initial, [{ ...publicInvestment, load: { ...load, priceIndex: 0 } }], 1, PARAMETERS));
  const record = resourceRecords(c, [{ ...publicInvestment, load }]).find(r => r.key === 'resourceLoads.public-investment.workers.construction')!;
  assert.equal(record.unit, '人/2020年価格1兆円'); assert.equal(record.status, 'derived');
});

test('OCCTO regional seasons remain separate; extra load and supply conserve national GW', () => {
  const base = resourcePowerBalance(0, 0, 0, RESOURCE_DEFAULTS);
  const tokyo = base.rows.find(r => r.region === '東京')!;
  assert.equal(tokyo.demandGw, 55.01); assert.equal(tokyo.supplyGw, 63.3);
  assert.equal(base.rows.length, 13);
  close(base.nationalDemandGw, base.rows.filter(r => r.season !== '1月').reduce((s, r) => s + r.demandGw, 0));
  assert.equal(base.rows.find(r => r.region === '沖縄')!.season, '最小予備率断面');
  assert.equal(resourcePowerBalance(2, 0, 0, RESOURCE_DEFAULTS).rows.find(r => r.region === '沖縄')!.season, '8月');
  const added = resourcePowerBalance(0, 1, 2, RESOURCE_DEFAULTS);
  close(added.nationalDemandGw - base.nationalDemandGw, 1);
  close(added.nationalSupplyGw - base.nationalSupplyGw, 2);
  const concentrated = resourcePowerBalance(0, 10, 0, { ...RESOURCE_DEFAULTS, region: '沖縄' });
  assert.equal(concentrated.region, '沖縄'); assert(concentrated.utilization > 1);
  close(concentrated.rows.find(r => r.region === '東京')!.demandGw, tokyo.demandGw);
  assert.equal(resourcePowerBalance(5, 0, 0, RESOURCE_DEFAULTS).referenceYear, 2031);
  assert.notEqual(resourcePowerBalance(5, 0, 0, RESOURCE_DEFAULTS).nationalDemandGw, base.nationalDemandGw);
});

test('estimated industry loads bind the search and load uncertainty changes the bound', () => {
  const f = defaults(); f.amounts.rd = 3;
  const r = createFiscalEngine()(f);
  assert(r.constraints.filter(c => ['sector', 'energy'].includes(c.id)).every(c => c.coverageComplete));
  assert(r.sensitivity.find(c => c.id === 'sector')!.delta! > 0);
  assert(r.projection.steps[0].resourcePower!.nationalDemandGw > r.baseline.steps[0].resourcePower!.nationalDemandGw);
  // The period's peak may occur after temporary spending ends, hiding this extra load in the peak difference.
  const bounds = r.resourceSensitivity.map(v => v.space.recommendedEnvelope / 1e12);
  // Pre-stress search amounts (the former 20% haircut is gone).
  assert(Math.abs(bounds[0] - 13.359375) < .005);
  assert(Math.abs(bounds[1] - 6.6796875) < .005);
  assert(Math.abs(bounds[2] - 4.453125) < .005);
  assert(r.resourceSensitivity.every(v => v.space.constraints.some(c => c.id === 'sector' && c.status === 'violated')));
});

test('manual partial overrides stay unknown and physical estimates do not add GDP multipliers', () => {
  const calculate = createFiscalEngine(), f = defaults(); f.amounts.rd = 1;
  const auto = calculate(f);
  f.loads.rd = { sectorUtilizationPerTrillion: 0, peakGwPerTrillion: null, operatingPeakGwPerTrillion: null, lag: 2, lifetime: 20, depreciation: .03 };
  const partial = calculate(f);
  assert.equal(partial.constraints.find(c => c.id === 'sector')!.coverageComplete, true);
  assert.equal(partial.constraints.find(c => c.id === 'energy')!.coverageComplete, false);
  assert.equal(partial.allocated[0].load!.estimated, undefined);
  assert.deepEqual(auto.projection.steps.map(s => s.state.macro.realGdp), partial.projection.steps.map(s => s.state.macro.realGdp));
  f.resource.mode = 'manual'; delete f.loads.rd;
  const manual = calculate(f);
  assert.equal(manual.resourceSensitivity.length, 0);
  assert.equal(manual.projection.initial.resourcePower, undefined);
  assert.equal(manual.constraints.find(c => c.id === 'sector')!.coverageComplete, false);
});

test('shared estimates validate ranges and old URLs retain the manual interpretation', () => {
  const f = defaults(); f.resource.region = '東京'; f.resource.loadScale = 1.5;
  assert.deepEqual(decodeScenario(encodeScenario(f)), f);
  for (const change of [{ priceIndex: 0 }, { electricityPrice: -1 }, { loadScale: 4 }, { coincidence: 2 }]) {
    assert.throws(() => encodeScenario({ ...f, resource: { ...f.resource, ...change } }));
  }
  const { resource: _resource, ...old } = defaults();
  const restored = decodeScenario('#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-15.6', form: old })));
  assert.equal(restored.resource.mode, 'manual');
  f.loads['public-investment'] = estimatePolicyLoad(publicInvestment, initial, RESOURCE_DEFAULTS)!;
  assert.throws(() => encodeScenario(f), 'shared URLs cannot inject generated coefficients');
});

test('changing common peak growth scales the public regional demand path', () => {
  const f = defaults(), calculate = createFiscalEngine();
  const normal = calculate(f);
  f.calibration.electricity.peakGrowth = .02;
  const high = calculate(f);
  const ratio = ((1.02) / 1.004) ** 5;
  close(high.baseline.steps[4].resourcePower!.nationalDemandGw, normal.baseline.steps[4].resourcePower!.nationalDemandGw * ratio);
});
