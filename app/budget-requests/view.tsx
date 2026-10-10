'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { Button } from '@/components/ui/button';
import {
  ACQUISITION_STATUS_LABELS, AMOUNT_TYPE_LABELS, BUDGET_REQUEST_NOTES, DOCUMENT_KIND_LABELS, DOCUMENT_TYPE_LABELS, documentKind,
  formatRequestAmount, recordLocation, requestSourceUrl, type BudgetRequestResponse,
} from '@/app/lib/budget-requests';
import type { BudgetRequestDocument, BudgetRequestRecord } from '@/types/budget-requests';
import type { BudgetRequestLinksFile, BudgetRequestMinistryTotal } from '@/types/budget-request-links';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

type Summary = Pick<BudgetRequestLinksFile, 'requestedFY' | 'sheetYear' | 'generatedAt' | 'crawledMinistries' | 'ministries' | 'stats'>;

const fieldClass = 'w-full rounded-lg border border-mirai-border bg-card px-3 py-2 text-sm focus-visible:outline-primary';
const date = (value: string | null) => value && !Number.isNaN(Date.parse(value))
  ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(value)) + ' JST' : '未取得';

function SourceLink({ url, page, children }: { url: string; page?: number | null; children: ReactNode }) {
  const href = requestSourceUrl(url, page);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-primary-accent underline underline-offset-4">{children}</a> : <span>{children}（URL不正）</span>;
}

