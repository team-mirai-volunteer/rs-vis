import { memo, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ConstraintDefinition, Policy, PolicyKind, Thresholds } from '@/types/fiscal-space';
import { fieldClass, KIND_LABELS, money } from './format';
import { personalTaxRevenue, SOCIAL_INSURANCE_REVENUE } from '@/app/lib/fiscal-space/policy-limits';
import { THRESHOLD_BOUNDS } from '@/client/lib/fiscal-space-ranges';
import { permittedUnemploymentFloor } from '@/app/lib/fiscal-space/assumptions';

const DETAILS_KEY = 'fiscal-space:advanced-open';
function usePersistedOpen(key: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => { try { setOpen(window.localStorage.getItem(key) === '1'); } catch { /* per-viewer convenience only */ } }, [key]);
  const change = (next: boolean) => { setOpen(next); try { window.localStorage.setItem(key, next ? '1' : '0'); } catch { /* ignore */ } };
  return [open, change] as const;
}

export function RangeField({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void;
}) {
  const id = useId();
  const [empty, setEmpty] = useState(false);
  const clamp = (n: number) => Number(Math.max(min, Math.min(max, min + Math.round((n - min) / step) * step)).toFixed(8));
  return <div className="space-y-2"><div className="flex items-center justify-between gap-2"><label htmlFor={id} className="text-sm font-medium">{label}</label><span className="flex shrink-0 items-center gap-1 text-xs tabular-nums">
    <input aria-label={`${label}・数値で入力`} type="number" min={min} max={max} step={step} value={empty ? '' : Number(value.toFixed(6))}
      onBlur={() => setEmpty(false)} onChange={e => { setEmpty(e.target.value === ''); const n = e.target.valueAsNumber; if (Number.isFinite(n)) onChange(clamp(n)); }}
      className="w-20 rounded-lg border border-mirai-border bg-card px-2 py-1 text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />{unit}</span></div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => { setEmpty(false); onChange(e.target.valueAsNumber); }} className="policy-range w-full" />
  </div>;
}
const PolicyControl = memo(function PolicyControl({ policy, amount, consumptionTaxMax, socialInsuranceMax, onPowerSettings, onAmount, onPolicyKind, onPolicyDuration }: {
  policy: Policy; amount: number; consumptionTaxMax: number; socialInsuranceMax: number;
  onPowerSettings: () => void;
  onAmount: (id: string, n: number) => void;
  onPolicyKind: (id: string, kind: PolicyKind) => void;
  onPolicyDuration: (id: string, duration: number) => void;
}) {
  const revenue = personalTaxRevenue(policy.id);
  const max = policy.id === 'consumption-tax' ? consumptionTaxMax : policy.id === 'social-insurance' ? socialInsuranceMax : revenue ? Math.floor(revenue.amount / 1e11) / 10 : 100;
  return <div key={policy.id} className="space-y-2 rounded-xl border border-mirai-border p-3">
    <RangeField label={policy.name} value={Math.min(amount, max)} min={0} max={max} step={.1} unit="兆円/年" onChange={n => onAmount(policy.id, n)} />
    {policy.id === 'generation' && <button type="button" aria-haspopup="dialog" className="text-sm text-primary-accent underline" onClick={onPowerSettings}>電源構成・稼働時期を設定</button>}
    <label className="block space-y-1 text-xs"><span>継続方法</span><select aria-label={`${policy.name}・継続方法`} className={fieldClass} value={policy.kind} onChange={e => onPolicyKind(policy.id, e.target.value as PolicyKind)}>
      {Object.entries(KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    {policy.kind === 'permanent' ? <p className="text-xs text-mirai-text-subtle">評価期間中、毎年継続します。</p> :
      <label className="flex items-center justify-between gap-2 text-xs"><span>支出期間</span><span className="flex items-center gap-1">
        <input aria-label={`${policy.name}・支出期間・数値で入力`} className="w-20 rounded-lg border border-mirai-border bg-card px-2 py-1 text-right tabular-nums" type="number" min={1} max={10} step={1} value={policy.duration}
          onChange={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) onPolicyDuration(policy.id, Math.max(1, Math.min(10, Math.round(n)))); }} />年</span></label>}
    {(policy.id === 'social-insurance' || revenue) && <details className="text-xs text-mirai-text-subtle">
      <summary className="cursor-pointer font-medium">入力上限・計算の前提</summary>
      <div className="mt-2 space-y-2">
    {policy.id === 'social-insurance' && <p className="mt-1 text-xs leading-relaxed text-mirai-text-subtle">本人・事業主の双方を軽減します。この政策の年額を両者に分け、配分と就労反応は「乗数・労働反応の条件」で変更できます。</p>}
    {policy.id === 'social-insurance' && <p className="text-xs leading-relaxed text-mirai-text-subtle">現在の配分での入力上限：{money(socialInsuranceMax * 1e12, 1)}／年（0.1兆円単位で切下げ）。<a className="underline" href={SOCIAL_INSURANCE_REVENUE.sourceUrl} target="_blank" rel="noreferrer">2024年度の保険料収入</a>は計{money(SOCIAL_INSURANCE_REVENUE.total)}、本人{money(SOCIAL_INSURANCE_REVENUE.insured)}・事業主{money(SOCIAL_INSURANCE_REVENUE.employer)}。各側の収入を超えない額を上限とし、評価期間中はこの収入基準を固定します。</p>}
    {revenue && <p className="text-xs leading-relaxed text-mirai-text-subtle">入力上限：{money(max * 1e12, 1)}／年。<a className="underline" href={revenue.sourceUrl} target="_blank" rel="noreferrer">2024年度の{revenue.label}の税収</a>を限度とし、0.1兆円単位で切り下げます。{'municipalSourceUrl' in revenue && <><a className="underline" href={revenue.municipalSourceUrl} target="_blank" rel="noreferrer">市町村分の出典</a>。</>}{revenue.scope}評価期間中はこの基準額を固定します。税額を超える分は「現金給付」に入力してください。</p>}
    {policy.id === 'resident-tax' && <p className="mt-1 text-xs leading-relaxed text-mirai-text-subtle">個人住民税の所得に比例する軽減を仮定。入力は年間減収額です。所得税減税の乗数・就労反応を代用し、地方を含む一般政府の税収減として計上します。均等割・徴収時期・自治体別の財政は未推計です。</p>}
      </div>
    </details>}
  </div>;
});
export function Controls({ consumptionTaxMax = 35, socialInsuranceMax, policies, amounts, total, horizon, maxHorizon = 5, rateShock, energyShock, reserve, thresholds, definitions, gap, inflation, construction, firmCapacity,
  structuralUnemployment, headline, onPreset, onClose,
  onPowerSettings, onCalibrationSettings, onSupplySettings, onAmount, onPolicyKind, onPolicyDuration, onHorizon, onRateShock, onEnergyShock, onReserve, onThreshold, onGap, onInflation, onConstruction, onFirmCapacity, onReset }: {
  consumptionTaxMax?: number; socialInsuranceMax: number; policies: Policy[]; amounts: Record<string, number>; total: number; horizon: number; maxHorizon?: number;
  rateShock: number; energyShock: number; reserve: number; thresholds: Thresholds; definitions: ConstraintDefinition[];
  gap: number; inflation: number; construction: number; firmCapacity: number;
  structuralUnemployment: number; headline?: string; onPreset: () => void; onClose?: () => void;
  onPowerSettings: () => void;
  onCalibrationSettings: () => void;
  onSupplySettings: () => void;
  onAmount: (id: string, n: number) => void; onPolicyDuration: (id: string, n: number) => void;
  onPolicyKind: (id: string, v: PolicyKind) => void; onHorizon: (n: number) => void; onRateShock: (n: number) => void; onEnergyShock: (n: number) => void;
  onReserve: (n: number) => void; onThreshold: (id: keyof Thresholds, n: number) => void;
  onGap: (n: number) => void; onInflation: (n: number) => void; onConstruction: (n: number) => void; onFirmCapacity: (n: number) => void; onReset: () => void;
}) {
  const policyField = (policy: Policy) => <PolicyControl key={policy.id} policy={policy} amount={amounts[policy.id] ?? 0} consumptionTaxMax={consumptionTaxMax} socialInsuranceMax={socialInsuranceMax} onPowerSettings={onPowerSettings} onAmount={onAmount} onPolicyKind={onPolicyKind} onPolicyDuration={onPolicyDuration} />;
  const economyDialog = useRef<HTMLDialogElement>(null);
  const economyTitle = useId();
  const [advancedOpen, setAdvancedOpen] = usePersistedOpen(DETAILS_KEY);
  const floor = permittedUnemploymentFloor(structuralUnemployment, thresholds.labour);
  const thresholdInput = (d: ConstraintDefinition) => {
    const [min, max] = THRESHOLD_BOUNDS[d.id];
    if (d.id === 'labour') {
      // The editable quantity is the permitted unemployment floor; the stored threshold is u*/floor.
      const floorMin = structuralUnemployment / max, floorMax = structuralUnemployment / min;
      return <label key={d.id} className="block text-xs">{d.label}：許容する失業率の下限（%）<input className={`${fieldClass} mt-1`} type="number" min={Number((floorMin * 100).toFixed(2))} max={Number((floorMax * 100).toFixed(2))} step={.1} value={Number((floor * 100).toFixed(2))}
        onChange={e => { const n = e.target.valueAsNumber / 100; if (Number.isFinite(n) && n > 0) onThreshold('labour', Math.min(max, Math.max(min, structuralUnemployment / n))); }} />
        <span className="mt-1 block text-mirai-text-subtle">構造的失業率{(structuralUnemployment * 100).toFixed(1)}%（仮定）を下回れる幅。上限比 {thresholds.labour.toFixed(2)}。</span></label>;
    }
    return <label key={d.id} className="block text-xs">{d.label} 上限（%）<input className={`${fieldClass} mt-1`} type="number" min={Number((min * 100).toFixed(2))} max={Number((max * 100).toFixed(2))} step={.1} value={Number((thresholds[d.id] * 100).toFixed(3))}
      onChange={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n) && n > 0) onThreshold(d.id, Math.min(max, Math.max(min, n / 100))); }} />
      <span className="mt-1 block text-mirai-text-subtle">入力範囲 {(min * 100).toFixed(1)}〜{(max * 100).toFixed(0)}%（共有URLも同じ範囲）</span></label>;
  };
  return <Card role="region" aria-label="政策の操作パネル" tabIndex={0} className="max-h-[35dvh] overflow-y-auto overscroll-contain lg:max-h-[calc(100dvh-2rem)]">
    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-mirai-border bg-card px-4 py-2 text-xs lg:hidden">
      <span className="min-w-0 truncate tabular-nums" data-testid="controls-headline">{headline ?? '計算中'}</span>
      {onClose && <Button variant="ghost" size="sm" aria-label="政策パネルを閉じる" onClick={onClose}><X aria-hidden="true" /></Button>}
    </div>
    <CardHeader><h2 className="text-lg font-bold">政策を積み上げる</h2><p className="text-xs leading-relaxed text-mirai-text-subtle">各政策の年間追加額を入力すると合計に反映します。ひとつの政策を変えても、ほかの政策の金額は変わりません。</p></CardHeader>
    <CardContent className="space-y-5">
      <section aria-label="結論を動かす条件" data-testid="decisive-conditions" className="space-y-3 rounded-xl border border-mirai-border p-3">
        <h3 className="text-sm font-bold">結論を動かす条件</h3>
        <p className="text-xs text-mirai-text-subtle">参考上限を実際に動かすのは、ほぼこの4つです。ほかの条件は下の詳細で変更できます。</p>
        <RangeField label="CPI許容上限" value={thresholds.inflation * 100} min={THRESHOLD_BOUNDS.inflation[0] * 100} max={THRESHOLD_BOUNDS.inflation[1] * 100} step={.1} unit="%" onChange={n => onThreshold('inflation', n / 100)} />
        <RangeField label="許容する失業率の下限" value={Number((floor * 100).toFixed(2))} min={Number((structuralUnemployment / THRESHOLD_BOUNDS.labour[1] * 100).toFixed(2))} max={Number((structuralUnemployment / THRESHOLD_BOUNDS.labour[0] * 100).toFixed(2))} step={.05} unit="%" onChange={n => onThreshold('labour', Math.min(THRESHOLD_BOUNDS.labour[1], Math.max(THRESHOLD_BOUNDS.labour[0], structuralUnemployment / (n / 100))))} />
        <RangeField label="潜在GDPギャップ（年0）" value={gap} min={-10} max={3} step={.1} unit="%" onChange={onGap} />
        <Button variant="outline" size="sm" className="w-full" onClick={onPreset}>例：社会保険料減税中心の15兆円配分</Button>
      </section>
      <div className="rounded-xl bg-primary/10 p-3"><p className="text-sm font-medium">追加予算（年額）</p><output data-testid="annual-total" aria-label="追加予算（年額）" className="mt-1 block text-2xl font-bold tabular-nums">{money(total * 1e12, 1)}</output><p className="mt-1 text-xs text-mirai-text-subtle">減税・社会保険料軽減と追加支出の年額合計。実際の年別費用は継続方法・期間に従います。</p></div>
      <Button variant="outline" className="w-full" onClick={onReset}>初期条件に戻す</Button>
      <div className="space-y-4">
        {[...policies.filter(p => p.id === 'social-insurance'), ...policies.filter(p => p.id !== 'social-insurance')].map(policyField)}
        {total === 0 && <p role="status" className="text-sm">政策の追加額は0円です。金額を入力すると、その構成の条件付き参考額を計算します。</p>}
      </div>
      <details className="border-t border-mirai-border pt-4" open={advancedOpen} onToggle={e => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm font-bold">詳細な条件</summary>
        <div className="mt-3 space-y-3">
          <Button variant="outline" className="w-full" aria-haspopup="dialog" onClick={() => economyDialog.current?.showModal()}>経済状態・評価条件を変える</Button>
          <Button variant="outline" className="w-full" aria-haspopup="dialog" onClick={onCalibrationSettings}>乗数・労働反応の条件</Button>
          <Button variant="outline" className="w-full" aria-haspopup="dialog" onClick={onSupplySettings}>政策別の供給力・長期条件</Button>
        </div>
      </details>
    </CardContent>
    <dialog ref={economyDialog} aria-labelledby={economyTitle}
      onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }}
      className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-2xl border border-mirai-border bg-card p-0 text-mirai-text backdrop:bg-foreground/30">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-mirai-border bg-card p-4">
        <h2 id={economyTitle} className="text-lg font-bold">経済状態・評価条件</h2>
        <Button variant="ghost" size="icon" aria-label="経済状態・評価条件を閉じる" onClick={() => economyDialog.current?.close()}><X aria-hidden="true" /></Button>
      </div>
      <div className="space-y-4 p-3 sm:p-5">
        <p className="text-sm">変更はすぐに計算へ反映されます。</p>
        <p className="text-xs leading-relaxed">年0は選択したデータの初期状態。GDPギャップは（実際−潜在）÷潜在。マイナスが需要不足、プラスが需要超過で、公表値と同じ符号です。建設利用率と確実電力供給は仮定です。</p>
        <RangeField label="潜在GDPギャップ（年0）" value={gap} min={-10} max={3} step={.1} unit="%" onChange={onGap} />
        <RangeField label="CPI総合・初期インフレ率（年0）" value={inflation} min={-3} max={10} step={.1} unit="%" onChange={onInflation} />
        <p className="text-xs leading-relaxed">CPIの変更は初期インフレ率に反映します。将来の基準物価にはGDPギャップ感度も加わります。「乗数・労働反応の条件」で変更できます。</p>
        <RangeField label="建設利用率（年0）" value={construction} min={70} max={100} unit="%" onChange={onConstruction} />
        <RangeField label="確実電力供給（年0）" value={firmCapacity} min={170} max={250} unit="GW" onChange={onFirmCapacity} />
        <label className="block space-y-2 text-sm"><span>制約の評価期間</span><select aria-label="制約の評価期間" className={fieldClass} value={horizon} onChange={e => onHorizon(Number(e.target.value))}>{[1, 3, 5].filter(n => n <= maxHorizon).map(n => <option key={n} value={n}>{n}年間</option>)}</select></label>
        <RangeField label="借換金利の外生ショック" value={rateShock / 100} min={0} max={3} unit="%" onChange={n => onRateShock(n * 100)} />
        <p className="text-xs">借換金利は基準金利＋公表モデルの政策反応＋外生ショックです。外生ショックは資金調達条件のみの感度で、追加の金融政策によるGDP・CPI反応は未推計です。</p>
        <RangeField label="輸入エネルギー価格ショック" value={energyShock} min={0} max={100} step={10} unit="%" onChange={onEnergyShock} />
        <RangeField label="任意の定率控除" value={reserve} min={0} max={50} step={5} unit="%" onChange={onReserve} />
        <p className="text-xs leading-relaxed">以下は政策判断のための仮の許容閾値です。科学的な危険ラインではありません。各指標がこの割合を超えると違反とします。</p>
        {definitions.map(thresholdInput)}
        <Button variant="outline" onClick={() => economyDialog.current?.close()}>設定を閉じて結果を見る</Button>
      </div>
    </dialog>
  </Card>;
}
