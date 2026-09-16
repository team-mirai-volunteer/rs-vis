import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
import { percent } from './format';

export function PowerTimeline({ rows }: { rows: FiscalCalculation['powerTimeline'] }) {
  if (!rows.length) return null;
  return <details className="rounded-xl border border-mirai-border p-4" data-testid="power-timeline">
    <summary className="cursor-pointer text-sm font-bold">発電投資の稼働時期と電力需給を見る</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p>上の電力メーターは、評価期間で最も余裕が少ない年を表示します。建設中に需要が先に増えると、完成後に供給が改善してもメーターが上がることがあります。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="年ごとの発電供給と電力需給"><table className="w-full min-w-[640px] text-right">
        <caption className="mb-2 text-left">年ごとの供給増と需要増（入力した追加予算の効果）</caption>
        <thead><tr>{['年', '発電投資による供給増 GW', '全政策の需要増 GW', '全政策の供給増 GW', '需要÷供給：政策なし', '需要÷供給：政策あり', '最も余裕が少ない地域・時期'].map(label => <th className="p-2" scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.year} className="border-t border-mirai-border" data-power-year={row.year}>
          <th className="p-2" scope="row">{row.year}年目</th><td className="p-2" data-power-supply>{row.generationSupplyGw.toFixed(2)}</td><td className="p-2">{row.extraDemandGw.toFixed(2)}</td><td className="p-2">{row.extraSupplyGw.toFixed(2)}</td><td className="p-2">{percent(row.baselineUtilization)}</td><td className="p-2">{percent(row.utilization)}</td><td className="p-2">{row.region}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs">供給増は稼働設備容量に「確実供給への寄与率」を掛けた値です。空欄の電源は未算入です。GWは全国合計、需要÷供給は各年で最も厳しい地域・時期の比率で、政策なしとありでは対象地域が異なる場合があります。</p>
    </div>
  </details>;
}
