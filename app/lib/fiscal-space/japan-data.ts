import type { SourceValue } from '@/types/fiscal-space';
import imf2026 from './data/imf-2026-projections.json';

/** Fixed statistical vintage. Never silently replace these with forecasts or live data. */
export const JAPAN_BASE_YEAR = 2024;
export const JAPAN_DATA_CHECKED = '2026-09-17';
export type JapanDataset = '2024' | 'latest';
export const JAPAN_DATASET_LABELS: Record<JapanDataset, string> = {
  '2024': '2024年で揃える', latest: '最新値を優先する',
};
const T = 1e12;
const GDP = 634.2 * T;
const IMF = 'https://www.imf.org/-/media/files/publications/cr/2026/english/1jpnea2026001.pdf';
const SNA = 'https://www.esri.cao.go.jp/jp/sna/data/data_list/kakuhou/files/2024/sankou/pdf/kanjo_taikei.pdf';
const LABOUR = 'https://www.e-stat.go.jp/stat-search/file-download?fileKind=2&statInfId=000040244967';
const CPI = 'https://www.stat.go.jp/info/t-news/pdf/2503.pdf';
const ENERGY = 'https://www.enecho.meti.go.jp/statistics/total_energy/pdf/honbun2024fykaku.pdf';
const record = (key: string, value: number, unit: string, sourceName: string, sourceUrl: string,
  uncertaintyNote: string, status: SourceValue['status'] = 'verified', referenceYear = '2024年'): SourceValue =>
  ({ key: `initial.${key}`, value, unit, referenceYear, sourceName, sourceUrl, status, uncertaintyNote });
const fiscal = (key: string, ratio: number, note: string) => record(`fiscal.${key}`, GDP * ratio, '円',
  'IMF 2026年対日4条協議 表4（2024年実績欄）', IMF,
  `一般政府。GDP比の公表値×名目GDP 634.2兆円で換算。丸め誤差を含みます。${note}`, 'derived');
const external = (key: string, billions: number, note: string, status: SourceValue['status'] = 'verified') =>
  record(`external.${key}`, billions * 1e9, '円', '内閣府 2024年SNA 勘定体系群', SNA, note, status);

