import { memo } from 'react';
import { CURRENT_BUDGET } from '@/app/lib/fiscal-space/budget';
import { money } from './format';

export const BudgetReference = memo(function BudgetReference() {
  const budget = CURRENT_BUDGET;
  return <section data-testid="general-account-budget" className="min-w-0 space-y-2 border-t border-mirai-border pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
      <h3 className="text-sm">国の一般会計予算 <span className="rounded bg-mirai-surface-warm px-2 py-1 text-xs">公表予算</span></h3>
      <p className="text-xl font-bold tabular-nums">{money(budget.amount)}</p>
      <p className="text-xs">{budget.label}</p>
      <p className="text-xs text-mirai-text-subtle">追加予算の規模を考えるための参考です。試算の一般政府は地方・社会保障基金も含むため、この金額とは合算しません。</p>
      <details><summary className="cursor-pointer text-sm font-bold">一般会計の歳入・歳出内訳</summary><div className="mt-3 space-y-4">
      <div className="grid gap-5 xl:grid-cols-2">
        {([['歳出の内訳', budget.expenditure], ['歳入の内訳', budget.revenue]] as const).map(([heading, rows]) => <section key={heading} className="min-w-0">
          <h4 className="mb-3 text-sm font-bold">{heading}</h4>
          <dl className="space-y-3">{rows.map(row => <div key={row.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><dt>{row.label}</dt><dd className="font-bold tabular-nums">{money(row.amount)}</dd></div>
            <div aria-hidden="true" className="my-1 h-1.5 rounded-full bg-mirai-surface-warm"><div className="h-full rounded-full bg-primary" style={{ width: `${row.amount / budget.amount * 100}%` }} /></div>
            <dd className="text-xs text-mirai-text-subtle">{row.note}</dd>
          </div>)}</dl>
        </section>)}
      </div>
      <p className="text-xs">国債費のうち、債務償還費（交付国債分を除く）{money(budget.debtService.redemption)}、利払費{money(budget.debtService.interest)}。国債費にはこのほかの経費も含まれます。</p>
      <p className="text-xs text-mirai-text-subtle">成立：{budget.enactedAt}／確認：{budget.checkedAt}。丸めにより内訳の合計と総額が一致しない場合があります。</p>
      </div></details>
      <p className="text-xs"><a href={budget.sourceUrl} target="_blank" rel="noreferrer" className="text-primary-accent underline">出典：財務省の予算フレーム</a></p>
  </section>;
});
