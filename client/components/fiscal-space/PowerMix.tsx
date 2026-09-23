import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { POWER_TECHNOLOGIES, POWER_DETAIL_SOURCE, POWER_FIRM_NOTE, POWER_CONSTRUCTION_SOURCE, SOLAR_LAG_NOTE, powerCase, powerTrade, type PowerTechnology, type PowerCase } from '@/app/lib/fiscal-space/policy-trade';
import { fieldClass, money } from './format';
import type { TradeForm } from './PolicyTrade';

const technologies = Object.keys(POWER_TECHNOLOGIES) as PowerTechnology[];
const names = { solar: '太陽光', nuclear: '原子力（新設）', hydro: '水力（新設）' };
export function PowerMix({ value, total, onChange }: { value: TradeForm; total: number; onChange: (v: TradeForm, total: number) => void }) {
  const cases = Object.fromEntries(technologies.map(id => [id, value.powerCases?.[id] ?? (value.power.technology === id ? value.power : powerCase(id))])) as Record<PowerTechnology, PowerCase>;
  const weights = value.mix ?? { solar: 0, nuclear: 0, hydro: 0, [value.power.technology]: 1 };
  const sum = technologies.reduce((v, id) => v + weights[id], 0);
  const amounts = Object.fromEntries(technologies.map(id => [id, total * weights[id] / sum])) as Record<PowerTechnology, number>;
  const changeShare = (id: PowerTechnology, percent: number) => {
    const others = technologies.filter(key => key !== id);
    const selected = Math.round(percent * 10), remainder = 1000 - selected;
    const otherSum = others.reduce((v, key) => v + weights[key], 0);
    const first = Math.round(remainder * (otherSum > 0 ? weights[others[0]] / otherSum : .5));
    const next = { ...weights, [id]: selected / 1000, [others[0]]: first / 1000, [others[1]]: (remainder - first) / 1000 };
    onChange({ ...value, powerCases: cases, mix: next }, total);
  };
  const changeCase = (id: PowerTechnology, key: keyof PowerCase, n: number | null) => {
    const updated = { ...cases[id], [key]: n };
    onChange({ ...value, powerCases: { ...cases, [id]: updated }, power: value.power.technology === id ? updated : value.power }, total);
  };
  return <Card><CardHeader><h2 className="text-lg font-bold">発電投資の電源構成</h2>
    <p className="text-xs leading-relaxed">発電投資総額は政策欄で入力し、ここでは電源別の配分を%で指定します。変更した電源の割合を優先し、残りを他の電源の比率に応じて調整して合計100%にします。他がともに0%なら残りを等分します。発電量の比率とは異なります。</p>
  </CardHeader><CardContent className="space-y-3 text-xs">
    <div className="flex flex-wrap gap-3" role="group" aria-label="発電投資の配分方式">{technologies.map(id => <label key={id} className="flex items-center gap-1"><input type="radio" name="power-allocation" checked={!value.mix && value.power.technology === id} onChange={() => onChange({ ...value, mix: undefined, powerCases: cases, power: cases[id] }, total)} />{names[id]}のみ</label>)}<label className="flex items-center gap-1"><input type="radio" name="power-allocation" checked={!!value.mix} onChange={() => onChange({ ...value, mix: weights, powerCases: cases }, total)} />組み合わせ</label></div>
    <div className="overflow-x-auto" role="region" aria-label="電源別の配分と条件" tabIndex={0}><table className="w-full min-w-[950px] text-left"><thead><tr>{['電源', '投資配分（%）', '建設費（万円/kW）', '設備利用率（%）', '稼働まで（年）', '輸入費（円/kWh）', '確実供給への寄与率（%・仮定）', '効果期間'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead><tbody>{technologies.map(id => <tr key={id} className="border-t border-mirai-border"><th scope="row" className="p-2">{names[id]}</th>
      <td className="p-2"><input type="number" aria-label={`${names[id]}・投資配分`} className={fieldClass} min={0} max={100} step={.1} value={Number((weights[id] / sum * 100).toFixed(1))} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) changeShare(id, Math.min(100, Math.max(0, e.target.valueAsNumber))); }} /><span className="mt-1 block tabular-nums text-mirai-text-subtle" data-power-amount={id}>{money(amounts[id] * 1e12, 3)}／年</span></td>
      {([['capexPerKw', '建設費', 1e4, 1, 500], ['capacityFactor', '設備利用率', .01, 0, 100], ['lag', '稼働まで', 1, 0, 30], ['operatingImportYenPerKwh', '輸入費', 1, 0, 50], ['firmShare', '確実供給への寄与率', .01, 0, 100]] as const).map(([key, label, scale, min, max]) => <td key={key} className="p-2"><input type="number" aria-label={`${names[id]}・${label}`} className={fieldClass} min={min} max={max} step={key === 'lag' ? 1 : .1} value={cases[id][key] === null ? '' : Number((cases[id][key]! / scale).toFixed(4))} placeholder="未推計" onChange={e => {
        if (e.target.value === '' && (key === 'operatingImportYenPerKwh' || key === 'firmShare')) changeCase(id, key, null);
        else if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) { const n = Math.min(max, Math.max(min, e.target.valueAsNumber)); changeCase(id, key, (key === 'lag' ? Math.round(n) : n) * scale); }
      }} /></td>)}<td className="p-2">{POWER_TECHNOLOGIES[id].lifetime}年</td>
    </tr>)}</tbody></table></div>
    <details><summary className="cursor-pointer font-bold">電源別の輸入・火力置換の条件</summary>
      <div className="mt-3 space-y-4">{technologies.map(id => <fieldset key={id} className="space-y-2"><legend className="font-bold">{names[id]}</legend>
        <div className="grid gap-3 sm:grid-cols-2">{([
          ['curtailment', '追加の出力制御率（仮定）', .01, '%', 100],
          ['thermalReplacement', '発電量のうち火力を置換（仮定）', .01, '%', 100],
          ['displacedFuelYenPerKwh', '置換する輸入燃料単価（仮定）', 1, '円/kWh', 50],
          ['capexImportShare', '建設費の輸入割合', .01, '%', 100],
        ] as const).map(([key, label, scale, unit, max]) => <label key={key} className="space-y-1"><span className="block">{label}（{unit}）</span>
          <input type="number" aria-label={`${names[id]}・${label}`} className={fieldClass} min={0} max={max} step={.1} placeholder="未推計"
            value={cases[id][key] === null ? '' : Number((cases[id][key]! / scale).toFixed(4))}
            onChange={e => {
              if (e.target.value === '' && key === 'capexImportShare') changeCase(id, key, null);
              else if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) changeCase(id, key, Math.min(max, Math.max(0, e.target.valueAsNumber)) * scale);
            }} />
        </label>)}</div>
      </fieldset>)}</div>
      <p className="mt-2">建設費の輸入割合が空欄の場合は、公表モデルの共通反応を使います。各電源の条件は、組み合わせた場合も個別に反映されます。</p>
    </details>
    <p>発電投資の合計：<strong data-testid="power-investment-total">{total.toFixed(1)}兆円／年</strong>。初回支出は年1で、稼働まで2年なら年3から効果を計上します。</p>
    <p>{SOLAR_LAG_NOTE} <a href={POWER_CONSTRUCTION_SOURCE} className="underline" target="_blank" rel="noreferrer">建設期間の出典</a></p>
    <p>{POWER_FIRM_NOTE} 建設中の電力需要は先に増えるため、稼働前や需要増が供給増を上回る期間は逼迫する場合があります。</p>
    {total > 0 && technologies.some(id => weights[id] > 0 && cases[id].firmShare === null) && <p role="status" className="font-bold">確実供給への寄与率が空欄の電源があります。その電源への投資は電力供給能力の改善に反映されていません。上の寄与率を入力してください。</p>}
    <p>原子力は新設の条件です。<a href={POWER_DETAIL_SOURCE} className="underline" target="_blank" rel="noreferrer">公表の核燃料サイクル費1.9円/kWh</a>のうち海外支払50%と仮定し、輸入費を0.95円/kWhに設定。実測の輸入比率ではありません。70%の利用率・建設期間・燃料費を含めて比較し、再稼働案件とは区別します。火力置換率・出力制御・建設費の輸入割合は「電源別の輸入・火力置換の条件」で変更できます。</p>
    <section className="space-y-2" aria-labelledby="power-fuel-heading">
      <h3 id="power-fuel-heading" className="font-bold">増強せず火力で賄う場合との比較</h3>
      <p>各電源に<strong>1兆円を一度投資</strong>した設備の、稼働後1年間の輸入額です（入力価格を固定）。同じ電力需要を満たし、設定した火力置換分を既存火力で賄う場合と比較します。節約額は本体の「国内代替」に計上済みで、ここから重ねて加算しません。</p>
      <div className="overflow-x-auto" role="region" aria-label="火力継続と電源増強の輸入比較" tabIndex={0}><table className="w-full min-w-[590px] text-left tabular-nums"><thead><tr>{['電源・稼働開始', '増強なしの火力燃料', '新電源の運転時輸入', '差引の輸入削減'].map(label => <th className="p-2" scope="col" key={label}>{label}<span className="block font-normal">{label === '電源・稼働開始' ? '単年度の投資分' : '兆円／年'}</span></th>)}</tr></thead><tbody>{technologies.map(id => {
        const c = cases[id], flow = powerTrade({ annualCost: 1e12, kind: 'temporary', duration: 1 }, c.lag + 1, c);
        return <tr key={id} data-fuel-comparison={id} className="border-t border-mirai-border"><th scope="row" className="p-2">{names[id]}<span className="block font-normal">{c.lag + 1}年目から</span></th><td className="p-2" data-fuel="thermal">{money(flow.substitution, 3)}</td><td className="p-2" data-fuel="operating">{flow.operatingImports === null ? '未推計' : money(flow.operatingImports, 3)}</td><td className="p-2 font-bold" data-fuel="saving">{flow.operatingImports === null ? '未推計' : money(flow.substitution - flow.operatingImports, 3)}</td></tr>;
      })}</tbody></table></div>
      <p>需要増・非化石電源の減少に伴う火力燃料は、「産業・電力負荷の条件」で設定する共通経路として全政策に計上します。この表は個別設備の稼働条件で、全国の火力燃料残高・送電網との重複による上限適用前です。建設設備の輸入、蓄電・調整力、必要な火力新設費、国内保守費を含む総費用比較ではなく、太陽光の夜間供給や原子力の長い効果期間も、この年間額だけでは評価できません。</p>
    </section>
  </CardContent></Card>;
}
