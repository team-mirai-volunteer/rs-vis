'use client';

/**
 * 基金一覧（/funds）。RSシステムの基金シートを、残高・支出・国庫返納・終了予定・点検の観点で絞り込み・並べ替えする。
 * 行を選ぶと右に基金の詳細（3年度の推移・造成の経緯と造成元の事業・必要性・保有割合の根拠・点検結果）を出す。
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { Button } from '@/components/ui/button';
import { HeaderHelp } from '@/client/components/HeaderHelp';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { unifiedProjectUrlForSheet } from '@/app/lib/unified-budget/links';
import {
  BUSINESS_FORM_LABELS, FUND_SIGNALS, FUND_SIGNAL_DESCRIPTIONS, FUND_SIGNAL_LABELS, FUND_SIGNAL_SHORT, INSPECTION_LABELS, OPERATION_FORM_LABELS,
  FUND_COLUMN_DESCRIPTIONS, OWNER_FORM_LABELS, budgetLabel, formLabels, fundSignals, latestYear, ownershipPercent, spendingYears,
  type FundSignal,
} from '@/app/lib/funds';
import type { Fund, FundsFile } from '@/types/funds';

type SortKey = 'balance' | 'expense' | 'years' | 'returned' | 'adminRate' | 'ownership' | 'endDate' | 'name';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'balance', label: '残高' }, { key: 'expense', label: '前年度支出' }, { key: 'years', label: '残高÷支出' },
  { key: 'returned', label: '国庫返納' }, { key: 'adminRate', label: '管理費率' }, { key: 'ownership', label: '保有割合' },
  { key: 'endDate', label: '終了予定' }, { key: 'name', label: '基金名' },
];

const yen = (v: number | null) => (v === null ? '—' : formatBudgetFromYen(v));
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
/** シート年度 N の「前年度」＝年度 N−1、残高＝年度 N−1 の末 */
const fyLabel = (sheetYear: number) => `${sheetYear - 1}年度`;

function sortValue(f: Fund, key: SortKey): number | string | null {
  const y = latestYear(f);
  switch (key) {
    case 'balance': return y.balance;
    case 'expense': return y.expense;
    case 'years': return spendingYears(y);
    case 'returned': return y.returned;
    case 'adminRate': return y.adminRate;
    case 'ownership': return y.ownership;
    case 'endDate': return f.endDate;
    case 'name': return f.name;
  }
}

