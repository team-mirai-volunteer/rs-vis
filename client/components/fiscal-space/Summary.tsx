import { POLICIES } from '@/app/lib/fiscal-space/assumptions';
import { BaselineSensitivity } from './BaselineSensitivity';
import { Card, CardContent } from '@/components/ui/card';
import type { FiscalSpaceEstimate } from '@/types/fiscal-space';
import { money, percent, points } from './format';
import type { FiscalRiskAudit } from '@/app/lib/fiscal-space/risk-audit';
import { RiskAudit } from './RiskAudit';
import { ModelSensitivity, type ModelSensitivityProps } from './ScenarioConditions';
import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';

export function Summary({ estimate, riskAudit, longRun, ...modelProps }: {
  estimate: FiscalSpaceEstimate; riskAudit: FiscalRiskAudit; longRun: FiscalCalculation['longRun'];
} & ModelSensitivityProps) {
  const { horizon } = modelProps;
  const binding = estimate.constraints.filter(c => c.status === 'violated');
  const approximation = riskAudit.cpiApproximation;
  const inflationAlone = binding.length > 0 && binding.every(c => c.id === 'inflation');
  const last = longRun.at(-1);
  const benefitTotal = longRun.reduce((sum, row) => sum + row.supplyBenefit, 0);
  if (estimate.status === 'unevaluated') return <section id="fiscal-envelope" role="status" className="rounded-xl border border-mirai-border p-5">
    <h2 className="font-bold">参考上限は算出不可</h2><p>産業・電力の負荷係数が不足しているため探索を停止しました。旧共有リンクの手入力条件でも、未評価を余裕として扱いません。原単位を指定するか、資源負荷の概算を有効にしてください。</p>
  </section>;
  return <section id="fiscal-envelope" aria-label="財政余力の探索結果" className="scroll-mt-20 space-y-3">
    <Card><CardContent className="space-y-4 pt-5">
      <h2 className="text-lg font-bold">同じ配分を拡大した場合の参考上限（選んだストレスに耐える額）</h2>
      <p className="text-3xl font-bold tabular-nums" data-testid="recommended-envelope-summary">{money(estimate.recommendedEnvelope, 1)} / 年</p>
      <p className="text-sm">条件付きの参考値で、推奨額でも財政の上限でもありません。ストレスなしの探索額は <span data-testid="theoretical-maximum">{money(estimate.theoreticalMaximum, 1)}</span>（実質的な控除 {percent(estimate.reserveRule.share, 0)}。控除率は入力ではなく結果）。評価期間{horizon}年間{riskAudit.extrapolatedYears > 0 && `（うち${riskAudit.extrapolatedYears}年は公表期間外の延長計算）`}。</p>
      {estimate.stress && estimate.stress.length > 0 && <div className="overflow-x-auto" role="region" aria-label="ストレス別の参考上限" tabIndex={0} data-testid="stress-table"><table className="w-full min-w-[460px] text-right text-sm tabular-nums">
        <caption className="text-left text-xs">各ストレスを同じ配分に載せて再探索した額。チェックした条件の最小値を参考上限にします（「予算を制約する条件」で選択）。{estimate.stress.some(s => s.selected) ? '' : '現在は未選択のため、ストレスなしの探索額を表示しています。'}ストレスの大きさは仮定ですが、「何に耐えるか」として読める条件です。</caption>
        <thead><tr><th scope="col" className="text-left">ストレス</th><th scope="col">耐える額／年</th><th scope="col" className="text-left">拘束</th><th scope="col" className="text-left">選択</th></tr></thead>
        <tbody>{estimate.stress.map(row => <tr key={row.id} className={`border-t border-mirai-border ${row.selected ? '' : 'text-mirai-text-subtle'}`} data-stress={row.id} data-selected={row.selected}><th scope="row" className="py-1 text-left font-medium">{row.label}</th><td>{money(row.amount, 1)}{row.selected && row.amount <= estimate.recommendedEnvelope + 1 && ' ◀'}</td><td className="text-left text-xs">{row.status === 'baseline-violated' ? '政策なしで上限超過' : row.binding ?? '—'}</td><td className="text-left text-xs">{row.selected ? '採用' : '未選択'}</td></tr>)}
        {estimate.combinedStress && <tr className="border-t-2 border-mirai-border" data-stress="combined"><th scope="row" className="py-1 text-left font-medium">{estimate.combinedStress.label}</th><td>{money(estimate.combinedStress.amount, 1)}</td><td className="text-left text-xs">{estimate.combinedStress.status === 'baseline-violated' ? '政策なしで上限超過' : estimate.combinedStress.binding ?? '—'}</td><td className="text-left text-xs">同時に耐える額（参考）</td></tr>}</tbody>
      </table></div>}
      {estimate.combinedStress && <p className="text-xs">参考上限は「それぞれに耐える」額（選択したストレスの最小値）です。「同時に耐える」額は同じ経路にエネルギー価格・金利を重ね、輸入物価はCPI判定に加えて再探索した結果で、通常はこれより小さくなります。輸入物価とエネルギー価格の重複は、エネルギー輸入費を二重に加えないことで調整しています。</p>}
      {inflationAlone && approximation && <div className="rounded bg-mirai-surface-warm p-3 text-sm" data-testid="cpi-decomposition">
        <p className="font-bold">この条件では、CPI上限が単独で枠を決めています。</p>
        <p className="mt-1">近似：(上限{percent(riskAudit.cpi.limit, 3)} − 政策なしのCPI {percent(approximation.baseline, 3)}) ÷ {(approximation.slope * 100).toFixed(3)}ポイント/兆円 ≈ {money(approximation.amount)}（控除前）。年{approximation.year}における0〜1兆円の感応度から求めた説明用の式で、主表示は全制約の探索額です。</p>
        <p className="mt-1 text-xs">他の制約が先に拘束するのは、CPI上限を引き上げる、労働需給の許容失業率下限を引き上げる、配分を建設・研究へ寄せる、初期投入指数を下げる、のいずれかの場合です。この条件では生産関数・供給超過時の物価転嫁・借換金利の変更は枠をほとんど動かしません。</p>
      </div>}
      <p className="text-sm">境界を決めた制約：{binding.length ? binding.map(c => `${c.label}（年${c.year}）`).join('、') : estimate.status === 'revenue-cap' ? `${POLICIES.find(p => p.id === estimate.limitingPolicy)?.name ?? '減税'}の対象収入` : '未特定'}。{estimate.status === 'empty-mix' && 'まず政策の配分を入力してください。'}{estimate.status === 'search-cap' && '探索範囲の端で止まりました。'}</p>
      {estimate.status === 'baseline-violated' && <p role="status" className="rounded-xl bg-stance-against-bg p-3 text-sm">
        政策なしでも設定した上限を超えます。{binding.map(c => `${c.label}は年${c.year}に${percent(c.currentValue)}（上限${percent(c.threshold)}）`).join('、')}。
        判定対象は年1以降の将来経路です。年0の観測値は表示に残し、違反判定には含めません。参考額0円は政府の支出能力が0という判定ではありません。
      </p>}
      {last && <p className="text-sm" data-testid="long-run-summary">同じ配分の長期シナリオ（{last.year}年目）：債務/GDPの政策なしとの差 {points(last.debtGdp - last.baselineDebtGdp)}、公表期間後の供給便益の合計 {money(benefitTotal)}（年0価格・実現率込み）。{horizon}年評価では研究・教育・系統など非資本の供給便益は設計上0で、成長投資は短期の物価コストだけが枠に入ります。<a href="#long-run" className="text-primary-accent underline">長期シナリオ</a>で条件を変更できます。</p>}
      <details data-testid="baseline-sensitivity-details"><summary className="cursor-pointer text-sm font-bold">計算条件による違いを見る</summary><div className="mt-3 space-y-3">
        <BaselineSensitivity rows={riskAudit.baselineSensitivity} />
        <p className="text-xs">この表は、今後の物価上昇の想定を変えた比較です。「次の1兆円」の表は、現在の想定のまま政策を追加した影響を比較します。債務以外の条件で増額が止まった行は、国債をどこまで増やせるかを示すものではありません。</p>
      </div></details>
      <details><summary className="cursor-pointer text-sm font-bold">CPI上限別の感度と計算方法</summary><p className="mt-2 text-sm">ストレスなしの探索額 {money(estimate.theoreticalMaximum, 1)} に対し、選んだストレスに耐える最小額 {money(estimate.recommendedEnvelope, 1)} を参考上限とします（差 {money(estimate.emergencyReserve)}）。下表はストレスなしの探索額です。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="CPI上限別の探索結果" data-testid="cpi-limit-sensitivity"><table className="w-full text-right text-sm">
        <caption className="mb-2 text-left font-bold">CPI許容上限による感度（同じ配分・期間、ストレスなしの探索額）</caption>
        <thead><tr><th scope="col" className="text-left">CPI許容上限</th><th scope="col">同じ配分の参考上限</th><th scope="col" className="text-left">条件</th></tr></thead>
        <tbody>{[...riskAudit.sensitivity].sort((a, b) => a.limit - b.limit).map(row => <tr key={row.limit} className="border-t border-mirai-border">
          <th scope="row" className="py-2 text-left">{percent(row.limit, 1)}{row.current && '（現在）'}</th>
          <td>{row.status === 'unevaluated' ? '算出不可（負荷が未評価）' : money(row.amount, 1)}</td>
          <td className="text-left">{row.status === 'search-cap' ? '探索範囲の端' : row.status === 'revenue-cap' ? '減収対象の収入上限' : row.status === 'baseline-violated' ? '政策なしで制約超過' : row.status === 'empty-mix' ? '配分未入力' : row.current ? '現在の設定' : '感度比較'}</td>
        </tr>)}</tbody>
      </table><p className="mt-2 text-xs">CPI上限だけを変え、全制約を再探索しています。表示桁は計算の丸めで、推定精度を表しません。上限の設定に強く依存する条件付きの値で、許容物価の推奨や信頼区間ではありません。</p></div></details>
      <details><summary className="cursor-pointer text-sm font-bold">この数字の読み方</summary><div className="mt-2 space-y-2 text-sm">
        <p>追加予算に上乗せする金額ではありません。一般政府の減税・支出の追加総額であり、国の一般会計予算とは合算しません。</p>
        <p>参考上限（ストレス耐性額）を実施した場合：年{horizon}の実質GDP効果 {money(riskAudit.terminalGdpEffect)}。判定用CPIピークは年{riskAudit.cpi.year}、{percent(riskAudit.cpi.peak)}。制約はピーク年、GDP効果は終端年で評価されるため、両者は同じ年ではありません。三時点の内訳は上部の「追加予算と国の一般会計予算」を参照してください。</p>
        <p><strong>安全性は未判定です。</strong> 産業内の職種・設備の偏り、地域間の電力融通、追加の為替ストレスは上限に十分反映できません。手入力の空欄は未評価です。参考上限は政策の推奨額や便益の評価ではありません。</p>
      </div></details>

      <ModelSensitivity {...modelProps} />
      <details><summary className="cursor-pointer text-sm font-bold">参考上限の前提とストレス感度</summary><div className="mt-3"><RiskAudit audit={riskAudit} /></div></details>
    </CardContent></Card>
  </section>;
}
