'use client';

/**
 * /quality の「項」表示。予算書の項ごとに、配下 RS事業の政策評価を計上額で加重平均した一覧。
 * データは /api/quality-sections。行の項名から統合ビュー（その項を選択した状態）へ飛べる。
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import LoadingSpinner from '@/client/components/LoadingSpinner';
import { scoreColor, formatAmount } from '@/client/components/quality/score-format';
import { POLICY_AXES, type PolicyAxis } from '@/app/lib/unified-budget/policy-aggregate';
import type { QualitySectionItem, QualitySectionsResponse } from '@/types/quality-sections';

type SortKey = 'rsAmount' | 'programCount' | 'coverage' | 'ministry' | 'sectionName' | PolicyAxis;

const AXIS_DESC: Record<PolicyAxis, string> = {
  o: '配下 RS事業の総合点を、項→事業の計上額で加重平均した値',
  d: '成果設計の加重平均',
  e: '検証可能性の加重平均',
  t: '執行透明性の加重平均',
  x: '費用対内容の加重平均',
  n: '必要性の加重平均',
};

export function SectionScoreTable({ year }: { year: string }) {
  const [data, setData] = useState<QualitySectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [ministry, setMinistry] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('rsAmount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [onlyEvaluated, setOnlyEvaluated] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/quality-sections?year=${year}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: QualitySectionsResponse) => {
        if (!cancelled) setData(json);
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const ministries = useMemo(() => [...new Set((data?.items ?? []).map(i => i.ministry))].sort((a, b) => a.localeCompare(b, 'ja')), [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim();
    let items = data.items;
    if (onlyEvaluated) items = items.filter(i => i.evaluatedCount > 0);
    if (ministry) items = items.filter(i => i.ministry === ministry);
    if (q) items = items.filter(i => [i.sectionName, i.ministry, i.organization, i.subAccount, i.sectionCode].some(v => v.includes(q)));
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (i: QualitySectionItem): number | string | null => {
      if (sortKey === 'ministry' || sortKey === 'sectionName') return i[sortKey];
      if (sortKey === 'rsAmount' || sortKey === 'programCount' || sortKey === 'coverage') return i[sortKey];
      return i.scores[sortKey];
    };
    return [...items].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // 未評価は常に下
      if (vb === null) return -1;
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'ja') * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [data, query, ministry, sortKey, sortDir, onlyEvaluated]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'ministry' || key === 'sectionName' ? 'asc' : 'desc');
    }
  };
  const SortIcon = ({ field }: { field: SortKey }) =>
    sortKey === field ? (
      sortDir === 'asc' ? <ArrowUp className="ml-0.5 inline size-3" aria-hidden="true" /> : <ArrowDown className="ml-0.5 inline size-3" aria-hidden="true" />
    ) : (
      <ArrowUpDown className="ml-0.5 inline size-3 text-mirai-text-placeholder" aria-hidden="true" />
    );
  const th = (key: SortKey, label: string, opts: { right?: boolean; title?: string; teal?: boolean } = {}) => (
    <th
      key={key}
      className={cn('cursor-pointer whitespace-nowrap px-2 py-2', opts.right ? 'text-right' : 'text-left', opts.teal && 'bg-mirai-surface-teal')}
      title={opts.title}
      onClick={() => handleSort(key)}
    >
      {label}
      <SortIcon field={key} />
    </th>
  );

  if (error) return <div className="p-6 text-sm text-destructive">項の集計を取得できませんでした（{error}）。再読み込みしてください。</div>;
  if (!data) return <LoadingSpinner />;
  if (data.unavailable) {
    return (
      <div className="p-6 text-sm leading-relaxed text-mirai-text-subtle">
        {year}年度は予算書の項と RS事業の紐づけ表がこの採点結果と対応していないため、項ごとの集計を出せません。2025 年度または 2026 年度（要求）を選んでください。
      </div>
    );
  }

  const amountLabel = data.rsAmountKind === 'request' ? '要求額' : '計上額';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-mirai-border bg-card px-3 py-2 text-xs">
        <div className="relative min-w-[220px]">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mirai-text-muted" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="項名・所管・組織で検索"
            aria-label="項を検索"
            className="h-8 w-full rounded-full border border-mirai-border bg-card pl-8 pr-7 text-xs text-mirai-text placeholder:text-mirai-text-placeholder focus-visible:border-primary"
          />
          {query && (
            <Button variant="ghost" size="icon-sm" onClick={() => setQuery('')} aria-label="検索クリア" className="absolute right-0.5 top-1/2 size-6 -translate-y-1/2 text-mirai-text-muted hover:bg-transparent hover:text-mirai-text">
              <X className="size-3" />
            </Button>
          )}
        </div>
        <select
          value={ministry}
          onChange={e => setMinistry(e.target.value)}
          aria-label="所管で絞り込み"
          className="h-8 shrink-0 cursor-pointer truncate rounded-md border border-mirai-border bg-card px-2 text-xs text-mirai-text-secondary"
        >
          <option value="">全所管</option>
          {ministries.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-mirai-text-subtle">
          <input type="checkbox" checked={onlyEvaluated} onChange={e => setOnlyEvaluated(e.target.checked)} className="size-3.5 accent-primary" />
          評価のある項だけ
        </label>
        <span className="ml-auto text-mirai-text-muted">
          {rows.length.toLocaleString()} / {data.summary.sectionCount.toLocaleString()} 項 ・ 紐づく RS事業 {data.summary.programCount.toLocaleString()} 件 ・ 重みは RS 2-2 の{amountLabel}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-xs" style={{ minWidth: 1180 }}>
          {/* 列幅を固定し、項名・組織は truncate で収める（可変幅だと所管列だけが伸びて軸の列が画面外へ出る） */}
          <colgroup>
            <col style={{ width: 130 }} />
            <col style={{ width: 170 }} />
            <col />
            <col style={{ width: 72 }} />
            <col style={{ width: 84 }} />
            {POLICY_AXES.map(a => <col key={a.key} style={{ width: 66 }} />)}
            <col style={{ width: 210 }} />
            <col style={{ width: 84 }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-mirai-surface text-mirai-text-subtle">
            <tr>
              {th('ministry', '所管')}
              <th className="whitespace-nowrap px-2 py-2 text-left">組織 / 特会</th>
              {th('sectionName', '項')}
              {th('programCount', '事業数', { right: true, title: '項に紐づく RS事業の数（評価あり / 全体）' })}
              {th('rsAmount', amountLabel, { right: true, title: `項に紐づく RS事業の${amountLabel}合計（重みの合計）` })}
              {POLICY_AXES.map(a => th(a.key, a.label, { right: true, title: AXIS_DESC[a.key], teal: true }))}
              <th className="whitespace-nowrap px-2 py-2 text-left bg-mirai-surface-teal" title="推奨判断の分布（金額加重・上位 2 つ）">推奨の分布</th>
              {th('coverage', '評価カバー率', { right: true, title: '評価のある事業に流れた額の比率' })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id} className={cn('border-b border-border hover:bg-mirai-surface-teal/60', idx % 2 === 1 && 'bg-mirai-surface-gray')}>
                <td className="truncate px-2 py-1.5 text-mirai-text-secondary" title={r.ministry}>{r.ministry}</td>
                <td className="truncate px-2 py-1.5 text-mirai-text-subtle" title={r.subAccount ? `${r.organization}／${r.subAccount}` : r.organization}>
                  {r.subAccount ? `${r.organization}／${r.subAccount}` : r.organization}
                </td>
                <td className="px-2 py-1.5">
                  <Link
                    href={`/budget-sankey?year=${data.budgetYear}&sel=${encodeURIComponent(r.id)}`}
                    className="inline-flex max-w-full items-center gap-1 font-medium text-primary-accent hover:underline"
                    title="統合ビューでこの項を開く"
                  >
                    <span className="truncate">{r.sectionName}</span>
                    <span className="shrink-0 text-[10px] text-mirai-text-muted">{r.sectionCode}</span>
                    <ExternalLink className="size-3 shrink-0 text-mirai-text-muted" aria-hidden="true" />
                  </Link>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-mirai-text-secondary">
                  {r.evaluatedCount.toLocaleString()}<span className="text-mirai-text-muted"> / {r.programCount.toLocaleString()}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatAmount(r.rsAmount)}</td>
                {POLICY_AXES.map(a => {
                  const v = r.scores[a.key];
                  return (
                    <td key={a.key} className={cn('px-2 py-1.5 text-right font-mono font-bold tabular-nums', scoreColor(v === null ? null : Math.round(v)))} title={v === null ? undefined : `${v}`}>
                      {v === null ? '—' : Math.round(v)}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5">
                  {/* 上位 2 つを 1 行に。全部出すと行の高さが揃わない */}
                  <div className="flex gap-1 overflow-hidden" title={r.recommendationShare.map(s => `${s.label} ${Math.round(s.share * 100)}%`).join(' / ')}>
                    {r.recommendationShare.slice(0, 2).map(s => (
                      <span key={s.label} className="whitespace-nowrap rounded-full bg-mirai-surface-light px-1.5 py-px text-[10px] font-bold text-mirai-text-subtle">
                        {s.label} {Math.round(s.share * 100)}%
                      </span>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">{Math.round(r.coverage * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-6 text-center text-sm text-mirai-text-muted">条件に合う項がありません</div>}
      </div>
    </div>
  );
}
