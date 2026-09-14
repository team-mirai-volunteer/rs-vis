'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarRange, ChartNoAxesCombined, ClipboardCheck, Database, Grid3x3, Info, Landmark, Loader2, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AppHeader } from '@/components/navigation/AppHeader';
import { HOUSEHOLDS, initialTaxState, isReformed } from '@/app/lib/tax-burden/households';
import { simulate, statutoryBasicAllowance } from '@/app/lib/tax-burden/simulate';
import { heatmapGrid, lifecycleSeries } from '@/app/lib/tax-burden/simulate-lifecycle';
import { fiscalImpact } from '@/app/lib/tax-burden/fiscal-impact';
import { decodeTaxState, encodeTaxState } from '@/app/lib/tax-burden/reform-url';
import { CurveChart } from '@/client/components/tax-burden/CurveChart';
import { LifecycleChart, PHASE_LABEL } from '@/client/components/tax-burden/LifecycleChart';
import { LifecycleTable } from '@/client/components/tax-burden/LifecycleTable';
import { TaxHeatmap } from '@/client/components/tax-burden/TaxHeatmap';
import { StatsPanel } from '@/client/components/tax-burden/StatsPanel';
import { TaxControls } from '@/client/components/tax-burden/TaxControls';
import { BurdenBreakdown, yen } from '@/client/components/tax-burden/BurdenBreakdown';
import { RevenuePanel } from '@/client/components/tax-burden/RevenuePanel';
import type { AgeDataset, ConsumptionDataset, IncidenceDataset, OecdDataset, TaxParameters, TaxRevenue, TaxView } from '@/types/tax-burden';

const VIEWS = [
  { id: 'curve', label: '世帯の負担カーブ', icon: ChartNoAxesCombined },
  { id: 'age', label: '年齢で見る', icon: CalendarRange },
  { id: 'heatmap', label: '税目×年齢×年収', icon: Grid3x3 },
  { id: 'revenue', label: '国の税収', icon: Landmark },
  { id: 'stats', label: '実態統計', icon: Database },
] as const;

function useJson<T>(url: string | null, retry: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    setError(null);
    fetch(url, { signal: abort.signal }).then(async r => {
      if (!r.ok) throw new Error('データを読み込めませんでした。再読み込みしてください。');
      return r.json() as Promise<T>;
    }).then(setData).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [url, retry]);
  return { data, error };
}

