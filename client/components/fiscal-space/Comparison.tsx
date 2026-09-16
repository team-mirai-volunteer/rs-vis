import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { PolicyComparison, PolicyComparisonPeriod } from '@/types/fiscal-space';
import { KIND_LABELS, money, percent, points } from './format';

const amount = (v: number) => Math.abs(v) < 5e9 && v !== 0 ? `${v > 0 ? '+' : '−'}0.01兆円未満` : `${v > 0 ? '+' : ''}${(v / 1e12).toFixed(2)}兆円`;
type Field = keyof Omit<PolicyComparisonPeriod, 'year' | 'industryImports'>;

function PeriodValues({ row, field }: { row: PolicyComparison; field: Field }) {
  const configured = field === 'potentialGdpEffect' ? row.supplyEffectConfigured
    : field === 'domesticSubstitution' ? !!row.investment?.trade : true;
  const format = field === 'inflationPressure' ? points : field === 'debtGdp' ? percent : amount;
  return <div className="space-y-1 tabular-nums" data-metric={field}>{row.periods.map(period =>
    <div key={period.year} className="flex items-baseline gap-x-1" data-year={period.year}>
      <span className="w-[2em] shrink-0 text-mirai-text-subtle">{period.year}年</span><span className="whitespace-nowrap">{!configured || period.year > row.publishedYears ? '未推計' : format(period[field])}</span>
    </div>)}</div>;
}

