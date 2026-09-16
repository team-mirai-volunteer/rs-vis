import type { Policy } from '@/types/fiscal-space';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { POLICY_TRADE_CHANNELS, POWER_TECHNOLOGIES, POWER_SOURCE, POWER_DETAIL_SOURCE, POWER_FIRM_NOTE, SEMICONDUCTOR_SOURCE,
  industryTrade, industryImportBreakEven, INDUSTRY_TRADE_REFERENCE, INDUSTRY_TRADE_REFERENCE_PERCENT, powerTrade, powerCase, SEMICONDUCTOR_FINANCIAL_SOURCE, type IndustryTradeCase, type PowerCase, type PowerTechnology } from '@/app/lib/fiscal-space/policy-trade';
import { fieldClass, money } from './format';
import { PROJECT_POLICY_IDS } from '@/app/lib/fiscal-space/project-response';

function Numeric({ label, value, onChange, min = 0, max = 100, step = .1, unit = '' }: {
  label: string; value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; unit?: string;
}) {
  return <label className="block text-xs"><span>{label}{unit && `（${unit}）`}</span><input type="number" className={`${fieldClass} mt-1`} min={min} max={max} step={step} value={value ?? ''} placeholder="未推計"
    onChange={e => { if (e.target.value === '') onChange(null); else if (Number.isFinite(e.target.valueAsNumber)) onChange(Math.max(min, Math.min(max, e.target.valueAsNumber))); }} /></label>;
}
export { configuredPower, type TradeForm } from '@/client/lib/fiscal-space-trade';
import { configuredPower, type TradeForm } from '@/client/lib/fiscal-space-trade';
export function PolicyTrade({ policies, value, onChange }: { policies: Policy[]; value: TradeForm; onChange: (v: TradeForm) => void }) {
  const selected = policies.find(p => p.id === value.selected)!;
  const channel = POLICY_TRADE_CHANNELS[selected.id];
  const isPower = selected.id === 'generation';
  const industry = value.industry[selected.id];
  const breakEven = industryImportBreakEven(industry);
  const power = value.power;
  const tradeMoney = (n: number | null) => n === null ? '未推計' : money(n, 3);
  const changeIndustry = <K extends keyof IndustryTradeCase>(key: K, n: IndustryTradeCase[K]) => onChange({ ...value, industry: { ...value.industry, [selected.id]: { ...industry, [key]: n } } });
  const changePower = <K extends keyof PowerCase>(key: K, n: PowerCase[K]) => {
    const updated = { ...power, [key]: n };
    onChange({ ...value, power: updated, powerCases: { solar: powerCase('solar'), nuclear: powerCase('nuclear'), hydro: powerCase('hydro'), ...value.powerCases, [power.technology]: updated } });
  };
  const pctInput = (n: number | null) => n === null ? null : n * 100;
  const years = [1, 5, 10, 20];
  return <Card><CardHeader><h2 className="text-lg font-bold">政策ごとの輸出・国内代替</h2><p className="text-sm leading-relaxed">半導体の海外販売、発電の燃料輸入削減、減税による競争力は別の経路です。公表マクロモデルの共通反応だけでは分野固有の便益を比較できません。</p></CardHeader><CardContent className="space-y-4 text-xs leading-relaxed">
    <div role="region" aria-label="政策別の貿易経路" className="overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[850px] table-fixed text-left">
        <caption className="sr-only">政策ごとの輸出・国内代替・輸入への経路と効果が出る時期</caption>
        <thead><tr className="border-b border-mirai-border">{['政策', '輸出', '国内代替', '輸入', '時期'].map((label, i) => <th key={label} scope="col" className={`px-3 py-2 ${i === 0 ? 'sticky left-0 z-10 w-[130px] bg-card' : ''}`}>{label}</th>)}</tr></thead>
        <tbody>{policies.map(p => { const c = POLICY_TRADE_CHANNELS[p.id]; return <tr key={p.id} className="border-b border-mirai-border last:border-0 hover:bg-mirai-surface-teal/60 [&>td]:align-top [&>th]:align-top">
          <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-3 font-bold">{p.name}</th>
          {[c.exports, c.substitution, c.imports, c.timing].map((text, i) => <td key={i} className="px-3 py-3">{text}</td>)}
        </tr>; })}</tbody>
      </table>
    </div>
    <p>半導体の公的支援額・官民投資額・国内売上目標は異なる量です。政府の経済波及効果を輸出額やGDPへそのまま置き換えていません。<a className="underline" href={SEMICONDUCTOR_SOURCE} target="_blank" rel="noreferrer">経産省：AI・半導体支援</a></p>
    <details><summary className="cursor-pointer text-sm font-bold">政策別の事業条件から試算する</summary><div className="mt-4 space-y-4">
      <label className="block">試算する政策<select aria-label="試算する政策" className={`${fieldClass} mt-1`} value={value.selected} onChange={e => onChange({ ...value, selected: e.target.value })}>{policies.filter(p => PROJECT_POLICY_IDS.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <p>{selected.name}の追加予算<strong>{money(selected.annualCost, 1)} / 年</strong>と継続期間を使用。設定した事業条件は<strong>上の政策比較・GDP・条件付き参考額へ反映</strong>します。建設時の輸入は共通反応を補正し、稼働後の輸出・輸入代替・輸入原価を別に計算します。建設費の輸入割合が空欄なら共通反応を維持します。売上や運転時輸入費が未設定なら、稼働後の便益も費用も未算入です。</p>
      <p>潜在GDPには、事業が生む輸出＋輸入代替−輸入原価の正の部分を、海外との取引から見込む追加供給能力として反映します。実質GDPへの反映は国内の供給制約で制限します。既存事業の利益ではなく、政策による純増分の販売・置換条件を入力してください。</p>
      <p>{channel.timing}。補助率による民間投資の上乗せは仮定せず、入力した政策費用と同額の投資を想定します。金額は物価・為替を固定した比較です。</p>
      {isPower ? <>
        <label className="block">{value.mix ? '編集する電源（配分は電源構成欄で変更）' : '発電方式'}<select aria-label="発電方式" className={`${fieldClass} mt-1`} value={power.technology} onChange={e => { const technology = e.target.value as PowerTechnology; onChange({ ...value, power: value.powerCases?.[technology] ?? powerCase(technology) }); }}>{Object.entries(POWER_TECHNOLOGIES).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}</select></label>
        <p>{POWER_TECHNOLOGIES[power.technology].note}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Numeric label="建設費" value={power.capexPerKw / 1e4} min={1} max={500} unit="万円/kW" onChange={n => { if (n !== null) changePower('capexPerKw', n * 1e4); }} />
          <Numeric label="設備利用率" value={power.capacityFactor * 100} unit="%" onChange={n => { if (n !== null) changePower('capacityFactor', n / 100); }} />
          <Numeric label="支出から稼働まで（仮定）" value={power.lag} max={30} step={1} unit="年" onChange={n => { if (n !== null) changePower('lag', Math.round(n)); }} />
          <Numeric label="追加の出力制御率（仮定）" value={power.curtailment * 100} unit="%" onChange={n => { if (n !== null) changePower('curtailment', n / 100); }} />
          <Numeric label="発電量のうち火力を置換（仮定）" value={power.thermalReplacement * 100} unit="%" onChange={n => { if (n !== null) changePower('thermalReplacement', n / 100); }} />
          <Numeric label="置換する輸入燃料単価（仮定）" value={power.displacedFuelYenPerKwh} max={50} unit="円/kWh" onChange={n => { if (n !== null) changePower('displacedFuelYenPerKwh', n); }} />
          <Numeric label="新電源の運転時輸入費" value={power.operatingImportYenPerKwh} max={50} unit="円/kWh" onChange={n => changePower('operatingImportYenPerKwh', n)} />
          <Numeric label="建設費の輸入割合" value={pctInput(power.capexImportShare)} unit="%" onChange={n => changePower('capexImportShare', n === null ? null : n / 100)} />
          <Numeric label="確実供給への寄与率" value={pctInput(power.firmShare)} unit="%" onChange={n => changePower('firmShare', n === null ? null : n / 100)} />
        </div>
        <p>{POWER_FIRM_NOTE}</p>
        <p>建設費・設備利用率・寿命は2025年公表の2023年モデルプラントを参考に設定。太陽光17.6万円/kW・18.3%、原子力60.025万円/kW・70%、中水力66.5万円/kW・54.7%。現在の見積価格ではありません。<a className="underline" href={POWER_SOURCE} target="_blank" rel="noreferrer">諸元</a> / <a className="underline" href={POWER_DETAIL_SOURCE} target="_blank" rel="noreferrer">内訳</a></p>
        <p>稼働遅れ2・10・5年、火力置換80%、燃料単価9円/kWhは比較用仮定。太陽光・水力の燃料輸入は0、設備補修等の輸入は未算入。原子力は公表核燃料サイクル費1.9円/kWhの50%を海外支払と仮定し、輸入費0.95円/kWhで初期化します。輸入割合の実証値ではなく、空欄に戻すと稼働後効果は未推計になります。新設原子力の初回稼働は年11です。</p>
        <div className="overflow-x-auto" role="region" aria-label="発電方式の輸入代替試算" tabIndex={0}><table className="w-full min-w-[780px] text-right tabular-nums"><thead><tr>{['年', '稼働設備（GW）', '送電端発電量（TWh）', '燃料輸入削減', '運転時輸入', '建設時輸入', '収支差', '確実供給（GW）'].map(h => <th scope="col" key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{years.map(year => { const r = powerTrade(selected, year, configuredPower(value)); return <tr key={year} className="border-t border-mirai-border"><th className="p-2" scope="row">{year}</th><td>{r.capacityGw.toFixed(2)}</td><td>{r.generationTwh.toFixed(2)}</td><td>{tradeMoney(r.substitution)}</td><td>{tradeMoney(r.operatingImports)}</td><td>{tradeMoney(r.capexImports)}</td><td>{tradeMoney(r.tradeBalance)}</td><td>{r.firmGw === null ? '未推計' : r.firmGw.toFixed(2)}</td></tr>; })}</tbody></table></div>
        <p>年間発電量＝稼働設備×8,760時間×設備利用率×所内消費控除×出力制御控除。発電量とピーク時の確実供給力は別です。設備容量をそのまま安定供給力へ加算しません。全国の立地余地・送電制約・置換可能な火力量を超える大規模な比例外挿は未検証です。</p>
      </> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Numeric label="投資1円あたり稼働後の年間売上" value={industry.annualSalesPerInvestment} max={10} unit="円/年" onChange={n => changeIndustry('annualSalesPerInvestment', n)} />
          <Numeric label="事業の純追加性" value={(industry.additionality ?? 1) * 100} unit="%" onChange={n => { if (n !== null) changeIndustry('additionality', n / 100); }} />
          <Numeric label="事業の年間減耗率" value={(industry.depreciation ?? 0) * 100} unit="%" onChange={n => { if (n !== null) changeIndustry('depreciation', n / 100); }} />
          <Numeric label="建設・導入費の輸入割合" value={pctInput(industry.capexImportShare)} unit="%" onChange={n => changeIndustry('capexImportShare', n === null ? null : n / 100)} />
          <Numeric label="売上の輸出割合（仮定）" value={industry.exportShare * 100} unit="%" onChange={n => { if (n !== null) changeIndustry('exportShare', n / 100); }} />
          <Numeric label="国内販売のうち輸入を置換（仮定）" value={industry.domesticReplacementShare * 100} unit="%" onChange={n => { if (n !== null) changeIndustry('domesticReplacementShare', n / 100); }} />
          <Numeric label="売上に対する輸入原材料等（仮定）" value={industry.operatingImportShare * 100} unit="%" onChange={n => { if (n !== null) changeIndustry('operatingImportShare', n / 100); }} />
          <Numeric label="支出から稼働まで（仮定）" value={industry.lag} max={30} step={1} unit="年" onChange={n => { if (n !== null) changeIndustry('lag', Math.round(n)); }} />
          <Numeric label="稼働後の便益期間（仮定）" value={industry.lifetime} min={1} max={50} step={1} unit="年" onChange={n => { if (n !== null) changeIndustry('lifetime', Math.round(n)); }} />
        </div>
        <p>半導体の初期売上/設備比は<a className="underline" href={SEMICONDUCTOR_FINANCIAL_SOURCE} target="_blank" rel="noreferrer">TSMC 2024年連結決算</a>の売上2,894,307,699÷期末純有形固定資産3,234,980,070（双方千台湾ドル）≒0.895。年間設備投資で割ってはいません。日本の補助金収益率ではなく、既存の海外企業を参考にした条件です。新設工場・技術世代・再調達価格との差があり、純追加性50%・年間減耗10%・15年寿命を仮定。官民投資の倍率は付けません。稼働遅れ3年も仮定です。研究開発は売上未設定なら知識蓄積の供給モデルを使い、売上を設定するとそちらへ切り替えます。</p>
        {selected.id === 'semiconductors' && <p><a className="underline" href={INDUSTRY_TRADE_REFERENCE.sourceUrl} target="_blank" rel="noreferrer">{INDUSTRY_TRADE_REFERENCE.referenceYear}年全国産業連関表・{INDUSTRY_TRADE_REFERENCE.sectorName}部門</a>を参考に、初期値は輸出{INDUSTRY_TRADE_REFERENCE_PERCENT.exportShare}%、国内販売の輸入置換{INDUSTRY_TRADE_REFERENCE_PERCENT.domesticReplacementShare}%、供給網全体の輸入原価{INDUSTRY_TRADE_REFERENCE_PERCENT.operatingImportShare}%。輸入原価は直接調達{INDUSTRY_TRADE_REFERENCE_PERCENT.directOperatingImportShare}%に国内仕入先の輸入を含めた比例配分による推計で、関税・輸入品商品税は除きます。置換{INDUSTRY_TRADE_REFERENCE_PERCENT.domesticReplacementShare}%は国内市場の輸入割合を代用した仮定で、投資の因果効果ではありません。{INDUSTRY_TRADE_REFERENCE.referenceYear}年の部門平均と新設半導体工場には品種・技術・調達構成の違いがあります。建設時輸入は別途未推計です。</p>}
        <p>現在の条件で、稼働後の原材料等の輸入を国内代替が上回るには、{breakEven === null || breakEven > 1 ? '国内販売の輸入置換だけでは不足します。' : `国内販売の${(breakEven * 100).toFixed(1)}%超の輸入置換が必要です。`}建設・所得増等による輸入は別に加わります。主表の産業投資内訳では、置換率0%・100%の条件も比較できます。</p>
        <div className="overflow-x-auto" role="region" aria-label="政策固有の輸出入試算" tabIndex={0}><table className="w-full min-w-[680px] text-right tabular-nums"><thead><tr>{['年', '輸出増', '輸入の国内代替', '運転時輸入', '建設時輸入', '収支差', '事業の国内付加価値'].map(h => <th scope="col" key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{years.map(year => { const r = industryTrade(selected, year, industry); return <tr key={year} className="border-t border-mirai-border"><th className="p-2" scope="row">{year}</th>{[r.exports, r.substitution, r.operatingImports, r.capexImports, r.tradeBalance, r.domesticValueAdded].map((n, i) => <td key={i}>{tradeMoney(n)}</td>)}</tr>; })}</tbody></table></div>
        <p>収支差＝輸出増＋輸入代替−運転時輸入−建設時輸入。輸出販売と国内販売を分け、同じ製品を輸出と国内代替の両方へ数えません。国内付加価値は売上−輸入原価で、国内取引を含む供給網全体の粗い近似。既存事業の置換・研究の失敗・輸入原価以外の海外支払は未反映で、GDPの純増とは異なります。</p>
      </>}
    </div></details>
    <details><summary className="cursor-pointer font-bold">本体への反映方法と推計の限界</summary><div className="mt-2 space-y-2">
      <p>建設時は、公表モデルの初年度輸入反応を基準に、輸入割合を変更した後の国内支出に比例してGDP・物価・雇用等の反応を補正します。元の輸入反応には間接需要も含まれるため、直接調達割合の厳密な推定ではありません。建設時輸入の部門別校正は未完了です。半導体の稼働時輸入原価は2020年の電子デバイス部門から推計しますが、政府支出の共通反応には引き続き代理モデルとしての不確実性が残ります。</p>
      <p>本体では支出年ごとに基準経路の物価で実質化し、稼働までの遅れと便益期間を適用します。以下の事業表は価格固定の直接効果なので、本体の名目輸出入とは金額が異なります。稼働後の追加売上・燃料置換は共通マクロ反応を超える効果と仮定しており、案件ごとの純追加性を実証したものではありません。</p>
      <p>輸入代替は全政策を合算し、発電は基準年のエネルギー輸入額、その他は残りの輸入額を上限にします。これは輸入額が負にならないための上限で、品種別の市場規模・立地・電力系統の制約ではありません。円相場の反応、世界需要、政策別の雇用・価格転嫁、海外での報復措置は追加販売に連動して再推計していません。</p>
      <p>送電網は再エネの有効利用による燃料節約を国内代替へ反映し、保守費を控除します。追加再エネと重複し得る便益は設定割合に応じて控除します。これは地域・時間別の系統計算ではありません。公共投資・減税・給付・医療・教育・保育・防衛は、分野固有の輸出・代替効果が未算入です。</p>
    </div></details>
    <details><summary className="cursor-pointer font-bold">消費税の輸出免税・還付をどう扱うか</summary><p className="mt-2">輸出免税では仕入れにかかった消費税を控除・還付できます。税率低下で仕入時の税負担と還付額がともに減るので、還付の減少額をそのまま輸出企業の損失や輸出減少へ換算しません。税抜仕入価格が固定なら、税率10%の仕入100円＋税10円・還付10円も、5%の仕入100円＋税5円・還付5円も、税控除後の仕入費は100円です。価格交渉・転嫁・資金繰りは別の効果です。<a className="underline" href="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6551.htm" target="_blank" rel="noreferrer">国税庁</a></p></details>
  </CardContent></Card>;
}