export const JAPAN_RECORDS: SourceValue[] = [
  record('macro.nominalGdp', GDP, '円', 'IMF 2026年対日4条協議 表4', IMF, '内閣府GDPの2024暦年値。2020年基準。公表桁は0.1兆円。'),
  record('macro.realGdp', GDP, '円', 'IMF 2026年対日4条協議 表4', IMF, 'モデルの価格基準を2024年に置き、年0の実質GDPを名目GDPと同額に正規化。公表された2020年連鎖価格の実質額ではありません。', 'derived'),
  record('macro.potentialGdp', GDP, '円', 'IMF 2026年対日4条協議 表1', IMF, '2024年の需給ギャップ推計0.0%から設定。潜在GDPは観測できない推計値です。', 'estimated'),
  record('macro.realGrowth', -.002, '比率（1 = 100%）', 'IMF 2026年対日4条協議 表1', IMF, '2024暦年の実質GDP成長率。将来成長率の仮定とは別です。'),
  record('macro.nominalGrowth', 634.2 / 616 - 1, '比率（1 = 100%）', 'IMF 2026年対日4条協議 表4', IMF, '2024年634.2兆円÷2023年616.0兆円−1。公表額の丸めを含みます。', 'derived'),
  record('macro.inflation', .027, '比率（1 = 100%）', '総務省 消費者物価指数 2024年平均', CPI, '全国・総合の前年比。GDPデフレーターとは異なります。'),
  record('macro.coreInflation', .025, '比率（1 = 100%）', '総務省 消費者物価指数 2024年平均', CPI, '全国・生鮮食品を除く総合の前年比。'),
  fiscal('taxRevenue', .201 + .131, '税（罰金を含む）20.1%＋社会負担13.1%。画面では「税・社会負担収入」と表示。'),
  fiscal('taxes', .201, '税（罰金を含む）。所得税・住民税・消費税の減税はこの区分から控除。'),
  fiscal('socialContributions', .131, '社会負担（社会保険料）。社会保険料減税はこの区分から控除し、弾性値も別に設定。'),
  fiscal('otherPrimaryRevenue', .356 - .201 - .131 - .013, '総収入35.6%から税・社会負担・受取利子1.3%を控除。内訳の丸め差をここで調整。'),
  fiscal('interestRevenue', .013, '受取利子。PBから除外し、資金調達需要から控除。'),
  fiscal('primaryExpenditure', .373 - .014, '総支出37.3%−支払利子1.4%。政府財政統計の非金融資産純投資を含む。'),
  fiscal('interestPayments', .014, '支払利子（受取利子を相殺する前）。'),
  fiscal('primaryBalance', -.016, '利子の受払を除くPB。黒字が正。'),
  record('fiscal.structuralPrimaryBalance', -.015 * GDP, '円', 'IMF 2026年対日4条協議 表4', IMF, '2024年の構造的PBは潜在GDP比−1.5%の推計値。2024年の潜在GDP＝GDPとして換算。', 'estimated'),
  fiscal('grossDebt', 2.145, '2024年末。連結・額面ベース。旧来の非連結・時価ベースの債務比率とは異なる。'),
  fiscal('financialAssets', 2.145 - 1.417, '純債務計算の控除対象資産＝総債務214.5%−純債務141.7%。株式等を含む金融資産総額119.6%とは異なる。'),
  fiscal('netDebt', 1.417, '2024年末の純債務。控除対象金融資産は時価評価。'),
  fiscal('liquidFinancialAssets', .2, '2024年末の現金・預金。全額を一般支出に使えるという意味ではありません。'),
  fiscal('liquidityAdjustedNetDebt', 2.145 - .2, '総債務−現金・預金。流動性を考慮したモデル上の指標。'),
  ...([
    ['labourForce', 69.57e6, '人', '15歳以上の労働力人口。'],
    ['employment', 67.81e6, '人', '就業者数。'],
    ['unemployment', 1.76e6, '人', '完全失業者数。'],
    ['participation', .633, '比率（1 = 100%）', '15歳以上人口に占める労働力人口の割合。'],
  ] as const).map(([key, value, unit, note]) => record(`labour.${key}`, value, unit, '総務省 労働力調査 2024年平均', LABOUR, note)),
  record('energy.primaryDemand', 100, '指数（基準年需要 = 100）', '資源エネルギー庁 2024年度エネルギー需給実績・確報', ENERGY, '一次エネルギー国内供給を100に正規化。物理量ではありません。', 'derived', '2024年度'),
  record('energy.domesticSupply', 16.3, '指数（基準年需要 = 100）', '資源エネルギー庁 2024年度エネルギー需給実績・確報', ENERGY, '自給率16.3%を指数へ換算。2026-04-14公表確報。原子力を国内産出に含む。', 'derived', '2024年度'),
  record('energy.importedEnergy', 100 - 16.3, '指数（基準年需要 = 100）', '資源エネルギー庁 2024年度エネルギー需給実績・確報', ENERGY, '需要100−国内産出16.3。純輸入等をまとめたモデル上の海外依存分であり、総輸入量の実測ではありません。', 'derived', '2024年度'),
  record('energy.importBill', 138.3 * 151.4 * 1e9, '円', 'IMF 2026年対日4条協議 表1', IMF, 'エネルギー輸入138.3十億ドル×年平均151.4円/ドル。公表値の丸めを含む概算。', 'derived'),
  external('exports', 139402.3, '1ページ 財貨・サービス輸出。SNAベース。'),
  external('imports', 145066.7, '1ページ 財貨・サービス輸入。SNAベース。'),
  external('tradeBalance', 139402.3 - 145066.7, '財貨・サービス輸出−輸入。財だけの貿易収支とは異なる。', 'derived'),
  external('goodsBalance', 105097.4 - 108757.6, '1ページ 財貨輸出−財貨輸入。', 'derived'),
  external('servicesBalance', (139402.3 - 145066.7) - (105097.4 - 108757.6), '財・サービス収支−財の収支。公表値の丸め差を含む。', 'derived'),
  external('primaryIncomeBalance', 671201.2 - 632598, '2ページ 第1次所得バランス（総）−1ページ 国内総生産（統計上の不突合を含まない）。', 'derived'),
  external('secondaryIncomeBalance', 7156.1 - 11408.1, '3ページ 海外とのその他経常移転の受取−支払。', 'derived'),
  external('currentAccount', 28686.8, '4ページ 海外部門の経常対外収支の符号を反転。SNAベースであり国際収支統計の経常収支とは異なる。'),
  record('external.niip', 533050 * 1e9, '円', '財務省 令和6年末本邦対外資産負債残高',
    'https://www.mof.go.jp/policy/international_policy/reference/iip/data/2024_g.htm',
    '2024年末の国際収支統計ベース。SNA対外残高とは定義が異なる。将来経路は経常収支だけを累積し、為替・価格の評価替えを省略。', 'verified', '2024年末'),
];

