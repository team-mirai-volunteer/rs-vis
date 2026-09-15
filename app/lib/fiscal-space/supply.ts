import type { EconomyState, ModelParameters, Policy, SourceValue } from '@/types/fiscal-space';
import { REFERENCES } from './calibration';
import { powerComponents } from './policy-trade';

export interface SupplyCase {
  kind: 'capital' | 'research' | 'education' | 'childcare' | 'grid';
  additionality: number; lag: number; depreciation: number; lifetime: number;
  yield: number; unitCost: number; employment: number;
  maintenanceRate?: number; maintenanceImportShare?: number; generationOverlapShare?: number;
}

/** Reference-informed scenarios, not Japanese causal policy coefficients.
 * Additionality discounts displacement, unsuccessful projects and implementation.
 * A separately configured commercial project supersedes these pathways. */
export const SUPPLY_CASES: Record<string, { label: string; source: string; evidence: string; formula: string; settings: SupplyCase }> = {
  'public-investment': {
    label: '公共資本の蓄積', source: 'https://www.imf.org/external/pubs/ft/weo/2014/02/pdf/c3.pdf',
    evidence: 'IMF（2014）掲載の全国公共資本の産出弾力性0.122を参考。日本の追加事業の推定値ではない。公共資本/GDP=1.2、純追加性50%、供用2年後・減耗3%は比較条件。維持更新・既存投資の置換を純追加性で控除。',
    formula: '潜在GDP × [(1＋実効資本増分÷基準公共資本)^0.122−1]。基準公共資本＝初期実質GDP×1.2。',
    settings: { kind: 'capital', additionality: .5, lag: 2, depreciation: .03, lifetime: 40, yield: .122, unitCost: 1.2, employment: 0 },
  },
  rd: {
    label: '研究知識の蓄積', source: 'https://www.rieti.go.jp/jp/publications/pdp/13p010.pdf',
    evidence: 'RIETI（2013）pp.12–13の日本企業の研究開発収益率約30%を参考。研究費の支出額に対する効果で、政府補助の効果ではない。純追加性50%、成果まで3年、知識減耗15%を仮定。事業売上を設定した場合はそちらに切り替える。',
    formula: '成果が出た実効研究費の残存額 × 年間産出寄与率。研究費そのもののGDP計上とは別。',
    settings: { kind: 'research', additionality: .5, lag: 3, depreciation: .15, lifetime: 20, yield: .3, unitCost: 1, employment: 0 },
  },
  education: {
    label: '追加就学・職業訓練', source: 'https://documents.worldbank.org/en/publication/documents-reports/documentdetail/442521523465644318',
    evidence: '世界銀行（2018）の追加就学1年に対する賃金収益率約9%を参考。私的賃金収益を生産性へ換算する仮定で、教育支出のGDP乗数ではない。1人年150万円・追加性50%・就労まで4年・就労率80%・技能減耗2%。幼児教育や授業料だけの補助にはそのまま適用できない。',
    formula: '追加就学人数 × 就労率 × 労働分配率 × 1人当たり実質GDP × (exp(就学1年の収益率)−1)。',
    settings: { kind: 'education', additionality: .5, lag: 4, depreciation: .02, lifetime: 35, yield: .09, unitCost: 1.5e6, employment: .8 },
  },
  childcare: {
    label: '1歳児保育の利用拡大', source: 'https://www.esri.cao.go.jp/en/esri/archive/e_dis/2024/e_dis387-e.html',
    evidence: 'ESRI DP387（2024）：認可保育入所による1歳児の母親の就業率差18.8%。入所を希望する家庭の局所効果。1枠年200万円・追加性50%・常勤換算80%と仮定。保育費は運営費として支出年だけ有効。出生児を10年で労働者には数えない。保育職員の配置・質の制約は別途必要。',
    formula: '追加利用枠 × 就業率差 × 常勤換算 × 労働分配率 × 1人当たり実質GDP。',
    settings: { kind: 'childcare', additionality: .5, lag: 0, depreciation: 0, lifetime: 1, yield: .188, unitCost: 2e6, employment: .8 },
  },
  grid: {
    label: '系統増強による燃料節約', source: 'https://www.occto.or.jp/assets/kouikikeitou/chokihoushin/files/chokihoushin_23_01_02.pdf',
    evidence: 'OCCTO（2023）p.78：工事費6.0〜6.97兆円、燃料・CO2削減0.4116〜0.7435兆円/年、送電ロス増0.0251〜0.043兆円/年。保守的な端を採り、CO2費用25%を除外。純追加性50%、供用5年後、減耗2%、保守費1%/年・うち輸入20%は仮定。燃料節約に初期の化石燃料輸入依存度を掛けて国内代替へ反映。追加再エネと重複し得る便益は100%を初期条件とし、同じ節約を除く。地域・時間別の系統計算ではない。',
    formula: '実効設備額 × (効果係数＋保守費率) × 化石燃料輸入依存度 − 発電投資との重複額＝輸入代替。そこから輸入・国内の保守資源費を差し引いた純額を供給へ一度だけ計上。',
    settings: { kind: 'grid', additionality: .5, lag: 5, depreciation: .02, lifetime: 40, yield: (.4116 * .75 - .043) / 6.97 - .01, unitCost: 1, employment: 0,
      maintenanceRate: .01, maintenanceImportShare: .2, generationOverlapShare: 1 },
  },
};

