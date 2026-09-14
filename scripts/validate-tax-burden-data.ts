import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readDataJson } from '@/app/lib/api/data-file';
import { BASE_REFORM, MODEL_VERSION, HOUSEHOLDS, initialTaxState } from '@/app/lib/tax-burden/households';
import { simulate } from '@/app/lib/tax-burden/simulate';
import { lifecycleSeries, annualPension } from '@/app/lib/tax-burden/simulate-lifecycle';
import { basketForIncome, consumptionTax } from '@/app/lib/tax-burden/consumption-tax';
import { wageIncidenceRate } from '@/app/lib/tax-burden/incidence';
import { taxRevenueFromOverview } from '@/app/lib/tax-burden/revenue';
import type { AgeDataset, ConsumptionDataset, IncidenceDataset, OecdDataset, TaxParameters, TaxRevenue } from '@/types/tax-burden';
import type { MOFBudgetOverview } from '@/types/mof-budget-overview';

const p = readDataJson<TaxParameters>('tax-burden-params-2025.json', 'npm run generate-tax-burden-data');
assert.equal(p.metadata.status, 'prototype');
assert.equal(p.metadata.modelVersion, MODEL_VERSION);
assert.equal(p.monthlyRemuneration.length, p.monthlyBoundaries.length + 1);
// The policy sliders start from current law, so the baseline in the code must still match the parameter file.
assert(p.employeeInsuranceThreshold > 0 && p.lifecycle.nationalPension.monthly > 0);
for (const key of ['childMonthly', 'localRate', 'pensionRate', 'healthRate', 'careRate', 'employmentRate'] as const) {
  assert.equal(BASE_REFORM[key], p[key], `BASE_REFORM.${key} は制度パラメータと一致していること`);
}
for (const values of [p.monthlyRemuneration, p.monthlyBoundaries]) {
  assert(values.every((n, i) => Number.isFinite(n) && n > 0 && (i === 0 || n > values[i - 1])));
}

// 1. Working-age grid: amounts non-negative, identities hold, scope flag follows each worker, rate undefined at zero income.
let count = 0;
for (const household of HOUSEHOLDS) {
  for (const age of [20, 39, 40, 64]) {
    for (let income = 0; income <= 20000000; income += 10000) {
      const result = simulate({ ...initialTaxState(), household: household.id, income, age }, p);
      for (const key of ['incomeTax', 'residentTax', 'pension', 'health', 'care', 'employment', 'benefits'] as const) {
        assert(Number.isSafeInteger(result[key]) && result[key] >= 0, `${household.id}/${income}/${key}`);
      }
      assert.equal(result.netBurden, result.grossBurden - result.benefits);
      assert.equal(result.outOfScope, result.salaries.some(s => s < p.employeeInsuranceThreshold));
      assert(income === 0 ? result.netRate === null : Number.isFinite(result.netRate));
      count++;
    }
  }
}

// 2. Hand-checked statutory cases (see docs/tasks/20260914_0725 検証結果 §2.1, §2.2).
assert.equal(simulate({ ...initialTaxState(), household: 'single', income: 3000000 }, p).residentTax, 113000, '単身300万円の住民税（調整控除2,500円・森林環境税込み）');
assert.equal(simulate({ ...initialTaxState(), household: 'single-children', income: 2500000 }, p).singleParentBenefit, 627600, 'ひとり親250万円は一部支給');

