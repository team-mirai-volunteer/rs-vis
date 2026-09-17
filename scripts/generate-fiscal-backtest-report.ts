import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import data from '../tests/fixtures/fiscal-backtest/jsna-2024-fiscal-years.json';
import imf from '../tests/fixtures/fiscal-backtest/imf-2026-table4.json';
import { PARAMETERS } from '../app/lib/fiscal-space/assumptions';
import { backtestRevenue } from './lib/fiscal-revenue-backtest';

const elasticities = [...new Set([1, 1.1, PARAMETERS.taxRevenueElasticity, 1.7])].sort();
const result = backtestRevenue(data.rows, elasticities, [1, 3, 5]);
const previousCalendarCheck = { data: imf, ...backtestRevenue(imf.rows, elasticities) };
const current = result.summaries.find(r => r.horizon === 1 && r.method === `elasticity-${PARAMETERS.taxRevenueElasticity}`)!;
const fixtureSha256 = createHash('sha256').update(readFileSync('tests/fixtures/fiscal-backtest/jsna-2024-fiscal-years.json')).digest('hex');
for (const source of data.sources) {
  const hash = createHash('sha256').update(readFileSync(`tests/fixtures/fiscal-backtest/${source.file}`)).digest('hex');
  if (hash !== source.sha256) throw new Error(`Source hash mismatch: ${source.file}`);
}
const periods = [[1995, 2004], [2005, 2014], [2015, 2024]].flatMap(([from, to]) => elasticities.map(elasticity => {
  const cases = result.cases.filter(r => r.horizon === 1 && r.target >= from && r.target <= to && r.elasticity === elasticity);
  const mean = (fn: (r: typeof cases[number]) => number) => cases.reduce((sum, r) => sum + fn(r), 0) / cases.length;
  return { from, to, elasticity, count: cases.length, maeTrillion: mean(r => Math.abs(r.error)), biasTrillion: mean(r => r.error),
    mapePercent: mean(r => Math.abs(r.errorPercent)) };
}));
const n = (v: number) => v.toFixed(2);
const comparisons = [1, 3, 5].map(horizon => {
  const candidates = result.summaries.filter(r => r.horizon === horizon && r.method !== 'unchanged');
  return candidates.reduce((best, row) => row.maeTrillion < best.maeTrillion ? row : best);
});
const report = `# 税・社会保険料収入の条件付きバックテスト

再生成：\`npm run backtest:fiscal-space\`。入力・全結果：[JSON](fiscal-space-backtest-results.json)。

## 検証の対象

現行シミュレータと共有する収入式に実績名目GDPを与え、一般政府の税（罰金を含む）＋社会負担収入を比較する。既定の税収弾性値${PARAMETERS.taxRevenueElasticity}は変更しない。実績と政府の慎重な見通しのバランスを取るという設計判断であり、政府公認値やこの検証からの推定値とは扱わない。

**1994～2024年度の31年分へ拡張**。出典：[${data.source}](${data.url})。全期間を同じ年次推計・基準に揃えた。GFSの「11 税」に「143 科料・罰金及び追徴金」を加え、「12 社会負担」と合算。GDPも同資料の年度値を使う。単位10億円を兆円へ換算し、対GDP比の丸めは加えない。

前回のIMF 2022～2024年は暦年、今回は日本の年度（4月～翌3月）。値を接合せず別系列で検証する。前回の結果もJSONの\`previousCalendarCheck\`に保存した。集計定義と統計改定の差もあるため、結果の差を期間拡張だけの効果とみなさない。

各起点の観測収入から予測し、途中年の収入で更新しない。1年先30件、3年先28件、5年先26件。期間は別集計し、重複する起点・対象年を独立な標本とは扱わない。係数の再推定は行わない。

## 誤差（予測−実績、兆円）

| 期間 | 方法 | 件数 | MAE | バイアス | RMSE | MAPE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${result.summaries.map(r => `| ${r.horizon}年先 | ${r.method} | ${r.count} | ${n(r.maeTrillion)} | ${n(r.biasTrillion)} | ${n(r.rmseTrillion)} | ${n(r.mapePercent)}% |`).join('\n')}

\`unchanged\`は起点の収入額据置。弾性値1.0は税・社会負担収入/GDP比を起点のまま保持する比較基準。

## 対象年度による期間別比較（1年先）

| 対象年度 | 弾性値 | 件数 | MAE（兆円） | バイアス（兆円） | MAPE |
| --- | ---: | ---: | ---: | ---: | ---: |
${periods.map(r => `| ${r.from}～${r.to} | ${r.elasticity} | ${r.count} | ${n(r.maeTrillion)} | ${n(r.biasTrillion)} | ${n(r.mapePercent)}% |`).join('\n')}

期間は対象年度で機械的に10年ずつ分けたもので、景気局面の分類や政策変更を調整した比較ではない。

## 既定値の年別結果（1年先、兆円）

| 起点年度→対象年度 | 予測 | 実績 | 誤差 |
| --- | ---: | ---: | ---: |
${result.cases.filter(r => r.horizon === 1 && r.method === `elasticity-${PARAMETERS.taxRevenueElasticity}`).map(r => `| ${r.origin}→${r.target} | ${n(r.predicted)} | ${n(r.actual)} | ${n(r.error)} |`).join('\n')}

3年先・5年先の全起点別結果はJSONに保存。

## 解釈と限界

既定値${PARAMETERS.taxRevenueElasticity}の1年先${current.count}件では、MAEは${n(current.maeTrillion)}兆円、バイアスは${n(current.biasTrillion)}兆円、MAPEは${n(current.mapePercent)}%。年別結果と併せ、誤差が特定の年に偏っていないかを確認する。

比較した4つの弾性値のうちMAEが最小だったもの：${comparisons.map(r => `${r.horizon}年先は${r.method}（${n(r.maeTrillion)}兆円）`).join('、')}。同じ評価標本での記述的比較であり、探索して推定した最適値や未知期間での優位性を意味しない。

これは改定後データ・実績GDPを使った税収式の事後検証であり、当時入手可能だった情報だけを使う標本外の将来予測ではない。実際の制度変更・減税・税収の一時要因は未調整（追加税控除0、納付ラグ0）。残差を弾性値だけの誤りとみなさない。国税だけの弾性値と一般政府の税・社会負担全体の弾性値も同一ではない。

制度・景気構造の変化を含むため、この結果だけで既定値を再選定しない。1.3は維持し、1.0・1.1・1.7との比較を記録する。GDP、CPI、PB、利払い、債務の予測精度や政策乗数の妥当性は今回の検証対象外。

次は税・社会負担別、制度変更調整後、景気局面別に評価する。さらに公表時点別データを保存し、実績GDPを与えない将来予測の検証へ進める。

固定入力のSHA-256：\`${fixtureSha256}\`。各原本ExcelのURL・SHA-256・抽出セルは入力JSONに保存。原本は\`tests/fixtures/fiscal-backtest/\`に固定した。入力の再抽出：\`python scripts/generate-fiscal-backtest-data.py\`（openpyxlが必要、ネット取得なし）。収入式は本体と共通の\`app/lib/fiscal-space/revenue.ts\`を使用する。
`;
writeFileSync('docs/fiscal-space-backtest-results.md', report);
writeFileSync('docs/fiscal-space-backtest-results.json', JSON.stringify({ defaultElasticity: PARAMETERS.taxRevenueElasticity,
  method: 'conditional-revised-data-revenue-only', fixtureSha256, data, ...result, periods, previousCalendarCheck }, null, 2) + '\n');
console.table(result.summaries);
console.table(periods.filter(r => r.elasticity === PARAMETERS.taxRevenueElasticity));
