import { TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { PERSONAL_TAX_REVENUE } from '@/app/lib/fiscal-space/policy-limits';
import type { ModelParameters } from '@/types/fiscal-space';

/**
 * 減税の「制度の言葉」での入力（税率・控除額・保険料率）と、エンジンが受け取る年間減収額（兆円）の換算。
 * エンジンは円だけを扱い、ここは表示と入力の換算に限る。1単位あたりの減収額は公表値・試算からの線形近似で、
 * 制度の細部（所得制限・段階的な上乗せ・労使の負担割合）による非線形は扱わない。
 */
export interface Instrument {
  key: string;
  label: string;
  /** rate: 現行税率から引き下げた後の税率を入力 / amount: 引下げ・引上げの幅を入力 */
  mode: 'rate' | 'amount';
  unit: string;
  /** rate のときの現行税率（%） */
  current?: number;
  step: number;
  /** 1単位（税率1ポイント・控除1万円・保険料率1ポイント）あたりの年間減収額（円） */
  yenPerUnit: number;
  note: string;
  sourceUrl: string;
  sourceLabel: string;
}

/** 健康保険料率（労使合計）1ポイント：協会けんぽ 11兆0546億円÷10.00%（2025年度決算）＋健康保険組合 9兆1444億円÷9.31%（2024年度決算見込み） */
export const HEALTH_INSURANCE_YEN_PER_POINT = 1.105e12 + .982e12;
/** 厚生年金保険料率（労使合計）1ポイント：厚生年金勘定の保険料収入 37兆6782億円÷18.3%（2025年度決算・共済分を除く） */
export const PENSION_INSURANCE_YEN_PER_POINT = 2.059e12;
/** 所得税の基礎控除1万円の引上げ：大和総研の試算（75万円の引上げで所得税3.3兆円の減収）の線形換算 */
export const BASIC_ALLOWANCE_YEN_PER_MAN = 3.3e12 / 75;

export function instrumentsFor(policyId: string, p: ModelParameters): Instrument[] {
  switch (policyId) {
    case 'consumption-tax': return [{
      key: 'standard-rate', label: '標準税率', mode: 'rate', unit: '%', current: p.consumptionTax.baseRate * 100, step: .1,
      yenPerUnit: p.consumptionTax.revenuePerPoint,
      note: '外食・酒類・日用品などの税率です。1ポイントの減収額は、国と地方の消費税収（2026年度約34兆円）から飲食料品の分（約5兆円）を除き、10で割った値です。',
      sourceUrl: 'https://www.mof.go.jp/tax_information/qanda022.html', sourceLabel: '財務省「消費税の使途」',
    }];
    case 'consumption-tax-reduced': return [{
      key: 'reduced-rate', label: '軽減税率（飲食料品・定期購読新聞）', mode: 'rate', unit: '%', current: p.reducedConsumptionTax.baseRate * 100, step: .1,
      yenPerUnit: p.reducedConsumptionTax.revenuePerPoint,
      note: '1ポイントの減収額は、財務省試算として報じられた「飲食料品の税率ゼロで年約5兆円」を8で割った値です。外食・酒類は標準税率のままです。',
      sourceUrl: 'https://www.dir.co.jp/report/research/economics/japan/20260120_025533.html', sourceLabel: '大和総研（食料品の消費税ゼロの減収試算）',
    }];
    case 'resident-tax': return [{
      key: 'resident-rate', label: '個人住民税所得割の税率', mode: 'rate', unit: '%', current: 10, step: .1,
      yenPerUnit: PERSONAL_TAX_REVENUE['resident-tax'].amount / 10,
      note: '標準税率10%（道府県4%・市町村6%）を一律に下げる場合です。1ポイントの減収額は入力上限と同じ2024年度の所得割収入を10で割った値で、定額減税で押し下げられた年のため、2026年度見込み（約14.5兆円）で換算すると1ポイント約1.45兆円になります。',
      sourceUrl: 'https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/pdf/ichiran06_r08/ichiran06_r08_01.pdf', sourceLabel: '総務省「地方税に関する参考計数資料」',
    }];
    case 'income-tax': return [{
      key: 'basic-allowance', label: '基礎控除の引上げ（所得税）', mode: 'amount', unit: '万円', step: 1,
      yenPerUnit: BASIC_ALLOWANCE_YEN_PER_MAN,
      note: '「103万円の壁」の議論の中心です。10万円の引上げで約0.44兆円の減収として線形換算します。住民税の基礎控除（43万円）は変わらないため、住民税の軽減は住民税減税に入力してください。所得制限や低所得層だけの上乗せにすると減収は小さくなります（令和7年度改正は約0.55兆円）。',
      sourceUrl: 'https://www.dir.co.jp/report/research/law-research/tax/20241204_024777.pdf', sourceLabel: '大和総研（基礎控除178万円案の減収試算）',
    }];
    case 'social-insurance': return [{
      key: 'health-rate', label: '健康保険料率の引下げ（労使合計）', mode: 'amount', unit: 'ポイント', step: .1,
      yenPerUnit: HEALTH_INSURANCE_YEN_PER_POINT,
      note: '協会けんぽ（平均10.0%）と健康保険組合（平均9.3%）の料率を同じ幅だけ下げる場合です。共済組合・国民健康保険・介護保険料は含みません。',
      sourceUrl: 'https://www.kyoukaikenpo.or.jp/assets/r7kessangaiyou_1.pdf', sourceLabel: '協会けんぽ決算・健保連決算見込み',
    }, {
      key: 'pension-rate', label: '厚生年金保険料率の引下げ（労使合計）', mode: 'amount', unit: 'ポイント', step: .1,
      yenPerUnit: PENSION_INSURANCE_YEN_PER_POINT,
      note: '現行18.3%を下げる場合です。共済組合（公務員等）の分は含みません。本人・事業主の負担割合は「乗数・税収・労働反応の条件」の配分に従います。',
      sourceUrl: 'https://www.mhlw.go.jp/content/12501000/001728152.pdf', sourceLabel: '厚生労働省 年金特別会計の決算',
    }];
    default: return [];
  }
}

/** 入力値（税率・幅）→ 兆円。rate は現行税率からの引下げ幅で換算する */
export const instrumentToAmount = (i: Instrument, value: number) =>
  (i.mode === 'rate' ? Math.max(0, (i.current ?? 0) - value) : Math.max(0, value)) * i.yenPerUnit / TRILLION;
/** 兆円 → 入力値 */
export const amountToInstrument = (i: Instrument, amountTrillion: number) => {
  const units = amountTrillion * TRILLION / i.yenPerUnit;
  return i.mode === 'rate' ? Math.max(0, (i.current ?? 0) - units) : units;
};
