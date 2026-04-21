'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import type { EntityLabelsCsvResponse, EntityLabelItem } from '@/app/api/entity-labels-csv/route';

// ========================================
// 定数
// ========================================

const L1_CATEGORIES = [
  '民間企業',
  '公益法人・NPO',
  '協同組合等',
  '独立行政法人等',
  '大学法人',
  '学校法人',
  '医療・福祉法人',
  'その他法人',
  '専門職法人',
  '地方公共法人',
  '地方公共団体',
  '国の機関',
  '外国法人・国際機関',
  'コンソーシアム・共同体',
  '協議会',
  '実行委員会等',
  'その他',
  '特殊法人・特別の法人',
  '事業者',
  '個人',
  '人件費',
  '経費',
  '事業',
  'ラベルなし',
] as const;

interface L1ColorSet { badge: string; chip: string; fill: string }

const L1_COLORS: Record<string, L1ColorSet> = {
  '民間企業':               { badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',           chip: 'bg-blue-500 text-white border-blue-500',       fill: '#3b82f6' },
  '公益法人・NPO':          { badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',   chip: 'bg-yellow-500 text-white border-yellow-500',   fill: '#eab308' },
  '協同組合等':             { badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',   chip: 'bg-orange-500 text-white border-orange-500',   fill: '#f97316' },
  '独立行政法人等':         { badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',   chip: 'bg-purple-500 text-white border-purple-500',   fill: '#a855f7' },
  '大学法人':               { badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',   chip: 'bg-indigo-500 text-white border-indigo-500',   fill: '#6366f1' },
  '学校法人':               { badge: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',   chip: 'bg-violet-500 text-white border-violet-500',   fill: '#7c3aed' },
  '医療・福祉法人':         { badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',           chip: 'bg-rose-500 text-white border-rose-500',       fill: '#f43f5e' },
  'その他法人':             { badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',           chip: 'bg-gray-500 text-white border-gray-500',       fill: '#6b7280' },
  '専門職法人':             { badge: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',           chip: 'bg-teal-500 text-white border-teal-500',       fill: '#14b8a6' },
  '地方公共法人':           { badge: 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200',           chip: 'bg-lime-600 text-white border-lime-600',       fill: '#84cc16' },
  '地方公共団体':           { badge: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',       chip: 'bg-green-500 text-white border-green-500',     fill: '#22c55e' },
  '国の機関':               { badge: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',               chip: 'bg-red-500 text-white border-red-500',         fill: '#ef4444' },
  '外国法人・国際機関':     { badge: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',           chip: 'bg-cyan-500 text-white border-cyan-500',       fill: '#06b6d4' },
  'コンソーシアム・共同体': { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',       chip: 'bg-amber-500 text-white border-amber-500',     fill: '#f59e0b' },
  '協議会':                 { badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200', chip: 'bg-emerald-500 text-white border-emerald-500', fill: '#10b981' },
  '実行委員会等':           { badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',               chip: 'bg-sky-500 text-white border-sky-500',         fill: '#0ea5e9' },
  'その他':               { badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',       chip: 'bg-slate-500 text-white border-slate-500',     fill: '#64748b' },
  '特殊法人・特別の法人':   { badge: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',           chip: 'bg-pink-500 text-white border-pink-500',       fill: '#ec4899' },
  '事業者':                 { badge: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-200',         chip: 'bg-stone-600 text-white border-stone-600',     fill: '#78716c' },
  '個人':                   { badge: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200', chip: 'bg-fuchsia-500 text-white border-fuchsia-500', fill: '#d946ef' },
  '人件費':                 { badge: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',             chip: 'bg-zinc-600 text-white border-zinc-600',       fill: '#52525b' },
  '経費':                   { badge: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300', chip: 'bg-neutral-500 text-white border-neutral-500', fill: '#737373' },
  '事業':                   { badge: 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200',         chip: 'bg-amber-700 text-white border-amber-700',     fill: '#b45309' },
  'ラベルなし':             { badge: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',           chip: 'bg-gray-300 text-gray-700 border-gray-300',    fill: '#d1d5db' },
};

const DEFAULT_COLOR: L1ColorSet = { badge: 'bg-gray-100 text-gray-700', chip: 'bg-gray-400 text-white border-gray-400', fill: '#9ca3af' };

const SOURCE_LABELS: Record<string, string> = {
  dict:      '辞書',
  kaku:      '格パターン',
  both:      '両方',
  cn_lookup: '法人番号照合',
  none:      '未ラベル',
};

const SOURCE_BADGE: Record<string, string> = {
  dict:      'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  kaku:      'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  both:      'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  cn_lookup: 'bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  none:      'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

type SourceFilter = 'all' | 'dict' | 'kaku' | 'both' | 'cn_lookup' | 'none';
type SortField = 'amount' | 'count' | 'name';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;

// ========================================
// ユーティリティ
// ========================================

function formatAmount(yen: number): string {
  if (yen >= 1e12) return `${(yen / 1e12).toFixed(2)}兆円`;
  if (yen >= 1e8)  return `${(yen / 1e8).toFixed(1)}億円`;
  if (yen >= 1e4)  return `${(yen / 1e4).toFixed(0)}万円`;
  return `${yen.toLocaleString()}円`;
}

function pct(num: number, denom: number): string {
  if (!denom) return '0.0%';
  return `${(num / denom * 100).toFixed(1)}%`;
}

// ========================================
// L1 バッジ
// ========================================
function L1Badge({ l1 }: { l1: string | null }) {
  const label = l1 ?? 'ラベルなし';
  const color = L1_COLORS[label] ?? DEFAULT_COLOR;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${color.badge}`}>
      {label}
    </span>
  );
}

// ========================================
// L1 分布バーチャート
// ========================================
function L1DistributionBar({ byL1, total }: {
  byL1: Record<string, { count: number; amount: number }>;
  total: number;
}) {
  const segments = L1_CATEGORIES
    .map(l1 => ({ l1, ...((byL1[l1] ?? { count: 0, amount: 0 })) }))
    .filter(s => s.count > 0);

  return (
    <div className="space-y-1">
      {/* 横帯グラフ */}
      <div className="flex h-6 w-full rounded overflow-hidden">
        {segments.map(s => {
          const widthPct = (s.count / total) * 100;
          if (widthPct < 0.1) return null;
          const color = L1_COLORS[s.l1] ?? DEFAULT_COLOR;
          return (
            <div
              key={s.l1}
              style={{ width: `${widthPct}%`, backgroundColor: color.fill }}
              title={`${s.l1}: ${s.count.toLocaleString()}件 (${pct(s.count, total)})`}
              className="flex-shrink-0"
            />
          );
        })}
      </div>
      {/* 凡例（件数上位のみ） */}
      <div className="flex flex-wrap gap-1.5 mt-1">
        {segments.slice(0, 12).map(s => {
          const color = L1_COLORS[s.l1] ?? DEFAULT_COLOR;
          return (
            <span key={s.l1} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
              <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color.fill }} />
              {s.l1} ({s.count.toLocaleString()})
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ========================================
// ページ本体
// ========================================
export default function EntityLabelsCsvPage() {
  const [data, setData] = useState<EntityLabelsCsvResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedL1, setSelectedL1] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<SourceFilter>('all');
  const [sortField, setSortField] = useState<SortField>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch('/api/entity-labels-csv')
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then((json: EntityLabelsCsvResponse) => setData(json))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // ─── フィルタ・ソート（メモ化）────────────────────────────
  const filtered = useMemo<EntityLabelItem[]>(() => {
    if (!data) return [];
    let items = data.items;

    if (selectedL1) {
      if (selectedL1 === 'ラベルなし') {
        items = items.filter(item => item.l1 === null);
      } else {
        items = items.filter(item => item.l1 === selectedL1);
      }
    }

    if (selectedSource !== 'all') {
      items = items.filter(item => item.source === selectedSource);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(item => item.name.toLowerCase().includes(q));
    }

    items = [...items].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'amount') cmp = a.amount - b.amount;
      else if (sortField === 'count') cmp = a.count - b.count;
      else cmp = a.name.localeCompare(b.name, 'ja');
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return items;
  }, [data, selectedL1, selectedSource, searchQuery, sortField, sortDir]);

  // ページリセット（フィルタ変更時）
  const prevFilterKey = useMemo(
    () => `${selectedL1}|${selectedSource}|${searchQuery}|${sortField}|${sortDir}`,
    [selectedL1, selectedSource, searchQuery, sortField, sortDir]
  );
  const [lastFilterKey, setLastFilterKey] = useState(prevFilterKey);
  if (prevFilterKey !== lastFilterKey) {
    setLastFilterKey(prevFilterKey);
    setPage(1);
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ─── ソート操作 ───────────────────────────────────────────
  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  // ─── ローディング・エラー ──────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
    </div>
  );

  if (error || !data) return (
    <div className="p-8 text-red-600 dark:text-red-400">
      <p className="font-semibold">データを読み込めません</p>
      <p className="text-sm mt-1">{error}</p>
      <p className="text-sm mt-2 text-gray-600 dark:text-gray-400">
        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
          python3 scripts/generate-entity-labels-csv.py
        </code> を実行してください
      </p>
    </div>
  );

  const { summary } = data;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

      {/* ─── ヘッダー ──────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
              ← トップ
            </Link>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            支出先ラベリング確認
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            元CSV直接読込 &middot; 金額あり・合計支出額なし対象 &middot; Read-only
          </p>

          {/* サマリー */}
          <div className="flex flex-wrap gap-4 mt-3 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">ユニーク支出先名</span>
              <span className="ml-2 font-semibold text-gray-900 dark:text-gray-100">
                {summary.total.toLocaleString()}件
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">ラベル付与</span>
              <span className="ml-2 font-semibold text-green-700 dark:text-green-400">
                {summary.labeled.toLocaleString()}件 ({pct(summary.labeled, summary.total)})
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">総金額</span>
              <span className="ml-2 font-semibold text-gray-900 dark:text-gray-100">
                {formatAmount(summary.totalAmount)}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">金額カバレッジ</span>
              <span className="ml-2 font-semibold text-blue-700 dark:text-blue-400">
                {pct(summary.labeledAmount, summary.totalAmount)}
              </span>
            </div>
          </div>

          {/* ソース内訳 */}
          <div className="flex flex-wrap gap-2 mt-2 text-xs">
            {(['dict', 'kaku', 'both', 'cn_lookup', 'none'] as const).map(src => (
              <span key={src} className={`px-2 py-0.5 rounded-full ${SOURCE_BADGE[src]}`}>
                {SOURCE_LABELS[src]}: {summary.bySource[src].count.toLocaleString()}件
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">

        {/* ─── L1 分布バーチャート ──────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">L1 カテゴリ分布</h2>
          <L1DistributionBar byL1={summary.byL1} total={summary.total} />
        </div>

        {/* ─── フィルタパネル ───────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">

          {/* 検索バー */}
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="支出先名で検索..."
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {filtered.length.toLocaleString()}件
            </span>
          </div>

          {/* L1 フィルタチップ */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedL1(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedL1 === null
                  ? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200'
                  : 'bg-white text-gray-600 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              すべて
            </button>
            {L1_CATEGORIES.map(l1 => {
              const count = (summary.byL1[l1] ?? { count: 0 }).count;
              if (!count) return null;
              const color = L1_COLORS[l1] ?? DEFAULT_COLOR;
              const isActive = selectedL1 === l1;
              return (
                <button
                  key={l1}
                  onClick={() => setSelectedL1(isActive ? null : l1)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    isActive ? color.chip : 'bg-white text-gray-600 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                  }`}
                >
                  {l1} ({count.toLocaleString()})
                </button>
              );
            })}
          </div>

          {/* ソースフィルタ */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-500 dark:text-gray-400">ラベルソース:</span>
            {(['all', 'dict', 'kaku', 'both', 'cn_lookup', 'none'] as const).map(src => (
              <button
                key={src}
                onClick={() => setSelectedSource(src)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  selectedSource === src
                    ? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200'
                    : 'bg-white text-gray-600 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                {src === 'all' ? 'すべて' : SOURCE_LABELS[src]}
              </button>
            ))}
          </div>
        </div>

        {/* ─── テーブル ─────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
                  <th
                    className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort('name')}
                  >
                    支出先名<SortIcon field="name" />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">L1</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">L2</th>
                  <th
                    className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort('amount')}
                  >
                    金額<SortIcon field="amount" />
                  </th>
                  <th
                    className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort('count')}
                  >
                    件数<SortIcon field="count" />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">ソース</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {pageItems.map(item => (
                  <tr key={item.name} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="px-4 py-2 text-gray-900 dark:text-gray-100 font-medium max-w-xs">
                      <span className="block truncate" title={item.name}>{item.name}</span>
                      {item.cn && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{item.cn}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <L1Badge l1={item.l1} />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                      {item.l2 ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900 dark:text-gray-100 tabular-nums whitespace-nowrap">
                      {formatAmount(item.amount)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                      {item.count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${SOURCE_BADGE[item.source]}`}>
                        {SOURCE_LABELS[item.source]}
                      </span>
                    </td>
                  </tr>
                ))}
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                      該当する支出先が見つかりません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ページネーション */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–
                {Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} / {filtered.length.toLocaleString()}件
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  ← 前
                </button>
                <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  次 →
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
