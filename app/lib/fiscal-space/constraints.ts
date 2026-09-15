import type { ConstraintDefinition, ConstraintResult, ProjectionStep, Simulation, Thresholds } from '@/types/fiscal-space';
import { SECTOR_LABELS } from './assumptions';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
export const constraintInflation = (s: ProjectionStep) => Math.max(s.state.macro.inflation, s.taxAdjustedInflation ?? s.state.macro.inflation);
export const CONSTRAINTS: ConstraintDefinition[] = [
  { id: 'debt', label: '債務経路', measure: s => s.metrics.grossDebtGdp,
    explain: s => `総債務÷名目GDP。有限期間の許容上限であり破綻判定ではありません。債務安定PBはGDP比${pct(s.metrics.stabilizingPrimaryBalance)}、実際のPBは${pct(s.metrics.primaryBalanceGdp)}。` },
  { id: 'interestGdp', label: '利払い / GDP', measure: s => s.metrics.interestGdp, explain: s => `支払利子を固定クーポンと満期借換から算出。債務経路に用いる受取利子控除後の実効金利${pct(s.metrics.effectiveRate)}。` },
  { id: 'interestTax', label: '利払い / 税・社会負担収入', measure: s => s.metrics.interestTax, explain: () => '支払利子÷政策減税後の税・社会負担収入。分母が0以下の場合は違反扱い。' },
  { id: 'gfn', label: '資金調達需要 / GDP', measure: s => s.metrics.gfnGdp, explain: () => '（基礎的赤字＋支払利子−受取利子＋当年満期元本）÷名目GDP。負値は資金余剰。残高調整は別途借入に計上。' },
  { id: 'inflation', label: '物価', measure: constraintInflation,
    explain: s => `CPI総合${pct(s.state.macro.inflation)}、消費税直接効果を除くCPI${pct(s.taxAdjustedInflation ?? s.state.macro.inflation)}の両方を同じ上限で判定。税効果の分離とGDPギャップ感度は仮定。供給上限の追加圧力は${pct(s.inflationPressure)}。水準効果の年次比からインフレ率を計算。` },
  { id: 'capacity', label: '最大GDP能力', measure: s => s.state.macro.realGdp / s.production.maximum,
    explain: () => '実質GDP÷選択した生産モデルの最大GDP。全期間で同じモデルを使用。年数だけでモデルや投入指数を変えません。' },
  { id: 'labour', label: '就業者 / 労働力人口', measure: s => s.state.labour.employment / s.state.labour.labourForce,
    explain: () => '必要雇用÷労働力。公表モデルの人数の反応を使用。追加感度を設定すると本人の時間・参加、事業主の雇用需要も変化。時間増で同じ労働量を少ない人数で満たす近似。1超は充足できない要求。' },
  { id: 'sector', label: '産業別能力', measure: s => Math.max(...Object.values(s.state.labour.sectorUtilization)),
    explain: s => {
      const sector = (Object.keys(s.state.labour.sectorUtilization) as (keyof typeof SECTOR_LABELS)[]).sort((a, b) => s.state.labour.sectorUtilization[b] - s.state.labour.sectorUtilization[a])[0];
      const current = s.state.labour.sectorUtilization[sector], extra = s.sectorDemand[sector];
      return `${SECTOR_LABELS[sector]}: 初期設定${pct(current - extra)}、追加負荷${pct(extra)}。${s.estimatedLoads ? '2020年産業連関表・雇用表からの6区分の人員負荷概算を含みます。初期の余力・価格換算は仮定で、設備能力の推計ではありません。' : '追加負荷は政策別の原単位の仮定から計算。'}${s.coverage?.sector === false ? '負荷係数が未設定の政策があり一部未評価。' : ''}`;
    } },
  { id: 'energy', label: '電力供給能力', measure: s => s.resourcePower?.utilization ?? s.state.energy.peakDemand / s.state.energy.firmCapacity,
    explain: s => s.resourcePower ? `${s.resourcePower.referenceYear}年度見通し・${s.resourcePower.region}・${s.resourcePower.season}：需要${s.resourcePower.demandGw.toFixed(2)}GW÷供給${s.resourcePower.supplyGw.toFixed(2)}GW。地域・季節別の最大利用率。OCCTO公表の融通前供給力と追加負荷の概算。地域配分は仮定で、連系線融通・全月の最小余力は未評価。` : `ピーク${s.state.energy.peakDemand.toFixed(1)}GW÷確実供給${s.state.energy.firmCapacity.toFixed(1)}GW。予備率${pct(s.state.energy.reserveMargin)}。再エネ設備容量をそのまま供給能力に加えません。` },
  { id: 'external', label: '輸入圧力', measure: s => s.state.external.imports / s.state.macro.nominalGdp,
    explain: () => '財・サービス輸入費÷名目GDPを許容閾値と比較。第一次所得黒字で実物輸入制約を相殺しません。外貨調達可能性そのものの推定ではありません。' },
];
export function evaluateConstraints(step: ProjectionStep, thresholds: Thresholds, definitions = CONSTRAINTS): ConstraintResult[] {
  return definitions.map(d => {
    const threshold = thresholds[d.id];
    if (!Number.isFinite(threshold) || threshold <= 0) throw new RangeError(`Invalid threshold: ${d.id}`);
    const currentValue = d.measure(step), utilization = currentValue / threshold;
    return { id: d.id, label: d.label, year: step.state.year, currentValue, threshold, utilization,
      coverageComplete: !((d.id === 'sector' || d.id === 'energy') && step.coverage?.[d.id] === false),
      status: !Number.isFinite(utilization) || utilization > 1 ? 'violated' :
        ((d.id === 'sector' || d.id === 'energy') && step.coverage?.[d.id] === false) ? 'unevaluated' : 'safe',
      explanation: d.explain(step) + (d.id === 'energy' && step.coverage?.energy === false ? ' 政策による追加電力負荷は一部または全部が未評価です。' : '') };
  });
}
/** Policy years only. Year zero remains available as an observed initial condition. */
export function peakConstraints(simulation: Simulation, thresholds: Thresholds): ConstraintResult[] {
  const peaks = new Map<string, ConstraintResult>();
  const incomplete = new Set<string>();
  for (const step of simulation.steps) for (const r of evaluateConstraints(step, thresholds)) {
    if (r.coverageComplete === false) incomplete.add(r.id);
    const old = peaks.get(r.id);
    const priority = { safe: 0, unevaluated: 1, violated: 2 };
    if (!old || priority[r.status] > priority[old.status] || (priority[r.status] === priority[old.status] && r.utilization > old.utilization)) peaks.set(r.id, r);
  }
  return [...peaks.values()].map(r => ({ ...r, coverageComplete: !incomplete.has(r.id) }))
    .sort((a, b) => b.utilization - a.utilization);
}
