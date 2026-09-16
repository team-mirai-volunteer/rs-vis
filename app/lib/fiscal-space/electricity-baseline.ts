import type { SourceValue } from '@/types/fiscal-space';

export const ELECTRICITY_DEMAND_SOURCE = 'https://www.occto.or.jp/assets/news/juyousoutei/260121_juyousoutei_r1.pdf';
export const ELECTRICITY_ACTUAL_SOURCE = 'https://www.meti.go.jp/press/2026/04/20260414001/20260414001.html';
export interface ElectricityBaselineCase {
  generationTwh: number; thermalShare: number; demandGrowth: number; peakGrowth: number;
  nonThermalDecline: number; plannedNonThermalTwh: number; fuelImportYenPerKwh: number;
  /** Share of additional policy electricity met by imported-fuel thermal generation. An assumption, not dispatch. */
  marginalThermalShare: number;
}
export const ELECTRICITY_BASELINE: ElectricityBaselineCase = {
  generationTwh: 991.1, thermalShare: .675, demandGrowth: .005, peakGrowth: .004,
  nonThermalDecline: 0, plannedNonThermalTwh: 0, fuelImportYenPerKwh: 9, marginalThermalShare: 1,
};

/** Common no-additional-policy electricity service, at fixed initial prices.
 * Planned additions are annual generation additions, not installed GW.
 * Thermal dispatch meets residual demand; no free new firm capacity is created. */
export function electricityBaseline(c: ElectricityBaselineCase, year: number) {
  if (!Number.isInteger(year) || year < 0 || Object.values(c).some(v => !Number.isFinite(v)) || c.generationTwh <= 0
    || c.thermalShare < 0 || c.thermalShare > 1 || c.demandGrowth <= -1 || c.peakGrowth <= -1
    || c.nonThermalDecline < 0 || c.nonThermalDecline > 1 || c.plannedNonThermalTwh < 0 || c.fuelImportYenPerKwh < 0
    || c.marginalThermalShare < 0 || c.marginalThermalShare > 1) throw new RangeError('Invalid common electricity pathway');
  const demandTwh = c.generationTwh * (1 + c.demandGrowth) ** year;
  const nonThermalTwh = c.generationTwh * (1 - c.thermalShare) * (1 - c.nonThermalDecline) ** year + c.plannedNonThermalTwh * year;
  const thermalTwh = Math.max(0, demandTwh - nonThermalTwh);
  const initialThermalTwh = c.generationTwh * c.thermalShare;
  return { demandTwh, nonThermalTwh, thermalTwh, thermalIncreaseTwh: thermalTwh - initialThermalTwh,
    fuelBill: thermalTwh * 1e9 * c.fuelImportYenPerKwh,
    initialFuelBill: initialThermalTwh * 1e9 * c.fuelImportYenPerKwh,
    additionalFuelBill: (thermalTwh - initialThermalTwh) * 1e9 * c.fuelImportYenPerKwh };
}

export function electricityRecords(c: ElectricityBaselineCase): SourceValue[] {
  return Object.entries(c).map(([key, value]) => ({ key: `parameters.electricity.${key}`, value,
    unit: key.endsWith('Twh') ? 'TWh（10億kWh）' : key === 'fuelImportYenPerKwh' ? '円/kWh' : '比率',
    referenceYear: ['generationTwh', 'thermalShare'].includes(key) ? '2024年度実績を参考' : key === 'marginalThermalShare' ? '政策の追加電力の供給仮定' : '共通の将来経路',
    status: 'assumption', sourceName: '電力需給の共通シナリオ',
    sourceUrl: ['generationTwh', 'thermalShare'].includes(key) ? ELECTRICITY_ACTUAL_SOURCE : ELECTRICITY_DEMAND_SOURCE,
    uncertaintyNote: '発電量991.1TWh・火力67.5%は2024年度確報。需要増0.5%・ピーク増0.4%は2026年度OCCTO想定の平均伸びを参考にした一定率の仮定。使用端の伸びを発電量に適用し、年度別公表値の再現ではない。非化石減少率と既定の追加量は未校正で初期値0。燃料輸入単価9円/kWhも仮定。追加政策と別の経路として全シナリオへ適用。',
  }));
}
