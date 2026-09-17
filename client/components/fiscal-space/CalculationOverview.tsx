import { memo } from 'react';
import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
import { REFERENCES } from '@/app/lib/fiscal-space/calibration';
import { TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { InputOverview } from './ScenarioConditions';
import { ConstraintMeters } from './ConstraintMeters';
import { ResultAssumptions } from './ResultAssumptions';
import { CurrentMetrics } from './Projection';
import { FiscalExternal } from './FiscalExternal';
import { PublicCapital } from './PublicCapital';
import { PowerTimeline } from './PowerTimeline';

/** Only a completed calculation changes these views; editing a control must not redraw them. */
export const CalculationOverview = memo(function CalculationOverview({ result, latest }: { result: FiscalCalculation; latest: boolean }) {
  return <>
    <InputOverview total={result.totalYen} estimate={result.estimate} riskAudit={result.riskAudit} horizon={result.horizon} incomplete={result.constraints.some(x => x.coverageComplete === false)} projection={result.projection} baseline={result.baseline} policies={result.allocated} />
    <CurrentMetrics step={result.projection.steps[result.horizon - 1]} baseline={result.baseline.steps[result.horizon - 1]} referenceModel={result.p.referenceModel} publishedYears={REFERENCES[result.p.referenceModel].years} latest={latest} />
    <PublicCapital result={result} />
    <ConstraintMeters constraints={result.constraints} baseline={result.baselineConstraints} sensitivity={result.sensitivity} latest={latest} structuralUnemployment={result.p.structuralUnemployment} />
    <PowerTimeline rows={result.powerTimeline} />
    <ResultAssumptions result={result} latest={latest} />
    <p className="text-sm">{latest ? '財政の初期値はIMFの2026年推計比率を最新GDPに掛けた橋渡し推計です。同時点の観測値ではありません。' : '財政の初期値は2024年で揃えています。'}</p>
    <div className="rounded-xl border border-mirai-border bg-white p-4"><FiscalExternal rows={result.inputExternal} model={result.p.referenceModel} label={`追加予算 ${(result.totalYen / TRILLION).toFixed(1)}兆円 / 年`} /></div>
  </>;
});
