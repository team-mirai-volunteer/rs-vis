'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { AgeDataset, ConsumptionDataset } from '@/types/tax-burden';
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
const PENSION_COLOR = 'rgba(80, 120, 200, 0.55)';
type SeriesKey = typeof SERIES[number]['key'];
type Mode = 'rate' | 'amount';
type Axis = 'income' | 'age';

interface Row {
  key: string; title: string; subtitle: string; denominator: number; denominatorLabel: string;
  parts: Record<SeriesKey, number>; total: number; rate: number; householdSize: number; headAge: number; extra: { label: string; value: string }[];
  /** Public pension received (age axis only); shown as a negative bar and subtracted in the net figure. */
  pension: number;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const yen = (n: number) => `${Math.round(n).toLocaleString('ja-JP')}円`;
const man = (n: number) => `${Math.round(n / 10000).toLocaleString('ja-JP')}万円`;

function partsOf(d: { directTaxes: { incomeTax: number; residentTax: number; other: number }; socialInsurance: { pension: number; health: number; care: number; other: number }; standardGross: number; reducedGross: number; exemptGross: number }) {
  const vat = consumptionTax({ standardGross: d.standardGross, reducedGross: d.reducedGross, exemptGross: d.exemptGross }, 0.1, 0.08, 'net-fixed').tax;
  return {
    incomeTax: d.directTaxes.incomeTax, residentTax: d.directTaxes.residentTax, otherTax: d.directTaxes.other,
    pension: d.socialInsurance.pension, health: d.socialInsurance.health, care: d.socialInsurance.care, otherInsurance: d.socialInsurance.other,
    consumption: vat,
  };
}

export function StatsPanel({ data, age }: { data: ConsumptionDataset; age: AgeDataset | null }) {
  const [mode, setMode] = useState<Mode>('rate');
  const [axis, setAxis] = useState<Axis>('income');
  const [population, setPopulation] = useState(0);
  const bound = (lower: number | null, upper: number | null) => lower === null ? `〜${Math.round(upper! / 10000)}万円` : upper === null ? `${Math.round(lower / 10000)}万円〜` : `${Math.round(lower / 10000)}〜${Math.round(upper / 10000)}万円`;

  let rows: Row[];
  let sourceMeta: { survey: string; sourceUrl: string; notes: string[]; retrievedOn: string };
  let denominatorNote: string;
  if (axis === 'income' || !age) {
    rows = data.deciles.map(d => {
      const parts = partsOf(d); const total = Object.values(parts).reduce((s, v) => s + v, 0);
      return { key: `d${d.decile}`, title: `第${d.decile}十分位`, subtitle: `${bound(d.lowerBound, d.upperBound)}・平均${man(d.annualIncome)}`, denominator: d.annualIncome, denominatorLabel: '年間収入',
        parts, total, rate: total / d.annualIncome, householdSize: d.householdSize, headAge: d.headAge, pension: 0,
        extra: [{ label: mode === 'rate' ? '平均消費性向' : '可処分所得', value: mode === 'rate' ? pct(d.propensity) : yen(d.disposableAnnual) }] };
    });
    sourceMeta = { survey: data.metadata.survey, sourceUrl: data.metadata.sourceUrl, notes: data.metadata.notes, retrievedOn: data.metadata.retrievedOn };
    denominatorNote = `${data.metadata.population}。分母は各階級の平均年間収入。`;
  } else {
    const group = age.groups[Math.min(population, age.groups.length - 1)];
    rows = group.classes.map(c => {
      const parts = partsOf(c); const total = Object.values(parts).reduce((s, v) => s + v, 0);
      return { key: c.label, title: c.label, subtitle: `実収入 ${man(c.realIncomeAnnual)}${c.pensionBenefitAnnual > c.salaryAnnual ? `（うち年金 ${man(c.pensionBenefitAnnual)}）` : ''}`, denominator: c.realIncomeAnnual, denominatorLabel: '実収入',
        parts, total, rate: total / c.realIncomeAnnual, householdSize: c.householdSize, headAge: c.headAge, pension: c.pensionBenefitAnnual,
        extra: [{ label: '公的年金給付（差し引き）', value: mode === 'rate' ? `−${pct(c.pensionBenefitAnnual / c.realIncomeAnnual)}` : `−${yen(c.pensionBenefitAnnual)}` }, { label: '負担 − 年金', value: mode === 'rate' ? pct((total - c.pensionBenefitAnnual) / c.realIncomeAnnual) : yen(total - c.pensionBenefitAnnual) }, { label: '可処分所得', value: yen(c.disposableAnnual) }] };
    });
    sourceMeta = { survey: age.metadata.survey, sourceUrl: age.metadata.sourceUrl, notes: age.metadata.notes, retrievedOn: age.metadata.retrievedOn };
    denominatorNote = `${group.population}。年齢階級別の年間収入は非公表のため、率の分母は実収入（勤め先収入・公的年金給付等の年額換算）。公的年金給付は負担のマイナスとして左側に描き、「負担 − 年金」を併記。`;
  }
  const hasPension = rows.some(r => r.pension > 0);
  const maxRate = Math.max(...rows.map(r => Math.max(r.rate, r.pension / r.denominator)));
  const maxTotal = Math.max(...rows.map(r => Math.max(r.total, r.pension)));
  const cell = (value: number, r: Row) => mode === 'rate' ? pct(value / r.denominator) : yen(value);
  const barWidth = (value: number, r: Row) => mode === 'rate' ? value / r.denominator / maxRate * 100 : value / maxTotal * 100;
  const axisLabel = axis === 'income' ? '年収十分位別' : '世帯主年齢階級別';
  const modes: { id: Mode; label: string }[] = [{ id: 'rate', label: '負担率' }, { id: 'amount', label: '負担額（年額）' }];
  const axes: { id: Axis; label: string; disabled?: boolean }[] = [{ id: 'income', label: '年収階級' }, { id: 'age', label: '世帯主の年齢', disabled: !age }];
  return <div className="space-y-5">
    <Card><CardHeader className="gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{axisLabel}の{mode === 'rate' ? '負担率' : '負担額'}（実測＋消費税推計）</h2><p className="text-xs text-mirai-text-secondary">{sourceMeta.survey}・{denominatorNote}直接税・社会保険料は公表値（月額×12）、消費税は課税区分別の税込支出からの推計。</p></div></div>
      <div className="flex flex-wrap gap-4">
        <div role="group" aria-label="軸の切替" className="flex gap-2">{axes.map(a => <Button key={a.id} size="sm" variant={axis === a.id ? 'default' : 'outline'} aria-pressed={axis === a.id} disabled={a.disabled} onClick={() => setAxis(a.id)}>{a.label}</Button>)}</div>
        <div role="group" aria-label="表示の切替" className="flex gap-2">{modes.map(m => <Button key={m.id} size="sm" variant={mode === m.id ? 'default' : 'outline'} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</Button>)}</div>
        {axis === 'age' && age && <div role="group" aria-label="世帯の種類" className="flex gap-2">{age.groups.map((g, i) => <Button key={g.population} size="sm" variant={population === i ? 'default' : 'outline'} aria-pressed={population === i} onClick={() => setPopulation(i)}>{g.population.replace('二人以上の世帯のうち', '')}</Button>)}</div>}
      </div></CardHeader>
      <CardContent>
        {hasPension && <p className="mb-2 text-xs text-mirai-text-secondary">左側（青）は公的年金の受給を負担のマイナスとして中央の0から左に描く。右側は税・保険料・消費税推計。右端の数字は「負担 − 年金」。</p>}
        <div className="space-y-2">{rows.map(r => <div key={r.key} className="grid items-center gap-2 text-xs sm:grid-cols-[170px_minmax(0,1fr)_90px]">
          <div><span className="font-bold">{r.title}</span><span className="block text-mirai-text-secondary">{r.subtitle}</span></div>
          <div className="flex h-6 w-full items-stretch" role="img" aria-label={`${r.title} ${mode === 'rate' ? `負担率${pct(r.rate)}` : `負担額${yen(r.total)}`}${r.pension > 0 ? `、年金受給${mode === 'rate' ? pct(r.pension / r.denominator) : yen(r.pension)}` : ''}`}>
            {hasPension && <div className="flex w-1/2 justify-end overflow-hidden rounded-l-md bg-mirai-surface"><div style={{ width: `${barWidth(r.pension, r)}%`, backgroundColor: PENSION_COLOR }} title={`公的年金給付 ${pct(r.pension / r.denominator)}（${yen(r.pension)}）`} /></div>}
            <div className={`flex overflow-hidden bg-mirai-surface ${hasPension ? 'w-1/2 rounded-r-md border-l-2 border-mirai-text' : 'w-full rounded-md'}`}>
              {SERIES.map(s => <div key={s.key} style={{ width: `${barWidth(r.parts[s.key], r)}%`, backgroundColor: s.color }} title={`${s.label} ${pct(r.parts[s.key] / r.denominator)}（${yen(r.parts[s.key])}）`} />)}
            </div>
          </div>
          <div className="text-right font-bold tabular-nums">{hasPension ? (mode === 'rate' ? pct((r.total - r.pension) / r.denominator) : man(r.total - r.pension)) : mode === 'rate' ? pct(r.rate) : man(r.total)}</div>
        </div>)}</div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mirai-text-secondary">{hasPension && <span className="inline-flex items-center gap-1"><span className="inline-block size-3 rounded-sm" style={{ backgroundColor: PENSION_COLOR }} />公的年金給付（差し引き）</span>}{SERIES.map(s => <span key={s.key} className="inline-flex items-center gap-1"><span className="inline-block size-3 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}</span>)}</div>
        <div className="mt-5 overflow-x-auto"><table className="w-full text-xs tabular-nums"><thead><tr className="text-mirai-text-secondary"><th scope="col" className="py-1 text-left">階級</th><th scope="col" className="text-right">{rows[0]?.denominatorLabel}</th><th scope="col" className="text-right">世帯人員</th><th scope="col" className="text-right">世帯主年齢</th><th scope="col" className="text-right">直接税</th><th scope="col" className="text-right">社会保険料</th><th scope="col" className="text-right">消費税（推計）</th><th scope="col" className="text-right">合計</th>{rows[0]?.extra.map(e => <th key={e.label} scope="col" className="text-right">{e.label}</th>)}</tr></thead>
          <tbody>{rows.map(r => <tr key={r.key} className="border-t border-mirai-border/30"><th scope="row" className="py-1 text-left font-normal">{r.title}</th><td className="text-right">{man(r.denominator)}</td><td className="text-right">{r.householdSize.toFixed(2)}人</td><td className="text-right">{r.headAge.toFixed(1)}歳</td><td className="text-right">{cell(r.parts.incomeTax + r.parts.residentTax + r.parts.otherTax, r)}</td><td className="text-right">{cell(r.parts.pension + r.parts.health + r.parts.care + r.parts.otherInsurance, r)}</td><td className="text-right">{cell(r.parts.consumption, r)}</td><td className="text-right font-bold">{mode === 'rate' ? pct(r.rate) : yen(r.total)}</td>{r.extra.map(e => <td key={e.label} className="text-right">{e.value}</td>)}</tr>)}</tbody></table></div>
        {mode === 'amount' && rows.length > 1 && <p className="mt-3 text-xs text-mirai-text-secondary">最大階級（{rows.reduce((a, b) => b.total > a.total ? b : a).title}）の負担額は最小階級（{rows.reduce((a, b) => b.total < a.total ? b : a).title}）の約{(Math.max(...rows.map(r => r.total)) / Math.min(...rows.map(r => r.total))).toFixed(1)}倍。</p>}
        <div className="mt-5 flex flex-wrap gap-3"><Button asChild variant="outline"><a href={sourceMeta.sourceUrl} target="_blank" rel="noreferrer">e-Statの原表を確認する<ArrowRight /></a></Button></div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-relaxed text-mirai-text-secondary">{sourceMeta.notes.map(n => <li key={n}>{n}</li>)}</ul>
      </CardContent>
    </Card>
    <Card><CardContent className="space-y-3 pt-6 text-sm leading-relaxed"><p className="font-bold">まだ収録していないもの</p><p>世帯主年齢×年収×家族構成の同時クロス（全国家計構造調査）、単身世帯、1億円の壁（申告所得税標本調査）、全国推計用の復元世帯数。未取得の統計をモデル値で置き換えていません。</p></CardContent></Card>
  </div>;
}
