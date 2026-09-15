import type { EconomyState, ModelParameters, Policy, SourceValue } from '@/types/fiscal-space';

export type ReferenceModel = 'ef2026' | 'esri2022';
export type ResponseKind = 'government' | 'household' | 'corporate';
/** EF2026 table 1: a one-year government-spending shock, not the difference
 * of two sustained shocks. Levels relative to the reference path, percent. */
export const GOVERNMENT_ONE_YEAR: ResponseProfile = {
  gdp: [1.08, -.10, -.20, -.21, -.14], exports: [-.01, 0, -.05, -.06, -.04], imports: [.45, .45, .43, .36, .31],
  prices: [.15, .22, .17, .13, .10], deflator: [.19, .26, .22, .17, .13],
  employment: [.07, -.01, -.02, -.02, -.01], labourForce: [0, 0, 0, 0, 0], hours: [0, 0, 0, 0, 0],
  exchangeRate: [.01, .10, -.27, -.18, -.09],
};
/** Percent level deviations for a sustained fiscal change of 1% of GDP.
 * Imports, employment and labour force use their OWN baseline as denominator.
 * These are model diagnostics, not identified causal estimates or confidence bounds. */
export interface ResponseProfile {
  gdp: number[]; exports: number[]; imports: number[]; prices: number[]; deflator: number[];
  employment: number[]; labourForce: number[]; hours: number[]; exchangeRate: number[];
}
export const REFERENCES = {
  ef2026: {
    name: '経済財政モデル（2026年度版）',
    url: 'https://www5.cao.go.jp/keizai3/econome/ef2rrrrrr-summary.pdf',
    years: 5,
    note: '政府支出の継続増加と個人所得税の継続増税（符号を反転）の比較条件。労働参加率は外生。税率設計別の効果を同定した研究ではありません。',
    government: {
      gdp: [1.08, .96, .75, .54, .41], imports: [.45, .94, 1.42, 1.82, 2.15],
      exports: [-.01, -.01, -.06, -.12, -.16],
      exchangeRate: [.01, .11, -.16, -.34, -.43],
      prices: [.15, .37, .54, .67, .76], deflator: [.19, .45, .66, .82, .94],
      employment: [.07, .06, .04, .03, .02], labourForce: [0, 0, 0, 0, 0], hours: [0, 0, 0, 0, 0],
    },
    household: {
      gdp: [.64, .56, .43, .32, .29], imports: [.27, .55, .83, 1.06, 1.29],
      exports: [0, -.01, -.04, -.08, -.10],
      exchangeRate: [0, .04, -.12, -.22, -.27],
      prices: [.09, .22, .31, .39, .45], deflator: [.10, .26, .38, .47, .55],
      employment: [.04, .04, .03, .02, .01], labourForce: [0, 0, 0, 0, 0], hours: [0, 0, 0, 0, 0],
    },
    corporate: {
      gdp: [.24, .38, .45, .47, .47], imports: [.10, .27, .49, .71, .90],
      exports: [0, -.01, -.02, -.04, -.06],
      exchangeRate: [0, 0, -.03, -.10, -.16],
      prices: [.03, .10, .18, .25, .32], deflator: [.04, .12, .22, .31, .39],
      employment: [.02, .02, .02, .02, .01], labourForce: [0, 0, 0, 0, 0], hours: [0, 0, 0, 0, 0],
    },
  },
  esri2022: {
    name: '短期日本経済マクロ計量モデル（2022年版）',
    url: 'https://www.esri.cao.go.jp/jp/esri/archive/e_rnote/e_rnote080/e_rnote072.pdf',
    years: 3,
    note: '名目公共投資・個人所得税減税の継続変更（付表3・4）。2018〜2020年を基準にした短期モデル。消費者物価は民間消費デフレーターで代用。2年目以降は原資料も参考扱いです。',
    government: {
      gdp: [1.05, 1.04, .95], imports: [.38, .83, .85],
      exports: [0, -.01, -.04],
      exchangeRate: [-.06, -.24, -.47],
      prices: [.02, .22, .48], deflator: [.09, .30, .56],
      employment: [.23, .25, .19], labourForce: [.20, .21, .15], hours: [.28, .28, .25],
    },
    household: {
      gdp: [.21, .33, .32], imports: [.66, 1.57, 1.73],
      exports: [0, 0, -.01],
      exchangeRate: [-.01, -.05, -.12],
      prices: [0, .04, .12], deflator: [.01, .07, .16],
      employment: [.04, .07, .05], labourForce: [.04, .06, .03], hours: [.06, .09, .08],
    },
    corporate: {
      gdp: [.35, .59, .52], imports: [.10, .41, .46],
      exports: [0, 0, -.02],
      exchangeRate: [-.02, -.10, -.22],
      prices: [0, .06, .16], deflator: [.02, .09, .17],
      employment: [.08, .15, .11], labourForce: [.07, .13, .10], hours: [.09, .12, .07],
    },
  },
} satisfies Record<ReferenceModel, { name: string; url: string; years: number; note: string } & Record<ResponseKind, ResponseProfile>>;

export function responseKind(policy: Policy): ResponseKind {
  return policy.channel === 'tax' || policy.id === 'cash' ? 'household' : 'government';
}

