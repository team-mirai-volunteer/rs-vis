import type { EconomyState, FiscalSpaceEstimate, Inputs, ModelParameters, Policy, Simulation } from '@/types/fiscal-space';
import { INPUT_LABELS } from '@/app/lib/fiscal-space/assumptions';
import { type LongRunAssumptions } from '@/app/lib/fiscal-space/long-run';
import { RangeField } from './Controls';
import { fieldClass, money, percent, points } from './format';
import { constraintInflation, unemploymentRate } from '@/app/lib/fiscal-space/constraints';
import { BudgetReference } from './BudgetReference';

import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
const MODEL_LABELS = { leontief: 'レオンチェフ', ces: 'CES', cobbDouglas: 'コブ＝ダグラス' };
export interface ModelSensitivityProps {
  rows: FiscalCalculation['modelSensitivity']; horizon: number;
  initial: EconomyState;
  controlInputs: Inputs; controlParameters: ModelParameters; controlInflation: number;
  onParameters: (p: ModelParameters) => void; onInputs: (inputs: Inputs) => void; onInflation: (n: number) => void;
}
export function ModelSensitivity({ rows, horizon, initial, controlInputs, controlParameters, controlInflation, onParameters, onInputs, onInflation }: ModelSensitivityProps) {
  return <section className="space-y-4 border-t border-mirai-border pt-5" aria-label="参考上限の感度">
    <h3 className="text-lg font-bold">生産能力とモデル別の参考上限</h3>
    <p className="text-sm">比較の基準：年0の実質GDP {money(initial.macro.realGdp)}、潜在GDP {money(initial.macro.potentialGdp)}。同じ投入条件を3つの生産モデルで比較します。</p>
    <p className="text-sm" data-testid="input-index-consequence">レオンチェフでは最大GDP能力 ＝ 実質GDP × 最小の投入指数。現在の最小値は{Math.min(...Object.values(controlInputs)).toFixed(2)}（{(Object.keys(INPUT_LABELS) as (keyof Inputs)[]).filter(k => controlInputs[k] === Math.min(...Object.values(controlInputs))).map(k => INPUT_LABELS[k]).join('・')}）で、年0の物理的余力は{percent(rows[0] ? rows[0].initialMaximum / initial.macro.realGdp - 1 : 0, 2)}。この1つの数字が供給余力の総量を決めています。下のスライダーで下げると、拘束制約が最大GDP能力へ交代します。</p>
    <p className="text-sm">最大概念のGDPギャップは投入指数から作る仮定で、労働時間・参加可能人口・設備稼働率を組み合わせた実測データからの推計ではありません。共通のTFP変化だけが残る場合や、別の制約・探索精度によって、生産関数を変えても同じ結果になる場合があります。</p>
    <p className="text-sm">政策による設備・有効労働・エネルギー・生産性の変化を、選択した生産関数へ渡します。初期の潜在GDPに合わせて通常稼働を校正し、最大稼働と区別します。産業・電力の概算に含まれない制約もあるため、政策額の推奨値ではありません。</p>
    <div className="overflow-x-auto" role="region" aria-label="生産モデル別の供給・物価・探索結果" tabIndex={0}><table className="w-full min-w-[850px] text-right text-sm">
      <caption className="text-left">GDP・潜在GDPの効果は追加予算の年{horizon}、CPIは評価期間のピーク。参考上限は同じ配分を拡大し、任意の定率控除を差し引いた別の計算です。</caption>
      <thead><tr>{['生産モデル', '年0の最大GDP', '潜在GDP効果', '実質GDP効果', 'CPIピーク', '年末の稼働率価格補正', '年間参考上限（任意控除後）'].map(x => <th key={x} scope="col" className="p-2">{x}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.label} className="border-t border-mirai-border"><th scope="row" className="py-2 text-left">{r.label}</th><td>{money(r.initialMaximum)}</td><td>{money(r.potentialEffect)}</td><td>{money(r.gdpEffect)}</td><td>{percent(r.cpiPeak, 3)}</td><td>{points(r.capacityPriceAdjustment)}</td><td>{r.space.status === 'unevaluated' ? '算出不可' : money(r.space.recommendedEnvelope, 1)}{r.space.status === 'search-cap' ? '（探索範囲の端）' : r.space.status === 'revenue-cap' ? '（減収対象の収入上限）' : ''}</td></tr>)}</tbody>
    </table></div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">使用する生産モデル<select aria-label="使用する生産モデル" className={fieldClass} value={controlParameters.productionModel} onChange={e => onParameters({ ...controlParameters, productionModel: e.target.value as ModelParameters['productionModel'] })}>{Object.entries(MODEL_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <RangeField label="CPI上限の感度" value={controlInflation * 100} min={.1} max={10} step={.1} unit="%" onChange={n => onInflation(n / 100)} />
      <RangeField label="稼働率による価格補正の強さ" value={controlParameters.capacityPriceSensitivity * 100} min={0} max={2} step={.1} unit="%" onChange={n => onParameters({ ...controlParameters, capacityPriceSensitivity: n / 100 })} />
      <RangeField label="価格補正が始まる稼働率" value={controlParameters.capacityPressureStart * 100} min={50} max={95} step={5} unit="%" onChange={n => onParameters({ ...controlParameters, capacityPressureStart: n / 100 })} />
      <RangeField label="価格補正の参照最大能力 / 潜在GDP" value={controlParameters.referenceCapacityRatio} min={1.01} max={1.5} step={.01} unit="倍" onChange={n => onParameters({ ...controlParameters, referenceCapacityRatio: n })} />
      {(Object.keys(INPUT_LABELS) as (keyof Inputs)[]).map(key => <RangeField key={key} label={`${INPUT_LABELS[key]}の初期投入指数`} value={controlInputs[key]} min={1} max={1.5} step={.01} unit="倍" onChange={n => onInputs({ ...controlInputs, [key]: n })} />)}
    </div>
    <details><summary className="cursor-pointer text-sm font-bold">生産能力の計算方法と前提</summary><div className="mt-3 space-y-3">
    <p className="text-xs">投入指数は観測された余力ではなく仮定です。1.08は潜在GDPに必要な基準投入の1.08倍。コブ＝ダグラスは中間財を含まない既存の定式化で、モデル間の違いには投入範囲も含みます。探索は代表消費税率がゼロになる額や、本人・事業主への配分に応じた社会保険料収入の限度でも止まります。</p>
    <p className="text-xs">通常稼働は初期投入の構成を保った比例利用と仮定し、各モデルで初期潜在GDPに一致させます。政策は投入量を変え、通常・最大能力を同じ関数で再計算します。研究はTFP、教育・保育・労働供給は有効労働、公共資本は公共サービスによる生産性と設備量、産業事業は設備、発電・系統の燃料節約は有効エネルギーへ換算します。公共資本の設備量経路と事業の供給係数は、設備0.35・エネルギー0.15という固定の参照弾力性で投入指数へ変換する仮定です。選択モデルの弾力性へ付け替えて効果を固定することはしません。発電の確実供給GWが設定されていれば、その増加率で有効エネルギー増分を制限します。未設定なら燃料節約由来の換算にとどまります。産業人員・電力ピークの制約は別途評価します。</p>
    <p className="text-xs">稼働率uの価格水準圧力を[max(0, min(1,u)−開始稼働率)/(1−開始稼働率)]²と仮定。政策による増分から、同じ需要を参照最大能力で処理した増分を差し引きます。0.5%・85%・参照能力1.10倍は未推定の設定で、公表モデルの供給構造を再現した値ではありません。補正強度0で公表物価反応のみとの比較ができます。補正は価格水準に一度加え、前年比へ変換します。供給拡大や余力の差で補正が負になる場合もあります。</p>
    </div></details>
  </section>;
}

