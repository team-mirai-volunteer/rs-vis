import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
import { JGB_SOURCE } from '@/app/lib/fiscal-space/debt-portfolio';
import { FERTILITY_LABELS } from '@/app/lib/fiscal-space/demographics';
import { percent } from './format';

export function FiscalVintageBadge({ latest, projected = false }: { latest: boolean; projected?: boolean }) {
  return <span className="mt-1 block rounded bg-mirai-surface-warm px-1 py-1 text-xs font-normal" data-testid="fiscal-vintage">
    {projected ? '試算の初期条件：' : '年0の比率：'}{latest ? '分子はIMF 2026年推計比率×分母2026Q2（年率）の橋渡し推計' : '分子・分母2024年'}
    {projected && '。以後はモデルで延長'}
  </span>;
}

export function DebtPortfolioNote({ latest }: { latest: boolean }) {
  return <p>年0の債務総額・利払額は{latest ? 'IMFの2026年推計比率に最新GDPを掛けた橋渡し推計' : '2024年の一般政府財政データ'}を使います。普通国債は公表償還年次表を残高に合わせて比例調整し、一般政府総債務との差額を満期1〜10年へ均等配分します。普通国債には加重平均表面利率を適用し、全体の支払利子に合うよう残差の利率等を調整します。銘柄別の利率や一般政府全体の実際の償還予定を再現したものではありません。<a className="underline" href={JGB_SOURCE.url} target="_blank" rel="noreferrer">普通国債の出典（{JGB_SOURCE.asOf}）</a></p>;
}

export function ResultAssumptions({ result, latest }: { result: FiscalCalculation; latest: boolean }) {
  const { initial: s, p, horizon } = result;
  const demographicOn = p.demographics.mode === 'included';
  const end = result.baseline.steps[horizon - 1].state;
  const fiscal = result.constraints.filter(c => ['debt', 'interestGdp', 'interestTax', 'gfn'].includes(c.id));
  return <section aria-label="結果を左右する前提" className="space-y-3 rounded-xl border border-mirai-border bg-card p-4 text-sm">
    <h3 className="font-bold">結果を左右する前提</h3>
    <p>財政の評価は{horizon}年までです。{fiscal.every(c => c.status === 'safe') ? '入力中の政策では、この期間の財政4制約は閾値内です。' : '入力中の政策では、この期間でも財政制約に違反があります。'}
      基準の実質成長率{percent(p.baselineRealGrowth, 1)}・物価{percent(p.baselineInflation, 1)}を仮定し、満期到来分の借換と新規発行に金利を反映します。年{horizon}より先は、別の長期シナリオの条件で評価します。</p>
    <DebtPortfolioNote latest={latest} />
    <p data-testid="demographic-assumption">{demographicOn
      ? <>人口動態を含めています。将来推計人口の{FERTILITY_LABELS[p.demographics.fertilityVariant]}と2024年の年齢階級別労働力率から、労働力人口・就業者数の基準経路を動かします。潜在GDPには労働弾力性を通じて反映し、基礎的歳出の{percent(p.demographics.ageingShare, 1)}を65歳以上人口、{percent(p.demographics.childBenefitShare, 1)}を0〜14歳人口に連動させます。</>
      : <>人口動態を含めない設定です。政策なしの労働力人口・就業者数を一定とし、人口による潜在GDP・歳出の変化を加えません。</>}
      政策なしの労働力人口は年0の{(s.labour.labourForce / 1e4).toLocaleString('ja-JP')}万人から年{horizon}の{Math.round(end.labour.labourForce / 1e4).toLocaleString('ja-JP')}万人、就業者数は{(s.labour.employment / 1e4).toLocaleString('ja-JP')}万人から{Math.round(end.labour.employment / 1e4).toLocaleString('ja-JP')}万人です。</p>
    <p>政策の雇用反応は基準経路に追加します。{p.referenceModel === 'ef2026' ? 'EF2026の参照係数では労働力人口・労働時間の反応は0です。' : 'ESRI2022には労働力人口・労働時間の反応があります。'}追加の参加・時間感度や供給条件も結果を変えます。</p>
    <p>人数から見た余力（労働力人口÷就業者数−1）は{percent(s.labour.labourForce / s.labour.employment - 1)}。
      最大生産能力の労働投入指数{s.production.inputs.labour.toFixed(3)}は直接設定または統計からの参考校正を使用しています。参考校正は失業者・潜在労働力人口・追加就労希望者を時間に換算し、設備の参照稼働水準も組み合わせます。仮定と適用範囲はサイドの「詳細な条件」→「最大GDP・生産モデルの条件」で確認できます。</p>
    <div className="grid gap-2 sm:grid-cols-3">{[
      ['初期の総債務 / GDP', s.fiscal.grossDebt / s.macro.nominalGdp],
      ['初期のPB / GDP', s.fiscal.primaryBalance / s.macro.nominalGdp],
      ['初期の税・社会負担 / GDP', s.fiscal.taxRevenue / s.macro.nominalGdp],
    ].map(([label, value]) => <div key={label}><span>{label}</span><p className="tabular-nums">{percent(Number(value))}</p><FiscalVintageBadge latest={latest} /></div>)}</div>
  </section>;
}