export const SUPPLY_UNAVAILABLE: Record<string, string> = {
  'consumption-tax': '税率・対象品目・価格転嫁と実質賃金への反応が必要',
  cash: '所得効果・対象世帯・就労条件によって供給反応の符号が変わる',
  defence: '安全保障・抑止の便益を通常時GDPへ換算する根拠が未整備',
  healthcare: '治療・予防・復職支援の内訳と健康改善による就労効果が必要',
};

export function hasCommercialSupply(policy: Policy) {
  return policy.trade?.kind === 'industry' ? policy.trade.assumptions.annualSalesPerInvestment !== null
    : policy.trade?.kind === 'power' && powerComponents(policy.trade.assumptions).every(x => x.assumptions.operatingImportYenPerKwh !== null);
}

export function effectiveSupplyStock(initial: EconomyState, policy: Policy, year: number, p: ModelParameters, realized = false) {
  const c = policy.supply;
  if (!c) return 0;
  if ([policy.potentialGdpEffect, policy.tfpEffect, policy.labourProductivityEffect].some(v => v !== 0)) {
    throw new RangeError('Supply scenario and manual productivity coefficients cannot be combined');
  }
  if (!Object.values(c).every(v => typeof v !== 'number' || Number.isFinite(v)) ||
    c.additionality < 0 || c.additionality > 1 || c.depreciation < 0 || c.depreciation > 1 ||
    !Number.isInteger(c.lag) || c.lag < 0 || !Number.isInteger(c.lifetime) || c.lifetime < 1 ||
    c.unitCost <= 0 || c.yield < 0 || c.yield > 1 || c.employment < 0 || c.employment > 1) throw new RangeError('Invalid supply scenario');
  let price = initial.macro.nominalGdp / initial.macro.realGdp;
  let stock = 0;
  for (let paid = 1; paid <= year; paid++) {
    const age = year - paid - c.lag;
    if ((policy.kind === 'permanent' || paid <= policy.duration) && age >= 0 && age < c.lifetime) {
      const referenceYears = REFERENCES[p.referenceModel].years;
      const realization = realized ? Math.min(1, Math.max(0, (year - paid + 1 - referenceYears) / (10 - referenceYears))) : 1;
      stock += policy.annualCost / price * c.additionality * (1 - c.depreciation) ** age * realization;
    }
    price *= 1 + p.baselineInflation + p.inflationPersistence ** paid * (initial.macro.inflation - p.baselineInflation);
  }
  return stock;
}

export function supplyResponse(initial: EconomyState, policy: Policy, year: number, p: ModelParameters, realized = false) {
  const c = policy.supply;
  // Grid savings now enter through the energy/trade path, exactly once.
  if (!c || c.kind === 'grid' || hasCommercialSupply(policy)) return 0;
  const stock = effectiveSupplyStock(initial, policy, year, p, realized);
  if (c.kind === 'capital') return initial.macro.potentialGdp * Math.expm1(c.yield * Math.log1p(stock / (initial.macro.realGdp * c.unitCost)));
  if (c.kind === 'education' || c.kind === 'childcare') {
    const price0 = initial.macro.nominalGdp / initial.macro.realGdp;
    const people = stock / (c.unitCost / price0) * c.employment;
    const effect = c.kind === 'education' ? Math.expm1(c.yield) : c.yield;
    // Finite population ceiling. This is not a forecast of available childcare seats.
    const effectiveWorkers = Math.min(people * effect, initial.labour.employment * .1);
    return effectiveWorkers * initial.macro.realGdp / initial.labour.employment * p.cobbWeights.labour;
  }
  return stock * c.yield;
}

/** Pool identical capital cases before applying decreasing returns; splitting a
 * policy across rows must never manufacture additional productivity. */
export function supplyTotal(initial: EconomyState, policies: Policy[], year: number, p: ModelParameters, realized = false) {
  const pooled = new Map<string, Policy>();
  for (const policy of policies) {
    if (!policy.supply || hasCommercialSupply(policy)) continue;
    const key = JSON.stringify([policy.id, policy.kind, policy.duration, policy.supply]);
    const old = pooled.get(key);
    pooled.set(key, old ? { ...old, annualCost: old.annualCost + policy.annualCost } : policy);
  }
  return [...pooled.values()].reduce((sum, policy) => sum + supplyResponse(initial, policy, year, p, realized), 0);
}

export function supplyRecords(cases: Record<string, SupplyCase>): SourceValue[] {
  const labels: Record<string, string> = { additionality: '純追加性', lag: '効果までの年数', depreciation: '年間減耗率', lifetime: '効果期間', yield: '効果係数', unitCost: '単位費用・基準資本比', employment: '就労・常勤換算', maintenanceRate: '年間保守費率', maintenanceImportShare: '保守費の輸入割合', generationOverlapShare: '追加再エネと重複し得る便益' };
  return Object.entries(cases).flatMap(([id, c]) => Object.entries(c).filter(([, v]) => typeof v === 'number').map(([key, value]) => ({
    key: `supply.${id}.${key}`, value: value as number,
    unit: key === 'lag' || key === 'lifetime' ? '年' : key === 'unitCost' && ['education', 'childcare'].includes(c.kind) ? '円/人年' : '比率・換算係数',
    referenceYear: `政策別供給シナリオ・${labels[key]}`, sourceName: SUPPLY_CASES[id].label,
    sourceUrl: SUPPLY_CASES[id].source, status: 'assumption' as const,
    uncertaintyNote: `${SUPPLY_CASES[id].evidence} ${SUPPLY_CASES[id].formula} 係数・時期は変更可能な条件で、信頼区間ではない。`,
  })));
}
