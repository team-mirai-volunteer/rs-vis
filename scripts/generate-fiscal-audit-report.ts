import { writeFileSync } from 'node:fs';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';

const form = defaults();
Object.assign(form.amounts, { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 });
const calculate = createFiscalEngine();
const result = calculate(form);
const cpi = [.02, .025, .03, .035].map(limit => {
  const r = calculate({ ...form, thresholds: { ...form.thresholds, inflation: limit } });
  return { limit, maximum: r.estimate.theoreticalMaximum, afterDeduction: r.estimate.recommendedEnvelope, status: r.estimate.status,
    binding: r.estimate.constraints.filter(c => c.status === 'violated').map(c => c.label).join('・') };
});
const manual = calculate({ ...form, resource: { ...form.resource, mode: 'manual' }, thresholds: { ...form.thresholds, inflation: .03 } });
const annual = calculate({ ...defaults('2024'), amounts: form.amounts });
const n = (value: number) => (value / 1e12).toFixed(1);
const pct = (value: number) => (value * 100).toFixed(1);
const report = `# 財政余力の再現条件と感度（${FISCAL_MODEL_VERSION}）

この文書は \\scripts/generate-fiscal-audit-report.ts\\ が生成する出力記録です。再生成：\`npx tsx scripts/generate-fiscal-audit-report.ts\`。係数の妥当性の証明・信頼区間ではありません。

条件：latest、社会保険料5・研究3・送電網3・防衛2・保育2兆円、その他は画面の既定値。年1〜5、IO負荷あり、税収弾性値1.1。現在の入力一式は [JSON](fiscal-space-audit-results.json)。画面はGDPギャップを小数1桁（%）に丸めており、初期状態を直接渡す試算とは探索刻み以内の差が生じ得ます。

## 基準インフレの感度

CPI上限2.5%と年0の観測値を固定。基準インフレだけを変更して全制約を探索します。

| 基準インフレ | 探索上限（兆円/年） | 状態 |
| --- | ---: | --- |
${result.riskAudit.baselineSensitivity.map(r => `| ${pct(r.inflation)}% | ${n(r.amount)} | ${r.status} |`).join('\n')}

## CPI上限の感度

基準インフレ2.0%。20%の任意控除は算術上の設定で、ストレスから推定した緊急予備費ではありません。主表示は控除前の単一値と上の感度表です。

| CPI上限 | 探索上限（兆円/年） | 任意控除後（兆円/年） | 境界・状態 |
| --- | ---: | ---: | --- |
${cpi.map(r => `| ${pct(r.limit)}% | ${n(r.maximum)} | ${n(r.afterDeduction)} | ${r.binding} / ${r.status} |`).join('\n')}

IO負荷なし・CPI上限3.0%は **${manual.estimate.status}（算出不可）**。未評価制約は探索を停止させます。2024年で揃えた同配分は ${n(annual.estimate.theoreticalMaximum)}兆円/年。観測された年0 CPIは2.7%のまま保持し、違反判定から除外します。将来の政策なし経路が上限を超える場合は引き続き baseline-violated です。

## 税収弾性値の感度

入力予算15兆円を固定した年5の経路。弾性値は社会保険料を含む収入全体に複利で適用する仮定です。

| 弾性値 | 総債務/GDP | 税・社会負担収入（兆円） |
| --- | ---: | ---: |
${result.taxElasticitySensitivity.map(r => `| ${r.elasticity} | ${pct(r.debtGdp)}% | ${n(r.taxRevenue)} |`).join('\n')}

既定の配分では物価が境界を決めています。債務の上限を見つけた結果ではありません。280%の閾値に実証的な持続可能性の根拠はなく、5年の評価は長期債務持続性の検証を代替しません。
`;
writeFileSync('docs/fiscal-space-audit-results.md', report.replace('\\scripts/generate-fiscal-audit-report.ts\\', '`scripts/generate-fiscal-audit-report.ts`'));
writeFileSync('docs/fiscal-space-audit-results.json', JSON.stringify({ modelVersion: FISCAL_MODEL_VERSION, form, cpi,
  baselineSensitivity: result.riskAudit.baselineSensitivity, taxElasticitySensitivity: result.taxElasticitySensitivity }, null, 2) + '\n');
console.log(JSON.stringify({ cpi, tax: result.taxElasticitySensitivity, annual: annual.estimate.theoreticalMaximum }));
