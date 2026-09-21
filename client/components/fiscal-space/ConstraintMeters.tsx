import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ConstraintResult } from '@/types/fiscal-space';
import { CONSTRAINTS } from '@/app/lib/fiscal-space/constraints';
import { permittedUnemploymentFloor } from '@/app/lib/fiscal-space/assumptions';
import { percent, points } from './format';
import { FiscalVintageBadge } from './ResultAssumptions';

const ORDER = CONSTRAINTS.map(c => c.id);
const HATCH = { backgroundImage: 'repeating-linear-gradient(45deg, var(--mirai-border) 0 4px, transparent 4px 8px)' };

/** One hue, darker when closer to the ceiling. These are threshold utilizations of assumed
 * ceilings, not risk probabilities, so traffic-light colours are deliberately avoided. */
function barClass(r: ConstraintResult) {
  if (r.status === 'unevaluated') return 'bg-transparent';
  if (r.status === 'violated') return 'bg-mirai-text';
  return r.utilization >= .8 ? 'bg-primary' : 'bg-primary/50';
}

export function ConstraintMeters({ constraints, baseline = [], sensitivity, latest, structuralUnemployment }: {
  constraints: ConstraintResult[]; baseline?: ConstraintResult[];
  sensitivity: { id: string; delta: number | null }[];
  latest: boolean; structuralUnemployment: number;
}) {
  const [bySensitivity, setBySensitivity] = useState(false);
  const delta = (id: string) => sensitivity.find(s => s.id === id)?.delta ?? null;
  const incomplete = (r: ConstraintResult) => r.coverageComplete === false || r.status === 'unevaluated';
  // Fixed definition order by default: rows must not move while a slider is being dragged.
  const rows = [...constraints].sort((a, b) => bySensitivity
    ? (delta(b.id) ?? -Infinity) - (delta(a.id) ?? -Infinity)
    : ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  return <Card><CardHeader>
    <h2 className="text-lg font-bold">次の1兆円で、どの制約が動く？</h2>
    <p className="text-sm">同じ配分・期間で年額を1兆円増やしたときの、期間内ピーク利用率の変化です。境界までの金額や厳密な微分ではありません。バーは現在の水準、縦線100%は設定した許容閾値。閾値は仮定で、色の濃さは危険確率ではありません。</p>
    <p className="text-xs">年1以降の将来経路だけを比較します。年0は観測値として別表示します。配分未入力・減税や社会保険料の軽減限度にかかる場合は感応度を計算できません。追加負荷を評価できていない制約は斜線で表示し、余裕とは扱いません。</p>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={bySensitivity} onChange={e => setBySensitivity(e.target.checked)} />感応度の大きい順に並べる（操作中は行が動きます）</label>
  </CardHeader><CardContent className="space-y-4">
    {rows.map(r => {
      const unevaluated = incomplete(r);
      const label = r.status === 'violated' ? '閾値違反' : unevaluated ? '未評価' : r.utilization >= .8 ? '上限に近い・設定内' : '設定内';
      const base = baseline.find(b => b.id === r.id);
      const change = delta(r.id);
      const over = Number.isFinite(r.utilization) && r.utilization > 1.2;
      return <div key={r.id} className="space-y-1" data-constraint={r.id} data-status={unevaluated ? 'unevaluated' : r.status}>
        <div className="flex justify-between gap-2 text-sm"><strong>{r.id === 'energy' ? '電力需給（需要 ÷ 供給）' : r.label}<span className="ml-2 rounded bg-mirai-surface-warm px-1 text-xs font-normal">{['capacity', 'sector', 'energy', 'labour'].includes(r.id) ? '実物・供給' : r.id === 'inflation' ? '物価' : r.id === 'external' ? '対外' : '財政'}</span></strong><span className={r.status === 'violated' ? 'font-bold' : ''}>{label}</span></div>
        {unevaluated
          ? <p className="text-sm">追加負荷は未評価。{r.status === 'violated' && `既知の負荷だけでも閾値違反（年${r.year}）。`}負荷係数が不足しているため、この制約は余裕としても違反としても扱いません。</p>
          : <p className="text-sm font-medium">{change === null ? '追加1兆円の感応度：未計算' : Math.abs(change) < 1e-10
            ? '追加1兆円：ピーク利用率はこの配分では動かない'
            : `追加1兆円：${points(change)} / 兆円${Math.abs(change) < .000005 ? '（表示桁未満の変化）' : ''}`}</p>}
        <div className="flex items-center gap-2">
          <div role="meter" aria-label={`${r.label}の閾値利用率`} aria-valuemin={0} aria-valuemax={120}
            aria-valuenow={Math.min(120, Math.max(0, Number.isFinite(r.utilization) ? r.utilization * 100 : 120))}
            aria-valuetext={`${percent(r.utilization)}・${label}・年${r.year}`}
            className={`relative h-3 flex-1 bg-mirai-surface-warm ${r.status === 'violated' ? 'outline outline-2 outline-mirai-text' : ''}`}>
            <div className={`h-full ${barClass(r)}`} style={{ width: `${Math.min(100, Math.max(0, Number.isFinite(r.utilization) ? r.utilization / 1.2 * 100 : 100))}%`, ...(unevaluated ? HATCH : {}) }} />
            <span aria-hidden="true" className="absolute top-0 h-3 border-l-2 border-mirai-text" style={{ left: `${100 / 1.2}%` }} />
          </div>
          {over && <span className="shrink-0 text-xs font-bold tabular-nums" aria-hidden="true">▶ 実測 {percent(r.utilization)}</span>}
        </div>
        <p className="text-sm">年{r.year}・計算値{percent(r.currentValue)} / 閾値{percent(r.threshold)}。
          {base && ` 政策なしのピークとの差 ${points(r.utilization - base.utilization)}。`}
          {r.year === 0 && ' ピークは政策実施前です。将来の変化がないという意味ではありません。'}
          {over && ' バーは120%で止めています。実測値は右のテキストと読み上げ値を参照。'}
        </p>
        {['debt', 'interestGdp', 'gfn'].includes(r.id) && <FiscalVintageBadge latest={latest} projected={r.year > 0} />}
        {r.id === 'labour' && <p className="text-xs">構造的失業率{percent(structuralUnemployment, 1)}÷失業率。上限{r.threshold.toFixed(2)}は失業率が{percent(permittedUnemploymentFloor(structuralUnemployment, r.threshold), 2)}を下回らないという許容条件です。構造的失業率は推定値ではなく仮定で、「乗数・税収・労働反応の条件」で変更できます。</p>}
        {r.id === 'energy' && <p className="text-xs">数値が高いほど電力の余裕が少ない状態です。発電投資は稼働開始後に供給を増やします。バーは期間内で最も厳しい年の値なので、その後の改善は年ごとの表で確認してください。</p>}
        {r.id === 'debt' && <p className="text-xs">280%という既定閾値は出典のある持続可能性基準ではありません。この期間で境界に達しないことは、長期の債務持続性の検証にはなりません。</p>}
        <details><summary className="cursor-pointer text-sm text-primary-accent">なぜ？ 計算根拠を見る</summary><p className="mt-2 text-sm">{r.explanation}</p></details>
      </div>;
    })}
  </CardContent></Card>;
}
