import type { SourceValue } from '@/types/fiscal-space';
import type { JapanDataset } from './japan-data';

export const MONEY_STOCK_CHECKED = '2026-09-21';
export const MONEY_STOCK_DEFINITION_URL = 'https://www.boj.or.jp/statistics/outline/exp/faqms.htm';
const SOURCE_URL = 'https://www.stat-search.boj.or.jp/ssi/mtshtml/md02_m_1.html';

export const MONEY_STOCK_DEFINITIONS: Record<string, string> = {
  'context.moneyM1': '現金通貨＋普通預金などの預金通貨。対象は全預金取扱機関。',
  'context.moneyM2': '現金通貨＋預金通貨＋定期預金などの準通貨＋譲渡性預金。対象は国内銀行・信用金庫など（ゆうちょ銀行などを除く）。',
  'context.moneyM3': 'M2と同じ通貨の種類を、ゆうちょ銀行・農協などを含む全預金取扱機関で集計。',
};

// BOJ MD02 monthly series: MAM1NAM3M1MO / MAM1NAM2M2MO / MAM1NAM3M3MO.
// Balances in 100 million yen; YoY in percent (MAM1YA... series).
// Fixed snapshots of the revised series, checked 2026-09-21. Reference data only.
export function moneyStockRecords(dataset: JapanDataset): SourceValue[] {
  const latest = dataset === 'latest';
  const values = latest
    ? [[10874678, -.1], [12963895, 2.0], [16399878, 1.2]]
    : [[10969519, 1.3], [12576036, 1.3], [16097395, .8]];
  return values.flatMap(([balance, yoy], index) => {
    const key = `context.moneyM${index + 1}`;
    const common = {
      referenceYear: latest ? '2026年8月（月中平均・速報）' : '2024年12月（月中平均）',
      publishedAt: '2026-09-09', sourceName: '日本銀行 マネーストック・月次時系列（改定反映）',
      sourceUrl: SOURCE_URL, status: 'verified' as const,
      uncertaintyNote: `${MONEY_STOCK_DEFINITIONS[key]}季節調整前。月末残高・年平均ではない。公表日は採用系列の最終更新日。${MONEY_STOCK_CHECKED}確認。参考観測値で、政策後の通貨量は未推計。`,
    };
    return [
      { ...common, key, value: balance * 1e8, unit: '円（月中平均残高）' },
      { ...common, key: `${key}Yoy`, value: yoy / 100, unit: '比率（前年同月比）' },
    ];
  });
}
