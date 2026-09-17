import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS, POLICIES, NO_SHOCK } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';

const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('annual CPI contributions reconcile through VAT expiry, energy shocks and all gap paths', () => {
  const policies = [{ ...POLICIES.find(p => p.id === 'consumption-tax')!, annualCost: 3.5e12, kind: 'temporary' as const, duration: 1 },
    { ...POLICIES.find(p => p.id === 'public-investment')!, annualCost: 10e12 }];
  for (const gapClosureYears of [0, 3, 5, 10]) for (const energyPriceChange of [0, .2]) {
    const path = simulate(initialEconomy('latest'), policies, 15, PARAMETERS, { ...NO_SHOCK, energyPriceChange }, { gapClosureYears });
    let index = 1;
    for (const step of path.steps) {
      const diagnostics = step.cpiDiagnostics!;
      near(Object.values(diagnostics.contributions).reduce((a, b) => a + b, 0), step.state.macro.inflation);
      index *= 1 + step.state.macro.inflation;
      near(diagnostics.priceIndex, index);
    }
    assert(path.steps[0].cpiDiagnostics!.contributions.directTaxPrices < 0);
    assert(path.steps[1].cpiDiagnostics!.contributions.directTaxPrices > 0);
  }
});

test('diagnostic zero preserves defaults and closing either sign changes GDP consistently', () => {
  for (const gap of [-.02, 0, .007]) {
    const initial = initialEconomy('latest');
    initial.macro.potentialGdp = initial.macro.realGdp / (1 + gap);
    const base = simulate(initial, [], 15);
    assert.deepEqual(base, simulate(initial, [], 15, PARAMETERS, NO_SHOCK, { gapClosureYears: 0 }));
    const close = simulate(initial, [], 15, PARAMETERS, NO_SHOCK, { gapClosureYears: 5 });
    close.steps.forEach((s, i) => {
      near(s.cpiDiagnostics!.baselineGap, gap * Math.max(0, 1 - (i + 1) / 5));
      near(s.state.macro.realGdp / s.state.macro.potentialGdp - 1, s.cpiDiagnostics!.baselineGap);
      near(base.steps[i].cpiDiagnostics!.baselineGap, gap);
    });
  }
  for (const gapClosureYears of [-1, .5, NaN, Infinity, 101]) {
    assert.throws(() => simulate(initialEconomy(), [], 15, PARAMETERS, NO_SHOCK, { gapClosureYears }), RangeError);
  }
});
