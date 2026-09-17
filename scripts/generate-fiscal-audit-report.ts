import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reproduction = { formSha256: digest(form), recordsSha256: digest(result.records) };
const stress = 'stress' in result.estimate ? result.estimate.stress : [];
const selectedStress = stress.filter(r => r.selected).map(r => r.label).join('・') || '未選択';
const allocation = result.allocated.map(policy => `${policy.name}${n(policy.annualCost)}兆円`).join('・');
const report = `# 財政余力の再現条件と感度（${FISCAL_MODEL_VERSION}）

この文書は \\scripts/generate-fiscal-audit-report.ts\\ が生成する出力記録です。再生成：\`npx tsx scripts/generate-fiscal-audit-report.ts\`。係数の妥当性の証明・信頼区間ではありません。

条件：${form.dataset}、${allocation}、その他は画面の既定値。年1〜${result.horizon}、資源負荷モード${form.resource.mode}、税収弾性値${result.p.taxRevenueElasticity}。現在の入力一式とハッシュは [JSON](fiscal-space-audit-results.json)。画面はGDPギャップを小数1桁（%）に丸めており、初期状態を直接渡す試算とは探索刻み以内の差が生じ得ます。

税収弾性値${result.p.taxRevenueElasticity}は、実績と政府の慎重な見通しのバランスを取るための設計上の既定値です。政府の公式係数や実証推定値という意味ではありません。[条件付きバックテスト](fiscal-space-backtest-results.md)は、この値を維持して誤差を比較します。

## 基準インフレの感度

CPI上限${pct(form.thresholds.inflation)}%と年0の観測値を固定。基準インフレだけを変更して全制約を探索します。

| 基準インフレ | 探索上限（兆円/年） | 状態 |
| --- | ---: | --- |
${result.riskAudit.baselineSensitivity.map(r => `| ${pct(r.inflation)}% | ${n(r.amount)} | ${r.status} |`).join('\n')}

## CPI上限の感度

基準インフレ${pct(result.p.baselineInflation)}%。留保方式は${result.estimate.reserveRule?.method}。ストレス選択：${selectedStress}。固定20%控除は廃止済みです。選択した各ストレスを個別に評価した上限の最小値を採用し、同時発生への耐性とは区別します。

| CPI上限 | 探索上限（兆円/年） | ストレス留保後（兆円/年） | 境界・状態 |
| --- | ---: | ---: | --- |
${cpi.map(r => `| ${pct(r.limit)}% | ${n(r.maximum)} | ${n(r.afterDeduction)} | ${r.binding} / ${r.status} |`).join('\n')}

IO負荷なし・CPI上限3.0%は **${manual.estimate.status}**。未評価制約は探索を停止させます。2024年で揃えた同配分は ${n(annual.estimate.theoreticalMaximum)}兆円/年。その年0 CPIは${pct(annual.initial.macro.inflation)}%（latestは${pct(result.initial.macro.inflation)}%）のまま保持し、違反判定から除外します。将来の政策なし経路が上限を超える場合は引き続き baseline-violated です。

## 個別ストレス

| 条件 | 上限（兆円/年） | 状態 | 選択 |
| --- | ---: | --- | --- |
${stress.map(r => `| ${r.label} | ${n(r.amount)} | ${r.status} | ${r.selected ? '選択' : '未選択'} |`).join('\n')}

## 税収弾性値の感度

入力予算${n(result.totalYen)}兆円を固定した年${result.horizon}の経路。弾性値は社会保険料を含む収入全体に複利で適用する仮定です。

| 弾性値 | 総債務/GDP | 税・社会負担収入（兆円） |
| --- | ---: | ---: |
${result.taxElasticitySensitivity.map(r => `| ${r.elasticity} | ${pct(r.debtGdp)}% | ${n(r.taxRevenue)} |`).join('\n')}

この配分の境界：${result.estimate.constraints.filter(c => c.status === 'violated').map(c => c.label).join('・')}。債務閾値${pct(form.thresholds.debt)}%はシナリオ設定であり、評価期間${result.horizon}年の探索は長期債務持続性の検証を代替しません。

入力SHA-256：\`${reproduction.formSha256}\`。出典・係数レコードSHA-256：\`${reproduction.recordsSha256}\`。同じモデル版でもコード変更はあり得るため、JSONの入力・初期状態と実行したコードを合わせて保存します。レコードは計算エンジンから再生成してハッシュを比較できます。
`;
writeFileSync('docs/fiscal-space-audit-results.md', report.replace('\\scripts/generate-fiscal-audit-report.ts\\', '`scripts/generate-fiscal-audit-report.ts`'));
writeFileSync('docs/fiscal-space-audit-results.json', JSON.stringify({ modelVersion: FISCAL_MODEL_VERSION, reproduction, form, cpi,
  reserveRule: result.estimate.reserveRule, stress, initial: result.initial,
  baselineSensitivity: result.riskAudit.baselineSensitivity, taxElasticitySensitivity: result.taxElasticitySensitivity }, null, 2) + '\n');
console.log(JSON.stringify({ cpi, tax: result.taxElasticitySensitivity, annual: annual.estimate.theoreticalMaximum }));
