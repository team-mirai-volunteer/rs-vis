import test from 'node:test';
import assert from 'node:assert/strict';
import raw from '../scripts/data/tax-burden-params-2025.json';
import consumptionRaw from '../public/data/tax-burden-consumption-2024.json';
import oecdRaw from '../public/data/tax-burden-oecd-2025.json';
import incidenceRaw from '../public/data/tax-burden-incidence.json';
import type { ConsumptionDataset, IncidenceDataset, OecdDataset, TaxParameters } from '../types/tax-burden';
import { baseReform, initialTaxState, MODEL_VERSION, TAX_ITEMS } from '../app/lib/tax-burden/households';
import { availableTaxItems, cellRate } from '../app/lib/tax-burden/heatmap-items';
import { simulate, incomeTaxFromBase, standardMonthlyRemuneration, pensionIncome } from '../app/lib/tax-burden/simulate';
import { annualPension, inWorkPension, lifecycleSeries, heatmapGrid } from '../app/lib/tax-burden/simulate-lifecycle';
import { basketForIncome, consumptionTax, estimatedConsumptionTax } from '../app/lib/tax-burden/consumption-tax';
import { corporateTaxOnWages, wageIncidenceRate } from '../app/lib/tax-burden/incidence';
import { fiscalImpact } from '../app/lib/tax-burden/fiscal-impact';
import { encodeTaxState, decodeTaxState } from '../app/lib/tax-burden/reform-url';

const p = raw as unknown as TaxParameters;
const consumption = consumptionRaw as unknown as ConsumptionDataset;
const oecd = oecdRaw as unknown as OecdDataset;
const incidence = incidenceRaw as unknown as IncidenceDataset;

