import type { ModelParameters } from '@/types/fiscal-space';
import { INSURANCE_DEFAULTS, INSURANCE_LEGACY } from '@/app/lib/fiscal-space/insurance-response';
import { RangeField } from './Controls';
import { Button } from '@/components/ui/button';

export function InsuranceConditions({ value, onChange }: { value: ModelParameters; onChange: (v: ModelParameters) => void }) {
  const c = value.insurance ?? INSURANCE_LEGACY;
  return <section className="space-y-3 border-t border-mirai-border pt-4" aria-label="社会保険料減税の賃金・長期労働反応">
    <h3 className="font-bold">社会保険料減税の賃金・長期労働反応</h3>
    <label className="block"><input type="checkbox" checked={c.enabled} onChange={e => onChange({ ...value, insurance: { ...c, enabled: e.target.checked } })} /> 賃金転嫁と長期労働反応を計算する</label>
    <p className="text-xs">本人負担の軽減は手取りへ、事業主負担の軽減は賃上げと残りの雇用コスト低下へ分けます。同じ軽減額を両方へ全額計上しません。賃上げは就労世帯の所得分布へ反映し、退職世帯には配分しません。</p>
    <div className="flex flex-wrap gap-2">{([
      ['追加反応なし', { ...INSURANCE_DEFAULTS, enabled: false }],
      ['慎重', { ...INSURANCE_DEFAULTS, wagePassThrough: .25, hoursElasticity: .05, participationElasticity: .025, demandElasticity: .1 }],
      ['中心', { ...INSURANCE_DEFAULTS }],
      ['強め', { ...INSURANCE_DEFAULTS, wagePassThrough: .75, hoursElasticity: .2, participationElasticity: .1, demandElasticity: .3 }],
    ] as const).map(([label, settings]) => <Button key={label} variant="outline" size="sm" className="border-mirai-border font-medium" onClick={() => onChange({ ...value, insurance: { ...settings } })}>社保：{label}</Button>)}</div>
    <div className="grid gap-4 md:grid-cols-2">{([
      ['wagePassThrough', '事業主軽減の賃金転嫁率', 100, 0, 100, 5, '%'],
      ['netWageRetention', '賃上げの手取り残存率', 100, 0, 100, 5, '%'],
      ['adjustmentYears', '賃金・長期労働の調整年数', 1, 1, 20, 1, '年'],
      ['hoursElasticity', '社保・長期の労働時間弾力性', 1, 0, 1, .025, ''],
      ['participationElasticity', '社保・長期の労働参加弾力性', 1, 0, 1, .025, ''],
      ['demandElasticity', '社保・残余コストへの雇用弾力性', 1, 0, 1, .05, ''],
    ] as const).map(([key, label, scale, min, max, step, unit]) => <RangeField key={key} label={label} value={c[key] * scale} min={min} max={max} step={step} unit={unit} onChange={n => onChange({ ...value, insurance: { ...c, [key]: n / scale } })} />)}</div>
    <p className="text-xs">中心条件は賃金転嫁50%・手取り残存70%・調整5年、時間0.1・参加0.05・雇用需要0.2。すべて日本の全国一律減税について未推定の比較条件です。<a className="underline" href="https://www.rieti.go.jp/jp/publications/nts/13e067.html" target="_blank" rel="noreferrer">日本の企業分析</a>と<a className="underline" href="https://www.aeaweb.org/articles?id=10.1257/aer.20171937" target="_blank" rel="noreferrer">スウェーデンの若者向け減税研究</a>は帰着・雇用反応の違いを示しています。減税と増税の対称性も保証されません。</p>
    <p className="text-xs">賃金転嫁は開始年から段階的に反映。労働反応は公表期間後から追加し、雇用増は労働参加と企業需要の小さい方で制限します。設備・電力などが制約ならGDPは増えない場合があります。上の共通弾力性を非ゼロにした項目は、対応する社保の追加反応を置き換えます。</p>
    <p className="text-xs">手取りの増分は固定所得分布での帰着試算です。賃上げによる追加税収と企業利益減による減収の差は未推計で、財政収支へ別加算しません。感度ボタンはこの欄だけを置き換えます。料率の一律軽減を想定し、年収の壁・給付削減・代替増税は別途未評価です。</p>
  </section>;
}
