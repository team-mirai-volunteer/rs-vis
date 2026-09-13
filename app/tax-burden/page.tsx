'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChartNoAxesCombined, ClipboardCheck, Database, Info, Landmark, Loader2, Share2, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AppHeader } from '@/components/navigation/AppHeader';
import { HOUSEHOLDS, initialTaxState } from '@/app/lib/tax-burden/households';
import { simulate } from '@/app/lib/tax-burden/simulate';
import { fiscalImpact } from '@/app/lib/tax-burden/fiscal-impact';
import { decodeTaxState, encodeTaxState } from '@/app/lib/tax-burden/reform-url';
import { CurveChart } from '@/client/components/tax-burden/CurveChart';
import { RangeField, TaxControls } from '@/client/components/tax-burden/TaxControls';
import { BurdenBreakdown, yen } from '@/client/components/tax-burden/BurdenBreakdown';
import { RevenuePanel } from '@/client/components/tax-burden/RevenuePanel';
import type { TaxParameters, TaxRevenue, TaxView } from '@/types/tax-burden';

const VIEWS = [
  { id: 'curve', label: '世帯の負担カーブ', icon: ChartNoAxesCombined },
  { id: 'reform', label: '改革案を比較', icon: SlidersHorizontal },
  { id: 'revenue', label: '国の税収', icon: Landmark },
  { id: 'stats', label: '実態統計', icon: Database },
] as const;

