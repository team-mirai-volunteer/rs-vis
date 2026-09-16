import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ELECTRICITY_ACTUAL_SOURCE, ELECTRICITY_DEMAND_SOURCE, type ElectricityBaselineCase } from '@/app/lib/fiscal-space/electricity-baseline';
import type { Simulation } from '@/types/fiscal-space';
import { fieldClass, money } from './format';

export function ElectricityBaseline({ value, onChange, baseline, projection }: {
  value: ElectricityBaselineCase; onChange: (v: ElectricityBaselineCase) => void; baseline: Simulation; projection: Simulation;
}) {
  return <Card><CardHeader><h2 className="text-lg font-bold">全政策に共通する電力需要・火力燃料の経路</h2>
    <p className="text-xs">政策を追加しなくても、需要増や非化石電源の減少で不足する電力量を火力で補い、燃料輸入を計上します。減税・給付・産業投資にも同じ経路を適用し、追加発電・送電網の燃料削減をそこから差し引きます。</p>
  </CardHeader><CardContent className="space-y-3 text-xs">
    {baseline.initial.resourcePower && <p>概算モードのピーク需要には地域別の年度見通しを使用します。下のピーク増加率を変更すると、既定の年0.4%からの差を見通しに累積して反映します。年間電力量と火力燃料は下の共通経路で別に計算します。</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([
      ['generationTwh', '基準の発電電力量', 1, 'TWh', 1, 3000], ['thermalShare', '基準の火力割合', .01, '%', 0, 100],
      ['demandGrowth', '共通の電力需要増加率', .01, '%／年', -10, 10], ['peakGrowth', '共通のピーク需要増加率', .01, '%／年', -10, 10],
      ['nonThermalDecline', '既存非化石電源の発電量減少率', .01, '%／年', 0, 100],
      ['plannedNonThermalTwh', '既定計画の非化石発電の年間追加量', 1, 'TWh／年', 0, 100],
      ['fuelImportYenPerKwh', '共通経路の火力燃料輸入単価', 1, '円/kWh', 0, 50],
      ['marginalThermalShare', '政策の追加電力を輸入燃料の火力で賄う割合', .01, '%', 0, 100],
    ] as const).map(([key, label, scale, unit, min, max]) => <label key={key} className="space-y-1"><span className="block">{label}（{unit}）</span><input aria-label={label} type="number" className={fieldClass} min={min} max={max} step={.1} value={Number((value[key] / scale).toFixed(4))} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onChange({ ...value, [key]: Math.min(max, Math.max(min, e.target.valueAsNumber)) * scale }); }} /></label>)}</div>
    <p>初期値は<a className="underline" href={ELECTRICITY_ACTUAL_SOURCE} target="_blank" rel="noreferrer">2024年度の発電量991.1TWh・火力67.5%</a>と、<a className="underline" href={ELECTRICITY_DEMAND_SOURCE} target="_blank" rel="noreferrer">2026年度需要想定の平均伸び（電力量0.5%・ピーク0.4%）</a>を参考にしています。TWhは10億kWh。使用端の伸びを発電量へ適用する近似で、両データ版とも同じ将来条件を使います。非化石の減少率・既定計画は初期値0の仮定です。</p>
    <div className="overflow-x-auto" role="region" aria-label="全政策共通の火力燃料経路" tabIndex={0}><table className="w-full min-w-[650px] text-left tabular-nums"><thead><tr>{['年', '必要な発電量', '追加政策なしの火力増減', '共通の燃料輸入増減', '現在の政策の稼働による輸入削減', '共通増減−政策削減'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead><tbody>{baseline.steps.filter(s => [1, 3, 5, 10, 15].includes(s.state.year)).map(step => {
      const e = step.electricity!, actual = projection.steps[step.state.year - 1].electricity!;
      return <tr key={step.state.year} data-electricity-year={step.state.year} className="border-t border-mirai-border"><th scope="row" className="p-2">{step.state.year}年</th><td className="p-2">{e.demandTwh.toFixed(1)}TWh</td><td className="p-2">{e.thermalIncreaseTwh.toFixed(1)}TWh</td><td className="p-2" data-electricity="common">{money(e.commonFuelIncrease, 3)}</td><td className="p-2">{money(actual.operatingImportReduction, 3)}</td><td className="p-2">{money(e.commonFuelIncrease - actual.operatingImportReduction, 3)}</td></tr>;
    })}</tbody></table></div>
    <p>金額は各年の兆円／年。共通増減は政策間の差では相殺されますが、輸入・貿易収支・物価・財政枠には入ります。右端は燃料経路の内訳で、建設・所得増に伴う輸入などを含む貿易収支全体ではありません。既定計画と政策欄には同じ事業を重ねて入力しないでください。</p>
    <p>火力は不足電力量を補う運転の仮定です。火力設備を無償で増設する扱いにはせず、ピーク需要増を電力制約へ反映します。時間帯・地域別の供給不足、火力の新設費・廃止計画、政策別の追加電力需要・省エネ量は別途校正が必要です。</p>
  </CardContent></Card>;
}