export function InputOverview({ total, estimate, horizon, incomplete, projection, baseline, policies }: {
  riskAudit: FiscalCalculation['riskAudit'];
  estimate: FiscalSpaceEstimate;
  total: number; horizon: number; incomplete: boolean;
  projection: Simulation; baseline: Simulation; policies: Policy[];
}) {
  const effect = projection.steps[horizon - 1].state.macro.realGdp - baseline.steps[horizon - 1].state.macro.realGdp;
  return <section data-testid="input-overview" className="rounded-xl border border-mirai-border bg-card p-5">
    <h2 className="mb-4 text-lg font-bold">追加予算と国の一般会計予算</h2>
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div><h3 className="text-sm">設定した追加予算</h3><p className="text-xl font-bold tabular-nums">{money(total)} / 年</p></div>
          <div><h3 className="text-sm">同じ配分の参考上限（任意控除後・条件付き）</h3><p data-testid="recommended-envelope" className="text-xl font-bold tabular-nums">{estimate.status === 'unevaluated' ? '算出不可：負荷が未評価' : `${money(estimate.recommendedEnvelope, 1)} / 年`}</p>
            {estimate.status !== 'unevaluated' && <p className="text-xs tabular-nums" data-testid="theoretical-maximum-overview">控除前の探索額 {money(estimate.theoreticalMaximum, 1)}</p>}</div>
        </div>
        {estimate.status !== 'unevaluated' && total > estimate.recommendedEnvelope && <p className="text-xs">設定した追加予算は、任意控除後の参考上限を{money(total - estimate.recommendedEnvelope, 1)}上回ります。</p>}
        <p className="text-sm">評価期間：<strong>{horizon}年間</strong>{horizon > 5 && <span className="ml-2 text-xs text-mirai-text-subtle">公表期間（5年）を超える延長計算。公表反応の末尾を据え置き、稼働時期の遅い投資を含めて評価します。</span>}</p>
        <p className="text-xs">減税・社会保険料の軽減と追加支出の年額合計です。既存予算に対する追加措置を表します。</p>
        <details><summary className="cursor-pointer text-sm font-bold">追加予算の内訳・計算の前提</summary>
          <div className="mt-2 flex flex-wrap gap-1">{policies.map(p => <span key={p.id} className="rounded bg-mirai-surface-warm px-2 py-1 text-sm">{p.name} {money(p.annualCost, 1)}・{p.kind === 'permanent' ? '恒久' : `${p.duration}年`}</span>)}</div>
          <p className="mt-3 text-sm">公表実験の比例換算を含む試算です。追加予算は初期GDPの{percent(total / projection.initial.state.macro.nominalGdp)}。政策別の実証校正は未完了です。</p>
        </details>
      </div>
      <BudgetReference />
    </div>
    <ThreePoints estimate={estimate} projection={projection} baseline={baseline} horizon={horizon} />
    <details className="mt-2"><summary className="cursor-pointer text-xs">計算上の注意</summary>
      <div className="mt-2 space-y-2 text-xs">
        {effect < 0 && <p>この条件では政策終了後の反動を含め、年{horizon}の実質GDPが政策なし経路を下回ります。</p>}
        <p>公表反応を期間に応じて組み合わせた試算で、実績や確定した将来予測ではありません。</p>
        {incomplete && <p>産業別・電力の追加負荷に未評価の項目があります。</p>}
      </div>
    </details>
    <a href="#fiscal-envelope" className="mt-3 inline-block text-sm text-primary-accent underline">配分を拡大した場合の参考上限・生産能力を見る</a>
  </section>;
}

