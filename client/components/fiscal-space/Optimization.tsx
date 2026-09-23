'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { POLICIES } from '@/app/lib/fiscal-space/assumptions';
import type { FiscalForm } from '@/client/lib/fiscal-space-form';
import { OBJECTIVES, OBJECTIVE_IDS, OBJECTIVE_WEIGHT_PRESETS, withObjectiveWeights, optimizationDefaults, type ObjectiveDirection, type OptimizationSettings } from '@/client/lib/fiscal-objective';
import { useFiscalOptimization } from '@/client/hooks/useFiscalOptimization';
import { REFERENCES } from '@/app/lib/fiscal-space/calibration';
import { fieldClass } from './format';
import { encodeScenario } from '@/client/lib/fiscal-space-url';

const number = (value: number | null, digits = 3) => value === null ? '未推計' : value.toLocaleString('ja-JP', { maximumFractionDigits: digits });
const signed = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${number(value)}`;

export function Optimization({ form, onChange, onEvaluationChange, onApply }: {
  form: FiscalForm; onChange: (settings: OptimizationSettings) => void;
  onEvaluationChange: (horizon: number, aggregation: OptimizationSettings['aggregation']) => void;
  onApply: (amounts: FiscalForm['amounts']) => void;
}) {
  const settings = form.optimization;
  const [shareLink, setShareLink] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  useEffect(() => { setShareLink(''); setShareNotice(''); }, [form]);
  const share = async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('panel', 'optimization');
      url.hash = encodeScenario(form);
      setShareLink(url.href);
      try { await navigator.clipboard.writeText(url.href); setShareNotice('最適化の共有URLをコピーしました。'); }
      catch { setShareNotice('下のURLをコピーしてください。'); }
    } catch { setShareNotice('共有できない入力があります。入力範囲を確認してください。'); }
  };
  const search = useFiscalOptimization(form);
  const result = search.completed?.result;
  const best = result?.best;
  const weightTotal = OBJECTIVE_IDS.reduce((sum, id) => sum + settings.objectives[id].weight, 0);
  const weightPreset = Object.values(OBJECTIVE_WEIGHT_PRESETS).find(preset => OBJECTIVE_IDS.every(id => settings.objectives[id].weight === preset.weights[id]));
  const horizon = form.horizon === 15 ? 15 : Math.min(form.horizon, REFERENCES[form.calibration.referenceModel].years);
  const setting = <K extends keyof OptimizationSettings>(key: K, value: OptimizationSettings[K]) => onChange({ ...settings, [key]: value });
  return <div className="space-y-5" data-testid="policy-optimization">
    <p className="text-sm">「未来への期待」を、選んだ指標と重みで比較するための試算です。重みは価値の優先順位を表す編集可能な仮置きで、実証された係数ではありません。重み0は総合点から除外します。</p>
    <fieldset className="space-y-2"><legend className="text-sm font-bold">重みの例から選ぶ</legend>
      <div className="flex flex-wrap gap-2">{Object.values(OBJECTIVE_WEIGHT_PRESETS).map(preset => <Button key={preset.label} variant="outline" size="sm" aria-pressed={weightPreset === preset} onClick={() => onChange(withObjectiveWeights(settings, preset.weights))}>{preset.label}</Button>)}</div>
      <p className="text-xs">{weightPreset ? weightPreset.description : '重みを個別に調整しています。'}例を選ぶと重みだけを変更します。</p>
      <p className="text-xs">同じ改善幅を達成したときの優先順位です。実際の点数への寄与は、各指標の変化量と下の「基準となる改善幅」で決まります。</p>
    </fieldset>
    <div className="grid gap-4 sm:grid-cols-3">
      {(['minBudget', 'maxBudget'] as const).map((key, i) => <label key={key} className="text-sm">追加予算の{i === 0 ? '下限' : '上限'}（兆円／年）
        <input className={fieldClass} type="number" min={0} max={100} step={.1} value={settings[key]} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) setting(key, e.target.valueAsNumber); }} />
      </label>)}
      <label className="text-sm">評価する時点<select aria-label="評価する時点" className={fieldClass} value={`${horizon}:${settings.aggregation}`} onChange={e => {
        const [years, aggregation] = e.target.value.split(':');
        onEvaluationChange(Number(years), aggregation as OptimizationSettings['aggregation']);
      }}>
        {horizon < 5 && <option hidden value={`${horizon}:${settings.aggregation}`}>{horizon}{settings.aggregation === 'terminal' ? '年目' : '年間の平均'}（現在の評価期間）</option>}
        <option value="5:terminal" disabled={REFERENCES[form.calibration.referenceModel].years < 5}>5年目</option>
        <option value="5:average" disabled={REFERENCES[form.calibration.referenceModel].years < 5}>5年間の平均</option>
        <option value="15:terminal">15年目</option>
        <option value="15:average">15年間の平均</option>
      </select></label>
    </div>
    <p className="text-xs">予算は各政策の年間入力額の合計です。実施期間・減税対象収入の上限・電源構成・事業条件は現在の設定を使います。{horizon === 15 ? '15年は公表期間外の延長計算を含みます。' : '評価期間後に生じる投資効果は点数に含みません。'}</p>
    <p className="text-xs">期間を変更するとメイン画面の試算・制約の評価期間もそろいます。年目の評価でも、制約はその年までの全期間で確認します。</p>
    {REFERENCES[form.calibration.referenceModel].years < 5 && <p className="text-xs">現在の参照モデルは公表期間が3年のため、5年の選択は無効です。5年評価には経済財政モデルへ切り替えてください。15年の延長評価は選択できます。</p>}
    <div className="overflow-x-auto" role="region" aria-label="価値の重み" tabIndex={0}>
      <table className="w-full min-w-[640px] text-left text-sm"><caption className="mb-2 text-left font-bold">何をどれだけ重視するか<span className="block text-xs font-normal sm:hidden">横にスクロールすると改善幅・目標値を設定できます →</span></caption>
        <thead><tr>{['指標', '重み', '望ましい方向', '基準となる改善幅', '目標値'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
        <tbody>{OBJECTIVE_IDS.map(id => {
          const metric = OBJECTIVES[id], value = settings.objectives[id];
          const change = (patch: Partial<typeof value>) => setting('objectives', { ...settings.objectives, [id]: { ...value, ...patch } });
          const input = (key: 'weight' | 'scale' | 'target', label: string, min: number, max: number) => <input className={`${fieldClass} min-w-20`} type="number" aria-label={`${metric.label}・${label}`} min={min} max={max} step={key === 'weight' ? 1 : .1} value={value[key]}
            onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) change({ [key]: e.target.valueAsNumber }); }} />;
          return <tr key={id} className="border-t border-mirai-border [&>th]:align-top [&>td]:align-top"><th scope="row" className="p-2 font-medium">{metric.label}</th>
            <td className="p-2">{input('weight', '重み', 0, 100)}<span className="text-xs">重みの合計の{weightTotal > 0 ? number(value.weight / weightTotal * 100, 1) : '0'}%</span></td>
            <td className="p-2"><select className={`${fieldClass} min-w-32`} aria-label={`${metric.label}・望ましい方向`} value={value.direction} onChange={e => change({ direction: e.target.value as ObjectiveDirection })}>
              <option value="increase">高いほどよい</option><option value="decrease">低いほどよい</option><option value="target">目標に近いほどよい</option>
            </select></td>
            <td className="p-2">{input('scale', '基準となる改善幅', .001, 1000)}<span className="text-xs">{metric.unit === '%' ? 'ポイント' : metric.unit}</span></td>
            <td className="p-2">{value.direction === 'target' ? <>{input('target', '目標値', -10000, 10000)}<span className="text-xs">{metric.unit}</span></> : '—'}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <details><summary className="cursor-pointer text-sm font-bold">点数の計算方法と指標の範囲</summary><div className="mt-2 space-y-2 text-xs">
      <p>総合点＝Σ（重み÷重みの合計）×（政策なしからの改善量÷基準となる改善幅）。政策なしは0点です。改善幅が小さいほど同じ変化を強く評価します。目標型は「政策なしと目標の距離 − 政策ありと目標の距離」を改善量にします。</p>
      <p>初期設定ではGDPは10兆円の増加、全体・子どもの貧困率と国民負担率はそれぞれ1ポイントの低下、実質可処分所得は年10万円の増加を基準に重みを掛けます。出生率は0.1の上昇、失業率は0.5ポイントの低下、CPIは1ポイントの低下、利払いは1兆円の減少、輸出入は10兆円の変化を基準にします。これらの改善幅も編集可能な価値判断です。目標型の期間平均は、各年の目標からの距離を平均して評価します。</p>
      <p>国民負担率は、地方・社会保障基金を含む税・社会保険料収入を名目GDPで割ったモデル値です。国民所得比や個々の家計の負担率とは異なり、GDPが増えることでも低下します。給付や公共サービスの便益は差し引いていません。</p>
      <p>全体・子どもの貧困率と実質可処分所得は「5年目の結果」と同じ直接効果のモデルを使います。所得は世帯人数の平方根で調整した等価可処分所得の中央値（万円／年）です。2024年の所得分布・価格・人口構成を固定し、各年に有効な給付・減税だけを反映する参考値で、将来の賃金・雇用・物価による変化は含みません。出生率は入力した弾力性の仮定に依存します。輸出・輸入・利払いは名目額で、価格や規模の変化も含みます。</p>
      <p>輸入の減少は消費・投資の減少でも起こります。医療の質、安全保障、自由、環境など未計測の価値は点数に入っていません。複数の指標が同じ効果を重複して評価することもあります。</p>
    </div></details>
    <fieldset><legend className="mb-2 text-sm font-bold">探索する政策（外した政策は現在額で固定）</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{POLICIES.map(policy => <label key={policy.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" aria-label={`${policy.name}を探索対象にする`} checked={settings.eligible[policy.id]} onChange={e => setting('eligible', { ...settings.eligible, [policy.id]: e.target.checked })} />{policy.name}
        {!settings.eligible[policy.id] && <span className="text-xs">{number(form.amounts[policy.id])}兆円</span>}
      </label>)}</div>
    </fieldset>
    <p className="text-xs">物価・労働・産業・電力・財政など、現在の制約を満たす候補だけを採用します。選択したストレスはそれぞれ個別に判定します。未評価の負荷は余裕として扱いません。</p>
    <div className="flex flex-wrap gap-2">
      <Button onClick={search.start} disabled={search.running}>この価値観で自動探索</Button>
      {search.running && <Button variant="outline" onClick={search.cancel}>探索を中止</Button>}
      <Button variant="outline" onClick={() => onChange(optimizationDefaults())}>重み・探索条件を初期設定に戻す</Button>
      <Button variant="outline" onClick={share}>この価値観のURLをコピー</Button>
    </div>
    <section className="space-y-2" aria-label="価値の重みを共有">
      <p className="text-xs">重み・評価時点・予算範囲・探索対象と現在の政策条件を共有します。リンクを開くと、このパネルで自分の価値観と比べたり、同じ条件で探索したりできます。未適用の探索候補は含みません。</p>
      {shareNotice && <p role="status" className="text-sm">{shareNotice}</p>}
      {shareLink && <input aria-label="最適化の共有URL" className={`${fieldClass} w-full`} readOnly value={shareLink} onFocus={e => e.target.select()} />}
    </section>
    {search.running && <p role="status" className="text-sm">探索中：{search.progress?.evaluations ?? 0}候補を評価。{search.progress?.bestScore !== null && search.progress?.bestScore !== undefined && `制約内の最高点 ${number(search.progress.bestScore)}`}</p>}
    {search.error && <p role="alert" className="text-sm">{search.error}</p>}
    {result && <section className="space-y-3 rounded-xl border border-mirai-border p-4" aria-label="自動探索の結果">
      <h3 className="font-bold">{best ? '探索で見つかった候補' : '制約内の候補が見つかりませんでした'}</h3>
      <p className="text-xs">{result.evaluations}候補を評価。現在の配分も候補に含め、0.1兆円単位で総額と配分を探索しました。{result.limitReached ? '候補数の上限に達した時点の結果です。' : ''}大域的な最適解や、実際の政策効果を保証するものではありません。</p>
      {search.stale && <p role="status" className="text-sm font-bold">条件が変わったため、この結果は適用できません。再探索してください。</p>}
      <p className="text-sm">現在の配分：{number(result.current.total)}兆円／年・{number(result.current.score)}点{!result.current.feasible && `（探索条件外：${result.current.violations.join('、')}）`}</p>
      {best ? <>
        <p className="text-lg font-bold">候補：{number(best.total)}兆円／年・{number(best.score)}点</p>
        <div className="overflow-x-auto" role="region" aria-label="指標と点数の比較" tabIndex={0}><table className="w-full min-w-[600px] text-right text-sm">
          <caption className="text-left">{result.aggregation === 'average' ? `${result.horizon}年間の平均` : `${result.horizon}年目`}の指標</caption>
          <thead><tr>{['指標', '政策なし', '現在の配分', '候補', '政策なしとの差', '点数への寄与'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
          <tbody>{OBJECTIVE_IDS.map(id => <tr key={id} className="border-t border-mirai-border"><th scope="row" className="p-2 text-left font-medium">{OBJECTIVES[id].label}{OBJECTIVES[id].unit && `（${OBJECTIVES[id].unit}）`}</th>
            <td>{number(result.baseline[id])}</td><td>{number(result.current.values[id])}</td><td>{number(best.values[id])}</td>
            <td>{signed(best.values[id] === null || result.baseline[id] === null ? null : best.values[id]! - result.baseline[id]!)}{OBJECTIVES[id].unit === '%' && 'ポイント'}</td><td>{signed(best.contributions[id])}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="overflow-x-auto"><table className="w-full text-right text-sm"><caption className="text-left">政策配分（兆円／年）</caption><thead><tr><th scope="col" className="text-left">政策</th><th scope="col">現在</th><th scope="col">候補</th></tr></thead>
          <tbody>{POLICIES.filter(p => best.amounts[p.id] > 0 || result.current.amounts[p.id] > 0).map(p => <tr key={p.id} className="border-t border-mirai-border"><th scope="row" className="py-2 text-left font-medium">{p.name}</th><td>{number(result.current.amounts[p.id])}</td><td>{number(best.amounts[p.id])}</td></tr>)}</tbody>
        </table></div>
        <Button disabled={search.stale || search.completed?.applied} onClick={() => { if (!search.stale) { search.markApplied(best.amounts); onApply(best.amounts); } }}>{search.completed?.applied ? 'この配分を適用しました' : 'この配分を適用'}</Button>
      </> : <p className="text-sm">予算の範囲、探索対象、制約や未評価の条件を確認してください。探索した範囲に候補がないという結果で、実行可能な政策が存在しないという証明ではありません。</p>}
    </section>}
    <p className="text-xs">重み・目標・探索条件も共有URLに保存されます。自動探索では政策額だけを変更し、適用するまでは現在の配分を保持します。</p>
  </div>;
}
