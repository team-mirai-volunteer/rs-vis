'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BubbleCanvas } from '@/client/components/ProjectMap/BubbleCanvas';
import { MultiSelectDropdown } from '@/components/filters/MultiSelectDropdown';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import {
  COLOR_MODE_LABELS, SIZE_METRIC_LABELS,
  buildColorLookup, buildLegend, buildSizeScale, categoryLabel,
  formatYenShort, legendKeyOf as resolveLegendKey,
  type ColorMode, type LegendEntry, type SizeMetric,
} from '@/app/lib/project-map-view';
import type { ProjectMapCluster, ProjectMapPoint, ProjectMapResponse } from '@/types/project-map';

type Year = '2024' | '2025';
const YEARS: Year[] = ['2025', '2024'];

/** 大きさの上限（画面px）。衝突回避で重なりを解くぶん、以前より大きくできる */
const MAX_RADIUS = 12;

export default function ProjectMapPage() {
  const [year, setYear] = useState<Year>('2025');
  const [data, setData] = useState<ProjectMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notGenerated, setNotGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);

  // 表示の切り替え
  const [colorMode, setColorMode] = useState<ColorMode>('ministry');
  const [sizeMetric, setSizeMetric] = useState<SizeMetric>('inverseScore');
  const [showClusterLabels, setShowClusterLabels] = useState(true);
  const [showRegions, setShowRegions] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const yr = p.get('yr'); if (yr === '2024' || yr === '2025') setYear(yr);
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
    setUrlHydrated(true);
  }, []);

  useEffect(() => {
    if (!urlHydrated) return;
    const p = new URLSearchParams();
    if (year !== '2025') p.set('yr', year);
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
  }, [urlHydrated, year, colorMode, sizeMetric, showRegions, showClusterLabels, showTable,
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

  // canvas は CSS の dark: を使えないので、配色の切り替えを JS 側でも知る必要がある
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setDark(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    setNotGenerated(false);
    setSelected(null);
    setLegendLock(null);
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

  // 空配列を毎レンダー作り直すと、下流の useMemo が全部無効化されて5,794点を毎回引き直す
  const EMPTY: ProjectMapPoint[] = useMemo(() => [], []);
  const allPoints = data?.points ?? EMPTY;

  // 凡例は常に全件から作る。絞り込んでも色が入れ替わらないようにするため
  const legend = useMemo(
    () => buildLegend(allPoints, colorMode, dark),
    [allPoints, colorMode, dark],
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
    () => buildLegend(allPoints, 'ministry', dark),
    [allPoints, dark],
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

  const highlightKey = legendLock ?? legendHover;

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
    // サンキー図と同じく画面全体を図に使う。UIはすべてフロートで重ねる
    <div className="relative h-dvh w-full overflow-hidden bg-[#fcfcfb] text-neutral-900 dark:bg-[#1a1a19] dark:text-neutral-100">
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
              onSelect={setSelected}
              dark={dark}
              showRegions={showRegions}
              regionEntries={regionEntries}
              regionKeyOf={regionKeyOf}
              regionPoints={allPoints}
            />
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
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            読み込み中…
          </div>
        )}

        {notGenerated && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-neutral-600 dark:text-neutral-400">
            <p className="font-medium">{year}年度の事業バブルチャートはまだ生成されていません</p>
            <p className="max-w-md text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
              このビューは事業説明文の埋め込みを使うため、年度ごとに座標を生成する必要があります。
              現在は2025年度のみ生成済みです。
            </p>
            <code className="mt-1 rounded-md bg-black/5 px-2.5 py-1.5 text-[11px] dark:bg-white/10">
              python3 scripts/generate-project-map.py --year {year}
            </code>
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center text-sm text-red-600 dark:text-red-400">
            読み込みに失敗しました: {error}
          </div>
        )}
      </div>

      {/* ── 左フロート列: 絞り込み（最上段）＋ 表示切替。幅を絞って中央を図に明け渡す ── */}
      <div className="pointer-events-none absolute bottom-3 left-3 top-3 z-30 flex w-[268px] flex-col gap-2 overflow-y-auto [&>*]:pointer-events-auto">

      {/* 絞り込み。見出しは置かず、検索を先頭にする */}
      {data && !loading && (
          <div className="rounded-xl border border-black/10 bg-white/90 p-3 text-xs shadow-md backdrop-blur dark:border-white/10 dark:bg-neutral-900/90">
            <div className="flex flex-col gap-1.5">
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="事業名・事業IDで検索"
                className="h-7 w-full rounded-md border border-black/20 bg-white px-2 text-xs text-neutral-800 placeholder:text-neutral-500 focus:border-blue-400 focus:bg-white focus:outline-none dark:border-white/20 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <MultiSelectDropdown
                options={ministryOptions}
                selected={ministries}
                onChange={setMinistries}
                allLabel="府省庁"
                placeholder="府省庁：すべて"
                placeholderColor="#555"
                minWidth={240}
              />
              <MultiSelectDropdown
                options={recommendationOptions}
                selected={recommendations}
                onChange={setRecommendations}
                allLabel="推奨判断"
                placeholder="推奨判断：すべて"
                placeholderColor="#555"
                minWidth={240}
              />
              <RangeInput label="総合点" value={scoreFilter} onChange={setScoreFilter} width={58} />
              <RangeInput label="継続年数" value={yearsFilter} onChange={setYearsFilter} width={58} />
              <RangeInput label="予算(億円)" value={budgetFilter} onChange={setBudgetFilter} width={58} />
              <div className="flex items-center justify-between">
                {hasFilter ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-md px-1.5 py-1 text-neutral-500 hover:bg-black/5 hover:text-neutral-800 dark:hover:bg-white/10 dark:hover:text-neutral-200"
                  >
                    ✕ 条件をクリア
                  </button>
                ) : <span />}
                <span className="tabular-nums text-[11px] text-neutral-400 dark:text-neutral-500">
                  <strong className="font-semibold text-neutral-700 dark:text-neutral-200">{filtered.length.toLocaleString('ja-JP')}</strong>
                  {` / ${allPoints.length.toLocaleString('ja-JP')} 事業`}
                </span>
              </div>
            </div>
          </div>
      )}

      <div className="rounded-xl border border-black/10 bg-white/90 shadow-md backdrop-blur dark:border-white/10 dark:bg-neutral-900/90">
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 px-3 py-2 text-xs">
          <span className="text-neutral-600 dark:text-neutral-300">色</span>
          <select
            value={colorMode}
            onChange={e => { setColorMode(e.target.value as ColorMode); setLegendLock(null); }}
            className="h-7 w-full rounded-md border border-black/20 bg-white px-1.5 text-neutral-800 focus:outline-none dark:border-white/20 dark:bg-neutral-800 dark:text-neutral-100"
            aria-label="色の塗り分け"
          >
            {(Object.keys(COLOR_MODE_LABELS) as ColorMode[]).map(m => (
              <option key={m} value={m}>{COLOR_MODE_LABELS[m]}</option>
            ))}
          </select>
          <span className="text-neutral-600 dark:text-neutral-300">大きさ</span>
          <select
            value={sizeMetric}
            onChange={e => setSizeMetric(e.target.value as SizeMetric)}
            className="h-7 w-full rounded-md border border-black/20 bg-white px-1.5 text-neutral-800 focus:outline-none dark:border-white/20 dark:bg-neutral-800 dark:text-neutral-100"
            aria-label="バブルの大きさ"
          >
            {(Object.keys(SIZE_METRIC_LABELS) as SizeMetric[]).map(m => (
              <option key={m} value={m}>{SIZE_METRIC_LABELS[m]}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-black/5 px-3 py-2 text-xs dark:border-white/5">
          <label className="flex cursor-pointer items-center gap-1" title="事業説明文から見た、府省庁が優勢な領域を背景に淡く塗ります">
            <input
              type="checkbox"
              checked={showRegions}
              onChange={e => setShowRegions(e.target.checked)}
              className="accent-neutral-700 dark:accent-neutral-300"
            />
            <span className="text-neutral-500 dark:text-neutral-400">勢力圏</span>
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={showClusterLabels}
              onChange={e => setShowClusterLabels(e.target.checked)}
              className="accent-neutral-700 dark:accent-neutral-300"
            />
            <span className="text-neutral-500 dark:text-neutral-400">クラスタ名</span>
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={showTable}
              onChange={e => setShowTable(e.target.checked)}
              className="accent-neutral-700 dark:accent-neutral-300"
            />
            <span className="text-neutral-500 dark:text-neutral-400">表で見る</span>
          </label>
        </div>

        {/* 大きさの目盛り。選択と同じカードに置き、必ず1行に収める
            （SVGは円の実寸ぶんだけ確保し、余白を作らない） */}
        {sizeScale.ticks.length > 0 && (
          <div className="flex flex-nowrap items-center justify-between overflow-hidden border-t border-black/5 px-3 py-1.5 text-neutral-500 dark:border-white/5 dark:text-neutral-400">
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

      {/* ── 右上: ヘルプ・年度・ページ切替メニュー ── */}
      <div className="absolute right-3 top-3 z-40 flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setHelpOpen(v => !v)}
            aria-expanded={helpOpen}
            className="flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white/90 px-2.5 text-xs text-neutral-600 shadow-md backdrop-blur hover:bg-white hover:text-neutral-800 dark:border-white/10 dark:bg-neutral-900/90 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >説明</button>
          {helpOpen && (
            <>
              <div className="fixed inset-0" onClick={() => setHelpOpen(false)} aria-hidden="true" />
              <div className="absolute right-0 top-10 w-80 rounded-xl border border-black/10 bg-white/95 p-3.5 text-xs leading-relaxed shadow-lg backdrop-blur dark:border-white/10 dark:bg-neutral-900/95">
                <h2 className="mb-2 text-[13px] font-bold">このチャートの読み方</h2>
                <dl className="space-y-2 text-neutral-600 dark:text-neutral-300">
                  <div>
                    <dt className="font-semibold text-neutral-800 dark:text-neutral-100">配置</dt>
                    <dd>丸1つが国の事業1つ。事業の説明文（目的・概要・課題）が似ているものほど近くに置かれます。上下左右の向きに意味はありません。</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-neutral-800 dark:text-neutral-100">大きさ</dt>
                    <dd>はじめは「AI評価の総合点が低い事業ほど大きく」表示しています。気になる事業ほど目に入るようにするためです。左のメニューで予算額などに切り替えられます。</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-neutral-800 dark:text-neutral-100">色と背景</dt>
                    <dd>色は所管の府省庁（切替可）。背景の淡い色面は、その府省庁の事業が集まっている領域です。色を「推奨判断」に切り替えると、どの領域に見直し候補が固まっているかが見えます。</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-neutral-800 dark:text-neutral-100">操作</dt>
                    <dd>丸にカーソルで概要、クリックで詳細。右の凡例をクリックするとその区分だけ強調。ドラッグで移動、ホイール/ピンチで拡大縮小。</dd>
                  </div>
                </dl>
                <p className="mt-2.5 border-t border-black/5 pt-2 text-[10px] text-neutral-400 dark:border-white/10 dark:text-neutral-500">
                  評価はAIによるスクリーニングであり、結論ではありません。位置と評価の詳しい算出方法は開発ドキュメントを参照してください。
                </p>
              </div>
            </>
          )}
        </div>
        <YearSelect value={year} onChange={y => setYear(y as Year)} years={YEARS} />
        <PageNavMenu current="/project-bubble" />
      </div>

      {/* ── 右フロート: 凡例と選択中の事業（メニューボタンの下から） ── */}
      {data && !loading && (
        <aside className="pointer-events-none absolute bottom-3 right-3 top-14 z-30 flex w-72 flex-col gap-2 overflow-y-auto [&>*]:pointer-events-auto">
          <Legend
            entries={legend}
            mode={colorMode}
            activeKey={highlightKey}
            lockedKey={legendLock}
            onHover={setLegendHover}
            onToggle={key => setLegendLock(k => (k === key ? null : key))}
          />
          <SelectedPanel
            point={selected}
            cluster={selected ? clusterById.get(selected.c) : undefined}
            year={year}
            onClose={() => setSelected(null)}
          />
        </aside>
      )}

      {/* ── 表ビュー（図と同じ内容の、色に依存しない読み方）。下から重ねる ── */}
      {data && !loading && showTable && (
        <div className="absolute inset-x-3 bottom-3 z-40 sm:right-[308px]">
          <TableView
            points={filtered}
            clusterById={clusterById}
            year={year}
            onClose={() => setShowTable(false)}
          />
        </div>
      )}
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
  const cls = 'h-7 rounded-md border border-black/20 bg-white px-1.5 text-xs tabular-nums text-neutral-800 placeholder:text-neutral-500 focus:border-blue-400 focus:bg-white focus:outline-none dark:border-white/20 dark:bg-neutral-800 dark:text-neutral-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
  return (
    <span className="flex items-center gap-1">
      <span className="w-14 shrink-0 text-neutral-600 dark:text-neutral-300">{label}</span>
      <input
        type="number" inputMode="numeric" value={value.min} placeholder="下限"
        aria-label={`${label} 下限`} style={{ width }} className={cls}
        onChange={e => onChange({ ...value, min: e.target.value })}
      />
      <span className="text-neutral-300 dark:text-neutral-600">–</span>
      <input
        type="number" inputMode="numeric" value={value.max} placeholder="上限"
        aria-label={`${label} 上限`} style={{ width }} className={cls}
        onChange={e => onChange({ ...value, max: e.target.value })}
      />
      {(value.min || value.max) && (
        <button
          type="button"
          onClick={() => onChange({ min: '', max: '' })}
          aria-label={`${label}の条件をクリア`}
          className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >✕</button>
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
  // 端で見切れないように、カーソルの左右どちらに出すかを切り替える
  const flip = x > 380;
  return (
    <div
      className="pointer-events-none absolute z-20 w-72 rounded-lg border border-black/10 bg-white/95 p-2.5 text-xs shadow-xl backdrop-blur-sm dark:border-white/10 dark:bg-neutral-900/95"
      style={{
        left: flip ? undefined : x + 14,
        right: flip ? `calc(100% - ${x - 14}px)` : undefined,
        top: Math.max(4, y - 60),
      }}
    >
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden="true"
        />
        <span className="font-semibold leading-snug">{point.name}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-neutral-400 dark:text-neutral-500">
        <dt>府省庁</dt><dd className="text-neutral-900 dark:text-neutral-100">{point.ministry}</dd>
        <dt>総合点</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">
          {point.score === null ? '未評価' : point.score}
          {point.rec && <span className="ml-1 text-neutral-500">{point.rec}</span>}
        </dd>
        <dt>費用対/必要</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">
          {point.prop ?? '—'} / {point.nec ?? '—'}
        </dd>
        <dt>予算額</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">{formatYenShort(point.budget)}</dd>
        <dt>継続年数</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">
          {point.years === null ? '不明' : `${point.years}年`}
        </dd>
        <dt>分野</dt><dd className="text-neutral-900 dark:text-neutral-100">{categoryLabel(point.cat)}</dd>
        {cluster && (
          <>
            <dt>近傍</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">{cluster.terms.slice(0, 3).join('・')}</dd>
          </>
        )}
      </dl>
      <p className="mt-1 text-[10px] text-neutral-400">クリックで詳細</p>
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
    <div className="rounded-xl border border-black/10 bg-white/90 p-3 shadow-md backdrop-blur dark:border-white/10 dark:bg-neutral-900/90">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold tracking-wide text-neutral-400 dark:text-neutral-500">
          {COLOR_MODE_LABELS[mode]}
        </h2>
        {lockedKey && (
          <button
            type="button"
            onClick={() => onToggle(lockedKey)}
            className="rounded px-1 text-[10px] text-neutral-500 hover:bg-black/5 hover:text-neutral-800 dark:hover:bg-white/10 dark:hover:text-neutral-200"
          >
            ✕ 強調を解除
          </button>
        )}
      </div>
      <ul className="max-h-[45dvh] space-y-px overflow-y-auto text-xs" onMouseLeave={() => onHover(null)}>
        {entries.map(e => {
          const active = activeKey === e.key;
          return (
            <li key={e.key}>
              <button
                type="button"
                onMouseEnter={() => onHover(e.key)}
                onFocus={() => onHover(e.key)}
                onBlur={() => onHover(null)}
                onClick={() => onToggle(e.key)}
                aria-pressed={lockedKey === e.key}
                className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-opacity ${
                  active
                    ? 'bg-black/5 dark:bg-white/10'
                    : activeKey !== null ? 'opacity-40' : ''
                } hover:bg-black/5 dark:hover:bg-white/10`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: e.color }}
                  aria-hidden="true"
                />
                <span className={`flex-1 truncate ${e.isOther ? 'text-neutral-500 dark:text-neutral-400' : 'text-neutral-700 dark:text-neutral-200'}`}>
                  {e.label}
                </span>
                <span className="tabular-nums text-[11px] text-neutral-400 dark:text-neutral-500">
                  {e.count.toLocaleString('ja-JP')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 border-t border-black/5 pt-2 text-[10px] leading-relaxed text-neutral-400 dark:border-white/5 dark:text-neutral-500">
        クリックでその区分だけを前面に。もう一度押すと戻ります。
      </p>
    </div>
  );
}

function SelectedPanel({
  point, cluster, year, onClose,
}: {
  point: ProjectMapPoint | null;
  cluster?: ProjectMapCluster;
  year: string;
  onClose: () => void;
}) {
  if (!point) {
    return (
      <div className="rounded-xl border border-dashed border-black/15 p-4 text-center text-xs leading-relaxed text-neutral-400 dark:border-white/15 dark:text-neutral-500">
        バブルをクリックすると、<br />その事業の詳細がここに出ます。
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-black/10 bg-white p-3 text-xs shadow-sm dark:border-white/10 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[13px] font-semibold leading-snug">{point.name}</h2>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 h-6 w-6 shrink-0 rounded-md text-neutral-400 hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
          aria-label="閉じる"
        >×</button>
      </div>
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-neutral-500 dark:text-neutral-400">
        <dt>事業ID</dt><dd className="tabular-nums text-neutral-900 dark:text-neutral-100">{point.pid}</dd>
        <dt>府省庁</dt><dd className="text-neutral-900 dark:text-neutral-100">{point.ministry}</dd>
        <dt>分野</dt><dd className="text-neutral-900 dark:text-neutral-100">{categoryLabel(point.cat)}</dd>
        <dt>総合点</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">
          {point.score === null ? '未評価' : point.score}
        </dd>
        <dt>費用対内容</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">{point.prop ?? '未評価'}</dd>
        <dt>必要性</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">{point.nec ?? '未評価'}</dd>
        <dt>推奨</dt><dd className="text-neutral-900 dark:text-neutral-100">{point.rec ?? '未判定'}</dd>
        <dt>予算額</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">{formatYenShort(point.budget)}</dd>
        <dt>執行額</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">{formatYenShort(point.exec)}</dd>
        <dt>継続年数</dt>
        <dd className="tabular-nums text-neutral-900 dark:text-neutral-100">
          {point.years === null ? '不明' : `${point.years}年`}
        </dd>
      </dl>
      {cluster && (
        <p className="mt-2.5 border-t border-black/5 pt-2 text-[11px] leading-relaxed text-neutral-400 dark:border-white/10 dark:text-neutral-500">
          近傍{cluster.count}事業の特徴語: {cluster.terms.join('・')}
        </p>
      )}
      <div className="mt-2.5 flex gap-1.5">
        <Link
          href={`/subcontracts/${point.pid}?year=${year}`}
          className="rounded-md border border-black/10 px-2 py-1 text-[11px] text-neutral-600 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10"
        >
          支出先を見る
        </Link>
        <Link
          href={`/sankey-svg?fnp=${encodeURIComponent(point.name)}&fp=1&yr=${year}`}
          className="rounded-md border border-black/10 px-2 py-1 text-[11px] text-neutral-600 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10"
        >
          サンキー図で見る
        </Link>
      </div>
    </div>
  );
}

/** 図と同じ内容を色に依存せず読むための表。上位200件だけ出し、続きは絞り込みで辿る */
function TableView({
  points, clusterById, year, onClose,
}: {
  points: ProjectMapPoint[];
  clusterById: Map<number, ProjectMapCluster>;
  year: string;
  onClose: () => void;
}) {
  const LIMIT = 200;
  // 総合点の低い順。このビューが探そうとしているものを先頭に出す
  const rows = useMemo(
    () => [...points].sort((a, b) => (a.score ?? 999) - (b.score ?? 999)).slice(0, LIMIT),
    [points],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white/95 shadow-lg backdrop-blur dark:border-white/10 dark:bg-neutral-900/95">
      <div className="flex items-center justify-between border-b border-black/5 px-3 py-1.5 dark:border-white/10">
        <h2 className="text-[11px] font-semibold tracking-wide text-neutral-400 dark:text-neutral-500">表で見る</h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
            総合点の低い順・上位{Math.min(LIMIT, rows.length)}件
            {points.length > LIMIT && `（該当 ${points.length.toLocaleString('ja-JP')}件）`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-6 w-6 rounded-md text-neutral-400 hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label="表を閉じる"
          >×</button>
        </div>
      </div>
      <div className="max-h-[38dvh] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white text-left text-neutral-500 dark:bg-neutral-900">
            <tr className="border-b border-black/5 dark:border-white/10">
              <th className="px-2 py-1.5 font-medium">事業名</th>
              <th className="px-2 py-1.5 font-medium">府省庁</th>
              <th className="px-2 py-1.5 text-right font-medium">総合点</th>
              <th className="px-2 py-1.5 font-medium">推奨</th>
              <th className="px-2 py-1.5 text-right font-medium">予算額</th>
              <th className="px-2 py-1.5 text-right font-medium">継続</th>
              <th className="px-2 py-1.5 font-medium">近傍の特徴語</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.pid} className="border-b border-black/5 last:border-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/5">
                <td className="max-w-[22rem] truncate px-2 py-1">
                  <Link
                    href={`/subcontracts/${p.pid}?year=${year}`}
                    className="hover:underline"
                    title={p.name}
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-neutral-600 dark:text-neutral-400">{p.ministry}</td>
                <td className="px-2 py-1 text-right tabular-nums">{p.score ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-1 text-neutral-600 dark:text-neutral-400">{p.rec ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatYenShort(p.budget)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{p.years ?? '—'}</td>
                <td className="max-w-[16rem] truncate px-2 py-1 text-neutral-500">
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