export const JAPAN_SOURCES = Object.fromEntries(JAPAN_RECORDS.map(r => [r.key, r]));
// Latest observations are a reviewed snapshot, not an automatic live feed.
const LATEST_GDP = 689.2 * T;
const QE = 'https://www.esri.cao.go.jp/jp/sna/data/data_list/sokuhou/files/2026/qe262_2/pdf/jikei_1.pdf';
const GAP = 'https://www5.cao.go.jp/keizai3/shihyo/2026/0901/1424.pdf';
const LATEST_CPI = 'https://www.stat.go.jp/data/cpi/sokuhou/tsuki/index-z.html';
const LATEST_LABOUR = 'https://www.stat.go.jp/data/roudou/sokuhou/tsuki/pdf/gaiyou.pdf';
export const LATEST_OUTPUT_GAP = .007; // Official sign: positive means excess demand.
const recent = (key: string, value: number, unit: string, referenceYear: string, publishedAt: string,
  sourceName: string, sourceUrl: string, note: string, status: SourceValue['status'] = 'verified'): SourceValue =>
  ({ ...record(key, value, unit, sourceName, sourceUrl, note, status, referenceYear), publishedAt });
const latestOverrides = [
  recent('macro.nominalGdp', LATEST_GDP, '円（季節調整済み年率）', '2026年4〜6月期', '2026-09-08',
    '内閣府 四半期別GDP速報・2次速報', QE, '名目GDP 689.2兆円。四半期の季節調整済み年率であり、2026年通年の実績・予測ではありません。'),
  recent('macro.realGdp', LATEST_GDP, '円（初期状態価格・年率）', '2026年4〜6月期', '2026-09-08',
    '内閣府 四半期別GDP速報・2次速報から正規化', QE, '初期状態の価格で実質GDP＝名目GDPに正規化。公表された2020年連鎖価格の実質額599.0兆円とは異なります。', 'derived'),
  recent('macro.potentialGdp', LATEST_GDP / (1 + LATEST_OUTPUT_GAP), '円（初期状態価格・年率）', '2026年4〜6月期', '2026-09-01',
    '内閣府 GDPギャップ推計（1次速報後）', GAP, '公表GDPギャップ＋0.7%＝（実際−潜在）/潜在。モデルの潜在GDPは初期実質GDP÷1.007。表示・操作・年次推計も同じ符号です。GDP水準は9月8日の2次速報、ギャップは9月1日の最新公表推計を組み合わせています。', 'estimated'),
  recent('macro.realGrowth', (1 + .004) ** 4 - 1, '比率（年率換算）', '2026年4〜6月期', '2026-09-08',
    '内閣府 四半期別GDP速報・2次速報', QE, '公表前期比＋0.4%を（1＋0.004）^4−1で年率換算。丸め誤差を含む参考値。将来成長率の仮定とは別です。', 'derived'),
  recent('macro.nominalGrowth', (1 + .013) ** 4 - 1, '比率（年率換算）', '2026年4〜6月期', '2026-09-08',
    '内閣府 四半期別GDP速報・2次速報', QE, '公表前期比＋1.3%を（1＋0.013）^4−1で年率換算。丸め誤差を含む参考値。', 'derived'),
  recent('macro.inflation', .019, '比率（前年同月比）', '2026年7月', '2026-08-21',
    '総務省 全国CPI・2025年基準', LATEST_CPI, '全国・総合＋1.9%。単月の前年同月比であり年平均ではありません。GDPデフレーターとは異なります。'),
  recent('macro.coreInflation', .018, '比率（前年同月比）', '2026年7月', '2026-08-21',
    '総務省 全国CPI・2025年基準', LATEST_CPI, '全国・生鮮食品を除く総合＋1.8%。'),
  ...([
    ['labourForce', 70.19e6, '人', '15歳以上の労働力人口。'],
    ['employment', 68.50e6, '人', '就業者数。'],
    ['unemployment', 1.69e6, '人', '完全失業者数。'],
    ['participation', .641, '比率（1 = 100%）', '15歳以上人口に占める労働力人口の割合。'],
  ] as const).map(([key, value, unit, note]) => recent(`labour.${key}`, value, unit, '2026年7月', '2026-08-28',
    '総務省 労働力調査（基本集計）', LATEST_LABOUR, `原数値（季節調整なし）。${note}`)),
  recent('external.niip', 561087 * 1e9, '円', '2026年6月末', '2026-09-08',
    '財務省 対外資産負債残高・一次推計', 'https://www.mof.go.jp/policy/international_policy/reference/iip/202607a.pdf',
    '四半期の参考推計。SNA対外残高とは定義が異なります。将来経路はSNA経常収支を累積する近似で、為替・価格の評価替えを省略。', 'estimated'),
];
/** 2026 general-government ratios (IMF projection column) × the latest annualized nominal GDP.
 * This bridges the 2024 fiscal accounts to the GDP vintage instead of mixing years in one ratio. */
