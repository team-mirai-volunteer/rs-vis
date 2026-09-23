import { AGE_BURDEN, AGE_BURDEN_SOURCE, EMPLOYER_SOURCE, NATIONAL_BURDEN, NATIONAL_BURDEN_SOURCE, OECD_WORKING_BURDEN, BURDEN_INCIDENCE, CORPORATE_SOURCE, extendedHouseholdBurden, workingHouseholdBurden } from '@/app/lib/fiscal-space/burden-data';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { percent } from './format';

export function BurdenIndicators({ latest, corporateShare, onOpenSettings }: { latest: boolean; corporateShare: number; onOpenSettings: () => void }) {
  const working = workingHouseholdBurden(corporateShare);
  const benchmark = OECD_WORKING_BURDEN[latest ? 1 : 0];
  const amount = (n: number) => `${(n / 1e4).toFixed(1)}万円`;
  const national = NATIONAL_BURDEN[0];
  return <Card><CardHeader><h2 className="text-lg font-bold">国民負担率（GDP比・参考NI比）と年齢別の家計負担</h2></CardHeader><CardContent className="space-y-3 text-xs leading-relaxed">
    <div className="grid gap-4 sm:grid-cols-2">
      <div data-testid="national-burden-panel"><p>税・社会保険料のGDP比（2024年度実績）</p><p data-testid="national-burden" className="text-xl font-bold">{percent(national.rate, 1)}</p><p>分母は同年度の名目GDP。国・地方の租税と、本人・事業主の社会保障負担を含みます。消費税・法人税も含み、財政赤字は含みません。<a className="underline" href={NATIONAL_BURDEN_SOURCE} target="_blank" rel="noreferrer">財務省の対GDP比</a></p>
        <p className="mt-2">参考：国民所得（NI）比（2024年度実績）</p><p data-testid="national-burden-ni" className="text-lg font-bold">{percent(national.niRate, 1)}</p>
        <p>同じ税・社会保険料を、GDP {national.gdp / 1e12}兆円とNI {national.nationalIncome / 1e12}兆円で割った財務省の公表値です。NI（要素費用表示）は設備等の減耗分や生産・輸入にかかる税（補助金控除後）を除いた所得で、家計の手取りではありません。</p>
        <p>国際比較の主表示はGDP比。OECD平均と比較する場合は、日本も同じOECD統計・対象年に揃えます。</p>
        <p>内訳の概算：租税 {percent(national.tax, 1)}・社会保障 {percent(national.social, 1)}（いずれもGDP比）。同じ資料の国民所得・GDPから換算しており、端数処理により表示の合計は総率と一致しない場合があります。</p>
        {latest && <div className="mt-2">{NATIONAL_BURDEN.slice(1).map(r => <p key={r.year} data-testid={`national-burden-${r.year}`}>{r.year}年度：GDP比 {percent(r.rate, 1)}・参考NI比 {percent(r.niRate, 1)}（{r.label}）</p>)}</div>}</div>
      <div><p>現役世帯の家計負担（事業主・消費税・法人税の賃金帰着込み）</p><p className="text-xl font-bold">平均 <span data-testid="working-burden-average">{percent(working.average, 1)}</span></p>
        <p>年齢階級別の幅：<span data-testid="working-burden" className="font-bold">{percent(working.min, 1)}〜{percent(working.max, 1)}</span></p>
        <p>2024年・世帯主65歳未満の二人以上勤労者世帯。平均は調査の世帯数分布（抽出率調整済み）で負担額と所得を集計し、負担総額÷所得総額で算出。1世帯あたり負担 {amount(working.burden)}・分母の所得 {amount(working.income)}／年。</p>
        <p>幅は年齢階級別の最小〜最大で、誤差幅ではありません。単身・自営業を含む15〜64歳個人の全国平均は、この資料からは算出できません。</p></div>
    </div>
    <button type="button" className="text-sm text-primary-accent underline" onClick={onOpenSettings}>家計負担の推計条件を設定</button>
    <p>法人課税も賃金抑制を通じた負担に含めます。国・地方の法人課税{(BURDEN_INCIDENCE.corporateTaxTotal / 1e12).toFixed(2)}兆円の{percent(corporateShare, 0)}を、全国の賃金・俸給{(BURDEN_INCIDENCE.wagesAndSalaries / 1e12).toFixed(2)}兆円に比例配賦。25%は日本の実証値ではなく比較用の初期仮定です。株主や消費者に帰着する分はこの試算に未配賦で、法人税全体を現役世代だけに割り振ってはいません。<a href={CORPORATE_SOURCE} className="underline" target="_blank" rel="noreferrer">課税総額の出典</a></p>
    <p>家計負担率＝（本人直接税＋本人保険料＋事業主負担＋消費税＋法人税の賃金帰着）÷（家計実収入＋事業主負担＋法人税の賃金帰着）。失われた賃金に相当する配賦額を分母にも戻します。分母は年金・給付も含む家計所得で、NIやGDPそのものではありません。国全体のGDP比・NI比との差を、そのまま世代間の負担差とは解釈できません。</p>
    <p className="rounded-lg bg-mirai-surface-warm p-3">国全体の税・社会保険料と同じ範囲での「生産年齢人口の負担率」は未推計です。企業課税の世代別帰着や、GDP・NIの年齢別配分が必要です。</p>
    <div data-testid="oecd-working-burden" className="space-y-2 rounded-lg border border-mirai-border p-3">
      <p className="font-bold">OECDの勤労世帯比較（{benchmark.year}年・参考）</p>
      <p>同じ世帯条件で日本とOECD公表平均を比較します。所得税＋本人・事業主社会保険料−現金給付を、賃金＋事業主負担（労働費用）で割った割合です。消費税・法人税を含まず、上の家計負担率や実際の生産年齢人口の平均とは範囲が異なります。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="世帯条件別の国際比較"><table className="w-full min-w-[380px] text-right tabular-nums"><thead><tr><th scope="col" className="p-2 text-left">世帯条件</th><th scope="col" className="p-2">日本</th><th scope="col" className="p-2">OECD平均</th></tr></thead><tbody>{benchmark.cases.map(row => <tr key={row.id} data-testid={`oecd-working-${row.id}`} className="border-t border-mirai-border"><th scope="row" className="p-2 text-left font-normal">{row.label}</th><td className="p-2">{percent(row.japan, 1)}</td><td className="p-2">{percent(row.oecd, 1)}</td></tr>)}</tbody></table></div>
      <p>消費税・法人税の帰着まで含めた現役世帯のOECD平均は未算出です。<a className="underline" href={benchmark.sourceUrl} target="_blank" rel="noreferrer">OECDの賃金課税統計（{benchmark.edition}年版）</a></p>
    </div>
    <details><summary className="cursor-pointer font-bold">年齢別の負担額・推計方法を見る</summary><div className="mt-3 space-y-3">
      <p>事業主負担は勤め先収入の16%と仮定し、14〜18%でも比較します。年金等は対象外。実際は年齢・加入制度・標準報酬上限で異なります。雇用費用を家計側に配賦した指標で、企業負担がすべて賃金に転嫁されると実証したものではありません。<a href={EMPLOYER_SOURCE} className="underline" target="_blank" rel="noreferrer">料率の参考</a></p>
      <p>消費税は歳入可視化と同じ品目分類を使い、税込の標準対象支出×10/110＋軽減対象支出×8/108。非課税支出を除き、混在品目の按分と完全転嫁を仮定。住宅購入等は含みません。</p>
      {AGE_BURDEN.map(group => <div key={group.population} className="overflow-x-auto" role="region" aria-label={`${group.population}の負担推計`} tabIndex={0}><table className="w-full min-w-[780px] text-right tabular-nums"><caption className="text-left font-bold">{group.population}（2024年・年間）</caption><thead><tr>{['世帯主年齢', '実収入', '直接税', '本人保険料', '事業主推計', '消費税推計', '法人税帰着', '合計負担率', '料率14〜18%の場合'].map(h => <th scope="col" key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{group.classes.map(row => {
        const b = extendedHouseholdBurden(row, undefined, corporateShare);
        return <tr key={row.label} className="border-t border-mirai-border"><th className="p-2" scope="row">{row.label}</th>{[row.realIncomeAnnual, b.tax, b.social, b.employer, b.vat, b.corporate].map((n, i) => <td className="p-2" key={i}>{amount(n)}</td>)}<td>{percent(b.rate, 1)}</td><td>{percent(extendedHouseholdBurden(row, .14, corporateShare).rate, 1)}〜{percent(extendedHouseholdBurden(row, .18, corporateShare).rate, 1)}</td></tr>;
      })}</tbody></table></div>)}
      <p>無職世帯は世帯主が無職という分類で、同居家族の勤め先収入を含みます。実収入には公的年金・給付を含み、借入・資産売却を除きます。<a className="underline" href={AGE_BURDEN_SOURCE} target="_blank" rel="noreferrer">家計調査の原表</a>。両プリセットとも内訳が揃う2024年資料を使用。</p>
    </div></details>
  </CardContent></Card>;
}

export function BurdenSettings({ corporateShare, onCorporateShare }: { corporateShare: number; onCorporateShare: (value: number) => void }) {
  return <div className="space-y-3">
    <label className="flex flex-wrap items-center gap-2 font-bold">法人課税のうち賃金へ帰着する割合（仮定）<select aria-label="法人税の賃金帰着割合" className="rounded border p-2" value={corporateShare} onChange={e => onCorporateShare(Number(e.target.value))}>{[0, .25, .5, 1].map(n => <option key={n} value={n}>{percent(n, 0)}</option>)}</select></label>
    <p className="text-sm">家計負担の参考推計に用いる割合です。GDP・税収の政策シミュレーションは変わりません。</p>
  </div>;
}
