import type { SourceValue } from '@/types/fiscal-space';
import type { JapanDataset } from './japan-data';

// Observations for comparison only. Do not carry these into future policy forecasts.
export const CONTEXT_CHECKED = '2026-09-15';
const CPI_2024 = 'https://www.e-stat.go.jp/stat-search/file-download?fileKind=2&statInfId=000040263552';
const CPI_LATEST = 'https://www.stat.go.jp/data/cpi/sokuhou/tsuki/pdf/zenkoku.pdf';
const FOOD = 'https://www.maff.go.jp/j/press/kanbo/anpo/260807.html';
export const FERTILIZER_SOURCE = 'https://www.maff.go.jp/j/seisan/sien/sizai/s_hiryo/attach/pdf/index-229.pdf';
export const OECD_DEBT_SOURCE = 'https://www.oecd.org/content/dam/oecd/en/topics/policy-sub-issues/economic-outlook/eo-dec-2025/EO118_Annexes_E.pdf';

export function japanContext(dataset: JapanDataset): Record<string, SourceValue> {
  const latest = dataset === 'latest';
  const cpi = (key: string, value: number, definition: string): SourceValue => ({
    key: `context.${key}`, value, unit: latest ? '比率（前年同月比）' : '比率（年平均の前年比）',
    referenceYear: latest ? '2026年7月' : '2024年平均', publishedAt: latest ? '2026-08-21' : '2025-01-24',
    sourceName: `総務省 全国CPI・${latest ? '2025' : '2020'}年基準`, sourceUrl: latest ? CPI_LATEST : CPI_2024,
    status: 'verified', uncertaintyNote: `${definition}。参考観測値であり、政策による将来の上昇率は未推計。${CONTEXT_CHECKED}確認。`,
  });
  const food = (key: string, value: number, definition: string): SourceValue => ({
    key: `context.${key}`, value, unit: '比率（国内生産 / 国内供給）',
    referenceYear: latest ? '2025年度（概算）' : '2024年度', publishedAt: '2026-08-07',
    sourceName: '農林水産省 令和7年度食料自給率・過年度比較表', sourceUrl: FOOD,
    status: latest ? 'estimated' : 'verified',
    uncertaintyNote: `${definition}。輸入飼料・原料を考慮。供給途絶時に確保できる量の試算ではありません。${CONTEXT_CHECKED}確認。`,
  });
  const records = [
    { key: 'context.ureaDomesticShare', value: .03, unit: '比率（尿素の国産割合・数量ベース）',
      referenceYear: '2024肥料年度（2024年7月〜2025年6月）', publishedAt: '2026-04',
      sourceName: '農林水産省 肥料をめぐる情勢・4頁', sourceUrl: FERTILIZER_SOURCE, status: 'verified' as const,
      uncertaintyNote: '公表丸め値3%。工業用を除く尿素の国産9千トン、輸入256千トン。肥料全体や窒素全体の自給率ではない。輸入天然ガス等への依存は控除しない。暦年・会計年度とは対象期間が異なるため両プリセットで肥料年度を明記。2026-09-15確認。' },
    cpi('coreCoreCpi', latest ? .019 : .024, 'コアコア＝生鮮食品及びエネルギーを除く総合。加工食品は含む'),
    cpi('foodCpi', latest ? .035 : .043, '10大費目の「食料」。生鮮食品・加工食品・酒類・外食を含む全国平均'),
    cpi('energyCpi', latest ? .006 : .038, '電気代・都市ガス代・プロパンガス・灯油・ガソリン。補助金・税制の影響を含み、輸入エネルギー価格とは異なる'),
    food('calorieSelfSufficiency', latest ? .37 : .38, '供給熱量（カロリー）ベース。摂取熱量ベースとは異なる'),
    food('valueSelfSufficiency', latest ? .66 : .64, '生産額（金額）ベース。国内価格の上昇でも高まるため、供給量の増加とは限らない'),
  ];
  return Object.fromEntries(records.map(r => [r.key, r]));
}

// OECD's published aggregate; not an unweighted mean of selected countries.
// Keep 2024 in both presets: do not substitute EO118's 2025–27 projections.
export const OECD_DEBT_RECORDS: SourceValue[] = [
  { key: 'context.oecdGrossLiabilities', value: 1.112, unit: '比率（GDP比）', referenceYear: '2024年',
    sourceName: 'OECD 経済見通し118・付表36 Total OECD', sourceUrl: OECD_DEBT_SOURCE, status: 'verified',
    uncertaintyNote: 'OECD公表集計。単純な国別平均ではない。金融負債は時価評価で、モデルのIMF額面債務と定義が異なる。同じ表の日本値222.0%と比較。2026-09-15確認。' },
  { key: 'context.oecdJapanGrossLiabilities', value: 2.220, unit: '比率（GDP比）', referenceYear: '2024年',
    sourceName: 'OECD 経済見通し118・付表36 Japan', sourceUrl: OECD_DEBT_SOURCE, status: 'verified',
    uncertaintyNote: 'OECD集計との比較用。時価等の定義差があるためモデルの額面総債務214.5%とは別掲。2026-09-15確認。' },
];
