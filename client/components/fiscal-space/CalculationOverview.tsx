import { memo } from 'react';
import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
import { REFERENCES } from '@/app/lib/fiscal-space/calibration';
import { TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { InputOverview } from './ScenarioConditions';
import { ConstraintMeters } from './ConstraintMeters';
import { ResultAssumptions } from './ResultAssumptions';
import { CurrentMetrics, CapacityComparison } from './Projection';
import { FiscalExternal } from './FiscalExternal';

/** Only a completed calculation changes these views; editing a control must not redraw them. */
export const CalculationOverview = memo(function CalculationOverview({ result, latest }: { result: FiscalCalculation; latest: boolean }) {
  return <>
    <InputOverview total={result.totalYen} estimate={result.estimate} horizon={result.horizon} incomplete={result.constraints.some(x => x.coverageComplete === false)} projection={result.projection} baseline={result.baseline} policies={result.allocated} />
    <ConstraintMeters constraints={result.constraints} baseline={result.baselineConstraints} sensitivity={result.sensitivity} latest={latest} />
    <ResultAssumptions result={result} latest={latest} />
    <p className="text-sm">{latest ? '財政比率の試算は2024年の財政額と最新GDPを組み合わせた初期条件です。同時点の観測値ではありません。' : '財政の初期値は2024年で揃えています。'} 税収弾性値 {result.p.taxRevenueElasticity}・徴収ラグ {result.p.taxCollectionLag}年を仮定。社会保険料を含む収入全体に適用します。既定値1.7は国税の近年実績を参考にした仮定です。</p>
    <CurrentMetrics step={result.projection.steps[result.horizon - 1]} baseline={result.baseline.steps[result.horizon - 1]} publishedYears={REFERENCES[result.p.referenceModel].years} latest={latest} />
    <div className="rounded-xl border border-mirai-border bg-white p-4"><FiscalExternal rows={result.inputExternal} model={result.p.referenceModel} label={`入力中の政策 ${(result.totalYen / TRILLION).toFixed(1)}兆円 / 年`} /></div>
    <CapacityComparison initial={result.initial} production={result.projection.initial.production} />
  </>;
});
