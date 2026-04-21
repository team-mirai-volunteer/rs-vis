'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { EntitiesResponse, EntityListItem, CorporateNumberInfo } from '@/app/api/entities/route';
import type { EntityType } from '@/types/structured';

// ========================================
// 定数
// ========================================

const ENTITY_TYPES: EntityType[] = [
  '民間企業',
  '地方公共団体',
  '国の機関',
  '独立行政法人',
  '公益法人・NPO',
  '外国法人',
  'その他',
];

// バッジ用（テキスト色）
const ENTITY_TYPE_COLORS: Record<string, string> = {
  '民間企業':     'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  '地方公共団体': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  '国の機関':     'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  '独立行政法人': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  '公益法人・NPO':'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  '外国法人':     'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  'その他':       'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

// フィルタチップ選択時の背景色
const ENTITY_TYPE_SELECTED_BG: Record<string, string> = {
  '民間企業':     'bg-blue-500 text-white border-blue-500',
  '地方公共団体': 'bg-green-500 text-white border-green-500',
  '国の機関':     'bg-red-500 text-white border-red-500',
  '独立行政法人': 'bg-purple-500 text-white border-purple-500',
  '公益法人・NPO':'bg-yellow-500 text-white border-yellow-500',
  '外国法人':     'bg-pink-500 text-white border-pink-500',
  'その他':       'bg-gray-500 text-white border-gray-500',
};

// 円グラフ用
const ENTITY_TYPE_FILL: Record<string, string> = {
  '民間企業':     '#3b82f6',
  '地方公共団体': '#22c55e',
  '国の機関':     '#ef4444',
  '独立行政法人': '#a855f7',
  '公益法人・NPO':'#eab308',
  '外国法人':     '#ec4899',
  'その他':       '#9ca3af',
};

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
// ドーナツチャート
// ========================================

interface DonutSlice { label: string; value: number; fill: string }

function DonutChart({ slices, total }: { slices: DonutSlice[]; total: number }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const cx = 80, cy = 80, r = 64, innerR = 40;
  const nonZero = slices.filter(s => s.value > 0);
  let cumAngle = -Math.PI / 2;
  const paths = nonZero.map(slice => {
    const angle = (slice.value / total) * 2 * Math.PI;
    const s = cumAngle; cumAngle += angle; const e = cumAngle;
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    const ix1 = cx + innerR * Math.cos(e), iy1 = cy + innerR * Math.sin(e);
    const ix2 = cx + innerR * Math.cos(s), iy2 = cy + innerR * Math.sin(s);
    const large = angle > Math.PI ? 1 : 0;
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2} Z`;
    return { ...slice, d };
  });
  const active = hovered ? nonZero.find(s => s.label === hovered) : null;
  const pct = active ? ((active.value / total) * 100).toFixed(1) : null;

  return (
    <div className="flex items-center gap-4">
      <svg width={160} height={160} className="shrink-0">
        {paths.map(p => (
          <path key={p.label} d={p.d} fill={p.fill}
            opacity={hovered && hovered !== p.label ? 0.35 : 1}
            stroke="white" strokeWidth={1.5}
            onMouseEnter={() => setHovered(p.label)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={9} fill="#6b7280">
          {active ? active.label : '支出総額'}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize={11} fontWeight="600" fill="#111827">
          {active ? formatAmount(active.value) : formatAmount(total)}
        </text>
        {pct && <text x={cx} y={cy + 20} textAnchor="middle" fontSize={9} fill="#6b7280">{pct}%</text>}
      </svg>
      <div className="flex flex-col gap-1 min-w-0">
        {slices.map(s => (
          <div key={s.label} className="flex items-center gap-1.5 cursor-pointer"
            onMouseEnter={() => setHovered(s.label)} onMouseLeave={() => setHovered(null)}>
            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: s.fill, opacity: hovered && hovered !== s.label ? 0.35 : 1 }} />
            <span className={`text-xs truncate ${hovered === s.label ? 'font-semibold' : 'text-gray-600 dark:text-gray-300'}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ========================================
// バッジ
// ========================================

function EntityTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs text-gray-400">-</span>;
  const colors = ENTITY_TYPE_COLORS[type] ?? ENTITY_TYPE_COLORS['その他'];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors}`}>{type}</span>
  );
}

// ========================================
// バリエーションダイアログ
// ========================================

// VariantDialog に渡すアイテム（spendingName でデデュープ済み）
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">正規化名</p>
            <p className="font-semibold text-gray-900 dark:text-gray-100">{displayName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none px-2"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-700">
          {variants.map(v => (
            <div key={v.spendingName} className="px-5 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-200 break-words">{v.spendingName}</p>
                {v.isSameAsDisplay && (
                  <p className="text-xs text-gray-400 mt-0.5">（正規化名と同一）</p>
                )}
                {v.corporateNumbers.length > 0 && (
                  <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mt-0.5">
                    法人番号: {v.corporateNumbers.join(', ')}
                    {v.corporateNumbers.length > 1 && (
                      <span className="ml-1 text-amber-500 font-sans">⚠ {v.corporateNumbers.length}件</span>
                    )}
                  </p>
                )}
              </div>
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0">
                {formatAmount(v.totalSpendingAmount)}
              </span>
              <Link
                href={`/sankey?recipient=${encodeURIComponent(v.spendingName)}`}
                className="text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap shrink-0"
                onClick={onClose}
              >
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">法人番号一覧（出典: 国税庁法人番号公表サイト）</p>
            <p className="font-semibold text-gray-900 dark:text-gray-100">{spendingName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none px-2"
          >
            ×
          </button>
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
                      <span className="text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-1.5 py-0.5 rounded">
                        ✓ 一致
                      </span>
                    )}
                    {info && !info.isMatch && (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                        別法人
                      </span>
                    )}
                    {!info && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                        NTA未登録
                      </span>
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

export default function EntitiesPage() {
  const [data, setData] = useState<EntitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 検索
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('contains');

  // 種別フィルタ（複数選択。空 = すべて）
  const [selectedTypes, setSelectedTypes] = useState<Set<EntityType>>(new Set());

  // ページ
  const [page, setPage] = useState(1);

  // ソート
  const [sortField, setSortField] = useState<SortField>('totalSpendingAmount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // バリエーションダイアログ
  const [variantDialog, setVariantDialog] = useState<{ displayName: string; variants: UniqueVariant[] } | null>(null);

  // 法人番号ダイアログ
  const [corporateNumberDialog, setCorporateNumberDialog] = useState<{
    spendingName: string;
    corporateNumbers: string[];
    corporateNumberInfo: Record<string, CorporateNumberInfo | null>;
  } | null>(null);

  useEffect(() => {
    fetch('/api/entities')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<EntitiesResponse>;
      })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // displayName → ユニークな spendingName ごとのサマリ
  // API側で既に spendingName 単位に集約済みのため、ここでは displayName でグループ化するのみ
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
    // 金額降順に並べ替え
    for (const variants of map.values()) {
      variants.sort((a, b) => b.totalSpendingAmount - a.totalSpendingAmount);
    }
    return map;
  }, [data]);

  // フィルタリング
  const filtered = useMemo<EntityListItem[]>(() => {
    if (!data) return [];
    const q = searchQuery.trim();
    return data.entities.filter(e => {
      // 種別フィルタ
      if (selectedTypes.size > 0) {
        const t = (e.entityType ?? 'その他') as EntityType;
        if (!selectedTypes.has(t)) return false;
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
        } catch {
          // 不正な正規表現は全件ヒットとして扱う
        }
      }
      return true;
    });
  }, [data, searchQuery, searchMode, selectedTypes]);

  // ソート済み一覧
  const sorted = useMemo<EntityListItem[]>(() => {
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
  const toggleType = useCallback((type: EntityType) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
    setPage(1);
  }, []);

  // ========== ローディング ==========
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4" />
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* バリエーションダイアログ */}
      {variantDialog && (
        <VariantDialog
          displayName={variantDialog.displayName}
          variants={variantDialog.variants}
          onClose={() => setVariantDialog(null)}
        />
      )}

      {/* 法人番号ダイアログ */}
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
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm">
            ← トップ
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            🏢 支出先ブラウザ
          </h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            行政事業レビュー
          </span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* サマリーカード（2枚） */}
        <div className="grid grid-cols-2 gap-3 mb-6">
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
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              全支出先の合算
            </p>
          </div>
        </div>

        {/* エンティティ種別 × 支出総額（バー + ドーナツ） */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 mb-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">エンティティ種別 × 支出総額</p>
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1 space-y-2">
              {ENTITY_TYPES.map(type => {
                const info = summary.byEntityType[type] ?? { count: 0, totalAmount: 0 };
                const pct = summary.totalAmount > 0 ? (info.totalAmount / summary.totalAmount) * 100 : 0;
                const fill = ENTITY_TYPE_FILL[type];
                return (
                  <div key={type} className="flex items-center gap-2">
                    <span className="w-28 text-xs text-gray-600 dark:text-gray-300 shrink-0">{type}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                      <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: fill }} />
                    </div>
                    <span className="w-20 text-xs text-right text-gray-500 dark:text-gray-400 shrink-0">
                      {formatAmount(info.totalAmount)}
                    </span>
                    <span className="w-16 text-xs text-right text-gray-400 dark:text-gray-500 shrink-0">
                      {info.count.toLocaleString()}件
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="shrink-0">
              <DonutChart
                total={summary.totalAmount}
                slices={ENTITY_TYPES.map(type => ({
                  label: type,
                  value: summary.byEntityType[type]?.totalAmount ?? 0,
                  fill: ENTITY_TYPE_FILL[type],
                }))}
              />
            </div>
          </div>
        </div>

        {/* 検索ボックス */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="支出先名を検索..."
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              className="w-full pl-3 pr-8 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            {searchQuery && (
              <button
                onClick={() => handleSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
                aria-label="クリア"
              >
                ×
              </button>
            )}
          </div>
          <select
            value={searchMode}
            onChange={e => handleModeChange(e.target.value as SearchMode)}
            className="px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          >
            <option value="contains">含む</option>
            <option value="exact">完全一致</option>
            <option value="regex">正規表現</option>
          </select>
        </div>

        {/* 種別フィルタチップ（複数選択・色付き） */}
        <div className="flex flex-wrap gap-2 mb-4">
          {ENTITY_TYPES.map(type => {
            const isSelected = selectedTypes.has(type);
            const selectedCls = ENTITY_TYPE_SELECTED_BG[type];
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  isSelected
                    ? selectedCls
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {type}
                <span className="ml-1 opacity-80">
                  ({(summary.byEntityType[type]?.count ?? 0).toLocaleString()})
                </span>
              </button>
            );
          })}
          {selectedTypes.size > 0 && (
            <button
              onClick={() => { setSelectedTypes(new Set()); setPage(1); }}
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
                {/* ソート可能な列ヘッダー */}
                {(
                  [
                    { field: 'displayName' as SortField, label: '支出先名', cls: 'text-left px-4 py-3' },
                  ] as const
                ).map(({ field, label, cls }) => (
                  <th key={field} className={`${cls} text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200`}
                    onClick={() => handleSort(field)}>
                    {label}{sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">種別</th>
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
                  <tr
                    key={entity.spendingName}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {entity.displayName}
                        </span>
                        {entity.displayName !== entity.spendingName && (
                          <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {entity.spendingName}
                          </span>
                        )}
                        {entity.parentName && (
                          <span className="block text-xs text-blue-500 dark:text-blue-400 mt-0.5">
                            ↑ {entity.parentName}
                          </span>
                        )}
                        <span className="md:hidden mt-1 inline-block">
                          <EntityTypeBadge type={entity.entityType} />
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <EntityTypeBadge type={entity.entityType} />
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
