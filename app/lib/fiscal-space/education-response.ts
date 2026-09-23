import type { EconomyState, Policy } from '@/types/fiscal-space';
import type { SupplyCase } from './supply';
import type { InvestmentPricePath } from './investment-price';

export const OECD_EDUCATION_SOURCE = 'https://www.oecd.org/en/publications/quantifying-the-effect-of-policies-to-promote-educational-performance-on-macroeconomic-productivity_b00051cc-en.html';
export const EDUCATION_SPENDING_SOURCE = 'https://www.aeaweb.org/articles?id=10.1257/app.20220279';
/** Published quantities and explicit transfer assumptions; see docs/fiscal-space-education.md.
 * PPP and Japanese GDP deflators put 2018 US dollars in 2024 Japanese yen.
 * These are economy-wide price proxies, not an education-specific PPP. */
export const EDUCATION_CALIBRATION = {
  scoreSd: .0316, dollarsPerPupil: 1000, exposureYears: 4, pisaPointsPerSd: 100,
  pupils: 9.3e6, yenPerDollar2018: 104.158636,
  japanDeflator2018: 98.0183258646232, japanDeflator2024: 108.554052559848,
  annualBudget: 1, schoolYears: 9, transfer: .5,
} as const;
export function calibratedEducationGain(transfer: number) {
  const c = EDUCATION_CALIBRATION;
  const yenPerDollar = c.yenPerDollar2018 * c.japanDeflator2024 / c.japanDeflator2018;
  return Number((c.annualBudget * 1e12 / c.pupils / yenPerDollar / c.dollarsPerPupil
    * c.scoreSd * c.pisaPointsPerSd * c.schoolYears / c.exposureYears * transfer).toFixed(2));
}
export const OECD_EDUCATION_EVIDENCE = 'Jackson・Mackevicius（2024）の米国の学校追加支出の因果研究メタ分析：1人年1,000ドル（2018年価格）を4年間追加すると学力0.0316標準偏差改善。日本の初期条件は約930万人・2024年価格への購買力換算・9年間への比例延長・移転率50%で校正。移転率は日本の実証推定ではない。OECD WP1781（2023）§2.3の全国平均PISA約8点→長期生産性約1%を参考換算に使用。高支出国での相関の弱さを因果効果ゼロとは扱わない。';
export const OECD_EDUCATION_FORMULA = '各年の実質追加予算÷施策の基準年額（純追加性を反映、1で頭打ち）×設定した全国平均PISA改善幅。9学年へ均等配分し、5〜13年後に順次就労、40世代の就労人口へ反映する比較仮定。就労後の減耗と退職を控除し、PISA 1点あたり0.125%を生産性へ換算。';
export const OECD_EDUCATION_SETTINGS = {
  educationModel: 'oecd' as const, educationPisaGain: calibratedEducationGain(EDUCATION_CALIBRATION.transfer), educationAnnualBudget: EDUCATION_CALIBRATION.annualBudget, educationSchoolYears: EDUCATION_CALIBRATION.schoolYears,
  additionality: 1, lag: 5, depreciation: .02, lifetime: 40, yield: .01 / 8,
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
