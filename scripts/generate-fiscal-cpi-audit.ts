import { writeFileSync } from 'node:fs';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { NO_SHOCK } from '../app/lib/fiscal-space/assumptions';
import { constraintInflation } from '../app/lib/fiscal-space/constraints';

const form = defaults();
form.horizon = 15;
Object.assign(form.amounts, { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 });
const configured = createFiscalEngine()(form);
const cases = [0, 3, 5, 10].flatMap(gapClosureYears => [false, true].map(withPolicy => {
  const path = simulate(configured.initial, withPolicy ? configured.allocated : [], 15, configured.p, NO_SHOCK, { gapClosureYears });
  const peak = path.steps.reduce((a, b) => a.state.macro.inflation >= b.state.macro.inflation ? a : b);
  return { gapClosureYears, withPolicy, terminalInflation: path.steps.at(-1)!.state.macro.inflation,
    cumulativeInflation: path.steps.at(-1)!.cpiDiagnostics!.priceIndex - 1,
    peakInflation: peak.state.macro.inflation, peakYear: peak.state.year,
    constraintPeak: Math.max(...path.steps.map(constraintInflation)),
    years: path.steps.map(step => ({ year: step.state.year, inflation: step.state.macro.inflation,
      ...step.cpiDiagnostics!, realGdp: step.state.macro.realGdp, potentialGdp: step.state.macro.potentialGdp })) };
}));
const labels = { baseline: '基準インフレ', gap: '基準需給ギャップ', overflow: '供給上限超過', energy: 'エネルギー価格・需要',
  persistence: '前年からの持続', referencePrices: '参照政策・事業の価格水準変化', capacityPrices: '能力混雑の価格水準変化', directTaxPrices: '税直接価格効果' };
const pct = (v: number) => (v * 100).toFixed(3);
const mode = (years: number) => years ? `${years}年で解消` : '据置（現行）';
const report = `# 15年間のCPI寄与分解と需給ギャップ感度

再生成：\`npm run audit:fiscal-cpi\`。全入力・年別結果：[JSON](fiscal-space-cpi-audit.json)。これは現行モデルの構造診断であり、実績への推定・バックテストではない。

## 条件

latest、初期需給ギャップ${pct(configured.initial.macro.realGdp / configured.initial.macro.potentialGdp - 1)}%、基準インフレ${pct(configured.p.baselineInflation)}%、税収弾性値${configured.p.taxRevenueElasticity}。配分例は年間15兆円（社会保険料5・研究3・送電網3・防衛2・子育て2）、各政策の支出期間は現行既定値。15年間すべてに15兆円を支出する設定ではない。政策なしも併記する。

解消ケースは初期ギャップを年0から3・5・10年で直線的に0へ近づける。潜在GDPの成長率を固定して基準実質GDPを変更し、物価・GDP・税収等を本体で再計算する。単にCPIからギャップ寄与を引く処理ではない。解消速度は未推定の感度仮定で、金融政策・人口・生産性を内生化したモデルではない。既定値と画面の計算は据置のまま。

## 15年目・累積・ピーク（%）

| ギャップ | 政策 | 15年目前年比 | 15年間累積 | 期間中ピーク | ピーク年 | 判定用CPIピーク |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${cases.map(c => `| ${mode(c.gapClosureYears)} | ${c.withPolicy ? '配分例' : 'なし'} | ${pct(c.terminalInflation)} | ${pct(c.cumulativeInflation)} | ${pct(c.peakInflation)} | ${c.peakYear} | ${pct(c.constraintPeak)} |`).join('\n')}

累積は年0を1とした\`∏(1+各年インフレ率)−1\`。前年比を単純加算しない。総合CPIと、消費税の直接効果を除く系列も使う制約判定用CPIは区別する。

## 現行ケースの寄与（%ポイント）

| 政策 | 年 | ${Object.values(labels).join(' | ')} | 合計CPI |
| --- | ---: | ${Object.keys(labels).map(() => '---:').join(' | ')} | ---: |
${cases.filter(c => c.gapClosureYears === 0).flatMap(c => c.years.filter(y => [1, 3, 5, 10, 15].includes(y.year)).map(y => `| ${c.withPolicy ? '配分例' : 'なし'} | ${y.year} | ${Object.keys(labels).map(k => pct(y.contributions[k as keyof typeof labels])).join(' | ')} | ${pct(y.inflation)} |`)).join('\n')}

寄与合計は各年のCPI前年比と一致する。基準・ギャップ・供給超過・エネルギー・持続項は基調インフレ式の項。価格水準要因jは\`(1+当年基調インフレ)×(効果j当年−効果j前年)/(1+前年価格水準効果合計)\`とする。交差項を価格水準変化側へ配分する会計分解であり、各要因を除いた因果効果ではない。持続項には過去のギャップ・エネルギー等の影響が含まれる。

## 解釈・残る課題

- 政策なし・外生ショックなしでは、現行の同率GDP成長が初期ギャップを維持する。ギャップ解消は基調インフレの持続的な押上げを弱めるが、過去の物価上昇を取り消さない。
- 公表反応の最終値据置は「価格水準」の据置。毎年同じインフレ率を加算する意味ではない。固定名目費用の実質化や政策終了、供給効果によって年次寄与は変わる。
- 参照政策反応を調整する需要・価格感度は、現行どおり初期ギャップで固定。本診断は基準GDP経路とそこからの波及を変更する限定的な比較であり、政策反応の時変化まで推定していない。
- 公表反応の5年以降の延長、電力の計画末年据置、人口・賃金・期待・金融反応は引き続き仮定。15年の数値を精度検証済み予測や信頼区間とは扱わない。

次はギャップ解消速度と物価持続性を過去データで検証し、1・3・5年先のCPI誤差を単純予測と比較する。政策反応の末尾延長の比較は別の変更として扱い、今回のギャップ効果と混同しない。

続く検証：[CPI持続性・ギャップ解消速度の過去検証](fiscal-space-cpi-backtest.md)。年次の縮約式を用いた比較であり、この15年計算全体の実績検証ではない。
`;
writeFileSync('docs/fiscal-space-cpi-audit.md', report);
writeFileSync('docs/fiscal-space-cpi-audit.json', JSON.stringify({ form, initial: configured.initial, parameters: configured.p, policies: configured.allocated, cases }, null, 2) + '\n');
console.table(cases.map(({ years, ...summary }) => summary));
