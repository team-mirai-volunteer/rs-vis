'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { WageIdentification } from './wage-identification';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { assessments, axes, type AxisAssessment, rubric, assessmentDate, assessmentScope } from '@/app/lib/tax-expenditures/assessments';
import { creditAmount, creditSeries, type CreditYear } from '@/app/lib/tax-expenditures/credits';

export function AssessmentTable({ year, ids }: { year: CreditYear; ids: Set<string> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState('amount');
  const series = creditSeries(year, ids);
  if (sort === 'verification') series.sort((a, b) => (assessments[a.id]?.scores[4].score ?? 5) - (assessments[b.id]?.scores[4].score ?? 5));
  const detail = selected && series.find(s => s.id === selected);
  const assessment = detail && assessments[detail.id];
  const scored = series.reduce((n, s) => n + (assessments[s.id]?.scores.filter(x => x.score !== null).length ?? 0), 0);
  const open = (id: string) => { setSelected(id); requestAnimationFrame(() => document.getElementById('tax-assessment-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); };
  return <Card className="p-5 sm:p-6" role="region" aria-label="租特の妥当性評価">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">租特の妥当性評価（試行）</h3><Badge variant="light">AIによる暫定評価 · 人手レビュー未実施</Badge></div>
    <div className="mt-3 flex gap-3 rounded-lg bg-mirai-surface px-4 py-3 text-sm leading-6">
      <Info className="mt-1 size-4 shrink-0 text-primary-accent" aria-hidden="true" />
      <div>
        <p>{assessmentScope} 評価日：{assessmentDate}。政府やチームみらいの公式評価ではありません。</p>
        <p className="mt-1 text-mirai-text-secondary">資料不足は検証可能性の減点に反映します。「保留」は調査済みでも証拠不足が残る項目です。</p>
        <details className="mt-1"><summary className="cursor-pointer text-primary-accent underline underline-offset-4">採点基準と調査範囲</summary><ul className="mt-3 list-disc space-y-2 pl-5 leading-6">{rubric.map(r => <li key={r}>{r}</li>)}<li>7区分について財務省総括表、内閣府の2024・2025年度政策評価、財務省の賃上げ税制の計量分析、研究開発税制のRIETI研究・EBPM会合資料を確認。対象税目・制度の範囲が異なる資料は、その限界を各評価に記載しています。網羅的な文献調査ではありません。</li></ul></details>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <label className="text-sm">並び順 <select aria-label="評価表の並び順" value={sort} onChange={e => setSort(e.target.value)} className="ml-2 rounded-lg border border-mirai-border bg-card px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"><option value="amount">適用額の大きい順</option><option value="verification">検証可能性の低い順</option></select></label>
      <p className="flex items-center gap-3 text-xs text-mirai-text-secondary" aria-hidden="true"><span className="flex items-center gap-1.5"><ScoreDots score={3} />＝3/4点</span><span className="flex items-center gap-1.5"><Pending />＝証拠不足</span></p>
    </div>
    <p className="mt-2 text-xs text-mirai-text-subtle">金額は選択中の{year}年度。年度切替は金額のみを変更し、評価は変わりません。各軸4点満点。調査済み：{series.filter(s => assessments[s.id]).length} / {series.length}区分。採点済み：{scored} / {series.length * 5}項目。</p>
    <div className="mt-3 hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-sm">
      <caption className="sr-only">税額控除7区分の試行評価。資料不足で保留した項目は理由を表示。</caption>
      <thead className="border-b border-mirai-border text-xs text-mirai-text-secondary"><tr>{['制度・区分名', `${year}年度適用額`, ...axes, '推奨アクション'].map((h, i) => <th key={h} scope="col" className={`px-3 py-2.5 font-medium ${i === 1 ? 'text-right' : 'text-left'} ${i >= 2 && i < 7 ? 'w-[92px]' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>{series.map(s => { const a = assessments[s.id]; return <tr key={s.id} className={`border-b border-mirai-border ${selected === s.id ? 'bg-mirai-surface-teal' : ''}`}><th scope="row" className="px-3 py-3 text-left"><Button variant="link" className="whitespace-normal text-left text-primary-accent" onClick={() => open(s.id)} aria-expanded={selected === s.id} aria-label={`${s.name}の評価根拠を開く`}>{s.name}</Button><span className="mt-0.5 block text-xs font-normal text-mirai-text-subtle">{a ? `${a.scores.filter(x => x.score !== null).length}/5軸を採点` : '未調査'}</span></th><td className="px-3 py-3 text-right tabular-nums">{s.total === null ? '—' : creditAmount(s.total)}</td>{axes.map((axis, i) => <td key={axis} className="px-3 py-3"><ScoreCell axis={a?.scores[i]} assessed={!!a} /></td>)}<td className="px-3 py-3 text-sm">{a?.action ?? '資料調査から着手'}</td></tr>; })}</tbody>
    </table></div>
    <ul className="mt-3 space-y-3 md:hidden">{series.map(s => { const a = assessments[s.id]; return <li key={s.id} className={`rounded-xl border border-mirai-border p-4 ${selected === s.id ? 'bg-mirai-surface-teal' : ''}`}>
      <div className="flex items-start justify-between gap-3"><Button variant="link" className="whitespace-normal text-left text-primary-accent" onClick={() => open(s.id)} aria-label={`${s.name}の評価根拠を開く`}>{s.name}</Button><span className="shrink-0 text-sm tabular-nums">{s.total === null ? '—' : creditAmount(s.total)}</span></div>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs">{axes.map((axis, i) => <div key={axis} className="contents"><dt className="text-mirai-text-secondary">{axis}</dt><dd><ScoreCell axis={a?.scores[i]} assessed={!!a} /></dd></div>)}</dl>
      <p className="mt-3 text-xs"><span className="text-mirai-text-secondary">推奨：</span>{a?.action ?? '資料調査から着手'}</p>
    </li>; })}</ul>
    {series.length === 0 && <p className="mt-4 text-sm">この検索条件では評価対象の制度がありません。</p>}
    {detail && <div id="tax-assessment-detail" className="mt-5 scroll-mt-24 space-y-4 rounded-xl border border-mirai-border bg-mirai-surface p-4" role="region" aria-label={`${detail.name}の評価根拠`}>
      <div className="flex items-center justify-between gap-3"><h4 className="font-bold">{detail.name}：評価根拠</h4><Button size="sm" variant="outline" onClick={() => setSelected(null)}>閉じる</Button></div>
      {!assessment ? <p className="text-sm">政策評価資料の調査に未着手です。資料不足と判断したわけではないため、検証可能性も未採点です。</p> : <>
        {assessment.scores.map((axis, i) => <div key={axes[i]} className="rounded-lg bg-card p-4"><h5 className="font-semibold">{axes[i]}：{axis.score === null ? '判定保留' : `${axis.score} / 4点`}</h5><p className="mt-2 text-sm leading-6">{axis.reason}</p><ul className="mt-2 space-y-1 text-xs">{axis.sources.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="text-primary-accent underline underline-offset-4">{s.title} ↗</a>（{s.published}公表・{s.pages}）</li>)}</ul></div>)}
        <div><h5 className="font-semibold">検証可能性の加点・減点内訳</h5><ul className="mt-2 space-y-3 text-sm">{assessment.verification.map(v => <li key={v.label}><strong>{v.met ? '確認済み：1点' : '資料不足：0点（−1点）'} · {v.label}</strong><p className="mt-1 leading-6">{v.reason}</p></li>)}</ul></div>
        <div className="rounded-lg bg-mirai-surface-teal p-4"><h5 className="font-semibold">推奨アクション：{assessment.action}</h5><p className="mt-2 text-sm leading-6">{assessment.next}</p></div>
        {detail.id === 'mof-2024-r217' && <WageIdentification />}
      </>}
    </div>}
  </Card>;
}

function ScoreDots({ score }: { score: number }) {
  return <span className="flex gap-0.5" aria-hidden="true">{[1, 2, 3, 4].map(n => <span key={n} className={`h-2.5 w-2 rounded-sm ${n <= score ? 'bg-primary' : 'bg-mirai-surface-grouped'}`} />)}</span>;
}

function Pending() {
  return <span className="rounded border border-dashed border-mirai-text-subtle px-1 text-xs leading-4 text-mirai-text-secondary" aria-hidden="true">保留</span>;
}

function ScoreCell({ axis, assessed }: { axis?: AxisAssessment; assessed: boolean }) {
  if (!assessed || !axis) return <span className="text-xs text-mirai-text-subtle">未調査</span>;
  if (axis.score === null) return <span title={axis.reason} className="inline-flex items-center"><Pending /><span className="sr-only">判定保留</span></span>;
  return <span title={axis.reason} className="inline-flex items-center gap-1.5"><ScoreDots score={axis.score} /><span className="text-xs font-bold tabular-nums text-primary-accent">{axis.score}/4</span></span>;
}
