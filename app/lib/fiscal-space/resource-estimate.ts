import type { EconomyState, Policy, PolicyLoad, ResourceAssumptions, Sector, SourceValue } from '@/types/fiscal-space';
import reference from './data/resource-reference.json';

export const RESOURCE_DEFAULTS: ResourceAssumptions = {
  mode: 'estimated', loadScale: 1, spendingShare: .6, priceIndex: 1.2,
  electricityPrice: 20, loadFactor: .6, coincidence: 1, operatingOutputRatio: .5,
  region: 'demand-share',
};
export const RESOURCE_REGIONS = ['北海道', '東北', '東京', '中部', '北陸', '関西', '中国', '四国', '九州', '沖縄'] as const;
export const RESOURCE_SECTORS = Object.keys(reference.sectorWorkers) as Sector[];
export const RESOURCE_REFERENCE = reference;
type Profile = keyof typeof reference.profiles;
const profiles: Record<string, Profile> = {
  'income-tax': 'household', 'resident-tax': 'household', 'consumption-tax': 'household',
  'social-insurance': 'household', cash: 'household', defence: 'government',
  'public-investment': 'public-investment', healthcare: 'healthcare', childcare: 'childcare',
  education: 'education', rd: 'rd', grid: 'grid', generation: 'generation', semiconductors: 'semiconductors',
};
export const RESOURCE_PROFILE_NOTES: Record<string, string> = {
  'income-tax': '家計の消費構成。軽減額のうち消費へ回る割合を別途仮定。',
  'resident-tax': '家計の消費構成。軽減額のうち消費へ回る割合を別途仮定。',
  'consumption-tax': '家計の消費構成。税率変更による品目別の差は未推計。',
  'social-insurance': '本人・事業主の軽減とも家計消費へ回る代理仮定。賃金転嫁・法人投資の内訳は未同定。',
  cash: '家計の消費構成。給付のうち消費へ回る割合を別途仮定。',
  defence: '一般政府消費の構成を代理使用。防衛装備の固有構成は未推計。',
  'public-investment': '公的固定資本形成の構成を使用。',
  healthcare: '医療部門への最終需要と、その上流の生産。',
  childcare: '社会保険・社会福祉部門を代理使用。現金給付部分の内訳は未推計。',
  education: '教育部門への最終需要と、その上流の生産。',
  rd: '研究部門への最終需要と、その上流の生産。',
  grid: 'その他土木60%・産業用電気機器30%・対事業所サービス10%の仮定。',
  generation: 'その他土木40%・産業用電気機器50%・対事業所サービス10%の仮定。',
  semiconductors: '建築30%・生産用機械60%・研究10%の仮定。稼働後は電子デバイス生産の電力原単位を代理使用。',
};

export function validateResourceAssumptions(c: ResourceAssumptions) {
  const bounds: Record<keyof Omit<ResourceAssumptions, 'mode' | 'region'>, [number, number]> = {
    loadScale: [.25, 2], spendingShare: [0, 1], priceIndex: [.8, 2], electricityPrice: [5, 50],
    loadFactor: [.2, 1], coincidence: [0, 1], operatingOutputRatio: [0, 2],
  };
  if (!['estimated', 'manual'].includes(c.mode) || (c.region !== 'demand-share' && !RESOURCE_REGIONS.includes(c.region))) throw new RangeError('Invalid resource scenario');
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const v = c[key as keyof typeof bounds];
    if (!Number.isFinite(v) || v < min || v > max) throw new RangeError(`Invalid resource assumption: ${key}`);
  }
}

/** Separate physical-demand diagnostic; never added to the calibrated GDP/CPI multipliers. */
export function estimatePolicyLoad(policy: Policy, initial: EconomyState, c: ResourceAssumptions): PolicyLoad | undefined {
  if (c.mode !== 'estimated') return undefined;
  const profile = profiles[policy.id];
  if (!profile) return undefined;
  const row = reference.profiles[profile];
  const scale = c.loadScale * (profile === 'household' ? c.spendingShare : 1);
  const workerYears = Object.fromEntries(RESOURCE_SECTORS.map(s => [s, row.workersPerTrillion[s] * scale])) as Record<Sector, number>;
  const sectorLoads = Object.fromEntries(RESOURCE_SECTORS.map(s => [s,
    workerYears[s] / reference.sectorWorkers[s] * initial.labour.sectorUtilization[s],
  ])) as Record<Sector, number>;
  // IO electricity purchases -> kWh -> GW at the assumed coincident peak.
  const gw = (yen: number) => yen / c.electricityPrice / 8760 / 1e6 / c.loadFactor * c.coincidence;
  return { estimated: true, sectorLoads, workerYears, priceIndex: c.priceIndex,
    sectorUtilizationPerTrillion: sectorLoads[policy.sector],
    peakGwPerTrillion: gw(row.electricityYenPerTrillion) * scale,
    operatingPeakGwPerTrillion: policy.id === 'semiconductors'
      ? gw(reference.profiles['semiconductor-operation'].electricityYenPerTrillion) * c.operatingOutputRatio * c.loadScale : 0,
    lag: policy.trade?.kind === 'industry' ? policy.trade.assumptions.lag : 2,
    lifetime: policy.trade?.kind === 'industry' ? policy.trade.assumptions.lifetime : 20,
    depreciation: policy.trade?.kind === 'industry' ? policy.trade.assumptions.depreciation ?? 0 : .03,
  };
}

