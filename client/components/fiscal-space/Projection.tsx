import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { EconomyState, ModelParameters, ProductionResult, ProjectionStep, Simulation } from '@/types/fiscal-space';
import { money, percent, points } from './format';
import { REFERENCES } from '@/app/lib/fiscal-space/calibration';
import { FiscalVintageBadge } from './ResultAssumptions';

export function CapacityComparison({ initial, production }: { initial: EconomyState; production: ProductionResult }) {
  const rows = [
    ['実質GDP', initial.macro.realGdp, '年0の実質生産'], ['潜在GDP', initial.macro.potentialGdp, '通常運転の持続可能生産'],
    ['レオンチェフの最大GDP', production.leontief, '固定投入比率のモデル'],
    ['CESの最大GDP', production.ces, '設備・労働・エネルギー・中間財を代替できるモデル'],
    ['コブ＝ダグラスの最大GDP', production.cobbDouglas, '設備・労働・エネルギーを代替できるモデル'],
  ] as const;
  const max = Math.max(...rows.map(r => r[1]));
  return <Card><CardHeader><h2 className="text-lg font-bold">生産能力を3つのモデルで見る</h2><p className="text-xs leading-relaxed text-mirai-text-subtle">年0の同じ投入量を、別の生産関数で比較します。時間による自動切替はありません。年次の条件付き試算は下の図表に分けて表示します。</p></CardHeader><CardContent className="space-y-4">
    {rows.map(([label, value, note]) => <div key={label}><div className="flex flex-wrap justify-between gap-1 text-sm"><span>{label}</span><strong className="tabular-nums">{money(value, 1)}</strong></div><div aria-hidden="true" className="my-1 h-2 rounded-full bg-mirai-surface-warm"><div className="h-2 rounded-full bg-primary" style={{ width: `${value / max * 100}%` }} /></div><p className="text-xs text-mirai-text-subtle">{note}</p></div>)}
  </CardContent></Card>;
}

export function CurrentMetrics({ step, baseline, publishedYears = 5, latest = false }: { step: ProjectionStep; baseline: ProjectionStep; publishedYears?: number; latest?: boolean }) {
  const s = step.state;
  const longRun = s.year > publishedYears;
  const rows = [
    ['実質GDP', money(s.macro.realGdp), `政策なしとの差 ${money(s.macro.realGdp - baseline.state.macro.realGdp)}`],
    ['GDPギャップ', percent(step.outputGap), '(実際 − 潜在) ÷ 潜在'],
    ['最大GDPギャップ（仮定）', percent(step.maximumGap), '(実際 − 最大) ÷ 最大。労働時間・参加可能人口・設備稼働率からの実測推計は未実装'],
    ['稼働率による価格水準補正', points(step.demand.capacityPriceAdjustment), '政策による混雑の増分から参照条件の増分を控除。公表反応とは別の感度仮定'],
    ['輸入価格による実質所得変化（近似）', money(step.importPriceEffects?.tradingIncomeChange ?? 0), '数量固定・国内価格基準。所得から消費・生産への二次波及は未推計'],
    ['インフレ率', longRun ? '未推計' : percent(s.macro.inflation), longRun ? '公表モデルの期間外。長期の金融政策・価格調整を特定できないため非表示' : `政策なしとの差 ${points(s.macro.inflation - baseline.state.macro.inflation)}`],
    ['消費税直接効果を除くCPI', longRun ? '未推計' : percent(step.taxAdjustedInflation ?? s.macro.inflation), '総合CPIと両方を制約判定に使用。分離は仮定'],
    ['借換・新発金利', percent(step.refinancingRate ?? 0), `うち公表政策反応 ${points(step.referenceRateEffect ?? 0)}`],
    ['輸入', longRun ? '未推計' : money(s.external.imports), longRun ? '事業の直接寄与は政策比較の詳細へ' : `政策なしとの差 ${money(s.external.imports - baseline.state.external.imports)}`],
    ['輸出', longRun ? '未推計' : money(s.external.exports), '公表モデルの輸出反応を反映。期間外の総合予測は非表示'],
    ['総債務 / GDP', percent(step.metrics.grossDebtGdp), '純債務 ' + percent(step.metrics.netDebtGdp)],
    ['基礎的財政収支', money(s.fiscal.primaryBalance), `GDP比 ${percent(step.metrics.primaryBalanceGdp)}・黒字がプラス`],
    ['利払い / GDP', percent(step.metrics.interestGdp), '利払い / 税・社会負担収入 ' + percent(step.metrics.interestTax)],
    ['資金調達需要', money(step.metrics.grossFinancingNeeds), 'GDP比 ' + percent(step.metrics.gfnGdp)],
  ];
  return <Card><CardHeader><h2 className="text-lg font-bold">年{s.year}の結果（試算）</h2><p className="text-xs text-mirai-text-subtle">GDPギャップは負が需要不足、正が需要超過です。最大GDP基準も同じ符号で、負の値が供給余力を示します。{longRun && '公表期間後のGDP・財政は、成長率・物価の基準経路と供給効果の実現を仮定した条件付き計算です。'}</p></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{rows.map(([label, value, note]) => <div key={label}><p className="text-xs">{label}</p><p className="mt-1 text-lg font-medium tabular-nums">{value}</p>{["総債務 / GDP", "基礎的財政収支", "利払い / GDP", "資金調達需要"].includes(label) && <FiscalVintageBadge latest={latest} projected />}<p className="mt-1 text-xs text-mirai-text-subtle">{note}</p></div>)}</CardContent></Card>;
}