// 3. R8: OECD Taxing Wages Japan 2025 reference values at the stylised points.
//    OECD applies employee SSC as flat rates on gross earnings (9.15% + 5% + 0.55%, no long-term care), whereas this model
//    uses the standard-remuneration table, 0.6% employment insurance and care insurance from age 40. The comparison below
//    therefore runs at age 39 and accepts SSC within 3%; income-tax and local-tax gaps must be explained by the SSC gap.
const oecd = readDataJson<OecdDataset>('tax-burden-oecd-2025.json', 'python scripts/generate-tax-burden-stats.py');
const points = oecd.years['2025'].points;
assert(points.length >= 8);
let compared = 0;
for (const pt of points) {
  const d = pt.japanDetail;
  if (d.GEBT === undefined || d.CGITFP === undefined || d.SLT === undefined || d.EECSSC === undefined || d.CTGG === undefined) continue;
  const r = simulate({ ...initialTaxState(), household: pt.household, income: d.GEBT, share: pt.suggestedShare ?? 67, age: 39 }, p);
  const ssc = r.pension + r.health + r.care + r.employment;
  const sscGap = ssc - d.EECSSC;
  assert(Math.abs(sscGap) <= d.EECSSC * 0.03, `${pt.household} AW${pt.awRatioTotal}: SSC ${ssc} vs OECD ${d.EECSSC}`);
  // A larger SSC deduction lowers taxable income; allow the induced tax difference plus rounding.
  // Rounding plus the 1,000-yen forest environment tax per adult, which the OECD table does not carry.
  const adults = HOUSEHOLDS.find(h => h.id === pt.household)!.adults;
  const inducedTax = Math.abs(sscGap) * 0.23 * p.reconstructionMultiplier + 1500 * adults;
  const inducedLocal = Math.abs(sscGap) * 0.10 + (p.localForestTax + 1500) * adults;
  if (pt.household !== 'single-children') {
    assert(Math.abs(r.incomeTax - d.CGITFP) <= inducedTax, `${pt.household} AW${pt.awRatioTotal}: income tax ${r.incomeTax} vs ${d.CGITFP}`);
    assert(Math.abs(r.residentTax - d.SLT) <= inducedLocal, `${pt.household} AW${pt.awRatioTotal}: local tax ${r.residentTax} vs ${d.SLT}`);
    assert.equal(r.childBenefit, d.CTGG, `${pt.household}: child benefit`);
  } else {
    // OECD's 2025 single-parent row omits the single-parent deduction (identical tax to the childless single); only benefits are compared.
    assert(Math.abs(r.benefits - d.CTGG) <= 15000, `single-children: transfers ${r.benefits} vs ${d.CTGG}`);
  }
  compared++;
}
assert(compared >= 8, 'R8 points compared');
// 3b. Continuous curves (50–250% AW, 1% steps): the model's NPATR at age 39 must stay within 1.5 points of the OECD Japan
//     series wherever the model is in scope. Employee SSC differ by convention (see above), which moves NPATR by ≲0.8 points.
let curvePoints = 0, worst = 0;
for (const [household, curve] of Object.entries(oecd.curves)) {
  assert.equal(curve.awRatio.length, 201, `${household}: 201 earnings points`);
  curve.awRatio.forEach((ratio, i) => {
    const japan = curve.japan[i];
    if (japan === null) return;
    const income = curve.averageWageJpy * ratio;
    const r = simulate({ ...initialTaxState(), household: household as keyof typeof oecd.curves, income, age: 39 }, p);
    if (r.outOfScope || r.netRate === null) return;
    const gap = Math.abs(r.netRate * 100 - japan);
    worst = Math.max(worst, gap);
    // OECD's 2025 single-parent series omits the single-parent deduction (35万円) and models the child-rearing allowance
    // with its own simplifications, so that household is held to a looser 3-point tolerance.
    const tolerance = household === 'single-children' ? 3.0 : 1.5;
    assert(gap <= tolerance, `${household} AW${Math.round(ratio * 100)}%: model ${(r.netRate * 100).toFixed(2)} vs OECD Japan ${japan.toFixed(2)}`);
    assert(curve.min[i] <= curve.oecdAverage[i] && curve.oecdAverage[i] <= curve.max[i], `${household} AW${Math.round(ratio * 100)}%: OECD range`);
    curvePoints++;
  });
}
assert(curvePoints > 600, 'continuous OECD points compared');

