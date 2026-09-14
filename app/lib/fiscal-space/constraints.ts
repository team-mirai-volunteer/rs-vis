import type { ConstraintDefinition, ConstraintResult, ProjectionStep, Simulation, Thresholds } from '@/types/fiscal-space';
import { SECTOR_LABELS } from './assumptions';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
export const CONSTRAINTS: ConstraintDefinition[] = [
  { id: 'debt', label: '債務経路', measure: s => s.metrics.grossDebtGdp,
    explain: s => `総債務÷名目GDP。有限期間の許容上限であり破綻判定ではありません。債務安定PBはGDP比${pct(s.metrics.stabilizingPrimaryBalance)}、実際のPBは${pct(s.metrics.primaryBalanceGdp)}。` },
  { id: 'interestGdp', label: '利払い / GDP', measure: s => s.metrics.interestGdp, explain: s => `固定クーポンと満期借換から算出。当年実効金利${pct(s.metrics.effectiveRate)}。` },
  { id: 'interestTax', label: '利払い / 税収', measure: s => s.metrics.interestTax, explain: () => '利払い÷政策減税後の税収。税収が0以下の場合は違反扱い。' },
  { id: 'gfn', label: '資金調達需要 / GDP', measure: s => s.metrics.gfnGdp, explain: () => '（基礎的赤字＋利払い＋当年満期元本）÷名目GDP。負値は資金余剰。SFAは別途借入に計上。' },
  { id: 'inflation', label: '物価', measure: s => s.state.macro.inflation,
    explain: s => `基準インフレ＋需要圧力＋輸入エネルギー価格＋前期インフレの持続。需要由来は${pct(s.inflationPressure)}ポイント。` },
  { id: 'capacity', label: '最大GDP能力', measure: s => s.state.macro.realGdp / s.production.maximum,
    explain: () => '実質GDP÷期間に応じた最大GDP。1年Leontief→5年CES→10年Cobb–Douglasの補間。' },
  { id: 'labour', label: '労働', measure: s => s.state.labour.employment / s.state.labour.labourForce,
    explain: () => '政策で必要となる雇用÷労働力。1を超える分は充足できない要求。労働力・参加率は試作では固定。' },
  { id: 'sector', label: '産業別能力', measure: s => Math.max(...Object.values(s.state.labour.sectorUtilization)),
    explain: s => {
      const sector = (Object.keys(s.state.labour.sectorUtilization) as (keyof typeof SECTOR_LABELS)[]).sort((a, b) => s.state.labour.sectorUtilization[b] - s.state.labour.sectorUtilization[a])[0];
      const current = s.state.labour.sectorUtilization[sector], extra = s.sectorDemand[sector];
      return `${SECTOR_LABELS[sector]}: 政策前${pct(current - extra)}＋追加要求${pct(extra)}＝${pct(current)}。物理的残余${pct(1 - current)}。追加要求=費用÷価格指数÷自律GDP×労働需要係数。`;
    } },
  { id: 'energy', label: '電力供給能力', measure: s => s.state.energy.peakDemand / s.state.energy.firmCapacity,
    explain: s => `ピーク${s.state.energy.peakDemand.toFixed(1)}GW÷確実供給${s.state.energy.firmCapacity.toFixed(1)}GW。予備率${pct(s.state.energy.reserveMargin)}。再エネ設備容量をそのまま供給能力に加えません。` },
  { id: 'external', label: '輸入圧力', measure: s => s.state.external.imports / s.state.macro.nominalGdp,
    explain: () => '財・サービス輸入費÷名目GDPを許容閾値と比較。第一次所得黒字で実物輸入制約を相殺しません。外貨調達可能性そのものの推定ではありません。' },
];
export function evaluateConstraints(step: ProjectionStep, thresholds: Thresholds, definitions = CONSTRAINTS): ConstraintResult[] {
  return definitions.map(d => {
    const threshold = thresholds[d.id];
    if (!Number.isFinite(threshold) || threshold <= 0) throw new RangeError(`Invalid threshold: ${d.id}`);
    const currentValue = d.measure(step), utilization = currentValue / threshold;
    return { id: d.id, label: d.label, year: step.state.year, currentValue, threshold, utilization,
      status: Number.isFinite(utilization) && utilization <= 1 ? 'safe' : 'violated', explanation: d.explain(step) };
  });
}
/** One peak observation per constraint, including year zero. Never average away a violation. */
export function peakConstraints(simulation: Simulation, thresholds: Thresholds): ConstraintResult[] {
  const peaks = new Map<string, ConstraintResult>();
  for (const step of [simulation.initial, ...simulation.steps]) for (const r of evaluateConstraints(step, thresholds)) {
    if (!peaks.has(r.id) || r.utilization > peaks.get(r.id)!.utilization) peaks.set(r.id, r);
  }
  return [...peaks.values()].sort((a, b) => b.utilization - a.utilization);
}
