import type { FiscalRiskAudit } from '@/app/lib/fiscal-space/risk-audit';
import { money, percent } from './format';

export function BaselineSensitivity({ rows }: { rows: FiscalRiskAudit['baselineSensitivity'] }) {
  return <div className="overflow-x-auto" data-testid="baseline-inflation-sensitivity">
    <table className="w-full text-right text-sm"><caption className="text-left font-bold">基準インフレによる探索上限の感度</caption>
      <thead><tr><th scope="col" className="text-left">基準インフレ</th><th scope="col">年額</th><th scope="col">境界・状態</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.inflation} className="border-t border-mirai-border"><th scope="row" className="py-1 text-left">{percent(r.inflation, 1)}{r.current && '（現在）'}</th><td>{r.status === 'unevaluated' ? '算出不可' : money(r.amount, 1)}</td><td>{r.status === 'unevaluated' ? '負荷が未評価' : r.status === 'empty-mix' ? '配分未入力' : r.status === 'baseline-violated' ? '将来の政策なし経路が上限超過' : r.binding.join('・') || '探索範囲・収入上限'}</td></tr>)}</tbody>
    </table><p className="mt-2 text-xs">年0の観測値・CPI上限・配分・他の条件を固定し、将来の基準インフレだけを変更して全制約を再探索。信頼区間ではありません。表示は0.1兆円単位で、統計的な精度を示しません。</p>
  </div>;
}
