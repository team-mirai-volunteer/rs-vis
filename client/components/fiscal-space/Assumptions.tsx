import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { EconomyState, ModelParameters, Policy, ProjectionStep, SourceValue } from '@/types/fiscal-space';
import { money, percent } from './format';
import { MONEY_STOCK_CHECKED, MONEY_STOCK_DEFINITIONS, MONEY_STOCK_DEFINITION_URL } from '@/app/lib/fiscal-space/money-stock';
import { STRESSES } from '@/app/lib/fiscal-space/stress-envelope';
import { inputLabel } from './labels';
import { initialEconomy } from '@/app/lib/fiscal-space/assumptions';
import { CONTEXT_CHECKED, japanContext, OECD_DEBT_RECORDS, OECD_DEBT_SOURCE, FERTILIZER_SOURCE } from '@/app/lib/fiscal-space/japan-context';
import { JAPAN_DATA_CHECKED, JAPAN_DATASET_LABELS, japanSources, SOURCE_STATUS_LABELS, type JapanDataset } from '@/app/lib/fiscal-space/japan-data';
import { Button } from '@/components/ui/button';

export function JapanBaseline({ dataset, onOpenSettings }: { dataset: JapanDataset; onOpenSettings: () => void }) {
  const s = initialEconomy(dataset), sources = japanSources(dataset), latest = dataset === 'latest';
  const context = japanContext(dataset);
  const fiscalGdp = s.macro.nominalGdp;
  const externalBalances = [
    ['経常収支（SNA・経常対外収支）', 'currentAccount', '財・サービス収支と、海外との所得・経常移転の収支の合計。'],
    ['貿易収支（SNA・財のみ）', 'goodsBalance', 'モノの輸出額から輸入額を差し引いた収支。'],
    ['サービス収支（SNA）', 'servicesBalance', 'サービスの輸出額から輸入額を差し引いた収支。'],
    ['財・サービス収支（SNA）', 'tradeBalance', '貿易収支（財のみ）＋サービス収支。'],
    ['第一次所得収支（SNA）', 'primaryIncomeBalance', '海外との利子・配当などの財産所得や雇用者報酬の受取と支払の差。'],
    ['経常移転収支（SNA）', 'secondaryIncomeBalance', '海外とのその他経常移転の受取と支払の差。'],
  ] as const;
  const rows = [
    ['名目GDP', money(s.macro.nominalGdp, 1), 'macro.nominalGdp'],
    ['総債務（一般政府）', money(s.fiscal.grossDebt, 1), 'fiscal.grossDebt'],
    ['純債務（一般政府）', money(s.fiscal.netDebt, 1), 'fiscal.netDebt'],
    ['基礎的財政収支（一般政府）', money(s.fiscal.primaryBalance, 1), 'fiscal.primaryBalance'],
    ['利払い（一般政府）', money(s.fiscal.interestPayments, 1), 'fiscal.interestPayments'],
    ['GDPギャップ（プラス＝需要超過）', percent(s.macro.realGdp / s.macro.potentialGdp - 1), 'macro.potentialGdp'],
    ['CPI総合', percent(s.macro.inflation), 'macro.inflation'],
    ['CPI・生鮮食品を除く総合', percent(s.macro.coreInflation), 'macro.coreInflation'],
    ['コアコアCPI', percent(context['context.coreCoreCpi'].value), 'context.coreCoreCpi'],
    ['食品CPI（統計の「食料」）', percent(context['context.foodCpi'].value), 'context.foodCpi'],
    ['エネルギーCPI', percent(context['context.energyCpi'].value), 'context.energyCpi'],
    ['就業者数', `${(s.labour.employment / 1e4).toLocaleString('ja-JP')}万人`, 'labour.employment'],
    ['合計特殊出生率（人口動態統計）', context['context.totalFertilityRate'].value.toFixed(2), 'context.totalFertilityRate'],
    ['財・サービス輸入', money(s.external.imports, 1), 'external.imports'],
    ['財・サービス輸出', money(s.external.exports, 1), 'external.exports'],
    ...externalBalances.map(([label, key]) => [label, `${s.external[key] > 0 ? '+' : ''}${money(s.external[key], 1)}`, `external.${key}`]),
    ['エネルギー自給率', percent(s.energy.domesticSupply / s.energy.primaryDemand), 'energy.domesticSupply'],
    ['食料自給率（カロリーベース）', percent(context['context.calorieSelfSufficiency'].value, 0), 'context.calorieSelfSufficiency'],
    ['食料自給率（生産額・金額ベース）', percent(context['context.valueSelfSufficiency'].value, 0), 'context.valueSelfSufficiency'],
    ['肥料自給率の参考：尿素の国産割合', percent(context['context.ureaDomesticShare'].value, 0), 'context.ureaDomesticShare'],
    ['対外純資産', money(s.external.niip, 1), 'external.niip'],
    ...Object.keys(MONEY_STOCK_DEFINITIONS).map(key => [`M${key.slice(-1)}（マネーストック）`, money(context[key].value, 1), key]),
  ];
  const groups = [
    { id: 'cpi', title: '消費者物価（CPI）', items: [
      ['macro.inflation', '総合', '全国の総合指数。'],
      ['macro.coreInflation', 'コア', '生鮮食品を除く総合。'],
      ['context.coreCoreCpi', 'コアコア', '生鮮食品・エネルギーを除く総合。加工食品は含みます。'],
    ] },
    { id: 'food-energy-cpi', title: '食品・エネルギーCPI', items: [
      ['context.foodCpi', '食品', '統計の「食料」。生鮮食品・酒類・外食を含む全国平均。'],
      ['context.energyCpi', 'エネルギー', '電気・ガス・灯油・ガソリン。補助金・税制の影響を含む家計向け価格。'],
    ] },
    { id: 'food-self-sufficiency', title: '食料自給率・肥料原料の国産割合', items: [
      ['context.calorieSelfSufficiency', '食料（カロリー）', '供給熱量ベース。摂取熱量ベースとは異なります。'],
      ['context.valueSelfSufficiency', '食料（金額）', '国内価格の上昇でも高まるため、供給量の増加とは限りません。'],
      ['context.ureaDomesticShare', '肥料原料（尿素）', '工業用を除く尿素の国産割合。肥料全体の自給率ではありません。'],
    ] },
    { id: 'exports-imports', title: '輸出入（財・サービス）', items: [
      ['external.imports', '輸入', '財・サービスの輸入額。'],
      ['external.exports', '輸出', '財・サービスの輸出額。'],
    ] },
    { id: 'external-balances', title: '経常収支と内訳（SNA）', items: externalBalances.map(([label, key, note]) =>
      [`external.${key}`, label.replace(/（SNA.*）/, ''), note]) },
    { id: 'money-stock', title: 'マネーストック', items: Object.entries(MONEY_STOCK_DEFINITIONS).map(([key, note]) =>
      [key, `M${key.slice(-1)}`, note]) },
  ];
  return <Card><CardHeader><h2 className="text-lg font-bold">日本の基準データ</h2>
    <p className="text-xs text-mirai-text-subtle">最大GDPギャップは投入条件・生産関数の仮定に基づく推計値のため、この一覧ではなく結果欄に表示しています。</p>
    <p className="text-sm">基準データ：{JAPAN_DATASET_LABELS[dataset]}</p>
    <Button variant="link" className="h-auto whitespace-normal text-left text-sm font-medium text-primary-accent" onClick={onOpenSettings}>基準データ・初期条件を設定</Button>
    <p className="text-sm leading-relaxed">{latest
      ? '2026年9月17日までに確認した公表値を採用。GDP・GDPギャップ・CPI・雇用・対外純資産を更新し、食料自給率は2025年度概算。一般政府の財政額はIMFの2026年推計比率を最新の名目GDPに掛けた橋渡し推計で、2024年実績と最新GDPを一つの比率に混ぜていません。国民経済計算の対外収支は2024年の一式を継続採用しています。'
      : 'GDP・財政・CPI・雇用・対外収支は2024暦年、エネルギー・食料自給率は2024年度で揃えます。GDPギャップはIMFの2024年推計です。'}</p>
    <p className="text-xs leading-relaxed">以下は操作前の基準値です。切り替えると経済状態の操作を初期化し、政策・ショック・閾値は引き継ぎます。年0は選択した初期状態、年1以降は試算の経過年です。</p>
    <p className="text-xs text-mirai-text-subtle">GDPは国内総生産、CPIは消費者物価指数、IMFは国際通貨基金を指します。</p>
    <p className="text-xs leading-relaxed">コアコア・食品・エネルギーCPI、食料自給率・肥料原料の国産割合は参考観測値です。各指標の政策実施後の経路は未推計。追加統計・OECD比較の確認：{CONTEXT_CHECKED}。OECD比較は2024年の公表集計を使用します。</p>
  </CardHeader><CardContent><dl data-testid="japan-data-tiles" className="columns-[16rem] gap-3 [&>div]:mb-3 [&>div]:break-inside-avoid-column [&>div]:rounded-xl [&>div]:border-mirai-border sm:[&>div]:border sm:[&>div]:p-3">{rows.map(([label, value, key]) => {
    const group = groups.find(g => g.items.some(([itemKey]) => itemKey === key));
    if (group) {
      if (group.items[0][0] !== key) return null;
      return <div key={group.id} data-observation-group={group.id}>
        <dt className="text-xs">{group.title}</dt>
        <dd className="mt-1"><dl className="flex flex-wrap gap-x-5 gap-y-2">{group.items.map(([itemKey, shortLabel]) =>
          <div key={itemKey} data-observation-key={itemKey}>
            <dt className="text-xs text-mirai-text-subtle">{shortLabel}</dt>
            <dd className="text-lg font-bold tabular-nums">{rows.find(row => row[2] === itemKey)![1]}</dd>
            {group.id === 'money-stock' && <dd className="text-xs tabular-nums">前年同月比 {context[`${itemKey}Yoy`].value > 0 ? '+' : ''}{percent(context[`${itemKey}Yoy`].value, 1)}</dd>}
            {group.id === 'food-self-sufficiency' && <dd className="mt-1 text-xs text-mirai-text-subtle">{itemKey === 'context.ureaDomesticShare' ? '2024肥料年度' : context[itemKey].referenceYear}</dd>}
          </div>)}
        </dl></dd>
        {group.id !== 'food-self-sufficiency' && <dd className="mt-1 text-xs text-mirai-text-subtle">{
          group.id === 'money-stock' ? `${context[key].referenceYear}・季節調整前`
          : group.id === 'exports-imports' || group.id === 'external-balances' ? '2024暦年・国民経済計算（SNA）'
          : `${context['context.foodCpi'].referenceYear}・全国・${latest ? '前年同月比' : '年平均の前年比'}`}</dd>}
        {group.id === 'external-balances' && <dd className="mt-1 text-xs">プラスは黒字、マイナスは赤字。経常収支＝財・サービス収支＋第一次所得収支＋経常移転収支。</dd>}
        {group.id === 'food-self-sufficiency' && <dd className="mt-1 text-xs">肥料原料の参考：りん安・塩化加里の国産割合はほぼ0%。</dd>}
        {group.id === 'food-energy-cpi' && <dd className="mt-1 text-xs" data-testid="energy-cpi-adjusted">{latest
          ? <>エネルギーの政策効果調整後（参考）：<strong>約{percent(context['context.energyPolicyAdjustedCpi'].value, 1)}</strong></>
          : 'エネルギーの政策効果調整後：年平均は未推計'}</dd>}
        <dd className="mt-2"><details className="text-xs leading-relaxed"><summary className="cursor-pointer text-primary-accent">定義・出典</summary>
          <div className="mt-2 space-y-2">{group.items.map(([itemKey, shortLabel, note]) => {
            const itemSource = context[itemKey] ?? sources[`initial.${itemKey}`];
            return <p key={itemKey}><strong>{shortLabel}</strong>：{note}<br />
              {itemSource.referenceYear}・{SOURCE_STATUS_LABELS[itemSource.status]}{itemSource.publishedAt && `・公表 ${itemSource.publishedAt}`} {' '}
              <a className="text-primary-accent underline" href={itemSource.sourceUrl!} target="_blank" rel="noreferrer" aria-label={`${group.title}・${shortLabel}の出典`}>出典</a>
            </p>;
          })}
          {group.id === 'food-self-sufficiency' && <><p>尿素の2024肥料年度は2024年7月〜2025年6月。主要3原料の参考値で、堆肥・硫安等を含む肥料全体や成分全体の自給率ではありません。国内製造でも原料・燃料を輸入する場合があります。<a href={FERTILIZER_SOURCE} className="underline" target="_blank" rel="noreferrer">肥料原料の出典</a></p><p>OECD平均：同一定義・対象年の食料・肥料原料の値は未取得。</p></>}
          {(group.id === 'exports-imports' || group.id === 'external-balances') && <p>国際収支統計・通関統計とは定義が異なります。最新値を優先する場合も2024年の一式を継続採用。表示には丸め差があります。</p>}
          {group.id === 'money-stock' && <p>市中の通貨量の参考値。M2はM1と対象金融機関が異なります。政策後の通貨量は未推計です。<a className="underline" href={MONEY_STOCK_DEFINITION_URL} target="_blank" rel="noreferrer">日銀の定義</a>。確認：{MONEY_STOCK_CHECKED}。</p>}
          {group.id === 'food-energy-cpi' && (latest ? <p>調整後の参考値は当月と前年の補助金・ガソリン暫定税率廃止の効果を合わせて除いた前年比です。補助金だけの影響は分離できていません。公表丸め値からの近似で、即時廃止による値上がり予測ではありません。<a className="underline" href={context['context.energyPolicyAdjustedCpi'].sourceUrl!} target="_blank" rel="noreferrer">計算に用いた公表資料（3頁）</a></p>
            : <p>調整後の年平均には2023年・2024年の同じ対象範囲の調整額が必要なため、単月の寄与度では代用しません。</p>)}
          </div>
        </details></dd>
      </div>;
    }
    const source = context[key] ?? sources[`initial.${key}`];
    const debt = key === 'fiscal.grossDebt' || key === 'fiscal.netDebt';
    const ratio = debt || key === 'fiscal.primaryBalance' || key === 'fiscal.interestPayments';
    return <div key={key} data-observation-key={key}><dt className="text-xs">{label}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{value}</dd>
      {debt && <dd className="mt-1 text-sm tabular-nums">GDP比 {percent((key === 'fiscal.grossDebt' ? s.fiscal.grossDebt : s.fiscal.netDebt) / fiscalGdp)}</dd>}
      {key === 'fiscal.primaryBalance' && <dd className="mt-1 text-sm tabular-nums">GDP比 {percent(s.fiscal.primaryBalance / fiscalGdp)}<p className="text-xs">利子の受払を除く収支。黒字がプラス、赤字がマイナス。</p></dd>}
      {key === 'fiscal.interestPayments' && <dd className="mt-1 text-sm tabular-nums">利払いGDP比 {percent(s.fiscal.interestPayments / fiscalGdp)}<p className="text-xs">受取利子を控除する前の支払利子。</p></dd>}
      {key === 'labour.employment' && <dd className="mt-1 text-sm tabular-nums">完全失業率 {percent(s.labour.unemployment / s.labour.labourForce, 1)}
        <p className="text-xs">完全失業者{(s.labour.unemployment / 1e4).toLocaleString('ja-JP')}万人 ÷ 労働力人口{(s.labour.labourForce / 1e4).toLocaleString('ja-JP')}万人。就業者数と同じ労働力調査から計算しています。</p></dd>}
      <dd className="mt-1 text-sm text-mirai-text-subtle"><span className="rounded bg-mirai-surface-warm px-1">{SOURCE_STATUS_LABELS[source.status]}</span> {source.referenceYear} <a className="text-primary-accent underline" href={source.sourceUrl!} target="_blank" rel="noreferrer" aria-label={`${label}の出典`}>出典</a></dd>
      {source.publishedAt && <dd className="mt-1 text-xs text-mirai-text-subtle">公表：{source.publishedAt}</dd>}
      {latest && ratio && <dd className="mt-1 text-xs">分子はIMFの2026年推計比率×最新GDPの橋渡し推計。GDP比の分母にも同じ最新GDPを使います。</dd>}
      {latest && key === 'macro.nominalGdp' && <dd className="mt-1 text-xs">2次速報・季節調整済み年率</dd>}
      {key === 'fiscal.grossDebt' && <dd className="mt-2 text-xs leading-relaxed">OECD平均：<strong>{percent(OECD_DEBT_RECORDS[0].value, 1)}</strong>（2024年・公表集計）。同じOECD定義の日本：{percent(OECD_DEBT_RECORDS[1].value, 1)}。時価等の定義差がある参考比較。<a href={OECD_DEBT_SOURCE} target="_blank" rel="noreferrer" className="text-primary-accent underline">比較出典</a></dd>}
      {key === 'fiscal.netDebt' && <dd className="mt-2 text-xs">OECD平均：同じ資産控除範囲の値は未取得。総金融資産を控除する「純金融負債」とは区別します。</dd>}
      {key === 'energy.domesticSupply' && <dd className="mt-2 text-xs">OECD平均：同一定義・対象年の加盟国全体の値は未取得。</dd>}
    </div>;
  })}</dl><p className="mt-3 text-xs leading-relaxed">総債務・純債務は地方・社会保障基金を含む一般政府の{latest ? '2026年推計値（IMF比率×最新GDP）' : '2024年値'}です。純債務は総債務から定義上の控除対象となる金融資産を差し引いた額です。</p>{latest && <details className="mt-4 text-xs leading-relaxed"><summary className="cursor-pointer font-bold">橋渡し推計と2024年を継続採用する項目</summary><ul className="mt-2 list-disc space-y-1 pl-5">
    <li>財政：歳入・歳出・利子・債務・資産は、IMF 2026年対日4条協議 表4の2026年推計欄（GDP比）に最新の名目GDPを掛けた推計値です。現金・預金の推計はないため2024年のGDP比を据え置き、構造的PBはPBからGDPギャップ分を差し引いた近似です。</li>
    <li>国民経済計算の対外収支：輸出入・第一次所得・経常移転の会計関係を揃えるため2024年の勘定体系を維持。対外純資産は独立して更新します。</li>
    <li>エネルギー：需給実績の最新確報は2024年度。エネルギー輸入費は2024年の概算を維持しています。</li>
  </ul></details>}<p className="mt-4 text-xs leading-relaxed">政策乗数、将来の成長率・物価・金利、産業別の供給能力、債務の満期構成、許容閾値は仮定です。表示する財政余力は、これらの設定に依存する試算です。出典確認：{JAPAN_DATA_CHECKED}。データは確認時点の固定値で、自動更新ではありません。</p></CardContent></Card>;
}

