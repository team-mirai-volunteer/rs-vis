'use client';

/**
 * 事業者別の横断ビュー（/vendors）。契約方式データを法人番号でまとめ、全府省での受注・1者応札・随意契約を事業者ごとに並べる。
 * 行を選ぶと右に事業者の詳細（年度別の集計・府省別・1者応札が続く事業・支出先としての説明）を出す。
 * 一覧は契約額の下限以上の事業者だけ（軽い行）。下限未満は検索ボタンでサーバー側を引く。
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { Button } from '@/components/ui/button';
import { HeaderHelp } from '@/client/components/HeaderHelp';
import { UnifiedRecipientProfile } from '@/client/components/unified-budget/UnifiedRecipientProfile';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { historyYearLabel } from '@/app/lib/contract-history';
import { unifiedProjectUrlForSheet } from '@/app/lib/unified-budget/links';
import { CORPORATE_KIND_LABELS } from '@/app/lib/recipient-profile';
import {
  avgMultiBidRate, avgSingleBidRate, fromVendorRow, matchVendor, nonCompetitiveShare, singleBidRatio, sortVendors,
  VENDOR_COLUMN_DESCRIPTIONS, VENDOR_KIND_GROUP_LABELS, VENDOR_SIGNAL_DESCRIPTIONS, VENDOR_SIGNAL_LABELS, VENDOR_SIGNAL_SHORT, VENDOR_SIGNALS, VENDOR_SORTS,
  vendorKindGroup, vendorSignals, type VendorKindGroup, type VendorRow, type VendorSignal, type VendorSortKey,
} from '@/app/lib/vendors';
import type { Vendor, VendorsFile } from '@/types/vendors';

type ListResponse = { metadata: VendorsFile['metadata']; rows: VendorRow[]; minContract: number; totalVendors: number };
type Row = { v: Vendor; signals: VendorSignal[] };

const yen = (v: number) => (v > 0 ? formatBudgetFromYen(v) : '—');
const pct = (v: number | null, digits = 0) => (v === null ? '—' : `${v.toFixed(digits)}%`);
/** 詳細パネルの支出先説明は 2024年度実績（2025年版シート）の支出先インデックスで引く */
const PROFILE_SHEET_YEAR = 2025;

