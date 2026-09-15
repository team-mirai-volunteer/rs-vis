import { Card, CardContent } from '@/components/ui/card';
import type { FiscalSpaceEstimate } from '@/types/fiscal-space';
import { money, percent } from './format';
import type { FiscalRiskAudit } from '@/app/lib/fiscal-space/risk-audit';
import { RiskAudit } from './RiskAudit';
import { ModelSensitivity, type ModelSensitivityProps } from './ScenarioConditions';

export function Summary({ estimate, riskAudit, ...modelProps }: {
  estimate: FiscalSpaceEstimate; riskAudit: FiscalRiskAudit;
} & ModelSensitivityProps) {
  const { horizon } = modelProps;
  const binding = estimate.constraints.filter(c => c.status === 'violated');
  const approximation = riskAudit.cpiApproximation;
  return <section id="fiscal-envelope" aria-label="財政余力の探索結果" className="scroll-mt-20 space-y-3">
    <Card><CardContent className="space-y-4 pt-5">
      <h2 className="text-lg font-bold">同じ配分を拡大した場合の参考上限</h2>
      <p className="text-sm">追加予算に上乗せする金額ではありません。一般政府の減税・支出の追加総額であり、国の一般会計予算とは合算しません。</p>
      <p className="text-sm">上段の参考上限は緊急時の留保{percent(estimate.reserveRule.share, 0)}（年額{money(estimate.emergencyReserve)}）を差し引いた額です。評価期間：{horizon}年間。</p>
      <details><summary className="cursor-pointer text-sm font-bold">留保前の探索額と計算方法</summary><p className="mt-2 text-sm">設定した制約内での探索額 <span data-testid="theoretical-maximum">{money(estimate.theoreticalMaximum)}</span> ×（1 − 留保率{percent(estimate.reserveRule.share, 0)}）＝ 参考上限 {money(estimate.recommendedEnvelope)}。留保率は仮定で、安全性を保証するものではありません。</p></details>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="CPI上限別の探索結果" data-testid="cpi-limit-sensitivity"><table className="w-full text-right text-sm">
        <caption className="mb-2 text-left font-bold">CPI許容上限による感度（同じ配分・期間、留保後の年額）</caption>
        <thead><tr><th scope="col" className="text-left">CPI許容上限</th><th scope="col">同じ配分の参考上限</th></tr></thead>
        <tbody>{[...riskAudit.sensitivity].sort((a, b) => a.limit - b.limit).map(row => <tr key={row.limit} className="border-t border-mirai-border">
          <th scope="row" className="py-2 text-left">{percent(row.limit, 1)}{row.current && '（現在）'}</th>
          <td>{money(row.amount)}{row.status === 'search-cap' && '（探索範囲の端）'}{row.status === 'revenue-cap' && '（減収対象の収入上限）'}{row.status === 'baseline-violated' && '（政策なしで制約超過）'}{row.status === 'empty-mix' && '（配分未入力）'}</td>
        </tr>)}</tbody>
      </table><p className="mt-2 text-xs">CPI上限だけを変え、全制約を再探索しています。表示桁は計算の丸めで、推定精度を表しません。上限の設定に強く依存する条件付きの値で、許容物価の推奨や信頼区間ではありません。</p></div>
      <p className="text-sm font-bold">留保後の参考額を実施した場合：年{horizon}の実質GDP効果 {money(riskAudit.terminalGdpEffect)}。判定用CPIピークは年{riskAudit.cpi.year}、{percent(riskAudit.cpi.peak)}。</p>
      <p className="text-sm">境界を決めた制約：{binding.length ? binding.map(c => `${c.label}（年${c.year}）`).join('、') : estimate.status === 'revenue-cap' ? (estimate.limitingPolicy === 'social-insurance' ? '社会保険料の軽減対象収入' : '消費税の減収対象収入') : '未特定'}。{estimate.status === 'empty-mix' && 'まず政策の配分を入力してください。'}{estimate.status === 'search-cap' && '探索上限に到達したため、真の境界は未特定です。'}</p>
      {approximation && <div className="rounded bg-mirai-surface-warm p-3 text-sm" data-testid="cpi-decomposition">
        <p>物価で決まる留保前の額の近似：({percent(riskAudit.cpi.limit, 3)} − 基準{percent(approximation.baseline, 3)}) ÷ {(approximation.slope * 100).toFixed(3)}ポイント/兆円 ≈ {money(approximation.amount)}。</p>
        <p className="mt-1">年{approximation.year}における0〜1兆円の感応度を使用（上限が1兆円未満ならその範囲）。主表示の参考上限は全制約の探索額から留保を差し引いています。ピーク年の交代・供給上限・税効果で非線形になるため、この式だけでは上限を判定しません。</p>
      </div>}
      {estimate.status === 'baseline-violated' && <p role="status" className="rounded-xl bg-stance-against-bg p-3 text-sm">
        政策なしでも設定した上限を超えます。{binding.map(c => `${c.label}は年${c.year}に${percent(c.currentValue)}（上限${percent(c.threshold)}）`).join('、')}。
        インフレ率の上限は絶対値で、データ切替時にも維持します。例えば2024年の初期CPI 2.7%は既定上限2.5%を超えます。参考額0円は政府の支出能力が0という判定ではありません。
      </p>}
      <p className="rounded-xl bg-stance-against-bg p-3 text-sm"><strong>安全性は未判定です。</strong> 産業内の職種・設備の偏り、地域間の電力融通、追加の為替ストレスは上限に十分反映できません。手入力の空欄は未評価です。参考上限は政策の推奨額や便益の評価ではありません。</p>
      <ModelSensitivity {...modelProps} />
      <details><summary className="cursor-pointer text-sm font-bold">参考上限の前提とストレス感度</summary><div className="mt-3"><RiskAudit audit={riskAudit} /></div></details>
    </CardContent></Card>
  </section>;
}