/** Regional supply is BEFORE interconnector redistribution: a conservative scenario.
 * Reference demand already includes planned activity. Only extra policy demand is added.
 * January rows are alternatives, never summed with August rows. */
export function resourcePowerBalance(year: number, extraDemandGw: number, extraSupplyGw: number,
  c: ResourceAssumptions, capacityScale = 1, demandScale = 1) {
  const index = Math.min(Math.max(0, year), 9);
  const summer = reference.power.filter(r => r.season === '8月');
  const totalDemand = summer.reduce((s, r) => s + r.demandGw[index], 0);
  const totalSupply = summer.reduce((s, r) => s + r.supplyGw[index], 0) * capacityScale;
  const rows = reference.power.map(r => {
    const share = c.region === 'demand-share'
      ? summer.find(s => s.region === r.region)!.demandGw[index] / totalDemand : Number(c.region === r.region);
    const demandGw = r.demandGw[index] * demandScale + extraDemandGw * share;
    const supplyGw = r.supplyGw[index] * capacityScale + extraSupplyGw * share;
    return { region: r.region, season: r.season, demandGw, supplyGw, utilization: demandGw / supplyGw };
  });
  const binding = rows.reduce((a, b) => a.utilization >= b.utilization ? a : b);
  return { referenceYear: reference.powerStartYear + index, rows, ...binding,
    nationalDemandGw: totalDemand * demandScale + extraDemandGw, nationalSupplyGw: totalSupply + extraSupplyGw };
}

export function resourceRecords(c: ResourceAssumptions, policies: Policy[] = []): SourceValue[] {
  return [
    ...policies.filter(p => p.load?.estimated).flatMap(p => {
      const load = p.load!;
      const common = { referenceYear: '2020年構造・概算', sourceName: '全国産業連関表・雇用表と換算の仮定',
        sourceUrl: reference.sources['io-2020-108.xlsx'].url, status: 'derived' as const,
        uncertaintyNote: `${RESOURCE_PROFILE_NOTES[p.id]} 人員能力・購入価格・電力単価・ピーク換算は仮定。GDPへ重ねて加算しない。` };
      return [
        ...RESOURCE_SECTORS.flatMap(s => [
          { ...common, key: `resourceLoads.${p.id}.workers.${s}`, value: load.workerYears![s], unit: '人/2020年価格1兆円' },
          { ...common, key: `resourceLoads.${p.id}.sector.${s}`, value: load.sectorLoads![s], unit: '利用率増分/2020年価格1兆円' },
        ]),
        ...(['peakGwPerTrillion', 'operatingPeakGwPerTrillion'] as const).map(k => ({ ...common,
          key: `resourceLoads.${p.id}.${k}`, value: load[k]!, unit: 'GW/2020年価格1兆円',
          uncertaintyNote: common.uncertaintyNote + ' 半導体以外の稼働後負荷は0の仮定。' })),
        ...(['lag', 'lifetime', 'depreciation'] as const).map(k => ({ ...common,
          key: `resourceLoads.${p.id}.${k}`, value: load[k], unit: k === 'depreciation' ? '比率' : '年',
          status: 'assumption' as const, sourceUrl: null, sourceName: '稼働後負荷の仮定' })),
      ];
    }),
    ...RESOURCE_SECTORS.map(s => ({ key: `resourceReference.workers.${s}`, value: reference.sectorWorkers[s], unit: '人',
      referenceYear: '2020年', sourceName: '全国産業連関表・雇用表（108部門から6区分へ集約）',
      sourceUrl: reference.sources['employment-2020-108.xlsx'].url, status: 'derived' as const,
      uncertaintyNote: '従業者総数。人年・労働時間の実測値ではない。係数は2020年構造を固定。人員能力＝従業者数÷仮定した初期利用率。設備稼働率・職種別不足は別途未推計。' })),
    ...Object.entries(c).filter(([, v]) => typeof v === 'number').map(([key, v]) => ({ key: `resourceAssumptions.${key}`, value: v as number,
      unit: key === 'electricityPrice' ? '円/kWh' : '比率', referenceYear: '追加負荷の概算条件', sourceName: '換算の仮定',
      sourceUrl: null, status: 'assumption' as const,
      uncertaintyNote: '2020年産業連関表の国内生産波及と雇用係数から負荷を概算。価格補正・消費割合・電力単価・ピーク換算・稼働後生産比率は未推定。低位/高位は信頼区間ではない。' })),
    ...reference.power.flatMap(r => r.demandGw.flatMap((value, i) => ([
      { key: `resourcePower.${r.region}.${r.season}.${2026 + i}.demand`, value },
      { key: `resourcePower.${r.region}.${r.season}.${2026 + i}.supply`, value: r.supplyGw[i] },
    ].map(x => ({ ...x, unit: 'GW', referenceYear: `${2026 + i}年度見通し`, sourceName: 'OCCTO 2026年度供給計画 別紙2 表2-1〜2-4',
      sourceUrl: reference.sources['occto-2026.pdf'].url, publishedAt: '2026-03-30', status: 'verified' as const,
      uncertaintyNote: '公表の見通しであり実績ではない。連系線融通前の8月・一部地域の1月断面。月内の最小余力や確率的供給信頼度は再現しない。追加政策の地域配分と供給倍率は別の仮定。' }))))),
  ];
}
