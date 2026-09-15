'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { totalPolicyCostYen } from '@/client/lib/fiscal-space-amounts';
import { ResultAssumptions } from '@/client/components/fiscal-space/ResultAssumptions';
import { defaults } from '@/client/lib/fiscal-space-form';
import { ShareScenario } from '@/client/components/fiscal-space/ShareScenario';
import { useFiscalCalculation } from '@/client/hooks/useFiscalCalculation';
import { decodeScenario } from '@/client/lib/fiscal-space-url';
import { ModelSensitivity, InputOverview, LongRun, DurationSensitivity } from '@/client/components/fiscal-space/ScenarioConditions';
import { PolicyLoads } from '@/client/components/fiscal-space/PolicyLoads';
import { consumptionTaxLimit } from '@/app/lib/fiscal-space/calibration';
import { ClipboardCheck, Info, X } from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { Button } from '@/components/ui/button';
import { POLICIES, TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { CONSTRAINTS } from '@/app/lib/fiscal-space/constraints';
import { Controls } from '@/client/components/fiscal-space/Controls';
import { Summary } from '@/client/components/fiscal-space/Summary';
import { FiscalExternal } from '@/client/components/fiscal-space/FiscalExternal';
import { ConstraintMeters } from '@/client/components/fiscal-space/ConstraintMeters';
import { Comparison } from '@/client/components/fiscal-space/Comparison';
import { CapacityComparison, CurrentMetrics, Projection } from '@/client/components/fiscal-space/Projection';
import { Explanations, JapanBaseline } from '@/client/components/fiscal-space/Assumptions';
import { Calibration } from '@/client/components/fiscal-space/Calibration';
import { BurdenIndicators } from '@/client/components/fiscal-space/BurdenIndicators';
import { PolicyTrade } from '@/client/components/fiscal-space/PolicyTrade';
import { PowerMix } from '@/client/components/fiscal-space/PowerMix';
import { ElectricityBaseline } from '@/client/components/fiscal-space/ElectricityBaseline';
import { REFERENCES } from '@/app/lib/fiscal-space/calibration';
import { SupplyConditions } from '@/client/components/fiscal-space/SupplyConditions';
import type { Thresholds } from '@/types/fiscal-space';


const MemoExplanations = memo(Explanations);
const MemoComparison = memo(Comparison);
const MemoProjection = memo(Projection);

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
  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm(f => ({ ...f, [key]: value }));
  const result = completed?.result;
  const calculationForm = completed?.form;

  return <div data-fiscal-space className="min-h-screen bg-background text-mirai-text [&_summary]:min-h-6 [&_summary]:py-1">
    <AppHeader current="/fiscal-space">
      <Button variant="outline" size="sm" className="border-mirai-border" onClick={() => { setDialogOpen(true); dataDialog.current?.showModal(); }}>
        <Info aria-hidden="true" />データについて
      </Button>
    </AppHeader>
    <main className="mx-auto max-w-screen-2xl space-y-5 px-3 pb-10 pt-5">
      <section className="rounded-2xl bg-mirai-gradient p-6 sm:p-8"><p className="mb-2 text-sm font-bold">財政余力を考える</p><h1 className="text-2xl font-bold tracking-normal sm:text-3xl">次の1兆円で、何が最初に足りなくなる？</h1><p className="mt-3 max-w-3xl text-sm leading-relaxed">財政余力シミュレータ（試作）。減税、公共投資、研究、エネルギー。使い道と期間を変えて、需要・物価・労働・輸入・借換のつながりを確かめます。</p></section>
      <ShareScenario form={form} onPreset={amounts => setForm(f => ({ ...f, amounts }))} error={shareError} />
      <div className="min-h-10 text-sm" data-testid="calculation-status" aria-live="polite">
        {pending && <p role="status" className="rounded bg-mirai-surface-warm px-2 py-1">{result ? '入力を反映しています。結果は直前の条件です。' : '最初の計算を準備しています。政策額は入力できます。'}</p>}
      </div>
      {error && <div role="alert" className="rounded-xl border border-mirai-border bg-card p-4 text-sm">
        <p>{error === 'worker' ? '計算を読み込めませんでした。再試行してください。' : 'この条件は計算範囲を超えています。入力を調整して再試行してください。'}</p>
        {result && <p>下の結果は直前に計算できた条件です。</p>}
        <Button variant="outline" onClick={retry} className="mt-2">計算を再試行</Button>
      </div>}
      {result && <p role="status" aria-live="polite" className="sr-only">年間追加総額{result.totalYen / TRILLION}兆円。追加1兆円への感応度は制約の一覧を参照してください。</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Controls
          {...form}
          consumptionTaxMax={consumptionTaxLimit(form.calibration) / TRILLION}
          policies={POLICIES.map(policy => ({ ...policy, ...form.policySettings[policy.id] }))}
          horizon={Math.min(form.horizon, REFERENCES[form.calibration.referenceModel].years)}
          total={totalPolicyCostYen(form.amounts, form.calibration) / TRILLION}
          maxHorizon={REFERENCES[form.calibration.referenceModel].years}
          definitions={CONSTRAINTS}
          onAmount={(id, n) => setForm(f => ({ ...f, amounts: { ...f.amounts, [id]: n } }))}
          onHorizon={n => update('horizon', n)}
          onPolicyKind={(id, kind) => setForm(f => ({ ...f, policySettings: { ...f.policySettings, [id]: { ...f.policySettings[id], kind } } }))}
          onPolicyDuration={(id, duration) => setForm(f => ({ ...f, policySettings: { ...f.policySettings, [id]: { ...f.policySettings[id], duration } } }))}
          onRateShock={n => update('rateShock', n)} onEnergyShock={n => update('energyShock', n)} onReserve={n => update('reserve', n)}
          onThreshold={(id: keyof Thresholds, n) => setForm(f => ({ ...f, thresholds: { ...f.thresholds, [id]: n } }))}
          onGap={n => update('gap', n)} onInflation={n => update('inflation', n)} onConstruction={n => update('construction', n)} onFirmCapacity={n => update('firmCapacity', n)} onReset={() => setForm(defaults(form.dataset))} />
        {result && calculationForm ? <div className="min-w-0 space-y-5" aria-busy={pending}>
          <InputOverview total={result.totalYen} estimate={result.estimate} horizon={result.horizon} incomplete={result.constraints.some(x => x.coverageComplete === false)} projection={result.projection} baseline={result.baseline} policies={result.allocated} />
          <ConstraintMeters constraints={result.constraints} baseline={result.baselineConstraints} sensitivity={result.sensitivity} latest={calculationForm.dataset === 'latest'} />
          <ResultAssumptions result={result} latest={calculationForm.dataset === 'latest'} />
          <p className="text-sm">{calculationForm.dataset === 'latest' ? '財政比率の試算は2024年の財政額と最新GDPを組み合わせた初期条件です。同時点の観測値ではありません。' : '財政の初期値は2024年で揃えています。'} 税収弾性値 {result.p.taxRevenueElasticity}・徴収ラグ {result.p.taxCollectionLag}年を仮定。</p>
          <CurrentMetrics step={result.projection.steps[result.horizon - 1]} baseline={result.baseline.steps[result.horizon - 1]} publishedYears={REFERENCES[result.p.referenceModel].years} latest={calculationForm.dataset === 'latest'} />
          <div className="rounded-xl border border-mirai-border bg-white p-4"><FiscalExternal rows={result.inputExternal} model={result.p.referenceModel} label={`入力中の政策 ${(result.totalYen / TRILLION).toFixed(1)}兆円 / 年`} /></div>
          <CapacityComparison initial={result.initial} production={result.projection.initial.production} />
        </div> : <p className="rounded-xl border border-mirai-border bg-card p-5">{error
          ? '入力を調整するか、上のボタンで計算を再試行してください。'
          : '政策を入力できます。計算結果を準備しています。'}</p>}
      </div>
      {result && <>
      <Summary estimate={result.estimate} horizon={result.horizon} riskAudit={result.riskAudit} />
      <ModelSensitivity rows={result.modelSensitivity} horizon={result.horizon}
        controlInputs={form.inputs} controlParameters={form.calibration} controlInflation={form.thresholds.inflation}
        onParameters={v => update('calibration', v)} onInputs={v => update('inputs', v)} onInflation={n => update('thresholds', { ...form.thresholds, inflation: n })} />
      <DurationSensitivity rows={result.durationSensitivity} />
      <LongRun rows={result.longRun} value={form.longRun} onChange={v => update('longRun', v)} />
      <MemoComparison rows={result.comparison} horizon={result.horizon} />
      </>}
      <h2 className="pt-4 text-xl font-bold">詳細条件・出典</h2>
      <JapanBaseline dataset={form.dataset} onDataset={dataset => setForm(f => {
        const base = defaults(dataset);
        return { ...f, dataset, gap: base.gap, inflation: base.inflation,
          construction: base.construction, firmCapacity: base.firmCapacity };
      })} />
      <BurdenIndicators latest={form.dataset === 'latest'} corporateShare={form.corporateShare} onCorporateShare={value => update('corporateShare', value)} />
      <Calibration value={form.calibration} onChange={value => setForm(f => ({ ...f, calibration: { ...f.calibration, ...value }, horizon: Math.min(f.horizon, REFERENCES[value.referenceModel].years) }))} />
      <SupplyConditions value={form.supply} onChange={value => update('supply', value)} />
      {result && <>
      <ElectricityBaseline value={form.calibration.electricity} onChange={electricity => setForm(f => ({ ...f, calibration: { ...f.calibration, electricity } }))} baseline={result.baseline} projection={result.projection} />
      <PowerMix value={form.trade} total={form.amounts.generation ?? 0} onChange={(trade, total) => setForm(f => ({ ...f, trade, amounts: { ...f.amounts, generation: total } }))} />
      <PolicyLoads policies={result.allocated.map(policy => ({ ...policy, load: form.loads[policy.id] }))} onChange={(id, load) => update('loads', { ...form.loads, [id]: load })} />
      <PolicyTrade policies={result.policies} value={form.trade} onChange={value => update('trade', value)} />
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