export default function TaxBurdenPage() {
  const [state, setState] = useState(initialTaxState);
  const [ready, setReady] = useState(false);
  const [params, setParams] = useState<TaxParameters | null>(null);
  const [revenue, setRevenue] = useState<TaxRevenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revenueError, setRevenueError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const shareInput = useRef<HTMLInputElement>(null);
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    const restore = () => {
      const decoded = decodeTaxState(window.location.search);
      setState(decoded.state); setWarning(decoded.warning); setReady(true);
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (ready) window.history.replaceState(null, '', `${window.location.pathname}?${encodeTaxState(state)}${window.location.hash}`);
  }, [ready, state]);

  useEffect(() => {
    const abort = new AbortController();
    setError(null);
    fetch('/api/tax-burden/params?fy=2025', { signal: abort.signal }).then(async r => {
      if (!r.ok) throw new Error('計算データを読み込めませんでした。再読み込みしてください。');
      return r.json();
    }).then(setParams).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [retry]);

  useEffect(() => {
    if (state.view !== 'revenue') return;
    const abort = new AbortController();
    setRevenueError(null);
    fetch('/api/tax-burden/revenue?fy=2025', { signal: abort.signal }).then(async r => {
      if (!r.ok) throw new Error('歳入データを読み込めませんでした。再読み込みしてください。');
      return r.json();
    }).then(setRevenue).catch(e => { if (!abort.signal.aborted) setRevenueError(e.message); });
    return () => abort.abort();
  }, [state.view, retry]);

  const before = useMemo(() => params ? simulate(state, params) : null, [state, params]);
  const after = useMemo(() => params ? simulate(state, params, state.reform) : null, [state, params]);
  const impact = before && after ? fiscalImpact(before, after, state) : null;
  const selected = state.view === 'reform' ? after : before;
  const household = HOUSEHOLDS.find(h => h.id === state.household)!;
  const setView = (view: TaxView) => setState(s => ({ ...s, view }));
  const setIncome = (income: number) => setState(s => ({ ...s, income }));
  async function share() {
    const url = `${window.location.origin}/tax-burden?${encodeTaxState(state)}`;
    try { await navigator.clipboard.writeText(url); setNotice('共有URLをコピーしました。'); }
    catch { setShareUrl(url); setNotice('下の共有URLを選択してコピーしてください。'); setTimeout(() => shareInput.current?.select(), 0); }
  }

  return <div className="min-h-screen bg-background text-mirai-text">
    {/* 全ページ共通の浮島ヘッダー。ページ固有の「データについて」は右スロットに置く */}
    <AppHeader current="/tax-burden">
      <Button variant="outline" size="sm" className="border-mirai-border" onClick={() => dialog.current?.showModal()}><Info />データについて</Button>
    </AppHeader>
    <main className="mx-auto max-w-screen-2xl space-y-5 px-3 pb-5 pt-5">

      <section className="flex flex-col justify-between gap-5 rounded-2xl bg-mirai-gradient p-6 sm:flex-row sm:items-center sm:p-8">
        <div><p className="mb-2 text-xs font-bold tracking-normal">歳入・国民負担を考える</p><h1 className="text-2xl font-bold tracking-normal sm:text-3xl">誰が、どれだけ負担している？</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed">年収と家族構成から税・保険料・給付を眺め、制度を変えたときの違いを確かめます。</p></div>
        <Button variant="outline" onClick={share} disabled={!ready}><Share2 />この条件を共有する</Button>
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-mirai-border bg-card px-4 py-3 text-xs leading-relaxed">
        <span className="rounded-full bg-mirai-surface-teal px-3 py-1 font-bold text-primary-accent">試作・OECD未照合</span>
        <p>制度説明書に基づく参考計算です。翁カーブ原図の再現・実際の納税額との一致は未確認です。</p>
      </div>
      {warning && <p role="alert" className="rounded-xl bg-card p-4 text-sm">{warning}</p>}
      <div role="status" className={notice ? 'rounded-xl bg-mirai-surface-teal p-3 text-sm' : 'sr-only'}>{notice}</div>
      {shareUrl && <label className="block text-sm">共有URL<input ref={shareInput} value={shareUrl} readOnly onFocus={e => e.target.select()} className="mt-2 w-full rounded-xl border border-mirai-border bg-card p-3" /></label>}

      <nav aria-label="歳入・負担の表示切替" className="flex flex-wrap gap-2">
        {VIEWS.map(({ id, label, icon: Icon }) => <Button key={id} variant={state.view === id ? 'default' : 'outline'} aria-pressed={state.view === id} onClick={() => setView(id)}><Icon />{label}</Button>)}
      </nav>

      {(state.view === 'curve' || state.view === 'reform') && <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <TaxControls state={state} setState={setState} />
        <div className="min-w-0 space-y-5">
          {error ? <Card><CardContent className="space-y-3 pt-6"><p role="alert">{error}</p><Button onClick={() => setRetry(v => v + 1)}>再読み込みする</Button></CardContent></Card> : !params || !before || !selected ?
            <Card className="min-h-96"><CardContent className="flex items-center gap-3 pt-10" role="status"><Loader2 className="size-5 animate-spin" />計算データを読み込んでいます…</CardContent></Card> : <>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: state.view === 'reform' ? '改革案の純負担率' : '選択世帯の純負担率', value: selected.netRate === null ? '未定義' : `${(selected.netRate * 100).toFixed(1)}%`, note: selected.netRate === null ? '年収0円では率を計算しません' : household.label },
                  { label: '年間の純負担額', value: yen(selected.netBurden), note: '税・本人保険料 − 現金給付' },
                  { label: state.view === 'reform' ? '基準制度からの家計の改善額' : '年間の現金給付', value: yen(state.view === 'reform' ? before.netBurden - selected.netBurden : selected.benefits), note: state.view === 'reform' ? '＋は手取りが増える方向' : '児童手当・児童扶養手当' },
                ].map(item => <Card key={item.label}><CardContent className="pt-5"><p className="text-xs text-mirai-text-secondary">{item.label}</p><p className="mt-2 text-2xl font-bold tabular-nums text-primary-accent">{item.value}</p><p className="mt-2 text-xs text-mirai-text-secondary">{item.note}</p></CardContent></Card>)}
              </div>
              {selected.outOfScope && <p role="status" className="rounded-xl border border-mirai-border bg-card px-4 py-3 text-sm"><strong>適用範囲外の参考値：</strong>{selected.scopeReasons.join('、')}。就労者1人の下限は{yen(params.minimumAnnualWage)}です。</p>}
              <Card><CardHeader className="flex-row items-start justify-between gap-3"><div><h2 className="text-lg font-bold">年収と、税・保険料・給付の関係</h2><p className="mt-2 text-xs text-mirai-text-secondary">2025年版 ／ {state.view === 'reform' ? '基準制度と改革案' : '家族構成別の参考カーブ'}</p></div><Button size="sm" variant="ghost" onClick={() => dialog.current?.showModal()}><Info />計算条件</Button></CardHeader>
                <CardContent><CurveChart state={state} params={params} onIncomeChange={setIncome} />
                  <div className="mt-6 rounded-xl bg-mirai-surface p-4"><RangeField label="世帯年収" value={state.income / 10000} min={0} max={2000} suffix="万円" onChange={v => setIncome(Math.round(v * 10000))} />
                    <label className="mt-3 flex items-center justify-end gap-2 text-xs">年収を入力<input aria-label="世帯年収を万円で入力" type="number" min={0} max={2000} step={1} value={state.income / 10000} onChange={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) setIncome(Math.round(Math.max(0, Math.min(2000, n)) * 10000)); }} className="w-24 rounded-xl border border-mirai-border bg-card px-3 py-2 text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />万円</label>
                  </div>
                  <p className="mt-4 text-xs text-mirai-text-secondary">出典：<a className="text-primary-accent underline" href={params.metadata.sourceUrl} target="_blank" rel="noreferrer">OECD 日本の税・給付制度説明書 2025</a>。独自の試作計算。消費税・事業主負担は含みません。</p>
                </CardContent>
              </Card>
              <BurdenBreakdown before={before} after={state.view === 'reform' ? after ?? undefined : undefined} impact={state.view === 'reform' ? impact ?? undefined : undefined} />
            </>}
        </div>
      </div>}

      {state.view === 'revenue' && (revenueError ? <Card><CardContent className="space-y-3 pt-6"><p role="alert">{revenueError}</p><Button onClick={() => setRetry(v => v + 1)}>再読み込みする</Button></CardContent></Card> : revenue ? <RevenuePanel data={revenue} onCompareIncomeTax={() => setView('curve')} /> : <Card><CardContent className="flex gap-3 pt-6" role="status"><Loader2 className="size-5 animate-spin" />歳入データを読み込んでいます…</CardContent></Card>)}

      {state.view === 'stats' && <Card><CardContent className="mx-auto max-w-2xl space-y-5 py-12 text-center"><Database className="mx-auto size-10 text-primary-accent" /><h2 className="text-xl font-bold">実態統計は、収録準備中です</h2><p className="text-sm leading-relaxed">調査の表・所得階級・世帯範囲を確認してから表示します。未取得の統計をモデルの計算値で置き換えることはしていません。</p><div className="rounded-xl bg-mirai-surface p-4 text-left text-sm leading-relaxed"><p className="font-bold">確認できた候補</p><p>家計調査2024年・表3：年間収入五分位／十分位別、総世帯・勤労者世帯。実数値と復元世帯数は未確認です。</p><p className="mt-2">年齢×家族構成の同時絞り込み、消費税の推計、1億円の壁、OECD国際比較はデータ確認後に追加します。</p></div><Button asChild variant="outline"><a href="https://www.e-stat.go.jp/stat-search/files?stat_infid=000040246659" target="_blank" rel="noreferrer">e-Statの原表を確認する<ArrowRight /></a></Button></CardContent></Card>}

      <footer className="py-4 text-xs leading-relaxed text-mirai-text-secondary">歳入の規模と、世帯の負担を分けて表示しています。政策の試算は対象・仮定とともに確認してください。</footer>
    </main>
    <dialog ref={dialog} aria-labelledby="tax-data-title" className="max-h-[85vh] w-full max-w-2xl rounded-3xl border border-mirai-border bg-card p-0 text-mirai-text backdrop:bg-foreground/30">
      <div className="flex items-center justify-between gap-3 border-b border-mirai-border p-6"><h2 id="tax-data-title" className="flex items-center gap-2 text-lg font-bold"><ClipboardCheck className="size-5 text-primary-accent" />データと計算条件</h2><Button variant="ghost" size="icon" aria-label="計算条件を閉じる" onClick={() => dialog.current?.close()}><X /></Button></div>
      <div className="space-y-5 p-6 text-sm leading-relaxed"><p className="font-bold text-primary-accent">試作・OECD実出力との照合は未完了です</p>
        <p>選択世帯：{household.label}。大人{state.age}歳、収入按分{household.earners === 2 ? `${state.share}:${100 - state.share}` : '100:0'}。賞与{state.bonus ? '年2回、各1か月分' : 'なし'}。</p>
        {params ? <><dl className="grid grid-cols-2 gap-2"><dt>資料</dt><dd>OECD Japan 2025</dd><dt>資料記載の制度基準日</dt><dd>{params.metadata.referenceDate}</dd><dt>資料改訂</dt><dd>{params.metadata.documentRevision}</dd><dt>原本の版固定</dt><dd>PDF保存・ハッシュ未取得</dd></dl>
          <ul className="list-disc space-y-3 pl-5">{params.metadata.notes.map(note => <li key={note}>{note}</li>)}</ul></> : <p>計算条件の詳細はデータ読み込み後に表示します。</p>}
        <p>対象に対応した統計の復元世帯数がないため、財政影響は世帯1件あたりに限定します。原資料の検証が完了するまで「再現済み」とは表示しません。</p>
        <Button variant="outline" onClick={() => dialog.current?.close()}>閉じる</Button>
      </div>
    </dialog>
  </div>;
}