const IMF_2026 = imf2026.rows as Record<string, Record<'2024' | '2025' | '2026', number>>;
const ratio2026 = (row: string) => IMF_2026[row]['2026'] / 100;
const bridged = (key: string, ratio: number, note: string): SourceValue => recent(`fiscal.${key}`, ratio * LATEST_GDP, '円', '2026年（推計）', imf2026.retrievedOn as string,
  'IMF 2026年対日4条協議 表4（2026年推計欄）×最新名目GDP', imf2026.url as string,
  `一般政府。IMFの2026年推計比率${(ratio * 100).toFixed(1)}%×季節調整済み年率の名目GDP ${(LATEST_GDP / T).toFixed(1)}兆円。2024年実績を年次接続する橋渡し推計で、実績ではありません。${note}`, 'estimated');
const bridgedTaxes = ratio2026('taxes'), bridgedSocial = ratio2026('socialContributions');
const bridgedPrimaryExpenditure = ratio2026('totalExpenditure') - ratio2026('interestPaid');
const bridgedOtherRevenue = ratio2026('totalRevenue') - bridgedTaxes - bridgedSocial - ratio2026('interestIncome');
const latestFiscal = [
  bridged('taxRevenue', bridgedTaxes + bridgedSocial, '税＋社会負担。'),
  bridged('taxes', bridgedTaxes, '税（罰金を含む）。'),
  bridged('socialContributions', bridgedSocial, '社会負担。'),
  bridged('otherPrimaryRevenue', bridgedOtherRevenue, '総収入−税・社会負担−受取利子。'),
  bridged('interestRevenue', ratio2026('interestIncome'), '受取利子。'),
  bridged('primaryExpenditure', bridgedPrimaryExpenditure, '総支出−支払利子。'),
  bridged('interestPayments', ratio2026('interestPaid'), '支払利子。'),
  bridged('primaryBalance', ratio2026('primaryBalance'), '収入と支出の推計比率から計算した値と一致します。'),
  bridged('structuralPrimaryBalance', ratio2026('primaryBalance') - (bridgedTaxes + bridgedSocial) * LATEST_OUTPUT_GAP, 'IMFは構造的PBの2026年推計を表4に載せていないため、PB−税・社会負担比率×GDPギャップ0.7%で近似。'),
  bridged('grossDebt', ratio2026('grossDebt'), '2026年末推計。連結・額面ベース。'),
  bridged('netDebt', ratio2026('netDebt'), '2026年末推計。'),
  bridged('financialAssets', ratio2026('grossDebt') - ratio2026('netDebt'), '総債務−純債務。'),
  bridged('liquidFinancialAssets', .2, '現金・預金の2026年推計はないため2024年のGDP比20%を据え置き。'),
  bridged('liquidityAdjustedNetDebt', ratio2026('grossDebt') - .2, '総債務−現金・預金（2024年比率据え置き）。'),
];
const overrides = Object.fromEntries([...latestOverrides, ...latestFiscal].map(r => [r.key, r]));
export const JAPAN_LATEST_RECORDS: SourceValue[] = JAPAN_RECORDS.map(r => overrides[r.key] ?? {
  ...r,
  retainedReason: r.key.startsWith('initial.external.')
      ? '輸出入・所得・移転・経常収支をSNAの同じ勘定体系で揃えるため2024年を継続採用。'
      : 'エネルギー需給の最新確報は2024年度。輸入費も同じ基準年の概算を継続採用。',
});
const latestSources = Object.fromEntries(JAPAN_LATEST_RECORDS.map(r => [r.key, r]));
export const japanSources = (dataset: JapanDataset = '2024'): Record<string, SourceValue> =>
  dataset === 'latest' ? latestSources : JAPAN_SOURCES;
export const japanValue = (key: string, dataset: JapanDataset = '2024'): number => {
  const record = japanSources(dataset)[`initial.${key}`];
  if (!record) throw new Error(`Missing Japan baseline: ${key}`);
  return record.value;
};

export const SOURCE_STATUS_LABELS: Record<SourceValue['status'], string> = {
  verified: '公表実績', derived: '実績から換算', estimated: '推計', assumption: '仮定・設定',
};
