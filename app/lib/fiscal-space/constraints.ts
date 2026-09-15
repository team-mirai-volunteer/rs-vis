import type { ConstraintDefinition, ConstraintResult, ProjectionStep, Simulation, Thresholds } from '@/types/fiscal-space';
import { SECTOR_LABELS } from './assumptions';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
export const CONSTRAINTS: ConstraintDefinition[] = [
  { id: 'debt', label: '債務経路', measure: s => s.metrics.grossDebtGdp,
    explain: s => `総債務÷名目GDP。有限期間の許容上限であり破綻判定ではありません。債務安定PBはGDP比${pct(s.metrics.stabilizingPrimaryBalance)}、実際のPBは${pct(s.metrics.primaryBalanceGdp)}。` },
  { id: 'interestGdp', label: '利払い / GDP', measure: s => s.metrics.interestGdp, explain: s => `支払利子を固定クーポンと満期借換から算出。債務経路に用いる受取利子控除後の実効金利${pct(s.metrics.effectiveRate)}。` },
  { id: 'interestTax', label: '利払い / 税・社会負担収入', measure: s => s.metrics.interestTax, explain: () => '支払利子÷政策減税後の税・社会負担収入。分母が0以下の場合は違反扱い。' },
  { id: 'gfn', label: '資金調達需要 / GDP', measure: s => s.metrics.gfnGdp, explain: () => '（基礎的赤字＋支払利子−受取利子＋当年満期元本）÷名目GDP。負値は資金余剰。残高調整は別途借入に計上。' },
  { id: 'inflation', label: '物価', measure: s => s.state.macro.inflation,
    explain: s => `基準経路・輸入エネルギー価格・持続成分に、公表モデルの消費者物価水準の年次変化を反映。供給上限による追加圧力は${pct(s.inflationPressure)}相当。CPIとGDPデフレーターは別に計算。` },
  { id: 'capacity', label: '最大GDP能力', measure: s => s.state.macro.realGdp / s.production.maximum,
    explain: () => '実質GDP÷期間に応じた最大GDP。1年のレオンチェフ型→5年の代替弾力性一定型→10年のコブ＝ダグラス型を補間。' },
  { id: 'labour', label: '労働', measure: s => s.state.labour.employment / s.state.labour.labourForce,
    explain: () => '必要雇用÷労働力。公表モデルの人数の反応を使用。追加感度を設定すると本人の時間・参加、事業主の雇用需要も変化。時間増で同じ労働量を少ない人数で満たす近似。1超は充足できない要求。' },
  { id: 'sector', label: '産業別能力', measure: s => Math.max(...Object.values(s.state.labour.sectorUtilization)),
    explain: s => {
      const sector = (Object.keys(s.state.labour.sectorUtilization) as (keyof typeof SECTOR_LABELS)[]).sort((a, b) => s.state.labour.sectorUtilization[b] - s.state.labour.sectorUtilization[a])[0];
      const current = s.state.labour.sectorUtilization[sector], extra = s.sectorDemand[sector];
      return `${SECTOR_LABELS[sector]}: 初期設定${pct(current - extra)}。政策別の追加稼働は未同定のため加算していません。産業固有の不足を評価できる指標ではありません。`;
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
