import type { EconomyState, Policy } from '@/types/fiscal-space';
import type { SupplyCase } from './supply';
import type { InvestmentPricePath } from './investment-price';

export const OECD_EDUCATION_SOURCE = 'https://www.oecd.org/en/publications/quantifying-the-effect-of-policies-to-promote-educational-performance-on-macroeconomic-productivity_b00051cc-en.html';
export const OECD_EDUCATION_EVIDENCE = 'OECD Economics Department Working Paper 1781（2023）§4.1・表7では、支出増と学力の正の関係は低支出域に限られ、日本は支出の中央値への引上げ対象外。これは因果的な効果ゼロの証明ではないため、一般的な増額の学力改善は初期0点（上乗せ未算入）とする。§2.3の全国平均PISA約8点改善→長期生産性約1%を参考換算に使用。予算から学力への換算は未推定で、対象を絞った施策は利用者が別途設定する。';
export const OECD_EDUCATION_FORMULA = '各年の実質追加予算÷施策の基準年額（純追加性を反映、1で頭打ち）×設定した全国平均PISA改善幅。9学年へ均等配分し、5〜13年後に順次就労、40世代の就労人口へ反映する比較仮定。就労後の減耗と退職を控除し、PISA 1点あたり0.125%を生産性へ換算。';
export const OECD_EDUCATION_SETTINGS = {
  educationModel: 'oecd' as const, educationPisaGain: 0, educationAnnualBudget: 1, educationSchoolYears: 9,
  additionality: .5, lag: 5, depreciation: .02, lifetime: 40, yield: .01 / 8,
};

export function validateEducation(c: SupplyCase) {
  if (c.educationModel === undefined || c.educationModel === 'schooling') return;
  if (c.kind !== 'education' || c.educationModel !== 'oecd'
    || !Number.isFinite(c.educationPisaGain) || c.educationPisaGain! < 0 || c.educationPisaGain! > 100
    || !Number.isFinite(c.educationAnnualBudget) || c.educationAnnualBudget! < .01 || c.educationAnnualBudget! > 100
    || !Number.isInteger(c.educationSchoolYears) || c.educationSchoolYears! < 1 || c.educationSchoolYears! > 20
    || !Number.isInteger(c.lag) || c.lag < 0 || c.lag > 30
    || !Number.isInteger(c.lifetime) || c.lifetime < 1 || c.lifetime > 60
    || !Number.isFinite(c.additionality) || c.additionality < 0 || c.additionality > 1
    || !Number.isFinite(c.depreciation) || c.depreciation < 0 || c.depreciation > 1
    || !Number.isFinite(c.yield) || c.yield < 0 || c.yield > 1) throw new RangeError('Invalid OECD education scenario');
}

/** Pool matching programmes before the funding cap: splitting a policy cannot create gains.
 * Each payment benefits multiple school grades partially, not a whole new working-age cohort.
 * Equal cohort sizes and entry lags are comparison assumptions, not OECD estimates for Japan. */
export function educationProductivity(initial: EconomyState, policies: Policy[], year: number, prices: InvestmentPricePath) {
  const programmes = new Map<string, { c: SupplyCase; policies: Policy[] }>();
  for (const policy of policies) {
    const c = policy.supply;
    if (c?.kind !== 'education' || c.educationModel !== 'oecd') continue;
    validateEducation(c);
    if ([policy.potentialGdpEffect, policy.tfpEffect, policy.labourProductivityEffect, policy.capitalEffect, policy.energyCapacityEffect].some(v => v !== 0))
      throw new RangeError('Supply scenario and manual productivity coefficients cannot be combined');
    const key = JSON.stringify([c.educationPisaGain, c.educationAnnualBudget, c.educationSchoolYears, c.additionality, c.lag, c.lifetime, c.depreciation, c.yield]);
    const group = programmes.get(key) ?? { c, policies: [] };
    group.policies.push(policy); programmes.set(key, group);
  }
  let gain = 0;
  for (const { c, policies: group } of programmes.values()) {
    if (!c.educationPisaGain || !c.yield) continue;
    const benchmark = c.educationAnnualBudget! * 1e12 / (initial.macro.nominalGdp / initial.macro.realGdp);
    for (let paid = 1; paid <= year; paid++) {
      const budget = group.reduce((sum, policy) => sum + (policy.kind === 'permanent' || paid <= policy.duration ? policy.annualCost : 0), 0);
      const dose = Math.min(1, budget / prices(paid) * c.additionality / benchmark);
      if (!dose) continue;
      for (let grade = 0; grade < c.educationSchoolYears!; grade++) {
        const age = year - paid - c.lag - grade;
        if (age >= 0 && age < c.lifetime) gain += dose * c.educationPisaGain! * c.yield
          * (1 - c.depreciation) ** age / (c.educationSchoolYears! * c.lifetime);
      }
    }
  }
  return gain;
}
