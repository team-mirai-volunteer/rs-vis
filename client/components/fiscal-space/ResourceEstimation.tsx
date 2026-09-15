import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
import type { ResourceAssumptions } from '@/types/fiscal-space';
import { RESOURCE_REFERENCE, RESOURCE_REGIONS, RESOURCE_SECTORS } from '@/app/lib/fiscal-space/resource-estimate';
import { SECTOR_LABELS } from '@/app/lib/fiscal-space/assumptions';
import { RangeField } from './Controls';
import { fieldClass, money, percent, points } from './format';

export function ResourceEstimation({ result, value, onChange }: {
  result: FiscalCalculation; value: ResourceAssumptions; onChange: (v: ResourceAssumptions) => void;
}) {
  const change = <K extends keyof ResourceAssumptions>(k: K, v: ResourceAssumptions[K]) => onChange({ ...value, [k]: v });
  const paths = [result.projection.initial, ...result.projection.steps.slice(0, result.horizon)];
  const allEstimated = result.allocated.every(p => p.load?.estimated);
  const power = paths.map(p => p.resourcePower).filter(p => !!p).reduce<typeof result.projection.initial.resourcePower>((a, b) => !a || b.utilization > a.utilization ? b : a, undefined);
  return <section aria-label="産業・電力負荷の概算" className="space-y-3 rounded-xl border border-mirai-border bg-card p-5">
    <h2 className="text-lg font-bold">産業・電力制約を概算する</h2>
    <label className="block text-sm">負荷の評価方法<select className={fieldClass} value={value.mode} onChange={e => change('mode', e.target.value as ResourceAssumptions['mode'])}>
      <option value="estimated">公表統計を基に概算（既定）</option><option value="manual">手入力した負荷だけで評価</option>
    </select></label>
    <p className="text-xs">産業は2020年の108部門の取引・雇用から6区分の追加人員を概算。設備稼働率ではありません。電力は2026年度を年0としてOCCTOの地域・季節別見通しを使います。GDPデータの年度とは別の需給シナリオです。公表GDP・物価反応には重ねて加算しません。</p>
    {result.resourceSensitivity.length > 0 && <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="負荷推計の感度表">
      <table className="w-full text-right text-sm"><caption className="text-left font-bold">負荷の仮定による参考上限の幅（留保後・年額）</caption>
        <thead><tr><th scope="col" className="py-2 text-left">概算負荷</th><th scope="col">参考上限</th><th scope="col">境界の制約</th></tr></thead>
        <tbody>{result.resourceSensitivity.map(row => <tr key={row.loadScale} className="border-t border-mirai-border">
          <th scope="row" className="py-2 text-left">{row.loadScale === .5 ? '低位' : row.loadScale === 1 ? '標準' : '高位'}（{row.loadScale}倍）</th>
          <td>{money(row.space.recommendedEnvelope)}</td><td>{row.space.constraints.filter(c => c.status === 'violated').map(c => c.label).join('・') || (row.space.status === 'revenue-cap' ? '減収対象の収入' : row.space.status === 'empty-mix' ? '配分未入力' : '探索範囲の端')}</td>
        </tr>)}</tbody>
      </table><p className="mt-2 text-xs">0.5～1.5倍は未推定の感度幅です。信頼区間ではありません。手入力した政策の係数は固定します。別の制約が先に効けば、参考上限は変わりません。</p>
    </div>}
    <details><summary className="cursor-pointer text-sm font-bold">概算の仮定・出典と内訳</summary><div className="mt-3 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <RangeField label="概算負荷の倍率" value={value.loadScale} min={.25} max={2} step={.05} unit="倍" onChange={n => change('loadScale', n)} />
        <RangeField label="減税・給付が消費に回る割合" value={value.spendingShare * 100} min={0} max={100} step={5} unit="%" onChange={n => change('spendingShare', n / 100)} />
        <RangeField label="年0の購入価格 / 2020年価格" value={value.priceIndex} min={.8} max={2} step={.05} unit="倍" onChange={n => change('priceIndex', n)} />
        <RangeField label="電力購入単価（換算の仮定）" value={value.electricityPrice} min={5} max={50} step={1} unit="円/kWh" onChange={n => change('electricityPrice', n)} />
        <RangeField label="追加電力の年間負荷率" value={value.loadFactor * 100} min={20} max={100} step={5} unit="%" onChange={n => change('loadFactor', n / 100)} />
        <RangeField label="系統ピークとの同時発生係数" value={value.coincidence} min={0} max={1} step={.05} unit="倍" onChange={n => change('coincidence', n)} />
        <RangeField label="半導体設備の稼働後年産出額 / 投資額" value={value.operatingOutputRatio} min={0} max={2} step={.1} unit="倍" onChange={n => change('operatingOutputRatio', n)} />
        <label className="text-sm">追加電力負荷・供給の地域配分<select className={fieldClass} value={value.region} onChange={e => change('region', e.target.value as ResourceAssumptions['region'])}>
          <option value="demand-share">基準需要に比例して全国へ配分</option>{RESOURCE_REGIONS.map(r => <option key={r} value={r}>{r}に集中する仮定</option>)}
        </select></label>
      </div>
      <p className="text-xs">人員能力＝2020年の従業者数÷初期利用率（仮定）。労働時間・職種・移動の制約は再現しません。108部門の上流波及を計算してから6区分に集約するため、区分内の偏りは見えません。電力支出を仮定した単価でkWhへ換算し、年間負荷率と同時発生係数でピークに換算します。送電線増強による地域間融通は未推計です。</p>
      <p className="text-xs">既存の需要見通しに追加政策の負荷だけを加えます。計画済み投資を追加政策にも入力すると重複するため、純追加分を入力してください。半導体以外の稼働後追加電力は既定0の仮定で、必要なら「政策別の人員・電力負荷」で上書きできます。発電の確実供給は別途設定した電源条件で計算します。</p>
      <p className="text-xs">出典：<a className="underline" target="_blank" rel="noreferrer" href={RESOURCE_REFERENCE.sources['io-2020-108.xlsx'].url}>全国産業連関表（2020年・2025年訂正版）</a>／<a className="underline" target="_blank" rel="noreferrer" href={RESOURCE_REFERENCE.sources['employment-2020-108.xlsx'].url}>同年雇用表</a>／<a className="underline" target="_blank" rel="noreferrer" href={RESOURCE_REFERENCE.sources['occto-2026.pdf'].url}>OCCTO 2026年度供給計画・別紙2</a>。電力は融通前の供給力を使う厳しめの仮定で、公表の供給信頼度評価とは異なります。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="産業別の追加人員概算"><table className="w-full min-w-[500px] text-right text-sm">
        <caption className="text-left">追加予算による区分別の期間内最大負荷</caption>
        <thead><tr>{['区分', '初期利用率（仮定）', '追加利用率', '追加人員相当'].map(h => <th scope="col" key={h} className="py-2">{h}</th>)}</tr></thead>
        <tbody>{RESOURCE_SECTORS.map(s => {
          const extra = Math.max(...paths.map(p => p.sectorDemand[s]));
          const base = result.initial.labour.sectorUtilization[s];
          return <tr key={s} className="border-t border-mirai-border"><th scope="row" className="py-2 text-left">{s === 'general' ? 'その他産業' : SECTOR_LABELS[s]}</th><td>{percent(base)}</td><td>{points(extra)}</td><td>{allEstimated ? `${Math.round(extra / base * RESOURCE_REFERENCE.sectorWorkers[s]).toLocaleString()}人` : '手入力を含むため未換算'}</td></tr>;
        })}</tbody>
      </table></div>
      {power && <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="地域別の電力需給概算"><table className="w-full min-w-[480px] text-right text-sm">
        <caption className="text-left">電力制約が最も厳しい{power.referenceYear}年度（追加予算を反映）</caption>
        <thead><tr>{['地域・断面', '需要GW', '供給GW（融通前）', '利用率'].map(h => <th scope="col" key={h} className="py-2">{h}</th>)}</tr></thead>
        <tbody>{power.rows.map(r => <tr key={`${r.region}-${r.season}`} className="border-t border-mirai-border"><th scope="row" className="py-2 text-left">{r.region}・{r.season}</th><td>{r.demandGw.toFixed(2)}</td><td>{r.supplyGw.toFixed(2)}</td><td>{percent(r.utilization)}</td></tr>)}</tbody>
      </table><p className="mt-2 text-xs">沖縄の2026・2027年度は、公表表の注記に従い最小予備率断面を使用します。全国集計もこの指定断面を含み、厳密な同時刻合計ではありません。</p></div>}
    </div></details>
  </section>;
}