/** Binding year, GDP-effect peak year and terminal year side by side: the ceiling is set at the
 * CPI peak while the displayed outcome was the post-withdrawal trough. */
function ThreePoints({ estimate, projection, baseline, horizon }: { estimate: FiscalSpaceEstimate; projection: Simulation; baseline: Simulation; horizon: number }) {
  const steps = projection.steps.slice(0, horizon);
  // Without any policy there is no binding year; the fallback would just be the
  // no-policy CPI drift (which peaks in the final year) and reads as a result.
  if (estimate.status === 'empty-mix') return <p className="mt-3 text-sm" data-testid="three-points">政策額を入力すると、拘束年・実質GDP効果のピーク年・最終年の三時点を比較します。</p>;
  const gdpEffect = (i: number) => steps[i].state.macro.realGdp - baseline.steps[i].state.macro.realGdp;
  const cpiPeak = steps.reduce((a, b, i) => constraintInflation(steps[a]) >= constraintInflation(b) ? a : i, 0);
  const bindingYear = estimate.constraints.find(c => c.status === 'violated')?.year;
  const binding = bindingYear && bindingYear >= 1 && bindingYear <= horizon ? bindingYear - 1 : cpiPeak;
  const gdpPeak = steps.reduce((a, _, i) => gdpEffect(i) > gdpEffect(a) ? i : a, 0);
  const bindingLabel = estimate.constraints.find(c => c.status === 'violated')?.label;
  const points = [
    { key: 'binding', label: '拘束年', note: bindingLabel ?? '判定用CPIのピーク', index: binding },
    { key: 'gdp', label: 'GDP効果ピーク', note: '実質GDP効果が最大の年', index: gdpPeak },
    { key: 'terminal', label: '最終年', note: `評価期間${horizon}年の末`, index: horizon - 1 },
  ];
  return <div className="mt-3 overflow-x-auto" role="region" aria-label="拘束年・GDP効果ピーク年・最終年の比較" tabIndex={0} data-testid="three-points">
    <table className="w-full min-w-[520px] text-right text-sm tabular-nums [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
      <caption className="mb-1 text-left text-xs">枠は最も厳しい年、結果は最終年で決まるため、三時点を並べています。CPIは判定用（総合と消費税直接効果を除く値の大きい方）。</caption>
      <thead><tr><th scope="col" className="text-left">時点</th><th scope="col">年</th><th scope="col">CPI</th><th scope="col">実質GDP効果</th><th scope="col">失業率</th><th scope="col">債務/GDP</th></tr></thead>
      <tbody>{points.map(({ key, label, note, index }) => { const s = steps[index]; return <tr key={key} className="border-t border-mirai-border" data-point={key}>
        <th scope="row" className="py-1 pr-3 text-left font-medium">{label}<span className="block text-xs font-normal text-mirai-text-subtle">{note}</span></th><td>{s.state.year}</td><td>{percent(constraintInflation(s))}</td><td>{money(gdpEffect(index))}</td><td>{percent(unemploymentRate(s))}</td><td>{percent(s.metrics.grossDebtGdp, 1)}</td>
      </tr>; })}</tbody></table>
  </div>;
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
  return <section id="long-run" className="scroll-mt-20 space-y-4 rounded-xl border border-mirai-border bg-card p-5" aria-label="長期シナリオ">
    <h2 className="text-lg font-bold">長期の債務・供給力シナリオ</h2>
    <p className="text-sm">公表乗数の期間後は、下の成長率・物価・借換金利・便益実現率で条件付き計算します。公表モデルによる予測でも、長期の財政上限でもありません。恒久政策の費用は毎年残り、投資便益は稼働時期・耐用年数・減耗に従います。名目年額は固定し、短期終了後の各支出年の期首価格に長期物価を反映して購入量を計算します。過去に支出した投資の量は変えません。</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <RangeField label="長期の実質成長率" value={value.realGrowth * 100} min={-1} max={3} step={.1} unit="%" onChange={n => onChange({ ...value, realGrowth: n / 100 })} />
      <RangeField label="長期の基準物価上昇率" value={value.inflation * 100} min={0} max={5} step={.1} unit="%" onChange={n => onChange({ ...value, inflation: n / 100 })} />
      <RangeField label="長期の借換金利" value={value.rate * 100} min={0} max={6} step={.1} unit="%" onChange={n => onChange({ ...value, rate: n / 100 })} />
      <RangeField label="長期便益の実現率" value={value.realization * 100} min={0} max={100} step={10} unit="%" onChange={n => onChange({ ...value, realization: n / 100 })} />
    </div>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="長期投資の試算表"><table className="w-full min-w-[650px] text-right text-sm"><caption className="text-left text-xs">供給便益は年0価格。債務/GDP差は同じ長期条件の政策なし経路との差。</caption><thead><tr>{['年', '年間政策費用', '年間供給便益', '債務/GDP', '政策なしとの差', '借換金利', '利払い', '利払いの政策なしとの差'].map(x => <th scope="col" key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{rows.filter(r => [rows[0]?.year, 6, 10, 11, 20, 30].includes(r.year)).map(r => <tr key={r.year} className="border-t border-mirai-border"><th scope="row" className="p-2">{r.year}</th><td>{money(r.policyCost)}</td><td>{money(r.supplyBenefit)}</td><td>{percent(r.debtGdp)}</td><td>{points(r.debtGdp - r.baselineDebtGdp)}</td><td>{percent(r.rate)}</td><td>{money(r.interest)}</td><td>{money(r.interest - r.baselineInterest)}</td></tr>)}</tbody></table></div>
    <p className="text-xs">短期末のGDP・価格の乖離は5年で解消する仮定。CPIの乖離による既存歳出の連動分も同じ期間で解消します。政策経路の借換金利は上の長期金利に、公表期間末の公表長期金利反応を同じ5年で解消させて加えます。政策なし経路は上の長期金利のままです。供給便益には設定した純追加性に加えて上記実現率を掛けます。金利からGDPへの追加効果、長期の産業・物価制約は未推計です。</p>
  </section>;
}