test('zero-income rate stays undefined while cash amounts remain available', () => {
  const result = simulate({ ...initialTaxState(), income: 0 }, p);
  assert.equal(result.netRate, null);
  assert.equal(result.childBenefit, 240000);
  assert.equal(result.outOfScope, true);
});
test('coverage follows each worker: solid once every earner reaches the employee-insurance wage', () => {
  const base = { ...initialTaxState(), income: 3000000 };
  // 300万を67:33で割ると第2就労者は99万円で賃金要件に届かない。400万なら132万円で届く。
  assert.equal(simulate({ ...base, household: 'two-earners-children', share: 67 }, p).outOfScope, true);
  assert.equal(simulate({ ...base, household: 'two-earners-children', income: 4000000, share: 67 }, p).outOfScope, false);
  assert.equal(simulate({ ...base, household: 'one-earner-children' }, p).outOfScope, false, '非就労の配偶者は判定に入らない');
  assert.equal(simulate({ ...base, income: p.employeeInsuranceThreshold }, p).outOfScope, false);
  assert.equal(simulate({ ...base, income: p.employeeInsuranceThreshold - 1 }, p).outOfScope, true);
  // フルタイム最低賃金（219万円）は下回っても、被用者保険に入っていれば計算は確定する。
  assert(p.minimumAnnualWage > p.employeeInsuranceThreshold);
  assert.equal(simulate({ ...base, income: p.minimumAnnualWage - 1 }, p).outOfScope, false);
});
test('below the employee-insurance wage no pension premium is due: the national pension is fully exempt at that salary', () => {
  const single = (income: number) => simulate({ ...initialTaxState(), household: 'single', income }, p);
  const np = p.lifecycle.nationalPension;
  for (const income of [300000, 500000, 1000000, p.employeeInsuranceThreshold - 10000]) {
    const r = single(income);
    assert.equal(r.pension, 0, `${income}円では国民年金は全額免除`);
    assert(r.health > 0 && r.employment > 0, '国民健康保険と雇用保険は残る');
  }
  // 給与所得は年収−65万円なので、賃金要件（105.6万円）未満では全額免除の基準（67万円）を超えられない。
  assert(p.employeeInsuranceThreshold - p.salaryDeduction[0][2] < np.exemptions[0].limit);
  assert(single(500000).netRate! < 0.1, '保険料が下げ止まらないので率が跳ね上がらない');
  // 賃金要件を超えると厚生年金・健康保険に移り、保険料が段差になる（106万円の壁）。
  const below = single(p.employeeInsuranceThreshold - 10000), above = single(p.employeeInsuranceThreshold);
  assert(above.pension > 90000 && above.health > below.health);
  assert(above.netRate! - below.netRate! > 0.1, '壁の段差は10ポイント超');
});
test('a dependent spouse is a third-category member and adds no pension premium', () => {
  const couple = simulate({ ...initialTaxState(), household: 'one-earner-children', income: 5000000 }, p);
  const solo = simulate({ ...initialTaxState(), household: 'single', income: 5000000 }, p);
  assert.equal(couple.pension, solo.pension, '専業配偶者の国民年金保険料は発生しない');
});
test('care contribution switches at age 40 and the spouse income split is symmetric', () => {
  const state = initialTaxState();
  assert.equal(simulate({ ...state, age: 39 }, p).care, 0);
  assert(simulate({ ...state, age: 40 }, p).care > 0);
  assert.equal(simulate({ ...state, household: 'two-earners', share: 33 }, p).netBurden,
    simulate({ ...state, household: 'two-earners', share: 67 }, p).netBurden);
});
test('standard monthly remuneration changes exactly at a bracket boundary', () => {
  assert.equal(standardMonthlyRemuneration(269999, p), 260000);
  assert.equal(standardMonthlyRemuneration(270000, p), 280000);
});
test('income tax example: seven-million taxable income, reconstruction tax and rounding', () => {
  assert.equal(incomeTaxFromBase(7000000, p), 994400);
  assert.equal(incomeTaxFromBase(7000999, p), 994400);
});
test('resident tax: statutory adjustment credit (5万円 difference) and forest tax — single, 3 million yen', () => {
  const r = simulate({ ...initialTaxState(), household: 'single', income: 3000000 }, p);
  // 所得202万, 社保484,440, 課税所得1,105,000 → 所得割110,500 − 調整控除2,500 + 均等割4,000 + 森林環境税1,000
  assert.equal(r.residentTax, 113000);
  assert.equal(r.incomeTax, 33400);
});
test('single-parent allowance: income test uses the flat 80,000 deduction only (partial payment at 2.5 million yen)', () => {
  const r = simulate({ ...initialTaxState(), household: 'single-children', income: 2500000 }, p);
  // 給与所得167万 − 8万 = 159万 > 全部支給限度145万 → 一部支給。第1子 42,085 + 第2子 10,215 → 52,300/月
  assert.equal(r.singleParentBenefit, 627600);
  assert.equal(simulate({ ...initialTaxState(), household: 'single-children', income: 2000000 }, p).singleParentBenefit, 675000);
});
test('bonus allocation respects pension cap per payment and alters contribution', () => {
  const state = { ...initialTaxState(), household: 'single' as const, income: 20000000 };
  assert.equal(simulate(state, p).pension, 713700);
  assert(simulate({ ...state, bonus: true }, p).pension > simulate(state, p).pension);
});
test('cash benefits can exceed burdens; rates are not clamped', () => {
  const state = { ...initialTaxState(), income: 100000, household: 'single-children' as const };
  assert(simulate(state, p).netRate! < 0);
  assert(simulate({ ...state, household: 'single', income: 10000 }, p).netRate! > 1);
});
test('children age with the adult: dependant allowance at 16–22, no child benefit after 18, none after 23', () => {
  const at = (age: number) => simulate({ ...initialTaxState(), household: 'one-earner-children', income: 6000000, age }, p);
  assert.equal(at(40).childBenefit, 240000);
  assert.equal(at(51).childBenefit, 120000); // children 19 and 17 → only the 17-year-old
  assert(at(50).incomeTax < at(40).incomeTax); // 16 and 18: general dependant allowances reduce tax
  assert(at(52).incomeTax < at(50).incomeTax); // 20 and 18: specific dependant allowance is larger
  assert.equal(at(58).childBenefit, 0);
  assert.equal(at(31).childBenefit, 0);
});
test('no reform means zero fiscal delta, while VAT stays uncomputed without spending data', () => {
  const state = initialTaxState();
  const before = simulate(state, p);
  const result = fiscalImpact(before, simulate(state, p, state.reform), state);
  assert.equal(result.directBalance, 0);
  assert.equal(result.totalBalance, null);
  assert.equal(result.consumption.status, 'uncomputed');
});
test('extra child benefit increases spending and reduces balance, not tax receipts', () => {
  const state = initialTaxState();
  state.reform.childMonthly += 1000;
  const result = fiscalImpact(simulate(state, p), simulate(state, p, state.reform), state);
  assert.equal(result.benefitSpending, 24000);
  assert.equal(result.incomeTax, 0);
  assert.equal(result.directBalance, -24000);
});
test('refundable household credit phases out and stops at zero', () => {
  const state = initialTaxState();
  state.reform.creditAnnual = 300000;
  assert.equal(simulate({ ...state, income: 3000000 }, p, state.reform).reformCredit, 300000);
  assert.equal(simulate({ ...state, income: 5000000 }, p, state.reform).reformCredit, 100000);
  assert.equal(simulate({ ...state, income: 7000000 }, p, state.reform).reformCredit, 0);
});
test('VAT uses tax-inclusive spending, and rates above 10% are valid', () => {
  const basket = { standardGross: 2200000, reducedGross: 0, exemptGross: 100000 };
  assert.equal(consumptionTax(basket, 0.1, 0.08, 'net-fixed').tax, 200000);
  assert.equal(consumptionTax(basket, 0.2, 0.08, 'net-fixed').tax, 400000);
  assert.equal(consumptionTax(basket, 0.2, 0.08, 'gross-fixed').tax, 366667);
  assert.equal(consumptionTax({ standardGross: 0, reducedGross: 0, exemptGross: 1 }, 0.1, 0.08, 'net-fixed').spendingRate, null);
});
test('survey basket interpolates by income and the estimate is regressive relative to income', () => {
  const low = basketForIncome(consumption, 2500000), high = basketForIncome(consumption, 12000000);
  assert(low.standardGross > 0 && high.standardGross > low.standardGross);
  const lowRate = estimatedConsumptionTax(consumption, 2500000) / 2500000;
  const highRate = estimatedConsumptionTax(consumption, 12000000) / 12000000;
  assert(lowRate > highRate, `low ${lowRate} should exceed high ${highRate}`);
  assert.equal(estimatedConsumptionTax(consumption, 0), 0);
  const withVat = simulate({ ...initialTaxState(), includeConsumption: true }, p, undefined, consumption);
  assert(withVat.consumptionTax > 0 && withVat.netRateWithConsumption! > withVat.netRate!);
  assert.equal(simulate(initialTaxState(), p, undefined, consumption).consumptionTax, 0);
});
test('VAT fiscal delta follows the shared fixed assumption and national-local sums reconcile', () => {
  const state = initialTaxState();
  state.reform.standardVat = 0.2;
  const basket = { standardGross: 2200000, reducedGross: 0, exemptGross: 0 };
  const before = simulate(state, p);
  const fixed = fiscalImpact(before, before, state, basket);
  const gross = fiscalImpact(before, before, { ...state, consumptionAssumption: 'gross-fixed' }, basket);
  assert.equal(fixed.totalBalance, 200000);
  assert.equal(gross.totalBalance, 166667);
  assert.deepEqual(fixed.consumption, { status: 'computed', national: 156000, local: 44000 });
  const fromDataset = fiscalImpact(before, before, state, consumption);
  assert.equal(fromDataset.consumption.status, 'computed');
});
test('pension model: earnings-related part follows 5.481/1000 × months on the capped average remuneration', () => {
  const single = annualPension(5000000, false, p);
  // 500万/12 = 416,667 → 標準報酬 410,000 → 410,000 × 0.005481 × 480 = 1,078,661
  assert.equal(single.earningsRelated, 1078661);
  assert.equal(single.basic, p.lifecycle.basicPensionFull);
  assert.equal(annualPension(30000000, false, p).earningsRelated, Math.round(650000 * 0.005481 * 480));
  assert.equal(annualPension(0, false, p).earningsRelated, 0);
  assert(inWorkPension(1078661, 8000000, false, p) < 1078661);
  assert.equal(inWorkPension(1078661, 3000000, false, p), 1078661);
});
test('public pension deduction: 65 and over gets at least 1.1 million yen', () => {
  assert.equal(pensionIncome(1500000, 70, p), 400000);
  assert.equal(pensionIncome(1500000, 64, p), 850000); // 150万×25%+27.5万=65万 > 最低60万
  assert.equal(pensionIncome(0, 70, p), 0);
});
test('lifecycle: phases, retiree insurance and pension timing', () => {
  const years = lifecycleSeries({ ...initialTaxState(), household: 'one-earner-children', income: 5000000 }, p);
  const at = (age: number) => years.find(y => y.ageAt === age)!;
  assert.equal(years.length, 66);
  assert.equal(at(59).phase, 'work'); assert.equal(at(62).phase, 'reemployed'); assert.equal(at(70).phase, 'pension');
  assert.equal(at(62).salaryTotal, 3500000);
  assert.equal(at(64).pensionIncome, 0);
  assert.equal(at(70).pensionIncome, 2 * p.lifecycle.basicPensionFull + 1078661);
  assert.equal(at(70).employment, 0); assert.equal(at(70).pension, 0);
  assert(at(70).health > 0 && at(70).care > 0, 'national health + first-category care at 70');
  assert(at(80).health > 0, 'latter-stage medical at 80');
  assert(at(70).netRate! < at(50).netRate!, 'pension years carry a lower burden rate');
  assert.equal(at(50).careerIncome, 5000000);
  assert.equal(at(50).pensionAdjustedBurden, at(50).netBurden, 'no pension before 65');
  assert(at(70).careerRate! < 0, 'pension received exceeds taxes and premiums → negative rate against the career income');
  assert.equal(at(70).pensionAdjustedBurden, at(70).netBurden - at(70).pensionIncome);
  const working = lifecycleSeries({ ...initialTaxState(), household: 'single', income: 8000000, workUntil: 72 }, p);
  const w67 = working.find(y => y.ageAt === 67)!, w71 = working.find(y => y.ageAt === 71)!, w72 = working.find(y => y.ageAt === 72)!;
  assert.equal(w67.phase, 'work-pension'); assert.equal(w71.phase, 'work-pension'); assert.equal(w72.phase, 'pension');
  assert(w67.salaryTotal > 0 && w67.pensionIncome > 0, 'salary and pension together while working after 65');
  assert(w67.pension > 0 && w71.pension === 0, 'employees pension contributions stop at 70');
  assert(w67.pensionIncome < w72.pensionIncome, 'in-work reduction lowers the pension while working');
});
test('resident tax is assessed on the previous year: none in the first working year, still high the year after retiring', () => {
  const ys = lifecycleSeries({ ...initialTaxState(), household: 'one-earner-children', income: 8000000 }, p);
  const at = (age: number) => ys.find(y => y.ageAt === age)!;
  assert.equal(at(20).residentTax, 0, '前年所得が無いので就労初年度は住民税なし');
  assert.equal(at(60).residentTax, 413000, '継続雇用で減収しても前年59歳の満額給与で課税される');
  assert.equal(at(65).residentTax, 242800, '年金生活の初年度も前年64歳の給与で課税される');
  assert.equal(at(66).residentTax, 47400, '年金所得に見合う額になるのは翌年から');
  assert.equal(at(71).residentTax, 39900, '老人控除対象配偶者（70歳以上）の判定も前年基準で1年ずれる');
  const y = at(65);
  assert.equal(y.grossBurden, y.incomeTax + y.residentTax + y.pension + y.health + y.care + y.employment);
  assert.equal(y.netBurden, y.grossBurden - y.benefits);
});
test('elderly resident tax: pension deduction, the non-taxable limit and the old-age spouse credit', () => {
  const at = (household: 'single' | 'one-earner-children', income: number, age: number) =>
    lifecycleSeries({ ...initialTaxState(), household, income }, p).find(y => y.ageAt === age)!;
  // 単身・年金191万 → 雑所得81万、社保18.6万、基礎控除43万 → 課税所得19.4万 → 所得割16,900＋均等割5,000
  assert.equal(at('single', 5000000, 70).residentTax, 21900);
  // 夫婦とも71歳・年金254万＋83万 → 老人配偶者控除38万、人的控除差15万で調整控除7,500円
  assert.equal(at('one-earner-children', 8000000, 71).residentTax, 39900);
  // 合計所得が非課税限度額（夫婦101万円・単身45万円）以下なら住民税はかからない
  assert.equal(at('one-earner-children', 5000000, 70).residentTax, 0);
  assert.equal(at('single', 3000000, 70).residentTax, 0);
});
test('corporate tax incidence is an explicit assumption: off by default, flat on wages, none in retirement', () => {
  const base = initialTaxState();
  assert.equal(base.corporateShare, 0, '既定では仮定を置かない');
  assert.equal(simulate(base, p, undefined, null, incidence).corporateTax, 0);
  const quarter = { ...base, corporateShare: 0.25 };
  const rate = incidence.corporateTaxTotal * 0.25 / incidence.wagesAndSalaries;
  const r = simulate(quarter, p, undefined, null, incidence);
  assert.equal(r.corporateTax, Math.round(5000000 * rate));
  assert.equal(r.grossBurden, simulate(base, p, undefined, null, incidence).grossBurden + r.corporateTax);
  assert.equal(r.netBurden, r.grossBurden - r.benefits);
  // Proportional to wages, so the rate on pay does not change with income.
  const high = simulate({ ...quarter, income: 15000000 }, p, undefined, null, incidence);
  assert(Math.abs(high.corporateTax / 15000000 - r.corporateTax / 5000000) < 1e-6);
  const years = lifecycleSeries(quarter, p, undefined, null, incidence);
  assert(years.find(y => y.ageAt === 40)!.corporateTax > 0);
  assert.equal(years.find(y => y.ageAt === 70)!.corporateTax, 0, '年金だけの年には賃金が無いので乗らない');
  assert.equal(wageIncidenceRate(incidence, 0), 0);
  assert.equal(corporateTaxOnWages(null, 5000000, 0.25), 0, 'データが無ければ計算しない');
  assert.throws(() => wageIncidenceRate(incidence, 1.5));
});
test('heat-map grid covers all incomes and ages with consistent totals and answers to the policy sliders', () => {
  const base = initialTaxState();
  const grid = heatmapGrid({ ...base, household: 'single' }, p, consumption);
  assert.equal(grid.length, 10);
  assert(grid.every(r => r.cells.length === 12 && r.cells.every(c => c.consumptionTax >= 0 && c.netRateWithConsumption !== null)));
  // Each flat-rate lever moves its own panel: dropping the resident rate to zero leaves only the per-capita levy.
  const cell = (g: typeof grid, income: number, age: number) => g.find(r => r.income === income)!.cells.find(c => c.ageAt === age)!;
  const local = heatmapGrid({ ...base, household: 'single' }, p, consumption, null, { ...base.reform, localRate: 0 });
  assert.equal(cell(local, 8000000, 40).residentTax, p.localPerCapita + p.localForestTax);
  assert.equal(cell(local, 8000000, 40).incomeTax, cell(grid, 8000000, 40).incomeTax);
  const care = heatmapGrid({ ...base, household: 'single' }, p, consumption, null, { ...base.reform, careRate: 0 });
  assert.equal(cell(care, 8000000, 50).care, 0, '第2号の介護保険料が消える');
  assert.equal(cell(care, 8000000, 70).care, 0, '65歳以降の第1号介護保険料も同じレバーで動く');
  assert.equal(cell(care, 8000000, 50).pension, cell(grid, 8000000, 50).pension);
});
test('flat-rate levers move one line each, and current-law values change nothing', () => {
  const base = initialTaxState();
  const plain = simulate(base, p);
  assert.deepEqual(simulate(base, p, baseReform(p)), plain, '現行法どおりの料率なら結果は変わらない');
  const noLocal = simulate(base, p, { ...base.reform, localRate: 0 });
  assert.equal(noLocal.residentTax, p.localPerCapita + p.localForestTax, '所得割が消えても均等割と森林環境税は残る');
  assert.equal(noLocal.incomeTax, plain.incomeTax);
  const doublePension = simulate(base, p, { ...base.reform, pensionRate: p.pensionRate * 2 });
  assert(Math.abs(doublePension.pension - plain.pension * 2) <= 1);
  assert.equal(doublePension.health, plain.health);
  assert(doublePension.incomeTax < plain.incomeTax, '保険料が増えれば社会保険料控除で所得税は下がる');
  // The employee rate carries over to the elderly schemes, so one lever keeps moving one line at every age.
  const at70 = (reform?: typeof base.reform) => lifecycleSeries({ ...base, income: 8000000 }, p, reform).find(y => y.ageAt === 70)!;
  assert(Math.abs(at70({ ...base.reform, healthRate: p.healthRate * 2 }).health - at70().health * 2) <= 2, '国民健康保険も同じ比率で動く');
});
test('cash benefits are split per programme; panels appear only for the ones a household receives', () => {
  const couple = heatmapGrid({ ...initialTaxState(), household: 'one-earner-children' }, p, consumption);
  const coupleItems = availableTaxItems(couple, true).map(t => t.id);
  assert(coupleItems.includes('childBenefit'));
  assert(!coupleItems.includes('singleParentBenefit'), '夫婦世帯に児童扶養手当は出ない');
  assert(!coupleItems.includes('pensionSupport'), '満額基礎年金は所得要件を超えるため常に0');
  assert(!coupleItems.includes('reformCredit'), '改革案の給付はヒートマップでは常に0');
  assert(!coupleItems.includes('benefits'), '支給が1種類だけなら合計の表は出さない');
  const lone = availableTaxItems(heatmapGrid({ ...initialTaxState(), household: 'single-children' }, p, consumption), true).map(t => t.id);
  for (const id of ['childBenefit', 'singleParentBenefit', 'benefits']) assert(lone.includes(id as never), `ひとり親世帯には${id}の表が出る`);
  const childless = availableTaxItems(heatmapGrid({ ...initialTaxState(), household: 'single' }, p, consumption), true).map(t => t.id);
  assert(!childless.some(id => ['childBenefit', 'singleParentBenefit', 'benefits'].includes(id)), '子なし単身に現金給付の表は出ない');
  assert(!availableTaxItems(couple, false).includes(TAX_ITEMS.find(t => t.id === 'consumption')!), '消費支出データが無ければ消費税の表も出ない');
  // Benefits are negative and measured against the fixed career income, not the income of that year.
  const cell = couple.find(r => r.income === 5000000)!.cells.find(c => c.ageAt === 40)!;
  assert.equal(cellRate(cell, 'childBenefit'), -cell.childBenefit / 5000000);
  assert(cellRate(cell, 'childBenefit')! < 0);
  assert.equal(cellRate(cell, 'benefits'), cellRate(cell, 'childBenefit'));
});
test('OECD dataset has Japan reference values at eight stylised points for 2025', () => {
  const points = oecd.years['2025'].points;
  assert.equal(points.length, 8);
  assert(points.every(pt => pt.countries >= 30 && pt.min <= pt.oecdAverage && pt.oecdAverage <= pt.max));
  assert(oecd.years['2025'].averageWageJpy! > 5000000);
  const curve = oecd.curves['one-earner-children']!;
  assert.equal(curve.awRatio.length, 201);
  assert.equal(curve.awRatio[0], 0.5); assert.equal(curve.awRatio[200], 2.5);
  assert(curve.japan.every(v => v !== null) && curve.min.every((v, i) => v <= curve.oecdAverage[i] && curve.oecdAverage[i] <= curve.max[i]));
  assert(curve.japan[0]! > curve.oecdAverage[0], 'Japan burden at 50% AW exceeds the OECD average (the Okina-curve finding)');
  assert.equal(oecd.curves['two-earners'], undefined);
});
test('URL round trips every calculation and display condition', () => {
  const state = { ...initialTaxState(), age: 55, share: 45, bonus: true, showAll: false, consumptionAssumption: 'gross-fixed' as const,
    continuation: 0.5, workUntil: 70, includeConsumption: true, showOecd: true, view: 'age' as const };
  state.reform.creditAnnual = 250000;
  assert.deepEqual(decodeTaxState(encodeTaxState(state)), { state, warning: null });
});
test('unknown model and invalid numbers fail safely with a visible warning; empty query needs no size property', () => {
  assert(decodeTaxState('?v=future&fy=2025').warning);
  const decoded = decodeTaxState(`?v=${MODEL_VERSION}&fy=2025&income=Infinity&age=NaN&share=-1&creditAnnual=999999999&household=unknown`);
  assert(decoded.warning);
  assert.deepEqual(decoded.state, initialTaxState());
  assert.deepEqual(decodeTaxState(''), { state: initialTaxState(), warning: null });
});
