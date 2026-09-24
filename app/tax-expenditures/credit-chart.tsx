'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { creditAmount, creditSeries, type CreditYear } from '@/app/lib/tax-expenditures/credits';

const colors = ['bg-primary-accent', 'bg-primary', 'bg-mirai-gradient-start', 'bg-mirai-gradient-end'];

export function CreditChart({ year, ids, onSelect }: { year: CreditYear; ids: Set<string>; onSelect: (id: string) => void }) {
  const series = creditSeries(year, ids);
  const max = Math.max(0, ...series.map(s => s.total ?? 0));
  const total = series.reduce((sum, s) => sum + (s.total ?? 0), 0);
  return <Card className="p-5 sm:p-6" role="region" aria-label="税額控除の適用実績">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h3 className="text-lg font-bold">税額控除の適用実績</h3><p className="mt-1 text-sm text-mirai-text-secondary">{year}年度 · 金額の大きい順 · 検索条件に連動</p></div>
      <div><p className="text-xs text-mirai-text-subtle">表示対象の記載額の合計</p><p className="mt-1 text-2xl font-bold tabular-nums">{series.some(s => s.total !== null) ? creditAmount(total) : '—'}</p></div>
    </div>
    <p className="mt-4 text-sm leading-6 text-mirai-text-secondary">税額控除だけで構成される7区分を収録（繰越控除の区分を含む）。特別償却と税額控除が混在する制度は対象外です。租特全体の総額や、廃止で増える税収を示すものではありません。</p>
    <p className="mt-2 text-xs leading-6 text-mirai-text-subtle">棒の色分けは各制度内の原表区分（左から掲載順）。制度間で色の意味は共通ではありません。内訳は展開して確認できます。通算法人の内数は重複加算せず、2022年度は連結法人の記載額も含めています。未記載の金額は合計に含めません。</p>
    {series.length === 0 ? <p className="mt-5 text-sm">この検索条件ではグラフ対象の制度がありません。</p> : <>
      <div className="mt-5 flex justify-between text-xs text-mirai-text-subtle" aria-hidden="true"><span>0 億円</span><span>共通スケール・最大 {creditAmount(max)}</span></div>
      <div className="mt-3 space-y-5">{series.map(item => <div key={item.id}>
        <Button variant="ghost" className="h-auto w-full flex-col items-stretch gap-2 whitespace-normal rounded-lg px-0 py-2 text-left hover:bg-mirai-surface" onClick={() => onSelect(item.id)} aria-label={`${item.name}の制度詳細を開く`}>
          <span className="flex flex-wrap justify-between gap-x-4 gap-y-1"><span>{item.name}</span><span className="tabular-nums">{item.total === null ? '記載なし' : creditAmount(item.total)}{item.hasMissing && item.total !== null ? '（記載分）' : ''} →</span></span>
          <span className="block h-7 w-full rounded bg-mirai-surface-grouped" aria-hidden="true">
            <span className="flex h-full overflow-hidden rounded" style={{ width: `${max > 0 ? (item.total ?? 0) / max * 100 : 0}%` }}>{item.segments.map((segment, index) => <span key={segment.sourceRow} className={`h-full ${colors[index % colors.length]}`} style={{ width: `${item.total ? (segment.amount ?? 0) / item.total * 100 : 0}%` }} />)}</span>
          </span>
        </Button>
        <details className="mt-1 text-sm">
          <summary className="w-fit cursor-pointer rounded-sm text-primary-accent underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-primary">{item.name}の内訳</summary>
          <ul className="mt-3 space-y-2">{item.segments.map((segment, index) => <li key={segment.sourceRow} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-mirai-surface p-3"><span className="flex items-center gap-2"><span aria-hidden="true" className={`size-3 shrink-0 rounded-sm ${colors[index % colors.length]}`} />{segment.section} {segment.label}</span><span className="tabular-nums">{segment.amount === null ? '記載なし（ゼロではありません）' : creditAmount(segment.amount)}</span></li>)}</ul>
          <p className="mt-2 text-xs text-mirai-text-subtle">区分名は原表の概要を要約しています。年度によって適用要件が異なります。詳細画面で原表の金額（千円）と制度概要を確認できます。</p>
        </details>
      </div>)}</div>
    </>}
  </Card>;
}
