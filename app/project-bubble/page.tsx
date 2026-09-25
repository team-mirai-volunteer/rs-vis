'use client';

import { fiscalYear, fiscalYearLabel, sheetYearFromParams } from '@/app/lib/rs-fiscal-year';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BubbleCanvas } from '@/client/components/ProjectMap/BubbleCanvas';
import { ProjectDetailPanel } from '@/client/components/ProjectMap/ProjectDetailPanel';
import { MultiSelectDropdown } from '@/components/filters/MultiSelectDropdown';
import { AppHeader } from '@/components/navigation/AppHeader';
import { YearSelect } from '@/components/navigation/YearSelect';
import {
  COLOR_MODE_LABELS, SIZE_METRIC_LABELS, SPENDING_COLORS,
  buildColorLookup, buildLegend, buildSizeScale, categoryLabel, spendingColor, spendingStepLabel,
  formatYenShort, legendKeyOf as resolveLegendKey,
  type ColorMode, type LegendEntry, type SizeMetric,
} from '@/app/lib/project-map-view';
import { PLACEHOLDER_KIND_LABELS } from '@/app/lib/project-map-spending';
import type {
  PlaceholderKind, ProjectMapCluster, ProjectMapPoint, ProjectMapResponse,
  ProjectMapSpendingRecipient, ProjectMapSpendingResponse,
} from '@/types/project-map';
import { RecipientContractSummary } from '@/client/components/RecipientContractSummary';

type Year = '2024' | '2025';
const YEARS: Year[] = ['2025', '2024'];

/** ビュー。map = 事業バブルのみ / spending = 支出先を重畳し、支出先経由で事業同士を結ぶ */
type View = 'map' | 'spending';
const VIEW_LABELS: Record<View, string> = { map: '事業マップ', spending: '支出つながり' };

/** 支出つながりで描く支出先の件数（金額の大きい順）。0 = すべて */
const SPEND_LIMITS = [100, 300, 1000, 3000, 0] as const;
type SpendLimit = typeof SPEND_LIMITS[number];
const DEFAULT_SPEND_LIMIT: SpendLimit = 1000;
/** 支出元の事業数の下限。1 = 1事業だけの大口も出す / 2以上 = 事業同士を結ぶ支出先だけ */
const SPEND_MIN_DEGREES = [1, 2, 3, 5, 10] as const;
type SpendMinDegree = typeof SPEND_MIN_DEGREES[number];
const DEFAULT_SPEND_MIN_DEGREE: SpendMinDegree = 1;
/**
 * 描く支出先の種類。named = 実名の支出先（既定） / placeholder = 匿名・集約表記すべて /
 * PlaceholderKind = その種類だけ。匿名・集約表記は「支出先を具体的に書いていない事業」の洗い出し用
 */
type SpendKind = 'named' | 'placeholder' | PlaceholderKind;
const SPEND_KINDS: SpendKind[] = ['named', 'placeholder', 'aggregate', 'person', 'masked', 'undisclosed'];
const SPEND_KIND_LABELS: Record<SpendKind, string> = {
  named: '実名の支出先',
  placeholder: '匿名・集約表記（すべて）',
  aggregate: `匿名・集約：${PLACEHOLDER_KIND_LABELS.aggregate}`,
  person: `匿名・集約：${PLACEHOLDER_KIND_LABELS.person}`,
  masked: `匿名・集約：${PLACEHOLDER_KIND_LABELS.masked}`,
  undisclosed: `匿名・集約：${PLACEHOLDER_KIND_LABELS.undisclosed}`,
};
/** URL の sk の値。named は既定なので載せない */
const SPEND_KIND_URL: Record<SpendKind, string> = {
  named: '', placeholder: 'ph', aggregate: 'ag', person: 'pe', masked: 'ms', undisclosed: 'un',
};

/** 大きさの上限（画面px）。衝突回避で重なりを解くぶん、以前より大きくできる */
const MAX_RADIUS = 12;

/**
 * 配色は常にライト。デザインシステム適用で html { color-scheme: light } に固定したため、
 * 以前あった prefers-color-scheme 連動のダーク地色は使わない（BubbleCanvas / buildLegend の
 * 引数は互換のため残している）。
 */
const DARK = false;

