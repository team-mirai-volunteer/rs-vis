import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ModelParameters } from '@/types/fiscal-space';
import { REFERENCES, type ReferenceModel } from '@/app/lib/fiscal-space/calibration';
import { RangeField } from './Controls';
import { fieldClass } from './format';

type Sensitivity = Pick<ModelParameters, 'referenceModel' | 'multiplierScale' | 'hoursElasticity' | 'participationElasticity' | 'netLabourIncomeShare' | 'employeeReliefShare' | 'employerDemandElasticity' | 'employerLabourCostShare'>;
export function Calibration({ value, onChange }: { value: Sensitivity; onChange: (value: Sensitivity) => void }) {
  const change = <K extends keyof Sensitivity>(key: K, n: Sensitivity[K]) => onChange({ ...value, [key]: n });
  const ref = REFERENCES[value.referenceModel];
  return <Card><CardHeader><h2 className="text-lg font-bold">乗数・労働反応の条件</h2>
    <p className="text-sm leading-relaxed">公表モデルの年次反応を比較条件に使います。観測された因果効果や「正解の係数」を意味しません。</p>
  </CardHeader><CardContent className="space-y-4 text-sm">
    <label className="block space-y-2"><span>参照するマクロモデル</span><select className={fieldClass} value={value.referenceModel} onChange={e => change('referenceModel', e.target.value as ReferenceModel)}>
      {Object.entries(REFERENCES).map(([id, r]) => <option key={id} value={id}>{r.name}</option>)}
    </select></label>
    <p className="text-xs leading-relaxed">{ref.note} <a className="text-primary-accent underline" href={ref.url} target="_blank" rel="noreferrer">原資料</a>。主表と制約評価は公表期間（{ref.years}年）内に限定します。経済財政モデルの1年限りの政府支出は、継続実験の差分ではなく、1年限りの公表実験を使用します。</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-right text-xs"><caption className="mb-2 text-left">初年度の実質GDP増加額 / 財政措置額（感度倍率を掛ける前）</caption><thead><tr><th className="p-2 text-left">参照条件</th><th className="p-2">政府支出</th><th className="p-2">所得税減税</th><th className="p-2">法人税減税</th></tr></thead><tbody>{Object.entries(REFERENCES).map(([id, r]) => <tr key={id} className="border-t border-mirai-border"><th className="p-2 text-left font-medium">{r.name}</th>{[r.government.gdp[0], r.household.gdp[0], r.corporate.gdp[0]].map((n, i) => <td key={i} className="p-2 tabular-nums">{n.toFixed(2)}</td>)}</tr>)}</tbody></table></div>
    <p className="text-xs leading-relaxed">社会保険料は本人・事業主の双方を軽減（初期配分は折半）。本人分は所得税減税、事業主分は法人税減税の反応を代用しており、社会保険料固有の推計ではありません。現金給付・消費税減税も所得税の反応を代用し、消費税率変更の直接的な物価効果は未算入です。その他の支出は共通の政府支出反応が基準です。下の事業条件を設定すると調達先・稼働後の輸出・国内代替・追加供給能力を反映しますが、政策別の実証校正は未完了です。</p>
    <details><summary className="cursor-pointer font-bold">この乗数はどこまで信用できる？</summary><p className="mt-2 text-xs leading-relaxed">2つの公表モデルが近い値でも、実際の政策効果の独立した検証にはなりません。日本の政府支出を分析した<a className="text-primary-accent underline" href="https://www.aeaweb.org/articles?id=10.1257/mac.20170131" target="_blank" rel="noreferrer">宮本・Nguyen・Sergeyev（2018）</a>は、金利の下限制約下で当期乗数1.5、それ以外で0.6と推定しています。これは四半期の当期反応で、上表の年間値とは期間が異なります。景気・金融政策、恒久か一時か、対象者、推定方法によって結果が変わるため、数値だけを混ぜて平均したり信頼区間にしたりしていません。</p></details>
    <details><summary className="cursor-pointer font-bold">乗数と本人・事業主の反応を変える</summary><div className="mt-4 grid gap-4 md:grid-cols-2">
      <RangeField label="GDP乗数の感度倍率" value={value.multiplierScale} min={0} max={3} step={.1} unit="倍" onChange={n => change('multiplierScale', n)} />
      <RangeField label="社会保険料軽減の本人配分" value={value.employeeReliefShare * 100} min={0} max={100} step={10} unit="%" onChange={n => change('employeeReliefShare', n / 100)} />
      <RangeField label="手取り賃金に対する労働時間の弾力性" value={value.hoursElasticity} min={0} max={1} step={.1} unit="" onChange={n => change('hoursElasticity', n)} />
      <RangeField label="手取り賃金に対する労働参加の弾力性" value={value.participationElasticity} min={0} max={1} step={.1} unit="" onChange={n => change('participationElasticity', n)} />
      <RangeField label="雇用コスト低下に対する労働需要の弾力性" value={value.employerDemandElasticity} min={0} max={1} step={.1} unit="" onChange={n => change('employerDemandElasticity', n)} />
      <RangeField label="本人の手取り労働所得 / GDP（換算仮定）" value={value.netLabourIncomeShare * 100} min={20} max={70} step={5} unit="%" onChange={n => change('netLabourIncomeShare', n / 100)} />
      <RangeField label="事業主の総雇用コスト / GDP（換算仮定）" value={value.employerLabourCostShare * 100} min={30} max={90} step={5} unit="%" onChange={n => change('employerLabourCostShare', n / 100)} />
    </div><p className="mt-3 text-xs leading-relaxed">労働時間0.1・参加0.05を初期の感度条件に採用。事業主の追加労働需要は0＝未算入です。<a className="underline" href="https://www.nber.org/papers/w16729" target="_blank" rel="noreferrer">Chettyほかの研究整理</a>の補償弾力性（時間0.3・参加0.25）を参考に低い反応を置いていますが、所得効果を含む日本の減税効果として推定した値ではありません。0でも比較できます。本人分は時間・参加と潜在供給、事業主分は必要な雇用量へ反映。供給が増えただけでは短期GDPに加算しません。1年限りの減税の直接効果は終了後に残さず、恒久減税なら軽減中は継続します。</p>
      <p className="mt-2 text-xs leading-relaxed">日本の税制改正を用いた<a className="text-primary-accent underline" href="https://doi.org/10.1016/j.labeco.2010.11.011" target="_blank" rel="noreferrer">山田（2011）</a>の0.8は既婚女性の労働時間の推定値で、日本全体や労働参加率には流用しません。<a className="text-primary-accent underline" href="https://www.rieti.go.jp/jp/publications/dp/17e093.pdf" target="_blank" rel="noreferrer">児玉・横山の社会保険料改革の研究</a>は雇用人数と一人当たり時間の異なる反応を報告しています。全国一律の料率軽減への外挿には別の検証が必要です。</p>
    </details>
  </CardContent></Card>;
}
