'use client';

/**
 * 事項の経年推移。行を展開したときに詳細の中へ出す。
 *
 * データ取得はページ層の責務（client/components/ は API を直接叩かない）。
 * 年度ごとに JSON が分かれているためクライアントでは横断できず、
 * ページが /api/mof-jikou/history から受け取ったものを props で渡す。
 */

import {
  MOF_REVISION_NUMBERS,
  revisedBudgetType,
  type MOFBudgetType,
  type MOFJikouHistory,
  type MOFJikouItem,
} from '@/types/mof-jikou';
import { executionRate, formatRate, formatYen } from './format';

/** 表示順。左から時系列に見えるよう予算→補正（号数順）→決算の順に並べる */
const BUDGET_TYPE_ORDER: MOFBudgetType[] = [
  '当初予算',
  '暫定予算',
  ...MOF_REVISION_NUMBERS.map(revisedBudgetType),
  '決算',
];

/**
 * 見出しの表記。長い種別名は詰める。
 * 補正の金額は改予算額（その号の成立後の姿）なので「補正後」と呼ぶ。
 */
const TYPE_LABEL: Partial<Record<MOFBudgetType, string>> = {
  ...Object.fromEntries(
    MOF_REVISION_NUMBERS.map(n => [revisedBudgetType(n), `補正後(第${n}号)`])
  ),
  決算: '決算(予算額)',
};

function pick(items: MOFJikouItem[], type: MOFBudgetType): MOFJikouItem | undefined {
  return items.find(i => i.budgetType === type);
}

export function JikouHistory({
  history,
  loading,
  error,
}: {
  history: MOFJikouHistory | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <p className="text-[11px] text-red-600">推移の取得に失敗しました: {error}</p>;
  if (loading || !history) return <p className="text-[11px] text-neutral-400">推移を読み込み中…</p>;

  // その事項に実際に現れた予算種別だけを列にする
  const types = BUDGET_TYPE_ORDER.filter(t =>
    history.years.some(y => y.items.some(i => i.budgetType === t))
  );
  const hasSettlement = history.years.some(y => y.items.some(i => i.budgetType === '決算'));

  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-neutral-400">
        年度推移（{history.years.length} / {history.availableYears.length} 年度に計上）
      </div>
      <table className="border-collapse text-[11px]">
        <thead className="text-neutral-400">
          <tr>
            <th className="whitespace-nowrap px-2 py-1 text-left font-medium">年度</th>
            {types.map(t => (
              <th key={t} className="whitespace-nowrap px-2 py-1 text-right font-medium">
                {TYPE_LABEL[t] ?? t}
              </th>
            ))}
            {hasSettlement && (
              <>
                <th className="whitespace-nowrap px-2 py-1 text-right font-medium">支出済</th>
                <th className="whitespace-nowrap px-2 py-1 text-right font-medium">不用額</th>
                <th className="whitespace-nowrap px-2 py-1 text-right font-medium">執行率</th>
              </>
            )}
            <th className="whitespace-nowrap px-2 py-1 text-left font-medium">項</th>
          </tr>
        </thead>
        <tbody className="text-neutral-600 dark:text-neutral-400">
          {history.years.map(y => {
            const settlement = pick(y.items, '決算');
            const exec = settlement ? executionRate(settlement) : null;
            const section = y.items[0];
            return (
              <tr key={y.fiscalYear} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="whitespace-nowrap px-2 py-1">{y.eraLabel}（{y.fiscalYear}）</td>
                {types.map(t => (
                  <td key={t} className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                    {formatYen(pick(y.items, t)?.amount ?? null)}
                  </td>
                ))}
                {hasSettlement && (
                  <>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                      {formatYen(settlement?.spent ?? null)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                      {formatYen(settlement?.unused ?? null)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${
                        exec === null
                          ? 'text-neutral-400'
                          : exec < 0.5
                            ? 'text-red-600 dark:text-red-400'
                            : exec < 0.9
                              ? 'text-amber-700 dark:text-amber-500'
                              : ''
                      }`}
                    >
                      {formatRate(exec)}
                    </td>
                  </>
                )}
                <td className="whitespace-nowrap px-2 py-1 text-neutral-400">
                  {section.sectionCode} {section.sectionName}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {history.years.length < history.availableYears.length && (
        <p className="mt-1 text-[11px] text-neutral-400">
          計上のない年度は行がありません。事項名が改称されると別の事項として扱われるため、
          実態としては継続でも欠けて見えることがあります。
        </p>
      )}
    </div>
  );
}