// 4. Lifecycle: earnings-related pension = 平均標準報酬額 × 5.481/1000 × 480か月 on a salary that maps exactly to a grade (47万円).
//    厚労省モデル年金（平均標準報酬45.5万円・40年で報酬比例 約9.6万円/月）は再評価率を含むため、ここでは算式の一致のみ確認する。
const model = annualPension(470000 * 12, false, p);
assert.equal(model.earningsRelated, Math.round(470000 * 0.005481 * 480));
assert.equal(model.basic, p.lifecycle.basicPensionFull);
for (const household of HOUSEHOLDS) {
  const years = lifecycleSeries({ ...initialTaxState(), household: household.id, income: 5000000 }, p);
  assert.equal(years.length, 66);
  assert(years.every(y => y.grossBurden >= 0 && y.benefits >= 0 && (y.income === 0 ? y.netRate === null : Number.isFinite(y.netRate))));
  assert(years.find(y => y.ageAt === 70)!.pensionIncome > 0 && years.find(y => y.ageAt === 64)!.pensionIncome === 0);
  assert(years.find(y => y.ageAt === 75)!.employment === 0 && years.find(y => y.ageAt === 75)!.health > 0);
}

// 5. Consumption data: leaves cover spending, ratios sane, estimated tax within spending-share bound.
const consumption = readDataJson<ConsumptionDataset>('tax-burden-consumption-2024.json', 'python scripts/generate-tax-burden-stats.py');
assert.equal(consumption.deciles.length, 10);
for (const d of consumption.deciles) {
  assert(Math.abs(d.standardGross + d.reducedGross + d.exemptGross - d.consumptionAnnual) <= 1200, `decile ${d.decile} leaves`);
  assert(d.annualIncome > 0 && d.propensity > 0.3 && d.propensity < 1);
  const t = consumptionTax({ standardGross: d.standardGross, reducedGross: d.reducedGross, exemptGross: d.exemptGross }, 0.1, 0.08, 'net-fixed');
  assert(t.spendingRate! <= 0.1 / 1.1 + 1e-9);
}
assert(basketForIncome(consumption, 5000000).standardGross > 0);
const ageStats = readDataJson<AgeDataset>('tax-burden-age-2024.json', 'python scripts/generate-tax-burden-stats.py');
assert.deepEqual(ageStats.groups.map(g => g.classes.length), [9, 7]);
for (const g of ageStats.groups) for (const c of g.classes) {
  assert(Math.abs(c.standardGross + c.reducedGross + c.exemptGross - c.consumptionAnnual) <= 1200, `${g.population} ${c.label} leaves`);
  assert(c.realIncomeAnnual > 0 && c.pensionBenefitAnnual >= 0 && c.disposableAnnual > 0);
  const burden = Object.values(c.directTaxes).reduce((s, v) => s + v, 0) + Object.values(c.socialInsurance).reduce((s, v) => s + v, 0);
  assert(burden > 0 && burden < c.realIncomeAnnual, `${g.population} ${c.label} burden`);
}

// 5b. Corporate tax incidence: totals are sane and the implied rate on wages is a few percent.
const incidence = readDataJson<IncidenceDataset>('tax-burden-incidence.json', 'python scripts/generate-tax-burden-stats.py');
assert(incidence.corporateTaxTotal > 1e13 && incidence.wagesAndSalaries > 1e14);
assert(incidence.compensationOfEmployees > incidence.wagesAndSalaries, '雇用者報酬 > 賃金・俸給');
assert(incidence.referenceShares.length > 0 && incidence.referenceShares.every(r => r.share > 0 && r.share < 1));
assert.equal(wageIncidenceRate(incidence, 0), 0);
const quarterRate = wageIncidenceRate(incidence, 0.25);
assert(quarterRate > 0.01 && quarterRate < 0.1, `25%帰着の賃金比 ${quarterRate}`);

// 6. Revenue files unchanged.
for (let year = 2017; year <= 2026; year++) {
  const overview = JSON.parse(gunzipSync(readFileSync(`public/data/mof-budget-overview-${year}.json.gz`)).toString('utf8')) as MOFBudgetOverview;
  const data = taxRevenueFromOverview(overview);
  assert.deepEqual(readDataJson<TaxRevenue>(`tax-revenue-${year}.json`, 'npm run generate-tax-burden-data'), data);
  assert(data.total > 0);
}
console.log(`PASS: ${count} household points; R8 compared at ${compared} stylised OECD points and ${curvePoints} continuous points (max NPATR gap ${worst.toFixed(2)} pt; differences explained by OECD's flat-rate SSC convention); lifecycle 6 households; consumption 10 deciles; revenue 2017–2026.`);
