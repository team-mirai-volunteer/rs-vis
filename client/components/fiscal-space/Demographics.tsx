import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ProjectionStep } from '@/types/fiscal-space';
import { DEMOGRAPHIC_SOURCES, PROJECTION_YEARS, type DemographicAssumptions } from '@/app/lib/fiscal-space/demographics';
import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
import { RangeField } from './Controls';
import { percent, fieldClass } from './format';

const index = (v: number) => v.toFixed(3);
const people = (v: number) => `${Math.round(v / 1e4).toLocaleString('ja-JP')}万人`;

/** Population path behind the baseline: labour force, 65+ and 0–14 indices, births and the policy
 * birth channel. Values are the official medium variant with 2024 participation rates held fixed. */
export function Demographics({ steps, baseline, longRun, value, onChange, baseYear }: {
  steps: ProjectionStep[]; baseline: ProjectionStep[]; longRun: FiscalCalculation['longRun'];
  value: DemographicAssumptions; onChange: (v: DemographicAssumptions) => void; baseYear: number;
}) {
  const change = <K extends keyof DemographicAssumptions>(key: K, n: DemographicAssumptions[K]) => onChange({ ...value, [key]: n });
  const off = value.mode === 'off';
  const shortRows = steps.map((step, i) => ({ step, base: baseline[i] })).filter(({ step }) => step.demographics)
    .filter((_, i, all) => i === 0 || i === all.length - 1 || (i + 1) % 5 === 0);
  const longRows = longRun.filter(r => [10, 20, 30].includes(r.year));
  const lastStep = steps.at(-1);
  return <Card><CardHeader>
    <h2 className="text-lg font-bold">人口動態：労働力・高齢化・出生の経路</h2>
    <p className="text-sm leading-relaxed">政策なしの基準経路は、国立社会保障・人口問題研究所の将来推計人口（出生中位・死亡中位）に2024年の年齢階級別労働力率を掛けた労働力人口指数で伸ばします。潜在GDPには労働弾力性を掛けて反映し、年金・医療・介護に相当する歳出は65歳以上人口、家族関係給付は0〜14歳人口に連動します。{off && <strong>現在は「含めない」設定で、労働力人口と歳出の人口連動を固定しています。</strong>}</p>
  </CardHeader><CardContent className="space-y-4 text-sm">
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <label className="block space-y-1 text-sm"><span>人口動態の経路</span><select aria-label="人口動態の経路" className={fieldClass} value={value.mode} onChange={e => change('mode', e.target.value as DemographicAssumptions['mode'])}>
        <option value="included">含める（既定）</option><option value="off">含めない（2026-09-16以前の固定経路）</option>
      </select></label>
      <RangeField label="潜在GDPの労働弾力性" value={value.labourElasticity} min={0} max={1} step={.05} unit="" onChange={n => change('labourElasticity', n)} />
      <RangeField label="高齢化に連動する歳出割合" value={value.ageingShare * 100} min={0} max={80} step={1} unit="%" onChange={n => change('ageingShare', n / 100)} />
      <RangeField label="子ども人口に連動する歳出割合" value={value.childBenefitShare * 100} min={0} max={20} step={.5} unit="%" onChange={n => change('childBenefitShare', n / 100)} />
      <RangeField label="家族支出GDP比1ポイント当たりの出生率変化" value={value.fertilityPerGdpPoint} min={0} max={.5} step={.01} unit="" onChange={n => change('fertilityPerGdpPoint', n)} />
      <RangeField label="手取り増1%に対する出生率の弾力性" value={value.fertilityIncomeElasticity} min={0} max={2} step={.05} unit="" onChange={n => change('fertilityIncomeElasticity', n)} />
    </div>
    <p className="text-xs leading-relaxed">労働弾力性0.55は労働分配率の代理で、資本や生産性の反応を含まない仮定です。出生率の係数は、家族関係支出の対GDP比1ポイント増に対する合計特殊出生率＋0.1を既定の比較仮定として置いたもので、日本の因果推定値ではありません（国際比較研究の幅は <code>docs/fiscal-space-demographics.md</code> に記録）。社会保険料減税の本人手取り増から出生率への弾力性0.2は、ビスマルク年金導入期のドイツ州別データ（Fenge & Scheubel, ECB WP 1734, 2014）の所得係数を弾力性の桁に換算した仮定で、日本の因果推定値ではありません。同論文のもう一つの経路である年金の内部収益率は、賦課方式では賃金総額の成長率に等しく、このモデルの労働力人口指数と成長経路が担うため別建てにしていません。0で経路を無効化できます。追加出生は15年後以降に労働力へ入るため、5年以内の評価では子育て給付の歳出増としてだけ現れます。</p>
    {shortRows.length > 0 && <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="人口動態の経路表"><table className="w-full min-w-[720px] text-right text-sm tabular-nums">
      <caption className="text-left text-xs">指数は年0（{baseYear}年）＝1。労働力人口は政策反応を含む値。追加出生は政策による累計。</caption>
      <thead><tr>{['年', '暦年', '労働力人口指数', '65歳以上人口指数', '0〜14歳人口指数', '労働力人口', '政策なし', '出生数', '政策による追加出生（累計）'].map(x => <th scope="col" key={x} className="p-2">{x}</th>)}</tr></thead>
      <tbody>{shortRows.map(({ step, base }) => { const d = step.demographics!; return <tr key={step.state.year} className="border-t border-mirai-border">
        <th scope="row" className="p-2">{step.state.year}</th><td>{d.calendarYear}{d.beyondProjection && '†'}</td><td>{index(d.labourForceIndex)}</td><td>{index(d.population65Index)}</td><td>{index(d.childIndex)}</td>
        <td>{people(step.state.labour.labourForce)}</td><td>{people(base.state.labour.labourForce)}</td><td>{people(d.births)}</td><td>{Math.round(d.cumulativeExtraBirths).toLocaleString('ja-JP')}人</td></tr>; })}
      {longRows.map(r => <tr key={`long-${r.year}`} className="border-t border-mirai-border text-mirai-text-subtle">
        <th scope="row" className="p-2">{r.year}（長期）</th><td>{baseYear + r.year}{r.beyondProjection && '†'}</td><td>{index(r.labourForceIndex)}</td><td>{index(r.population65Index)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>{Math.round(r.extraBirths).toLocaleString('ja-JP')}人</td></tr>)}</tbody>
    </table></div>}
    {lastStep?.demographics && <p className="text-xs">年{lastStep.state.year}の歳出の人口連動倍率は {percent(((1 - value.ageingShare - value.childBenefitShare) + value.ageingShare * lastStep.demographics.population65Index + value.childBenefitShare * lastStep.demographics.childIndex) - 1)}（共通の名目成長・物価連動に上乗せ）。</p>}
    <p className="text-xs leading-relaxed">出典：{DEMOGRAPHIC_SOURCES.projection.name}（<a className="underline" href={DEMOGRAPHIC_SOURCES.projection.url} target="_blank" rel="noreferrer">原資料</a>、{PROJECTION_YEARS.first}〜{PROJECTION_YEARS.last}年、以後は最終年で据え置き†）、{DEMOGRAPHIC_SOURCES.participation.name}（<a className="underline" href={DEMOGRAPHIC_SOURCES.participation.url} target="_blank" rel="noreferrer">原資料</a>）、{DEMOGRAPHIC_SOURCES.ageing.name}（<a className="underline" href={DEMOGRAPHIC_SOURCES.ageing.url} target="_blank" rel="noreferrer">原資料</a>）。参加率の将来変化、外国人労働、労働時間、1人当たり給付の制度改定は含みません。</p>
  </CardContent></Card>;
}
