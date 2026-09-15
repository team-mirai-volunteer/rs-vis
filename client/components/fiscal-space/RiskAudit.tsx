import type { FiscalRiskAudit } from '@/app/lib/fiscal-space/risk-audit';
import { money, percent, points } from './format';
import { FX_RISK_SOURCE, IMPORT_COST_SOURCE } from '@/app/lib/fiscal-space/external-stress';
import { FiscalExternal } from './FiscalExternal';

export function RiskAudit({ audit }: { audit: FiscalRiskAudit }) {
  return <div role="region" aria-label="留保後の枠の物価・為替リスク" className="space-y-3 border-t border-mirai-border pt-4 text-xs leading-relaxed">
    <h3 className="text-sm font-bold">この追加枠で、物価・為替は耐えられる？</h3>
    <p>下の診断は<strong>{money(audit.amount, 1)}を追加した場合</strong>のものです。入力中の年間総額とは別に計算しています。</p>
    <dl className="grid gap-3 sm:grid-cols-3">
      <div><dt className="font-bold">CPI上昇率（モデル内）</dt><dd data-testid="envelope-cpi" className="mt-1">最大 {percent(audit.cpi.peak)}・年{audit.cpi.year}</dd><dd>同じ年の政策なしとの差 {points(audit.cpi.policyDifference)}</dd><dd>許容上限は {percent(audit.cpi.limit)} という設定</dd></div>
      <div><dt className="font-bold">円レート</dt><dd className="mt-1 font-bold">公表モデルの反応から推計</dd><dd>下表に年次の変化率を表示。信認低下による追加の円安は別の感度条件です。</dd></div>
      <div><dt className="font-bold">輸入品の価格</dt><dd className="mt-1 font-bold">下表で条件付きストレスを検証</dd><dd>本体のエネルギー価格ショックは現在 {percent(audit.energyPriceShock, 0)}。追加の円安・海外価格上昇を重ねて比較します。</dd></div>
    </dl>
    <FiscalExternal rows={audit.fiscalExternal} model={audit.referenceModel} label={`留保後の枠 ${money(audit.amount, 1)} / 年`} />
    <p>追加額はGDPの{percent(audit.gdpShare, 1)}。GDP比1%の公表実験に対して約{audit.referenceScale.toFixed(1)}倍の規模を比例計算しています。供給面も、通常の潜在GDPとは別に、現在の実質GDPを{percent(audit.initialCapacityHeadroom, 1)}上回る最大生産能力を仮定しています。これらの仮定が大きな追加枠を許容する要因です。{audit.extrapolatedYears > 0 && `評価期間のうち${audit.extrapolatedYears}年は公表期間を超えた延長です。`}</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[320px] text-left tabular-nums"><caption className="mb-1 text-left font-bold">CPIの許容上限だけを変えた場合</caption><thead><tr><th className="p-2">許容上限</th><th className="p-2">限界財政枠（留保後）</th><th className="p-2">条件</th></tr></thead><tbody>{audit.sensitivity.map(row => <tr key={row.limit} className="border-t border-mirai-border"><th scope="row" className="p-2 font-medium">{percent(row.limit, 1)}</th><td className="p-2">{money(row.amount, 1)}{row.status === 'search-cap' && '（暫定）'}</td><td className="p-2">{row.status === 'baseline-violated' ? '政策なしでも上限超過' : row.current ? '現在の設定' : '感度比較'}</td></tr>)}</tbody></table></div>
    <div className="overflow-x-auto" role="region" aria-label="為替・輸入物価ストレス表" tabIndex={0}><table className="w-full min-w-[680px] text-right tabular-nums"><caption className="mb-2 text-left font-bold">同じ留保後の枠に円安が重なったら（数量固定・感度仮定）</caption><thead><tr>{['円/外貨の上昇', '円建て輸入価格', 'CPI上昇率の最大', '設定上限', '輸入支払増', '輸出受取増', '収支差'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{audit.externalStress.map(r => <tr key={r.fx} className="border-t border-mirai-border"><th scope="row" className="p-2">{percent(r.fx, 0)}</th><td>{percent(r.importPrice, 1)}</td><td>{percent(r.cpiPeak)}</td><td className="font-bold">{r.exceeds ? '超過' : '範囲内'}</td><td>{money(r.importBill, 1)}</td><td>{money(r.exportReceipts, 1)}</td><td>{money(r.tradeBalance, 1)}</td></tr>)}</tbody></table></div>
    <p data-testid="fx-stress-conclusion">円安10%の感度例ではCPI最大<strong>{percent(audit.externalStress[2].cpiPeak)}</strong>。{audit.externalStress[2].exceeds ? '現在の留保後の枠は、この条件では物価上限を超えます。' : 'この条件では物価上限内ですが、為替の安全性を保証しません。'}</p>
    <details><summary className="cursor-pointer font-bold">為替ストレスの根拠・感度・限界</summary><div className="mt-2 space-y-2">
      <p>「円安10%」は1外貨を買う円の額が10%増える意味。輸入数量・外貨価格を固定し、円安が輸入価格へ100%転嫁する厳しいケースです。輸出は50%が円安を円建て受取増に反映する仮定。輸出数量増・国内代替・為替予約はこの表に含めません。輸出の反映率0〜100%なら10%円安時の収支差は{money(audit.externalStress[2].tradeRange[0], 1)}〜{money(audit.externalStress[2].tradeRange[1], 1)}です。</p>
      <p>輸入価格上昇率×0.13をCPI水準の追加上昇とする仮定です。0.08・0.13・0.20で10%円安時のCPI最大は{audit.passThroughSensitivity.map(r => percent(r.cpiPeak)).join(' / ')}。信頼区間ではありません。日銀の2022〜2024年分解では輸入物価+36.2%、CPI+8.7%のうち投入コスト寄与4.7%ですが、その比4.7/36.2を将来の因果的弾力性とみなすことはできません。<a className="underline" href={IMPORT_COST_SOURCE} target="_blank" rel="noreferrer">日銀2026年1月・BOX3</a></p>
      <p>CPIが最も高い将来年（年{audit.externalStress[2].year}）に累積転嫁が1年で生じる厳しいタイミングを仮定。翌年以降は価格水準を保ち、同じ上昇率を毎年重ねません。賃金・期待・金融政策の二次反応、実質所得の低下、供給途絶は別途必要です。この診断だけで留保後の枠やGDP・税収を自動変更していません。</p>
      <p>円安10%と外貨建て輸入価格10%上昇が重なると、円建て輸入価格は21%上昇し、CPI最大{percent(audit.combinedStress.cpiPeak)}。日銀も円安・原油高等を組み合わせたリスクを分析していますが、その複合効果を円安単独の係数には転用していません。<a className="underline" href={FX_RISK_SOURCE} target="_blank" rel="noreferrer">日銀2026年4月・BOX2〜3</a></p>
      <p>食品は輸入コスト転嫁を0.30と仮定した場合、10%円安で価格水準が追加で{percent(audit.externalStress[2].foodPriceLevel, 1)}上昇する感度例です。食品CPIの予測値ではなく、コアコアCPIの経路も未推計。食品自給率の裏返しを小売価格の輸入原価比率としては使っていません。</p>
    </div></details>
  </div>;
}