export function Comparison({ rows, horizon }: { rows: PolicyComparison[]; horizon: number }) {
  return <Card><CardHeader><h2 className="text-lg font-bold">次の1兆円を何に使うか</h2>
    <p className="text-sm leading-relaxed">現在の政策に<strong>1年限り・1兆円</strong>追加した差を、1・3・5年で比較します。金額は<strong>兆円／年</strong>で、累計ではありません。GDP・国内代替は初期年価格、輸出入・貿易収支は各年価格。率の差はポイント表記（CPIが2%→3%なら+1ポイント）です。</p>
    <p className="text-xs leading-relaxed">経済財政モデルは5年、短期日本経済モデルは3年までの公表反応を使用。公表期間外や未設定の供給・代替経路は「未推計」です。国内代替は輸入品・燃料を国産品・国内発電で置き換える額で、稼働前はゼロになります。</p>
    <p className="text-xs">追加1兆円が減収対象の収入を超える政策は比較から除いています。金額は0.01兆円単位に丸めています。表示桁は推定精度ではなく、係数や事業条件の不確実性はこれより大きい可能性があります。</p>
    <p className="text-xs leading-relaxed">貿易収支のマイナスは、この1兆円を追加しない場合より悪化する意味です。主表は政府支出一般の輸入増・輸出減も含むため、発電の燃料代替があってもマイナスになり得ます。政策固有の需要波及は未校正で、この符号だけでは発電投資の要否を判断できません。</p>
  </CardHeader><CardContent className="space-y-6">
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="次の1兆円の政策比較表">
      <table className="w-full min-w-[1430px] text-left text-xs"><caption className="sr-only">政策別の1・3・5年の効果。金額は兆円。</caption>
        <thead className="bg-card"><tr>{['政策', '実質GDP', '潜在GDP', 'CPI差（ポイント）', '輸出', '輸入', '国内代替', '貿易収支', '債務/GDP', '追加資源需要', '単独の参考上限（任意控除後）'].map((h, i) => <th scope="col" key={h} className={`px-2 py-3 ${i === 0 ? 'sticky left-0 z-20 bg-card' : ''}`}>{h}{[1, 2, 4, 5, 6, 7, 10].includes(i) && <span className="block font-normal text-mirai-text-subtle">（兆円／年）</span>}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.policy.id} data-policy={row.policy.id} className="border-b border-mirai-border last:border-0 hover:bg-mirai-surface-teal/60 [&>td]:align-top [&>th]:align-top">
          <th scope="row" className="sticky left-0 z-10 bg-card px-2 py-3 text-left"><span className="font-bold">{row.policy.name}</span>
            <details className="mt-2 font-normal"><summary className="cursor-pointer text-primary-accent">計算条件</summary>
              <div className="mt-2 space-y-3 break-words"><p>{row.supplyNote}</p>
                <p>政府支出の1年追加は経済財政モデルの1年限り実験。減税・複数年支出は継続実験から近似。政策固有の供給・事業効果には別途仮定を含みます。</p>
                <p>単独の参考上限（任意控除後）は、年1〜{horizon}の制約を調べた条件付き計算です。</p>
              </div>
            </details>
          </th>
          {(['realGdpEffect', 'potentialGdpEffect', 'inflationPressure', 'exports', 'imports', 'domesticSubstitution', 'tradeBalanceEffect', 'debtGdp'] as const).map(field =>
            <td key={field} className="px-2 py-3"><PeriodValues row={row} field={field} /></td>)}
          <td className="px-2 py-3">{row.mainCapacity}</td>
          <td className="px-2 py-3"><strong className="tabular-nums">{row.space.status === 'unevaluated' ? '算出不可' : money(row.space.recommendedEnvelope, 1)}</strong><span className="mt-1 block text-mirai-text-subtle">{KIND_LABELS[row.policy.kind]}・{row.policy.kind === 'permanent' ? '継続' : `${row.policy.duration}年支出`}</span><span className="mt-1 block">{row.space.status === 'unevaluated' ? '負荷が未評価' : row.space.status === 'search-cap' ? '境界未特定' : row.space.status === 'revenue-cap' ? '減収対象の収入上限' : row.space.status === 'baseline-violated' ? '基準経路が違反' : row.space.constraints[0]?.label}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
    {rows.filter(row => row.periods.some(period => period.industryImports)).map(row => <section key={row.policy.id} className="space-y-2" aria-labelledby="industry-import-heading">
      <h3 id="industry-import-heading" className="font-bold">産業投資の輸入内訳と国内代替の条件</h3>
      <p className="text-xs">追加1兆円を初年度だけ支出した場合の各年価格・兆円／年。輸入増＝稼働時輸入−国内代替＋その他。その他には一般政府支出モデルによる需要・価格等の反応が含まれ、設備の直接輸入額ではありません。既存投資との供給制約の相互作用も含む差分です。</p>
      <div className="overflow-x-auto" role="region" aria-label="産業投資の輸入内訳" tabIndex={0}><table className="w-full min-w-[800px] text-left text-xs tabular-nums"><thead><tr>{['時点', '稼働時輸入', '国内代替（控除）', 'その他の変化', '輸入増減の合計', '置換0%の場合', '置換100%の場合'].map(label => <th scope="col" className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{row.periods.map(period => { const b = period.industryImports; return b && <tr key={period.year} className="border-t border-mirai-border"><th scope="row" className="p-2">{period.year}年</th>{[b.operating, -b.substitution, b.other, period.imports, b.noReplacement, b.fullReplacement].map((v, i) => <td key={i} className="p-2">{amount(v)}</td>)}</tr>; })}</tbody></table></div>
      <p className="text-xs">置換率は国内販売のうち輸入品を置き換える割合。0%・100%は追加投資の置換率だけを変えて本体を再計算した条件比較で、統計的な信頼区間や全リスクの上下限ではありません。輸出比率・調達構成・売上・稼働時期にも不確実性があります。</p>
    </section>)}
    {rows.filter(row => row.policy.id === 'generation').map(row => <section key={row.policy.id} className="space-y-2" aria-labelledby="power-trade-breakdown-heading">
      <h3 id="power-trade-breakdown-heading" className="font-bold">発電投資の貿易収支：燃料削減とその他の変化</h3>
      <p className="text-xs">主表と同じ1年限り・追加1兆円、各年価格の兆円／年です。稼働効果は火力燃料の削減から運転時輸入を引いた額で、送電網との重複・利用制約を反映。「その他」は建設・所得増による輸入、輸出変化、価格変化等を含む残差で、建設設備の輸入額そのものではありません。</p>
      <div className="overflow-x-auto" role="region" aria-label="発電投資の貿易収支内訳" tabIndex={0}><table className="w-full min-w-[550px] text-left text-xs tabular-nums"><thead><tr>{['時点', '発電・送電網の稼働効果', 'その他の変化', '貿易収支の合計'].map(label => <th scope="col" className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{row.periods.map(period => <tr key={period.year} data-power-breakdown={period.year} className="border-t border-mirai-border"><th scope="row" className="p-2">{period.year}年</th>{[period.energyOperatingTradeEffect, period.tradeBalanceEffect - period.energyOperatingTradeEffect, period.tradeBalanceEffect].map((v, i) => <td key={i} className="p-2">{period.year > row.publishedYears || !row.investment?.trade ? '未推計' : amount(v)}</td>)}</tr>)}</tbody></table></div>
      <p className="text-xs">追加投資をしない比較経路にも、需要増・非化石電源の減少による火力燃料輸入を共通条件で計上しています。共通額はこの差分表では相殺され、増強で不要になる燃料は稼働効果として控除します。火力の新設費や時間帯別の供給不足は別途推計が必要です。</p>
    </section>)}
    <section className="space-y-3" aria-labelledby="investment-effects-heading">
      <h3 id="investment-effects-heading" className="font-bold">長期投資の稼働開始と年間効果</h3>
      <p className="text-xs leading-relaxed">同じ1兆円の追加投資が、設定した稼働条件に達した年の供給力・直接貿易への寄与です（初期年価格、兆円／年）。電源ミックスは最も遅い電源の稼働開始時点で比較し、先に稼働した設備の寿命も反映します。その年の景気予測ではありません。実際の需要・為替・所得増に伴う輸入等の波及は含まず、供給寄与がそのままGDPになるとは限りません。効果期間中も設備・知識は設定に応じて減耗します。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="長期投資の年間効果表"><table className="w-full min-w-[1050px] text-left text-xs tabular-nums"><thead><tr>{['政策', '稼働開始・効果期間', '供給寄与', '輸出', '差引輸入', '国内代替', '貿易収支'].map((h, i) => <th key={h} scope="col" className={`p-2 ${i === 0 ? 'sticky left-0 z-10 bg-card' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.filter(row => row.investment).map(row => { const investment = row.investment!; return <tr key={row.policy.id} data-investment={row.policy.id} className="border-t border-mirai-border [&>td]:align-top">
          <th scope="row" className="sticky left-0 z-10 bg-card p-2 text-left">{row.policy.name}</th>
          <td className="p-2"><span>{investment.startYear}年目{investment.timings ? 'の稼働条件' : 'から'}</span>{investment.timings ? investment.timings.map(t => <span key={t.name} className="mt-1 block text-mirai-text-subtle">{t.name}：{t.startYear}年目〜・{t.lifetime}年</span>) : <span className="mt-1 block text-mirai-text-subtle">効果期間 {investment.lifetime}年</span>}</td>
          {[investment.supply, investment.trade?.exports, investment.trade?.imports, investment.trade?.substitution, investment.trade?.tradeBalance].map((value, i) => <td key={i} className="whitespace-nowrap p-2">{value === undefined ? '未推計' : amount(value)}</td>)}
        </tr>; })}</tbody>
      </table></div>
      <p className="text-xs leading-relaxed">差引輸入＝稼働後の輸入原価−国内代替、貿易収支＝輸出−差引輸入。建設費の回収を示す指標ではありません。供給GDPだけから貿易内訳を推定できない政策は未推計。国富の評価には国内資本・対外所得・資産評価も必要です。</p>
    </section>
  </CardContent></Card>;
}
