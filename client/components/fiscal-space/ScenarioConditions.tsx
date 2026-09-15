import type { FiscalSpaceEstimate, Inputs, ModelParameters, Policy, Simulation } from '@/types/fiscal-space';
import { INPUT_LABELS } from '@/app/lib/fiscal-space/assumptions';
import { type LongRunAssumptions } from '@/app/lib/fiscal-space/long-run';
import { RangeField } from './Controls';
import { fieldClass, money, percent, points } from './format';
import { constraintInflation } from '@/app/lib/fiscal-space/constraints';

import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
const MODEL_LABELS = { leontief: 'レオンチェフ', ces: 'CES', cobbDouglas: 'コブ＝ダグラス' };
export function ModelSensitivity({ rows, horizon, controlInputs, controlParameters, controlInflation, onParameters, onInputs, onInflation }: {
  rows: FiscalCalculation['modelSensitivity']; horizon: number;
  controlInputs: Inputs; controlParameters: ModelParameters; controlInflation: number;
  onParameters: (p: ModelParameters) => void; onInputs: (inputs: Inputs) => void; onInflation: (n: number) => void;
}) {
  return <section className="space-y-4 rounded-xl border border-mirai-border bg-card p-5" aria-label="参考上限の感度">
    <h2 className="text-lg font-bold">同じ配分の参考上限とモデル感度</h2>
    <p className="text-sm">全期間で同じ生産関数を使い、同じ初期投入・CPI上限で比較します。未評価の産業・電力負荷を含むため、政策額の推奨値ではありません。</p>
    <table className="w-full text-right text-sm"><thead><tr><th className="text-left">生産モデル</th><th>年間参考上限</th><th>評価期間</th></tr></thead><tbody>{rows.map(r => <tr key={r.label}><th className="py-2 text-left">{r.label}</th><td>{money(r.space.theoreticalMaximum)}{r.space.status === 'search-cap' ? '以上（探索上限）' : ''}</td><td>{horizon}年</td></tr>)}</tbody></table>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">使用する生産モデル<select className={fieldClass} value={controlParameters.productionModel} onChange={e => onParameters({ ...controlParameters, productionModel: e.target.value as ModelParameters['productionModel'] })}>{Object.entries(MODEL_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <RangeField label="CPI上限の感度" value={controlInflation * 100} min={.1} max={10} step={.1} unit="%" onChange={n => onInflation(n / 100)} />
      {(Object.keys(INPUT_LABELS) as (keyof Inputs)[]).map(key => <RangeField key={key} label={`${INPUT_LABELS[key]}の初期投入指数`} value={controlInputs[key]} min={1} max={1.5} step={.01} unit="倍" onChange={n => onInputs({ ...controlInputs, [key]: n })} />)}
    </div>
    <p className="text-xs">投入指数は観測された余力ではなく仮定です。1.08は潜在GDPに必要な基準投入の1.08倍。コブ＝ダグラスは中間財を含まない既存の定式化で、モデル間の違いには投入範囲も含みます。探索上限には代表消費税率がゼロになる額も含みます。</p>
  </section>;
}

export function InputOverview({ total, estimate, horizon, incomplete, projection, baseline, policies }: {
  total: number; estimate: FiscalSpaceEstimate; horizon: number; incomplete: boolean;
  projection: Simulation; baseline: Simulation; policies: Policy[];
}) {
  const peak = [projection.initial, ...projection.steps.slice(0, horizon)].reduce((a, b) => constraintInflation(a) >= constraintInflation(b) ? a : b);
  const effect = projection.steps[horizon - 1].state.macro.realGdp - baseline.steps[horizon - 1].state.macro.realGdp;
  const binding = estimate.constraints.filter(c => c.status === 'violated');
  return <section data-testid="input-overview" className="rounded-xl border border-mirai-border bg-card p-5">
    <div className="grid gap-4 sm:grid-cols-3">{[['入力額', money(total) + ' / 年'], ['この配分の参考上限', total === 0 ? '配分を入力してください' : money(estimate.theoreticalMaximum) + ' / 年'], ['評価期間', `年0〜${horizon}（短期）`]].map(([label, value]) => <div key={label}><p className="text-sm">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{value}</p></div>)}</div>
    <p className="mt-3 text-sm font-bold">入力額の年{horizon}実質GDP効果：{money(effect)}（政策なしとの差）。判定用CPIピーク：年{peak.state.year}・{percent(constraintInflation(peak))}。</p>
    {effect < 0 && <p className="mt-2 text-sm">この条件では政策終了後の反動を含め、年{horizon}の実質GDPが政策なし経路を下回ります。公表反応を期間に応じて組み合わせた試算で、実績や確定した将来予測ではありません。</p>}
    {total > 0 && <p className="mt-2 text-sm">参考上限の拘束：{binding.length ? binding.map(c => `${c.label}（年${c.year}）`).join('、') : '探索範囲では未特定'}。{binding.length > 0 && 'その他の評価済み制約は、この境界では非拘束です。'}</p>}
    <div className="mt-2 flex flex-wrap gap-1">{policies.map(p => <span key={p.id} className="rounded bg-mirai-surface-warm px-2 py-1 text-sm">{p.name} {money(p.annualCost, 1)}・{p.kind === 'permanent' ? '恒久' : `${p.duration}年`}</span>)}</div>
    <p className="mt-3 text-sm">前提：①公表実験の比例換算（入力額は初期GDPの{percent(total / projection.initial.state.macro.nominalGdp)}） ②最大GDP余力{percent(projection.initial.production.maximum / projection.initial.state.macro.realGdp - 1)}は投入指数の仮定 ③政策別の実証校正は未完了。</p>
    {projection.steps.slice(0, horizon).every(s => s.inflationPressure === 0) && <p className="mt-2 text-sm">この入力額では最大生産能力の超過による物価圧力は発生していません。超過需要の輸入配分・価格転嫁係数は現在の入力結果に作用せず、物価反応は公表反応とGDPギャップ等の設定から生じます。</p>}
    <p className="mt-3 text-xs">参考上限は入力した構成比・期間を保って拡大縮小した総額です。入力額に足す金額ではありません。{estimate.status === 'search-cap' && '探索上限（消費税の税率ゼロを含む）まで違反が見つかっていません。'}{estimate.status === 'baseline-violated' && '政策なしでも既存の閾値違反があります。'}{incomplete && ' 産業別・電力の追加負荷に未評価の項目があります。'}</p>
  </section>;
}

