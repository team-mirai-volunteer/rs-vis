'use client';

import { ChevronRight, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { creditAmount, creditSeries, type CreditYear } from '@/app/lib/tax-expenditures/credits';

const colors = ['bg-primary-accent', 'bg-primary', 'bg-mirai-gradient-start', 'bg-mirai-gradient-end'];
const percent = (n: number) => `${n < 0.1 && n > 0 ? '<0.1' : n.toFixed(1)}%`;

export function CreditChart({ year, ids, onSelect }: { year: CreditYear; ids: Set<string>; onSelect: (id: string) => void }) {
  const series = creditSeries(year, ids);
  const max = Math.max(0, ...series.map(s => s.total ?? 0));
  const total = series.reduce((sum, s) => sum + (s.total ?? 0), 0);
  const top = series.slice(0, 2).filter(s => s.total);
  const topShare = total > 0 ? top.reduce((sum, s) => sum + (s.total ?? 0), 0) / total * 100 : 0;
  return <Card className="p-5 sm:p-6" role="region" aria-label="税額控除の適用実績">
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <h3 className="text-lg font-bold">税額控除の適用実績</h3>
        <p className="mt-1 text-sm text-mirai-text-secondary">{year}年度 · 税額控除だけで構成される{series.length}区分 · 金額の大きい順</p>
      </div>
      <p className="text-sm text-mirai-text-secondary">記載額の合計 <span className="ml-1 text-xl font-bold tabular-nums text-mirai-text">{series.some(s => s.total !== null) ? creditAmount(total) : '—'}</span></p>
    </div>
    {series.length > 2 && total > 0 && <p className="mt-4 rounded-lg bg-mirai-surface-teal px-4 py-3 text-sm leading-6">
      <strong className="text-primary-accent">{top.map(s => s.name).join('と')}で{percent(topShare)}</strong>を占めます。残り{series.length - top.length}区分は合計でも{creditAmount(total - top.reduce((sum, s) => sum + (s.total ?? 0), 0))}です。
    </p>}
    {series.length === 0 ? <p className="mt-5 text-sm">この検索条件ではグラフ対象の制度がありません。</p> : <>
      <div className="mt-5 hidden grid-cols-[minmax(0,13rem)_minmax(0,1fr)_9.5rem] gap-4 border-b border-mirai-border pb-2 text-xs text-mirai-text-subtle md:grid" aria-hidden="true">
        <span>制度</span><span>適用額（共通スケール・最大 {creditAmount(max)}）</span><span className="text-right">金額 / 構成比</span>
      </div>
      <ul className="divide-y divide-mirai-border">{series.map(item => <li key={item.id} className="py-2">
        <Button variant="ghost" className="group h-auto w-full items-center gap-x-4 gap-y-2 whitespace-normal rounded-lg px-2 py-2.5 text-left font-medium max-md:flex-wrap md:grid md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_9.5rem] md:gap-4 hover:bg-mirai-surface" onClick={() => onSelect(item.id)} aria-label={`${item.name}の制度詳細を開く`}>
          <span className="min-w-0 flex-1 md:flex-none">{item.name}</span>
          <span className="order-last block h-3 w-full rounded-full bg-mirai-surface-grouped md:order-none" aria-hidden="true">
            <span className="flex h-full min-w-[3px] overflow-hidden rounded-full" style={{ width: `${max > 0 ? (item.total ?? 0) / max * 100 : 0}%` }}>{item.segments.map((segment, index) => <span key={segment.sourceRow} className={`h-full ${colors[index % colors.length]}`} style={{ width: `${item.total ? (segment.amount ?? 0) / item.total * 100 : 0}%` }} />)}</span>
          </span>
          <span className="flex items-center justify-end gap-1 text-right tabular-nums">
            <span>{item.total === null ? '記載なし' : creditAmount(item.total)}{item.hasMissing && item.total !== null ? '*' : ''}<span className="block text-xs font-normal text-mirai-text-secondary">{item.total !== null && total > 0 ? percent(item.total / total * 100) : '—'}</span></span>
            <ChevronRight className="size-4 text-mirai-text-subtle group-hover:text-primary-accent" aria-hidden="true" />
          </span>
        </Button>
        {item.segments.length > 1 && <details className="px-2 text-sm md:ml-[calc(13rem+1rem)]">
          <summary className="w-fit cursor-pointer rounded-sm text-xs text-primary-accent underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-primary">{item.name}の内訳</summary>
          <ul className="mt-2 space-y-1.5">{item.segments.map((segment, index) => <li key={segment.sourceRow} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-mirai-surface px-3 py-2"><span className="flex items-center gap-2"><span aria-hidden="true" className={`size-3 shrink-0 rounded-sm ${colors[index % colors.length]}`} />{segment.section} {segment.label}</span><span className="tabular-nums">{segment.amount === null ? '記載なし（ゼロではありません）' : creditAmount(segment.amount)}</span></li>)}</ul>
          <p className="mt-2 text-xs text-mirai-text-subtle">区分名は原表の概要を要約しています。年度によって適用要件が異なります。</p>
        </details>}
      </li>)}</ul>
      {series.some(s => s.hasMissing && s.total !== null) && <p className="mt-2 text-xs text-mirai-text-subtle">* 一部区分が未記載のため、記載分のみの合計です。</p>}
    </>}
    <details className="mt-4 rounded-lg border border-mirai-border px-4 py-3 text-xs leading-6 text-mirai-text-secondary">
      <summary className="flex cursor-pointer items-center gap-1.5 rounded-sm font-medium text-mirai-text outline-none focus-visible:ring-2 focus-visible:ring-primary"><Info className="size-3.5 text-primary-accent" aria-hidden="true" />グラフの読み方と集計の注意</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>特別償却と税額控除が混在する制度は対象外です。租特全体の総額や、廃止で増える税収を示すものではありません。</li>
        <li>棒の色分けは各制度内の原表区分（左から掲載順）。制度間で色の意味は共通ではありません。</li>
        <li>通算法人の内数は重複加算せず、2022年度は連結法人の記載額も含めています。未記載の金額は合計に含めません。</li>
        <li>行を選ぶと制度一覧に移動し、原表の金額（千円）・制度概要・出典を確認できます。</li>
      </ul>
    </details>
  </Card>;
}
