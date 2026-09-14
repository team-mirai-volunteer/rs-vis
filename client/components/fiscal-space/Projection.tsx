import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { EconomyState, ModelParameters, ProductionResult, ProjectionStep, Simulation } from '@/types/fiscal-space';
import { money, percent, points } from './format';

export function CapacityComparison({ initial, production }: { initial: EconomyState; production: ProductionResult }) {
  const rows = [
    ['Actual GDP', initial.macro.realGdp, '年0の実質生産'], ['Potential GDP', initial.macro.potentialGdp, '通常運転の持続可能生産'],
    ['1-year Maximum GDP', production.leontief, 'Leontief：短期の固定投入比率'],
    ['5-year Adaptable Maximum GDP', production.ces, 'CES：設備・労働・エネルギー・中間財の代替'],
    ['10-year Structural Maximum GDP', production.cobbDouglas, 'Cobb–Douglas：長期の高い代替可能性'],
  ] as const;
  const max = Math.max(...rows.map(r => r[1]));
  return <Card><CardHeader><h2 className="text-lg font-bold">生産能力を3つのモデルで見る</h2><p className="text-xs leading-relaxed text-mirai-text-subtle">年0の同じ投入量を、調整できる期間の違いで比較します。将来のGDP予測は下の年次推移に分けて表示します。</p></CardHeader><CardContent className="space-y-4">
    {rows.map(([label, value, note]) => <div key={label}><div className="flex flex-wrap justify-between gap-1 text-sm"><span>{label}</span><strong className="tabular-nums">{money(value, 1)}</strong></div><div aria-hidden="true" className="my-1 h-2 rounded-full bg-mirai-surface-warm"><div className="h-2 rounded-full bg-primary" style={{ width: `${value / max * 100}%` }} /></div><p className="text-xs text-mirai-text-subtle">{note}</p></div>)}
  </CardContent></Card>;
}

export function CurrentMetrics({ step, baseline }: { step: ProjectionStep; baseline: ProjectionStep }) {
  const s = step.state;
  const rows = [
    ['実質GDP', money(s.macro.realGdp), `政策なしとの差 ${money(s.macro.realGdp - baseline.state.macro.realGdp)}`],
    ['GDPギャップ', percent(step.outputGap), '(潜在 − 実際) ÷ 潜在'],
    ['Maximum GDPギャップ', percent(step.maximumGap), '(最大 − 実際) ÷ 最大'],
    ['インフレ率', percent(s.macro.inflation), `政策なしとの差 ${points(s.macro.inflation - baseline.state.macro.inflation)}`],
    ['輸入', money(s.external.imports), `政策なしとの差 ${money(s.external.imports - baseline.state.external.imports)}`],
    ['総債務 / GDP', percent(step.metrics.grossDebtGdp), '純債務 ' + percent(step.metrics.netDebtGdp)],
    ['利払い / GDP', percent(step.metrics.interestGdp), '利払い / 税収 ' + percent(step.metrics.interestTax)],
    ['資金調達需要（GFN）', money(step.metrics.grossFinancingNeeds), 'GDP比 ' + percent(step.metrics.gfnGdp)],
  ];
  return <Card><CardHeader><h2 className="text-lg font-bold">年{s.year}の結果</h2><p className="text-xs text-mirai-text-subtle">GDPギャップは正が余力、負が通常能力を上回る稼働です。</p></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{rows.map(([label, value, note]) => <div key={label}><p className="text-xs">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{value}</p><p className="mt-1 text-xs text-mirai-text-subtle">{note}</p></div>)}</CardContent></Card>;
}

