'use client';

import { useState } from 'react';
import panel from '@/app/lib/tax-expenditures/company-panel.json';

const years = ['2023', '2024', '2025'];
const companies = Array.from(new Set(panel.rows.map(r => r.company_key))).map(key => {
  const rows = panel.rows.filter(r => r.company_key === key);
  return { key, name: rows[0].company, rows, before: rows.find(r => r.fiscal_end === '2024-03-31')! };
}).sort((a, b) => a.before.employees_nonconsolidated - b.before.employees_nonconsolidated);

export function CompanyPanel() {
  const [width, setWidth] = useState('500');
  const selected = companies.filter(c => width === 'all' || Math.abs(c.before.employees_nonconsolidated - 2000) <= Number(width));
  const below = selected.filter(c => c.before.employees_nonconsolidated <= 2000).length;
  return <details className="mt-4 border-t border-mirai-border pt-4">
    <summary className="cursor-pointer font-semibold text-primary-accent">取得した企業データ：{companies.length}社・{panel.rows.length}観測</summary>
    <section aria-label="公開有報の企業比較" className="mt-3 space-y-3 text-sm">
      <p className="leading-6">2023〜2025年3月期の公開有報。各欄は単体従業員数と平均年間給与です。取得可能性を調べるために選んだ標本で、全企業を代表するものではありません。</p>
      <label className="block">改正前の人数で絞る <select aria-label="企業比較の人数範囲" value={width} onChange={e => setWidth(e.target.value)} className="ml-2 rounded-lg border border-mirai-border bg-card p-2 focus-visible:ring-2 focus-visible:ring-primary">
        <option value="100">2,000人 ±100人</option><option value="250">2,000人 ±250人</option><option value="500">2,000人 ±500人</option><option value="all">取得した全社</option>
      </select></label>
      <p role="status">表示：{selected.length}社。2,000人以下：{below}社 ／ 2,000人超：{selected.length - below}社</p>
      <p className="text-xs leading-5 text-mirai-text-secondary">範囲は2024年3月末の有報人数で固定。税法上の適格性による分類ではありません。平均給与の増減は税制効果や同じ社員の昇給率を表しません。</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm">
        <caption className="sr-only">企業別の単体従業員数と平均年間給与。各年度の出典PDFへのリンク付き。</caption>
        <thead className="bg-mirai-surface"><tr><th scope="col" className="p-3 text-left">企業</th>{years.map(y => <th scope="col" className="p-3 text-left" key={y}>{y}年3月期</th>)}<th scope="col" className="p-3 text-left">平均給与の増減<br />2024→2025年3月期</th></tr></thead>
        <tbody>{selected.map(c => {
          const after = c.rows.find(r => r.fiscal_end === '2025-03-31')!;
          const change = (after.average_annual_salary_jpy / c.before.average_annual_salary_jpy - 1) * 100;
          return <tr key={c.key} className="border-b border-mirai-border"><th scope="row" className="p-3 text-left">{c.name}{c.rows.some(r => r.employee_definition_changed) && <span className="mt-1 block text-xs font-normal text-mirai-text-secondary">人数の定義変更あり</span>}</th>{years.map(y => {
            const r = c.rows.find(row => row.fiscal_end.startsWith(y))!;
            return <td key={y} className="p-3 tabular-nums"><a href={`${r.source_url}#page=${r.pdf_page}`} target="_blank" rel="noreferrer" className="text-primary-accent underline underline-offset-4" aria-label={`${c.name} ${y}年3月期の原資料`}>{r.employees_nonconsolidated.toLocaleString('ja-JP')}人<br />{(r.average_annual_salary_jpy / 10000).toFixed(1)}万円 ↗</a></td>;
          })}<td className="p-3 tabular-nums">{after.employee_definition_changed ? '比較要確認' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`}</td></tr>;
        })}</tbody>
      </table></div>
      {selected.length === 0 && <p>この範囲の企業は今回の標本にありません。</p>}
      <p className="leading-6">ダイダンは2025年3月期に有期雇用者を含む人数へ集計方法を変更しています。2,000人を超えたことを、採用増や税制上の区分変更と判断できません。</p>
      <p className="leading-6">不足項目：税法上の人数、継続雇用者給与、所有関係を含む適格性、賃上げ税制の控除額。未確認の値をゼロで埋めていません。事前推移の検証には、さらに古い年度も必要です。</p>
      <a href="/tax-expenditures/company-panel.csv" download className="inline-block text-primary-accent underline underline-offset-4">全観測と出典をCSVでダウンロード</a>
      <p className="text-xs text-mirai-text-secondary">確認日：{panel.checkedAt}。金額・人数は原資料の単位を統一した値。外数の臨時従業員等は人数に合算していません。</p>
    </section>
  </details>;
}
