'use client';

/**
 * 特別会計の一覧。
 *
 * 自前財源比率を出すのは、区分経理の理由（特定の歳入を特定の歳出に充てる）が
 * 実際に成立している会計と、一般会計から回ってきた金を通しているだけの会計を
 * 見分けられるようにするため。
 */

import type { MOFSpecialAccountSummary } from '@/types/mof-budget-overview';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

/** 自前財源比率の帯。低いほど「通しているだけ」の性格が強い */
function rateColor(rate: number): string {
  if (rate >= 0.9) return 'bg-emerald-500';
  if (rate >= 0.6) return 'bg-amber-500';
  return 'bg-red-500';
}

export function SpecialAccountTable({
  accounts,
}: {
  accounts: MOFSpecialAccountSummary[];
}) {
  if (accounts.length === 0) return null;
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-bold text-gray-800 mb-1">
        特別会計 {accounts.length}会計
      </h2>
      <p className="mb-3 text-xs text-gray-500">
        自前財源比率 = 歳入のうち他会計からの受入でない割合。低いほど一般会計等から
        回ってきた金を通している性格が強くなります。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-gray-200">
              <th className="px-2 py-2 text-left font-medium">特別会計</th>
              <th className="px-2 py-2 text-right font-medium">勘定</th>
              <th className="px-2 py-2 text-right font-medium">歳出</th>
              <th className="px-2 py-2 text-right font-medium">歳入</th>
              <th className="px-2 py-2 text-right font-medium">他会計から</th>
              <th className="px-2 py-2 text-right font-medium">他会計へ</th>
              <th className="px-2 py-2 text-left font-medium">自前財源比率</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {accounts.map(a => (
              <tr key={a.name} className="border-b border-gray-100">
                <td className="px-2 py-2 whitespace-nowrap">{a.name}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-500">
                  {a.subAccountCount || '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatBudgetFromYen(a.expenditure)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatBudgetFromYen(a.revenue)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatBudgetFromYen(a.transferIn)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatBudgetFromYen(a.transferOut)}
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 rounded bg-gray-100">
                      <div
                        className={`h-2 rounded ${rateColor(a.ownRevenueRate)}`}
                        style={{ width: `${Math.round(a.ownRevenueRate * 100)}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-xs text-gray-600">
                      {(a.ownRevenueRate * 100).toFixed(1)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
