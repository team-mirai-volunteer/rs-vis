'use client';

/**
 * 予算サマリー。
 *
 * 上段に単純合計・一次純計・控除額を並べ、下段で会計別の内訳を出す。
 * 「特別会計は一般会計の4倍もある」という見え方が、会計間の繰入を
 * 二重に数えた結果であることを数字で示すのが目的。
 */

import type { MOFBudgetOverviewData } from '@/types/mof-budget-overview';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

function Kpi({
  label,
  amount,
  note,
  color,
}: {
  label: string;
  amount: number;
  note: string;
  color: 'blue' | 'green' | 'red';
}) {
  const border = { blue: 'border-blue-600', green: 'border-green-600', red: 'border-red-600' }[
    color
  ];
  const text = { blue: 'text-blue-600', green: 'text-green-600', red: 'text-red-600' }[color];
  return (
    <div className={`border-l-4 ${border} pl-3`}>
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${text}`}>{formatBudgetFromYen(amount)}</div>
      <div className="text-xs text-gray-500 mt-1">{note}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="py-1 text-gray-600">{label}</td>
      <td className="py-1 text-right font-semibold">{value}</td>
    </tr>
  );
}

export function SummaryPanel({ summary }: { summary: MOFBudgetOverviewData['summary'] }) {
  const { generalAccount, specialAccounts, agencies, transfers, totals } = summary;
  const deduction =
    totals.deductions.receivedBySpecial + totals.deductions.receivedBetweenSubAccounts;
  const yen = formatBudgetFromYen;
  const pct = (part: number, whole: number) =>
    whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-bold mb-4 text-gray-800">予算サマリー</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Kpi
          label="単純合計"
          amount={totals.gross}
          note="一般会計 + 特別会計 + 政府関係機関"
          color="blue"
        />
        <Kpi
          label="一次純計"
          amount={totals.net}
          note={`単純合計の ${pct(totals.net, totals.gross)}`}
          color="green"
        />
        <Kpi
          label="会計間の繰入（控除）"
          amount={deduction}
          note={`単純合計の ${pct(deduction, totals.gross)}が二重計上`}
          color="red"
        />
      </div>

      <div className="pt-4 border-t grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold text-gray-800 mb-2 text-sm">一般会計</h4>
          <table className="w-full text-xs">
            <tbody>
              <Row label="歳入" value={yen(generalAccount.revenue)} />
              <Row label="歳出" value={yen(generalAccount.expenditure)} />
              <Row
                label="うち他会計へ繰入"
                value={`${yen(generalAccount.transferOut)}（${pct(generalAccount.transferOut, generalAccount.expenditure)}）`}
              />
              <Row label="実支出" value={yen(generalAccount.net)} />
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="font-semibold text-gray-800 mb-2 text-sm">特別会計</h4>
          <table className="w-full text-xs">
            <tbody>
              <Row label="歳入" value={yen(specialAccounts.revenue)} />
              <Row label="歳出" value={yen(specialAccounts.expenditure)} />
              <Row
                label="うち他会計へ繰入"
                value={`${yen(specialAccounts.transferOut)}（${pct(specialAccounts.transferOut, specialAccounts.expenditure)}）`}
              />
              <Row label="実支出" value={yen(specialAccounts.net)} />
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="font-semibold text-gray-800 mb-2 text-sm">会計間の繰入</h4>
          <table className="w-full text-xs">
            <tbody>
              <Row label="一般会計 → 他会計" value={yen(transfers.generalToOther)} />
              <Row label="特別会計 → 他会計" value={yen(transfers.specialToOther)} />
              <Row label="特別会計が受け入れた額" value={yen(transfers.receivedBySpecial)} />
              <Row label="特別会計 → 一般会計" value={yen(transfers.specialToGeneral)} />
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500">
            逆方向は原資が剰余金のため歳出予算を通らず、一般会計歳入の
            「◯◯特別会計受入金」にのみ現れます。
          </p>
        </div>

        <div>
          <h4 className="font-semibold text-gray-800 mb-2 text-sm">政府関係機関</h4>
          <table className="w-full text-xs">
            <tbody>
              <Row label="支出" value={yen(agencies.expenditure)} />
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500">
            国が全額出資する法人のうち、予算が国会の議決を要するもの。
          </p>
        </div>
      </div>
    </div>
  );
}
