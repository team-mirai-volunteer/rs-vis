'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart3, ClipboardCheck, Info, ListFilter, RotateCcw, Search, X } from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import data from '@/app/lib/tax-expenditures/data.json';
import companyPanel from '@/app/lib/tax-expenditures/company-panel.json';
import { creditSeries } from '@/app/lib/tax-expenditures/credits';
import { CreditChart } from './credit-chart';
import { AssessmentTable } from './assessment-table';

type Year = '2022' | '2023' | '2024';
const number = (n: number | null) => n === null ? '—' : n.toLocaleString('ja-JP');
const source = 'https://www.mof.go.jp/tax_policy/reference/stm_report/fy2025/index.html';
const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/\s/g, '');
const panel = 'p-5 sm:p-6';
const focus = 'outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const field = `mt-2 block w-full rounded-lg border border-mirai-border bg-card px-3 py-2.5 text-mirai-text placeholder:text-mirai-text-placeholder ${focus}`;
const link = `text-primary-accent underline underline-offset-4 rounded-sm ${focus}`;

export default function TaxExpenditures() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<'amount' | 'assessment' | 'measures'>('amount');
  const [query, setQuery] = useState('');
  const [year, setYear] = useState<Year>('2024');
  const [linkedOnly, setLinkedOnly] = useState(false);
  const measures = useMemo(() => data.measures.filter(m =>
    (!linkedOnly || m.rsProjectId !== null) && normalize(`${m.name}${m.article}${m.overview}${m.aliases}`).includes(normalize(query))
  ), [query, linkedOnly]);
  const ids = new Set(measures.map(m => m.id));

  return <div className="min-h-screen bg-background text-foreground">
    <AppHeader current="/tax-expenditures"><Button variant="outline" size="sm" onClick={() => dialog.current?.showModal()}><Info aria-hidden="true" />データについて</Button></AppHeader>
    <main className="mx-auto max-w-screen-2xl space-y-5 px-3 pb-10 pt-5">
      <header className="rounded-2xl bg-mirai-gradient p-6 sm:p-8">
        <p className="mb-2 text-xs font-bold">租税特別措置(試作)</p>
        <h1 className="text-2xl font-bold tracking-normal sm:text-3xl">税優遇は、どこに届いている？</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed">法人税の租税特別措置を、適用額・政策評価・制度の詳細から調べます。関連する行政事業レビュー（RS）もたどれます。</p>
      </header>
      <nav aria-label="租税特別措置の表示切替" className="flex flex-wrap gap-2">
        {([{ id: 'amount', label: '適用額を見る', icon: BarChart3 }, { id: 'assessment', label: '妥当性を評価', icon: ClipboardCheck }, { id: 'measures', label: '制度一覧', icon: ListFilter }] as const).map(({ id, label, icon: Icon }) => <Button key={id} variant={view === id ? 'default' : 'outline'} aria-pressed={view === id} onClick={() => setView(id)}><Icon aria-hidden="true" />{label}</Button>)}
      </nav>
      <section aria-label="制度を調べる" className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-5" aria-label="制度の絞り込み">
        <Card className={`${panel} space-y-4`}>
          <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-bold"><Search className="size-4 text-primary-accent" aria-hidden="true" />制度を絞り込む</h2><Button variant="ghost" size="icon" aria-label="絞り込みをリセット" onClick={() => { setQuery(''); setLinkedOnly(false); setYear('2024'); }}><RotateCcw className="size-4" /></Button></div>
          <div className="flex flex-col gap-4">
            <label className="flex-1 text-sm font-medium">制度名・条文・キーワード
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="例：研究開発、給与、ふるさと納税" className={`${field} font-normal`} />
            </label>
            <label className="text-sm font-medium">適用年度
              <select aria-label="適用年度" value={year} onChange={e => setYear(e.target.value as Year)} className={field}>{['2024', '2023', '2022'].map(y => <option key={y} value={y}>{y}年度</option>)}</select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input className={`size-4 accent-primary ${focus}`} type="checkbox" checked={linkedOnly} onChange={e => setLinkedOnly(e.target.checked)} />RSとの関連を確認済みの制度のみ</label>
          <p role="status" className="text-sm text-mirai-text-secondary">{measures.length} / {data.measures.length} 表区分を表示 <span className="text-xs">（原表の条文・制度区分で分割。報告書の76項目とは数え方が異なります）</span></p>
        </Card>
        </aside>
        <div className="min-w-0 space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: '表示する実績', value: `${year}年度`, note: '財務省の法人税関係・適用実態' },
              { label: '評価・グラフの対象', value: `税額控除${creditSeries(year, ids).length}区分`, note: '検索条件に一致する対象区分' },
              { label: '企業の公開データ', value: `${new Set(companyPanel.rows.map(r => r.company_key)).size}社・${companyPanel.rows.length}観測`, note: '賃上げ税制の評価根拠から確認' },
            ].map(item => <Card key={item.label} className="p-5"><p className="text-xs text-mirai-text-secondary">{item.label}</p><p className="mt-2 font-lexend text-xl font-medium tabular-nums text-primary-accent">{item.value}</p><p className="mt-2 text-xs text-mirai-text-secondary">{item.note}</p></Card>)}
          </div>
          <p className="text-xs leading-5 text-mirai-text-secondary">対象は法人税関係の適用実態です。租特全体の減収額や、廃止による増収額を示すものではありません。</p>
        {year !== '2024' && <p className="text-sm text-mirai-text-secondary">{year}年度は今回の総括表に載る比較値です。その年度の全制度を網羅する一覧ではありません。</p>}
        <div hidden={view !== 'assessment'}><AssessmentTable year={year} ids={ids} /></div>
        <div hidden={view !== 'amount'}><CreditChart year={year} ids={ids} onSelect={id => {
          setView('measures');
          requestAnimationFrame(() => {
          const detail = document.getElementById(id) as HTMLDetailsElement | null;
          if (detail) {
            detail.open = true;
            detail.scrollIntoView({ block: 'start' });
            detail.querySelector('summary')?.focus({ preventScroll: true });
          }
          });
        }} /></div>
        <div hidden={view !== 'measures'} className="space-y-3">
        <h2 className="text-lg font-bold">制度一覧</h2>
        {measures.length === 0 && <Card className={panel}>該当する制度がありません。キーワードや絞り込みを変更してください。</Card>}
        {measures.map(m => <Card key={m.id} className={panel}><details id={m.id} className="group scroll-mt-24">
          <summary className={`cursor-pointer rounded-sm marker:text-primary-accent ${focus}`}>
            <span className="ml-1 text-xs text-mirai-text-subtle">租税特別措置法 {m.article}条</span>
            <span className="mt-2 block text-base font-semibold">{m.name}</span>
            <Badge variant={m.rsProjectId ? 'default' : 'secondary'} className="mt-2">{m.rsProjectId ? 'RS関連を確認済み · 制度の普及' : 'RS関連：未確認'}</Badge>
          </summary>
          <div className="mt-5 space-y-4 border-t border-mirai-border pt-5 text-sm">
            <p className="whitespace-pre-line leading-7 text-mirai-text-secondary">{m.overview}</p>
            <p className="text-mirai-text-subtle">原資料の適用期限：{m.deadline || '記載なし'}（2025年4月1日時点。現行制度の期限とは限りません）</p>
            {m.rsProjectId && <div className="rounded-lg bg-mirai-surface-teal p-4 leading-7">
              <p className="font-semibold">制度の普及・運営に関するRS事業</p>
              <Link className={link} href="/quality?fiscalYear=2024&pid=127&detail=127">地方創生応援税制（企業版ふるさと納税）普及促進事業 →</Link>
              <p className="mt-2 text-xs leading-6">根拠：2025年度RSシート・事業ID 127の事業目的に、企業版ふるさと納税の制度内容や活用事例の広報を強化すると記載。税制の法人税部分がこの条文に対応します。制度全体には地方税の控除もあります。</p>
            </div>}
            <h3 className="font-semibold">{year}年度の適用実態</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px] text-right text-sm">
                <thead className="bg-mirai-surface"><tr>{['原表区分 / 法人区分', '適用件数', '適用法人数', '適用額（千円）'].map(h => <th key={h} className="p-3 font-medium first:text-left">{h}</th>)}</tr></thead>
                <tbody>{m.rows.filter(r => year === '2022' || r.entity !== '連結法人').map(r => <tr key={r.sourceRow} className="border-b border-mirai-border"><th className="p-3 text-left font-normal">{r.section} {r.entity}</th>{r.years[year].map((value, i) => <td key={i} className="p-3 tabular-nums">{number(value)}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p className="text-xs leading-6 text-mirai-text-subtle">「うち通算法人」は単体法人の内数です。足し合わせません。「—」は原表の空欄・横棒で、ゼロとは区別しています。区分記号は上の制度概要に対応します。金額の単位は原表どおり千円です。</p>
            <a className={link} href={data.sourceUrl} target="_blank" rel="noreferrer">総括表Excelで確認（「総括表」シート {m.sourceRow}行から）↗</a>
          </div>
        </details></Card>)}
        </div>
        </div>
      </section>
      <footer className="pb-8 text-xs leading-6 text-mirai-text-subtle">制度概要は原資料（原則2025年3月31日時点、改正内容の追記あり）から収録しています。最新の適用要件の確認には現行法令・各制度の案内をご利用ください。</footer>
    </main>
    <dialog ref={dialog} aria-labelledby="tax-data-title" className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-2xl border border-mirai-border bg-card p-0 text-mirai-text backdrop:bg-foreground/30">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-mirai-border bg-card p-5"><h2 id="tax-data-title" className="text-lg font-bold">データについて</h2><Button variant="ghost" size="icon" aria-label="データの説明を閉じる" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></Button></div>
      <div className="space-y-5 p-4 sm:p-6">
      <Card className={panel} role="region" aria-label="収録範囲">
        <div className="grid gap-5 sm:grid-cols-3">
          <div><p className="text-sm text-mirai-text-secondary">収録する実績</p><p className="mt-1 text-2xl font-bold">2024年度</p><p className="mt-1 text-xs text-mirai-text-subtle">2026年2月公表・過去2年度の比較列つき</p></div>
          <div><p className="text-sm text-mirai-text-secondary">適用件数（報告書全体）</p><p className="mt-1 text-2xl font-bold">2,513,286<span className="ml-1 text-sm">件</span></p><p className="mt-1 text-xs text-mirai-text-subtle">76項目・提出法人 1,517,466法人</p></div>
          <div><p className="text-sm text-mirai-text-secondary">税収減の総額</p><p className="mt-1 text-2xl font-bold">この資料では未収録</p><p className="mt-1 text-xs text-mirai-text-subtle">適用額の合計を減収額にはできません</p></div>
        </div>
        <p className="mt-5 border-t border-mirai-border pt-4 text-sm leading-6 text-mirai-text-secondary">対象は法人税関係の適用実態です。所得税・地方税を含む租税支出全体ではありません。適用額には税額控除額、対象所得、特別償却限度額、準備金の損金算入額などが混在します。縮減による増収額は別途推計が必要です。</p>
        <a className={`${link} mt-3 inline-block text-sm`} href={source} target="_blank" rel="noreferrer">財務省の報告書と集計の定義 ↗</a>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className={panel}>
          <h2 className="text-lg font-bold">RSとはどうつながる？</h2>
          <p className="mt-3 text-sm leading-7 text-mirai-text-secondary">租特は税負担を軽くする制度、RSは予算事業の点検です。この総括表にはRS事業IDがなく、自動で全件を結びつけることはできません。制度の普及事業など、根拠を確認できた関係を個別に登録しています。</p>
          <p className="mt-3 text-sm font-medium text-primary-accent">確認済み：企業版ふるさと納税 → 制度の普及促進事業</p>
          <p className="mt-2 text-xs leading-6 text-mirai-text-subtle">接続は政策上の関係です。税優遇額と事業費、受益法人と支出先は同一ではありません。未確認は「関連事業が存在しない」という意味ではありません。</p>
          <Button onClick={() => { setLinkedOnly(true); setQuery(''); setView('measures'); dialog.current?.close(); }} className="mt-3" size="sm">RSとの関連を確認する</Button>
        </Card>
        <Card className={panel}>
          <h2 className="text-lg font-bold">GTETI：租税支出の報告の透明性</h2>
          <p className="mt-2"><strong className="text-2xl">日本 37.1</strong><span className="text-sm text-mirai-text-secondary"> / 100点 · 88位 / 116か国・地域</span></p>
          <p className="mt-2 text-sm leading-6 text-mirai-text-secondary">税金の使い道全般ではなく、税優遇の報告を評価する指数です。日本は公開性と方法論・対象範囲の得点が特に低くなっています。</p>
          <details className="mt-3 text-sm">
            <summary className={`cursor-pointer rounded-sm font-medium ${focus}`}>5分野の内訳を見る</summary>
            <div className="mt-3 space-y-2">{[['公開性', 4], ['制度的枠組み', 12], ['方法論・対象範囲', 4.3], ['制度説明データ', 11.2], ['評価', 5.6]].map(([label, score]) => <div key={label} className="grid grid-cols-[1fr_90px_65px] items-center gap-3"><span>{label}</span><div className="h-2 rounded bg-mirai-surface-grouped"><div className="h-2 rounded bg-primary" style={{ width: `${Number(score) * 5}%` }} /></div><span className="text-right">{Number(score).toFixed(1)} / 20</span></div>)}</div>
          </details>
          <p className="mt-3 text-xs leading-5 text-mirai-text-subtle">v2.1（2026年5月11日更新）。評価対象は2024年末までに公表された報告書。このページの2026年公表資料を評価した点数ではありません。</p>
          <a className={`${link} mt-2 inline-block text-sm`} href="https://gteti.taxexpenditures.org/ranking/" target="_blank" rel="noreferrer">GTETI公式ランキング ↗</a>
        </Card>
      </section>

      </div>
    </dialog>
  </div>;
}