export default function TaxBurdenPage() {
  const [state, setState] = useState(initialTaxState);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedAge, setSelectedAge] = useState(70);
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

  const { data: params, error } = useJson<TaxParameters>('/api/tax-burden/params?fy=2025', retry);
  const { data: consumption } = useJson<ConsumptionDataset>('/api/tax-burden/consumption?year=2024', retry);
  const { data: oecd } = useJson<OecdDataset>('/api/tax-burden/oecd', retry);
  const { data: incidence } = useJson<IncidenceDataset>('/api/tax-burden/incidence', retry);
  const { data: ageStats } = useJson<AgeDataset>(state.view === 'stats' ? '/api/tax-burden/age?year=2024' : null, retry);
  const { data: revenue, error: revenueError } = useJson<TaxRevenue>(state.view === 'revenue' ? '/api/tax-burden/revenue?fy=2025' : null, retry);

  const reformed = isReformed(state.reform);
  const before = useMemo(() => params ? simulate(state, params, undefined, consumption, incidence) : null, [state, params, consumption, incidence]);
  const after = useMemo(() => params ? simulate(state, params, state.reform, consumption, incidence) : null, [state, params, consumption, incidence]);
  const impact = before && after ? fiscalImpact(before, after, state, consumption) : null;
  // The age and heat-map views answer to the same policy sliders; the age view keeps a current-law series to compare against.
  const lifecycle = useMemo(() => params && state.view === 'age' ? lifecycleSeries(state, params, state.reform, consumption, incidence) : null, [state, params, consumption, incidence]);
  const lifecycleBase = useMemo(() => params && state.view === 'age' && reformed ? lifecycleSeries(state, params, undefined, consumption, incidence) : null, [state, params, consumption, incidence, reformed]);
  const grid = useMemo(() => params && state.view === 'heatmap' ? heatmapGrid(state, params, consumption, incidence, state.reform) : null, [state, params, consumption, incidence]);
  const selected = reformed ? after : before;
  const household = HOUSEHOLDS.find(h => h.id === state.household)!;
  const setView = (view: TaxView) => setState(s => ({ ...s, view }));
  const setIncome = (income: number) => setState(s => ({ ...s, income }));
  const ageRow = lifecycle?.find(y => y.ageAt === selectedAge) ?? null;
  const rateText = (rate: number | null) => rate === null ? '未定義' : `${(rate * 100).toFixed(1)}%`;
  async function share() {
    const url = `${window.location.origin}/tax-burden?${encodeTaxState(state)}`;
    try { await navigator.clipboard.writeText(url); setNotice('共有URLをコピーしました。'); }
    catch { setShareUrl(url); setNotice('下の共有URLを選択してコピーしてください。'); setTimeout(() => shareInput.current?.select(), 0); }
  }
  const loading = <Card className="min-h-96"><CardContent className="flex items-center gap-3 pt-10" role="status"><Loader2 className="size-5 animate-spin" />計算データを読み込んでいます…</CardContent></Card>;
  const errorCard = (message: string) => <Card><CardContent className="space-y-3 pt-6"><p role="alert">{message}</p><Button onClick={() => setRetry(v => v + 1)}>再読み込みする</Button></CardContent></Card>;
  const modelViews = state.view === 'curve' || state.view === 'age' || state.view === 'heatmap';

  return <div className="min-h-screen bg-background text-mirai-text">
    <AppHeader current="/tax-burden">
      <Button variant="outline" size="sm" className="border-mirai-border" onClick={() => dialog.current?.showModal()}><Info />データについて</Button>
    </AppHeader>
    <main className="mx-auto max-w-screen-2xl space-y-5 px-3 pb-5 pt-5">
      <section className="flex flex-col justify-between gap-5 rounded-2xl bg-mirai-gradient p-6 sm:flex-row sm:items-center sm:p-8">
        <div><p className="mb-2 text-xs font-bold tracking-normal">歳入・国民負担を考える</p><h1 className="text-2xl font-bold tracking-normal sm:text-3xl">誰が、どれだけ負担している？</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed">年収・家族構成・年齢から税・保険料・給付を眺め、制度を変えたときの違いを確かめます。</p></div>
        <Button variant="outline" onClick={share} disabled={!ready}><Share2 />この条件を共有する</Button>
      </section>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-mirai-border bg-card px-4 py-3 text-xs leading-relaxed">
        <span className="rounded-full bg-mirai-surface-teal px-3 py-1 font-bold text-primary-accent">試作</span>
        <p>制度説明書に基づく参考計算です。OECD Taxing Wages の日本値と定点で照合済み（差は保険料の簡略化で説明可能）。実際の納税額を確定する計算ではありません。</p>
      </div>
      {warning && <p role="alert" className="rounded-xl bg-card p-4 text-sm">{warning}</p>}
      <div role="status" className={notice ? 'rounded-xl bg-mirai-surface-teal p-3 text-sm' : 'sr-only'}>{notice}</div>
      {shareUrl && <label className="block text-sm">共有URL<input ref={shareInput} value={shareUrl} readOnly onFocus={e => e.target.select()} className="mt-2 w-full rounded-xl border border-mirai-border bg-card p-3" /></label>}
      <nav aria-label="歳入・負担の表示切替" className="flex flex-wrap gap-2">
        {VIEWS.map(({ id, label, icon: Icon }) => <Button key={id} variant={state.view === id ? 'default' : 'outline'} aria-pressed={state.view === id} onClick={() => setView(id)}><Icon />{label}</Button>)}
      </nav>

      {modelViews && <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <TaxControls state={state} setState={setState} hasConsumption={!!consumption} hasOecd={!!oecd} incidence={incidence} basicAllowance={params ? statutoryBasicAllowance(state, params) : undefined} />
        <div className="min-w-0 space-y-5">
          {error ? errorCard(error) : !params || !before || !selected ? loading : <>
            {state.view === 'curve' && <>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: reformed ? '改革案の純負担率' : '選択世帯の純負担率', value: rateText(state.includeConsumption ? selected.netRateWithConsumption : selected.netRate), note: selected.netRate === null ? '年収0円では率を計算しません' : `${household.label}・${(state.income / 10000).toLocaleString('ja-JP')}万円` },
                  { label: '年間の純負担額', value: yen(selected.netBurden + (state.includeConsumption ? selected.consumptionTax : 0)), note: state.includeConsumption ? '税・本人保険料・消費税推計 − 現金給付' : '税・本人保険料 − 現金給付' },
                  { label: reformed ? '基準制度からの家計の改善額' : '年間の現金給付', value: yen(reformed ? (before.netBurden + before.consumptionTax) - (selected.netBurden + selected.consumptionTax) : selected.benefits), note: reformed ? '＋は手取りが増える方向' : '児童手当・児童扶養手当' },
                ].map(item => <Card key={item.label}><CardContent className="pt-5"><p className="text-xs text-mirai-text-secondary">{item.label}</p><p className="mt-2 text-2xl font-bold tabular-nums text-primary-accent">{item.value}</p><p className="mt-2 text-xs text-mirai-text-secondary">{item.note}</p></CardContent></Card>)}
              </div>
              {selected.outOfScope && <p role="status" className="rounded-xl border border-mirai-border bg-card px-4 py-3 text-sm"><strong>適用範囲外の参考値：</strong>{selected.scopeReasons.join('、')}。被用者保険の賃金要件は就労者1人あたり{yen(params.employeeInsuranceThreshold)}です。</p>}
              <Card><CardHeader className="flex-row items-start justify-between gap-3"><div><h2 className="text-lg font-bold">年収と、税・保険料・給付の関係</h2><p className="mt-2 text-xs text-mirai-text-secondary">2025年版 ／ {reformed ? '基準制度と改革案（破線）' : '家族構成別の参考カーブ'}。図をクリックすると年収を選べます。</p></div><Button size="sm" variant="ghost" onClick={() => dialog.current?.showModal()}><Info />計算条件</Button></CardHeader>
                <CardContent><CurveChart state={state} params={params} consumption={consumption} oecd={oecd} incidence={incidence} onIncomeChange={setIncome} />
                  <p className="mt-4 text-xs text-mirai-text-secondary">出典：<a className="text-primary-accent underline" href={params.metadata.sourceUrl} target="_blank" rel="noreferrer">OECD 日本の税・給付制度説明書 2025</a>{state.showOecd && oecd && <>、<a className="text-primary-accent underline" href="https://www.oecd.org/en/data/datasets/taxing-wages.html" target="_blank" rel="noreferrer">OECD Taxing Wages</a>（{oecd.metadata.retrievedOn}取得）</>}{state.includeConsumption && consumption && <>、<a className="text-primary-accent underline" href={consumption.metadata.sourceUrl} target="_blank" rel="noreferrer">{consumption.metadata.survey}</a></>}。独自の試作計算。事業主負担は含みません。</p>
                </CardContent>
              </Card>
              <BurdenBreakdown before={before} after={reformed ? after ?? undefined : undefined} impact={reformed ? impact ?? undefined : undefined} includeConsumption={state.includeConsumption} />
            </>}
            {state.view === 'age' && lifecycle && <>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: `${selectedAge}歳の純負担率`, value: rateText(ageRow ? (ageRow.careerRate === null ? null : (state.includeConsumption ? ageRow.careerRate : (ageRow.pensionAdjustedBurden - ageRow.consumptionTax) / ageRow.careerIncome)) : null), note: ageRow ? `${PHASE_LABEL[ageRow.phase]}・年金を差し引き、現役期年収 ${(state.income / 10000).toLocaleString('ja-JP')}万円で割った値${ageRow.pensionIncome > 0 ? '（負＝受け取り超過）' : ''}` : '' },
                  { label: `${selectedAge}歳の可処分所得`, value: yen(ageRow ? ageRow.disposable - (state.includeConsumption ? ageRow.consumptionTax : 0) : 0), note: '総収入 − 純負担' },
                  { label: '65歳以降の公的年金（世帯・年額）', value: yen(lifecycle.find(y => y.ageAt === 70)?.pensionIncome ?? 0), note: '基礎年金＋報酬比例。現役期年収から算出' },
                ].map(item => <Card key={item.label}><CardContent className="pt-5"><p className="text-xs text-mirai-text-secondary">{item.label}</p><p className="mt-2 text-2xl font-bold tabular-nums text-primary-accent">{item.value}</p><p className="mt-2 text-xs text-mirai-text-secondary">{item.note}</p></CardContent></Card>)}
              </div>
              {lifecycle[0].outOfScope && <p role="status" className="rounded-xl border border-mirai-border bg-card px-4 py-3 text-sm"><strong>適用範囲外の参考値：</strong>{lifecycle[0].scopeReasons.join('、')}。</p>}
              <Card><CardHeader><h2 className="text-lg font-bold">同じ所得階層の人が、年齢とともにどれだけ負担するか</h2><p className="mt-2 text-xs text-mirai-text-secondary">{household.label}・現役期の世帯年収 {(state.income / 10000).toLocaleString('ja-JP')}万円。60歳以降は賃金{Math.round(state.continuation * 100)}%で継続雇用、65歳から年金{state.workUntil > 65 ? `（${state.workUntil - 1}歳まで就労継続）` : ''}。</p></CardHeader>
                <CardContent><LifecycleChart years={lifecycle} base={lifecycleBase} state={state} selectedAge={selectedAge} onSelectAge={setSelectedAge} />
                  <LifecycleTable years={lifecycle} state={state} selectedAge={selectedAge} />
                  <p className="mt-4 text-xs leading-relaxed text-mirai-text-secondary">年金は老齢基礎年金（満額）＋報酬比例部分（平均標準報酬額×5.481/1000×480か月）。65歳以降の医療保険は国民健康保険（東京都特別区の統一保険料・要照合）、75歳から後期高齢者医療（東京都広域連合）、介護保険第1号は国の標準段階×全国平均基準額。年金生活者支援給付金は所得要件を満たす場合のみ。住民税は前年所得課税で計算するため、就労初年度（20歳）は0、継続雇用で減収した60歳と年金生活に入った65歳には前年の給与に基づく重い住民税がかかります。</p>
                </CardContent>
              </Card>
              {ageRow && <BurdenBreakdown before={ageRow} includeConsumption={state.includeConsumption} pensionIncome={ageRow.pensionIncome} title={`${selectedAge}歳の負担内訳`} />}
            </>}
            {state.view === 'heatmap' && grid && <Card><CardHeader><h2 className="text-lg font-bold">この税は、どの年齢・どの所得階層に重いか</h2><p className="mt-2 text-xs text-mirai-text-secondary">{household.label}。制度モデルで年齢×現役期年収の各セルを計算。</p></CardHeader>
              <CardContent><TaxHeatmap grid={grid} hasConsumption={!!consumption} reformed={reformed} /></CardContent></Card>}
          </>}
        </div>
      </div>}

      {state.view === 'revenue' && (revenueError ? errorCard(revenueError) : revenue ? <RevenuePanel data={revenue} onCompareIncomeTax={() => setView('curve')} /> : <Card><CardContent className="flex gap-3 pt-6" role="status"><Loader2 className="size-5 animate-spin" />歳入データを読み込んでいます…</CardContent></Card>)}

      {state.view === 'stats' && (consumption ? <StatsPanel data={consumption} age={ageStats} /> :<Card><CardContent className="mx-auto max-w-2xl space-y-5 py-12 text-center"><Database className="mx-auto size-10 text-primary-accent" /><h2 className="text-xl font-bold">実態統計を読み込んでいます</h2><p className="text-sm leading-relaxed">家計調査2024年・年収十分位別の直接税・社会保険料・消費支出を表示します。</p><Button asChild variant="outline"><a href="https://www.e-stat.go.jp/stat-search/files?stat_infid=000040246659" target="_blank" rel="noreferrer">e-Statの原表を確認する<ArrowRight /></a></Button></CardContent></Card>)}

      <footer className="py-4 text-xs leading-relaxed text-mirai-text-secondary">歳入の規模と、世帯の負担を分けて表示しています。政策の試算は対象・仮定とともに確認してください。</footer>
    </main>
    <dialog ref={dialog} aria-labelledby="tax-data-title" className="max-h-[85vh] w-full max-w-2xl rounded-3xl border border-mirai-border bg-card p-0 text-mirai-text backdrop:bg-foreground/30">
      <div className="flex items-center justify-between gap-3 border-b border-mirai-border p-6"><h2 id="tax-data-title" className="flex items-center gap-2 text-lg font-bold"><ClipboardCheck className="size-5 text-primary-accent" />データと計算条件</h2><Button variant="ghost" size="icon" aria-label="計算条件を閉じる" onClick={() => dialog.current?.close()}><X /></Button></div>
      <div className="space-y-5 p-6 text-sm leading-relaxed"><p className="font-bold text-primary-accent">試作・制度説明書ベースの参考計算です</p>
        <p>選択世帯：{household.label}。大人{state.age}歳、収入按分{household.earners === 2 ? `${state.share}:${100 - state.share}` : '100:0'}。賞与{state.bonus ? '年2回、各1か月分' : 'なし'}。</p>
        {params ? <><dl className="grid grid-cols-2 gap-2"><dt>資料</dt><dd>OECD Japan 2025</dd><dt>資料記載の制度基準日</dt><dd>{params.metadata.referenceDate}</dd><dt>資料改訂</dt><dd>{params.metadata.documentRevision}</dd><dt>原本の版固定</dt><dd>PDF保存・ハッシュ未取得</dd>{oecd && <><dt>OECD比較</dt><dd>Taxing Wages（{oecd.metadata.retrievedOn}取得）</dd></>}{consumption && <><dt>消費支出</dt><dd>{consumption.metadata.survey}（{consumption.metadata.retrievedOn}取得）</dd></>}</dl>
          <ul className="list-disc space-y-3 pl-5">{params.metadata.notes.map(note => <li key={note}>{note}</li>)}</ul></> : <p>計算条件の詳細はデータ読み込み後に表示します。</p>}
        <p>OECD Taxing Wages の日本2025年値（8定点）との照合では、所得税・住民税・保険料の差はOECD側が保険料を総給与への定率（介護保険なし・雇用0.55%）としている簡略化で説明できました。対象に対応した統計の復元世帯数がないため、財政影響は世帯1件あたりに限定します。</p>
        <Button variant="outline" onClick={() => dialog.current?.close()}>閉じる</Button>
      </div>
    </dialog>
  </div>;
}
