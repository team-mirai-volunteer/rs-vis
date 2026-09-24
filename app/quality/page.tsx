'use client';

import { fiscalYear, fiscalYearLabel } from '@/app/lib/rs-fiscal-year';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { SectionScoreTable } from '@/client/components/quality/SectionScoreTable';
import { YearSelect } from '@/components/navigation/YearSelect';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import LoadingSpinner from '@/client/components/LoadingSpinner';
import type { QualityScoreItem, QualityScoresResponse } from '@/app/api/quality-scores/route';
import type { QualityYear } from '@/app/lib/api/quality-year';
import type { RecipientRow } from '@/app/lib/api/quality-recipients-loader';
import type { ExecutionHistoryResponse } from '@/app/api/execution-history/route';
import type { ProjectDetail } from '@/types/project-details';
import { ScoreDetailDialog } from '@/client/components/quality/ScoreDetailDialog';
import { useQualityLocation } from '@/client/hooks/useQualityLocation';
import { MobileQualityList } from '@/client/components/quality/MobileQualityList';
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

/** 範囲フィルタ横の「✕」。値が無いときは場所だけ残して透明にする（並びが動かないように） */
const CLEAR_BTN_CLS = 'ml-0.5 size-4 text-mirai-text-muted hover:bg-transparent hover:text-mirai-text-subtle disabled:opacity-0';





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
  // 入力ボックス内に重ねる極小のステッパ。Button の高さ・角丸・太字を打ち消して 9px に収める
  const btn = 'block h-[9px] w-3 rounded-none px-0 py-0 text-[7px] font-normal leading-[8px] text-mirai-text-muted '
    + 'hover:bg-transparent hover:text-mirai-text focus-visible:ring-0 focus-visible:ring-offset-0';
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
        className="w-full rounded-md border border-mirai-border bg-card py-0.5 pl-1 pr-3 text-mirai-text placeholder:text-mirai-text-placeholder outline-none transition-colors focus-visible:border-primary"
      />
      <span className="absolute right-px top-1/2 -translate-y-1/2 flex flex-col select-none">
        <Button variant="ghost" tabIndex={-1} className={btn} title="1段上げる"
          onClick={() => onChange(onStep(value, 1))}>▲</Button>
        <Button variant="ghost" tabIndex={-1} className={btn} title="1段下げる"
          onClick={() => onChange(onStep(value, -1))}>▼</Button>
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
  const { year, setYear, mode, setMode, detailPid, openDetail, closeDetail, ready } = useQualityLocation();
  /** 2026 は要求ベースの仮想年度（採点はシート 2025、予算額は翌年度要求額）。執行系 API はシート年度で叩く */
  const sourceYear = year === '2026' ? '2025' : year;
  const isRequestYear = year === '2026';
  const [loadedData, setData] = useState<{ year: QualityYear; value: QualityScoresResponse } | null>(null);
  const data = loadedData?.year === year ? loadedData.value : null;
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
  /** sm 未満でヒストグラム・絞り込み列を開いているか（PC では常に表示） */
  const [filterOpen, setFilterOpen] = useState(false);
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
  const dialogItem = detailPid ? data?.items.find(item => item.pid === detailPid) : null;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setError(null);
    setSelectedMinistry('');
    fetch(`/api/quality-scores?year=${year}`, { signal: controller.signal })
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then((json: QualityScoresResponse) => { if (!controller.signal.aborted) setData({ year, value: json }); })
      .catch(e => { if (!controller.signal.aborted) setError(String(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [year, ready]);

  // 前年度の執行率（pid → 執行率 のみ）。縮小判定で単年度の不用と2年連続の不用を区別するために使う
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setHistory(null);
    fetch(`/api/execution-history?year=${sourceYear}`, { signal: controller.signal })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((json: ExecutionHistoryResponse) => { if (!controller.signal.aborted) setHistory(json); })
      .catch(() => { if (!controller.signal.aborted) setHistory(null); });
    return () => controller.abort();
  }, [sourceYear, ready]);

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
      priorUnusedRatio: history?.priorUnusedRatios?.[i.pid] ?? null,
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
    if (sortField !== field) return <span className="text-mirai-text-placeholder ml-0.5">↕</span>;
    return <span className="text-primary ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  if (!ready || loading || (!error && !data)) return <LoadingSpinner />;

  if (error || !data) return (
    <div className="p-8 text-destructive">
      <p className="font-bold">データを読み込めません</p>
      <p className="text-sm mt-1">{error}</p>
      <p className="text-sm mt-2 text-mirai-text-subtle">
        <code className="bg-mirai-surface px-1 rounded-md">
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
  const selCls = 'shrink-0 truncate px-2 py-1 text-xs border border-mirai-border '
    + 'rounded-md bg-card text-mirai-text-secondary cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40';

  return (
    <div className="h-screen flex flex-col bg-background">
      <AppHeader fiscalYear={fiscalYear(year)} current="/quality">
        {/* 表示単位: 事業 / 項（予算書の項ごとに配下事業の評価を金額加重平均） */}
        <div role="group" aria-label="表示単位" className="flex overflow-hidden rounded-full border border-mirai-border bg-card shadow-xs">
          {([['project', '事業'], ['section', '項']] as const).map(([m, label]) => (
            <Button
              key={m}
              variant="ghost"
              size="sm"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn('h-[34px] rounded-none px-3 text-xs', mode === m ? 'bg-mirai-surface-teal text-primary-accent hover:bg-mirai-surface-teal' : 'text-mirai-text-subtle')}
            >
              {label}
            </Button>
          ))}
        </div>
        <YearSelect labelForYear={fiscalYearLabel} value={year} onChange={y => setYear(y as QualityYear)} years={[2026, 2025, 2024]} />
        {/* sm 未満はヒストグラム・絞り込み列を畳んでいるので、ここから開く */}
        <Button
          variant="outline"
          size="icon"
          aria-label="絞り込みと分布"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(v => !v)}
          className={cn('shrink-0 border-mirai-border sm:hidden', filterOpen ? 'bg-mirai-surface text-mirai-text' : 'text-mirai-text-subtle')}
        >
          <SlidersHorizontal className="size-[18px]" aria-hidden="true" />
        </Button>
      </AppHeader>
      {dialogItem && <ScoreDetailDialog item={dialogItem} policy={policyByPid?.get(dialogItem.pid)} onClose={closeDetail} year={year} />}
      {detailPid && data && !dialogItem && <div role="status" className="border-b border-mirai-border bg-card px-4 py-3 text-sm">
        {fiscalYear(year)}年度に指定された事業（PID {detailPid}）は見つかりませんでした。
        <Button variant="link" size="sm" onClick={closeDetail}>一覧に戻る</Button>
      </div>}
      {mode === 'section' && (
        <>
          <div className="shrink-0 bg-card border-b border-mirai-border px-3 py-3">
            <h1 className="text-lg font-bold text-mirai-text">項別 政策評価（配下 RS事業の金額加重平均）</h1>
            <p className="mt-1 text-sm text-mirai-text-muted">
              予算書の「項」ごとに、紐づく RS事業の 6 軸を RS 2-2 の{isRequestYear ? '要求額' : '計上額'}で加重平均しています。項名から統合ビューでその項を開けます。
              {isRequestYear && ' 2026 年度は要求ベース（採点はシート 2025）です。'}
            </p>
          </div>
          <SectionScoreTable year={year} />
        </>
      )}
      {mode === 'project' && (<>
      {/* Header */}
      <div className="shrink-0 bg-card border-b border-mirai-border px-3 py-3">
        <div>
          <div className="mb-1">
            <h1 className="min-w-0 text-lg font-bold text-mirai-text">
              事業別 政策評価・執行透明性スコア
              {isRequestYear && <span className="ml-2 align-middle text-xs font-medium text-mirai-text-muted">2026年度は要求ベース（採点はシート2025・予算額は翌年度要求額・執行額なし）</span>}
            </h1>
          </div>
          <p className="hidden text-sm text-mirai-text-muted mt-1 sm:block">
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
                      <span className="text-mirai-text-subtle font-medium">{label}</span>
                      <span className="ml-1 font-mono text-xs">
                        <span className="text-mirai-text-muted">平均</span>{s.avg.toFixed(0)}
                        <span className="text-mirai-text-muted ml-1">中央</span>{s.med}
                      </span>
                    </span>
                  ))}
                  <span className="whitespace-nowrap">
                    <span className="text-mirai-text-subtle font-medium">終了・廃止候補</span>
                    <span className="ml-1 font-mono text-xs">{abolition.toLocaleString()}件</span>
                  </span>
                </span>
              );
            })()}
          </p>
        </div>
      </div>

      {/* Score distribution summary (10-point bins) + histogram。
          sm 未満では縦を食いすぎるので「絞り込み」ボタンで開閉する（既定は閉じて表を見せる） */}
      <div className={cn('relative shrink-0 w-full px-3 py-3 sm:block', filterOpen ? 'block' : 'hidden')}>
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
            if (lo >= 90) return { bg: 'bg-green-100 text-green-800', bar: 'bg-green-400' };
            if (lo >= 70) return { bg: 'bg-primary/10 text-primary-accent', bar: 'bg-primary/60' };
            if (lo >= 50) return { bg: 'bg-yellow-100 text-yellow-800', bar: 'bg-yellow-400' };
            return { bg: 'bg-red-100 text-red-800', bar: 'bg-red-400' };
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
                    <Button
                      key={range}
                      variant="ghost"
                      onClick={() => setScoreRange(isActive ? 'all' : range)}
                      className={cn(
                        'h-auto flex-col items-center gap-0 rounded-md px-0 py-0 font-normal hover:bg-transparent',
                        isActive && 'ring-1 ring-primary',
                      )}
                      title={`${label}点: ${count}件`}
                    >
                      <span className="text-[10px] font-mono text-mirai-text-muted mb-0.5">{count || ''}</span>
                      <div className={`w-7 rounded-sm ${bar}`} style={{ height: `${h}px` }} />
                      <span className="text-[9px] font-mono text-mirai-text-muted mt-1">{label}</span>
                    </Button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-1 self-end">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-mirai-text-muted leading-none">分布の軸</span>
                  <select
                    value={distMetric}
                    onChange={e => { setDistMetric(e.target.value as DistMetric); setScoreRange('all'); }}
                    className="text-xs border border-mirai-border rounded-md px-2 py-1 bg-card text-mirai-text-secondary cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40"
                  >
                    {DIST_METRICS.map(m => (
                      <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="outline"
                  onClick={() => setScoreRange('all')}
                  disabled={scoreRange === 'all'}
                  title={scoreRange === 'all' ? undefined : 'スコア帯の絞り込みを解除'}
                  className={cn(
                    'h-auto flex-col gap-0 rounded-xl px-3 py-1.5 text-center font-normal shadow-none',
                    // 無効＝絞り込み無しの平常状態なので、淡くせずそのまま見せる
                    scoreRange === 'all'
                      ? 'border-mirai-border bg-mirai-surface text-mirai-text-subtle disabled:opacity-100'
                      : 'border-primary bg-primary/10 text-mirai-text hover:bg-primary/20',
                  )}
                >
                  <div className="text-[10px] font-medium text-mirai-text-muted">表示 / 全件</div>
                  <div className="text-sm font-bold font-mono whitespace-nowrap">
                    <span className={filtered.length !== summary.total ? 'text-primary-accent' : ''}>
                      {filtered.length.toLocaleString()}
                    </span>
                    <span className="text-mirai-text-muted font-normal"> / {summary.total.toLocaleString()}</span>
                  </div>
                </Button>
              </div>
              <div className="flex flex-col gap-1.5 self-end flex-1 min-w-[200px]">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="事業名・PID・組織名で検索..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="flex-1 min-w-[120px] px-3 py-1.5 text-sm border border-mirai-border rounded-md bg-card text-mirai-text placeholder:text-mirai-text-placeholder outline-none transition-colors focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/40"
                  />
                  <select
                    value={selectedMinistry}
                    onChange={e => setSelectedMinistry(e.target.value)}
                    className={`w-[162px] ${selCls}`}
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
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => { setSelectedRecommendation(''); setSelectedAction(''); setSelectedCategory(''); }}
                          disabled={!(selectedRecommendation || selectedAction || selectedCategory)}
                          title="推奨・改善・類型の絞り込みを解除"
                          className="h-auto shrink-0 px-1 text-[11px] font-normal text-mirai-text-muted hover:bg-transparent hover:text-mirai-text-secondary disabled:opacity-30"
                        >
                          ✕ 解除
                        </Button>
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
                      <span className="text-mirai-text-muted whitespace-nowrap mr-0.5 cursor-help underline decoration-dotted decoration-mirai-border underline-offset-2">{label}</span>
                      <RangeStepInput
                        value={amountFilters[key].min} width={50} placeholder="下限" title="下限 (例: 100億, 1兆)"
                        onStep={stepAmount}
                        onChange={v => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], min: v } }))}
                      />
                      <span className="text-mirai-text-muted mx-px">~</span>
                      <RangeStepInput
                        value={amountFilters[key].max} width={50} placeholder="上限" title="上限 (例: 1兆, 5000億)"
                        onStep={stepAmount}
                        onChange={v => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], max: v } }))}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setAmountFilters(prev => ({ ...prev, [key]: { min: '', max: '' } }))}
                        disabled={!(amountFilters[key].min || amountFilters[key].max)}
                        aria-label={`${label}の範囲を解除`}
                        className={CLEAR_BTN_CLS}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                      <div className="flex items-center shrink-0" title={COL_DESC.継続年数}>
                        <span className="text-mirai-text-muted whitespace-nowrap mr-0.5 cursor-help underline decoration-dotted decoration-mirai-border underline-offset-2">年数</span>
                        <RangeStepInput
                          value={yearsFilter.min} width={50} placeholder="下限" title="下限（年）"
                          onStep={(c, d) => stepScore(c, d, 110, 5)}
                          onChange={v => setYearsFilter(prev => ({ ...prev, min: v }))}
                        />
                        <span className="text-mirai-text-muted mx-px">~</span>
                        <RangeStepInput
                          value={yearsFilter.max} width={50} placeholder="上限" title="上限（年）"
                          onStep={(c, d) => stepScore(c, d, 110, 5)}
                          onChange={v => setYearsFilter(prev => ({ ...prev, max: v }))}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setYearsFilter({ min: '', max: '' })}
                          disabled={!(yearsFilter.min || yearsFilter.max)}
                          aria-label="年数の範囲を解除"
                          className={CLEAR_BTN_CLS}
                        >
                          ✕
                        </Button>
                      </div>
                      {/* 指標の説明。足きり行は6組で最も詰まるので、余裕のある金額行の末尾に置く */}
                      {/* 指標の説明なので、指標そのものが並ぶこの行の末尾に置く */}
                      <Button
                        variant="link"
                        onClick={() => setShowGuide(v => !v)}
                        className="ml-auto shrink-0 whitespace-nowrap text-[11px] font-normal no-underline hover:underline hover:text-primary-accent"
                      >
                        {showGuide ? '▲ 読み方を閉じる' : '▼ 指標の読み方'}
                      </Button>
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
                            <span className="text-mirai-text-muted whitespace-nowrap mr-0.5 cursor-help underline decoration-dotted decoration-mirai-border underline-offset-2">{label}</span>
                            <RangeStepInput
                              value={scoreFilters[key].min} width={50} placeholder="下限" title="下限 (0-100)"
                              onStep={(c, d) => stepScore(c, d)}
                              onChange={v => setScoreFilters(prev => ({ ...prev, [key]: { ...prev[key], min: v } }))}
                            />
                            <span className="text-mirai-text-muted mx-px">~</span>
                            <RangeStepInput
                              value={scoreFilters[key].max} width={50} placeholder="上限" title="上限 (0-100)"
                              onStep={(c, d) => stepScore(c, d)}
                              onChange={v => setScoreFilters(prev => ({ ...prev, [key]: { ...prev[key], max: v } }))}
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setScoreFilters(prev => ({ ...prev, [key]: { min: '', max: '' } }))}
                              disabled={!(scoreFilters[key].min || scoreFilters[key].max)}
                              aria-label={`${label}の範囲を解除`}
                              className={CLEAR_BTN_CLS}
                            >
                              ✕
                            </Button>
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
        <p className="absolute left-4 right-4 top-full z-20 -mt-1 rounded-xl border border-mirai-border bg-card px-4 py-3 shadow-soft text-[11px] leading-5 text-mirai-text-subtle">
        <span className="font-bold">政策評価</span>は「誰のどんな課題を、どの活動で、どう改善するか」がどれだけ明確に説明され、
        その成果を検証できる状態かどうか。
        <span className="font-bold">執行透明性</span>は支出先が特定できるか・使途を説明できるか（支出先の明確さ55＋使途の説明45）。
        「収支の一致」は9割の事業が満点でほぼ定数だったため加重平均から外し、不一致（60点未満）だけをフラグとして拾っています。
        <span className="font-bold">総合点</span>は政策評価と執行透明性を統合した値です。
        推奨は絶対点ではなく<span className="font-bold">母集団内の順位帯</span>で切っています（総合点は中央に強く偏るため、絶対値では下位帯が空になる）。
        「<span className="font-bold">縮小</span>」は事業の優劣ではなく<span className="font-bold">不用額</span>（予算と執行の乖離）に基づく計上額の見直しで、総合点には影響しません
        — 不用額の返納は適切な行動であり、減点すると使い切りを誘発するためです。
        単年度の不用は入札差金でも生じるため、縮小は<span className="font-bold">2年連続で不用率が上位帯</span>にある事業に限定し（一覧に「2年連続の不用」を表示）、
        単年度のみ・前年度実績が無い事業は要改善（差異理由の説明）にとどめています。
        逆に予算をほぼ消化していても支出先が不透明な事業は「継続」とせず要改善として拾います。
        「終了・廃止候補」は結論ではなく政党レビューへ送るためのスクリーニング結果です。
        判断（推奨）と改善（改善アクション）は分離して表示しています。
        </p>
        )}
      </div>

      {/* Table */}
      <div className="shrink-0 space-y-2 px-3 pb-3 sm:hidden">
        <input aria-label="事業を検索" placeholder="事業名・PIDで検索" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full rounded-lg border border-mirai-border bg-card p-2 text-sm" />
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="mobile-quality-sort">並び順</label>
          <select id="mobile-quality-sort" value={sortField} onChange={e => handleSort(e.target.value as SortField)} className="min-w-0 flex-1 rounded border border-mirai-border bg-card p-2">
            <option value="spendNetTotal">実質支出額</option><option value="budgetAmount">予算額</option><option value="overallScore">総合点</option><option value="recommendation">推奨</option><option value="name">事業名</option><option value="pid">PID</option>
          </select>
          <Button variant="outline" size="xs" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>{sortDir === 'asc' ? '昇順' : '降順'}</Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col w-full px-3 pb-4">
        {/*
          外枠（枠線・角丸）と、スクロールする内箱を分ける。
          ページャを枠の中のフッタとして固定したいので、枠自体はスクロールさせない。
          内箱を縦にもスクロールさせるのは thead の sticky を効かせるため。overflow-x だけだと
          overflow-y が auto に計算され、高さ制限の無い箱が縦のスクロールコンテナになってしまう。
        */}
        <div className="flex-1 min-h-0 rounded-xl border border-mirai-border bg-card shadow-xs overflow-hidden flex flex-col">
        <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
          <MobileQualityList items={pageItems} policies={policyByPid} requestYear={isRequestYear} onOpen={openDetail} />
          {/* table-fixed + colgroup: ソートで中身が変わっても列幅が動かないようにする */}
          <table className="hidden w-full text-xs table-fixed min-w-[1754px] sm:table">
            <colgroup>
              {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead className="bg-mirai-surface text-mirai-text-subtle sticky top-0 z-10">
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
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap bg-mirai-surface-teal" title={COL_DESC.総合点} onClick={() => handleSort('overallScore')}>
                  総合点<SortIcon field="overallScore" />
                </th>
                {AXIS_META.map(a => (
                  <th
                    key={a.key}
                    className="px-2 py-2 text-right cursor-pointer whitespace-nowrap bg-mirai-surface-teal"
                    title={`${a.label}（総合点への重み ${a.weight}）

${a.desc}`}
                    onClick={() => handleSort(a.key)}
                  >
                    {a.label}<SortIcon field={a.key} />
                  </th>
                ))}
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap bg-mirai-surface-teal" title={COL_DESC.推奨} onClick={() => handleSort('recommendation')}>
                  推奨<SortIcon field="recommendation" />
                </th>
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap bg-mirai-surface-teal" title={COL_DESC.改善アクション} onClick={() => handleSort('improvementAction')}>
                  改善アクション<SortIcon field="improvementAction" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.継続年数} onClick={() => handleSort('yearsRunning')}>
                  継続年数<SortIcon field="yearsRunning" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.予算額} onClick={() => handleSort('budgetAmount')}>
                  {isRequestYear ? '予算額（要求）' : '予算額'}<SortIcon field="budgetAmount" />
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
            <tbody className="divide-y divide-border">
              {pageItems.map(item => {
                const policy = policyByPid?.get(item.pid);
                return (
                <React.Fragment key={item.pid}>
                  <tr
                    className="hover:bg-mirai-surface-teal/60 cursor-pointer transition-colors"
                    onClick={() => setExpandedRow(expandedRow === item.pid ? null : item.pid)}
                  >
                    <td className="px-2 py-1.5 font-mono text-mirai-text-muted">{item.pid}</td>
                    <td className="px-2 py-1.5 text-mirai-text truncate" title={item.name}>
                      {item.name}
                    </td>
                    <td className="px-2 py-1.5 text-mirai-text-subtle truncate" title={item.ministry}>{item.ministry}</td>
                    <td className="px-2 py-1.5 text-mirai-text-subtle truncate" title={item.bureau || undefined}>{item.bureau || '-'}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={e => { e.stopPropagation(); openDetail(item.pid); }}
                        className="h-6 border-primary px-2 text-[11px] font-medium text-primary-accent shadow-none hover:bg-mirai-surface-teal/60"
                        title="支出先一覧・スコア計算根拠を表示"
                      >
                        詳細
                      </Button>
                    </td>
                    <td className="px-2 py-1.5 text-right bg-mirai-surface-teal/40">
                      {policy?.overallScore != null
                        ? <span className={`font-bold font-mono ${scoreColor(policy.overallScore)}`}>{policy.overallScore}</span>
                        : <span className="text-mirai-text-placeholder">—</span>}
                    </td>
                    {AXIS_META.map(a => {
                      const v = policy?.[a.key];
                      return (
                        <td key={a.key} className="px-2 py-1.5 text-right whitespace-nowrap bg-mirai-surface-teal/40">
                          {v != null
                            ? <span className={`font-mono ${scoreColor(v)}`}>{v}</span>
                            : <span className="text-mirai-text-placeholder" title="未評価（総合点では重みごと除外）">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 bg-mirai-surface-teal/40">
                      {policy
                        ? <><RecommendationBadge policy={policy} /><PersistentUnusedMark policy={policy} /></>
                        : <span className="text-mirai-text-placeholder">—</span>}
                    </td>
                    <td className="px-2 py-1.5 bg-mirai-surface-teal/40">
                      {policy?.improvementAction
                        ? <ActionBadge action={policy.improvementAction} />
                        : <span className="text-mirai-text-placeholder">—</span>}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right font-mono text-mirai-text-subtle whitespace-nowrap"
                      title={item.startYear ? `${item.startYear}年度開始 / ${item.noEndDate ? '終了予定なし' : (item.endYear ? `${item.endYear}年度終了予定` : '終了年度未設定')}` : '開始年度の登録なし'}
                    >
                      {item.yearsRunning != null
                        ? <><span className={item.yearsRunning >= 20 ? 'text-orange-600 font-bold' : ''}>{item.yearsRunning}</span>
                            {item.noEndDate && <span className="text-mirai-text-muted ml-0.5">★</span>}</>
                        : <span className="text-mirai-text-placeholder">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-mirai-text-subtle whitespace-nowrap">
                      {item.budgetAmount ? formatAmount(item.budgetAmount) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-mirai-text-subtle whitespace-nowrap">
                      {item.execAmount ? formatAmount(item.execAmount ?? 0) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-mirai-text-subtle whitespace-nowrap">
                      {item.spendTotal ? formatAmount(item.spendTotal) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-mirai-text-subtle whitespace-nowrap">
                      {item.spendNetTotal ? formatAmount(item.spendNetTotal) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-mirai-text-subtle whitespace-nowrap">
                      {item.redelegationDepth || '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-mirai-text-muted">{item.recipientCount ?? item.rowCount}</td>
                  </tr>
                  {expandedRow === item.pid && (
                    <tr className="bg-mirai-surface-gray">
                      <td colSpan={19} className="px-4 py-3">
                        <div className="mb-2 text-mirai-text">{item.name}</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
                          <div>
                            <h4 className="font-bold text-mirai-text-secondary mb-1">
                              政策評価
                              {policy?.policyCategoryLabel && (
                                <span className="ml-1 font-normal text-mirai-text-muted">{policy.policyCategoryLabel}</span>
                              )}
                            </h4>
                            <div className="space-y-0.5 text-mirai-text-subtle">
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
                            <h4 className="font-bold text-mirai-text-secondary mb-1">執行透明性</h4>
                            <div className="space-y-0.5 text-mirai-text-subtle">
                              <div className="font-mono">{policy?.executionTransparency ?? '—'}点</div>
                              <div>支出先の明確さ: {item.axisIdentify != null ? item.axisIdentify.toFixed(0) : '—'}</div>
                              <div>使途の説明: {item.axisPurpose != null ? item.axisPurpose.toFixed(0) : '—'}</div>
                              <div className="text-mirai-text-muted">収支の一致: {item.axisBudget != null ? item.axisBudget.toFixed(0) : '—'}（不算入・不一致フラグ）</div>
                              <div>法人番号記入: {item.cnFilled} / 未記入: {item.cnEmpty}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-bold text-mirai-text-secondary mb-1">
                              予算と執行
                              <span className="ml-1 font-normal text-mirai-text-muted">（総合点に不算入）</span>
                            </h4>
                            <div className="space-y-0.5 text-mirai-text-subtle">
                              <div>予算額: {formatAmount(item.budgetAmount)}</div>
                              <div>執行額: {formatAmount(item.execAmount ?? 0)}</div>
                              {policy?.executionRate != null ? (
                                <>
                                  <div>執行率: {Math.round(policy.executionRate * 100)}%</div>
                                  <div>不用額: {policy.unusedAmount ? formatAmount(policy.unusedAmount) : '0'}
                                    {policy.unusedRatio != null && `（${Math.round(policy.unusedRatio * 100)}%）`}</div>
                                </>
                              ) : (
                                <div className="text-mirai-text-muted">執行実績なし（評価対象外）</div>
                              )}
                              <div>
                                前年度: {policy?.priorExecutionRate != null
                                  ? `執行率 ${Math.round(policy.priorExecutionRate * 100)}%・不用率 ${Math.round((policy.priorUnusedRatio ?? 0) * 100)}%`
                                  : <span className="text-mirai-text-muted">実績なし（判定不能）</span>}
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
                            <h4 className="font-bold text-mirai-text-secondary mb-1">推奨と改善</h4>
                            <div className="space-y-1 text-mirai-text-subtle">
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
                            <h4 className="font-bold text-mirai-text-secondary mb-1">組織・支出構造</h4>
                            <div className="space-y-0.5 text-mirai-text-subtle">
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
              <div className="text-sm text-mirai-text-muted">条件に合う事業がありません</div>
              <div className="mt-1 text-xs text-mirai-text-muted">絞り込みを緩めるか、解除してください</div>
              <Button
                variant="outline"
                size="sm"
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
                className="mt-3 border-mirai-border text-xs text-mirai-text-subtle"
              >
                すべての絞り込みを解除
              </Button>
            </div>
          )}
        </div>

        {/* ページャは表の枠内フッタ。表とページ番号が離れて見えないようにする */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 shrink-0 border-t border-mirai-border bg-mirai-surface-gray">
            <Button
              variant="outline"
              size="xs"
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="border-mirai-border font-medium"
            >
              前へ
            </Button>
            <span className="text-xs text-mirai-text-muted font-mono">
              {page} / {totalPages}
              <span className="ml-2 text-mirai-text-muted">
                {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–
                {Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} 件目
              </span>
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="border-mirai-border font-medium"
            >
              次へ
            </Button>
          </div>
        )}
        </div>
      </div>
      </>)}
    </div>
  );
}