export default function VendorsView() {
  const [data, setData] = useState<ListResponse | null | undefined>(undefined);
  const [signal, setSignal] = useState<VendorSignal | null>(null);
  const [kind, setKind] = useState<VendorKindGroup | ''>('');
  const [ministry, setMinistry] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: VendorSortKey; desc: boolean }>({ key: 'contractAmount', desc: true });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** 一覧の下限未満も含めたサーバー検索の結果（検索ボタンを押したときだけ） */
  const [searched, setSearched] = useState<{ q: string; rows: VendorRow[]; limit: number } | null>(null);

  useEffect(() => {
    fetch('/api/vendors').then(r => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null));
    const p = new URLSearchParams(window.location.search);
    setSelectedKey(p.get('vendor'));
    setQuery(p.get('q') ?? '');
    const s = p.get('signal');
    if (s && (VENDOR_SIGNALS as string[]).includes(s)) setSignal(s as VendorSignal);
    const so = p.get('sort');
    const found = VENDOR_SORTS.find(x => x.key === so);
    if (found) setSort({ key: found.key, desc: found.desc });
  }, []);
  useEffect(() => {
    if (data === undefined) return;
    const p = new URLSearchParams();
    if (selectedKey) p.set('vendor', selectedKey);
    if (signal) p.set('signal', signal);
    if (query.trim()) p.set('q', query.trim());
    if (sort.key !== 'contractAmount') p.set('sort', sort.key);
    window.history.replaceState(null, '', `/vendors${p.toString() ? `?${p}` : ''}`);
  }, [selectedKey, signal, query, sort, data]);

  const rows = useMemo<Row[]>(() => {
    const source = searched && searched.q === query.trim() ? searched.rows : data?.rows ?? [];
    return source.map(r => { const v = fromVendorRow(r); return { v, signals: vendorSignals(v) }; });
  }, [data, searched, query]);
  const ministries = useMemo(() => [...new Set((data?.rows ?? []).map(r => r.ministry).filter((m): m is string => !!m))].sort(), [data]);
  const counts = useMemo(() => Object.fromEntries(VENDOR_SIGNALS.map(s => [s, rows.filter(r => r.signals.includes(s)).length])) as Record<VendorSignal, number>, [rows]);
  const filtered = useMemo(() => {
    const q = query.trim();
    const list = rows.filter(r => (!signal || r.signals.includes(signal)) && (!kind || vendorKindGroup(r.v.kind) === kind)
      && (!ministry || r.v.ministries[0]?.ministry === ministry) && matchVendor(r.v, q));
    const sorted = sortVendors(list.map(r => r.v), sort.key, sort.desc);
    const byKey = new Map(list.map(r => [r.v.key, r]));
    return sorted.map(v => byKey.get(v.key)!);
  }, [rows, signal, kind, ministry, query, sort]);
  const selectedIndex = filtered.findIndex(r => r.v.key === selectedKey);
  const selected = selectedKey ? filtered[selectedIndex] ?? rows.find(r => r.v.key === selectedKey) ?? null : null;

  useEffect(() => {
    if (!selectedKey) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') { setSelectedKey(null); return; }
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      const next = filtered[selectedIndex + step];
      if (next) { e.preventDefault(); setSelectedKey(next.v.key); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKey, selectedIndex, filtered]);
  useEffect(() => {
    if (selectedKey) document.querySelector(`tr[data-vendor="${CSS.escape(selectedKey)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  const searchAll = async () => {
    const q = query.trim();
    if (!q) return;
    const r = await fetch(`/api/vendors?q=${encodeURIComponent(q)}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (r) setSearched({ q, rows: r.rows, limit: r.limit });
  };

  const summary = useMemo(() => filtered.reduce((acc, r) => ({ contract: acc.contract + r.v.total.contractAmount, single: acc.single + r.v.total.singleAmount, sole: acc.sole + r.v.total.soleAmount }),
    { contract: 0, single: 0, sole: 0 }), [filtered]);
  const sheetYears = data?.metadata.sheetYears ?? [];

  return <div className="flex h-dvh flex-col bg-background text-mirai-text">
    <AppHeader current="/vendors"><VendorsHelp /></AppHeader>
    <div className="shrink-0 border-b border-mirai-border bg-card px-3 py-3 sm:px-4">
      <h1 className="text-lg font-bold text-mirai-text">事業者別の受注と競争性</h1>
      <p className="mt-1 text-sm text-mirai-text-muted">
        <span className="mr-3 inline-block">{data ? `${data.totalVendors.toLocaleString()}事業者（一覧は契約額${(data.minContract / 1e4).toLocaleString()}万円以上の${data.rows.length.toLocaleString()}事業者）` : '読み込み中…'}</span>
        <span className="mr-3 inline-block"><span className="font-bold text-mirai-text">契約額</span> 計{formatBudgetFromYen(summary.contract)}</span>
        <span className="mr-3 inline-block"><span className="font-bold text-mirai-text">1者応札</span> 計{formatBudgetFromYen(summary.single)}</span>
        <span className="mr-3 inline-block"><span className="font-bold text-mirai-text">競争なしの随意契約</span> 計{formatBudgetFromYen(summary.sole)}</span>
        <span className="inline-block text-xs">{sheetYears.length ? `${sheetYears[0] - 1}〜${sheetYears[sheetYears.length - 1] - 1}年度の契約（RS公開API・${sheetYears[sheetYears.length - 1] - 1}年度は暫定）の合計・府省の記載どおり` : ''}</span>
      </p>
    </div>
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4 lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void searchAll(); }} placeholder="事業者名・法人番号で検索" aria-label="事業者名・法人番号で検索"
            className="min-w-[10rem] flex-1 rounded-md border border-mirai-border bg-card px-3 py-1.5 text-sm text-mirai-text placeholder:text-mirai-text-placeholder outline-none transition-colors focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/40" />
          <Button variant="outline" size="xs" onClick={() => void searchAll()} disabled={!query.trim()} title="一覧の下限未満の事業者も含めて検索する" className="h-7 border-mirai-border"><Search className="size-3.5" />全事業者から検索</Button>
          <select value={kind} onChange={e => setKind(e.target.value as VendorKindGroup | '')} aria-label="法人種別" className="rounded-md border border-mirai-border bg-card px-2 py-1.5 text-sm">
            <option value="">全種別</option>{(Object.keys(VENDOR_KIND_GROUP_LABELS) as VendorKindGroup[]).map(k => <option key={k} value={k}>{VENDOR_KIND_GROUP_LABELS[k]}</option>)}
          </select>
          <select value={ministry} onChange={e => setMinistry(e.target.value)} aria-label="主な府省" className="rounded-md border border-mirai-border bg-card px-2 py-1.5 text-sm">
            <option value="">主な府省（すべて）</option>{ministries.map(m => <option key={m}>{m}</option>)}
          </select>
          <select value={sort.key} onChange={e => { const s = VENDOR_SORTS.find(x => x.key === e.target.value)!; setSort({ key: s.key, desc: s.desc }); }} aria-label="並び順" className="rounded-md border border-mirai-border bg-card px-2 py-1.5 text-sm">
            {VENDOR_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}{s.desc ? '（大きい順）' : '（昇順）'}</option>)}
          </select>
          <span className="tabular-nums text-mirai-text-muted">表示 {filtered.length.toLocaleString()}事業者{searched && searched.q === query.trim() ? `（全事業者から検索・上位${searched.limit}件）` : ''}</span>
        </div>
        <div role="group" aria-label="論点で絞り込む" className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-mirai-text-muted">論点</span>
          {([null, ...VENDOR_SIGNALS] as (VendorSignal | null)[]).map(s => {
            const active = signal === s;
            return <Button key={s ?? 'all'} variant="outline" size="xs" aria-pressed={active} title={s ? VENDOR_SIGNAL_DESCRIPTIONS[s] : undefined}
              onClick={() => setSignal(active || s === null ? null : s)}
              className={`h-7 rounded-full px-2 text-xs font-medium ${active ? 'border-primary bg-mirai-surface-teal text-primary-accent hover:bg-mirai-surface-teal' : 'border-mirai-border bg-card text-mirai-text-subtle'}`}>
              {s ? VENDOR_SIGNAL_LABELS[s] : 'すべて'}<span className="ml-1 tabular-nums text-mirai-text-muted">{s ? counts[s] ?? 0 : rows.length}</span>
            </Button>;
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-mirai-border bg-card shadow-soft">
          {data === undefined ? <p role="status" className="p-4 text-sm text-mirai-text-muted">読み込み中…</p>
            : data === null ? <p className="p-4 text-sm text-mirai-text-muted">事業者データを読み込めませんでした。</p>
            : <table className="w-full min-w-[960px] text-xs">
              <thead className="sticky top-0 z-10 bg-mirai-surface text-mirai-text-muted">
                <tr>{([['事業者・法人番号・主な府省', 'name', 'name'], ['契約額', 'contractAmount', 'contractAmount'], ['1者応札（金額・率）', 'singleAmount', 'single'], ['落札率 1者（複数）', 'bidRate', 'bidRate'],
                  ['競争なし随契', 'soleAmount', 'sole'], ['競争を経ない割合', 'nonCompetitive', 'nonCompetitive'], ['事業・府省', 'projects', 'projects'], ['1者連続', 'repeatSingle', 'repeat'], ['論点', null, 'signals']] as [string, VendorSortKey | null, string][]).map(([label, key, desc]) =>
                  <th key={label} title={VENDOR_COLUMN_DESCRIPTIONS[desc]} className={`whitespace-nowrap px-2 py-2 font-bold ${key && key !== 'name' ? 'text-right' : 'text-left'} ${key ? 'cursor-pointer hover:text-mirai-text' : 'cursor-help'}`}
                    onClick={key ? () => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== 'name' })) : undefined}>
                    {label}{sort.key === key ? (sort.desc ? ' ▼' : ' ▲') : ''}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(({ v, signals }) => { const t = v.total; return <tr key={v.key} data-vendor={v.key} aria-selected={selectedKey === v.key}
                  onClick={() => setSelectedKey(v.key)} className={`cursor-pointer hover:bg-mirai-surface-teal/60 ${selectedKey === v.key ? 'bg-mirai-surface-teal/60' : ''}`}>
                  <td className="max-w-[280px] px-2 py-1.5 min-[1700px]:max-w-[340px]">
                    <div className="truncate font-medium" title={v.name}>{v.name}</div>
                    <div className="truncate text-[11px] text-mirai-text-muted">{v.corporateNumber ? <span className="tabular-nums">{v.corporateNumber}</span> : '法人番号なし'}{v.kind && ` · ${CORPORATE_KIND_LABELS[v.kind]?.split('（')[0] ?? ''}`}{v.ministries[0] && ` · ${v.ministries[0].ministry}`}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{yen(t.contractAmount)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{yen(t.singleAmount)}<span className="ml-1 text-mirai-text-muted">{t.competitiveWithApplicants > 0 ? `${pct(singleBidRatio(t))}（${t.singleCount}/${t.competitiveWithApplicants}）` : ''}</span></td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">{pct(avgSingleBidRate(t), 1)}{t.multiBidRateN > 0 && <span className="text-mirai-text-muted">（{pct(avgMultiBidRate(t), 1)}）</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">{yen(t.soleAmount)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{pct(nonCompetitiveShare(t))}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">{t.projects}事業・{t.ministries}府省</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{v.repeatSingleCount > 0 ? `${v.repeatSingleCount}事業` : '—'}</td>
                  <td className="px-2 py-1.5"><div className="flex min-w-[8rem] flex-wrap gap-1">{signals.map(s => <span key={s} title={`${VENDOR_SIGNAL_LABELS[s]}：${VENDOR_SIGNAL_DESCRIPTIONS[s]}`}
                    className="whitespace-nowrap rounded-md bg-status-warn-bg px-1 py-0.5 text-[10px] font-bold text-status-warn-fg">{VENDOR_SIGNAL_SHORT[s]}</span>)}</div></td>
                </tr>; })}
              </tbody>
            </table>}
        </div>
      </section>
      {!selected && <VendorsOverview rows={rows} signal={signal} onSignal={setSignal} />}
      {selected && <VendorDetail vendorKey={selected.v.key} row={selected.v} signals={selected.signals} onClose={() => setSelectedKey(null)}
        position={{ index: selectedIndex, total: filtered.length }}
        onPrev={selectedIndex > 0 ? () => setSelectedKey(filtered[selectedIndex - 1].v.key) : undefined}
        onNext={selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? () => setSelectedKey(filtered[selectedIndex + 1].v.key) : undefined} />}
    </main>
  </div>;
}

const detailCache = new Map<string, Vendor | null>();

function VendorDetail({ vendorKey, row, signals, onClose, onPrev, onNext, position }: {
  vendorKey: string; row: Vendor; signals: VendorSignal[]; onClose: () => void; onPrev?: () => void; onNext?: () => void; position: { index: number; total: number };
}) {
  const [full, setFull] = useState<Vendor | null | undefined>(detailCache.get(vendorKey));
  useEffect(() => {
    if (detailCache.has(vendorKey)) { setFull(detailCache.get(vendorKey)); return; }
    setFull(undefined);
    let alive = true;
    fetch(`/api/vendors?key=${encodeURIComponent(vendorKey)}`).then(r => (r.ok ? r.json() : null)).then(j => { const v = j?.vendor ?? null; detailCache.set(vendorKey, v); if (alive) setFull(v); })
      .catch(() => { if (alive) setFull(null); });
    return () => { alive = false; };
  }, [vendorKey]);
  const v = full ?? row;
  const t = v.total;
  return <aside aria-label={`${v.name} の詳細`}
    className="fixed inset-0 z-50 overflow-y-auto bg-card p-4 text-xs lg:static lg:z-auto lg:min-h-0 lg:w-[400px] lg:shrink-0 min-[1700px]:w-[460px] lg:rounded-xl lg:border lg:border-mirai-border lg:shadow-soft">
    <div className="mb-2 flex items-center gap-1 border-b border-border pb-2">
      <Button variant="outline" size="xs" onClick={onPrev} disabled={!onPrev} aria-label="前の事業者" className="border-mirai-border"><ChevronUp className="size-3.5" />前</Button>
      <Button variant="outline" size="xs" onClick={onNext} disabled={!onNext} aria-label="次の事業者" className="border-mirai-border"><ChevronDown className="size-3.5" />次</Button>
      <span className="ml-1 tabular-nums text-mirai-text-muted">{position.index >= 0 ? `${position.index + 1} / ${position.total}` : '絞り込みの外'}</span>
      <span className="ml-auto hidden text-[10px] text-mirai-text-muted lg:inline">↑↓キーでも移れます</span>
      <Button variant="ghost" size="icon-sm" aria-label="選択を解除" onClick={onClose} className="ml-1 lg:ml-2"><X /></Button>
    </div>
    <div className="text-[11px] text-mirai-text-muted">{v.corporateNumber ? <span className="tabular-nums">法人番号 {v.corporateNumber}</span> : '法人番号の記載なし（名前でまとめた相手）'}{v.kind && ` · ${CORPORATE_KIND_LABELS[v.kind] ?? v.kind}`}</div>
    <h2 className="mt-1 text-sm font-bold">{v.name}</h2>
    {signals.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{signals.map(s => <span key={s} title={VENDOR_SIGNAL_DESCRIPTIONS[s]}
      className="rounded-md bg-status-warn-bg px-1.5 py-0.5 text-[10px] font-bold text-status-warn-fg">{VENDOR_SIGNAL_LABELS[s]}</span>)}</div>}
    <dl className="mt-3 grid grid-cols-2 gap-2">
      {([['契約額（全年度）', yen(t.contractAmount)], ['1者応札', `${yen(t.singleAmount)}${t.competitiveWithApplicants ? ` · ${pct(singleBidRatio(t))}` : ''}`],
        ['競争なしの随意契約', yen(t.soleAmount)], ['1者応札の落札率', `${pct(avgSingleBidRate(t), 1)}${t.multiBidRateN ? `（複数 ${pct(avgMultiBidRate(t), 1)}）` : ''}`]] as [string, string][])
        .map(([label, value]) => <div key={label} className="rounded-xl bg-mirai-surface px-3 py-2">
          <dt className="text-[11px] text-mirai-text-muted">{label}</dt><dd className="text-sm font-bold tabular-nums text-mirai-text">{value}</dd></div>)}
    </dl>
    {full === undefined && <p role="status" className="mt-3 text-mirai-text-muted">年度別の集計を読み込み中…</p>}
    {full && <>
      <h3 className="mb-1 mt-4 font-bold text-mirai-text-secondary">年度別の受注</h3>
      <table className="w-full table-fixed text-[11px]">
        <thead className="text-mirai-text-muted"><tr><th className="w-[34%] text-left font-normal" />{full.years.map(y => <th key={y.sheetYear} className="text-right font-normal">{historyYearLabel(String(y.sheetYear)).replace('（暫定）', '*')}</th>)}</tr></thead>
        <tbody className="divide-y divide-border tabular-nums">
          {([['契約額', y => yen(y.contractAmount)], ['うち競争入札', y => yen(y.competitiveAmount)], ['うち1者応札', y => yen(y.singleAmount)],
            ['1者応札の件数／記載あり', y => (y.competitiveWithApplicants ? `${y.singleCount}／${y.competitiveWithApplicants}件` : '—')],
            ['1者応札の落札率', y => pct(avgSingleBidRate(y), 1)], ['競争なし随契', y => yen(y.soleAmount)], ['企画競争・公募', y => yen(y.negotiatedCompetitiveAmount)],
            ['国庫債務負担行為', y => yen(y.multiYearAmount)], ['補助金等（契約以外）', y => yen(y.nonContractAmount)], ['事業数・府省数', y => `${y.projects}・${y.ministries}`]] as [string, (y: Vendor['years'][number]) => string][])
            .map(([label, fmt]) => <tr key={label}><td className="py-1 text-mirai-text-muted">{label}</td>{full.years.map(y => <td key={y.sheetYear} className="py-1 text-right">{fmt(y)}</td>)}</tr>)}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-mirai-text-muted">* は公開途中の暫定値。年度は契約の実績年度（シート年度の前年度）。</p>
      {full.ministries.length > 0 && <>
        <h3 className="mb-1 mt-4 font-bold text-mirai-text-secondary">支出元の府省（契約額・全年度）</h3>
        <ul className="m-0 list-none space-y-0.5 p-0">{full.ministries.map(m => <li key={m.ministry} className="flex justify-between gap-2">
          <span className="text-mirai-text-subtle">{m.ministry}<span className="ml-1 text-mirai-text-muted">{m.projects}事業</span></span><span className="tabular-nums">{yen(m.amount)}</span></li>)}</ul>
      </>}
      {full.repeatSingle.length > 0 && <>
        <h3 className="mb-1 mt-4 font-bold text-mirai-text-secondary">同じ事業で1者応札が続く<span className="ml-1 font-normal text-mirai-text-muted">{full.repeatSingleCount}事業</span></h3>
        <ul className="m-0 list-none space-y-1 p-0">{full.repeatSingle.map(p => <li key={p.pid} className="rounded-lg bg-mirai-surface px-2 py-1.5">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/quality?pid=${p.pid}`} className="min-w-0 truncate text-primary underline underline-offset-4 hover:text-primary-accent" title={p.name ?? p.pid}>{p.name ?? `事業 ${p.pid}`}</Link>
            <span className="shrink-0 tabular-nums">{yen(p.amount)}</span>
          </div>
          <div className="text-[10px] text-mirai-text-muted">{p.ministry ?? ''} · {p.sheetYears.map(y => `${y - 1}年度`).join('・')}に1者応札 · <a href={unifiedProjectUrlForSheet(p.pid, Math.max(...p.sheetYears))} className="underline underline-offset-2 hover:text-primary-accent">サンキー図で開く</a></div>
        </li>)}</ul>
        {full.repeatSingleCount > full.repeatSingle.length && <p className="mt-0.5 text-[10px] text-mirai-text-muted">ほか{full.repeatSingleCount - full.repeatSingle.length}事業</p>}
      </>}
      {full.repeatSoleCount > 0 && <p className="mt-2 text-mirai-text-subtle">同じ事業で競争なしの随意契約が2年度以上続くもの：{full.repeatSoleCount}事業（下の「契約方式の推移」に一覧）</p>}
    </>}
    <h3 className="mb-1 mt-4 font-bold text-mirai-text-secondary">支出先としての説明</h3>
    <UnifiedRecipientProfile name={v.name} sheetYear={PROFILE_SHEET_YEAR} corporateNumber={v.corporateNumber || undefined} scaleFont={px => px} />
  </aside>;
}

function VendorsOverview({ rows, signal, onSignal }: { rows: Row[]; signal: VendorSignal | null; onSignal: (s: VendorSignal | null) => void }) {
  return <aside aria-label="論点の概要" className="hidden lg:block lg:w-[400px] lg:shrink-0 min-[1700px]:w-[460px] lg:rounded-xl lg:border lg:border-mirai-border lg:bg-card lg:p-4 lg:shadow-soft lg:overflow-y-auto text-xs">
    <h2 className="text-sm font-bold">論点ごとの事業者数と1者応札の金額</h2>
    <p className="mt-1 text-mirai-text-muted">行を選ぶと事業者の詳細（年度別・府省別・1者応札が続く事業・支出先としての説明）を出します。</p>
    <ul className="mt-3 space-y-1">{VENDOR_SIGNALS.map(s => { const hit = rows.filter(r => r.signals.includes(s)); const single = hit.reduce((a, r) => a + r.v.total.singleAmount, 0);
      return <li key={s}><button type="button" onClick={() => onSignal(signal === s ? null : s)} aria-pressed={signal === s}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-mirai-surface-teal/60 ${signal === s ? 'bg-mirai-surface-teal/60' : ''}`}>
        <span><span className="font-bold">{VENDOR_SIGNAL_LABELS[s]}</span><span className="ml-1 text-mirai-text-muted">{hit.length.toLocaleString()}事業者</span></span>
        <span className="shrink-0 tabular-nums text-mirai-text-subtle">1者応札 {yen(single)}</span></button></li>; })}</ul>
    <p className="mt-3 text-[11px] leading-relaxed text-mirai-text-muted">いずれも確かめる手がかりで、不適切さの判定ではありません。1者応札には特殊装備・備蓄基地・システム保守の継続など参入障壁が合理的なものを含みます。</p>
  </aside>;
}

function VendorsHelp() {
  return <HeaderHelp id="vendors-help" label="事業者一覧の説明">
    <h2 className="mb-2 text-[13px] font-bold">この一覧で分かること</h2>
    <p className="text-mirai-text-subtle">レビューシートの契約情報を事業者（法人番号）でまとめ、全府省での受注額、競争入札のうち応札が1者だった割合、競争なしの随意契約の額、同じ事業で1者応札が続いているかを並べます。</p>
    <h2 className="mb-2 mt-4 text-[13px] font-bold">論点（絞り込みのボタン）</h2>
    <dl className="space-y-1.5 text-mirai-text-subtle">{VENDOR_SIGNALS.map(s => <div key={s}><dt className="inline font-bold text-mirai-text">{VENDOR_SIGNAL_LABELS[s]}：</dt><dd className="inline">{VENDOR_SIGNAL_DESCRIPTIONS[s]}</dd></div>)}</dl>
    <p className="mt-2 text-mirai-text-muted">いずれも確かめる手がかりで、不適切さの判定ではありません。</p>
    <h2 className="mb-2 mt-4 text-[13px] font-bold">データについて</h2>
    <ul className="m-0 list-disc space-y-1 pl-4 text-mirai-text-subtle">
      <li>RS公開APIの契約方式（2024〜2026年版シート＝2023〜2025年度の契約。2025年度は公開途中の暫定）。金額・応札者数・落札率は府省の記載どおりです。</li>
      <li>事業者は法人番号でまとめ、番号の無い記載は名前でまとめています。同じ会社が番号あり・なしで別に数えられることがあります。</li>
      <li>一覧は契約額が一定以上の事業者だけです。それ未満は「全事業者から検索」で引けます。補助金・交付金だけの相手は含みません。</li>
      <li>1者応札率は、応札者数の記載がある競争入札に対する件数の割合です。落札率は記載のある契約の単純平均です。</li>
    </ul>
  </HeaderHelp>;
}
