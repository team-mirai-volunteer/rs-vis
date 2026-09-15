import type { fiscalExternal } from '@/app/lib/fiscal-space/fiscal-external';
import { REFERENCES, type ReferenceModel } from '@/app/lib/fiscal-space/calibration';
import { money, percent, points } from './format';

export function FiscalExternal({ rows, model, label }: { rows: ReturnType<typeof fiscalExternal>; model: ReferenceModel; label: string }) {
  return <div className="space-y-2 text-xs leading-relaxed" data-testid="fiscal-external">
    <h3 className="text-sm font-bold">財政拡大による為替・輸入物価への影響</h3>
    <p>{label}。政策なしの同年との差。円／ドルのプラスは円安、マイナスは円高。価格欄は水準差で、毎年の物価上昇率ではありません。</p>
    <div className="overflow-x-auto" role="region" aria-label={`${label}の為替・輸入物価推計`} tabIndex={0}><table className="w-full min-w-[830px] text-right tabular-nums"><thead><tr>{['年', '円／ドル', '円建て輸入価格', '輸入の価格要因', '輸入支払差の計', '輸出受取差の計', '収支差', 'CPI上昇率', 'CPIの前年差への政策寄与'].map(h => <th scope="col" key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{rows.filter(r => [1, 3, 5].includes(r.year) && r.year <= REFERENCES[model].years).map(r => <tr key={r.year} className="border-t border-mirai-border"><th className="p-2" scope="row">{r.year}</th>{[percent(r.fx), percent(r.importPrice), money(r.importPriceBill, 2), money(r.imports, 2), money(r.exports, 2), money(r.trade, 2), percent(r.cpi), points(r.cpiDifference)].map((v, i) => <td key={i} className="p-2">{v}</td>)}</tr>)}</tbody></table></div>
    <details><summary className="cursor-pointer font-bold">為替反応と輸入価格への換算条件</summary><div className="mt-2 space-y-2">
      <p><a className="underline" href={REFERENCES[model].url} target="_blank" rel="noreferrer">{REFERENCES[model].name}の為替反応</a>を政策額と継続期間に応じて重ね合わせています。金融政策による円高も含む参照モデルの結果で、現在の市場レートの予測ではありません。金利ショック・需給ギャップを変えた場合の為替反応は再推定しません。表示は公表期間内に限ります。</p>
      <p>外貨価格を一定とし、円／ドルの変化を輸入価格へ100%、輸出の円建て価格へ50%反映する換算仮定です。他通貨も対円で同率変化とみなし、数量反応を含む本体の輸出入額に価格要因を重ねた参考額。為替予約、契約通貨、企業の利幅調整や供給途絶は未再現です。輸入支払差には需要増加と価格変化の両方を含みます。</p>
      <p>事業条件を設定した政策では建設時の国内支出割合に合わせて共通反応を補正します。稼働後の追加輸出・輸入代替が円相場へ及ぼす効果は再推計していません。CPIへこの価格換算分を再加算せず、輸出入額の価格換算結果もGDP・税収・財政枠の探索へ戻していません。財政への信認低下による追加の円安は、別の円安ストレス表で比較します。</p>
    </div></details>
  </div>;
}
