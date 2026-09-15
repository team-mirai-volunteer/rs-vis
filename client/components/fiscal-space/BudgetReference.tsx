import { memo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CURRENT_BUDGET } from '@/app/lib/fiscal-space/budget';
import { money } from './format';

export const BudgetReference = memo(function BudgetReference() {
  const budget = CURRENT_BUDGET;
  return <Card data-testid="general-account-budget">
    <CardHeader>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">国の一般会計予算と内訳</h2>
        <p className="text-2xl font-bold tabular-nums">{money(budget.amount)}</p>
      </div>
      <p className="text-sm">{budget.label} <span className="rounded bg-mirai-surface-warm px-2 py-1 text-xs">公表予算</span></p>
      <p className="text-xs text-mirai-text-subtle">追加予算の規模を考えるための参考です。試算の一般政府は地方・社会保障基金も含むため、この金額とは合算しません。</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-5 sm:grid-cols-2">
        {([['歳出の内訳', budget.expenditure], ['歳入の内訳', budget.revenue]] as const).map(([heading, rows]) => <section key={heading} className="min-w-0">
          <h3 className="mb-3 text-sm font-bold">{heading}</h3>
          <dl className="space-y-3">{rows.map(row => <div key={row.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><dt>{row.label}</dt><dd className="font-bold tabular-nums">{money(row.amount)}</dd></div>
            <div aria-hidden="true" className="my-1 h-1.5 rounded-full bg-mirai-surface-warm"><div className="h-full rounded-full bg-primary" style={{ width: `${row.amount / budget.amount * 100}%` }} /></div>
            <dd className="text-xs text-mirai-text-subtle">{row.note}</dd>
          </div>)}</dl>
        </section>)}
      </div>
      <p className="text-xs">国債費のうち、債務償還費（交付国債分を除く）{money(budget.debtService.redemption)}、利払費{money(budget.debtService.interest)}。国債費にはこのほかの経費も含まれます。</p>
      <p className="text-xs text-mirai-text-subtle">成立：{budget.enactedAt}／確認：{budget.checkedAt}。丸めにより内訳の合計と総額が一致しない場合があります。<a href={budget.sourceUrl} target="_blank" rel="noreferrer" className="text-primary-accent underline">財務省の予算フレーム</a></p>
    </CardContent>
  </Card>;
});
