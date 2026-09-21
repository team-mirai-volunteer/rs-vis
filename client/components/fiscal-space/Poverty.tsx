import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CASH_TARGET_LABELS, POVERTY_DATA, type PovertyAssumptions } from '@/app/lib/fiscal-space/poverty';
import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
import { fieldClass, money, percent } from './format';
import { RangeField } from './Controls';

const difference = (value: number) => {
  const rounded = Number((value * 100).toFixed(1)) || 0;
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(1)}ポイント`;
};

export function Poverty({ result, value, onChange }: {
  result: FiscalCalculation['poverty']; value: PovertyAssumptions; onChange: (value: PovertyAssumptions) => void;
}) {
  const first = result.rows[0];
  const observed = { all: POVERTY_DATA.allPovertyRate, child: POVERTY_DATA.childPovertyRate };
  return <Card data-testid="poverty-comparison"><CardHeader>
    <h2 className="text-lg font-bold">現金給付・減税による貧困率の変化</h2>
    <p className="text-sm">2024年の所得分布に、設定した政策の年額を適用した直接効果の比較です。所得・物価・人口を固定しているため、将来の貧困率の予測ではありません。</p>
  </CardHeader><CardContent className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      {(['all', 'child'] as const).map(key => <div key={key} className="rounded-lg border border-mirai-border p-3" data-testid={`poverty-${key}`}>
        <h3 className="text-sm font-bold">{key === 'all' ? '相対的貧困率（再分配後）' : '子どもの貧困率（17歳以下・再分配後）'}</h3>
        <p className="mt-2 text-xs">追加施策なし → 年1の追加施策あり</p>
        <p className="mt-1 text-xl font-bold tabular-nums">{percent(observed[key], 1)} → <span data-testid={`poverty-${key}-after`}>{percent(first[key], 1)}</span></p>
        <p className="text-sm tabular-nums">差 {difference(first[key] - result.baseline[key])}</p>
        <p className="mt-1 text-xs text-mirai-text-subtle">仮定を変えた場合 {percent(first.range[key].min, 1)}〜{percent(first.range[key].max, 1)}。統計的な信頼区間ではありません。</p>
      </div>)}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block space-y-1 text-sm"><span>現金給付の配り方</span>
        <select className={fieldClass} aria-label="現金給付の配り方" value={value.cashTarget} onChange={e => onChange({ ...value, cashTarget: e.target.value as PovertyAssumptions['cashTarget'] })}>
          {Object.entries(CASH_TARGET_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <RangeField label="子育て予算のうち現金給付に回す割合" value={value.childcareCashShare * 100} min={0} max={100} step={10} unit="%" onChange={n => onChange({ ...value, childcareCashShare: n / 100 })} />
    </div>
    <p className="text-xs">計算済みの配分：現金給付は「{CASH_TARGET_LABELS[result.assumptions.cashTarget]}」、子育て予算の{percent(result.assumptions.childcareCashShare, 0)}を子ども1人当たりの現金給付とする仮定です。これらは貧困率の比較条件で、既存のGDP・出生率の反応係数は変わりません。</p>
    <p className="text-xs">所得税・住民税は推定税額に比例した減税、社会保険料は本人負担分の軽減を反映します。モデル上で非課税の人には所得税減税を配分せず、還付は加算しません。子育て予算の現金割合の初期値は100%です。</p>
    <div className="overflow-x-auto" role="region" aria-label="貧困率の政策比較" tabIndex={0}>
      <table className="w-full min-w-[660px] text-right text-sm tabular-nums">
        <caption className="text-left text-xs">各年の有効な政策だけを適用。現金給付を貯蓄として累積せず、一時政策の終了後は直接効果がなくなります。</caption>
        <thead><tr>{['適用年', '全体', '子ども', '貧困線固定：全体', '貧困線固定：子ども', '反映する給付・軽減額'].map(label => <th scope="col" key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody><tr><th scope="row" className="p-2">追加施策なし</th><td>{percent(observed.all, 1)}</td><td>{percent(observed.child, 1)}</td><td>{percent(observed.all, 1)}</td><td>{percent(observed.child, 1)}</td><td>—</td></tr>
          {result.rows.map(row => <tr key={row.year} className="border-t border-mirai-border" data-poverty-year={row.year}>
            <th scope="row" className="p-2">年{row.year}</th>
            <td>{percent(row.all, 1)}<small className="block text-xs text-mirai-text-subtle">{difference(row.all - result.baseline.all)}</small></td>
            <td>{percent(row.child, 1)}<small className="block text-xs text-mirai-text-subtle">{difference(row.child - result.baseline.child)}</small></td>
            <td>{percent(row.anchoredAll, 1)}</td><td>{percent(row.anchoredChild, 1)}</td><td>{money(row.allocated)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="text-xs">通常の相対的貧困率は、政策後の所得中央値から貧困線も再計算します。「貧困線固定」は政策なしの基準を保った比較です。所得が増えても、中央値の上昇によって相対的貧困率が上がることがあります。</p>
    <p className="text-xs" data-testid="poverty-coverage">年1の政策総額 {money(first.activeBudget)}のうち、ここで反映した給付・本人負担の軽減は {money(first.allocated)}。消費税減税、事業主負担の軽減、現物サービス、投資や雇用を通じた効果は未推計です。未反映は効果がないという意味ではありません。</p>
    <details><summary className="cursor-pointer text-sm font-bold">所得分布・税負担の仮定と出典</summary>
      <div className="mt-2 space-y-2 text-xs leading-relaxed">
        <p><a href={POVERTY_DATA.sourceUrl} className="underline" target="_blank" rel="noreferrer">厚労省・2025年国民生活基礎調査</a>の2024年所得分布を使用。公表値は全体15.0%、子ども11.0%、貧困線138万円、中央値277万円です。計算では丸められた中央値の半分138.5万円を使い、政策なしの貧困率が公表値に一致するよう所得階級内の人数を調整しています。2024年基準・最新値基準のどちらでも同じ分布を使います。</p>
        <p>所得階級内は一様分布、最上位階級の上端は仮定です。中心ケースは子どものいる世帯を大人2人・子2人、子どものいない世帯を2人と近似し、後者の40%を年金所得型とします。比較幅は子1人・単身、片働き、年金所得型の割合30〜50%、最上位の上端1,500万〜3,000万円を組み合わせた3ケースです。ひとり親など個別の家族構成や、貧困線近辺の実際の税負担を復元したものではありません。</p>
        <p>既存の2025年度税計算から税額の分布を近似し、税目別の全国収入総額に合わせて補正しています。実際の世帯の税額ではなく、税額比例減税の配分を置くための仮定です。生活保護・給付の所得制限、保険料軽減に伴う所得税の増加、受給漏れ、就業行動は未反映。既存の給付は政策なしの可処分所得に含まれ、追加予算だけを上乗せします。</p>
        <p>入力額を2024年の価格・所得水準へそのまま適用しています。物価・賃金・出生の将来経路との接続は未実装です。給付先を変えた際の消費性向やGDP効果も共通のままです。</p>
      </div>
    </details>
  </CardContent></Card>;
}
