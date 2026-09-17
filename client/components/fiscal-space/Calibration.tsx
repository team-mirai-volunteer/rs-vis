import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ModelParameters } from '@/types/fiscal-space';
import { REFERENCES, type ReferenceModel } from '@/app/lib/fiscal-space/calibration';
import { RangeField } from './Controls';
import { fieldClass } from './format';

type Sensitivity = ModelParameters;
function ConnectionConditions({ value, onChange }: { value: ModelParameters; onChange: (v: ModelParameters) => void }) {
  const change = <K extends keyof ModelParameters>(key: K, n: ModelParameters[K]) => onChange({ ...value, [key]: n });
  return <details><summary className="cursor-pointer font-bold">GDPギャップ・金利・消費税の接続条件</summary>
    <p className="my-3 text-xs">ギャップゼロ・稼働率価格補正0で公表反応に一致。GDP反応は exp(−需要感度×初期ギャップ)、税直接効果を除く物価水準反応は exp(物価感度×初期ギャップ) 倍（指数の範囲は−1〜1）。基準インフレには政策なしのギャップ×傾きを加えます。未推定の感度仮定で、公表モデルの再推計ではありません。0で元の線形反応を比較できます。</p>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <RangeField label="名目GDPに対する税収弾性値（税）" value={value.taxRevenueElasticity} min={0} max={2} step={.1} unit="" onChange={n => change('taxRevenueElasticity', n)} />
        <RangeField label="名目GDPに対する社会負担の弾性値" value={value.socialContributionElasticity} min={0} max={2} step={.1} unit="" onChange={n => change('socialContributionElasticity', n)} />
        <p className="text-xs">名目GDPが1%増えたとき、税（罰金を含む）が約{value.taxRevenueElasticity.toFixed(1)}%、社会保険料が約{value.socialContributionElasticity.toFixed(1)}%増える想定です（減税分を引く前）。所得税・住民税・消費税の減税は税から、社会保険料減税は社会負担から差し引きます。入力した値を評価期間全体に適用します。</p>
        <p className="text-xs">初期値は比較用の1.3。政府の後年度試算は従来1.1、<a className="underline" href="https://www.mof.go.jp/policy/budget/topics/outlook/sy2026a.htm" target="_blank" rel="noreferrer">現在は1.2</a>です。<a className="underline" href="https://www.shugiin.go.jp/Internet/itdb_kaigiroku.nsf/html/kaigiroku/009522120260410006.htm" target="_blank" rel="noreferrer">財務省答弁の実績ベースの値は1.7（2015〜2024年度）</a>。期間によって変わり、将来も1.7になるという推定ではありません。</p>
      </div>
      <RangeField label="税収への反映ラグ" value={value.taxCollectionLag} min={0} max={3} step={1} unit="年" onChange={n => change('taxCollectionLag', n)} />
      <RangeField label="ギャップに対する需要感度" value={value.gapDemandSensitivity} min={0} max={10} step={.5} unit="" onChange={n => change('gapDemandSensitivity', n)} />
      <RangeField label="ギャップに対する物価感度" value={value.gapPriceSensitivity} min={0} max={10} step={.5} unit="" onChange={n => change('gapPriceSensitivity', n)} />
      <RangeField label="基準インフレのギャップ係数" value={value.gapInflationSlope} min={0} max={.2} step={.01} unit="" onChange={n => change('gapInflationSlope', n)} />
      <p className="text-xs md:col-span-2">需要感度・物価感度を0にすると、初期GDPギャップの符号に関係なく公表反応を線形適用します（需要不足と需要超過で同じGDP・物価反応）。基準インフレのギャップ係数は政策なし経路のみに効き、政策が作るギャップには重ねません。</p>
      <RangeField label="基準借換金利" value={value.marketRate * 100} min={0} max={6} step={.1} unit="%" onChange={n => change('marketRate', n / 100)} />
      <RangeField label="構造的失業率（労働需給の基準）" value={value.structuralUnemployment * 100} min={1} max={5} step={.1} unit="%" onChange={n => change('structuralUnemployment', n / 100)} />
      <label className="block space-y-1 text-sm"><span>物価判定の集約方式</span><select aria-label="物価判定の集約方式" className={fieldClass} value={value.inflationRule} onChange={e => change('inflationRule', e.target.value as ModelParameters['inflationRule'])}>
        <option value="peak">単年ピーク（既定）</option><option value="average">評価期間の平均</option>
      </select></label>
      <p className="text-xs md:col-span-2">構造的失業率は日本のNAIRU推定幅（約2.3〜2.7%）を参考にした仮定で、推定値ではありません。労働需給の制約は「構造的失業率÷失業率」で判定し、許容する失業率下限は上限設定で決まります。物価判定を「平均」にすると、単年のピークではなく評価期間の平均CPIを上限と比較します。</p>
      <RangeField label="消費税1ポイントの減収額" value={value.consumptionTax.revenuePerPoint / 1e12} min={1} max={5} step={.1} unit="兆円" onChange={n => change('consumptionTax', { ...value.consumptionTax, revenuePerPoint: n * 1e12 })} />
      <RangeField label="消費税対象品目のCPI比率" value={value.consumptionTax.cpiShare * 100} min={0} max={100} step={1} unit="%" onChange={n => change('consumptionTax', { ...value.consumptionTax, cpiShare: n / 100 })} />
      <RangeField label="対象品目の基準消費税率" value={value.consumptionTax.baseRate * 100} min={8} max={10} step={2} unit="%" onChange={n => change('consumptionTax', { ...value.consumptionTax, baseRate: n / 100 })} />
      <RangeField label="消費税の価格転嫁率" value={value.consumptionTax.passThrough * 100} min={0} max={100} step={10} unit="%" onChange={n => change('consumptionTax', { ...value.consumptionTax, passThrough: n / 100 })} />
      <RangeField label="表⑤から分離する直接CPI効果" value={value.consumptionTax.referenceDirectCpi} min={0} max={1} step={.01} unit="%/税率pt" onChange={n => change('consumptionTax', { ...value.consumptionTax, referenceDirectCpi: n })} />
    </div>
    <p className="mt-3 text-xs">上記の政府の税収弾性値は国の一般会計税収の値で、このモデルの「税」は一般政府の税（地方税・罰金を含む）です。社会負担（社会保険料）は別の弾性値で伸ばし、初期値は1994〜2024年度の実績に対する事後推定を丸めたもの（リポジトリの docs/fiscal-space-macro-backtest.md に記録）。税目別（所得・法人・消費）の課税ベース、短期と中期の違いは未反映です。</p>
    <p className="mt-3 text-xs">長期金利は表①〜⑤の同じ年額・期間の反応を借換・新発債へ渡します。基準借換金利と外生ショックは財政計算の感度で、GDPへの追加反応は未推計。2022年モデルの金利反応は未接続です。</p>
    <p className="mt-2 text-xs">消費税は対象品目を一つの税率で近似。標準税率品目・軽減税率品目を想定するときは対象CPI比率・減収額・税率を併せて変更してください。1ポイント3.5兆円・対象85%・税率10%は換算仮定です。表⑤の直接CPI効果0.78%、デフレーター0.50%を分離する仮定を置き、転嫁率を掛けた直接価格効果に置換します。終了時は直接値下がりが消え、復税による反動が出ます。税率ゼロを超える減税は入力・探索対象外です。</p>
    <p className="mt-2 text-xs">価格転嫁率100%は減税分がすべて値下げになる比較基準です。<a className="underline" href="https://www.boj.or.jp/mopo/outlook/gor1807a.htm" target="_blank" rel="noreferrer">日銀も増税の機械的な試算では完全転嫁を仮定</a>していますが、減税の実績値ではありません。<a className="underline" href="https://www.ifo.de/cesifo/publikationen/2021/working-paper/pass-through-temporary-vat-rate-cuts-evidence-german-supermarket" target="_blank" rel="noreferrer">ドイツの2020年の一時減税を調べた研究ではスーパーの転嫁率は約70%</a>でした。日本全体への適用は未検証です。50%・70%・100%などで比較してください。</p>
    <p className="mt-2 text-xs">この設定が変えるのはCPI・GDPデフレーターの直接価格効果と、それに伴う名目GDP・税収などです。実質GDP・輸出入・雇用の公表反応は再推計しません。転嫁されない減税分が企業利益や消費に及ぼす効果、減税と復税で転嫁率が異なる可能性は未反映です。0〜100%は比較範囲であり、100%を超える転嫁を経済的に否定するものではありません。</p>
  </details>;
}
export function Calibration({ value, onChange, embedded = false }: { value: Sensitivity; onChange: (value: Sensitivity) => void; embedded?: boolean }) {
  const change = <K extends keyof Sensitivity>(key: K, n: Sensitivity[K]) => onChange({ ...value, [key]: n });
  const ref = REFERENCES[value.referenceModel];
  return <Card><CardHeader>{!embedded && <h2 className="text-lg font-bold">乗数・労働反応の条件</h2>}
    <p className="text-sm leading-relaxed">公表モデルの年次反応を比較条件に使います。観測された因果効果や「正解の係数」を意味しません。</p>
  </CardHeader><CardContent className="space-y-4 text-sm">
    <p className="text-xs leading-relaxed">公表モデル以外の係数は、効果の大きさを比べるための仮定です。消費税の対象CPI比率85%・価格転嫁率100%、既存歳出のCPI連動率100%などは、日本全体の実績から推定した初期値ではありません。各項目の説明とともに変更してください。</p>
    <label className="block space-y-2"><span>参照するマクロモデル</span><select className={fieldClass} value={value.referenceModel} onChange={e => change('referenceModel', e.target.value as ReferenceModel)}>
      {Object.entries(REFERENCES).map(([id, r]) => <option key={id} value={id}>{r.name}</option>)}
    </select></label>
    <p className="text-xs leading-relaxed">{ref.note} <a className="text-primary-accent underline" href={ref.url} target="_blank" rel="noreferrer">原資料</a>。主表と制約評価は公表期間（{ref.years}年）内に限定します。経済財政モデルの1年限りの政府支出は公表表①を使用。2〜4年の支出は専用の公表実験がないため、継続実験の開始・終了を重ねる線形近似です。1年実験との一致は保証されず、終了後にGDPが基準を下回る場合があります。期間別の実証値ではありません。</p>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="参照モデルの初年度乗数"><table className="w-full min-w-[420px] text-right text-xs"><caption className="mb-2 text-left">初年度の実質GDP増加額 / 財政措置額（感度倍率を掛ける前）</caption><thead><tr><th scope="col" className="p-2 text-left">参照条件</th><th scope="col" className="p-2">政府支出</th><th scope="col" className="p-2">所得税減税</th><th scope="col" className="p-2">法人税減税</th></tr></thead><tbody>{Object.entries(REFERENCES).map(([id, r]) => <tr key={id} className="border-t border-mirai-border"><th scope="row" className="p-2 text-left font-medium">{r.name}</th>{[r.government.gdp[0], r.household.gdp[0], r.corporate.gdp[0]].map((n, i) => <td key={i} className="p-2 tabular-nums">{n.toFixed(2)}</td>)}</tr>)}</tbody></table></div>
    <p className="text-xs leading-relaxed">社会保険料は本人・事業主の双方を軽減（初期配分は折半）。本人分は所得税、事業主分は法人税減税の反応を代用します。現金給付も所得税の代理です。消費税は2026年モデルの表⑤を符号反転し、税率ポイントと年額を換算します。2022年モデルでは需要を所得税で代用し、直接価格効果を別途加えます。その他の支出は共通の政府支出反応が基準です。</p>
    <p className="text-xs leading-relaxed">住民税減税は個人の所得に比例する負担軽減として、所得税減税の需要・就労反応を代用します。住民税固有の乗数ではなく、均等割・徴収時期・自治体別の歳入補填や歳出削減は未反映です。</p>
    <ConnectionConditions value={value} onChange={onChange} />
    <details open><summary className="cursor-pointer font-bold">輸入価格・国内価格・歳出の連動（感度仮定）</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <RangeField label="輸入エネルギー費のCPI転嫁係数" value={value.energyPricePassThrough} min={0} max={1} step={.05} unit="" onChange={n => change('energyPricePassThrough', n)} />
        <RangeField label="輸入価格上昇分の国内価格への転嫁率" value={value.energyDomesticPricePassThrough * 100} min={0} max={100} step={10} unit="%" onChange={n => change('energyDomesticPricePassThrough', n / 100)} />
        <RangeField label="既存歳出のCPI連動率" value={value.expenditurePriceIndexation * 100} min={0} max={100} step={10} unit="%" onChange={n => change('expenditurePriceIndexation', n / 100)} />
      </div>
      <p className="mt-3 text-xs">輸入費増分/GDPからCPIへの波及と、国内価格転嫁で回収できない輸入価格上昇分による名目付加価値の減少を分離します。既定の国内転嫁率50%・歳出連動率100%は実証値ではありません。連動率100%では既存歳出を当年の累積CPIで実質維持し、0%では基準の名目歳出経路を維持します。追加政策の名目年額は固定です。給付・調達・賃金別の連動制度や反映ラグは未推計です。</p>
      <p className="mt-2 text-xs">交易条件による所得変化は輸入価格上昇による支払増を国内価格で実質化した近似です。公表SNAの交易利得・実質GDIの再現ではなく、所得減から消費・実質GDPへの二次波及は未推計です。<a className="underline" href="https://www5.cao.go.jp/keizai3/2012/1222nk/n12_2_2.html" target="_blank" rel="noreferrer">内閣府：GDPデフレーターと交易条件</a></p>
    </details>
    <details><summary className="cursor-pointer font-bold">この乗数はどこまで信用できる？</summary><p className="mt-2 text-xs leading-relaxed">2つの公表モデルが近い値でも、実際の政策効果の独立した検証にはなりません。日本の政府支出を分析した<a className="text-primary-accent underline" href="https://www.aeaweb.org/articles?id=10.1257/mac.20170131" target="_blank" rel="noreferrer">宮本・Nguyen・Sergeyev（2018）</a>は、金利の下限制約下で当期乗数1.5、それ以外で0.6と推定しています。これは四半期の当期反応で、上表の年間値とは期間が異なります。景気・金融政策、恒久か一時か、対象者、推定方法によって結果が変わるため、数値だけを混ぜて平均したり信頼区間にしたりしていません。</p></details>
    <details><summary className="cursor-pointer font-bold">乗数と本人・事業主の反応を変える</summary><div className="mt-4 grid gap-4 md:grid-cols-2">
      <RangeField label="GDP乗数の感度倍率" value={value.multiplierScale} min={0} max={3} step={.1} unit="倍" onChange={n => change('multiplierScale', n)} />
      <p className="text-xs">感度倍率は実質GDPの公表反応に掛けます。物価・輸出入・雇用の公表反応を同時に再推計する設定ではありません。初期値1倍でも、GDPギャップや供給制約によって実現する効果は変わります。</p>
      <RangeField label="社会保険料軽減の本人配分" value={value.employeeReliefShare * 100} min={0} max={100} step={10} unit="%" onChange={n => change('employeeReliefShare', n / 100)} />
      <RangeField label="手取り賃金に対する労働時間の弾力性" value={value.hoursElasticity} min={0} max={1} step={.1} unit="" onChange={n => change('hoursElasticity', n)} />
      <RangeField label="手取り賃金に対する労働参加の弾力性" value={value.participationElasticity} min={0} max={1} step={.1} unit="" onChange={n => change('participationElasticity', n)} />
      <RangeField label="雇用コスト低下に対する労働需要の弾力性" value={value.employerDemandElasticity} min={0} max={1} step={.1} unit="" onChange={n => change('employerDemandElasticity', n)} />
      <RangeField label="本人の手取り労働所得 / GDP（換算仮定）" value={value.netLabourIncomeShare * 100} min={20} max={70} step={5} unit="%" onChange={n => change('netLabourIncomeShare', n / 100)} />
      <RangeField label="事業主の総雇用コスト / GDP（換算仮定）" value={value.employerLabourCostShare * 100} min={30} max={90} step={5} unit="%" onChange={n => change('employerLabourCostShare', n / 100)} />
    </div><p className="mt-3 text-xs leading-relaxed">追加の労働時間・参加・事業主需要は初期値0＝未算入です。必要に応じて感度を指定できます。<a className="underline" href="https://www.nber.org/papers/w16729" target="_blank" rel="noreferrer">Chettyほかの研究整理</a>の補償弾力性（時間0.3・参加0.25）を参考に感度を設定できますが、所得効果を含む日本の減税効果として推定した値ではありません。0でも比較できます。本人分は時間・参加と潜在供給、事業主分は必要な雇用量へ反映。供給が増えただけでは短期GDPに加算しません。1年限りの減税の直接効果は終了後に残さず、恒久減税なら軽減中は継続します。</p>
      <p className="mt-2 text-xs leading-relaxed">日本の税制改正を用いた<a className="text-primary-accent underline" href="https://doi.org/10.1016/j.labeco.2010.11.011" target="_blank" rel="noreferrer">山田（2011）</a>の0.8は既婚女性の労働時間の推定値で、日本全体や労働参加率には流用しません。<a className="text-primary-accent underline" href="https://www.rieti.go.jp/jp/publications/dp/17e093.pdf" target="_blank" rel="noreferrer">児玉・横山の社会保険料改革の研究</a>は雇用人数と一人当たり時間の異なる反応を報告しています。全国一律の料率軽減への外挿には別の検証が必要です。</p>
    </details>
  </CardContent></Card>;
}