export function Projection({ simulation, baseline, peaksByYear, shocks, parameters, latest = false }: {
  simulation: Simulation; baseline: Simulation; peaksByYear: string[];
  shocks: { bp: number; years: { year: number; interestIncrease: number }[] }[]; parameters: ModelParameters; latest?: boolean;
}) {
  const steps = [simulation.initial, ...simulation.steps];
  const publishedYears = REFERENCES[parameters.referenceModel].years;
  const years = simulation.steps.length;
  const last = simulation.steps[years - 1], baseLast = baseline.steps[years - 1];
  const values = steps.flatMap(s => [s.state.macro.realGdp, s.state.macro.potentialGdp, s.production.maximum]);
  const tick = 50e12;
  const low = Math.floor(Math.min(...values) / tick) * tick, high = Math.ceil(Math.max(...values) / tick) * tick;
  const ticks = Array.from({ length: Math.round((high - low) / tick) + 1 }, (_, i) => low + i * tick);
  const x = (i: number) => 90 + i * 620 / years, y = (v: number) => 200 - (v - low) / (high - low) * 170;
  const line = (get: (s: ProjectionStep) => number) => steps.map((s, i) => `${x(i)},${y(get(s))}`).join(' ');
  return <Card><CardHeader><h2 className="text-lg font-bold">{years}年間の状態遷移</h2><p className="text-xs leading-relaxed text-mirai-text-subtle">グラフは基準年価格（兆円）。公表モデルの期間内でGDP・物価・輸出入・財政を比較します。政策固有の供給効果や事業条件には仮定を含みます。期間後の投資便益は「長期投資の稼働開始と年間効果」を参照してください。</p><p className="text-xs leading-relaxed">3年支出の政策は4年目に支出が止まり、公表反応の組み合わせではGDPが政策なし経路を下回る場合があります。研究・公共資本等の供給効果は、供用開始と減耗に応じて残ります。</p></CardHeader><CardContent className="space-y-5">
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="GDP経路のグラフ">
      {/* Data chart, not a decorative SVG icon. Equivalent values are available in the table. */}
      <svg viewBox="0 0 750 245" className="w-full" role="img" aria-label={`${years}年推移（兆円）：実質GDP実線、潜在GDP破線、最大GDP点線。数値は直後の表を参照。`}>
        <defs><pattern id="scenario-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="var(--mirai-border)" strokeWidth="1" /></pattern></defs>
        <rect x={x(.5)} y="30" width={710 - x(.5)} height="170" fill="url(#scenario-hatch)" />
        <line x1={x(.5)} x2={x(.5)} y1="30" y2="205" stroke="var(--mirai-text-subtle)" strokeDasharray="4 3" />
        <text x={x(.5) + 8} y="19" fontSize="13" fill="var(--mirai-text)">ここから先は仮定に基づく試算</text>
        {ticks.map((v, i) => { return <g key={i}><line x1="90" x2="710" y1={y(v)} y2={y(v)} stroke="var(--mirai-border)" /><text x="85" y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mirai-text-subtle)">{(v / 1e12).toFixed(0)}兆円</text></g>; })}
        <polyline points={line(s => s.state.macro.realGdp)} fill="none" stroke="var(--primary-accent)" strokeWidth="3" />
        <polyline points={line(s => s.state.macro.potentialGdp)} fill="none" stroke="var(--mirai-text)" strokeWidth="2" strokeDasharray="8 5" />
        <polyline points={line(s => s.production.maximum)} fill="none" stroke="var(--stance-neutral)" strokeWidth="2" strokeDasharray="2 4" />
        {steps.map((s, i) => <text key={s.state.year} x={x(i)} y="225" textAnchor="middle" fontSize="11" fill="var(--mirai-text-subtle)">{i}年</text>)}
      </svg>
    </div>
    <p className="text-sm">債務経路の仮定：名目GDPへの税収弾性値 {parameters.taxRevenueElasticity}、徴収ラグ {parameters.taxCollectionLag}年。債務/GDPの低下は分母の名目成長でも起こり、政策が自己財源化することを意味しません。</p>
    <p className="text-xs">実線：実質GDP / 破線：潜在GDP / 点線：選択モデルの最大GDP（兆円）</p>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${years}年間の推計表`}><table className="w-full min-w-[1440px] text-right text-xs tabular-nums"><caption className="mb-2 text-left">← 横にスクロールできます → 金額は兆円、率は%。GDPは基準年価格（名目GDPを除く）、輸出入は各年価格。</caption><thead><tr className="border-b border-mirai-border">{['年', '名目GDP', '実質GDP', '潜在GDP', '最大GDP', 'GDPギャップ', '最大GDPギャップ', 'CPI', '税直接効果を除くCPI', '借換金利', '輸出', '輸入', '債務/GDP', '利払/GDP', '資金調達/GDP', '基礎的収支/GDP', '債務安定に必要な収支/GDP', '水準で最も近い制約'].map((h, i) => <th scope="col" key={h} className={`px-2 py-3 ${i === 0 ? 'sticky left-0 z-10 bg-card' : ''}`}>{h}</th>)}</tr></thead><tbody>
      {simulation.steps.map((s, i) => <tr key={s.state.year} className="border-b border-mirai-border last:border-0 hover:bg-mirai-surface-teal/60"><th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-card p-2">{s.state.year}年</th>{[
        money(s.state.macro.nominalGdp, 1), money(s.state.macro.realGdp, 1), money(s.state.macro.potentialGdp, 1), money(s.production.maximum, 1),
        percent(s.outputGap), percent(s.maximumGap), s.state.year <= publishedYears ? percent(s.state.macro.inflation) : '—',
        percent(s.taxAdjustedInflation ?? s.state.macro.inflation), percent(s.refinancingRate ?? 0),
        s.state.year <= publishedYears ? money(s.state.external.exports, 1) : '—', s.state.year <= publishedYears ? money(s.state.external.imports, 1) : '—',
        percent(s.metrics.grossDebtGdp), percent(s.metrics.interestGdp), percent(s.metrics.gfnGdp), percent(s.metrics.primaryBalanceGdp), percent(s.metrics.stabilizingPrimaryBalance), peaksByYear[i],
      ].map((v, j) => <td key={j} className="p-2">{v}{j >= 11 && j <= 15 && <FiscalVintageBadge latest={latest} projected />}</td>)}</tr>)}
    </tbody></table></div>
    <details><summary className="cursor-pointer text-sm font-bold">借換と利払いの根拠を見る</summary><div className="mt-3 space-y-3 text-xs leading-relaxed">
      <p>期首の満期分を当年市場金利で借換。既発債の表面利率は固定、純増発行分の利払いは翌年から。新発債は{parameters.newDebtMaturity}年満期です。以下は入力中の政策配分を固定し、ショックなしの金利経路との利払い差を示します（エネルギーショックなし）。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="金利ショックの利払い増加表"><table className="w-full text-right tabular-nums"><caption className="text-left">金利ショックの利払い増加</caption><thead><tr><th scope="col" className="p-2">ショック</th>{[1, 3, 5].filter(n => n <= years).map(n => <th key={n} scope="col" className="p-2">{n}年後</th>)}</tr></thead><tbody>{shocks.map(row => <tr key={row.bp}><th scope="row" className="p-2">+{row.bp / 100}%</th>{row.years.filter(v => v.year <= years).map(v => <td key={v.year} className="p-2">{money(v.interestIncrease)}</td>)}</tr>)}</tbody></table></div>
      <p>{years}年後の政策なし債務/GDP：{percent(baseLast.metrics.grossDebtGdp)}。現在の配分との差：{points(last.metrics.grossDebtGdp - baseLast.metrics.grossDebtGdp)}。</p>
      <p>当年の債務/GDP ＝ (1＋実効金利)÷(1＋名目成長率) × 前年の債務/GDP − 当年の基礎的財政収支/GDP ＋ 当年の残高調整/GDP。債務安定に必要な基礎的財政収支/GDP ＝ (実効金利−名目成長率)÷(1＋名目成長率) × 前年の債務/GDP ＋ 当年の残高調整/GDP。実効金利＝（支払利子−受取利子）÷期首債務。基礎的財政収支は利子受払を除く収支で黒字が正。利払いの負担率は受取利子を控除する前の額です。</p>
      <p>{years}年後の残高調整/GDPは{percent(last.metrics.stockFlowAdjustmentGdp)}。全債務を償還した後の余剰は金融資産となり、総債務の恒等式では資産取得分を残高調整へ計上します。</p>
      <p>年0の債務総額・利払額は2024年実績から換算しています。満期1〜10年への均等配分と一律表面利率は仮定で、実際の償還予定を再現したものではありません。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="年0の債務満期構成"><table className="w-full text-right"><caption className="text-left">年0の債務の満期構成（満期配分は仮定）</caption><thead><tr><th scope="col">満期年</th><th scope="col">元本</th><th scope="col">表面利率</th></tr></thead><tbody>{simulation.initial.state.debtPortfolio.map((b, i) => <tr key={i}><th scope="row" className="p-1">{b.maturityYear}</th><td>{money(b.principal)}</td><td>{percent(b.coupon)}</td></tr>)}</tbody></table></div>
    </div></details>
  </CardContent></Card>;
}