export function DurationSensitivity({ rows }: { rows: FiscalCalculation['durationSensitivity'] }) {
  if (!rows.length) return null;
  return <section aria-label="政策期間の比較" className="space-y-3 rounded-xl border border-mirai-border bg-card p-5">
    <h2 className="text-lg font-bold">終了年を変えると、GDPと物価はどう変わるか</h2>
    <p className="text-sm">
      入力した年額と配分を保ち、期限のある政策の支出期間を一括で変更します。恒久政策の期間は同じです。
      期間が長いほど累計費用も増えるため、同額予算での比較ではありません。
    </p>
    <div className="overflow-x-auto" role="region" aria-label="政策期間と終了後の反動" tabIndex={0}>
      <table className="w-full min-w-[580px] text-right text-sm">
        <caption className="text-left">評価は年0〜{rows[0].year}。GDP効果は政策なしとの差、CPIは総合と税率変更の直接効果を除く指標の大きい方。</caption>
        <thead><tr>{['支出期間', '期間内の累計政策費用', `年${rows[0].year}の実質GDP効果`, 'CPIピーク', 'ピーク年'].map(label =>
          <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.duration} className="border-t border-mirai-border">
          <th scope="row" className="p-2">{row.duration}年</th>
          <td>{money(row.cost)}</td><td>{money(row.gdpEffect)}</td>
          <td>{percent(row.cpi)}</td><td>年{row.peakYear}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="text-sm">
      GDP効果が負の行は、政策終了後の反動を含めて政策なし経路を下回ります。
      政府支出の1年追加は公表の1年限り実験を使用し、複数年支出と減税は継続実験の変化分を重ねた近似です。
      2〜4年支出を個別に実証した結果ではありません。
    </p>
  </section>;
}

export function LongRun({ rows, value, onChange }: {
  rows: FiscalCalculation['longRun']; value: LongRunAssumptions; onChange: (v: LongRunAssumptions) => void;
}) {
  return <section className="space-y-4 rounded-xl border border-mirai-border bg-card p-5" aria-label="長期シナリオ">
    <h2 className="text-lg font-bold">長期の債務・供給力シナリオ</h2>
    <p className="text-sm">公表乗数の期間後は、下の成長率・物価・借換金利・便益実現率で条件付き計算します。公表モデルによる予測でも、長期の財政上限でもありません。恒久政策の費用は毎年残り、投資便益は稼働時期・耐用年数・減耗に従います。</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <RangeField label="長期の実質成長率" value={value.realGrowth * 100} min={-1} max={3} step={.1} unit="%" onChange={n => onChange({ ...value, realGrowth: n / 100 })} />
      <RangeField label="長期の基準物価上昇率" value={value.inflation * 100} min={0} max={5} step={.1} unit="%" onChange={n => onChange({ ...value, inflation: n / 100 })} />
      <RangeField label="長期の借換金利" value={value.rate * 100} min={0} max={6} step={.1} unit="%" onChange={n => onChange({ ...value, rate: n / 100 })} />
      <RangeField label="長期便益の実現率" value={value.realization * 100} min={0} max={100} step={10} unit="%" onChange={n => onChange({ ...value, realization: n / 100 })} />
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-right text-sm"><caption className="text-left text-xs">供給便益は年0価格。債務/GDP差は同じ長期条件の政策なし経路との差。</caption><thead><tr>{['年', '年間政策費用', '年間供給便益', '債務/GDP', '政策なしとの差', '利払い'].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{rows.filter(r => [rows[0]?.year, 6, 10, 11, 20, 30].includes(r.year)).map(r => <tr key={r.year} className="border-t border-mirai-border"><th className="p-2">{r.year}</th><td>{money(r.policyCost)}</td><td>{money(r.supplyBenefit)}</td><td>{percent(r.debtGdp)}</td><td>{points(r.debtGdp - r.baselineDebtGdp)}</td><td>{money(r.interest)}</td></tr>)}</tbody></table></div>
    <p className="text-xs">短期末のGDP・価格の乖離は5年で解消する仮定。供給便益には設定した純追加性に加えて上記実現率を掛けます。金利からGDPへの追加効果、長期の産業・物価制約は未推計です。</p>
  </section>;
}
