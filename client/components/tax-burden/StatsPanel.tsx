'use client';

import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ConsumptionDataset } from '@/types/tax-burden';
import { consumptionTax } from '@/app/lib/tax-burden/consumption-tax';

const SERIES = [
  { key: 'incomeTax', label: '勤労所得税', color: 'var(--primary-accent)' },
  { key: 'residentTax', label: '個人住民税', color: 'var(--primary)' },
  { key: 'otherTax', label: '他の税', color: 'var(--mirai-text-subtle)' },
  { key: 'pension', label: '公的年金保険料', color: 'var(--stance-neutral)' },
  { key: 'health', label: '健康保険料', color: 'var(--mirai-reaction-active)' },
  { key: 'care', label: '介護保険料', color: 'var(--mirai-text)' },
  { key: 'otherInsurance', label: '他の社会保険料', color: 'var(--mirai-border)' },
  { key: 'consumption', label: '消費税（推計）', color: 'rgba(217, 119, 87, 0.85)' },
] as const;

export function StatsPanel({ data }: { data: ConsumptionDataset }) {
  const rows = data.deciles.map(d => {
    const vat = consumptionTax({ standardGross: d.standardGross, reducedGross: d.reducedGross, exemptGross: d.exemptGross }, 0.1, 0.08, 'net-fixed').tax;
    const parts = {
      incomeTax: d.directTaxes.incomeTax, residentTax: d.directTaxes.residentTax, otherTax: d.directTaxes.other,
      pension: d.socialInsurance.pension, health: d.socialInsurance.health, care: d.socialInsurance.care, otherInsurance: d.socialInsurance.other,
      consumption: vat,
    };
    const total = Object.values(parts).reduce((s, v) => s + v, 0);
    return { ...d, parts, total, rate: total / d.annualIncome };
  });
  const maxRate = Math.max(...rows.map(r => r.rate));
  const fmt = (n: number) => `${(n * 100).toFixed(1)}%`;
  const bound = (d: typeof rows[number]) => d.lowerBound === null ? `〜${Math.round(d.upperBound! / 10000)}万円` : d.upperBound === null ? `${Math.round(d.lowerBound / 10000)}万円〜` : `${Math.round(d.lowerBound / 10000)}〜${Math.round(d.upperBound / 10000)}万円`;
  return <div className="space-y-5">
    <Card><CardHeader><h2 className="font-bold">年収十分位別の負担率（実測＋消費税推計）</h2><p className="text-xs text-mirai-text-secondary">{data.metadata.survey}・{data.metadata.population}。直接税・社会保険料は公表値（月額×12）、消費税は課税区分別の税込支出からの推計。分母は各階級の平均年間収入。</p></CardHeader>
      <CardContent>
        <div className="space-y-2">{rows.map(r => <div key={r.decile} className="grid items-center gap-2 text-xs sm:grid-cols-[150px_minmax(0,1fr)_60px]">
          <div><span className="font-bold">第{r.decile}十分位</span><span className="block text-mirai-text-secondary">{bound(r)}・平均{Math.round(r.annualIncome / 10000).toLocaleString('ja-JP')}万円</span></div>
          <div className="flex h-6 w-full overflow-hidden rounded-md bg-mirai-surface" role="img" aria-label={`第${r.decile}十分位 負担率${fmt(r.rate)}`}>
            {SERIES.map(s => <div key={s.key} style={{ width: `${r.parts[s.key] / r.annualIncome / maxRate * 100}%`, backgroundColor: s.color }} title={`${s.label} ${fmt(r.parts[s.key] / r.annualIncome)}（${r.parts[s.key].toLocaleString('ja-JP')}円）`} />)}
          </div>
          <div className="text-right font-bold tabular-nums">{fmt(r.rate)}</div>
        </div>)}</div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mirai-text-secondary">{SERIES.map(s => <span key={s.key} className="inline-flex items-center gap-1"><span className="inline-block size-3 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}</span>)}</div>
        <div className="mt-5 overflow-x-auto"><table className="w-full text-xs tabular-nums"><thead><tr className="text-mirai-text-secondary"><th scope="col" className="py-1 text-left">十分位</th><th scope="col" className="text-right">世帯人員</th><th scope="col" className="text-right">世帯主年齢</th><th scope="col" className="text-right">直接税</th><th scope="col" className="text-right">社会保険料</th><th scope="col" className="text-right">消費税（推計）</th><th scope="col" className="text-right">合計</th><th scope="col" className="text-right">平均消費性向</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.decile} className="border-t border-mirai-border/30"><th scope="row" className="py-1 text-left font-normal">第{r.decile}</th><td className="text-right">{r.householdSize.toFixed(2)}人</td><td className="text-right">{r.headAge.toFixed(1)}歳</td><td className="text-right">{fmt((r.parts.incomeTax + r.parts.residentTax + r.parts.otherTax) / r.annualIncome)}</td><td className="text-right">{fmt((r.parts.pension + r.parts.health + r.parts.care + r.parts.otherInsurance) / r.annualIncome)}</td><td className="text-right">{fmt(r.parts.consumption / r.annualIncome)}</td><td className="text-right font-bold">{fmt(r.rate)}</td><td className="text-right">{(r.propensity * 100).toFixed(1)}%</td></tr>)}</tbody></table></div>
        <div className="mt-5 flex flex-wrap gap-3"><Button asChild variant="outline"><a href={data.metadata.sourceUrl} target="_blank" rel="noreferrer">e-Statの原表を確認する<ArrowRight /></a></Button></div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-relaxed text-mirai-text-secondary">{data.metadata.notes.map(n => <li key={n}>{n}</li>)}</ul>
      </CardContent>
    </Card>
    <Card><CardContent className="space-y-3 pt-6 text-sm leading-relaxed"><p className="font-bold">まだ収録していないもの</p><p>世帯主年齢×年収×家族構成の同時クロス（全国家計構造調査）、高齢者世帯（国民生活基礎調査）、1億円の壁（申告所得税標本調査）、全国推計用の復元世帯数。未取得の統計をモデル値で置き換えていません。</p></CardContent></Card>
  </div>;
}
