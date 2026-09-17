'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { policyCostYen, policyInputLimitYen, totalPolicyCostYen } from '@/client/lib/fiscal-space-amounts';
import { CalculationOverview } from '@/client/components/fiscal-space/CalculationOverview';
import { defaults, type FiscalForm } from '@/client/lib/fiscal-space-form';
import { ShareScenario } from '@/client/components/fiscal-space/ShareScenario';
import { useFiscalCalculation } from '@/client/hooks/useFiscalCalculation';
import { decodeScenarioDetailed, type ScenarioRestore } from '@/client/lib/fiscal-space-url';
import { money } from '@/client/components/fiscal-space/format';
import { LongRun, DurationSensitivity } from '@/client/components/fiscal-space/ScenarioConditions';
import { PolicyLoads } from '@/client/components/fiscal-space/PolicyLoads';
import { ResourceEstimation } from '@/client/components/fiscal-space/ResourceEstimation';
import { Demographics } from '@/client/components/fiscal-space/Demographics';
import { consumptionTaxLimit } from '@/app/lib/fiscal-space/calibration';
import { ClipboardCheck, Info, SlidersHorizontal, X } from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { Button } from '@/components/ui/button';
import { POLICIES, TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { CONSTRAINTS } from '@/app/lib/fiscal-space/constraints';
import { Controls } from '@/client/components/fiscal-space/Controls';
import { Summary } from '@/client/components/fiscal-space/Summary';
import { Comparison } from '@/client/components/fiscal-space/Comparison';
import { Projection } from '@/client/components/fiscal-space/Projection';
import { Explanations, JapanBaseline } from '@/client/components/fiscal-space/Assumptions';
import { Calibration } from '@/client/components/fiscal-space/Calibration';
import { BurdenIndicators } from '@/client/components/fiscal-space/BurdenIndicators';
import { PolicyTrade } from '@/client/components/fiscal-space/PolicyTrade';
import { PowerMix } from '@/client/components/fiscal-space/PowerMix';
import { ElectricityBaseline } from '@/client/components/fiscal-space/ElectricityBaseline';
import { REFERENCES } from '@/app/lib/fiscal-space/calibration';
import { EXTENDED_HORIZON } from '@/client/lib/fiscal-space-engine';
import type { StressId } from '@/app/lib/fiscal-space/stress-envelope';
import { SupplyConditions } from '@/client/components/fiscal-space/SupplyConditions';
import type { PolicyKind, Thresholds } from '@/types/fiscal-space';


const MemoExplanations = memo(Explanations);
const MemoComparison = memo(Comparison);
const MemoProjection = memo(Projection);
const MemoControls = memo(Controls);
const MemoSummary = memo(Summary);
const MemoLongRun = memo(LongRun);
const MemoDurationSensitivity = memo(DurationSensitivity);
const MemoJapanBaseline = memo(JapanBaseline);
const MemoBurdenIndicators = memo(BurdenIndicators);
const MemoCalibration = memo(Calibration);
const MemoSupplyConditions = memo(SupplyConditions);
const MemoElectricityBaseline = memo(ElectricityBaseline);
const MemoPowerMix = memo(PowerMix);
const MemoPolicyLoads = memo(PolicyLoads);
const MemoPolicyTrade = memo(PolicyTrade);
const MemoResourceEstimation = memo(ResourceEstimation);
const MemoDemographics = memo(Demographics);

export default function FiscalSpacePage() {
  const [form, setForm] = useState(() => defaults());
  const [shareError, setShareError] = useState('');
  const [restore, setRestore] = useState<ScenarioRestore | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const dataDialog = useRef<HTMLDialogElement>(null);
  const powerDialog = useRef<HTMLDialogElement>(null);
  const calibrationDialog = useRef<HTMLDialogElement>(null);
  const supplyDialog = useRef<HTMLDialogElement>(null);
  const openPowerSettings = useCallback(() => powerDialog.current?.showModal(), []);
  const openCalibrationSettings = useCallback(() => calibrationDialog.current?.showModal(), []);
  const openSupplySettings = useCallback(() => supplyDialog.current?.showModal(), []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { completed, error, pending, retry } = useFiscalCalculation(form);
  useEffect(() => {
    const restore = () => {
      try {
        if (window.location.hash.startsWith('#scenario=')) {
          const { form: restored, ...info } = decodeScenarioDetailed(window.location.hash);
          setForm(restored); setRestore(info);
        }
        setShareError('');
      } catch { setForm(defaults()); setRestore(null); setShareError('共有条件を復元できません。初期状態（既定の条件）で計算しています。以下の数値は送信者の条件ではありません。'); }
    };
    restore(); window.addEventListener('hashchange', restore);
    return () => window.removeEventListener('hashchange', restore);
  }, []);
  const update = useCallback(<K extends keyof FiscalForm>(key: K, value: FiscalForm[K]) =>
    setForm(f => Object.is(f[key], value) ? f : { ...f, [key]: value }), []);
  // Stable callbacks let unchanged controls skip rendering without retaining stale form values.
  const change = useMemo(() => ({
    amount: (id: string, n: number) => setForm(f => f.amounts[id] === n ? f : { ...f, amounts: { ...f.amounts, [id]: n } }),
    preset: (amounts: FiscalForm['amounts']) => update('amounts', amounts),
    kind: (id: string, kind: PolicyKind) => setForm(f => ({ ...f, policySettings: { ...f.policySettings, [id]: { ...f.policySettings[id], kind } } })),
    duration: (id: string, duration: number) => setForm(f => ({ ...f, policySettings: { ...f.policySettings, [id]: { ...f.policySettings[id], duration } } })),
    horizon: (n: number) => update('horizon', n), rate: (n: number) => update('rateShock', n), energy: (n: number) => update('energyShock', n),
    stress: (id: StressId, on: boolean) => setForm(f => f.stresses[id] === on ? f : { ...f, stresses: { ...f.stresses, [id]: on } }),
    gap: (n: number) => update('gap', n), inflation: (n: number) => update('inflation', n),
    construction: (n: number) => update('construction', n), firm: (n: number) => update('firmCapacity', n),
    threshold: (id: keyof Thresholds, n: number) => setForm(f => ({ ...f, thresholds: { ...f.thresholds, [id]: n } })),
    cpiLimit: (n: number) => setForm(f => ({ ...f, thresholds: { ...f.thresholds, inflation: n } })),
    inputs: (v: FiscalForm['inputs']) => update('inputs', v), longRun: (v: FiscalForm['longRun']) => update('longRun', v),
    calibration: (v: FiscalForm['calibration']) => setForm(f => ({ ...f, calibration: v, horizon: f.horizon === EXTENDED_HORIZON ? f.horizon : Math.min(f.horizon, REFERENCES[v.referenceModel].years),
      amounts: Object.fromEntries(Object.entries(f.amounts).map(([id, n]) => [id, policyCostYen(id, n, v) / TRILLION])) })),
    supply: (v: FiscalForm['supply']) => update('supply', v), corporate: (v: number) => update('corporateShare', v),
    electricity: (v: FiscalForm['calibration']['electricity']) => setForm(f => ({ ...f, calibration: { ...f.calibration, electricity: v } })),
    demographics: (v: FiscalForm['calibration']['demographics']) => setForm(f => ({ ...f, calibration: { ...f.calibration, demographics: v } })),
    trade: (v: FiscalForm['trade']) => update('trade', v),
    resource: (v: FiscalForm['resource']) => update('resource', v),
    power: (trade: FiscalForm['trade'], total: number) => setForm(f => ({ ...f, trade, amounts: { ...f.amounts, generation: total } })),
    load: (id: string, load: FiscalForm['loads'][string]) => setForm(f => ({ ...f, loads: { ...f.loads, [id]: load } })),
    reset: () => setForm(f => defaults(f.dataset)),
    dataset: (dataset: FiscalForm['dataset']) => setForm(f => {
      const base = defaults(dataset);
      return { ...f, dataset, gap: base.gap, inflation: base.inflation, construction: base.construction, firmCapacity: base.firmCapacity };
    }),
  }), [update]);
  const result = completed?.result;
  const calculationForm = completed?.form;
  const policies = useMemo(() => POLICIES.map(policy => ({ ...policy, ...form.policySettings[policy.id] })), [form.policySettings]);
  const loadedPolicies = useMemo(() => result?.allocated.map(policy => ({ ...policy, load: form.loads[policy.id] ?? policy.load })) ?? [], [result, form.loads]);

  const headline = result ? (result.estimate.status === 'unevaluated' ? '参考上限：算出不可' : `参考上限 ${money(result.estimate.recommendedEnvelope, 1)}／年・${result.estimate.constraints.find(c => c.status === 'violated')?.label ?? '境界未特定'}`) : undefined;
  return <div data-fiscal-space className="min-h-screen bg-background text-mirai-text [&_summary]:min-h-11 [&_summary]:py-2">
    <AppHeader current="/fiscal-space">
      <Button variant="outline" size="sm" className="border-mirai-border" onClick={() => { setDialogOpen(true); dataDialog.current?.showModal(); }}>
        <Info aria-hidden="true" />データについて
      </Button>
    </AppHeader>
    <main className="mx-auto max-w-screen-2xl space-y-5 px-3 pb-24 pt-5 lg:pb-10">
      <section className="rounded-2xl bg-mirai-gradient p-6 sm:p-8"><p className="mb-2 text-sm font-bold">財政余力（実物制約の条件比較）</p><h1 className="text-2xl font-bold tracking-normal sm:text-3xl">次の1兆円で、何が最初に足りなくなる？</h1><p className="mt-3 max-w-3xl text-sm leading-relaxed">債務持続性の判定ではありません。物価・労働・電力・産業能力の実物制約が、公表モデルの期間（最大5年）内でどこまで追加支出を許すかを条件付きで比較します。減税、公共投資、研究、エネルギーの使い道と期間を変えて、需要・物価・労働・輸入・借換のつながりを確かめます。</p></section>
      <ShareScenario form={form} onPreset={change.preset} error={shareError} restore={restore} />
      {shareError && <div role="alert" className="rounded-xl border-2 border-mirai-text bg-card p-4 text-sm"><p className="font-bold">共有条件を復元できませんでした。</p><p>{shareError}</p></div>}
      <div className="contents" data-testid="calculation-status" aria-live="polite">
        {pending && <div className="fixed right-3 top-[var(--app-header-h)] z-50 max-w-[calc(100vw-1.5rem)] rounded-xl border border-mirai-border bg-card p-3 text-sm shadow-lg lg:bottom-3 lg:top-auto">
          <p role="status">{result ? '入力を反映しています。結果は直前の条件です。' : '最初の計算を準備しています。政策額は入力できます。'}</p>
          <button type="button" className="mt-1 min-h-6 text-primary-accent underline" onClick={retry}>計算をやり直す</button>
        </div>}
      </div>
      {error && <div role="alert" className="rounded-xl border border-mirai-border bg-card p-4 text-sm">
        <p>{error === 'timeout' ? '計算の応答がないため停止しました。入力を保ったまま再試行できます。' : error === 'worker' ? '計算を読み込めませんでした。再試行してください。' : 'この条件は計算範囲を超えています。入力を調整して再試行してください。'}</p>
        {result && <p>下の結果は直前に計算できた条件です。</p>}
        <Button variant="outline" onClick={retry} className="mt-2">計算を再試行</Button>
      </div>}
      {result && <p role="status" aria-live="polite" className="sr-only">追加予算は年間{money(result.totalYen, 1)}。追加1兆円への感応度は制約の一覧を参照してください。</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-4 lg:z-10">
          <Button variant="outline" className="mb-2 w-full justify-between border-mirai-border bg-card shadow-soft lg:hidden"
            aria-expanded={controlsOpen} aria-controls="fiscal-policy-controls" onClick={() => setControlsOpen(open => !open)}>
            <span className="flex items-center gap-2"><SlidersHorizontal aria-hidden="true" />{controlsOpen ? '政策パネルを閉じる' : '政策を調整'}</span>
            <span className="tabular-nums">{(totalPolicyCostYen(form.amounts, form.calibration) / TRILLION).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}兆円/年</span>
          </Button>
          <div id="fiscal-policy-controls" className={controlsOpen ? 'block' : 'hidden lg:block'}
            onKeyDown={e => {
              if (e.key === 'Escape' && controlsOpen) {
                setControlsOpen(false);
                document.querySelector<HTMLButtonElement>('[aria-controls="fiscal-policy-controls"]')?.focus();
              }
            }}>
        <MemoControls
          structuralUnemployment={form.calibration.structuralUnemployment} headline={headline}
          onClose={() => setControlsOpen(false)}
          amounts={form.amounts} rateShock={form.rateShock} energyShock={form.energyShock} stresses={form.stresses} onStress={change.stress}
          thresholds={form.thresholds} gap={form.gap} inflation={form.inflation} construction={form.construction} firmCapacity={form.firmCapacity}
          consumptionTaxMax={consumptionTaxLimit(form.calibration) / TRILLION}
          socialInsuranceMax={policyInputLimitYen('social-insurance', form.calibration) / TRILLION}
          policies={policies} onPowerSettings={openPowerSettings} onCalibrationSettings={openCalibrationSettings} onSupplySettings={openSupplySettings}
          horizon={form.horizon === EXTENDED_HORIZON ? EXTENDED_HORIZON : Math.min(form.horizon, REFERENCES[form.calibration.referenceModel].years)}
          total={totalPolicyCostYen(form.amounts, form.calibration) / TRILLION}
          maxHorizon={REFERENCES[form.calibration.referenceModel].years}
          definitions={CONSTRAINTS}
          onAmount={change.amount} onHorizon={change.horizon} onPolicyKind={change.kind} onPolicyDuration={change.duration}
          onRateShock={change.rate} onEnergyShock={change.energy} onThreshold={change.threshold}
          onGap={change.gap} onInflation={change.inflation} onConstruction={change.construction} onFirmCapacity={change.firm} onReset={change.reset} />
          </div>
        </aside>
        <div className={`min-w-0 space-y-5 transition-opacity ${pending && result ? 'opacity-60' : ''}`} aria-busy={pending}>
        {pending && result && <p role="status" data-testid="recalculating" className="sticky top-[var(--app-header-h)] z-30 rounded-lg border border-mirai-border bg-card px-3 py-2 text-sm font-bold">再計算中。以下の数値は直前の条件です。</p>}
        {result && calculationForm ? <>
          <CalculationOverview result={result} latest={calculationForm.dataset === 'latest'} />
        </> : <p className="rounded-xl border border-mirai-border bg-card p-5">{error
          ? '入力を調整するか、上のボタンで計算を再試行してください。'
          : '政策を入力できます。計算結果を準備しています。'}</p>}
      {result && <>
      <MemoSummary estimate={result.estimate} horizon={result.horizon} riskAudit={result.riskAudit} longRun={result.longRun}
        rows={result.modelSensitivity} initial={result.initial}
        controlInputs={form.inputs} controlParameters={form.calibration} controlInflation={form.thresholds.inflation}
        onParameters={change.calibration} onInputs={change.inputs} onInflation={change.cpiLimit} />
      <MemoResourceEstimation result={result} value={form.resource} onChange={change.resource} />
      <MemoDurationSensitivity rows={result.durationSensitivity} />
      <MemoLongRun rows={result.longRun} value={form.longRun} onChange={change.longRun} />
      <MemoDemographics steps={result.projection.steps} baseline={result.baseline.steps} longRun={result.longRun} value={form.calibration.demographics} onChange={change.demographics} baseYear={result.initial.baseCalendarYear} />
      <MemoComparison rows={result.comparison} horizon={result.horizon} />
      </>}
      <h2 className="pt-4 text-xl font-bold">詳細条件・出典</h2>
      <MemoJapanBaseline dataset={form.dataset} onDataset={change.dataset} />
      <MemoBurdenIndicators latest={form.dataset === 'latest'} corporateShare={form.corporateShare} onCorporateShare={change.corporate} />
      {result && <>
      <MemoElectricityBaseline value={form.calibration.electricity} onChange={change.electricity} baseline={result.baseline} projection={result.projection} />
      <MemoPolicyLoads policies={loadedPolicies} onChange={change.load} />
      <MemoPolicyTrade policies={result.policies} value={form.trade} onChange={change.trade} />
      <MemoProjection simulation={result.projection} baseline={result.baseline} peaksByYear={result.peaksByYear} shocks={result.shocks} parameters={result.p} latest={calculationForm?.dataset === 'latest'} />
      </>}
        </div>
      </div>
    </main>
    <dialog ref={supplyDialog} aria-labelledby="supply-settings-title"
      className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-2xl border border-mirai-border bg-card p-0 text-mirai-text backdrop:bg-foreground/30">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-mirai-border bg-card p-4">
        <h2 id="supply-settings-title" className="text-lg font-bold">政策別の供給力・長期条件</h2>
        <Button variant="ghost" size="icon" aria-label="供給力・長期条件を閉じる" onClick={() => supplyDialog.current?.close()}><X aria-hidden="true" /></Button>
      </div>
      <div className="space-y-3 p-3 sm:p-5">
        <p className="text-sm">変更はすぐに計算へ反映されます。</p>
        <MemoSupplyConditions value={form.supply} onChange={change.supply} embedded />
        <Button variant="outline" onClick={() => supplyDialog.current?.close()}>設定を閉じて結果を見る</Button>
      </div>
    </dialog>
    <dialog ref={calibrationDialog} aria-labelledby="calibration-settings-title"
      className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-2xl border border-mirai-border bg-card p-0 text-mirai-text backdrop:bg-foreground/30">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-mirai-border bg-card p-4">
        <h2 id="calibration-settings-title" className="text-lg font-bold">乗数・労働反応の条件</h2>
        <Button variant="ghost" size="icon" aria-label="乗数・労働反応の設定を閉じる" onClick={() => calibrationDialog.current?.close()}><X aria-hidden="true" /></Button>
      </div>
      <div className="space-y-3 p-3 sm:p-5">
        <p className="text-sm">変更はすぐに計算へ反映されます。</p>
        <MemoCalibration value={form.calibration} onChange={change.calibration} embedded />
        <Button variant="outline" onClick={() => calibrationDialog.current?.close()}>設定を閉じて結果を見る</Button>
      </div>
    </dialog>
    <dialog ref={powerDialog} aria-labelledby="power-settings-title"
      className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-6xl overflow-y-auto rounded-2xl border border-mirai-border bg-card p-0 text-mirai-text backdrop:bg-foreground/30">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-mirai-border bg-card p-4">
        <h2 id="power-settings-title" className="text-lg font-bold">発電設備投資の設定</h2>
        <Button variant="ghost" size="icon" aria-label="電源設定を閉じる" onClick={() => powerDialog.current?.close()}><X aria-hidden="true" /></Button>
      </div>
      <div className="space-y-3 p-3 sm:p-5">
        <p className="text-sm">変更はすぐに政策の計算へ反映されます。発電投資の総額は政策欄の入力と連動しています。</p>
        <MemoPowerMix value={form.trade} total={form.amounts.generation ?? 0} onChange={change.power} />
        <Button variant="outline" onClick={() => powerDialog.current?.close()}>設定を閉じて結果を見る</Button>
      </div>
    </dialog>
    <dialog ref={dataDialog} aria-labelledby="fiscal-data-title" onClose={() => setDialogOpen(false)}
      className="max-h-[85vh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-3xl border border-mirai-border bg-card p-0 text-mirai-text backdrop:bg-foreground/30">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-mirai-border bg-card p-6">
        <h2 id="fiscal-data-title" className="flex items-center gap-2 text-lg font-bold">
          <ClipboardCheck aria-hidden="true" className="size-5 text-primary-accent" />データと計算条件
        </h2>
        <Button variant="ghost" size="icon" aria-label="計算条件を閉じる" onClick={() => dataDialog.current?.close()}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-5 p-3 text-sm leading-relaxed sm:p-6">
        {dialogOpen && result ? <>
          {(pending || error) && <p role="status">以下は直前に計算できた条件です。</p>}
          <MemoExplanations step={result.projection.steps[0]} parameters={result.p} policies={result.policies} records={result.records} />
        </> : <p>計算条件の詳細はデータ読み込み後に表示します。</p>}
        <Button variant="outline" onClick={() => dataDialog.current?.close()}>閉じる</Button>
      </div>
    </dialog>
  </div>;
}