export default function ProjectMapPage() {
  const [year, setYear] = useState<Year>('2025');
  const [data, setData] = useState<ProjectMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notGenerated, setNotGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 支出つながりビュー。データは切り替えたときに初めて取りに行く
  const [view, setView] = useState<View>('map');
  const [spendData, setSpendData] = useState<ProjectMapSpendingResponse | null>(null);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [spendLimit, setSpendLimit] = useState<SpendLimit>(DEFAULT_SPEND_LIMIT);
  const [spendMinDegree, setSpendMinDegree] = useState<SpendMinDegree>(DEFAULT_SPEND_MIN_DEGREE);
  const [spendQuery, setSpendQuery] = useState('');
  const [spendKind, setSpendKind] = useState<SpendKind>('named');
  const [hoverRecipient, setHoverRecipient] = useState<
    { r: ProjectMapSpendingRecipient; x: number; y: number } | null
  >(null);
  const [lockedRecipientId, setLockedRecipientId] = useState<string | null>(null);

  // 表示の切り替え
  const [colorMode, setColorMode] = useState<ColorMode>('ministry');
  const [sizeMetric, setSizeMetric] = useState<SizeMetric>('inverseScore');
  const [showClusterLabels, setShowClusterLabels] = useState(true);
  const [showRegions, setShowRegions] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /** sm 未満で左の絞り込み列（ボトムシート）を開いているか。既定は閉（図を広く見せる） */
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  // 絞り込み
  const [ministries, setMinistries] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [scoreFilter, setScoreFilter] = useState({ min: '', max: '' });
  const [yearsFilter, setYearsFilter] = useState({ min: '', max: '' });
  const [budgetFilter, setBudgetFilter] = useState({ min: '', max: '' });
  const [query, setQuery] = useState('');

  // 対話状態
  const [hover, setHover] = useState<{ p: ProjectMapPoint; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<ProjectMapPoint | null>(null);
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const [legendLock, setLegendLock] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);

  // ── URL同期（/sankey-svg と同じ流儀: 短いキー・既定値は省略・replaceState） ──
  // 面白い画面を見つけたとき、URLを渡せば同じ状態が再現できるようにする。
  // 初期表示は URL → state の一方向、以後は state → URL の一方向。
  const [urlHydrated, setUrlHydrated] = useState(false);
  /** URLで指定された選択事業・強調区分。データ到着後に解決する */
  const pendingPidRef = useRef<string | null>(null);
  const pendingHlRef = useRef<string | null>(null);
  const pendingRcRef = useRef<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setYear(sheetYearFromParams(p, 'yr') as Year);
    if (p.get('v') === 'sp') setView('spending');
    const sn = Number(p.get('sn'));
    if (p.has('sn') && (SPEND_LIMITS as readonly number[]).includes(sn)) setSpendLimit(sn as SpendLimit);
    const sd = Number(p.get('sd'));
    if ((SPEND_MIN_DEGREES as readonly number[]).includes(sd)) setSpendMinDegree(sd as SpendMinDegree);
    const sq = p.get('sq'); if (sq !== null) setSpendQuery(sq);
    const sk = SPEND_KINDS.find(k => k !== 'named' && SPEND_KIND_URL[k] === p.get('sk'));
    if (sk) setSpendKind(sk);
    const c = p.get('c'); if (c === 'ministry' || c === 'policyGroup' || c === 'recommendation') setColorMode(c);
    const s = p.get('s');
    if (s === 'inverseScore' || s === 'inverseProp' || s === 'inverseNec'
      || s === 'budget' || s === 'exec' || s === 'years' || s === 'uniform') setSizeMetric(s);
    if (p.get('rg') === '0') setShowRegions(false);
    if (p.get('cl') === '0') setShowClusterLabels(false);
    if (p.get('tb') === '1') setShowTable(true);
    const m = p.getAll('m'); if (m.length > 0) setMinistries(m);
    const r = p.getAll('r'); if (r.length > 0) setRecommendations(r);
    // 範囲は "下限-上限"（片側は空欄可）。値は非負数なので '-' 区切りで曖昧にならない
    const range = (key: string): { min: string; max: string } | null => {
      const v = p.get(key);
      if (v === null) return null;
      const [min = '', max = ''] = v.split('-');
      return { min, max };
    };
    const sc = range('sc'); if (sc) setScoreFilter(sc);
    const yn = range('yn'); if (yn) setYearsFilter(yn);
    const bd = range('bd'); if (bd) setBudgetFilter(bd);
    const q = p.get('q'); if (q !== null) setQuery(q);
    // 強調と選択は、年度フェッチ側のリセットに消されないようデータ到着後に適用する
    pendingHlRef.current = p.get('hl');
    pendingPidRef.current = p.get('pid');
    pendingRcRef.current = p.get('rc');
    setUrlHydrated(true);
  }, []);

  useEffect(() => {
    if (!urlHydrated) return;
    const p = new URLSearchParams();
    p.set('fiscalYear', String(fiscalYear(year)));
    if (view === 'spending') {
      p.set('v', 'sp');
      if (spendLimit !== DEFAULT_SPEND_LIMIT) p.set('sn', String(spendLimit));
      if (spendMinDegree !== DEFAULT_SPEND_MIN_DEGREE) p.set('sd', String(spendMinDegree));
      if (spendQuery) p.set('sq', spendQuery);
      if (spendKind !== 'named') p.set('sk', SPEND_KIND_URL[spendKind]);
      if (lockedRecipientId) p.set('rc', lockedRecipientId);
    }
    if (colorMode !== 'ministry') p.set('c', colorMode);
    if (sizeMetric !== 'inverseScore') p.set('s', sizeMetric);
    if (!showRegions) p.set('rg', '0');
    if (!showClusterLabels) p.set('cl', '0');
    if (showTable) p.set('tb', '1');
    for (const m of ministries) p.append('m', m);
    for (const r of recommendations) p.append('r', r);
    const range = (key: string, f: { min: string; max: string }) => {
      if (f.min || f.max) p.set(key, `${f.min}-${f.max}`);
    };
    range('sc', scoreFilter);
    range('yn', yearsFilter);
    range('bd', budgetFilter);
    if (query) p.set('q', query);
    if (legendLock) p.set('hl', legendLock);
    if (selected) p.set('pid', selected.pid);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [urlHydrated, year, view, spendLimit, spendMinDegree, spendQuery, spendKind, lockedRecipientId, colorMode, sizeMetric, showRegions, showClusterLabels, showTable,
      ministries, recommendations, scoreFilter, yearsFilter, budgetFilter, query, legendLock, selected]);

  // URLの pid / hl はデータが来てから解決する（pid は点オブジェクトが要り、
  // hl は年度フェッチ側のリセットより後に適用する必要がある）
  useEffect(() => {
    if (!data) return;
    const pid = pendingPidRef.current;
    const hl = pendingHlRef.current;
    pendingPidRef.current = null;
    pendingHlRef.current = null;
    if (pid) {
      const p = data.points.find(pt => pt.pid === pid);
      if (p) setSelected(p);
    }
    if (hl) setLegendLock(hl);
  }, [data]);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    setNotGenerated(false);
    setSelected(null);
    setLegendLock(null);
    setSpendData(null);
    setSpendError(null);
    setLockedRecipientId(null);
    fetch(`/api/project-map?year=${year}`)
      .then(async res => {
        if (res.status === 404) { setNotGenerated(true); return null; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ProjectMapResponse>;
      })
      .then(json => { if (json) setData(json); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [year]);

  // 支出つながりは初めて切り替えたときに取る。年度が変わったら上の effect が捨てる
  useEffect(() => {
    if (view !== 'spending' || spendData || spendError || !data) return;
    let cancelled = false;
    fetch(`/api/project-map/spending?year=${year}`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ProjectMapSpendingResponse>;
      })
      .then(json => {
        if (cancelled) return;
        setSpendData(json);
        // URL の rc は、支出先データが来てから（存在するものだけ）適用する
        const rc = pendingRcRef.current;
        pendingRcRef.current = null;
        if (rc && [...json.recipients, ...json.placeholders].some(r => r.id === rc)) setLockedRecipientId(rc);
      })
      .catch(e => { if (!cancelled) setSpendError(String(e)); });
    return () => { cancelled = true; };
  }, [view, year, data, spendData, spendError]);

  // 空配列を毎レンダー作り直すと、下流の useMemo が全部無効化されて5,794点を毎回引き直す
  const EMPTY: ProjectMapPoint[] = useMemo(() => [], []);
  const allPoints = data?.points ?? EMPTY;

  // 凡例は常に全件から作る。絞り込んでも色が入れ替わらないようにするため
  const legend = useMemo(
    () => buildLegend(allPoints, colorMode, DARK),
    [allPoints, colorMode],
  );
  const colorLookup = useMemo(() => buildColorLookup(legend), [legend]);
  const colorOf = useCallback(
    (p: ProjectMapPoint) => colorLookup(resolveLegendKey(p, colorMode, legend)),
    [colorLookup, colorMode, legend],
  );
  const legendKeyOf = useCallback(
    (p: ProjectMapPoint) => resolveLegendKey(p, colorMode, legend),
    [colorMode, legend],
  );

  // 勢力圏は点の塗り分けとは独立に、常に府省庁で塗る。
  // 「色=推奨判断」のときに背景の色面が省庁を教える、というのがこのレイヤの役目
  const ministryLegend = useMemo(
    () => buildLegend(allPoints, 'ministry', DARK),
    [allPoints],
  );
  const regionEntries = useMemo(
    () => ministryLegend.filter(e => !e.isOther).map(e => ({ key: e.key, label: e.label, color: e.color })),
    [ministryLegend],
  );
  const regionKeyOf = useCallback(
    (p: ProjectMapPoint) => {
      // Set を毎回作らないよう、entries が小さい(≤12)ので線形で引く
      for (const e of regionEntries) if (e.key === p.ministry) return p.ministry;
      return null;
    },
    [regionEntries],
  );

  const ministryOptions = useMemo(
    () => (data?.summary.ministries ?? []).map(m => m.name),
    [data],
  );
  const recommendationOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const p of allPoints) if (p.rec) seen.add(p.rec);
    const order = ['継続', '要改善', '条件付き継続', '縮小', '他事業と統合', '再設計', '終了・廃止候補'];
    return order.filter(r => seen.has(r));
  }, [allPoints]);

  const filtered = useMemo(() => {
    let items = allPoints;
    if (ministries.length > 0) {
      const set = new Set(ministries);
      items = items.filter(p => set.has(p.ministry));
    }
    if (recommendations.length > 0) {
      const set = new Set(recommendations);
      items = items.filter(p => p.rec !== null && set.has(p.rec));
    }
    const range = (
      list: ProjectMapPoint[],
      f: { min: string; max: string },
      get: (p: ProjectMapPoint) => number | null,
      scale = 1,
    ) => {
      const lo = f.min.trim() === '' ? null : Number(f.min) * scale;
      const hi = f.max.trim() === '' ? null : Number(f.max) * scale;
      if (lo === null && hi === null) return list;
      return list.filter(p => {
        const v = get(p);
        if (v === null) return false;   // 未評価は範囲指定時に落とす（0扱いにはしない）
        if (lo !== null && !Number.isNaN(lo) && v < lo) return false;
        if (hi !== null && !Number.isNaN(hi) && v > hi) return false;
        return true;
      });
    };
    items = range(items, scoreFilter, p => p.score);
    items = range(items, yearsFilter, p => p.years);
    items = range(items, budgetFilter, p => p.budget, 1e8);   // 入力は億円単位

    if (query.trim()) {
      const normalize = (s: string) => s.replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
      const q = normalize(query.trim());
      items = items.filter(p => normalize(p.name).includes(q) || p.pid.includes(q));
    }
    return items;
  }, [allPoints, ministries, recommendations, scoreFilter, yearsFilter, budgetFilter, query]);

  // 大きさのスケールは全件で決める。絞り込むたびに同じ事業の大きさが変わると比較できない
  const sizeScale = useMemo(
    () => buildSizeScale(allPoints, sizeMetric, MAX_RADIUS),
    [allPoints, sizeMetric],
  );

  const clusterById = useMemo(
    () => new Map((data?.clusters ?? []).map(c => [c.id, c])),
    [data],
  );

  const clusterLabel = useCallback(
    (c: ProjectMapCluster) => c.terms[0] ?? categoryLabel(c.dominantCategory),
    [],
  );

  const isSpending = view === 'spending';
  const filteredPids = useMemo(() => new Set(filtered.map(p => p.pid)), [filtered]);
  // 支出つながりでは事業の塗り分けは「注目中の事業」に使うので、凡例の強調は効かせない
  const highlightKey = isSpending ? null : (legendLock ?? legendHover);

  const pointByPid = useMemo(() => new Map(allPoints.map(p => [p.pid, p])), [allPoints]);

  /** 種類で選んだ支出先の母集団（金額の大きい順） */
  const spendSource = useMemo(() => {
    if (!spendData) return [];
    if (spendKind === 'named') return spendData.recipients;
    if (spendKind === 'placeholder') return spendData.placeholders;
    return spendData.placeholders.filter(r => r.kind === spendKind);
  }, [spendData, spendKind]);
  const isPlaceholderKind = spendKind !== 'named';

  /**
   * 描く支出先。絞り込み後の事業に下限件数以上繋がり、名前が検索語を含むものから、
   * 金額の大きい順に上限件数まで。上限を全体の順位で先に切ると、
   * 府省庁で絞ったときに線がほとんど残らないため後で切る
   */
  const { visibleRecipients, matchedRecipients } = useMemo(() => {
    if (!spendData) return { visibleRecipients: [], matchedRecipients: 0 };
    const visible = filteredPids;
    const normalize = (t: string) => t.replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
    const q = normalize(spendQuery.trim());
    const out: ProjectMapSpendingRecipient[] = [];
    let matched = 0;
    for (const r of spendSource) {
      let n = 0;
      for (const pid of r.pids) if (visible.has(pid) && ++n >= spendMinDegree) break;
      if (n < spendMinDegree) continue;
      if (q && !normalize(r.name).includes(q)) continue;
      matched++;
      if (spendLimit !== 0 && out.length >= spendLimit) continue;
      out.push(r);
    }
    // 固定中の支出先は上限の外でも描く（URL から来た場合・上限を下げた場合）
    if (lockedRecipientId && !out.some(r => r.id === lockedRecipientId)) {
      const locked = spendSource.find(r => r.id === lockedRecipientId);
      if (locked) out.push(locked);
    }
    return { visibleRecipients: out, matchedRecipients: matched };
  }, [spendData, spendSource, filteredPids, spendLimit, spendMinDegree, spendQuery, lockedRecipientId]);

  const recipientById = useMemo(
    () => new Map([...(spendData?.recipients ?? []), ...(spendData?.placeholders ?? [])].map(r => [r.id, r])),
    [spendData],
  );
  const lockedRecipient = lockedRecipientId ? recipientById.get(lockedRecipientId) ?? null : null;

  /** pid → その事業が支払っている支出先（選んだ種類のみ・金額の大きい順）。選択事業のパネル用 */
  const recipientsByPid = useMemo(() => {
    const m = new Map<string, Array<{ r: ProjectMapSpendingRecipient; amount: number }>>();
    for (const r of spendSource) {
      r.pids.forEach((pid, k) => {
        const list = m.get(pid);
        const item = { r, amount: r.amounts[k] };
        if (list) list.push(item); else m.set(pid, [item]);
      });
    }
    for (const list of m.values()) list.sort((a, b) => b.amount - a.amount);
    return m;
  }, [spendSource]);

  /**
   * 匿名・集約表記への支出が多い事業（絞り込み後の事業のみ）。
   * 割合の分母はその事業の支出先への支出の合計（実名＋匿名・集約）
   */
  const placeholderRanking = useMemo(() => {
    if (!spendData || !isPlaceholderKind) return [];
    const byPid = new Map<string, number>();
    for (const r of spendSource) {
      r.pids.forEach((pid, k) => {
        if (filteredPids.has(pid)) byPid.set(pid, (byPid.get(pid) ?? 0) + r.amounts[k]);
      });
    }
    const out: PlaceholderRankRow[] = [];
    for (const [pid, amount] of byPid) {
      const p = pointByPid.get(pid);
      if (!p) continue;
      const total = spendData.projectSpending[pid] ?? amount;
      out.push({ point: p, amount, share: total > 0 ? amount / total : 0 });
    }
    return out;
  }, [spendData, isPlaceholderKind, spendSource, filteredPids, pointByPid]);

  const spendingOverlay = useMemo(() => (isSpending && spendData ? {
    recipients: visibleRecipients,
    focusRecipientId: hoverRecipient?.r.id ?? lockedRecipientId,
    emphasizeAll: spendQuery.trim() !== '',
    selectedOnly: isPlaceholderKind,
    onHoverRecipient: (r: ProjectMapSpendingRecipient | null, sc: { x: number; y: number } | null) =>
      setHoverRecipient(r && sc ? { r, x: sc.x, y: sc.y } : null),
    onSelectRecipient: (r: ProjectMapSpendingRecipient) =>
      setLockedRecipientId(id => (id === r.id ? null : r.id)),
  } : null), [isSpending, spendData, visibleRecipients, hoverRecipient, lockedRecipientId, spendQuery, isPlaceholderKind]);

  /** 事業の選択。支出つながりでは事業を選び直したら支出先の固定を外す（注目の主語を事業に戻す） */
  const selectPoint = useCallback((p: ProjectMapPoint | null) => {
    setSelected(p);
    setLockedRecipientId(null);
  }, []);

  const changeSpendKind = (k: SpendKind) => {
    setSpendKind(k);
    setHoverRecipient(null);
    setLockedRecipientId(null);
  };

  const changeView = (v: View) => {
    setView(v);
    setHover(null);
    setHoverRecipient(null);
    setLockedRecipientId(null);
  };

  const hasFilter = ministries.length > 0 || recommendations.length > 0 || query.trim() !== ''
    || scoreFilter.min || scoreFilter.max || yearsFilter.min || yearsFilter.max
    || budgetFilter.min || budgetFilter.max;

  const clearFilters = () => {
    setMinistries([]);
    setRecommendations([]);
    setScoreFilter({ min: '', max: '' });
    setYearsFilter({ min: '', max: '' });
    setBudgetFilter({ min: '', max: '' });
    setQuery('');
  };

  return (
    // サンキー図と同じく画面全体を図に使う。UIはすべてフロートで重ねる（ヘッダー分だけ上を空ける）
    <div className="flex h-dvh flex-col bg-background text-mirai-text">
    <AppHeader fiscalYear={fiscalYear(year)} position="static" current="/project-bubble">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setHelpOpen(v => !v)}
        aria-expanded={helpOpen}
        aria-controls="bubble-help"
        className="h-9 shrink-0 border-mirai-border px-2.5 text-xs font-medium text-mirai-text-subtle hover:text-mirai-text"
      >説明</Button>
      <ViewSelect value={view} onChange={changeView} />
      <YearSelect labelForYear={fiscalYearLabel} value={year} onChange={y => setYear(y as Year)} years={YEARS} />
    </AppHeader>
    <div className="relative min-h-0 w-full flex-1 overflow-hidden">
      {/* 視覚上のタイトルは廃止した（フロートUIの面積を図に譲る）。ページ名はメニューと文書タイトルが担う */}
      <h1 className="sr-only">事業バブルチャート</h1>

      {/* ── 全面キャンバス ── */}
      <div ref={wrapRef} className="absolute inset-0">
        {data && !loading && (
          <>
            <BubbleCanvas
              points={filtered}
              bounds={data.bounds}
              clusters={data.clusters}
              clusterLabel={clusterLabel}
              showClusterLabels={showClusterLabels}
              colorOf={colorOf}
              radiusOf={sizeScale.radius}
              legendKeyOf={legendKeyOf}
              highlightKey={highlightKey}
              selectedPid={selected?.pid ?? null}
              onHover={(p, s) => setHover(p && s ? { p, x: s.x, y: s.y } : null)}
              onSelect={selectPoint}
              dark={DARK}
              showRegions={showRegions}
              regionEntries={regionEntries}
              regionKeyOf={regionKeyOf}
              regionPoints={allPoints}
              spending={spendingOverlay}
            />
            {isSpending && hoverRecipient && (
              <RecipientTooltip
                recipient={hoverRecipient.r}
                x={hoverRecipient.x}
                y={hoverRecipient.y}
                visibleCount={hoverRecipient.r.pids.filter(pid => filteredPids.has(pid)).length}
                year={year}
              />
            )}
            {isSpending && !spendData && !spendError && (
              <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-mirai-text-muted shadow-xs">
                支出先を読み込み中…
              </div>
            )}
            {isSpending && spendError && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-destructive shadow-xs">
                支出先の読み込みに失敗しました: {spendError}
              </div>
            )}
            {hover && (
              <Tooltip
                point={hover.p}
                x={hover.x}
                y={hover.y}
                cluster={clusterById.get(hover.p.c)}
                color={colorOf(hover.p)}
              />
            )}
          </>
        )}

        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-mirai-text-muted">
            読み込み中…
          </div>
        )}

        {notGenerated && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-mirai-text-subtle">
            <p className="font-medium">{fiscalYear(year)}年度の事業バブルチャートはまだ生成されていません</p>
            <p className="max-w-md text-xs leading-relaxed text-mirai-text-muted">
              このビューは事業説明文の埋め込みを使うため、年度ごとに座標を生成する必要があります。
              現在は2024年度実績（2025年度レビューシート）のみ生成済みです。
            </p>
            <code className="mt-1 rounded-md bg-mirai-surface px-2.5 py-1.5 text-[11px]">
              python3 scripts/generate-project-map.py --year {year}
            </code>
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            読み込みに失敗しました: {error}
          </div>
        )}
      </div>

      {/* ── 左フロート列: 絞り込み（最上段）＋ 表示切替。幅を絞って中央を図に明け渡す。
             sm 未満ではボトムシート（全幅・高さ 55vh）にして、左上のボタンで開閉する ── */}
      <div
        className={cn(
          'pointer-events-none absolute z-30 flex-col gap-2 overflow-y-auto [&>*]:pointer-events-auto',
          'inset-x-3 bottom-3 max-h-[calc(100dvh-var(--app-header-h)-24px)]',
          'sm:bottom-auto sm:left-3 sm:right-auto sm:top-3 sm:flex sm:max-h-[calc(100%-24px)] sm:w-[360px]',
          selected ? 'xl:grid xl:w-[660px] xl:grid-cols-[268px_384px] xl:items-start xl:overflow-visible' : 'xl:w-[268px]',
          mobilePanelOpen || selected ? 'flex' : 'hidden'
        )}
      >

      {/* 左の操作群は独立して積み、右の詳細の高さでカード間隔が広がらないようにする。 */}
      <div className="contents xl:col-start-1 xl:flex xl:min-w-0 xl:flex-col xl:gap-2">
      {/* 絞り込み。見出しは置かず、検索を先頭にする */}
      {data && !loading && (
          <div className={cn("shrink-0 rounded-xl border border-mirai-border bg-card p-3 text-xs shadow-soft", selected && !mobilePanelOpen && "max-sm:hidden")}>
            <div className="flex flex-col gap-1.5">
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="事業名・事業IDで検索"
                className="h-7 w-full rounded-md border border-mirai-border bg-card px-2 text-xs text-mirai-text placeholder:text-mirai-text-placeholder outline-none transition-colors focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/40"
              />
              <MultiSelectDropdown
                options={ministryOptions}
                selected={ministries}
                onChange={setMinistries}
                allLabel="府省庁"
                placeholder="府省庁：すべて"
                placeholderTone="strong"
                minWidth={240}
              />
              <MultiSelectDropdown
                options={recommendationOptions}
                selected={recommendations}
                onChange={setRecommendations}
                allLabel="推奨判断"
                placeholder="推奨判断：すべて"
                placeholderTone="strong"
                minWidth={240}
              />
              <RangeInput label="総合点" value={scoreFilter} onChange={setScoreFilter} width={58} />
              <RangeInput label="継続年数" value={yearsFilter} onChange={setYearsFilter} width={58} />
              <RangeInput label="予算(億円)" value={budgetFilter} onChange={setBudgetFilter} width={58} />
              <div className="flex items-center justify-between">
                {hasFilter ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={clearFilters}
                    className="h-auto rounded-md px-1.5 py-1 font-normal text-mirai-text-muted hover:bg-mirai-surface hover:text-mirai-text"
                  >
                    ✕ 条件をクリア
                  </Button>
                ) : <span />}
                <span className="tabular-nums text-[11px] text-mirai-text-muted">
                  <strong className="font-bold text-mirai-text-secondary">{filtered.length.toLocaleString('ja-JP')}</strong>
                  {` / ${allPoints.length.toLocaleString('ja-JP')} 事業`}
                </span>
              </div>
            </div>
          </div>
      )}

      <div className="shrink-0 rounded-xl border border-mirai-border bg-card shadow-soft">
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 px-3 py-2 text-xs">
          <span className="text-mirai-text-subtle">色</span>
          <select
            value={colorMode}
            onChange={e => { setColorMode(e.target.value as ColorMode); setLegendLock(null); }}
            className="h-7 w-full cursor-pointer rounded-md border border-mirai-border bg-card px-1.5 text-mirai-text outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40"
            aria-label="色の塗り分け"
          >
            {(Object.keys(COLOR_MODE_LABELS) as ColorMode[]).map(m => (
              <option key={m} value={m}>{COLOR_MODE_LABELS[m]}</option>
            ))}
          </select>
          <span className="text-mirai-text-subtle">大きさ</span>
          <select
            value={sizeMetric}
            onChange={e => setSizeMetric(e.target.value as SizeMetric)}
            className="h-7 w-full cursor-pointer rounded-md border border-mirai-border bg-card px-1.5 text-mirai-text outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40"
            aria-label="バブルの大きさ"
          >
            {(Object.keys(SIZE_METRIC_LABELS) as SizeMetric[]).map(m => (
              <option key={m} value={m}>{SIZE_METRIC_LABELS[m]}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-3 py-2 text-xs">
          <label className="flex cursor-pointer items-center gap-1" title="事業説明文から見た、府省庁が優勢な領域を背景に淡く塗ります">
            <input
              type="checkbox"
              checked={showRegions}
              onChange={e => setShowRegions(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-mirai-text-muted">勢力圏</span>
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={showClusterLabels}
              onChange={e => setShowClusterLabels(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-mirai-text-muted">クラスタ名</span>
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={showTable}
              onChange={e => setShowTable(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-mirai-text-muted">表で見る</span>
          </label>
        </div>

        {/* 大きさの目盛り。選択と同じカードに置き、必ず1行に収める
            （SVGは円の実寸ぶんだけ確保し、余白を作らない） */}
        {sizeScale.ticks.length > 0 && (
          <div className="flex flex-nowrap items-center justify-between overflow-hidden border-t border-border px-3 py-1.5 text-mirai-text-muted">
            {sizeScale.ticks.map(t => (
              <span key={t.label} className="flex items-center gap-0.5 whitespace-nowrap">
                <svg
                  width={Math.ceil(t.radius * 2) + 2}
                  height={Math.ceil(t.radius * 2) + 2}
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <circle
                    cx={t.radius + 1} cy={t.radius + 1} r={t.radius}
                    fill="none" stroke="currentColor" strokeWidth="1"
                  />
                </svg>
                <span className="tabular-nums text-[9px]">{t.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      </div>
      {selected && (
        <ProjectDetailPanel
          key={`${year}-${selected.pid}`}
          point={selected}
          year={year}
          onClose={() => setSelected(null)}
        />
      )}
      </div>

      {/* ── 左上: 絞り込みの開閉（sm 未満のみ。PC では左フロート列が常に出ている） ── */}
      <div className="absolute left-3 top-3 z-40 sm:hidden">
        <Button
          variant="outline"
          size="icon"
          aria-label="絞り込みと表示切替"
          aria-expanded={mobilePanelOpen}
          onClick={() => setMobilePanelOpen(v => !v)}
          className={cn('border-mirai-border', mobilePanelOpen ? 'bg-mirai-surface text-mirai-text' : 'text-mirai-text-subtle')}
        >
          <SlidersHorizontal className="size-[18px]" aria-hidden="true" />
        </Button>
      </div>

      {/* ── ヘッダーの説明ボタンで開くヘルプ ── */}
      <div className="absolute right-3 top-3 z-40 flex items-center gap-2">
        <div className="relative">
          {helpOpen && (
            <>
              <div className="fixed inset-0" onClick={() => setHelpOpen(false)} aria-hidden="true" />
              <div id="bubble-help" className="absolute right-0 top-0 max-h-[calc(100dvh-var(--app-header-h)-24px)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-mirai-border bg-card p-3.5 text-xs leading-relaxed shadow-soft">
                <h2 className="mb-2 text-[13px] font-bold">このチャートの読み方</h2>
                <dl className="space-y-2 text-mirai-text-subtle">
                  <div>
                    <dt className="font-bold text-mirai-text">配置</dt>
                    <dd>丸1つが国の事業1つ。事業の説明文（目的・概要・課題）が似ているものほど近くに置かれます。上下左右の向きに意味はありません。</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-mirai-text">大きさ</dt>
                    <dd>はじめは「AI評価の総合点が低い事業ほど大きく」表示しています。気になる事業ほど目に入るようにするためです。左のメニューで予算額などに切り替えられます。</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-mirai-text">色と背景</dt>
                    <dd>色は所管の府省庁（切替可）。背景の淡い色面は、その府省庁の事業が集まっている領域です。色を「推奨判断」に切り替えると、どの領域に見直し候補が固まっているかが見えます。</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-mirai-text">支出つながり</dt>
                    <dd>ヘッダーの「ビュー」で切り替えます。菱形は支出先で、色が濃い（形が大きい）ほどマップ上の事業から受け取った額が大きい支出先です。菱形は支出元の事業の重心に置かれ、線で結ばれます（1事業だけの支出先はその事業の丸のすぐ外に置きます）。右上で支出先名の検索・支出元の事業数・件数を絞り込めます。「種類」を匿名・集約表記にすると、「その他」「個人A」「A社」「支出先なし」のように支出先を具体的に書いていない支出だけを表示し、それが多い事業を金額順・割合順で並べます。同じ支出先に払っている事業同士が、その菱形を経由してつながって見えます。「その他」「個人A」のように事業をまたいで同じ相手と言えない表記は除いています。</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-mirai-text">操作</dt>
                    <dd>丸にカーソルで概要、クリックで詳細。右の凡例をクリックするとその区分だけ強調。ドラッグで移動、ホイール/ピンチで拡大縮小。</dd>
                  </div>
                </dl>
                <p className="mt-2.5 border-t border-border pt-2 text-[10px] text-mirai-text-muted">
                  評価はAIによるスクリーニングであり、結論ではありません。位置と評価の詳しい算出方法は開発ドキュメントを参照してください。
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 右フロート: 凡例（右下はズーム操作に空ける）。sm 未満では図を塞ぐので出さない ── */}
      {data && !loading && isSpending && (
        <aside className="pointer-events-none absolute right-3 top-3 z-30 hidden max-h-[calc(100%-180px)] w-72 flex-col gap-2 overflow-y-auto [&>*]:pointer-events-auto sm:flex">
          <SpendingControls
            data={spendData}
            shown={visibleRecipients.length}
            matched={matchedRecipients}
            query={spendQuery}
            onQuery={setSpendQuery}
            minDegree={spendMinDegree}
            onMinDegree={setSpendMinDegree}
            limit={spendLimit}
            onLimit={setSpendLimit}
            kind={spendKind}
            onKind={changeSpendKind}
            poolSize={spendSource.length}
          />
          {lockedRecipient ? (
            <RecipientPanel
              recipient={lockedRecipient}
              pointByPid={pointByPid}
              colorOf={colorOf}
              onSelectPoint={p => setSelected(p)}
              onClose={() => setLockedRecipientId(null)}
            />
          ) : selected && spendData ? (
            <ProjectRecipientsPanel
              point={selected}
              items={recipientsByPid.get(selected.pid) ?? []}
              placeholderMode={isPlaceholderKind}
              projectSpending={spendData.projectSpending[selected.pid] ?? 0}
              onHover={r => setHoverRecipient(r ? { r, x: -1, y: -1 } : null)}
              onLock={r => setLockedRecipientId(r.id)}
            />
          ) : isPlaceholderKind && spendData ? (
            <PlaceholderRankingPanel rows={placeholderRanking} onSelect={selectPoint} />
          ) : null}
        </aside>
      )}

      {data && !loading && !isSpending && (
        <aside className="pointer-events-none absolute right-3 top-3 z-30 hidden max-h-[calc(100%-180px)] w-72 flex-col gap-2 overflow-y-auto [&>*]:pointer-events-auto sm:flex">
          <Legend
            entries={legend}
            mode={colorMode}
            activeKey={highlightKey}
            lockedKey={legendLock}
            onHover={setLegendHover}
            onToggle={key => setLegendLock(k => (k === key ? null : key))}
          />
        </aside>
      )}

      {/* ── 表ビュー（図と同じ内容の、色に依存しない読み方）。下から重ねる ── */}
      {data && !loading && showTable && (
        <div className="absolute inset-x-3 bottom-3 z-40 sm:right-[308px]">
          <TableView
            points={filtered}
            clusterById={clusterById}
            onSelect={point => { selectPoint(point); setShowTable(false); }}
            onClose={() => setShowTable(false)}
          />
        </div>
      )}
    </div>
    </div>
  );
}

type Range = { min: string; max: string };

/**
 * 数値の範囲入力。
 * components/filters/MinMaxInput は金額表記のパース前提かつ配色がライト固定なので、
 * 素の数値を扱うこのページでは使わず、ここで小さく持つ。
 */
function RangeInput({
  label, value, onChange, width,
}: {
  label: string;
  value: Range;
  onChange: (next: Range) => void;
  width: number;
}) {
  // type=number のスピナーはこの幅では場所を食うだけなので消す
  const cls = 'h-7 rounded-md border border-mirai-border bg-card px-1.5 text-xs tabular-nums text-mirai-text placeholder:text-mirai-text-placeholder outline-none transition-colors focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
  return (
    <span className="flex items-center gap-1">
      <span className="w-14 shrink-0 text-mirai-text-subtle">{label}</span>
      <input
        type="number" inputMode="numeric" value={value.min} placeholder="下限"
        aria-label={`${label} 下限`} style={{ width }} className={cls}
        onChange={e => onChange({ ...value, min: e.target.value })}
      />
      <span className="text-mirai-text-placeholder">–</span>
      <input
        type="number" inputMode="numeric" value={value.max} placeholder="上限"
        aria-label={`${label} 上限`} style={{ width }} className={cls}
        onChange={e => onChange({ ...value, max: e.target.value })}
      />
      {(value.min || value.max) && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange({ min: '', max: '' })}
          aria-label={`${label}の条件をクリア`}
          className="size-5 text-mirai-text-muted hover:bg-transparent hover:text-mirai-text-secondary"
        >✕</Button>
      )}
    </span>
  );
}

/** ホバー時の読み取り。値を主、ラベルを従にする */
function Tooltip({
  point, x, y, cluster, color,
}: {
  point: ProjectMapPoint;
  x: number;
  y: number;
  cluster?: ProjectMapCluster;
  color: string;
}) {
  // 常にカーソルの右に出し、右端では内側に寄せる（左右を入れ替えない）。
  // 重なり順は左右のフロート列（z-30〜40）より上なので、パネルに重なってももぐらない
  return (
    <div
      className="pointer-events-none absolute z-50 w-72 rounded-xl border border-mirai-border bg-card p-2.5 text-xs shadow-soft"
      style={{
        left: `min(${x + 14}px, calc(100% - ${288 + 8}px))`,
        top: Math.max(4, y - 60),
      }}
    >
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden="true"
        />
        <span className="font-bold leading-snug">{point.name}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-mirai-text-muted">
        <dt>府省庁</dt><dd className="text-mirai-text">{point.ministry}</dd>
        <dt>総合点</dt>
        <dd className="tabular-nums text-mirai-text">
          {point.score === null ? '未評価' : point.score}
          {point.rec && <span className="ml-1 text-mirai-text-muted">{point.rec}</span>}
        </dd>
        <dt>費用対/必要</dt>
        <dd className="tabular-nums text-mirai-text">
          {point.prop ?? '—'} / {point.nec ?? '—'}
        </dd>
        <dt>予算額</dt>
        <dd className="tabular-nums text-mirai-text">{formatYenShort(point.budget)}</dd>
        <dt>継続年数</dt>
        <dd className="tabular-nums text-mirai-text">
          {point.years === null ? '不明' : `${point.years}年`}
        </dd>
        <dt>分野</dt><dd className="text-mirai-text">{categoryLabel(point.cat)}</dd>
        {cluster && (
          <>
            <dt>近傍</dt>
            <dd className="text-mirai-text">{cluster.terms.slice(0, 3).join('・')}</dd>
          </>
        )}
      </dl>
      <p className="mt-1 text-[10px] text-mirai-text-muted">クリックで詳細</p>
    </div>
  );
}

/** 凡例。色だけで同定できない区分数なので、ここが実質の絞り込み UI を兼ねる */
function Legend({
  entries, mode, activeKey, lockedKey, onHover, onToggle,
}: {
  entries: LegendEntry[];
  mode: ColorMode;
  activeKey: string | null;
  lockedKey: string | null;
  onHover: (key: string | null) => void;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="rounded-xl border border-mirai-border bg-card p-3 shadow-soft">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] font-bold tracking-wide text-mirai-text-muted">
          {COLOR_MODE_LABELS[mode]}
        </h2>
        {lockedKey && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onToggle(lockedKey)}
            className="h-auto rounded-md px-1 py-0.5 text-[10px] font-normal text-mirai-text-muted hover:bg-mirai-surface hover:text-mirai-text"
          >
            ✕ 強調を解除
          </Button>
        )}
      </div>
      <ul className="max-h-[45dvh] space-y-px overflow-y-auto text-xs" onMouseLeave={() => onHover(null)}>
        {entries.map(e => {
          const active = activeKey === e.key;
          return (
            <li key={e.key}>
              <Button
                variant="ghost"
                onMouseEnter={() => onHover(e.key)}
                onFocus={() => onHover(e.key)}
                onBlur={() => onHover(null)}
                onClick={() => onToggle(e.key)}
                aria-pressed={lockedKey === e.key}
                className={cn(
                  'h-auto w-full justify-start gap-2 rounded-md px-1.5 py-1 text-left text-xs font-normal transition-opacity hover:bg-mirai-surface',
                  active
                    ? 'bg-primary/10 text-primary-accent hover:bg-primary/10'
                    : activeKey !== null && 'opacity-40',
                )}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: e.color }}
                  aria-hidden="true"
                />
                <span className={`flex-1 truncate ${e.isOther ? 'text-mirai-text-muted' : 'text-mirai-text-secondary'}`}>
                  {e.label}
                </span>
                <span className="tabular-nums text-[11px] text-mirai-text-muted">
                  {e.count.toLocaleString('ja-JP')}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 border-t border-border pt-2 text-[10px] leading-relaxed text-mirai-text-muted">
        クリックでその区分だけを前面に。もう一度押すと戻ります。
      </p>
    </div>
  );
}

/** 図と同じ内容を色に依存せず読むための表。上位200件だけ出し、続きは絞り込みで辿る */
function TableView({
  points, clusterById, onSelect, onClose,
}: {
  points: ProjectMapPoint[];
  clusterById: Map<number, ProjectMapCluster>;
  onSelect: (point: ProjectMapPoint) => void;
  onClose: () => void;
}) {
  const LIMIT = 200;
  // 総合点の低い順。このビューが探そうとしているものを先頭に出す
  const rows = useMemo(
    () => [...points].sort((a, b) => (a.score ?? 999) - (b.score ?? 999)).slice(0, LIMIT),
    [points],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-mirai-border bg-card shadow-soft">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <h2 className="text-[11px] font-bold tracking-wide text-mirai-text-muted">表で見る</h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-mirai-text-muted">
            総合点の低い順・上位{Math.min(LIMIT, rows.length)}件
            {points.length > LIMIT && `（該当 ${points.length.toLocaleString('ja-JP')}件）`}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="size-6 text-mirai-text-muted hover:bg-mirai-surface hover:text-mirai-text"
            aria-label="表を閉じる"
          ><X className="size-3.5" /></Button>
        </div>
      </div>
      <div className="max-h-[38dvh] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-mirai-surface text-left text-mirai-text-subtle">
            <tr className="border-b border-border">
              <th className="px-2 py-1.5 font-bold">事業名</th>
              <th className="px-2 py-1.5 font-bold">府省庁</th>
              <th className="px-2 py-1.5 text-right font-bold">総合点</th>
              <th className="px-2 py-1.5 font-bold">推奨</th>
              <th className="px-2 py-1.5 text-right font-bold">予算額</th>
              <th className="px-2 py-1.5 text-right font-bold">継続</th>
              <th className="px-2 py-1.5 font-bold">近傍の特徴語</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.pid} className="border-b border-border last:border-0 hover:bg-mirai-surface-teal/60">
                <td className="max-w-[22rem] truncate px-2 py-1">
                  <button
                    type="button"
                    onClick={() => onSelect(p)}
                    className="underline-offset-4 hover:text-primary-accent hover:underline"
                    title={p.name}
                  >
                    {p.name}
                  </button>
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-mirai-text-subtle">{p.ministry}</td>
                <td className="px-2 py-1 text-right tabular-nums">{p.score ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-1 text-mirai-text-subtle">{p.rec ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatYenShort(p.budget)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{p.years ?? '—'}</td>
                <td className="max-w-[16rem] truncate px-2 py-1 text-mirai-text-muted">
                  {clusterById.get(p.c)?.terms.slice(0, 3).join('・') ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** ビュー切替。ヘッダーで年度セレクトの左隣に置くので、見た目は YearSelect に揃える */
function ViewSelect({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={e => onChange(e.target.value as View)}
        aria-label="ビュー"
        className="h-9 cursor-pointer appearance-none rounded-full border border-mirai-border bg-card pl-3 pr-8 text-xs font-bold text-mirai-text shadow-xs transition-colors hover:bg-mirai-surface focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:ring-offset-2"
      >
        {(Object.keys(VIEW_LABELS) as View[]).map(v => (
          <option key={v} value={v}>{VIEW_LABELS[v]}</option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mirai-text-muted"
      />
    </div>
  );
}

/** 支出先の菱形（凡例・パネル用の小さな見本） */
function DiamondSwatch({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
      <path d="M5 0 L10 5 L5 10 L0 5 Z" fill={color} />
    </svg>
  );
}

/** 支出先ホバーの読み取り */
function RecipientTooltip({
  recipient, x, y, visibleCount, year,
}: {
  recipient: ProjectMapSpendingRecipient;
  x: number;
  y: number;
  visibleCount: number;
  /** RS シート年度。契約の概要（何に支払ったか）を引く */
  year: string;
}) {
  // パネルの行ホバー（座標なし）ではツールチップを出さない。図上の強調だけで足りる
  if (x < 0) return null;
  // 事業のツールチップと同じく、常にカーソルの右（右端では内側に寄せる）
  return (
    <div
      className="pointer-events-none absolute z-50 w-64 rounded-xl border border-mirai-border bg-card p-2.5 text-xs shadow-soft"
      style={{
        left: `min(${x + 14}px, calc(100% - ${256 + 8}px))`,
        top: Math.max(4, y - 40),
      }}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5"><DiamondSwatch color={spendingColor(recipient.amount)} /></span>
        <span className="font-bold leading-snug">{recipient.name}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-mirai-text-muted">
        {recipient.kind && (
          <>
            <dt>表記</dt>
            <dd className="text-mirai-text">{PLACEHOLDER_KIND_LABELS[recipient.kind]}</dd>
          </>
        )}
        <dt>受取額</dt>
        <dd className="tabular-nums text-mirai-text">{formatYenShort(recipient.amount)}</dd>
        <dt>支出元</dt>
        <dd className="tabular-nums text-mirai-text">
          {recipient.pids.length.toLocaleString('ja-JP')}事業
          {visibleCount < recipient.pids.length && (
            <span className="ml-1 text-mirai-text-muted">（うち表示中 {visibleCount}）</span>
          )}
        </dd>
      </dl>
      <RecipientContractSummary className="mt-2 border-t border-border pt-1.5" year={year} name={recipient.name} pids={recipient.pids} />
      <p className="mt-1 text-[10px] text-mirai-text-muted">クリックで固定・支出元の一覧</p>
    </div>
  );
}

/** 支出つながりの絞り込みと凡例（右上）。濃さ＝受取額の段 */
function SpendingControls({
  data, shown, matched, query, onQuery, minDegree, onMinDegree, limit, onLimit, kind, onKind, poolSize,
}: {
  data: ProjectMapSpendingResponse | null;
  shown: number;
  /** 検索・事業数の条件に合う件数（上限で切る前） */
  matched: number;
  query: string;
  onQuery: (q: string) => void;
  minDegree: SpendMinDegree;
  onMinDegree: (d: SpendMinDegree) => void;
  limit: SpendLimit;
  onLimit: (n: SpendLimit) => void;
  kind: SpendKind;
  onKind: (k: SpendKind) => void;
  /** 選んだ種類の支出先の総数 */
  poolSize: number;
}) {
  const selectCls = 'h-7 w-full cursor-pointer rounded-md border border-mirai-border bg-card px-1.5 text-mirai-text outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40';
  return (
    <div className="rounded-xl border border-mirai-border bg-card p-3 text-xs shadow-soft">
      <div className="flex flex-col gap-1.5">
        <input
          type="search"
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder="支出先名で検索"
          aria-label="支出先名で検索"
          className="h-7 w-full rounded-md border border-mirai-border bg-card px-2 text-xs text-mirai-text placeholder:text-mirai-text-placeholder outline-none transition-colors focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/40"
        />
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
          <span className="text-mirai-text-subtle">種類</span>
          <select
            value={kind}
            onChange={e => onKind(e.target.value as SpendKind)}
            className={selectCls}
            aria-label="支出先の種類"
          >
            {SPEND_KINDS.map(k => (
              <option key={k} value={k}>{SPEND_KIND_LABELS[k]}</option>
            ))}
          </select>
          <span className="text-mirai-text-subtle">支出元</span>
          <select
            value={minDegree}
            onChange={e => onMinDegree(Number(e.target.value) as SpendMinDegree)}
            className={selectCls}
            aria-label="支出元の事業数の下限"
          >
            {SPEND_MIN_DEGREES.map(d => (
              <option key={d} value={d}>{d === 1 ? '1事業以上（すべて）' : `${d}事業以上（共有のみ）`}</option>
            ))}
          </select>
          <span className="text-mirai-text-subtle">件数</span>
          <select
            value={limit}
            onChange={e => onLimit(Number(e.target.value) as SpendLimit)}
            className={selectCls}
            aria-label="描く支出先の件数"
          >
            {SPEND_LIMITS.map(n => (
              <option key={n} value={n}>{n === 0 ? 'すべて（金額順）' : `金額の上位${n.toLocaleString('ja-JP')}件`}</option>
            ))}
          </select>
        </div>
      </div>

      <h2 className="mb-2 mt-3 border-t border-border pt-2 text-[11px] font-bold tracking-wide text-mirai-text-muted">支出先の受取額（円）</h2>
      <div className="flex gap-px">
        {SPENDING_COLORS.map((c, i) => (
          <div key={c} className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <span className="h-2.5 w-full" style={{ background: c }} aria-hidden="true" />
            <span className="whitespace-nowrap text-[9px] tabular-nums text-mirai-text-muted">
              {spendingStepLabel(i)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 border-t border-border pt-2 text-[10px] leading-relaxed text-mirai-text-muted">
        {data ? (
          <>
            <strong className="font-bold text-mirai-text-secondary">{shown.toLocaleString('ja-JP')}</strong>
            {` / 該当 ${matched.toLocaleString('ja-JP')}件を表示（全 ${poolSize.toLocaleString('ja-JP')}件）。`}
            {kind === 'named'
              ? '「その他」「個人A」「A社」のような匿名・集約表記は除いています（「種類」で切り替え）。'
              : '支出先を具体的に書いていない表記です。名前が同じでも事業ごとに別の相手なので、線は「同じ書き方をしている事業」を結びます。'}
            菱形をクリックすると、つながる事業だけを前面に出します。
          </>
        ) : '読み込み中…'}
      </p>
    </div>
  );
}

/** 固定中の支出先と、その支出元の事業 */
function RecipientPanel({
  recipient, pointByPid, colorOf, onSelectPoint, onClose,
}: {
  recipient: ProjectMapSpendingRecipient;
  pointByPid: Map<string, ProjectMapPoint>;
  colorOf: (p: ProjectMapPoint) => string;
  onSelectPoint: (p: ProjectMapPoint) => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-xl border border-mirai-border bg-card p-3 text-xs shadow-soft">
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5"><DiamondSwatch color={spendingColor(recipient.amount)} /></span>
        <h2 className="flex-1 font-bold leading-snug">{recipient.name}</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="size-6 shrink-0 text-mirai-text-muted hover:bg-mirai-surface hover:text-mirai-text"
          aria-label="支出先の固定を解除"
        ><X className="size-3.5" /></Button>
      </div>
      <p className="mt-1 tabular-nums text-mirai-text-muted">
        受取額 <strong className="font-bold text-mirai-text">{formatYenShort(recipient.amount)}</strong>
        {' ・ '}{recipient.pids.length.toLocaleString('ja-JP')}事業から
      </p>
      <ul className="mt-2 max-h-[40dvh] space-y-px overflow-y-auto border-t border-border pt-1.5">
        {recipient.pids.map((pid, k) => {
          const p = pointByPid.get(pid);
          if (!p) return null;
          return (
            <li key={pid}>
              <button
                type="button"
                onClick={() => onSelectPoint(p)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-mirai-surface"
                title={p.name}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(p) }} aria-hidden="true" />
                <span className="flex-1 truncate text-mirai-text-secondary">{p.name}</span>
                <span className="shrink-0 tabular-nums text-[11px] text-mirai-text-muted">
                  {formatYenShort(recipient.amounts[k])}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 選択中の事業が払っている共有支出先。行から支出先を固定できる */
function ProjectRecipientsPanel({
  point, items, placeholderMode, projectSpending, onHover, onLock,
}: {
  point: ProjectMapPoint;
  items: Array<{ r: ProjectMapSpendingRecipient; amount: number }>;
  /** 匿名・集約表記を見ているとき。見出しと割合の表示が変わる */
  placeholderMode: boolean;
  /** この事業の支出先への支出の合計（割合の分母） */
  projectSpending: number;
  onHover: (r: ProjectMapSpendingRecipient | null) => void;
  onLock: (r: ProjectMapSpendingRecipient) => void;
}) {
  return (
    <div className="rounded-xl border border-mirai-border bg-card p-3 text-xs shadow-soft">
      <h2 className="text-[11px] font-bold tracking-wide text-mirai-text-muted">
        {placeholderMode ? 'この事業の匿名・集約表記の支出先' : 'この事業の支出先'}
      </h2>
      <p className="mt-1 truncate font-bold" title={point.name}>{point.name}</p>
      {placeholderMode && items.length > 0 && projectSpending > 0 && (() => {
        const sum = items.reduce((t, it) => t + it.amount, 0);
        return (
          <p className="mt-1 tabular-nums text-mirai-text-muted">
            計 <strong className="font-bold text-mirai-text">{formatYenShort(sum)}</strong>
            {`（支出の ${formatShare(sum / projectSpending)}）`}
          </p>
        );
      })()}
      {items.length === 0 ? (
        <p className="mt-2 text-mirai-text-muted">
          {placeholderMode ? 'この種類の匿名・集約表記への支出はありません。' : '支出先の記載がありません。'}
        </p>
      ) : (
        <ul className="mt-2 max-h-[40dvh] space-y-px overflow-y-auto border-t border-border pt-1.5" onMouseLeave={() => onHover(null)}>
          {items.map(({ r, amount }) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseEnter={() => onHover(r)}
                onFocus={() => onHover(r)}
                onBlur={() => onHover(null)}
                onClick={() => onLock(r)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-mirai-surface"
                title={`${r.name}（${r.pids.length}事業に共通）`}
              >
                <DiamondSwatch color={spendingColor(r.amount)} />
                <span className="flex-1 truncate text-mirai-text-secondary">{r.name}</span>
                <span className="shrink-0 tabular-nums text-[11px] text-mirai-text-muted">
                  {formatYenShort(amount)}・{r.pids.length}事業
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 割合の表示。1%未満は小数1桁まで出す（0%と区別するため） */
function formatShare(v: number): string {
  const pct = v * 100;
  if (pct >= 99.95) return '100%';
  return pct >= 1 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

interface PlaceholderRankRow {
  point: ProjectMapPoint;
  /** 匿名・集約表記（選んだ種類）への支出額 */
  amount: number;
  /** その事業の支出先への支出に占める割合 0-1 */
  share: number;
}

/**
 * 匿名・集約表記への支出が多い事業のランキング。
 * 金額順は大口の「その他」を、割合順は支出先のほとんどを具体的に書いていない事業を拾う。
 * 割合順は少額の事業が100%で並びやすいので、下限額で足切りできるようにする
 */
function PlaceholderRankingPanel({
  rows, onSelect,
}: {
  rows: PlaceholderRankRow[];
  onSelect: (p: ProjectMapPoint) => void;
}) {
  const LIMIT = 100;
  const [sort, setSort] = useState<'amount' | 'share'>('amount');
  const [minAmount, setMinAmount] = useState(0);
  const sorted = useMemo(() => {
    const list = rows.filter(r => r.amount >= minAmount);
    list.sort(sort === 'amount'
      ? (a, b) => b.amount - a.amount || b.share - a.share
      : (a, b) => b.share - a.share || b.amount - a.amount);
    return { total: list.length, top: list.slice(0, LIMIT) };
  }, [rows, sort, minAmount]);

  const tabCls = (active: boolean) => cn(
    'rounded-md px-1.5 py-0.5 text-[11px] transition-colors',
    active ? 'bg-primary/10 font-bold text-primary-accent' : 'text-mirai-text-muted hover:bg-mirai-surface hover:text-mirai-text',
  );
  return (
    <div className="rounded-xl border border-mirai-border bg-card p-3 text-xs shadow-soft">
      <h2 className="text-[11px] font-bold tracking-wide text-mirai-text-muted">匿名・集約表記への支出が多い事業</h2>
      <div className="mt-1.5 flex items-center gap-1">
        <button type="button" className={tabCls(sort === 'amount')} aria-pressed={sort === 'amount'} onClick={() => setSort('amount')}>金額順</button>
        <button type="button" className={tabCls(sort === 'share')} aria-pressed={sort === 'share'} onClick={() => setSort('share')}>割合順</button>
        <select
          value={minAmount}
          onChange={e => setMinAmount(Number(e.target.value))}
          className="ml-auto h-6 cursor-pointer rounded-md border border-mirai-border bg-card px-1 text-[11px] text-mirai-text outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40"
          aria-label="匿名・集約表記への支出額の下限"
        >
          <option value={0}>下限なし</option>
          <option value={1e7}>1千万円以上</option>
          <option value={1e8}>1億円以上</option>
          <option value={1e9}>10億円以上</option>
        </select>
      </div>
      {sorted.top.length === 0 ? (
        <p className="mt-2 text-mirai-text-muted">該当する事業はありません。</p>
      ) : (
        <ol className="mt-2 max-h-[45dvh] space-y-px overflow-y-auto border-t border-border pt-1.5">
          {sorted.top.map(({ point, amount, share }, i) => (
            <li key={point.pid}>
              <button
                type="button"
                onClick={() => onSelect(point)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-mirai-surface"
                title={`${point.name}（${point.ministry}）`}
              >
                <span className="w-5 shrink-0 text-right tabular-nums text-[10px] text-mirai-text-muted">{i + 1}</span>
                <span className="flex-1 truncate text-mirai-text-secondary">{point.name}</span>
                <span className="shrink-0 text-right tabular-nums text-[11px] text-mirai-text-muted">
                  {formatYenShort(amount)}
                  <span className="ml-1 inline-block w-9 text-mirai-text">{formatShare(share)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 border-t border-border pt-2 text-[10px] leading-relaxed text-mirai-text-muted">
        {`${sorted.total.toLocaleString('ja-JP')}事業中 上位${Math.min(LIMIT, sorted.total)}件。`}
        割合は、その事業の支出先への支出に占める匿名・集約表記の比率です。クリックで事業を選択します。
      </p>
    </div>
  );
}