export function Explanations({ initial, step, parameters, policies, records }: { initial: EconomyState; step: ProjectionStep; parameters: ModelParameters; policies: Policy[]; records: SourceValue[] }) {
  const s = step.state;
  return <Card id="model-notes"><CardHeader><h2 className="text-lg font-bold">計算根拠・データ・レジリエンス</h2><p className="text-sm leading-relaxed">選択した日本の公表データを初期状態に取り込み、換算値・推計・仮定を区別しています。政策の効果や将来経路は<strong>仮定に基づく試算</strong>です。表示額は現在の日本政府の支出可能額を確定するものではありません。</p></CardHeader><CardContent className="space-y-5 text-sm leading-relaxed">
    <p className="text-xs">財政は地方・社会保障基金を含む一般政府。総債務は連結・額面ベース、純債務の控除対象資産は株式等を除く範囲です。税・社会負担収入とその他の非利子収入を分け、基礎的財政収支から利子の受払を除外します。基準年の支払利子は{money(initial.fiscal.interestPayments)}、受取利子は{money(initial.fiscal.interestRevenue)}です。受取利子・その他収入の将来額は基準の名目成長率で延長する仮定です。</p>
    <details open><summary className="cursor-pointer font-bold">追加需要はどこへ向かう？（年{step.state.year}）</summary><div className="mt-3 space-y-3">
      <p>国内実質生産の変化 {money(step.demand.realOutput)}、実質輸入の変化 {money(step.demand.imports)}、供給上限を超えた価格圧力相当 {money(step.demand.prices)}。ここは基準年価格です。GDPへの反応と輸入への反応は別々に計算し、公表GDP乗数から輸入を再び差し引きません。</p>
      <p className="text-xs">年次の継続効果の差分を、その年までの支出に重ね合わせます。支出終了後の反動も残します。実質生産が仮定した供給上限に届く場合だけ縮小し、超過分の{percent(parameters.overflowImportShare, 0)}を輸入、残余を物価圧力へ配分します。これは上限付近の追加仮定です。公表の物価水準の変化率は前年との差からインフレ率に直し、GDPデフレーターと消費者物価を分けます。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="政策の実質GDP反応"><table className="w-full min-w-[420px] text-right text-xs tabular-nums"><caption className="text-left">政策の実質GDPへの反応</caption><thead><tr>{['政策', '初年度の参照乗数', '初期ギャップによる需要補正', '供給上限による調整', '当年の実効乗数'].map(h => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead><tbody>{step.demand.details.map((d, i) => <tr key={i}><th scope="row" className="p-2 text-left">{policies.find(p => p.id === d.policyId)?.name ?? d.policyId}</th>{[d.baseMultiplier, d.slackFactor, d.capacityFactor, d.effectiveMultiplier].map((v, j) => <td key={j} className="p-2">{v.toFixed(3)}</td>)}</tr>)}</tbody></table></div>
      <p className="text-xs">{parameters.gapDemandSensitivity === 0 && parameters.gapPriceSensitivity === 0
        ? 'ギャップ感度が0のため補正なし。初期GDPギャップが需要不足でも需要超過でも、公表反応をそのまま線形適用しています（旧来の挙動）。'
        : `需要補正は exp(−需要感度${parameters.gapDemandSensitivity}×初期ギャップ)、物価水準反応には exp(物価感度${parameters.gapPriceSensitivity}×初期ギャップ) を掛けています。未推定のシナリオ係数で、ギャップ0では公表反応に一致します。`}</p>
    </div></details>
    <details><summary className="cursor-pointer font-bold">実物輸入と金融的な対外収支を分けて見る</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[
      ['財・サービス収支（国民経済計算）', money(s.external.tradeBalance)], ['財の収支', money(s.external.goodsBalance)], ['サービス収支', money(s.external.servicesBalance)],
      ['第一次所得収支（国民経済計算）', money(s.external.primaryIncomeBalance)], ['経常対外収支（国民経済計算）', money(s.external.currentAccount)], ['対外純資産', money(s.external.niip)],
      ['エネルギー輸入費', money(s.energy.importBill)], ['エネルギー輸入費 / GDP', percent(s.energy.importBill / s.macro.nominalGdp)],
      ['必需輸入費（年0は仮定）', money(s.external.essentialImports)], ['一次エネルギー自給率', percent(s.energy.domesticSupply / s.energy.primaryDemand)],
      ['化石燃料輸入依存率（固定仮定）', percent(s.energy.fossilFuelImportDependency)], ['電力予備率（年0は仮定）', percent(s.energy.reserveMargin)],
      ['再エネ設備容量（固定仮定）', `${s.energy.renewableInstalledCapacity.toFixed(1)}GW`], ['再エネ確実供給寄与（固定仮定）', `${s.energy.renewableFirmContribution.toFixed(1)}GW`],
      ['流動性調整純債務 / GDP', percent(step.metrics.liquidityAdjustedNetDebtGdp)],
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-mirai-text-subtle">{label}</dt><dd className="font-bold tabular-nums">{value}</dd></div>)}</dl><p className="mt-3 text-xs">経常収支の所得黒字はエネルギー・食料の供給能力へ加算しません。電力需要・非化石発電量の共通経路から火力燃料輸入を計算し、全政策に計上します。発電・送電網の輸入代替は一度だけ差し引き、一般輸入の成長経路に含まれる火力燃料の伸びは置き換えます。電源別の事業条件・ミックスは入力可能ですが、一次エネルギーの物量指数への換算や時間帯別の確実供給は未校正です。</p></details>
    <details><summary className="cursor-pointer font-bold">国家レジリエンス（財政制約とは別枠）</summary><p className="mt-3">食料のカロリー・生産額ベース自給率は冒頭に公表値を掲載しています。輸入先の集中、蛋白自給率、飼料・肥料・農業エネルギー依存、重要鉱物、備蓄日数、供給途絶への耐性は未評価です。自給率から財政枠や有事の供給量を直接算出しません。</p></details>
    <details><summary className="cursor-pointer font-bold">数式・探索の限界とストレス控除</summary><div className="mt-3 space-y-2 text-xs">
      <p>コブ＝ダグラス型: A K^α L^β E^γ。代替弾力性一定型: A(Σw x^ρ)^(1/ρ)、ρ=1−1/σ、σ={parameters.cesSigma}。σ=1は幾何平均。レオンチェフ型: min(K/aK, L/aL, E/aE, M/aM)。投入は基準投入量を1とする指数で、共通の潜在GDPを掛けて円へ戻します。</p>
      <p>探索上限{money(parameters.searchCap)}、走査間隔{money(parameters.searchStep)}、境界区間の分解能{money(parameters.searchTolerance)}。成長投資では安全性が単調とは限らないため、ゼロから最初に観測した違反まで走査し、その区間を二分探索します。走査間隔より狭い違反領域を見逃す可能性があり、離れた許容領域の最大値は保証しません。</p>
      <p>条件付き参考額 = 設定した制約内での探索上限と、選んだストレス（{Object.values(STRESSES).map(stress => stress.label).join('、')}）ごとの再探索額の最小値。未選択ならストレスなしの探索額です。CPI許容上限は別の設定で、ストレスには含めません。控除率は入力せず結果として表示します。ストレスの大きさは仮定で、安全性を実証した条件ではありません。条件付き参考額も支出を推奨する額ではなく、設定に依存する参考上限です。公表モデルの反応には各モデルの金融政策・民間投資等の経路が含まれますが、この試算は原モデル全体の再推定・再現ではありません。GDPギャップは明示した需要・物価感度で補正し、公表金利反応は借換に接続します。追加感度を実証推定したものではありません。外生金利変更のGDP反応は未推計です。モデル間の差は統計的な信頼区間ではありません。</p>
      <p>減税は一般政府の税・社会負担収入を減らします。社会保険料の本人分・事業主分は配分を分けます。貧困率では現金給付・所得税・住民税・本人保険料の直接効果を所得階級別に近似しますが、賃金・物価への波及、年収の壁や既存給付の減額との相互作用は含めません。恒久費用は名目年額固定、既存歳出は基準経路に累積CPIの乖離を連動率に応じて反映します。公共資本・研究・教育・保育・送電網には供給シナリオを、半導体・発電には事業条件を適用します。医療・防衛等は未推計。産業別の基準利用率は保持し、追加政策の人員負荷等の概算を加えて制約を判定します。職種・地域・設備別の詳しい制約は未評価です。</p>
      <p>債務・資金調達需要の定義の参考：<a className="text-primary-accent underline" href="https://www.imf.org/en/publications/tnm/issues/2025/01/24/a-guide-and-tool-for-projecting-public-gross-financing-needs-555913" target="_blank" rel="noreferrer">国際通貨基金：政府の総資金調達需要の推計ガイド（2025年・英語資料）</a>（2026-09-14確認）。この文献は入力数値・政策係数の出典ではありません。</p>
    </div></details>
    <details><summary className="cursor-pointer font-bold">全入力値の出典・単位を見る（{records.length}項目）</summary><p className="my-3 text-xs">公表実績、実績からの換算、推計、仮定・設定を項目ごとに表示します。操作で基準値から変更した入力は「仮定・設定」になります。統計の改定・公表桁・対象期間は出典と注記を参照してください。政策係数の効果は費用1円あたり、資源増加係数は費用/GDPあたりの正規化指数です。</p>
      <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="入力値の出典一覧"><table className="w-full min-w-[750px] text-left text-xs"><caption className="sr-only">入力値・区分・単位・参照年・出典・不確実性</caption><thead><tr>{['入力', '値', '区分', '単位', '参照年・出典', '不確実性'].map(h => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead><tbody>{records.map(r => <tr key={r.key} data-source-key={r.key} className="border-t border-mirai-border"><th scope="row" className="p-2 font-medium">{inputLabel(r.key, policies)}</th><td className="p-2 tabular-nums">{r.value.toLocaleString('ja-JP', { maximumFractionDigits: 6 })}</td><td className="p-2 whitespace-nowrap">{SOURCE_STATUS_LABELS[r.status]}</td><td className="p-2">{r.unit}</td><td className="p-2">{r.referenceYear}{r.publishedAt && ` (${r.publishedAt})`} / {r.sourceUrl ? <a className="text-primary-accent underline" href={r.sourceUrl} target="_blank" rel="noreferrer">{r.sourceName}</a> : r.sourceName}</td><td className="p-2">{r.uncertaintyNote}{r.retainedReason && <p className="mt-1 font-medium">{r.retainedReason}</p>}</td></tr>)}</tbody></table></div>
    </details>
  </CardContent></Card>;
}

export function DatasetSettings({ dataset, onDataset }: { dataset: JapanDataset; onDataset: (value: JapanDataset) => void }) {
  return <div>
    <fieldset className="mt-2 flex flex-wrap gap-3"><legend className="sr-only">基準データ</legend>
      {(Object.entries(JAPAN_DATASET_LABELS) as [JapanDataset, string][]).map(([id, label]) => <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${dataset === id ? 'border-primary bg-primary/10' : 'border-mirai-border'}`}>
        <input type="radio" name="japan-dataset" value={id} checked={dataset === id} onChange={() => onDataset(id)} className="accent-primary" />{label}
      </label>)}
    </fieldset>
    <p className="mt-3 text-sm">切り替えるとGDPギャップ・物価・建設稼働率・電力供給力の初期値が切り替わります。政策・ショック・閾値は引き継ぎます。</p>
  </div>;
}