export default function FundsView() {
  const [data, setData] = useState<FundsFile | null | undefined>(undefined);
  const [signal, setSignal] = useState<FundSignal | null>(null);
  const [ministry, setMinistry] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'balance', desc: true });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // 既定は最新のシート年度に載っている基金だけ。以前の年度だけに載っている基金（終了・未提出）を足すと年度の違う数字が混ざる
  const [includeOlder, setIncludeOlder] = useState(false);

  useEffect(() => {
    fetch('/api/funds').then(r => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null));
    const p = new URLSearchParams(window.location.search);
    setSelectedKey(p.get('fund'));
    setIncludeOlder(p.get('older') === '1');
    const s = p.get('signal');
    if (s && (FUND_SIGNALS as string[]).includes(s)) setSignal(s as FundSignal);
  }, []);
  // 選択・絞り込みを URL に残す（共有・戻る用）
  useEffect(() => {
    if (data === undefined) return;
    const p = new URLSearchParams();
    if (selectedKey) p.set('fund', selectedKey);
    if (signal) p.set('signal', signal);
    if (includeOlder) p.set('older', '1');
    window.history.replaceState(null, '', `/funds${p.toString() ? `?${p}` : ''}`);
  }, [selectedKey, signal, includeOlder, data]);

  const currentYear = useMemo(() => Math.max(0, ...(data?.funds ?? []).map(f => latestYear(f).sheetYear)), [data]);
  const olderCount = useMemo(() => (data?.funds ?? []).filter(f => latestYear(f).sheetYear < currentYear).length, [data, currentYear]);
  const rows = useMemo(() => (data?.funds ?? []).filter(f => includeOlder || latestYear(f).sheetYear === currentYear)
    .map(f => ({ f, signals: fundSignals(f) })), [data, includeOlder, currentYear]);
  const ministries = useMemo(() => [...new Set(rows.map(r => r.f.ministry))].filter(Boolean).sort(), [rows]);
  const counts = useMemo(() => Object.fromEntries(FUND_SIGNALS.map(s => [s, rows.filter(r => r.signals.includes(s))])) as Record<FundSignal, typeof rows>, [rows]);
  const filtered = useMemo(() => {
    const q = query.trim();
    const list = rows.filter(r => (!signal || r.signals.includes(signal)) && (!ministry || r.f.ministry === ministry)
      && (!q || r.f.name.includes(q) || r.f.owner.includes(q) || !!r.f.sheetTitle?.includes(q)));
    return [...list].sort((a, b) => {
      const va = sortValue(a.f, sort.key), vb = sortValue(b.f, sort.key);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const c = typeof va === 'string' ? va.localeCompare(String(vb), 'ja') : va - (vb as number);
      return sort.desc ? -c : c;
    });
  }, [rows, signal, ministry, query, sort]);
  const selected = rows.find(r => r.f.key === selectedKey) ?? null;
  /** 表示中（絞り込み・並べ替え後）の並びでの位置。前後移動に使う。絞り込みで外れたら -1 */
  const selectedIndex = filtered.findIndex(r => r.f.key === selectedKey);
  // ↑↓で前後の基金へ、Esc で閉じる（入力欄・セレクトの操作中は奪わない）
  useEffect(() => {
    if (!selectedKey) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') { setSelectedKey(null); return; }
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      const next = filtered[selectedIndex + step];
      if (next) { e.preventDefault(); setSelectedKey(next.f.key); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKey, selectedIndex, filtered]);
  // 前後移動で選んだ行が表の外に出ないようにする
  useEffect(() => {
    if (selectedKey) document.querySelector(`tr[data-fund="${CSS.escape(selectedKey)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);
  const totalBalance = filtered.reduce((s, r) => s + (latestYear(r.f).balance ?? 0), 0);
  const summary = useMemo(() => rows.reduce((acc, r) => { const y = latestYear(r.f);
    return { balance: acc.balance + (y.balance ?? 0), expense: acc.expense + (y.expense ?? 0), returned: acc.returned + (y.returned ?? 0) }; },
  { balance: 0, expense: 0, returned: 0 }), [rows]);

  return <div className="flex h-dvh flex-col bg-background text-mirai-text">
    <AppHeader current="/funds">
      <FundsHelp />
    </AppHeader>
    {/* 見出しと全体の集計は評価一覧と同じ帯（白・下罫線）に置き、操作と表はその下の背景の上に並べる */}
    <div className="shrink-0 border-b border-mirai-border bg-card px-3 py-3 sm:px-4">
      <h1 className="text-lg font-bold text-mirai-text">基金の残高と収支</h1>
      <p className="mt-1 text-sm text-mirai-text-muted">
        <span className="mr-3 inline-block">{rows.length.toLocaleString()}基金</span>
        <span className="mr-3 inline-block"><span className="font-bold text-mirai-text">残高</span> 計{formatBudgetFromYen(summary.balance)}</span>
        <span className="mr-3 inline-block"><span className="font-bold text-mirai-text">前年度支出</span> 計{formatBudgetFromYen(summary.expense)}</span>
        <span className="mr-3 inline-block"><span className="font-bold text-mirai-text">国庫返納</span> 計{formatBudgetFromYen(summary.returned)}</span>
        <span className="inline-block text-xs">RSシステムの基金シート（{includeOlder ? `${data?.metadata.sheetYears.join('・')}年版。以前の年度だけに載っている基金はその年度の値` : `最新の${currentYear}年版に載っている基金`}）・府省の記載どおり</span>
      </p>
    </div>
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4 lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="基金名・保有法人で検索" aria-label="基金名・保有法人で検索"
            className="min-w-[10rem] flex-1 rounded-md border border-mirai-border bg-card px-3 py-1.5 text-sm text-mirai-text placeholder:text-mirai-text-placeholder outline-none transition-colors focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/40" />
          <select value={ministry} onChange={e => setMinistry(e.target.value)} aria-label="府省庁" className="rounded-md border border-mirai-border bg-card px-2 py-1.5 text-sm">
            <option value="">全府省庁</option>{ministries.map(m => <option key={m}>{m}</option>)}
          </select>
          <select value={sort.key} onChange={e => setSort({ key: e.target.value as SortKey, desc: e.target.value !== 'name' && e.target.value !== 'endDate' })} aria-label="並び順" className="rounded-md border border-mirai-border bg-card px-2 py-1.5 text-sm">
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}{s.key === 'name' || s.key === 'endDate' ? '（昇順）' : '（大きい順）'}</option>)}
          </select>
          <label className="flex items-center gap-1 text-mirai-text-subtle" title="最新のシート年度に載っていない基金（終了した・シートが出ていないもの）。残高や支出は、その基金が最後に載った年度の値です">
            <input type="checkbox" checked={includeOlder} onChange={e => setIncludeOlder(e.target.checked)} />以前の年度だけに載っている基金も表示（{olderCount}件）
          </label>
          <span className="tabular-nums text-mirai-text-muted">表示 {filtered.length}基金・残高 計{formatBudgetFromYen(totalBalance)}</span>
        </div>
        {/* 論点の絞り込み。切り替えなのでグラデ（主要操作用）は使わず、選択中はティールの面と枠で示す */}
        <div role="group" aria-label="論点で絞り込む" className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-mirai-text-muted">論点</span>
          {([null, ...FUND_SIGNALS] as (FundSignal | null)[]).map(s => {
            const active = signal === s;
            return <Button key={s ?? 'all'} variant="outline" size="xs" aria-pressed={active} title={s ? FUND_SIGNAL_DESCRIPTIONS[s] : undefined}
              onClick={() => setSignal(active || s === null ? null : s)}
              className={`h-7 rounded-full px-2 text-xs font-medium ${active ? 'border-primary bg-mirai-surface-teal text-primary-accent hover:bg-mirai-surface-teal' : 'border-mirai-border bg-card text-mirai-text-subtle'}`}>
              {s ? FUND_SIGNAL_LABELS[s] : 'すべて'}<span className="ml-1 tabular-nums text-mirai-text-muted">{s ? counts[s]?.length ?? 0 : rows.length}</span>
            </Button>;
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-mirai-border bg-card shadow-soft">
          {data === undefined ? <p role="status" className="p-4 text-sm text-mirai-text-muted">読み込み中…</p>
            : data === null ? <p className="p-4 text-sm text-mirai-text-muted">基金データを読み込めませんでした。</p>
            : <table className="w-full min-w-[880px] text-xs">
              <thead className="sticky top-0 z-10 bg-mirai-surface text-mirai-text-muted">
                <tr>{[['基金・保有法人・府省', 'name'], ['残高', 'balance'], ['前年度支出', 'expense'], ['残高÷支出', 'years'], ['国庫返納', 'returned'], ['管理費率', 'adminRate'], ['保有割合', 'ownership'], ['終了予定', 'endDate'], ['論点', null]].map(([label, key]) =>
                  <th key={label} title={FUND_COLUMN_DESCRIPTIONS[key ?? 'signals']} className={`whitespace-nowrap px-2 py-2 font-bold ${key && key !== 'name' && key !== 'endDate' ? 'text-right' : 'text-left'} ${key ? 'cursor-pointer hover:text-mirai-text' : 'cursor-help'}`}
                    onClick={key ? () => setSort(s => ({ key: key as SortKey, desc: s.key === key ? !s.desc : key !== 'name' && key !== 'endDate' })) : undefined}>
                    {label}{sort.key === key ? (sort.desc ? ' ▼' : ' ▲') : ''}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(({ f, signals }) => { const y = latestYear(f); const yrs = spendingYears(y); return <tr key={f.key} data-fund={f.key}
                  aria-selected={selectedKey === f.key}
                  onClick={() => setSelectedKey(f.key)} className={`cursor-pointer hover:bg-mirai-surface-teal/60 ${selectedKey === f.key ? 'bg-mirai-surface-teal/60' : ''}`}>
                  <td className="max-w-[260px] px-2 py-1.5 min-[1700px]:max-w-[300px]"><div className="truncate font-medium" title={f.name}>{f.name}{latestYear(f).sheetYear < currentYear && <span className="ml-1 rounded bg-mirai-surface px-1 text-[10px] font-normal text-mirai-text-muted">{latestYear(f).sheetYear}年版まで</span>}</div>{f.sheetTitle && <div className="truncate text-[11px] text-mirai-text-subtle" title={f.sheetTitle}>{f.sheetTitle}</div>}<div className="truncate text-[11px] text-mirai-text-muted" title={`${f.owner} · ${f.ministry}`}>{f.owner} · {f.ministry}</div></td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{yen(y.balance)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">{yen(y.expense)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{yrs === null ? '—' : `${yrs >= 100 ? Math.round(yrs).toLocaleString() : yrs.toFixed(1)}年分`}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">{y.returned ? yen(y.returned) : '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">{pct(y.adminRate)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">{ownershipPercent(y.ownership)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-mirai-text-subtle">{f.endDate ?? '—'}</td>
                  <td className="px-2 py-1.5"><div className="flex min-w-[9rem] flex-wrap gap-1">{signals.map(s => <span key={s} title={`${FUND_SIGNAL_LABELS[s]}：${FUND_SIGNAL_DESCRIPTIONS[s]}`}
                    className="whitespace-nowrap rounded-md bg-status-warn-bg px-1 py-0.5 text-[10px] font-bold text-status-warn-fg">{FUND_SIGNAL_SHORT[s]}</span>)}</div></td>
                </tr>; })}
              </tbody>
            </table>}
        </div>
      </section>
      {/* 表が主役の画面なので、詳細は右に並べる（左から名前を読んで選び、右で中身を見る）。狭い画面では全画面のシート。
          PC では右の列を常に置き、未選択のときは論点の概要を出す（開閉で表の幅が変わらないように） */}
      {!selected && <FundsOverview rows={rows} signal={signal} onSignal={setSignal} />}
      {selected && <FundDetail fund={selected.f} signals={selected.signals} onClose={() => setSelectedKey(null)}
        position={{ index: selectedIndex, total: filtered.length }}
        onPrev={selectedIndex > 0 ? () => setSelectedKey(filtered[selectedIndex - 1].f.key) : undefined}
        onNext={selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? () => setSelectedKey(filtered[selectedIndex + 1].f.key) : undefined} />}
    </main>
  </div>;
}

function FundDetail({ fund: f, signals, onClose, onPrev, onNext, position }: {
  fund: Fund; signals: FundSignal[]; onClose: () => void;
  /** 表示中の並びでの前後（端・絞り込みで外れたときは undefined） */
  onPrev?: () => void; onNext?: () => void;
  position: { index: number; total: number };
}) {
  const latestSheet = latestYear(f).sheetYear;
  return <aside aria-label={`${f.name} の詳細`}
    className="fixed inset-0 z-50 overflow-y-auto bg-card p-4 text-xs lg:static lg:z-auto lg:min-h-0 lg:w-[380px] lg:shrink-0 min-[1700px]:w-[440px] lg:rounded-xl lg:border lg:border-mirai-border lg:shadow-soft">
    {/* 前後の基金へ（↑↓キーでも移れる） */}
    <div className="mb-2 flex items-center gap-1 border-b border-border pb-2">
      <Button variant="outline" size="xs" onClick={onPrev} disabled={!onPrev} aria-label="前の基金" className="border-mirai-border"><ChevronUp className="size-3.5" />前</Button>
      <Button variant="outline" size="xs" onClick={onNext} disabled={!onNext} aria-label="次の基金" className="border-mirai-border"><ChevronDown className="size-3.5" />次</Button>
      <span className="ml-1 tabular-nums text-mirai-text-muted">{position.index >= 0 ? `${position.index + 1} / ${position.total}` : '絞り込みの外'}</span>
      <span className="ml-auto hidden text-[10px] text-mirai-text-muted lg:inline">↑↓キーでも移れます</span>
      {/* 閉じるはパネルの一番上の段（前後移動と同じ段）の右端に置く */}
      <Button variant="ghost" size="icon-sm" aria-label="選択を解除" onClick={onClose} className="ml-1 lg:ml-2"><X /></Button>
    </div>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[11px] text-mirai-text-muted">{f.ministry}{f.sheetNumber !== null && ` · 基金シート ${f.sheetNumber}`}</div>
        <h2 className="mt-1 text-sm font-bold">{f.name}</h2>
        {f.sheetTitle && <div className="text-mirai-text-subtle">{f.sheetTitle}</div>}
        <div className="mt-0.5 text-mirai-text-subtle">保有法人: {f.owner || '—'}{f.ownerForm && `（${OWNER_FORM_LABELS[f.ownerForm] ?? f.ownerForm}）`}</div>
      </div>
    </div>
    {signals.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{signals.map(s => <span key={s} title={FUND_SIGNAL_DESCRIPTIONS[s]}
      className="rounded-md bg-status-warn-bg px-1.5 py-0.5 text-[10px] font-bold text-status-warn-fg">{FUND_SIGNAL_LABELS[s]}</span>)}</div>}
    {/* 要点の数字（最新の基金シート） */}
    {(() => { const y = latestYear(f); const yrs = spendingYears(y); return <dl className="mt-3 grid grid-cols-2 gap-2">
      {([['年度末の残高', yen(y.balance)], ['前年度の支出', yen(y.expense)], ['残高÷支出', yrs === null ? '—' : `${yrs >= 100 ? Math.round(yrs).toLocaleString() : yrs.toFixed(1)}年分`], ['国庫返納', y.returned ? yen(y.returned) : '—']] as [string, string][])
        .map(([label, value]) => <div key={label} className="rounded-xl bg-mirai-surface px-3 py-2">
          <dt className="text-[11px] text-mirai-text-muted">{label}</dt><dd className="text-base font-bold tabular-nums text-mirai-text">{value}</dd></div>)}
    </dl>; })()}
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
      <div><dt className="text-mirai-text-muted">造成年度</dt><dd>{f.createdYear ?? '—'}</dd></div>
      <div><dt className="text-mirai-text-muted">終了予定</dt><dd>{f.endDate ?? '—'}</dd></div>
      <div><dt className="text-mirai-text-muted">新規受付の終了</dt><dd>{f.newApplicationEndDate ?? '—'}</dd></div>
      <div><dt className="text-mirai-text-muted">運営の形態</dt><dd>{formLabels(f.operationForms, OPERATION_FORM_LABELS).join('・') || '—'}</dd></div>
      <div><dt className="text-mirai-text-muted">事業の形態</dt><dd>{formLabels(f.businessForms, BUSINESS_FORM_LABELS).join('・') || '—'}</dd></div>
    </dl>
    <h3 className="mb-1 mt-4 font-bold text-mirai-text-secondary">残高と収支の推移</h3>
    <table className="w-full table-fixed text-[11px]">
      <thead className="text-mirai-text-muted"><tr><th className="w-[30%] text-left font-normal" />{f.years.map(y => <th key={y.sheetYear} className="text-right font-normal">{fyLabel(y.sheetYear)}</th>)}</tr></thead>
      <tbody className="divide-y divide-border tabular-nums">
        {([['年度末の残高', y => yen(y.balance)], ['国からの交付', y => yen(y.granted)], ['支出', y => yen(y.expense)], ['うち管理費', y => yen(y.adminExpense)],
          ['管理費率', y => pct(y.adminRate)], ['国庫返納', y => yen(y.returned)], ['乖離率', y => pct(y.divergence)], ['保有割合', y => ownershipPercent(y.ownership)]] as [string, (y: Fund['years'][number]) => string][])
          .map(([label, fmt]) => <tr key={label}><td className="py-1 text-mirai-text-muted">{label}</td>{f.years.map(y => <td key={y.sheetYear} className="py-1 text-right">{fmt(y)}</td>)}</tr>)}
      </tbody>
    </table>
    <p className="mt-1 text-[10px] text-mirai-text-muted">年度は実績の年度です（{f.years[0].sheetYear}〜{latestSheet}年版基金シートに記載された「前年度」の値）。残高はその年度の末の値です。</p>
    {f.compositions.length > 0 && <>
      <h3 className="mb-1 mt-4 font-bold text-mirai-text-secondary">造成の経緯（国費の投入）</h3>
      <ul className="m-0 list-none space-y-0.5 p-0">{f.compositions.map((c, i) => <li key={i} className="flex justify-between gap-2">
        <span className="text-mirai-text-subtle">{c.fiscalYear ?? '—'}年度 {budgetLabel(c.budget)}</span><span className="tabular-nums">{yen(c.amount)}</span></li>)}</ul>
    </>}
    {f.relatedProjects.length > 0 && <>
      <h3 className="mb-1 mt-4 font-bold text-mirai-text-secondary">造成元・関連の事業</h3>
      <ul className="m-0 list-none space-y-1 p-0">{f.relatedProjects.map(p => <li key={p.pid}>
        <Link href={unifiedProjectUrlForSheet(p.pid, p.sheetYear)} className="text-primary underline underline-offset-4 hover:text-primary-accent">{p.name}</Link>
        <span className="ml-1 text-[11px] text-mirai-text-muted">予算事業ID {p.pid}・{p.sheetYear - 1}年度まで</span></li>)}</ul>
    </>}
    {f.owner && <p className="mt-3"><Link href={`/budget-sankey?year=2024&frq=${encodeURIComponent(f.owner)}`} className="text-primary underline underline-offset-4 hover:text-primary-accent">保有法人「{f.owner}」への支出をサンキー図で見る</Link></p>}
    {/* 長い文章は折りたたむ（パネルの先頭は数字と推移で見比べられるように） */}
    {f.necessity && <LongText title="基金で行う必要性（府省の記載）" text={f.necessity} />}
    {f.ownershipBasis && <LongText title="保有割合の算定根拠（府省の記載）" text={f.ownershipBasis} />}
    <h3 className="mb-1 mt-4 font-bold text-mirai-text-secondary">低執行の基金の点検（府省の記載）</h3>
    <ul className="m-0 list-none space-y-0.5 p-0">{(Object.keys(INSPECTION_LABELS) as (keyof Fund['inspection'])[]).map(k => <li key={k} className="flex justify-between gap-2">
      <span className="text-mirai-text-subtle">{INSPECTION_LABELS[k]}</span><span className={f.inspection[k] ? 'font-bold text-status-warn-fg' : 'text-mirai-text-muted'}>{f.inspection[k] ? '該当' : '—'}</span></li>)}</ul>
    {f.inspectionNote && <LongText title="点検の記載" text={f.inspectionNote} />}
    {f.overviewUrl && /^https?:\/\//.test(f.overviewUrl) && <p className="mt-3"><a href={f.overviewUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary-accent">府省の事業概要 ↗</a></p>}
  </aside>;
}

function FundsHelp() {
  return <HeaderHelp id="funds-help" label="基金一覧の説明">
    <h2 className="mb-2 text-[13px] font-bold">基金とは</h2>
    <p className="text-mirai-text-subtle">複数年度にわたる事業の費用を、国があらかじめ法人（基金保有法人）に積み立てておく仕組みです。単年度の予算では対応しにくい事業に使われます。残高が大きいこと自体は問題ではありません。</p>
    <h2 className="mb-2 mt-4 text-[13px] font-bold">論点（絞り込みのボタン）</h2>
    <dl className="space-y-1.5 text-mirai-text-subtle">{FUND_SIGNALS.map(s => <div key={s}><dt className="inline font-bold text-mirai-text">{FUND_SIGNAL_LABELS[s]}：</dt><dd className="inline">{FUND_SIGNAL_DESCRIPTIONS[s]}</dd></div>)}</dl>
    <p className="mt-2 text-mirai-text-muted">いずれも確かめる手がかりで、不適切さの判定ではありません。</p>
    <h2 className="mb-2 mt-4 text-[13px] font-bold">データについて</h2>
    <ul className="m-0 list-disc space-y-1 pl-4 text-mirai-text-subtle">
      <li>RSシステムの基金シート（RS公開API）。金額・率は府省の記載どおりで、このサイトでは検証していません。</li>
      <li>シート年度 N の「前年度」の値は年度 N−1 の実績です。残高は年度 N−1 の末（年度 N の初め）の値です。</li>
      <li>造成元の事業は、基金シートに記載された関連レビューシート・造成の経緯から引き当てています（全基金の約3分の1）。</li>
    </ul>
  </HeaderHelp>;
}

function LongText({ title, text }: { title: string; text: string }) {
  return <details className="mt-3 rounded-lg border border-border px-3 py-2">
    <summary className="cursor-pointer font-bold text-mirai-text-secondary">{title}</summary>
    <p className="mt-2 whitespace-pre-wrap leading-relaxed text-mirai-text-subtle">{text}</p>
  </details>;
}

/** 未選択のときの右の列。論点ごとの基金数と残高の合計（クリックで絞り込み）と、選び方の案内 */
function FundsOverview({ rows, signal, onSignal }: {
  rows: { f: Fund; signals: FundSignal[] }[]; signal: FundSignal | null; onSignal: (s: FundSignal | null) => void;
}) {
  return <aside aria-label="論点の概要" className="hidden min-h-0 w-[380px] shrink-0 overflow-y-auto min-[1700px]:w-[440px] rounded-xl border border-mirai-border bg-card p-4 text-xs shadow-soft lg:block">
    <h2 className="text-sm font-bold">論点ごとの基金</h2>
    <p className="mt-1 leading-relaxed text-mirai-text-muted">表の行を選ぶと、ここにその基金の詳細が出ます（↑↓キーで前後の基金に移れます）。論点を選ぶと表を絞り込みます。</p>
    <ul className="m-0 mt-3 list-none space-y-1 p-0">
      {FUND_SIGNALS.map(s => {
        const hit = rows.filter(r => r.signals.includes(s));
        const balance = hit.reduce((sum, r) => sum + (latestYear(r.f).balance ?? 0), 0);
        const active = signal === s;
        return <li key={s}>
          <Button variant="ghost" onClick={() => onSignal(active ? null : s)} aria-pressed={active} title={FUND_SIGNAL_DESCRIPTIONS[s]}
            className={`h-auto w-full justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs font-normal ${active ? 'bg-mirai-surface-teal text-primary-accent hover:bg-mirai-surface-teal' : 'hover:bg-mirai-surface'}`}>
            <span className="min-w-0"><span className="block font-bold text-mirai-text">{FUND_SIGNAL_LABELS[s]}</span>
              <span className="block truncate text-[11px] text-mirai-text-muted">{FUND_SIGNAL_DESCRIPTIONS[s]}</span></span>
            <span className="shrink-0 text-right tabular-nums"><span className="block font-bold text-mirai-text">{hit.length}基金</span>
              <span className="block text-[11px] text-mirai-text-muted">残高 {formatBudgetFromYen(balance)}</span></span>
          </Button>
        </li>;
      })}
    </ul>
    <p className="mt-3 text-[11px] leading-relaxed text-mirai-text-muted">いずれも確かめる手がかりで、不適切さの判定ではありません。金額は府省の記載どおりです。</p>
  </aside>;
}