export function referenceRecords(model: ReferenceModel): SourceValue[] {
  const ref = REFERENCES[model];
  const groups = (['government', 'household', 'corporate'] as const).map(kind => ({ kind: String(kind), profile: ref[kind] }));
  if (model === 'ef2026') groups.push({ kind: 'governmentOneYear', profile: GOVERNMENT_ONE_YEAR });
  return groups.flatMap(({ kind, profile }) =>
    Object.entries(profile).flatMap(([key, values]) => values.map((value, i) => ({
      key: `calibration.${kind}.${key}.${i}`, value, unit: '基準経路に対する水準変化（%）',
      referenceYear: `${ref.name}・政策開始${i + 1}年目`, sourceName: ref.name, sourceUrl: ref.url,
      status: model === 'ef2026' && (key === 'hours' || key === 'labourForce') ? 'assumption' as const : 'estimated' as const,
      uncertaintyNote: `財政措置はGDPの1%相当。${kind === 'governmentOneYear' ? '実質政府支出を1年限り増やす公表実験（表①）。' : ref.note} 輸入・人数・時間の変化率の分母は各変数の基準値です。労働参加・時間の0には未算入を含みます。`,
    }))));
}

export function policyProfile(policy: Policy, p: ModelParameters): ResponseProfile {
  const reference = REFERENCES[p.referenceModel];
  if (policy.id !== 'social-insurance') return reference[responseKind(policy)];
  // Explicit proxy only: payroll relief is NOT the same intervention as profit tax relief.
  return Object.fromEntries(Object.entries(reference.household).map(([key, values]) =>
    [key, values.map((v, i) => v * p.employeeReliefShare + reference.corporate[key as keyof ResponseProfile][i] * (1 - p.employeeReliefShare))])) as unknown as ResponseProfile;
}

/** Last published STEP response is held constant outside its published horizon.
 * That tail is an explicit extrapolation; it is not another observed multiplier. */
export function stepResponse(values: number[], year: number): number {
  return year <= 0 ? 0 : values[Math.min(year, values.length) - 1];
}

/** Convolve differences of step responses with constant-nominal annual costs.
 * Deflate costs on the no-policy price path, avoiding treatment-induced deflation.
 * For fixed prices and a permanent change, the sum telescopes to the source table.
 * Finite-duration effects are a linear on/off approximation, not the source's
 * separately estimated one-year experiment. Negative withdrawal effects are kept. */
export function calibratedResponse(initial: EconomyState, policy: Policy, year: number, p: ModelParameters) {
  const profile = policyProfile(policy, p);
  const oneYearGovernment = p.referenceModel === 'ef2026' && responseKind(policy) === 'government' && policy.kind !== 'permanent' && policy.duration === 1;
  const result = { gdp: 0, exports: 0, imports: 0, prices: 0, deflator: 0, employment: 0, labourForce: 0, hours: 0, exchangeRate: 0 };
  let baselinePrice = initial.macro.nominalGdp / initial.macro.realGdp;
  for (let paid = 1; paid <= year; paid++) {
    if (policy.kind === 'permanent' || paid <= policy.duration) {
      const realCost = policy.annualCost / baselinePrice;
      const age = year - paid + 1;
      for (const key of Object.keys(result) as (keyof ResponseProfile)[]) {
        const response = oneYearGovernment
          ? (GOVERNMENT_ONE_YEAR[key][age - 1] ?? 0)
          : stepResponse(profile[key], age) - stepResponse(profile[key], age - 1);
        result[key] += realCost / initial.macro.realGdp * response;
      }
    }
    baselinePrice *= 1 + p.baselineInflation + p.inflationPersistence ** paid * (initial.macro.inflation - p.baselineInflation);
  }
  result.gdp *= initial.macro.realGdp * p.multiplierScale;
  result.imports *= initial.external.imports / (initial.macro.nominalGdp / initial.macro.realGdp);
  result.exports *= initial.external.exports / (initial.macro.nominalGdp / initial.macro.realGdp);
  return result;
}

/** Extra wage/cost responses are explicit sensitivity assumptions, not estimates.
 * Split employee/employer proportional relief before mapping to wages or costs.
 * No wage shifting; this mapping does not cover lump sums or threshold reforms. */
export function taxLabourSupply(initial: EconomyState, policies: Policy[], year: number, p: ModelParameters) {
  const active = policies.filter(x => x.kind === 'permanent' || year <= x.duration);
  const insurance = active.filter(x => x.id === 'social-insurance').reduce((sum, x) => sum + x.annualCost, 0);
  const employeeCut = active.filter(x => x.id === 'income-tax').reduce((sum, x) => sum + x.annualCost, 0) + insurance * p.employeeReliefShare;
  const employerCut = insurance * (1 - p.employeeReliefShare);
  const netEarnings = initial.macro.nominalGdp * p.netLabourIncomeShare *
    ((1 + p.baselineRealGrowth) * (1 + p.baselineInflation)) ** year;
  const netWageRatio = 1 + employeeCut / netEarnings;
  const employerCost = initial.macro.nominalGdp * p.employerLabourCostShare *
    ((1 + p.baselineRealGrowth) * (1 + p.baselineInflation)) ** year;
  const employerCostRatio = 1 - employerCut / employerCost;
  if (employerCostRatio <= 0) throw new RangeError('Employer relief exceeds the assumed payroll cost');
  return { netWageRatio, hours: netWageRatio ** p.hoursElasticity,
    employeeCut, employerCut, employerCostRatio, employerDemand: employerCostRatio ** -p.employerDemandElasticity,
    participation: Math.min(1 / initial.labour.participation, netWageRatio ** p.participationElasticity) };
}
