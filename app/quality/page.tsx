'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import type { QualityScoreItem, QualityScoresResponse } from '@/app/api/quality-scores/route';
import type { RecipientRow } from '@/app/lib/api/quality-recipients-loader';
import type { ExecutionHistoryResponse } from '@/app/api/execution-history/route';
import type { ProjectDetail } from '@/types/project-details';
import { ScoreDetailDialog } from '@/client/components/quality/ScoreDetailDialog';
import { scoreColor, formatAmount, pct } from '@/client/components/quality/score-format';
import {
  AXIS_META, COL_DESC, UNUSED_TREND_META, TONE_CLS, ACTION_CLS, COL_WIDTHS,
  RECOMMENDATION_LABELS, IMPROVEMENT_ACTION_LABELS,
  RecommendationBadge, ActionBadge, PersistentUnusedMark, fmtRaw,
  type PolicyMetric, type SortField, type SortDir,
} from '@/client/components/quality/score-meta';
import {
  buildPolicyEvaluations,
  POLICY_CATEGORY_GROUPS,
  IMPROVEMENT_ACTION_ORDER,
  RECOMMENDATION_ORDER,
  type PolicyEvaluation,
  type PolicyQualityInput,
  type PolicyRecommendationTone,
} from '@/app/lib/policy-evaluation';

const PAGE_SIZE = 50;





function parseAmountInput(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/,/g, '');
  const match = trimmed.match(/^([\d.]+)\s*(兆|億|万|千)?円?$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;
  switch (match[2]) {
    case '兆': return value * 1e12;
    case '億': return value * 1e8;
    case '万': return value * 1e4;
    case '千': return value * 1e3;
    default: return value;
  }
}

/**
 * 金額フィルタの増減ラダー（1-2-5 系列）。
 * 金額は桁で効くので +1 ずつでは実用にならない。「1億 → 2億 → 5億 → 10億 …」で刻む。
 */
const AMOUNT_STEPS: number[] = (() => {
  const out: number[] = [];
  for (let e = 8; e <= 14; e += 1) for (const m of [1, 2, 5]) out.push(m * 10 ** e);
  return out;   // 1億 ~ 500兆
})();

/**
 * 表示用に整形。1000億以上は「兆」、それ未満は「億」。
 * 入力欄はスコア側と同じ50px幅に揃えているため「5000億」（6文字）は収まらない。
 * 1000億から兆表記に切り替えると「0.5兆」（4文字）で済み、parseAmountInput でも読み戻せる。
 */
function formatAmountInput(yen: number): string {
  if (yen >= 1e11) {
    const v = yen / 1e12;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}兆`;
  }
  const v = yen / 1e8;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}億`;
}

/** 金額を1段上げ下げする。空欄からは最小値へ、最小値を下回ると空欄へ戻る */
function stepAmount(current: string, dir: 1 | -1): string {
  const now = parseAmountInput(current);
  if (now === null) return dir > 0 ? formatAmountInput(AMOUNT_STEPS[0]) : '';
  const next = dir > 0
    ? AMOUNT_STEPS.find((s) => s > now)
    : [...AMOUNT_STEPS].reverse().find((s) => s < now);
  if (next === undefined) return dir > 0 ? formatAmountInput(AMOUNT_STEPS[AMOUNT_STEPS.length - 1]) : '';
  return formatAmountInput(next);
}

/** 0-100 のスコアを step 刻みで上げ下げする。0 未満に下げると空欄へ戻る */
function stepScore(current: string, dir: 1 | -1, max = 100, step = 10): string {
  const now = current.trim() === '' ? null : Number(current);
  if (now === null || Number.isNaN(now)) return dir > 0 ? '0' : '';
  const next = Math.round(now / step) * step + dir * step;
  if (next < 0) return '';
  return String(Math.min(max, next));
}

/**
 * 範囲フィルタの入力欄。金額（単位付きテキスト）とスコア（数値）で見た目と操作を揃える。
 *
 * 金額欄は「1兆」「100億」を受けるため type="number" にできず、ブラウザ標準のスピナーが出ない。
 * 一方スコア欄の標準スピナーは幅を食ってプレースホルダを潰す。
 * そこで両方とも標準スピナーを消し、同じ ▲▼ を入力ボックスの内側に重ねる。
 */
function RangeStepInput({ value, onChange, onStep, placeholder, title, width }: {
  value: string;
  onChange: (v: string) => void;
  onStep: (current: string, dir: 1 | -1) => string;
  placeholder: string;
  title: string;
  width: number;
}) {
  const btn = 'block h-[9px] leading-[8px] w-3 text-[7px] text-gray-400 '
    + 'hover:text-gray-800 dark:hover:text-gray-100';
  return (
    <span className="relative inline-block shrink-0" style={{ width }}>
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        title={`${title}　▲▼またはキーボードの↑↓で増減できます`}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          onChange(onStep(value, e.key === 'ArrowUp' ? 1 : -1));
        }}
        className="w-full pl-1 pr-3 py-0.5 border border-gray-300 dark:border-gray-600 rounded
          bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
      />
      <span className="absolute right-px top-1/2 -translate-y-1/2 flex flex-col select-none">
        <button type="button" tabIndex={-1} className={btn} title="1段上げる"
          onClick={() => onChange(onStep(value, 1))}>▲</button>
        <button type="button" tabIndex={-1} className={btn} title="1段下げる"
          onClick={() => onChange(onStep(value, -1))}>▼</button>
      </span>
    </span>
  );
}

