import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ModelParameters, Policy, ProjectionStep, SourceValue } from '@/types/fiscal-space';
import { money, percent } from './format';

export function Explanations({ step, parameters, policies, records }: { step: ProjectionStep; parameters: ModelParameters; policies: Policy[]; records: SourceValue[] }) {
  const s = step.state;
  return <Card id="model-notes"><CardHeader><h2 className="text-lg font-bold">計算根拠・データ・レジリエンス</h2><p className="text-sm leading-relaxed">このMVPは日本の実測データで校正していません。すべての入力水準・乗数・需要係数・閾値は<strong>仮定・試作値・未検証</strong>です。現在の日本政府の支出可能額を示すものではありません。</p></CardHeader><CardContent className="space-y-5 text-sm leading-relaxed">
    <details open><summary className="cursor-pointer font-bold">追加需要はどこへ向かう？（年{step.state.year}）</summary><div className="mt-3 space-y-3">
      <p>追加需要 {money(step.demand.additionalDemand)} ＝ 国内実質生産 {money(step.demand.realOutput)} ＋ 輸入漏出 {money(step.demand.imports)} ＋ 価格圧力相当 {money(step.demand.prices)}。ここはすべて基準年価格。価格圧力相当額はGDPに直接加算しません。</p>
      <p className="text-xs">実効乗数 ＝ base multiplier × slack factor × capacity factor × domestic retention factor。国内維持率 = 1 − 輸入性向。slack factor = 1 + {parameters.gapMultiplierSensitivity} × 潜在gap + {parameters.slackMultiplierSensitivity} × 最大gap（負の最大余力は0）。capacity factorは全国余力/{percent(parameters.supplySlackReference)}と産業余力/{percent(parameters.sectorSlackReference)}の小さい方を使い、全国の最大GDPを超える要求は比例縮小します。残りの国内需要の{percent(parameters.overflowImportShare, 0)}を輸入、残余を物価へ割り当てます。</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-right text-xs tabular-nums"><caption className="text-left">当年稼働中の政策の乗数分解</caption><thead><tr>{['政策', '基礎乗数', '余力係数', '能力係数', '国内維持率', '実効乗数'].map(h => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead><tbody>{step.demand.details.map((d, i) => <tr key={i}><th scope="row" className="p-2 text-left">{policies.find(p => p.id === d.policyId)?.name ?? d.policyId}</th>{[d.baseMultiplier, d.slackFactor, d.capacityFactor, d.domesticRetentionFactor, d.effectiveMultiplier].map((v, j) => <td key={j} className="p-2">{v.toFixed(3)}</td>)}</tr>)}</tbody></table></div>
    </div></details>
    <details><summary className="cursor-pointer font-bold">実物輸入と金融的な対外収支を分けて見る</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[
      ['貿易収支', money(s.external.tradeBalance)], ['財の収支', money(s.external.goodsBalance)], ['サービス収支', money(s.external.servicesBalance)],
      ['第一次所得収支', money(s.external.primaryIncomeBalance)], ['経常収支', money(s.external.currentAccount)], ['対外純資産（NIIP）', money(s.external.niip)],
      ['エネルギー輸入費', money(s.energy.importBill)], ['エネルギー輸入費 / GDP', percent(s.energy.importBill / s.macro.nominalGdp)],
      ['必需輸入費（エネルギー含む）', money(s.external.essentialImports)], ['一次エネルギー自給率', percent(s.energy.domesticSupply / s.energy.primaryDemand)],
      ['化石燃料輸入依存率（固定仮定）', percent(s.energy.fossilFuelImportDependency)], ['電力予備率', percent(s.energy.reserveMargin)],
      ['再エネ設備容量（固定仮定）', `${s.energy.renewableInstalledCapacity.toFixed(1)}GW`], ['再エネ確実供給寄与（固定仮定）', `${s.energy.renewableFirmContribution.toFixed(1)}GW`],
      ['流動性調整純債務 / GDP', percent(step.metrics.liquidityAdjustedNetDebtGdp)],
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-mirai-text-subtle">{label}</dt><dd className="font-bold tabular-nums">{value}</dd></div>)}</dl><p className="mt-3 text-xs">経常収支の所得黒字はエネルギー・食料の供給能力へ加算しません。追加エネルギー費は需要分解の輸入とは別の資源費として貿易収支へ計上します。発電投資の確実供給増は仮定係数で指定し、電源種別・再エネ導入構成は未モデル化です。</p></details>
    <details><summary className="cursor-pointer font-bold">国家レジリエンス（財政制約とは別枠）</summary><p className="mt-3">エネルギー輸入先集中、食料カロリー・蛋白自給率、飼料・肥料・農業エネルギー依存、重要鉱物、備蓄日数、地政学的集中：<strong>すべて未検証・未取得</strong>。型は拡張可能ですが、このMVPでは数値も警戒判定も作りません。</p></details>
    <details><summary className="cursor-pointer font-bold">数式・探索の限界と緊急時留保</summary><div className="mt-3 space-y-2 text-xs">
      <p>Cobb–Douglas: A K^α L^β E^γ。CES: A(Σw x^ρ)^(1/ρ)、ρ=1−1/σ、σ={parameters.cesSigma}。σ=1は幾何平均。Leontief: min(K/aK, L/aL, E/aE, M/aM)。投入は基準投入量を1とする指数で、共通の潜在GDPを掛けて円へ戻します。</p>
      <p>探索上限{money(parameters.searchCap)}、走査間隔{money(parameters.searchStep)}、境界区間の分解能{money(parameters.searchTolerance)}。成長投資では安全性が単調とは限らないため、ゼロから最初に観測した違反まで走査し、その区間を二分探索します。走査間隔より狭い違反領域を見逃す可能性があり、離れた許容領域の最大値は保証しません。</p>
      <p>推奨財政枠 = 理論上限 × (1 − 留保率)。留保はストレスから推定した額ではなく設定した割合です。今後、景気後退・金利・エネルギー・災害シナリオから導く設計へ拡張します。実データ校正、金融政策反応、為替、IO、Monte Carlo、民間投資の押し出しはMVP対象外です。</p>
      <p>所得税・消費税・保険料減税は一般政府に相当する集計税収を減らす簡略化です。中央政府会計やRS予算の外挿ではありません。恒久費用は名目年額固定、基準歳出は外生経路で増加します。成長投資は{percent(parameters.investmentDepreciation, 0)}減耗し、実施ラグ後に供給・税源を増やします。</p>
      <p>債務・GFN定義の参考：<a className="text-primary-accent underline" href="https://www.imf.org/en/publications/tnm/issues/2025/01/24/a-guide-and-tool-for-projecting-public-gross-financing-needs-555913" target="_blank" rel="noreferrer">IMF, A Guide and Tool for Projecting Public Gross Financing Needs (2025)</a>（2026-09-14確認）。この文献は入力数値・政策係数の出典ではありません。</p>
    </div></details>
    <details><summary className="cursor-pointer font-bold">全入力値の出典・単位を見る（{records.length}項目）</summary><p className="my-3 text-xs">参照年はすべて「試作年0」、出典は「モデル仮定（未検証）」、出典URL・信頼区間はありません。フィールド名は共通型と対応します。政策係数の効果は費用1円あたり、資源増加係数は費用/GDPあたりの正規化指数です。</p>
      <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="試作入力値の出典一覧"><table className="w-full min-w-[650px] text-left text-xs"><caption className="sr-only">入力値・単位・参照年・出典・不確実性</caption><thead><tr>{['入力', '値', '単位', '参照年・出典', '不確実性'].map(h => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead><tbody>{records.map(r => <tr key={r.key} className="border-t border-mirai-border"><th scope="row" className="p-2 font-medium">{r.key}</th><td className="p-2 tabular-nums">{r.value.toLocaleString('ja-JP', { maximumFractionDigits: 6 })}</td><td className="p-2">{r.unit}</td><td className="p-2">{r.referenceYear} / {r.sourceName}</td><td className="p-2">{r.uncertaintyNote}</td></tr>)}</tbody></table></div>
    </details>
  </CardContent></Card>;
}
