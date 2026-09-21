import type { Inputs, SourceValue } from '@/types/fiscal-space';

export const CAPACITY_SOURCES = {
  hours: 'https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040267840&fileKind=0',
  people: 'https://www.stat.go.jp/data/roudou/sokuhou/nen/dt/pdf/gaiyou.pdf',
  equipment: 'https://www.meti.go.jp/statistics/tyo/iip/result/pdf/press/b2020_202510nj.pdf',
};
// Fixed 2024 vintage. All-industry aggregate hours avoids multiplying an average
// excluding absent workers by employment including absent workers.
export const CAPACITY_DATA = {
  weeklyHours: 23.72e8, averageWeeklyHours: 36.3,
  unemployed: 195e4, potentialWorkers: 33e4, underemployed: 190e4,
  equipmentIndex: 101.4, equipmentReference: 108.1,
};
export interface CapacityCalibration {
  mode: 'manual' | 'estimated';
  unemployedRealization: number;
  potentialRealization: number;
  newWorkerHours: number;
  extraWeeklyHours: number;
  manufacturingWeight: number;
  equipmentRecovery: number;
}
export const CAPACITY_DEFAULTS: CapacityCalibration = {
  mode: 'manual', unemployedRealization: .5, potentialRealization: .5,
  newWorkerHours: 30, extraWeeklyHours: 5, manufacturingWeight: .2, equipmentRecovery: 1,
};
export const CAPACITY_BOUNDS = {
  unemployedRealization: [0, 1], potentialRealization: [0, 1], newWorkerHours: [0, 40],
  extraWeeklyHours: [0, 20], manufacturingWeight: [0, 1], equipmentRecovery: [0, 1],
} as const;

export function calibrateCapacity(c: CapacityCalibration, manual: Inputs, actualToPotential = 1) {
  if (!c || !['manual', 'estimated'].includes(c.mode)) throw new Error('Invalid capacity mode');
  for (const [key, [min, max]] of Object.entries(CAPACITY_BOUNDS)) {
    const value = c[key as keyof typeof CAPACITY_BOUNDS];
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`capacity.${key}`);
  }
  if (!Number.isFinite(actualToPotential) || actualToPotential <= 0) throw new RangeError('actualToPotential');
  const d = CAPACITY_DATA;
  const unemployedHours = d.unemployed * c.unemployedRealization * c.newWorkerHours;
  const participationHours = d.potentialWorkers * c.potentialRealization * c.newWorkerHours;
  // Underemployed workers are already employed: add hours, never their headcount.
  const additionalHours = d.underemployed * c.extraWeeklyHours;
  const labour = 1 + (unemployedHours + participationHours + additionalHours) / d.weeklyHours;
  // IIP is an index, NOT a percentage utilization. Only use a same-vintage ratio.
  const manufacturingSlack = Math.max(0, d.equipmentReference / d.equipmentIndex - 1);
  const capital = 1 + manufacturingSlack * c.equipmentRecovery * c.manufacturingWeight;
  const estimated = { ...manual, labour: labour * actualToPotential, capital: capital * actualToPotential };
  return { inputs: c.mode === 'estimated' ? estimated : { ...manual }, estimated,
    unemployedHours, participationHours, additionalHours, manufacturingSlack };
}

export function capacityCalibrationRecords(c: CapacityCalibration, manual: Inputs, actualToPotential = 1): SourceValue[] {
  const result = calibrateCapacity(c, manual, actualToPotential);
  const record = (key: string, value: number, unit: string, sourceUrl: string, note: string): SourceValue => ({
    key: `capacity.${key}`, value, unit, referenceYear: '2024年', sourceName: '最大生産能力の参考校正',
    sourceUrl, status: 'verified', uncertaintyNote: `${note} 2026-09-21確認。両データセットで2024年を使用。`,
  });
  const records = [
    record('weeklyHours', CAPACITY_DATA.weeklyHours, '時間/週', CAPACITY_SOURCES.hours, '労働力調査年報 I-A-12・BU19（全産業・男女計）。2025-04-01公表。'),
    record('averageWeeklyHours', CAPACITY_DATA.averageWeeklyHours, '時間/週', CAPACITY_SOURCES.hours, '同表AR19。平均時間は表示用で、分母には延週間就業時間を使用。'),
    record('unemployed', CAPACITY_DATA.unemployed, '人', CAPACITY_SOURCES.people, '2025年詳細集計の2024年比較値（6頁）。1か月以内に求職した失業者で、基本集計の完全失業者と異なる。'),
    record('potentialWorkers', CAPACITY_DATA.potentialWorkers, '人', CAPACITY_SOURCES.people, '同6頁の2024年値。就業者・失業者を含まない潜在労働力人口。'),
    record('underemployed', CAPACITY_DATA.underemployed, '人', CAPACITY_SOURCES.people, '同6頁の2024年値。週35時間未満で追加就労を希望し、追加できる就業者。'),
    record('equipmentIndex', CAPACITY_DATA.equipmentIndex, '指数（2020年=100）', CAPACITY_SOURCES.equipment, '2025年10月資料掲載の2024暦年・製造工業稼働率原指数。100は完全稼働ではない。'),
    { ...record('equipmentReference', CAPACITY_DATA.equipmentReference, '指数（2020年=100）', CAPACITY_SOURCES.equipment, '同じ資料の2022暦年値を参照水準として選択。物理的最大能力ではない。'), referenceYear: '2022年' },
    ...Object.keys(CAPACITY_BOUNDS).map(key => ({ key: `capacity.${key}`, value: c[key as keyof typeof CAPACITY_BOUNDS], unit: key.includes('Hours') ? '時間/週' : '比率', referenceYear: 'シナリオ設定', sourceName: '利用者が変更できる校正仮定', sourceUrl: null, status: 'assumption' as const, uncertaintyNote: '職種・地域・技能の適合、追加時間、非製造業への換算範囲は実証推定していない。' })),
  ];
  if (c.mode === 'estimated') records.push(...(['labour', 'capital'] as const).map(key => ({
    key: `capacity.${key}`, value: result.inputs[key], unit: '倍', referenceYear: '2024年の比率を初期状態へ適用',
    sourceName: '公表統計＋実現割合等の仮定による参考校正', sourceUrl: key === 'labour' ? CAPACITY_SOURCES.hours : CAPACITY_SOURCES.equipment,
    status: 'estimated' as const, uncertaintyNote: '現在のGDPを基準とする余力比率を、実質GDP÷潜在GDPで投入指数の基準へ換算。最新年月の観測ではなく、全産業の最大能力の実測値でもない。エネルギー・中間財は手動仮定。',
  })));
  return records;
}