export default function BudgetRequestsView() {
  const [search, setSearch] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<BudgetRequestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const params = useMemo(() => new URLSearchParams(search ?? ''), [search]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/budget-requests/summary', { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const body: Summary = await response.json();
      if (!controller.signal.aborted) setSummary(body);
    }).catch(() => { /* 府省別の表は任意。失敗しても一覧は出す */ });
    return () => controller.abort();
  }, []);
  const view = params.get('view') === 'documents' ? 'documents' : 'records';

  useEffect(() => {
    const sync = () => { setSearch(window.location.search); setQuery(new URLSearchParams(window.location.search).get('q') ?? ''); };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (search === null) return;
    const controller = new AbortController();
    setLoading(true); setError(null); setMissing(false);
    fetch(`/api/budget-requests${search}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (!controller.signal.aborted) { setData(null); setMissing(response.status === 404); setError(response.status === 404 ? '2027年度の概算要求データはまだ取得されていません。' : body.error || '概算要求データを読み込めませんでした。'); }
        return;
      }
      const body: BudgetRequestResponse = await response.json();
      if (!controller.signal.aborted) setData(body);
    }).catch(() => {
      if (!controller.signal.aborted) { setData(null); setError('概算要求データを読み込めませんでした。接続を確認して再試行してください。'); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, retry]);

  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    const nextSearch = next.size ? `?${next}` : '';
    if (nextSearch === (search ?? '')) return;
    window.history.pushState(null, '', `/budget-requests${nextSearch}`);
    setSearch(nextSearch);
  };
  const reset = () => {
    const next = view === 'documents' ? '?view=documents' : '';
    setQuery(''); window.history.pushState(null, '', `/budget-requests${next}`); setSearch(next);
  };
  const documentMap = new Map(data?.recordDocuments.map(document => [document.id, document]) ?? []);
  const count = data ? (view === 'records' ? data.pagination.matchingRecords : data.pagination.matchingDocuments) : 0;
  const page = data?.pagination.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(count / data.pagination.pageSize)) : 1;
  const failureCount = data ? data.statusCounts.fetch_failed + data.statusCounts.extraction_failed : 0;

  return <div className="min-h-screen bg-background text-mirai-text">
    <AppHeader current="/budget-requests" />
    <main className="mx-auto max-w-7xl space-y-5 px-3 pb-12 pt-4 sm:px-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary-accent">2027年度（令和9年度）・概算要求段階</p>
        <h1 className="text-2xl font-bold">概算要求を原資料から探す</h1>
        <p className="text-sm leading-relaxed text-mirai-text-secondary">要求額・要望額・特別投資枠の記載と、その出典を確認できます。成立予算・執行実績ではありません。</p>
      </header>

      {data && <section aria-label="データ取得状況" className="rounded-xl border border-mirai-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-bold">取得状況（全資料・絞り込み前）</h2>
          <p className="text-xs text-mirai-text-muted">内容・状態の更新: {date(data.generatedAt)}</p>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['発見した府省・機関等', data.coverage.ministries], ['発見した資料', data.coverage.discoveredDocuments],
            ['取得成功歴のある資料', data.coverage.fetchedDocuments], ['抽出行のある資料', data.coverage.extractedDocuments], ['抽出した行', data.coverage.records],
          ].map(([label, value]) => <div key={label} className="rounded-lg bg-mirai-surface p-3"><dt className="text-xs text-mirai-text-muted">{label}</dt><dd className="mt-1 text-xl font-bold tabular-nums">{Number(value).toLocaleString()}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-mirai-text-secondary">
          発見済みの資料についての件数です。取得成功歴には過去の成功を、抽出行のある資料には一部抽出を含みます。全府省・機関等の全資料の網羅や原表の合計との一致を保証しません。
          記録時の取得・抽出失敗 {failureCount}件 ／ 対象外・未対応 {data.statusCounts.unsupported}件 ／ 一部抽出 {data.statusCounts.partial}件。
          内容・状態が変わらない再確認では更新日時を変更しません。取得日時は保存した原本の取得時点を示します。
          {' '}<SourceLink url={data.indexUrl}>財務省の掲載一覧</SourceLink>
        </p>
        {!!data.coverage.warnings.length && <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">取得範囲の注意（{data.coverage.warnings.length}件）</summary><ul className="mt-2 space-y-1 pl-5 list-disc">{data.coverage.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      </section>}

      {summary && summary.ministries.length > 0 && <MinistryTotals summary={summary} />}

      <aside className="rounded-xl border border-mirai-border bg-mirai-surface-teal p-4 text-xs leading-relaxed text-mirai-text-secondary">
        <p>概要・内訳・総計が重複するため、資料横断の金額合計は表示しません。事項要求・記載なし・抽出失敗を0円として扱いません。</p>
        <details className="mt-1"><summary className="cursor-pointer">データの読み方</summary><ul className="mt-2 list-disc space-y-1 pl-5">{BUDGET_REQUEST_NOTES.map(note => <li key={note}>{note}</li>)}</ul></details>
      </aside>

      <section aria-label="検索条件" className="space-y-3 rounded-xl border border-mirai-border bg-card p-4">
        <form className="flex gap-2" onSubmit={event => { event.preventDefault(); change('q', query.trim()); }}>
          <label className="min-w-0 flex-1"><span className="sr-only">事業名・資料名を検索</span><input className={fieldClass} type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="事業名・資料名・要求番号で検索" /></label>
          <Button type="submit">検索</Button>
        </form>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Filter label="府省・機関等" value={params.get('ministry') ?? ''} onChange={value => change('ministry', value)} options={Object.fromEntries((data?.ministries ?? []).map(ministry => [ministry, ministry]))} all="全府省・機関等" />
          <Filter label="取得状況" value={params.get('status') ?? ''} onChange={value => change('status', value)} options={ACQUISITION_STATUS_LABELS} all="すべての状況" />
          <Filter label="資料の種類" value={params.get('kind') ?? ''} onChange={value => change('kind', value)} options={DOCUMENT_KIND_LABELS} all="すべての種類" />
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>条件をクリア</Button>
      </section>

      <section aria-label="概算要求の検索結果" aria-busy={loading} className="space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="表示内容">
          <Button variant={view === 'records' ? 'default' : 'outline'} aria-pressed={view === 'records'} onClick={() => change('view', 'records')}>抽出した行{data ? `（${data.pagination.matchingRecords.toLocaleString()}）` : ''}</Button>
          <Button variant={view === 'documents' ? 'default' : 'outline'} aria-pressed={view === 'documents'} onClick={() => change('view', 'documents')}>資料と取得状況{data ? `（${data.pagination.matchingDocuments.toLocaleString()}）` : ''}</Button>
        </div>
        {loading ? <p role="status" className="p-4 text-sm">概算要求データを読み込み中…</p>
          : error ? <div role={missing ? 'status' : 'alert'} className="rounded-xl border border-mirai-border bg-card p-5"><p>{error}</p><p className="mt-2 text-sm text-mirai-text-muted">取得できていないことは、要求がないことを意味しません。</p><Button className="mt-3" variant="outline" onClick={() => setRetry(value => value + 1)}>再読み込み</Button></div>
          : data && <>
            <p className="text-xs text-mirai-text-muted">条件に一致: {count.toLocaleString()}件 ／ {page.toLocaleString()}ページ目（1ページ{data.pagination.pageSize}件）</p>
            {count === 0 ? <div className="rounded-xl border border-mirai-border bg-card p-5 text-sm"><p>条件に一致する{view === 'records' ? '抽出済みの行' : '資料'}はありません。</p>{view === 'records' && <p className="mt-2 text-mirai-text-muted">資料が取得・抽出できていない場合もあります。「資料と取得状況」で確認できます。</p>}</div>
              : <div className="space-y-3">{view === 'records' ? data.records.map(record => <RecordCard key={record.id} record={record} document={documentMap.get(record.documentId)} />) : data.documents.map(document => <DocumentCard key={document.id} document={document} />)}</div>}
            {page > pages && <p role="status" className="text-sm">このページに結果はありません。前のページに戻るか、条件をクリアしてください。</p>}
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => change('page', String(page - 1))}>前のページ</Button>
              <span className="text-sm tabular-nums">{page} / {pages}</span>
              <Button variant="outline" disabled={page >= pages} onClick={() => change('page', String(page + 1))}>次のページ</Button>
            </div>
          </>}
      </section>
    </main>
  </div>;
}

function Filter({ label, value, onChange, options, all }: { label: string; value: string; onChange: (value: string) => void; options: Record<string, string>; all: string }) {
  return <label className="block text-xs text-mirai-text-secondary"><span className="mb-1 block">{label}</span><select aria-label={label} className={fieldClass} value={value} onChange={event => onChange(event.target.value)}><option value="">{all}</option>{value && !Object.hasOwn(options, value) && <option value={value}>{value}</option>}{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}

function RecordCard({ record, document }: { record: BudgetRequestRecord; document?: BudgetRequestDocument }) {
  return <article className="min-w-0 rounded-xl border border-mirai-border bg-card p-4" data-testid="request-record">
    <div className="flex flex-wrap justify-between gap-2">
      <div className="min-w-0"><p className="text-xs text-mirai-text-muted">{record.ministry} ／ {record.account ?? '会計未特定'} ／ {DOCUMENT_TYPE_LABELS[record.documentType]}</p><h2 className="mt-1 break-words font-bold">{record.projectName}</h2></div>
      <span className="h-fit rounded bg-mirai-surface px-2 py-1 text-xs">{{ total: '総計行', subtotal: '小計行', detail: '内訳行', unknown: '集計区分未判定' }[record.aggregationFlag]}</span>
    </div>
    {document && ['fetch_failed', 'extraction_failed'].includes(document.status) && <p className="mt-2 rounded bg-status-warn-bg p-2 text-xs text-status-warn-fg">記録時の取得・抽出に失敗しています。以下は過去の取得時点（{date(record.provenance.retrievedAt)}）の記録です。</p>}
    {document?.validation.some(note => /再発見|再取得に失敗|今回未取得/.test(note)) && <p className="mt-2 rounded bg-status-warn-bg p-2 text-xs text-status-warn-fg">今回、この資料の最新版を確認できていません。取得日時と掲載ページを確認してください。</p>}
    {!!record.provenance.validation.length && <p className="mt-2 rounded bg-status-warn-bg p-2 text-xs text-status-warn-fg">検証上の注意が{record.provenance.validation.length}件あります。金額・名称は原文の確認が必要です。</p>}
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      <div className="min-w-0 rounded-lg bg-mirai-surface p-3"><dt className="text-xs text-mirai-text-muted">{AMOUNT_TYPE_LABELS.request}</dt><dd className="mt-1 break-words text-sm font-bold tabular-nums">{formatRequestAmount(record.amounts.request)}</dd></div>
      <div className="min-w-0 rounded-lg bg-mirai-surface p-3"><dt className="text-xs text-mirai-text-muted">前年度予算額</dt><dd className="mt-1 break-words text-sm font-bold tabular-nums">{formatRequestAmount(record.previousYear)}</dd></div>
    </dl>
    <p className="mt-3 text-xs"><SourceLink url={record.provenance.url} page={record.provenance.page}>原資料を開く</SourceLink><span className="ml-2 text-mirai-text-muted">{recordLocation(record)}</span></p>
    <details className="mt-3 text-xs leading-relaxed">
      <summary className="cursor-pointer font-medium text-primary-accent">原文・抽出根拠を見る</summary>
      <div className="mt-3 space-y-3">
        <div className="whitespace-pre-wrap break-words rounded-lg border border-mirai-border bg-mirai-surface p-3">{record.provenance.rawQuote || '原文引用は保存されていません。'}</div>
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <Detail label="資料名">{document?.title ?? '資料名未特定'}</Detail>
          <Detail label="要求番号・科目コード">{[record.requestNumber, ...record.itemCodes].filter(Boolean).join('・') || '未特定'}</Detail>
          <Detail label="要求年度・公表年度・シート年度">{record.requestedFY}年度 ／ {record.publicationFY ?? '未特定'} ／ {record.sheetFY ?? '未特定'}</Detail>
          <Detail label="原資料の金額単位">{record.originalUnit ?? '未特定'}</Detail>
          <Detail label="前年度の記載">{formatRequestAmount(record.previousYear)}（比較基準: {record.previousYearComparisonBasis ?? '未特定'}）</Detail>
          <Detail label="取得日時">{date(record.provenance.retrievedAt)}</Detail>
          <Detail label="抽出方法">{record.provenance.extractionMethod}</Detail>
          <Detail label="RSとの対応（参考）">{{ exact: '完全一致', inferred: '推定対応', unmatched: '未照合' }[record.rsLink.status]}{record.rsLink.projectIds.length ? `・事業ID ${record.rsLink.projectIds.join('、')}` : ''}{record.rsLink.sheetFY ? `・${record.rsLink.sheetFY}年度シート` : ''}{record.rsLink.evidence ? `・${record.rsLink.evidence}` : ''}</Detail>
          <Detail label="要求額の原文">{record.amounts.request.raw || '記載なし'}</Detail>
          {(['demand', 'specialInvestment'] as const).filter(key => record.amounts[key].status !== 'blank').map(key => <Detail key={key} label={`${AMOUNT_TYPE_LABELS[key]}（補足）`}>{formatRequestAmount(record.amounts[key])}・原文「{record.amounts[key].raw}」</Detail>)}
          <Detail label="資料ハッシュ">{record.provenance.hash || '未取得'}</Detail>
        </dl>
        {!!record.provenance.validation.length && <p>検証上の注意: {record.provenance.validation.join(' ／ ')}</p>}
        <p className="break-all">出典URL: <SourceLink url={record.provenance.url}>{record.provenance.url}</SourceLink></p>
      </div>
    </details>
  </article>;
}

function DocumentCard({ document }: { document: BudgetRequestDocument }) {
  return <article className="min-w-0 rounded-xl border border-mirai-border bg-card p-4" data-testid="request-document">
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-mirai-text-muted">
      <span className="rounded bg-mirai-surface-teal px-1.5 py-0.5 font-bold text-primary-accent">{DOCUMENT_KIND_LABELS[documentKind(document)]}</span>
      <span>{document.ministry} ／ {document.account ?? '会計未特定'} ／ リンクの分類: {DOCUMENT_TYPE_LABELS[document.documentType]}</span>
    </p>
    <h2 className="mt-1 break-words font-bold"><SourceLink url={document.url}>{document.title}</SourceLink></h2>
    <p className="mt-2 text-sm">{ACQUISITION_STATUS_LABELS[document.status]} ・抽出 {document.recordCount.toLocaleString()}行{documentKind(document) === 'overview' && document.recordCount === 0 ? '（概要は自由レイアウトのため数値は未抽出。要求額は「要求書（明細表）」で）' : ''}</p>
    {!!document.validation.length && ['partial', 'unsupported', 'extraction_failed', 'discovered'].includes(document.status) && <p className="mt-2 break-words text-xs text-mirai-text-secondary">{document.validation[0].slice(0, 300)}{document.validation[0].length > 300 ? '…' : ''}</p>}
    {document.error && <p className="mt-2 break-words rounded bg-status-warn-bg p-2 text-xs text-status-warn-fg">取得・抽出上の問題: {document.error}</p>}
    {['fetch_failed', 'extraction_failed'].includes(document.status) && document.recordCount > 0 && <p className="mt-2 text-xs text-status-warn-fg">抽出行は過去の成功時の記録を保持しています。最新資料の確認はできていません。</p>}
    <details className="mt-3 text-xs leading-relaxed"><summary className="cursor-pointer font-medium text-primary-accent">取得履歴と出典</summary><div className="mt-3 space-y-2">
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2"><Detail label="取得日時">{date(document.retrievedAt)}</Detail><Detail label="記録時の最終試行">{document.status === 'discovered' && !document.retrievedAt ? '未試行' : date(document.lastAttemptAt)}</Detail><Detail label="改訂番号">{document.revision}</Detail><Detail label="資料ハッシュ">{document.hash ?? '未取得'}</Detail></dl>
      {!!document.validation.length && <p>検証上の注意: {document.validation.join(' ／ ')}</p>}
      {!!document.revisions.length && <ul className="list-disc space-y-1 pl-5">{document.revisions.map((revision, index) => <li key={`${revision.hash}-${index}`} className="break-all">改訂 {revision.revision} ・ {date(revision.retrievedAt)} ・ {revision.hash}</li>)}</ul>}
      <p className="break-all">出典URL: <SourceLink url={document.url}>{document.url}</SourceLink></p>
      {document.parentUrl && <p><SourceLink url={document.parentUrl}>発見元の掲載ページ</SourceLink></p>}
    </div></details>
  </article>;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-mirai-text-muted">{label}</dt><dd className="break-words [overflow-wrap:anywhere]">{children}</dd></div>;
}

/** 府省・組織別の要求額。明細表の総計行だけを使うので資料間で重複しない。RS 事業との対応状況も添える */
function MinistryTotals({ summary }: { summary: Summary }) {
  const [open, setOpen] = useState(false);
  const rows = summary.ministries.filter(row => row.requestYen !== null);
  const byMinistry = new Map<string, BudgetRequestMinistryTotal[]>();
  for (const row of rows) byMinistry.set(row.ministry, [...(byMinistry.get(row.ministry) ?? []), row]);
  const groups = [...byMinistry.entries()].map(([ministry, items]) => ({
    ministry, items,
    requestYen: items.reduce((sum, row) => sum + (row.requestYen ?? 0), 0),
    previousYen: items.every(row => row.previousYen !== null) ? items.reduce((sum, row) => sum + (row.previousYen ?? 0), 0) : null,
  })).sort((a, b) => b.requestYen - a.requestYen);
  const shown = open ? groups : groups.slice(0, 10);
  const pct = (request: number, previous: number | null) => previous === null || previous === 0 ? '—' : `${request >= previous ? '+' : ''}${((request - previous) / previous * 100).toFixed(1)}%`;
  return <section aria-label="府省別の要求額" className="rounded-xl border border-mirai-border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 className="font-bold">府省・組織別の要求額（明細表の総計行）</h2>
      <p className="text-xs text-mirai-text-muted">RS事業との対応: {summary.stats.linked.toLocaleString()}事業で歳出予算項目が明細表と一致（取得できた{summary.crawledMinistries.length}府省・機関）</p>
    </div>
    <p className="mt-1 text-xs leading-relaxed text-mirai-text-secondary">各資料の総計行（組織・勘定ごと）だけを足しています。一般会計と特別会計が別資料の府省は両方を含みます。明細表が取得・抽出できていない府省（厚生労働省・経済産業省・法務省など）は載りません。</p>
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead><tr className="text-left text-xs text-mirai-text-muted"><th className="py-1 pr-2 font-medium">府省・機関</th><th className="py-1 pr-2 text-right font-medium">{summary.requestedFY}年度要求</th><th className="py-1 pr-2 text-right font-medium">{summary.requestedFY - 1}年度予算</th><th className="py-1 pr-2 text-right font-medium">増減</th><th className="py-1 font-medium">内訳（組織・勘定）と原資料</th></tr></thead>
        <tbody>
          {shown.map(group => <tr key={group.ministry} className="border-t border-mirai-border align-top">
            <td className="py-1.5 pr-2 font-bold">{group.ministry}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{formatBudgetFromYen(group.requestYen)}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums text-mirai-text-muted">{group.previousYen === null ? '—' : formatBudgetFromYen(group.previousYen)}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{pct(group.requestYen, group.previousYen)}</td>
            <td className="py-1.5 text-xs text-mirai-text-secondary">{group.items.map(row => <span key={`${row.organization}|${row.url}`} className="mr-2 inline-block">{row.organization}{row.account && row.account !== '一般会計' ? `（${row.account}）` : ''} {formatBudgetFromYen(row.requestYen ?? 0)} <SourceLink url={row.url} page={row.page}>原資料</SourceLink></span>)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {groups.length > 10 && <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? '上位10件に戻す' : `残り${groups.length - 10}府省・機関を見る`}</Button>}
  </section>;
}