export function Projection({ simulation, baseline, peaksByYear, shocks, parameters }: {
  simulation: Simulation; baseline: Simulation; peaksByYear: string[];
  shocks: { bp: number; years: { year: number; interestIncrease: number }[] }[]; parameters: ModelParameters;
}) {
  const steps = [simulation.initial, ...simulation.steps];
  const values = steps.flatMap(s => [s.state.macro.realGdp, s.state.macro.potentialGdp, s.production.maximum]);
  const low = Math.min(...values) * .95, high = Math.max(...values) * 1.03;
  const x = (i: number) => 60 + i * 65, y = (v: number) => 200 - (v - low) / (high - low) * 170;
  const line = (get: (s: ProjectionStep) => number) => steps.map((s, i) => `${x(i)},${y(get(s))}`).join(' ');
  return <Card><CardHeader><h2 className="text-lg font-bold">10年間の状態遷移</h2><p className="text-xs leading-relaxed text-mirai-text-subtle">グラフは基準年価格。表の財政・輸入額は各年の名目値です。制約の評価期間より先も参考表示します。</p></CardHeader><CardContent className="space-y-5">
    <div className="overflow-x-auto">
      {/* Data chart, not a decorative SVG icon. Equivalent values are available in the table. */}
      <svg viewBox="0 0 750 245" className="w-full min-w-[480px]" role="img" aria-label="10年推移：実質GDP実線、潜在GDP破線、最大GDP点線。数値は直後の表を参照。">
        {[0, 1, 2, 3].map(i => { const v = low + (high - low) * i / 3; return <g key={i}><line x1="60" x2="710" y1={y(v)} y2={y(v)} stroke="var(--mirai-border)" /><text x="55" y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mirai-text-subtle)">{(v / 1e12).toFixed(0)}</text></g>; })}
        <polyline points={line(s => s.state.macro.realGdp)} fill="none" stroke="var(--primary-accent)" strokeWidth="3" />
        <polyline points={line(s => s.state.macro.potentialGdp)} fill="none" stroke="var(--mirai-text)" strokeWidth="2" strokeDasharray="8 5" />
        <polyline points={line(s => s.production.maximum)} fill="none" stroke="var(--stance-neutral)" strokeWidth="2" strokeDasharray="2 4" />
        {steps.map((s, i) => <text key={s.state.year} x={x(i)} y="225" textAnchor="middle" fontSize="11" fill="var(--mirai-text-subtle)">{i}年</text>)}
      </svg>
    </div>
    <p className="text-xs">実線：実質GDP / 破線：潜在GDP / 点線：期間別最大GDP（兆円）</p>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="10年間の推計表"><table className="w-full min-w-[1400px] text-right text-xs tabular-nums"><caption className="sr-only">政策実施時の年次マクロ・財政推計</caption><thead><tr className="border-b border-mirai-border">{['年', '名目GDP', '実質GDP', '潜在GDP', '最大GDP', 'GDP gap', '最大gap', '物価', '輸入', '債務/GDP', '利払/GDP', 'GFN/GDP', 'PB/GDP', '債務安定PB/GDP', '最も近い制約'].map(h => <th scope="col" key={h} className="p-2">{h}</th>)}</tr></thead><tbody>
      {simulation.steps.map((s, i) => <tr key={s.state.year} className="border-b border-mirai-border last:border-0"><th scope="row" className="p-2">{s.state.year}</th>{[money(s.state.macro.nominalGdp, 1), money(s.state.macro.realGdp, 1), money(s.state.macro.potentialGdp, 1), money(s.production.maximum, 1), percent(s.outputGap), percent(s.maximumGap), percent(s.state.macro.inflation), money(s.state.external.imports, 1), percent(s.metrics.grossDebtGdp), percent(s.metrics.interestGdp), percent(s.metrics.gfnGdp), percent(s.metrics.primaryBalanceGdp), percent(s.metrics.stabilizingPrimaryBalance), peaksByYear[i]].map((v, j) => <td key={j} className="p-2">{v}</td>)}</tr>)}
    </tbody></table></div>
    <details><summary className="cursor-pointer text-sm font-bold">借換と利払いの根拠を見る</summary><div className="mt-3 space-y-3 text-xs leading-relaxed">
      <p>期首の満期分を当年市場金利で借換。既発債のクーポンは固定、純増発行分の利払いは翌年から。新発債は{parameters.newDebtMaturity}年満期です。以下は入力中の政策配分を固定し、ショックなしの金利経路との利払い差を示します（エネルギーショックなし）。</p>
      <div className="overflow-x-auto"><table className="w-full text-right tabular-nums"><caption className="text-left">金利ショックの利払い増加</caption><thead><tr><th scope="col" className="p-2">ショック</th>{[1, 5, 10].map(n => <th key={n} scope="col" className="p-2">{n}年後</th>)}</tr></thead><tbody>{shocks.map(row => <tr key={row.bp}><th scope="row" className="p-2">+{row.bp}bp</th>{row.years.map(v => <td key={v.year} className="p-2">{money(v.interestIncrease)}</td>)}</tr>)}</tbody></table></div>
      <p>10年後の政策なし債務/GDP：{percent(baseline.steps[9].metrics.grossDebtGdp)}。現在の配分との差：{points(simulation.steps[9].metrics.grossDebtGdp - baseline.steps[9].metrics.grossDebtGdp)}。</p>
      <p>Debt/GDP(t) = (1+r)/(1+g) × Debt/GDP(t−1) − PB/GDP(t) + SFA/GDP(t)。安定PB = (r−g)/(1+g) × Debt/GDP(t−1) + SFA/GDP(t)。rは期首債務に対する利払い率、gは名目成長率、PBは黒字が正。</p>
      <p>10年後のSFA/GDPは{percent(simulation.steps[9].metrics.stockFlowAdjustmentGdp)}。全債務を償還した後の余剰は金融資産となり、総債務の恒等式では資産取得分をSFAへ計上します。</p>
      <div className="overflow-x-auto"><table className="w-full text-right"><caption className="text-left">年0の債務ポートフォリオ</caption><thead><tr><th scope="col">満期年</th><th scope="col">元本</th><th scope="col">クーポン</th></tr></thead><tbody>{simulation.initial.state.debtPortfolio.map((b, i) => <tr key={i}><th scope="row" className="p-1">{b.maturityYear}</th><td>{money(b.principal)}</td><td>{percent(b.coupon)}</td></tr>)}</tbody></table></div>
    </div></details>
  </CardContent></Card>;
}
