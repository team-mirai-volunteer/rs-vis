'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { policyCostYen, policyInputLimitYen, totalPolicyCostYen } from '@/client/lib/fiscal-space-amounts';
import { CalculationOverview } from '@/client/components/fiscal-space/CalculationOverview';
import { defaults, type FiscalForm } from '@/client/lib/fiscal-space-form';
import { ShareScenario } from '@/client/components/fiscal-space/ShareScenario';
import { useFiscalCalculation } from '@/client/hooks/useFiscalCalculation';
import { decodeScenario } from '@/client/lib/fiscal-space-url';
import { LongRun, DurationSensitivity } from '@/client/components/fiscal-space/ScenarioConditions';
import { PolicyLoads } from '@/client/components/fiscal-space/PolicyLoads';
import { consumptionTaxLimit } from '@/app/lib/fiscal-space/calibration';
import { ClipboardCheck, Info, X } from 'lucide-react';
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

export default function FiscalSpacePage() {
  const [form, setForm] = useState(() => defaults());
  const [shareError, setShareError] = useState('');
  const dataDialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { completed, error, pending, retry } = useFiscalCalculation(form);
  useEffect(() => {
    const restore = () => {
      try { if (window.location.hash.startsWith('#scenario=')) setForm(decodeScenario(window.location.hash)); setShareError(''); }
      catch { setForm(defaults()); setShareError('共有条件を復元できません。初期状態を表示しています。'); }
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
    reserve: (n: number) => update('reserve', n), gap: (n: number) => update('gap', n), inflation: (n: number) => update('inflation', n),
    construction: (n: number) => update('construction', n), firm: (n: number) => update('firmCapacity', n),
    threshold: (id: keyof Thresholds, n: number) => setForm(f => ({ ...f, thresholds: { ...f.thresholds, [id]: n } })),
    cpiLimit: (n: number) => setForm(f => ({ ...f, thresholds: { ...f.thresholds, inflation: n } })),
    inputs: (v: FiscalForm['inputs']) => update('inputs', v), longRun: (v: FiscalForm['longRun']) => update('longRun', v),
    calibration: (v: FiscalForm['calibration']) => setForm(f => ({ ...f, calibration: v, horizon: Math.min(f.horizon, REFERENCES[v.referenceModel].years),
      amounts: Object.fromEntries(Object.entries(f.amounts).map(([id, n]) => [id, policyCostYen(id, n, v) / TRILLION])) })),
    supply: (v: FiscalForm['supply']) => update('supply', v), corporate: (v: number) => update('corporateShare', v),
    electricity: (v: FiscalForm['calibration']['electricity']) => setForm(f => ({ ...f, calibration: { ...f.calibration, electricity: v } })),
    trade: (v: FiscalForm['trade']) => update('trade', v),
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
  const loadedPolicies = useMemo(() => result?.allocated.map(policy => ({ ...policy, load: form.loads[policy.id] })) ?? [], [result, form.loads]);

  return <div data-fiscal-space className="min-h-screen bg-background text-mirai-text [&_summary]:min-h-6 [&_summary]:py-1">
    <AppHeader current="/fiscal-space">
      <Button variant="outline" size="sm" className="border-mirai-border" onClick={() => { setDialogOpen(true); dataDialog.current?.showModal(); }}>
        <Info aria-hidden="true" />データについて
      </Button>
    </AppHeader>
    <main className="mx-auto max-w-screen-2xl space-y-5 px-3 pb-10 pt-5">
      <section className="rounded-2xl bg-mirai-gradient p-6 sm:p-8"><p className="mb-2 text-sm font-bold">財政余力を考える</p><h1 className="text-2xl font-bold tracking-normal sm:text-3xl">次の1兆円で、何が最初に足りなくなる？</h1><p className="mt-3 max-w-3xl text-sm leading-relaxed">財政余力シミュレータ（試作）。減税、公共投資、研究、エネルギー。使い道と期間を変えて、需要・物価・労働・輸入・借換のつながりを確かめます。</p></section>
      <ShareScenario form={form} onPreset={change.preset} error={shareError} />
      <div className="contents" data-testid="calculation-status" aria-live="polite">
        {pending && <div className="fixed bottom-3 right-3 z-50 max-w-[calc(100vw-1.5rem)] rounded-xl border border-mirai-border bg-card p-3 text-sm shadow-lg">
          <p role="status">{result ? '入力を反映しています。結果は直前の条件です。' : '最初の計算を準備しています。政策額は入力できます。'}</p>
          <button type="button" className="mt-1 min-h-6 text-primary-accent underline" onClick={retry}>計算をやり直す</button>
        </div>}
      </div>
      {error && <div role="alert" className="rounded-xl border border-mirai-border bg-card p-4 text-sm">
        <p>{error === 'timeout' ? '計算の応答がないため停止しました。入力を保ったまま再試行できます。' : error === 'worker' ? '計算を読み込めませんでした。再試行してください。' : 'この条件は計算範囲を超えています。入力を調整して再試行してください。'}</p>
        {result && <p>下の結果は直前に計算できた条件です。</p>}
        <Button variant="outline" onClick={retry} className="mt-2">計算を再試行</Button>
      </div>}
      {result && <p role="status" aria-live="polite" className="sr-only">追加予算は年間{result.totalYen / TRILLION}兆円。追加1兆円への感応度は制約の一覧を参照してください。</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <MemoControls
          amounts={form.amounts} rateShock={form.rateShock} energyShock={form.energyShock} reserve={form.reserve}
          thresholds={form.thresholds} gap={form.gap} inflation={form.inflation} construction={form.construction} firmCapacity={form.firmCapacity}
          consumptionTaxMax={consumptionTaxLimit(form.calibration) / TRILLION}
          socialInsuranceMax={policyInputLimitYen('social-insurance', form.calibration) / TRILLION}
          policies={policies}
          horizon={Math.min(form.horizon, REFERENCES[form.calibration.referenceModel].years)}
          total={totalPolicyCostYen(form.amounts, form.calibration) / TRILLION}
          maxHorizon={REFERENCES[form.calibration.referenceModel].years}
          definitions={CONSTRAINTS}
          onAmount={change.amount} onHorizon={change.horizon} onPolicyKind={change.kind} onPolicyDuration={change.duration}
          onRateShock={change.rate} onEnergyShock={change.energy} onReserve={change.reserve} onThreshold={change.threshold}
          onGap={change.gap} onInflation={change.inflation} onConstruction={change.construction} onFirmCapacity={change.firm} onReset={change.reset} />
        {result && calculationForm ? <div className="min-w-0 space-y-5" aria-busy={pending}>
          <CalculationOverview result={result} latest={calculationForm.dataset === 'latest'} />
        </div> : <p className="rounded-xl border border-mirai-border bg-card p-5">{error
          ? '入力を調整するか、上のボタンで計算を再試行してください。'
          : '政策を入力できます。計算結果を準備しています。'}</p>}
      </div>
      {result && <>
      <MemoSummary estimate={result.estimate} horizon={result.horizon} riskAudit={result.riskAudit}
        rows={result.modelSensitivity} initial={result.initial}
        controlInputs={form.inputs} controlParameters={form.calibration} controlInflation={form.thresholds.inflation}
        onParameters={change.calibration} onInputs={change.inputs} onInflation={change.cpiLimit} />
      <MemoDurationSensitivity rows={result.durationSensitivity} />
      <MemoLongRun rows={result.longRun} value={form.longRun} onChange={change.longRun} />
      <MemoComparison rows={result.comparison} horizon={result.horizon} />
      </>}
      <h2 className="pt-4 text-xl font-bold">詳細条件・出典</h2>
      <MemoJapanBaseline dataset={form.dataset} onDataset={change.dataset} />
      <MemoBurdenIndicators latest={form.dataset === 'latest'} corporateShare={form.corporateShare} onCorporateShare={change.corporate} />
      <MemoCalibration value={form.calibration} onChange={change.calibration} />
      <MemoSupplyConditions value={form.supply} onChange={change.supply} />
      {result && <>
      <MemoElectricityBaseline value={form.calibration.electricity} onChange={change.electricity} baseline={result.baseline} projection={result.projection} />
      <MemoPowerMix value={form.trade} total={form.amounts.generation ?? 0} onChange={change.power} />
      <MemoPolicyLoads policies={loadedPolicies} onChange={change.load} />
      <MemoPolicyTrade policies={result.policies} value={form.trade} onChange={change.trade} />
      <MemoProjection simulation={result.projection} baseline={result.baseline} peaksByYear={result.peaksByYear} shocks={result.shocks} parameters={result.p} latest={calculationForm?.dataset === 'latest'} />
      </>}
    </main>
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
