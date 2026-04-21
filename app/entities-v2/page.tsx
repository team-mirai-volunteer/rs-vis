'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { EntitiesV2Response, EntityListItemV2, CorporateNumberInfo } from '@/app/api/entities-v2/route';

// ========================================
// 定数
// ========================================

// L1 カテゴリ（表示順）
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
  'ラベルなし':             { badge: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',           chip: 'bg-gray-300 text-gray-700 border-gray-300',    fill: '#d1d5db' },
};

const DEFAULT_COLOR: L1ColorSet = { badge: 'bg-gray-100 text-gray-700', chip: 'bg-gray-400 text-white border-gray-400', fill: '#9ca3af' };

type SearchMode = 'contains' | 'exact' | 'regex';
type SortField = 'displayName' | 'totalSpendingAmount' | 'projectCount' | 'variantCount' | 'corporateNumberCount';
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

// ========================================
// L1 分布バーチャート
// ========================================

interface L1BarItem { l1: string; count: number; totalAmount: number }

function L1DistributionChart({ items, totalAmount, onClickL1 }: {
  items: L1BarItem[];
  totalAmount: number;
  onClickL1: (l1: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  // 金額降順に表示（ラベルなしは末尾）
  const sorted = [...items].sort((a, b) => {
    if (a.l1 === 'ラベルなし') return 1;
    if (b.l1 === 'ラベルなし') return -1;
    return b.totalAmount - a.totalAmount;
  });

  return (
    <div className="space-y-1.5">
      {sorted.map(item => {
        const pct = totalAmount > 0 ? (item.totalAmount / totalAmount) * 100 : 0;
        const colors = L1_COLORS[item.l1] ?? DEFAULT_COLOR;
        const isHovered = hovered === item.l1;
        return (
          <div
            key={item.l1}
            className="flex items-center gap-2 cursor-pointer group"
            onMouseEnter={() => setHovered(item.l1)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onClickL1(item.l1)}
          >
            <span className={`w-36 text-xs shrink-0 truncate transition-colors ${isHovered ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}`}>
              {item.l1}
            </span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
              <div
                className="h-2 rounded-full transition-opacity"
                style={{ width: `${Math.max(pct, 0.2)}%`, backgroundColor: colors.fill, opacity: hovered && !isHovered ? 0.35 : 1 }}
              />
            </div>
            <span className="w-20 text-xs text-right text-gray-500 dark:text-gray-400 shrink-0 font-mono">
              {formatAmount(item.totalAmount)}
            </span>
            <span className="w-14 text-xs text-right text-gray-400 dark:text-gray-500 shrink-0">
              {item.count.toLocaleString()}件
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ========================================
// L1 バッジ
// ========================================

function L1Badge({ l1 }: { l1: string | null }) {
  if (!l1) return <span className="text-xs text-gray-400">-</span>;
  const colors = L1_COLORS[l1] ?? DEFAULT_COLOR;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors.badge}`}>{l1}</span>
  );
}

function L2Text({ l2 }: { l2: string | null }) {
  if (!l2) return null;
  return <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 block">{l2}</span>;
}

// ========================================
// バリエーションダイアログ
// ========================================

interface UniqueVariant {
  spendingName: string;
  totalSpendingAmount: number;
  isSameAsDisplay: boolean;
  corporateNumbers: string[];
}

interface VariantDialogProps {
  displayName: string;
  variants: UniqueVariant[];
  onClose: () => void;
}

function VariantDialog({ displayName, variants, onClose }: VariantDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">正規化名</p>
            <p className="font-semibold text-gray-900 dark:text-gray-100">{displayName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none px-2">×</button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-700">
          {variants.map(v => (
            <div key={v.spendingName} className="px-5 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-200 break-words">{v.spendingName}</p>
                {v.isSameAsDisplay && <p className="text-xs text-gray-400 mt-0.5">（正規化名と同一）</p>}
                {v.corporateNumbers.length > 0 && (
                  <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mt-0.5">
                    法人番号: {v.corporateNumbers.join(', ')}
                    {v.corporateNumbers.length > 1 && (
                      <span className="ml-1 text-amber-500 font-sans">⚠ {v.corporateNumbers.length}件</span>
                    )}
                  </p>
                )}
              </div>
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0">{formatAmount(v.totalSpendingAmount)}</span>
              <Link href={`/sankey?recipient=${encodeURIComponent(v.spendingName)}`} className="text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap shrink-0" onClick={onClose}>
                Sankey →
              </Link>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400">
          {variants.length} バリエーション
        </div>
      </div>
    </div>
  );
}

// ========================================
// 法人番号ダイアログ
// ========================================

interface CorporateNumberDialogProps {
  spendingName: string;
  corporateNumbers: string[];
  corporateNumberInfo: Record<string, CorporateNumberInfo | null>;
  onClose: () => void;
}

function CorporateNumberDialog({ spendingName, corporateNumbers, corporateNumberInfo, onClose }: CorporateNumberDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">法人番号一覧（出典: 国税庁法人番号公表サイト）</p>
            <p className="font-semibold text-gray-900 dark:text-gray-100">{spendingName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none px-2">×</button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-700">
          {corporateNumbers.map((cn, i) => {
            const info = corporateNumberInfo[cn] ?? null;
            return (
              <div key={cn || `empty-${i}`} className="px-5 py-3 flex items-start gap-3">
                <span className="text-xs text-gray-400 dark:text-gray-500 w-5 shrink-0 mt-0.5">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-gray-800 dark:text-gray-200">{cn}</span>
                    {info?.isMatch && (
                      <span className="text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-1.5 py-0.5 rounded">✓ 一致</span>
                    )}
                    {info && !info.isMatch && (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">別法人</span>
                    )}
                    {!info && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">NTA未登録</span>
                    )}
                  </div>
                  {info && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {info.name}
                      {info.address && <span className="ml-1 text-gray-400">（{info.address}）</span>}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
          RSシステムの元CSVに {corporateNumbers.length} 件の法人番号で記録されています
        </div>
      </div>
    </div>
  );
}

// ========================================
// ページ本体
// ========================================

export default function EntitiesV2Page() {
  const [data, setData] = useState<EntitiesV2Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 検索
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('contains');

  // L1 フィルタ（複数選択。空 = すべて）
  const [selectedL1s, setSelectedL1s] = useState<Set<string>>(new Set());

  // ページ
  const [page, setPage] = useState(1);

  // ソート
  const [sortField, setSortField] = useState<SortField>('totalSpendingAmount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // ダイアログ
  const [variantDialog, setVariantDialog] = useState<{ displayName: string; variants: UniqueVariant[] } | null>(null);
  const [corporateNumberDialog, setCorporateNumberDialog] = useState<{
    spendingName: string;
    corporateNumbers: string[];
    corporateNumberInfo: Record<string, CorporateNumberInfo | null>;
  } | null>(null);

  useEffect(() => {
    fetch('/api/entities-v2')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<EntitiesV2Response>;
      })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // displayName → ユニーク variants
  const clusterMap = useMemo(() => {
    if (!data) return new Map<string, UniqueVariant[]>();
    const map = new Map<string, UniqueVariant[]>();
    for (const e of data.entities) {
      if (!map.has(e.displayName)) map.set(e.displayName, []);
      map.get(e.displayName)!.push({
        spendingName: e.spendingName,
        totalSpendingAmount: e.totalSpendingAmount,
        isSameAsDisplay: e.spendingName === e.displayName,
        corporateNumbers: e.corporateNumbers,
      });
    }
    for (const variants of map.values()) {
      variants.sort((a, b) => b.totalSpendingAmount - a.totalSpendingAmount);
    }
    return map;
  }, [data]);

  // フィルタリング
  const filtered = useMemo<EntityListItemV2[]>(() => {
    if (!data) return [];
    const q = searchQuery.trim();
    return data.entities.filter(e => {
      // L1 フィルタ
      if (selectedL1s.size > 0) {
        const l1Key = e.l1 ?? 'ラベルなし';
        if (!selectedL1s.has(l1Key)) return false;
      }
      // テキスト検索
      if (q) {
        const haystack = `${e.displayName} ${e.spendingName} ${e.parentName ?? ''}`;
        try {
          if (searchMode === 'contains') {
            if (!haystack.toLowerCase().includes(q.toLowerCase())) return false;
          } else if (searchMode === 'exact') {
            if (e.displayName !== q && e.spendingName !== q) return false;
          } else if (searchMode === 'regex') {
            const rx = new RegExp(q);
            if (!rx.test(haystack)) return false;
          }
        } catch { /* 不正な正規表現は全件ヒットとして扱う */ }
      }
      return true;
    });
  }, [data, searchQuery, searchMode, selectedL1s]);

  // ソート
  const sorted = useMemo<EntityListItemV2[]>(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortField) {
        case 'displayName':
          return dir * a.displayName.localeCompare(b.displayName, 'ja');
        case 'totalSpendingAmount':
          return dir * (a.totalSpendingAmount - b.totalSpendingAmount);
        case 'projectCount':
          return dir * (a.projectCount - b.projectCount);
        case 'variantCount': {
          const va = clusterMap.get(a.displayName)?.length ?? 1;
          const vb = clusterMap.get(b.displayName)?.length ?? 1;
          return dir * (va - vb);
        }
        case 'corporateNumberCount':
          return dir * (a.corporateNumbers.length - b.corporateNumbers.length);
      }
    });
    return arr;
  }, [filtered, sortField, sortDir, clusterMap]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearch = useCallback((q: string) => { setSearchQuery(q); setPage(1); }, []);
  const handleModeChange = useCallback((m: SearchMode) => { setSearchMode(m); setPage(1); }, []);
  const handleSort = useCallback((field: SortField) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(1);
  }, [sortField]);

  const toggleL1 = useCallback((l1: string) => {
    setSelectedL1s(prev => {
      const next = new Set(prev);
      if (next.has(l1)) next.delete(l1); else next.add(l1);
      return next;
    });
    setPage(1);
  }, []);

  // バーチャートクリック → フィルタ追加/除去
  const handleClickL1 = useCallback((l1: string) => {
    toggleL1(l1);
  }, [toggleL1]);

  // ========== ローディング ==========
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">支出先データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-red-600">
          <p className="text-lg font-semibold mb-2">データの読み込みに失敗しました</p>
          <p className="text-sm text-gray-500">{error}</p>
          <Link href="/" className="mt-4 inline-block text-blue-500 underline">トップへ戻る</Link>
        </div>
      </div>
    );
  }

  const { summary } = data;
  const labelCoveragePct = summary.total > 0 ? (summary.labeledCount / summary.total * 100).toFixed(1) : '0.0';
  const amountCoveragePct = summary.totalAmount > 0 ? (summary.labeledAmount / summary.totalAmount * 100).toFixed(1) : '0.0';

  // L1 分布リスト（データに存在するもののみ）
  const l1BarItems: L1BarItem[] = L1_CATEGORIES
    .filter(l1 => summary.byL1[l1]?.count > 0)
    .map(l1 => ({ l1, ...summary.byL1[l1] }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* ダイアログ */}
      {variantDialog && (
        <VariantDialog displayName={variantDialog.displayName} variants={variantDialog.variants} onClose={() => setVariantDialog(null)} />
      )}
      {corporateNumberDialog && (
        <CorporateNumberDialog
          spendingName={corporateNumberDialog.spendingName}
          corporateNumbers={corporateNumberDialog.corporateNumbers}
          corporateNumberInfo={corporateNumberDialog.corporateNumberInfo}
          onClose={() => setCorporateNumberDialog(null)}
        />
      )}

      {/* ヘッダー */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm">
            ← トップ
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            🏷️ 支出先ブラウザ v2
          </h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            行政事業レビュー（ラベリング改善版）
          </span>
          <span className="ml-auto">
            <Link href="/entities" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border border-gray-300 dark:border-gray-600 rounded px-2 py-1">
              旧ブラウザで比較 →
            </Link>
          </span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* サマリーカード（4枚） */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">支出先数</p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {summary.total.toLocaleString()} 件
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              正規化後 {summary.normalizedCount.toLocaleString()} 件
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">総支出額</p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {formatAmount(summary.totalAmount)}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">全支出先の合算</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-indigo-200 dark:border-indigo-800">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">件数カバレッジ</p>
            <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
              {labelCoveragePct}%
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {summary.labeledCount.toLocaleString()} / {summary.total.toLocaleString()} 件
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-indigo-200 dark:border-indigo-800">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">金額カバレッジ</p>
            <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
              {amountCoveragePct}%
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {formatAmount(summary.labeledAmount)}
            </p>
          </div>
        </div>

        {/* L1 分布チャート */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 mb-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            L1 分類別 × 支出総額
            <span className="ml-2 text-gray-400 dark:text-gray-500">（バーをクリックするとフィルタ）</span>
          </p>
          <L1DistributionChart items={l1BarItems} totalAmount={summary.totalAmount} onClickL1={handleClickL1} />
        </div>

        {/* 検索ボックス */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="支出先名を検索..."
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              className="w-full pl-3 pr-8 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            {searchQuery && (
              <button onClick={() => handleSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none" aria-label="クリア">×</button>
            )}
          </div>
          <select
            value={searchMode}
            onChange={e => handleModeChange(e.target.value as SearchMode)}
            className="px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="contains">含む</option>
            <option value="exact">完全一致</option>
            <option value="regex">正規表現</option>
          </select>
        </div>

        {/* L1 フィルタチップ */}
        <div className="flex flex-wrap gap-2 mb-4">
          {L1_CATEGORIES
            .filter(l1 => summary.byL1[l1]?.count > 0)
            .map(l1 => {
              const isSelected = selectedL1s.has(l1);
              const colors = L1_COLORS[l1] ?? DEFAULT_COLOR;
              const count = summary.byL1[l1]?.count ?? 0;
              return (
                <button
                  key={l1}
                  onClick={() => toggleL1(l1)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    isSelected
                      ? colors.chip
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {l1}
                  <span className="ml-1 opacity-80">({count.toLocaleString()})</span>
                </button>
              );
            })
          }
          {selectedL1s.size > 0 && (
            <button
              onClick={() => { setSelectedL1s(new Set()); setPage(1); }}
              className="px-3 py-1 rounded-full text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              クリア
            </button>
          )}
        </div>

        {/* 検索結果件数 */}
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          {sorted.length.toLocaleString()}件
          {sorted.length !== summary.total && ` / 全${summary.total.toLocaleString()}件`}
          {totalPages > 1 && `（${page}/${totalPages}ページ）`}
        </p>

        {/* テーブル */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th
                  className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                  onClick={() => handleSort('displayName')}
                >
                  支出先名{sortField === 'displayName' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell min-w-[160px]">
                  L1 / L2
                </th>
                <th
                  className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                  onClick={() => handleSort('totalSpendingAmount')}
                >
                  支出額{sortField === 'totalSpendingAmount' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th
                  className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 hidden sm:table-cell cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                  onClick={() => handleSort('projectCount')}
                >
                  事業数{sortField === 'projectCount' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th
                  className="text-center px-3 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 hidden sm:table-cell cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                  onClick={() => handleSort('variantCount')}
                >
                  表記数{sortField === 'variantCount' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th
                  className="text-center px-3 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                  onClick={() => handleSort('corporateNumberCount')}
                >
                  法人番号数{sortField === 'corporateNumberCount' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th className="px-4 py-3 hidden lg:table-cell" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {pageItems.map(entity => {
                const variants = clusterMap.get(entity.displayName) ?? [];
                const variantCount = variants.length;
                return (
                  <tr key={entity.spendingName} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">{entity.displayName}</span>
                        {entity.displayName !== entity.spendingName && (
                          <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">{entity.spendingName}</span>
                        )}
                        {entity.parentName && (
                          <span className="block text-xs text-blue-500 dark:text-blue-400 mt-0.5">↑ {entity.parentName}</span>
                        )}
                        {/* モバイル: L1 バッジをここに表示 */}
                        <span className="md:hidden mt-1 inline-block">
                          <L1Badge l1={entity.l1} />
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <L1Badge l1={entity.l1} />
                      <L2Text l2={entity.l2} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                      {formatAmount(entity.totalSpendingAmount)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                      {entity.projectCount}
                    </td>
                    <td className="px-3 py-3 text-center hidden sm:table-cell">
                      {variantCount > 1 ? (
                        <button
                          onClick={() => setVariantDialog({ displayName: entity.displayName, variants })}
                          className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200 hover:bg-orange-200 dark:hover:bg-orange-800 transition-colors"
                        >
                          {variantCount}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">1</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center hidden md:table-cell">
                      {entity.corporateNumbers.length > 1 ? (
                        <button
                          onClick={() => setCorporateNumberDialog({ spendingName: entity.spendingName, corporateNumbers: entity.corporateNumbers, corporateNumberInfo: entity.corporateNumberInfo })}
                          className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
                        >
                          {entity.corporateNumbers.length}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">
                          {entity.corporateNumbers.length === 1 ? '1' : '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <Link
                        href={`/sankey?recipient=${encodeURIComponent(entity.spendingName)}`}
                        className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline whitespace-nowrap"
                      >
                        Sankeyで見る →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {pageItems.length === 0 && (
            <div className="py-12 text-center text-gray-400 dark:text-gray-500">
              該当する支出先が見つかりません
            </div>
          )}
        </div>

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              ←
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