type ScoreRange = 'all' | '0-9' | '10-19' | '20-29' | '30-39' | '40-49' | '50-59' | '60-69' | '70-79' | '80-89' | '90-99' | '100-100';

type DistMetric = PolicyMetric | 'totalScore' | 'axisIdentify' | 'axisPurpose' | 'axisBudget' | 'axisEffective';
const DIST_METRICS: { key: DistMetric; label: string }[] = [
  { key: 'overallScore', label: '総合点' },
  ...AXIS_META.map(a => ({ key: a.key as DistMetric, label: a.label })),
  { key: 'axisIdentify', label: '支出先の明確さ' },
  { key: 'axisPurpose', label: '使途の説明' },
  { key: 'axisBudget', label: '収支の一致' },
];

const POLICY_METRICS: readonly DistMetric[] = ['overallScore', ...AXIS_META.map(a => a.key)];

/** 足きり入力の初期値（全指標が空欄＝無制限） */
const EMPTY_SCORE_FILTERS = (): Record<PolicyMetric, { min: string; max: string }> =>
  Object.fromEntries(
    (POLICY_METRICS as PolicyMetric[]).map(k => [k, { min: '', max: '' }]),
  ) as Record<PolicyMetric, { min: string; max: string }>;

export default function QualityPage() {
  // ?year= を初期年度に反映する。サンキー図・再委託ビューの「一覧で見る →」や
  // /api/quality-scores/[pid] が返す qualityWeb が year 付きで来るため、
  // 読まないと 2024 を見ていたのに 2025 の一覧が開いてしまう。
  const [year, setYear] = useState<'2024' | '2025'>(() => {
    if (typeof window === 'undefined') return '2025';
    const y = new URLSearchParams(window.location.search).get('year');
    return y === '2024' || y === '2025' ? y : '2025';
  });
  const [data, setData] = useState<QualityScoresResponse | null>(null);
  const [history, setHistory] = useState<ExecutionHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sankey 等から ?pid= で特定事業を指すことがある。初期表示だけ検索欄へ流し込む
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('pid') ?? '';
  });
  const [selectedMinistry, setSelectedMinistry] = useState<string>('');
  const [scoreRange, setScoreRange] = useState<ScoreRange>('all');
  const [selectedRecommendation, setSelectedRecommendation] = useState('');
  const [selectedAction, setSelectedAction] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [distMetric, setDistMetric] = useState<DistMetric>('overallScore');
  const [showGuide, setShowGuide] = useState(false);
  // 政策指標の足きり（下限/上限）。空欄は無制限
  const [scoreFilters, setScoreFilters] = useState(EMPTY_SCORE_FILTERS);
  /** 継続年数の足きり。0-100 のスコアではないので scoreFilters とは別に持つ */
  const [yearsFilter, setYearsFilter] = useState({ min: '', max: '' });
  const [amountFilters, setAmountFilters] = useState<Record<string, { min: string; max: string }>>({
    budgetAmount: { min: '', max: '' },
    execAmount: { min: '', max: '' },
    spendTotal: { min: '', max: '' },
    spendNetTotal: { min: '', max: '' },
  });
  const [sortField, setSortField] = useState<SortField>('spendNetTotal');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  /** ページを送ったら表の先頭に戻す。下端で押したとき次ページの末尾が見える状態を避ける */
  function goToPage(next: number) {
    setPage(next);
    tableScrollRef.current?.scrollTo({ top: 0 });
    tableScrollRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [dialogItem, setDialogItem] = useState<QualityScoreItem | null>(null);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    setSelectedMinistry('');
    fetch(`/api/quality-scores?year=${year}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then((json: QualityScoresResponse) => setData(json))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [year]);

  // 前年度の執行率（pid → 執行率 のみ）。縮小判定で単年度の不用と2年連続の不用を区別するために使う
  useEffect(() => {
    setHistory(null);
    fetch(`/api/execution-history?year=${year}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((json: ExecutionHistoryResponse) => setHistory(json))
      .catch(() => setHistory(null));
  }, [year]);

  /**
   * 全事業の政策評価。AI が全事業に付与した4観点と品質スコアの支出先系軸を統合する。
   * 判定の閾値は母集団の分位点から決まるため、全件を渡す必要がある（ページ分割前の値を使う）。
   */
  const policyByPid = useMemo(() => {
    if (!data) return null;
    // 前年度の執行率を突き合わせる。前年度に実績が無い事業は null のままで「判定不能」扱い
    const rates = history?.priorExecutionRates;
    // marumie の QualityScoreItem.execAmount は生JSONの欠測に備えて number | null。
    // 実データでは 2024・2025 とも null が0件で、policy-evaluation 側も execAmount > 0 で
    // 判定するため、0 に寄せても null のときと結果は変わらない（未評価扱いになる）。
    const items: PolicyQualityInput[] = data.items.map(i => ({
      ...i,
      execAmount: i.execAmount ?? 0,
      priorExecutionRate: rates?.[i.pid] ?? null,
    }));
    return new Map(buildPolicyEvaluations(items).map(p => [p.pid, p]));
  }, [data, history]);

  /** 分布・絞り込みで参照する指標値。政策指標と品質軸のどちらも同じ経路で引く */
  const metricValue = useMemo(() => (item: QualityScoreItem, metric: DistMetric): number | null => {
    if (POLICY_METRICS.includes(metric)) {
      return policyByPid?.get(item.pid)?.[metric as PolicyMetric] ?? null;
    }
    return (item[metric as keyof QualityScoreItem] as number | null | undefined) ?? null;
  }, [policyByPid]);

  const filtered = useMemo<QualityScoreItem[]>(() => {
    if (!data) return [];
    let items = data.items;

    if (selectedMinistry) {
      items = items.filter(i => i.ministry === selectedMinistry);
    }

    if (policyByPid) {
      if (selectedRecommendation) items = items.filter(i => policyByPid.get(i.pid)?.recommendation === selectedRecommendation);
      if (selectedAction) items = items.filter(i => policyByPid.get(i.pid)?.improvementAction === selectedAction);
      if (selectedCategory) items = items.filter(i => policyByPid.get(i.pid)?.policyCategory === selectedCategory);
    }

    if (scoreRange !== 'all') {
      const [lo, hi] = scoreRange.split('-').map(Number);
      items = items.filter(i => {
        const s = metricValue(i, distMetric);
        if (s === null) return false;
        return s >= lo && s <= hi;
      });
    }

    if (searchQuery.trim()) {
      const normalize = (s: string) => s.replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
      const q = normalize(searchQuery.trim());
      items = items.filter(i =>
        normalize(i.name).includes(q) ||
        i.pid.includes(q) ||
        normalize(i.bureau).includes(q) ||
        normalize(i.section).includes(q) ||
        normalize(i.division).includes(q)
      );
    }

    for (const [metric, { min, max }] of Object.entries(scoreFilters)) {
      const lo = min.trim() === '' ? null : Number(min);
      const hi = max.trim() === '' ? null : Number(max);
      if (lo !== null && !Number.isNaN(lo)) {
        items = items.filter(i => {
          const v = policyByPid?.get(i.pid)?.[metric as PolicyMetric];
          return v != null && v >= lo;
        });
      }
      if (hi !== null && !Number.isNaN(hi)) {
        items = items.filter(i => {
          const v = policyByPid?.get(i.pid)?.[metric as PolicyMetric];
          return v != null && v <= hi;
        });
      }
    }

    {
      const lo = yearsFilter.min.trim() === '' ? null : Number(yearsFilter.min);
      const hi = yearsFilter.max.trim() === '' ? null : Number(yearsFilter.max);
      // 開始年度が未登録の事業は判定不能。絞り込みをかけたときだけ除外する
      if (lo !== null && !Number.isNaN(lo)) items = items.filter(i => i.yearsRunning != null && i.yearsRunning >= lo);
      if (hi !== null && !Number.isNaN(hi)) items = items.filter(i => i.yearsRunning != null && i.yearsRunning <= hi);
    }

    for (const [field, { min, max }] of Object.entries(amountFilters)) {
      const minVal = parseAmountInput(min);
      const maxVal = parseAmountInput(max);
      if (minVal !== null) items = items.filter(i => (i[field as keyof QualityScoreItem] as number) >= minVal);
      if (maxVal !== null) items = items.filter(i => (i[field as keyof QualityScoreItem] as number) <= maxVal);
    }

    // 政策評価列のソート順序。値が欠測の事業は昇順・降順いずれでも末尾に置く。
    const policyRank = (pid: string): number | null => {
      const p = policyByPid?.get(pid);
      if (!p) return null;
      if (sortField === 'recommendation') return p.recommendation ? (RECOMMENDATION_ORDER[p.recommendation] ?? 99) : null;
      if (sortField === 'improvementAction') return p.improvementAction ? (IMPROVEMENT_ACTION_ORDER[p.improvementAction] ?? 99) : null;
      return p[sortField as PolicyMetric];
    };
    const isPolicySort = (POLICY_METRICS as readonly string[]).includes(sortField)
      || sortField === 'recommendation' || sortField === 'improvementAction';

    items = [...items].sort((a, b) => {
      let cmp = 0;
      if (isPolicySort) {
        const ar = policyRank(a.pid);
        const br = policyRank(b.pid);
        if (ar === null || br === null) return ar === br ? 0 : ar === null ? 1 : -1;
        cmp = ar - br;
      } else if (sortField === 'pid') {
        cmp = parseInt(a.pid) - parseInt(b.pid);
      } else {
        const key = sortField as keyof QualityScoreItem;
        const av = a[key];
        const bv = b[key];
        if (typeof av === 'string' && typeof bv === 'string') {
          cmp = av.localeCompare(bv, 'ja');
        } else {
          cmp = ((av as number) ?? -1) - ((bv as number) ?? -1);
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return items;
  }, [data, policyByPid, metricValue, selectedRecommendation, selectedAction, selectedCategory,
      selectedMinistry, scoreRange, distMetric, searchQuery, scoreFilters, yearsFilter, amountFilters, sortField, sortDir]);

  // Reset page on filter change
  const amountFilterKey = Object.values(amountFilters).map(f => `${f.min}-${f.max}`).join(',')
    + '|' + Object.values(scoreFilters).map(f => `${f.min}-${f.max}`).join(',');
  const filterKey = `${selectedMinistry}|${scoreRange}|${distMetric}|${searchQuery}|${amountFilterKey}|${sortField}|${sortDir}`
    + `|${selectedRecommendation}|${selectedAction}|${selectedCategory}|${yearsFilter.min}-${yearsFilter.max}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      // 推奨・改善アクションは見直しシグナルの強い順（降順）を初期値にする
      setSortDir(field === 'recommendation' || field === 'improvementAction' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="text-gray-300 ml-0.5">↕</span>;
    return <span className="text-blue-500 ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

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
          python3 scripts/score-project-quality.py
        </code> を実行してください
      </p>
    </div>
  );

  const { summary } = data;
  /** 絞り込みUIのカウント表示に使う全事業の政策評価。IIFE の外へ出して検索行からも参照できるようにする */
  const policyRows = policyByPid ? [...policyByPid.values()] : [];
  // 幅は固定。<select> は選択中の文言で幅が変わるため、放っておくと類型を選ぶたびに
  // 隣のUIが横に動く。truncate と併せて、選んでもレイアウトが動かないようにする。
  const selCls = 'shrink-0 truncate px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 '
    + 'rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer';

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {dialogItem && <ScoreDetailDialog item={dialogItem} policy={policyByPid?.get(dialogItem.pid)} onClose={() => setDialogItem(null)} year={year} />}
      {/* Header */}
      <div className="shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              事業別 政策評価・執行透明性スコア
            </h1>
            {/* 年度とページ切替。全ページ共通で右上に置く */}
            <div className="ml-auto" />
            <YearSelect value={year} onChange={y => setYear(y as '2024' | '2025')} years={[2025, 2024]} />
            <PageNavMenu current="/quality" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {(() => {
              const all = policyByPid ? [...policyByPid.values()] : [];
              if (all.length === 0) return `${summary.total.toLocaleString()}事業`;
              const stat = (pick: (p: PolicyEvaluation) => number | null) => {
                const v = all.map(pick).filter((n): n is number => n !== null).sort((a, b) => a - b);
                if (!v.length) return null;
                return {
                  avg: v.reduce((a, b) => a + b, 0) / v.length,
                  med: v[Math.floor(v.length / 2)],
                  lo: v[0],
                  hi: v[v.length - 1],
                };
              };
              const metrics = [
                { label: '総合点', s: stat(p => p.overallScore) },
                ...AXIS_META.map(a => ({ label: a.label, s: stat(p => p[a.key]) })),
              ];
              const abolition = policyRows.filter(p => p.recommendation === '終了・廃止候補').length;
              return (
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-mono">{summary.total.toLocaleString()}事業</span>
                  {metrics.map(({ label, s }) => s && (
                    <span key={label} className="whitespace-nowrap" title={`${label}
平均 ${s.avg.toFixed(1)} / 中央 ${s.med} / 最小 ${s.lo} / 最大 ${s.hi}`}>
                      <span className="text-gray-600 dark:text-gray-300 font-medium">{label}</span>
                      <span className="ml-1 font-mono text-xs">
                        <span className="text-gray-400">平均</span>{s.avg.toFixed(0)}
                        <span className="text-gray-400 ml-1">中央</span>{s.med}
                      </span>
                    </span>
                  ))}
                  <span className="whitespace-nowrap">
                    <span className="text-gray-600 dark:text-gray-300 font-medium">終了・廃止候補</span>
                    <span className="ml-1 font-mono text-xs">{abolition.toLocaleString()}件</span>
                  </span>
                </span>
              );
            })()}
          </p>
        </div>
      </div>

      {/* Score distribution summary (10-point bins) + histogram */}
      <div className="relative shrink-0 w-full px-3 py-3">
        {(() => {
          const binRanges: { label: string; range: ScoreRange; lo: number; hi: number }[] = [
            { label: '100', range: '100-100', lo: 100, hi: 100 },
            { label: '90-99', range: '90-99', lo: 90, hi: 99 },
            { label: '80-89', range: '80-89', lo: 80, hi: 89 },
            { label: '70-79', range: '70-79', lo: 70, hi: 79 },
            { label: '60-69', range: '60-69', lo: 60, hi: 69 },
            { label: '50-59', range: '50-59', lo: 50, hi: 59 },
            { label: '40-49', range: '40-49', lo: 40, hi: 49 },
            { label: '30-39', range: '30-39', lo: 30, hi: 39 },
            { label: '20-29', range: '20-29', lo: 20, hi: 29 },
            { label: '10-19', range: '10-19', lo: 10, hi: 19 },
            { label: '0-9', range: '0-9', lo: 0, hi: 9 },
          ];
          const counts = binRanges.map(({ lo, hi }) =>
            data.items.filter(i => { const s = metricValue(i, distMetric); return s != null && s >= lo && s <= hi; }).length
          );
          const maxCount = Math.max(...counts, 1);
          const binColor = (lo: number) => {
            if (lo >= 90) return { bg: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', bar: 'bg-green-400' };
            if (lo >= 70) return { bg: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', bar: 'bg-blue-400' };
            if (lo >= 50) return { bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', bar: 'bg-yellow-400' };
            return { bg: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', bar: 'bg-red-400' };
          };
          return (
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex items-end gap-0.5">
                {binRanges.map(({ label, range, lo }, i) => {
                  const count = counts[i];
                  const h = Math.max(2, Math.round((count / maxCount) * 56));
                  const { bar } = binColor(lo);
                  const isActive = scoreRange === range;
                  return (
                    <button
                      key={range}
                      onClick={() => setScoreRange(isActive ? 'all' : range)}
                      className={`flex flex-col items-center transition-all ${isActive ? 'ring-1 ring-blue-500 rounded' : ''}`}
                      title={`${label}点: ${count}件`}
                    >
                      <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 mb-0.5">{count || ''}</span>
                      <div className={`w-7 rounded-sm ${bar}`} style={{ height: `${h}px` }} />
                      <span className="text-[9px] font-mono text-gray-400 mt-1">{label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-1 self-end">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-gray-500 dark:text-gray-400 leading-none">分布の軸</span>
                  <select
                    value={distMetric}
                    onChange={e => { setDistMetric(e.target.value as DistMetric); setScoreRange('all'); }}
                    className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    {DIST_METRICS.map(m => (
                      <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => setScoreRange('all')}
                  disabled={scoreRange === 'all'}
                  title={scoreRange === 'all' ? undefined : 'スコア帯の絞り込みを解除'}
                  className={`rounded-lg px-3 py-1.5 text-center transition-all bg-gray-100 dark:bg-gray-700 ${
                    scoreRange === 'all'
                      ? 'text-gray-600 dark:text-gray-300 cursor-default'
                      : 'ring-2 ring-blue-500 text-gray-900 dark:text-white hover:opacity-90'
                  }`}
                >
                  <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400">表示 / 全件</div>
                  <div className="text-sm font-bold font-mono whitespace-nowrap">
                    <span className={filtered.length !== summary.total ? 'text-blue-600 dark:text-blue-400' : ''}>
                      {filtered.length.toLocaleString()}
                    </span>
                    <span className="text-gray-400 font-normal"> / {summary.total.toLocaleString()}</span>
                  </div>
                </button>
              </div>
              <div className="flex flex-col gap-1.5 self-end flex-1 min-w-[200px]">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="事業名・PID・組織名で検索..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="flex-1 min-w-[120px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <select
                    value={selectedMinistry}
                    onChange={e => setSelectedMinistry(e.target.value)}
                    className="w-[162px] shrink-0 truncate px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer"
                  >
                    <option value="">全府省庁</option>
                    {summary.ministries.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  {/* 政策評価の絞り込み。1行に収めるため検索・府省庁と同居させる */}
                  {policyByPid && <>
                        <select value={selectedRecommendation} onChange={e => setSelectedRecommendation(e.target.value)} className={`w-[154px] ${selCls}`}>
                          <option value="">推奨: すべて</option>
                          {RECOMMENDATION_LABELS.map(label => (
                            <option key={label} value={label}>
                              {label}（{policyRows.filter(p => p.recommendation === label).length.toLocaleString()}）
                            </option>
                          ))}
                        </select>
                        <select value={selectedAction} onChange={e => setSelectedAction(e.target.value)} className={`w-[142px] ${selCls}`}>
                          <option value="">改善: すべて</option>
                          {IMPROVEMENT_ACTION_LABELS.map(label => (
                            <option key={label} value={label}>
                              {label}（{policyRows.filter(p => p.improvementAction === label).length.toLocaleString()}）
                            </option>
                          ))}
                        </select>
                        <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className={`w-[194px] ${selCls}`}>
                          {/* 政策類型は32分類あるため、7つの上位グループで optgroup にまとめる */}
                          <option value="">類型: すべて</option>
                          {POLICY_CATEGORY_GROUPS.map(group => (
                            <optgroup key={group.id} label={group.label}>
                              {group.categories.map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.label}（{policyRows.filter(p => p.policyCategory === c.id).length.toLocaleString()}）
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {/*
                          出現・消滅させると検索欄(flex-1)が伸縮してセレクト群が横に動くため、常に描画する。
                          透明にすると「使っていない余白」に見えてしまうので、無効時は淡色で残す。
                        */}
                        <button
                          onClick={() => { setSelectedRecommendation(''); setSelectedAction(''); setSelectedCategory(''); }}
                          disabled={!(selectedRecommendation || selectedAction || selectedCategory)}
                          title="推奨・改善・類型の絞り込みを解除"
                          className="shrink-0 text-[11px] text-gray-400 enabled:hover:text-gray-700 dark:enabled:hover:text-gray-100 disabled:opacity-30 disabled:cursor-default"
                        >
                          ✕ 解除
                        </button>
                  </>}
                </div>
                {/* 金額の範囲フィルタ */}
                <div className="flex items-center gap-1 text-xs flex-wrap">
                  {([
                    { key: 'budgetAmount', label: '予算', desc: COL_DESC.予算額 },
                    { key: 'execAmount', label: '執行', desc: COL_DESC.執行額 },
                    { key: 'spendTotal', label: '支出計', desc: COL_DESC.支出先合計 },
                    { key: 'spendNetTotal', label: '実質', desc: COL_DESC.実質支出額 },
                  ] as const).map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center shrink-0" title={desc}>
                      <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap mr-0.5 cursor-help underline decoration-dotted decoration-gray-300 underline-offset-2">{label}</span>
                      <RangeStepInput
                        value={amountFilters[key].min} width={50} placeholder="下限" title="下限 (例: 100億, 1兆)"
                        onStep={stepAmount}
                        onChange={v => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], min: v } }))}
                      />
                      <span className="text-gray-400 mx-px">~</span>
                      <RangeStepInput
                        value={amountFilters[key].max} width={50} placeholder="上限" title="上限 (例: 1兆, 5000億)"
                        onStep={stepAmount}
                        onChange={v => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], max: v } }))}
                      />
                      <button
                        onClick={() => setAmountFilters(prev => ({ ...prev, [key]: { min: '', max: '' } }))}
                        disabled={!(amountFilters[key].min || amountFilters[key].max)}
                        className="ml-0.5 text-gray-400 enabled:hover:text-gray-600 dark:enabled:hover:text-gray-200 disabled:opacity-0"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                      <div className="flex items-center shrink-0" title={COL_DESC.継続年数}>
                        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap mr-0.5 cursor-help underline decoration-dotted decoration-gray-300 underline-offset-2">年数</span>
                        <RangeStepInput
                          value={yearsFilter.min} width={50} placeholder="下限" title="下限（年）"
                          onStep={(c, d) => stepScore(c, d, 110, 5)}
                          onChange={v => setYearsFilter(prev => ({ ...prev, min: v }))}
                        />
                        <span className="text-gray-400 mx-px">~</span>
                        <RangeStepInput
                          value={yearsFilter.max} width={50} placeholder="上限" title="上限（年）"
                          onStep={(c, d) => stepScore(c, d, 110, 5)}
                          onChange={v => setYearsFilter(prev => ({ ...prev, max: v }))}
                        />
                        <button
                          onClick={() => setYearsFilter({ min: '', max: '' })}
                          disabled={!(yearsFilter.min || yearsFilter.max)}
                          className="ml-0.5 text-gray-400 enabled:hover:text-gray-600 dark:enabled:hover:text-gray-200 disabled:opacity-0"
                        >
                          ✕
                        </button>
                      </div>
                      {/* 指標の説明。足きり行は6組で最も詰まるので、余裕のある金額行の末尾に置く */}
                      {/* 指標の説明なので、指標そのものが並ぶこの行の末尾に置く */}
                      <button
                      onClick={() => setShowGuide(v => !v)}
                      className="ml-auto shrink-0 text-[11px] text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                      >
                      {showGuide ? '▲ 読み方を閉じる' : '▼ 指標の読み方'}
                      </button>
                </div>
                {/* 足きり。1600px幅で列Cは1040pxあり7組が収まる。狭い画面では折り返す */}
                {policyByPid && (
                  <div className="flex items-center gap-1 text-xs flex-wrap">
                        {([
                          { key: 'overallScore' as const, label: '総合', desc: COL_DESC.総合点 },
                          ...AXIS_META.map(a => ({ key: a.key, label: a.short,
                            desc: `${a.label}（総合点への重み ${a.weight}）

${a.desc}` })),
                        ]).map(({ key, label, desc }) => (
                          <div key={key} className="flex items-center shrink-0" title={desc}>
                            <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap mr-0.5 cursor-help underline decoration-dotted decoration-gray-300 underline-offset-2">{label}</span>
                            <RangeStepInput
                              value={scoreFilters[key].min} width={50} placeholder="下限" title="下限 (0-100)"
                              onStep={(c, d) => stepScore(c, d)}
                              onChange={v => setScoreFilters(prev => ({ ...prev, [key]: { ...prev[key], min: v } }))}
                            />
                            <span className="text-gray-400 mx-px">~</span>
                            <RangeStepInput
                              value={scoreFilters[key].max} width={50} placeholder="上限" title="上限 (0-100)"
                              onStep={(c, d) => stepScore(c, d)}
                              onChange={v => setScoreFilters(prev => ({ ...prev, [key]: { ...prev[key], max: v } }))}
                            />
                            <button
                              onClick={() => setScoreFilters(prev => ({ ...prev, [key]: { min: '', max: '' } }))}
                              disabled={!(scoreFilters[key].min || scoreFilters[key].max)}
                              className="ml-0.5 text-gray-400 enabled:hover:text-gray-600 dark:enabled:hover:text-gray-200 disabled:opacity-0"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {/* 指標の説明。フローに置くと展開したぶん表が押し下げられるので、絶対配置で表の上に重ねる */}
        {policyByPid && showGuide && (
        <p className="absolute left-4 right-4 top-full z-20 -mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 shadow-lg text-[11px] leading-5 text-gray-600 dark:text-gray-300">
        <span className="font-semibold">政策評価</span>は「誰のどんな課題を、どの活動で、どう改善するか」がどれだけ明確に説明され、
        その成果を検証できる状態かどうか。
        <span className="font-semibold">執行透明性</span>は支出先が特定できるか・使途を説明できるか（支出先の明確さ55＋使途の説明45）。
        「収支の一致」は9割の事業が満点でほぼ定数だったため加重平均から外し、不一致（60点未満）だけをフラグとして拾っています。
        <span className="font-semibold">総合点</span>は政策評価と執行透明性を統合した値です。
        推奨は絶対点ではなく<span className="font-semibold">母集団内の順位帯</span>で切っています（総合点は中央に強く偏るため、絶対値では下位帯が空になる）。
        「<span className="font-semibold">縮小</span>」は事業の優劣ではなく<span className="font-semibold">不用額</span>（予算と執行の乖離）に基づく計上額の見直しで、総合点には影響しません
        — 不用額の返納は適切な行動であり、減点すると使い切りを誘発するためです。
        単年度の不用は入札差金でも生じるため、縮小は<span className="font-semibold">2年連続で不用率が上位帯</span>にある事業に限定し（一覧に「2年連続の不用」を表示）、
        単年度のみ・前年度実績が無い事業は要改善（差異理由の説明）にとどめています。
        逆に予算をほぼ消化していても支出先が不透明な事業は「継続」とせず要改善として拾います。
        「終了・廃止候補」は結論ではなく政党レビューへ送るためのスクリーニング結果です。
        判断（推奨）と改善（改善アクション）は分離して表示しています。
        </p>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 flex flex-col w-full px-3 pb-4">
        {/*
          外枠（枠線・角丸）と、スクロールする内箱を分ける。
          ページャを枠の中のフッタとして固定したいので、枠自体はスクロールさせない。
          内箱を縦にもスクロールさせるのは thead の sticky を効かせるため。overflow-x だけだと
          overflow-y が auto に計算され、高さ制限の無い箱が縦のスクロールコンテナになってしまう。
        */}
        <div className="flex-1 min-h-0 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
        <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
          {/* table-fixed + colgroup: ソートで中身が変わっても列幅が動かないようにする */}
          <table className="w-full text-xs table-fixed min-w-[1754px]">
            <colgroup>
              {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap" title={COL_DESC.PID} onClick={() => handleSort('pid')}>
                  PID<SortIcon field="pid" />
                </th>
                <th className="px-2 py-2 text-left cursor-pointer truncate" title={COL_DESC.事業名} onClick={() => handleSort('name')}>
                  事業名<SortIcon field="name" />
                </th>
                <th className="px-2 py-2 text-left whitespace-nowrap" title={COL_DESC.府省庁}>府省庁</th>
                <th className="px-2 py-2 text-left whitespace-nowrap" title={COL_DESC.組織}>局・庁</th>
                <th className="px-2 py-2 text-center whitespace-nowrap" title={COL_DESC.支出先列}>支出先</th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap bg-violet-50 dark:bg-violet-950/60" title={COL_DESC.総合点} onClick={() => handleSort('overallScore')}>
                  総合点<SortIcon field="overallScore" />
                </th>
                {AXIS_META.map(a => (
                  <th
                    key={a.key}
                    className="px-2 py-2 text-right cursor-pointer whitespace-nowrap bg-violet-50 dark:bg-violet-950/60"
                    title={`${a.label}（総合点への重み ${a.weight}）

${a.desc}`}
                    onClick={() => handleSort(a.key)}
                  >
                    {a.label}<SortIcon field={a.key} />
                  </th>
                ))}
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap bg-violet-50 dark:bg-violet-950/60" title={COL_DESC.推奨} onClick={() => handleSort('recommendation')}>
                  推奨<SortIcon field="recommendation" />
                </th>
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap bg-violet-50 dark:bg-violet-950/60" title={COL_DESC.改善アクション} onClick={() => handleSort('improvementAction')}>
                  改善アクション<SortIcon field="improvementAction" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.継続年数} onClick={() => handleSort('yearsRunning')}>
                  継続年数<SortIcon field="yearsRunning" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.予算額} onClick={() => handleSort('budgetAmount')}>
                  予算額<SortIcon field="budgetAmount" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.執行額} onClick={() => handleSort('execAmount')}>
                  執行額<SortIcon field="execAmount" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.支出先合計} onClick={() => handleSort('spendTotal')}>
                  支出先合計<SortIcon field="spendTotal" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.実質支出額} onClick={() => handleSort('spendNetTotal')}>
                  実質支出額<SortIcon field="spendNetTotal" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.再委託階層} onClick={() => handleSort('redelegationDepth')}>
                  再委託階層<SortIcon field="redelegationDepth" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.支出先数} onClick={() => handleSort('rowCount')}>
                  支出先数<SortIcon field="rowCount" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {pageItems.map(item => {
                const policy = policyByPid?.get(item.pid);
                return (
                <React.Fragment key={item.pid}>
                  <tr
                    className="hover:bg-blue-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                    onClick={() => setExpandedRow(expandedRow === item.pid ? null : item.pid)}
                  >
                    <td className="px-2 py-1.5 font-mono text-gray-500">{item.pid}</td>
                    <td className="px-2 py-1.5 text-gray-900 dark:text-white truncate" title={item.name}>
                      {item.name}
                    </td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 truncate" title={item.ministry}>{item.ministry}</td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 truncate" title={item.bureau || undefined}>{item.bureau || '-'}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      <button
                        onClick={e => { e.stopPropagation(); setDialogItem(item); }}
                        className="px-2 py-1 text-[11px] font-medium rounded-md border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition-colors"
                        title="支出先一覧・スコア計算根拠を表示"
                      >
                        詳細
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-right bg-violet-50/50 dark:bg-violet-950/40">
                      {policy?.overallScore != null
                        ? <span className={`font-bold font-mono ${scoreColor(policy.overallScore)}`}>{policy.overallScore}</span>
                        : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    {AXIS_META.map(a => {
                      const v = policy?.[a.key];
                      return (
                        <td key={a.key} className="px-2 py-1.5 text-right whitespace-nowrap bg-violet-50/50 dark:bg-violet-950/40">
                          {v != null
                            ? <span className={`font-mono ${scoreColor(v)}`}>{v}</span>
                            : <span className="text-gray-300 dark:text-gray-600" title="未評価（総合点では重みごと除外）">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 bg-violet-50/50 dark:bg-violet-950/40">
                      {policy
                        ? <><RecommendationBadge policy={policy} /><PersistentUnusedMark policy={policy} /></>
                        : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-2 py-1.5 bg-violet-50/50 dark:bg-violet-950/40">
                      {policy?.improvementAction
                        ? <ActionBadge action={policy.improvementAction} />
                        : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap"
                      title={item.startYear ? `${item.startYear}年度開始 / ${item.noEndDate ? '終了予定なし' : (item.endYear ? `${item.endYear}年度終了予定` : '終了年度未設定')}` : '開始年度の登録なし'}
                    >
                      {item.yearsRunning != null
                        ? <><span className={item.yearsRunning >= 20 ? 'text-orange-600 dark:text-orange-400 font-semibold' : ''}>{item.yearsRunning}</span>
                            {item.noEndDate && <span className="text-gray-400 ml-0.5">★</span>}</>
                        : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.budgetAmount ? formatAmount(item.budgetAmount) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.execAmount ? formatAmount(item.execAmount ?? 0) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.spendTotal ? formatAmount(item.spendTotal) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.spendNetTotal ? formatAmount(item.spendNetTotal) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.redelegationDepth || '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-500">{item.recipientCount ?? item.rowCount}</td>
                  </tr>
                  {expandedRow === item.pid && (
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <td colSpan={19} className="px-4 py-3">
                        <div className="mb-2 text-gray-800 dark:text-gray-100">{item.name}</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                              政策評価
                              {policy?.policyCategoryLabel && (
                                <span className="ml-1 font-normal text-gray-400">{policy.policyCategoryLabel}</span>
                              )}
                            </h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div className="font-mono">総合点 {policy?.overallScore ?? '—'}点</div>
                              {AXIS_META.filter(a => a.key !== 'executionTransparency').map(a => (
                                <div key={a.key}>{a.label}: {policy?.[a.key] ?? '未評価'}</div>
                              ))}
                              {policy?.findings.necessity && (
                                <div className="text-[10px] leading-relaxed">{policy.findings.necessity}</div>
                              )}
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">執行透明性</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div className="font-mono">{policy?.executionTransparency ?? '—'}点</div>
                              <div>支出先の明確さ: {item.axisIdentify != null ? item.axisIdentify.toFixed(0) : '—'}</div>
                              <div>使途の説明: {item.axisPurpose != null ? item.axisPurpose.toFixed(0) : '—'}</div>
                              <div className="text-gray-400">収支の一致: {item.axisBudget != null ? item.axisBudget.toFixed(0) : '—'}（不算入・不一致フラグ）</div>
                              <div>法人番号記入: {item.cnFilled} / 未記入: {item.cnEmpty}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                              予算と執行
                              <span className="ml-1 font-normal text-gray-400">（総合点に不算入）</span>
                            </h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>予算額: {formatAmount(item.budgetAmount)}</div>
                              <div>執行額: {formatAmount(item.execAmount ?? 0)}</div>
                              {policy?.executionRate != null ? (
                                <>
                                  <div>執行率: {Math.round(policy.executionRate * 100)}%</div>
                                  <div>不用額: {policy.unusedAmount ? formatAmount(policy.unusedAmount) : '0'}
                                    {policy.unusedRatio != null && `（${Math.round(policy.unusedRatio * 100)}%）`}</div>
                                </>
                              ) : (
                                <div className="text-gray-400">執行実績なし（評価対象外）</div>
                              )}
                              <div>
                                前年度: {policy?.priorExecutionRate != null
                                  ? `執行率 ${Math.round(policy.priorExecutionRate * 100)}%・不用率 ${Math.round((policy.priorUnusedRatio ?? 0) * 100)}%`
                                  : <span className="text-gray-400">実績なし（判定不能）</span>}
                              </div>
                              {policy && (
                                <div className={UNUSED_TREND_META[policy.unusedTrend].cls}>
                                  {UNUSED_TREND_META[policy.unusedTrend].label}
                                </div>
                              )}
                              <div>実質支出額: {formatAmount(item.spendNetTotal)}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">推奨と改善</h4>
                            <div className="space-y-1 text-gray-600 dark:text-gray-400">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {policy && <RecommendationBadge policy={policy} />}
                                {policy?.improvementAction && <ActionBadge action={policy.improvementAction} />}
                              </div>
                              {policy?.recommendationReason && (
                                <div className="text-[10px] leading-relaxed">{policy.recommendationReason}</div>
                              )}
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">組織・支出構造</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>{[item.ministry, item.bureau, item.division, item.section, item.office].filter(Boolean).join(' › ')}</div>
                              <div>支出先数: {item.recipientCount ?? item.rowCount}／ブロック: {item.blockCount}{item.orphanBlockCount > 0 && <span className="text-orange-500">（孤立 {item.orphanBlockCount}）</span>}</div>
                              <div>再委託: {item.hasRedelegation ? `あり（階層${item.redelegationDepth}）` : 'なし'}</div>
                              <div>不透明支出比: {pct(item.opaqueRatio)}</div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {pageItems.length === 0 && (
            <div className="px-4 py-16 text-center">
              <div className="text-sm text-gray-500 dark:text-gray-400">条件に合う事業がありません</div>
              <div className="mt-1 text-xs text-gray-400">絞り込みを緩めるか、解除してください</div>
              <button
                onClick={() => {
                  setSearchQuery(''); setSelectedMinistry(''); setScoreRange('all');
                  setSelectedRecommendation(''); setSelectedAction(''); setSelectedCategory('');
                  setScoreFilters(EMPTY_SCORE_FILTERS());
                  setYearsFilter({ min: '', max: '' });
                  setAmountFilters({
                    budgetAmount: { min: '', max: '' }, execAmount: { min: '', max: '' },
                    spendTotal: { min: '', max: '' }, spendNetTotal: { min: '', max: '' },
                  });
                }}
                className="mt-3 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                すべての絞り込みを解除
              </button>
            </div>
          )}
        </div>

        {/* ページャは表の枠内フッタ。表とページ番号が離れて見えないようにする */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 shrink-0 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <button
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              前へ
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {page} / {totalPages}
              <span className="ml-2 text-gray-400">
                {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–
                {Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} 件目
              </span>
            </span>
            <button
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              次へ
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
