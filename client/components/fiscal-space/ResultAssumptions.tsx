import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
import { percent } from './format';

export function FiscalVintageBadge({ latest, projected = false }: { latest: boolean; projected?: boolean }) {
  return <span className="mt-1 block rounded bg-mirai-surface-warm px-1 py-1 text-xs font-normal" data-testid="fiscal-vintage">
    {projected ? '試算の初期条件：' : '年0の比率：'}{latest ? '分子2024年／分母2026Q2（年率）' : '分子・分母2024年'}
    {projected && '。以後はモデルで延長'}
  </span>;
}

export function ResultAssumptions({ result, latest }: { result: FiscalCalculation; latest: boolean }) {
  const { initial: s, p, horizon } = result;
  const fiscal = result.constraints.filter(c => ['debt', 'interestGdp', 'interestTax', 'gfn'].includes(c.id));
  return <section aria-label="結果を左右する前提" className="space-y-3 rounded-xl border border-mirai-border bg-card p-4 text-sm">
    <h3 className="font-bold">結果を左右する前提</h3>
    <p>財政の評価は{horizon}年までです。{fiscal.every(c => c.status === 'safe') ? '入力中の政策では、この期間の財政4制約は閾値内です。' : '入力中の政策では、この期間でも財政制約に違反があります。'}
      基準の実質成長率{percent(p.baselineRealGrowth, 1)}・物価{percent(p.baselineInflation, 1)}、既発債の初期表面利率{percent(s.fiscal.interestPayments / s.fiscal.grossDebt)}、満期1〜10年の均等配分を仮定しています。
      長期の借換負担や、高齢化に伴う基準成長率を超える歳出増は評価していません。</p>
    <p>政策なしでは労働力人口{(s.labour.labourForce / 1e4).toLocaleString('ja-JP')}万人・就業者数{(s.labour.employment / 1e4).toLocaleString('ja-JP')}万人を評価期間中一定としています。人口動態の外生経路は未実装です。
      政策の雇用反応は別に計算します。{p.referenceModel === 'ef2026' ? 'EF2026の参照係数では労働力人口・労働時間の反応は0です。' : 'ESRI2022には労働力人口・労働時間の反応があります。'}追加の参加・時間感度や供給条件も結果を変えます。</p>
    <p>人数から見た余力（労働力人口÷就業者数−1）は{percent(s.labour.labourForce / s.labour.employment - 1)}。
      最大生産能力の労働投入指数{s.production.inputs.labour.toFixed(3)}は通常投入を基準とする別の仮定で、人数・時間・参加可能人口から導出した値ではありません。両者の整合は未検証です。</p>
    <div className="grid gap-2 sm:grid-cols-3">{[
      ['初期の総債務 / GDP', s.fiscal.grossDebt / s.macro.nominalGdp],
      ['初期のPB / GDP', s.fiscal.primaryBalance / s.macro.nominalGdp],
      ['初期の税・社会負担 / GDP', s.fiscal.taxRevenue / s.macro.nominalGdp],
    ].map(([label, value]) => <div key={label}><span>{label}</span><p className="tabular-nums">{percent(Number(value))}</p><FiscalVintageBadge latest={latest} /></div>)}</div>
  </section>;
}
