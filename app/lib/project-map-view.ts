/**
 * 事業マップの表示ロジック（Pure・Reactに依存しない）。
 *
 * 色の割り当てとバブルの大きさの決め方をここに集約する。
 * canvas 描画側・凡例・表ビューが同じ関数を通ることで、
 * 「凡例の色と点の色が違う」類のずれが起きないようにしている。
 */
import { POLICY_CATEGORY_GROUPS, POLICY_CATEGORY_LABELS } from '@/app/lib/policy-evaluation';
import type { ProjectMapPoint } from '@/types/project-map';

// ── 配色 ──
//
// dataviz スキルの検証済みパレット（references/palette.md）の8スロットをそのまま使う。
// 明暗は別々に選ばれた値で、暗所で明色を暗くしただけのものではない。
//
// ただし注意: このパレットが散布図・バブル（全ペアが同時に画面に出る形）で
// CVD 安全を満たすのは検証上 4 色まで。実測でも8色では
// 緑↔橙 ΔE 3.2 (protan)、赤↔橙 ΔE 7.1 (normal) と閾値を下回る。
// 37府省庁を色だけで同定するのは元より不可能なので、ここでは
//   色 = かたまりの手がかり / 同定 = ホバー・凡例ハイライト・表ビュー
// と役割を分けている。凡例ホバーでの強調は装飾ではなく、この二次符号化そのもの。
// 9〜12番目は検証済み8色に足した追加スロット（シアン/ブラウン/オーキッド/オリーブ）。
// 12色を色だけで見分けるのは元より不可能で、あくまで手がかり。同定は凡例・ツールチップが担う
export const SERIES_LIGHT = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  '#0e93b0', '#9a6a22', '#b45fd6', '#647d0e',
] as const;

export const SERIES_DARK = [
  '#3987e5', '#d95926', '#199e70', '#c98500',
  '#d55181', '#008300', '#9085e9', '#e66767',
  '#2aa6c4', '#b07f35', '#c678e6', '#7e9a22',
] as const;

/** スロットに載らない裾を畳む先。色相を持たせない＝「その他」であることを見た目で示す */
export const OTHER_COLOR = '#898781';

/** 推奨判断は状態を表すので、系列色ではなく固定のステータス色を使う */
const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/**
 * 推奨判断 → ステータス色。
 * 7段階を4色に畳んでいるので、凡例とツールチップでは必ず文字を添える
 * （ステータス色は色だけで意味を運ばせない、というのがパレットの取り決め）。
 */
export const RECOMMENDATION_COLORS: Record<string, string> = {
  継続: STATUS.good,
  要改善: STATUS.warning,
  条件付き継続: STATUS.warning,
  縮小: STATUS.serious,
  他事業と統合: STATUS.serious,
  再設計: STATUS.serious,
  '終了・廃止候補': STATUS.critical,
};

/** 政策分野グループ（7分類）。policyCategory の id からグループ id を引く */
const GROUP_BY_CATEGORY = new Map<string, { id: string; label: string }>(
  POLICY_CATEGORY_GROUPS.flatMap(g => g.categories.map(c => [c.id, { id: g.id, label: g.label }])),
);

export type ColorMode = 'ministry' | 'policyGroup' | 'recommendation';

export type SizeMetric =
  | 'budget' | 'exec' | 'years' | 'uniform'
  | 'inverseScore' | 'inverseProp' | 'inverseNec';

export const SIZE_METRIC_LABELS: Record<SizeMetric, string> = {
  inverseScore: '総合点の逆数（低いほど大きい）',
  inverseProp: '費用対内容の逆数（低いほど大きい）',
  inverseNec: '必要性の逆数（低いほど大きい）',
  budget: '予算額',
  exec: '執行額',
  years: '継続年数',
  uniform: '均一',
};

/** 「点数が低いほど大きい」系の指標。目盛りの文言と値の反転を共有する */
const INVERSE_METRICS = new Set<SizeMetric>(['inverseScore', 'inverseProp', 'inverseNec']);

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  ministry: '府省庁',
  policyGroup: '政策分野',
  recommendation: '推奨判断',
};

/** 凡例1行分。色と表示名と件数を、描画側と共有する */
export interface LegendEntry {
  /** 塗り分けのキー。点側の値と厳密に一致する */
  key: string;
  label: string;
  color: string;
  count: number;
  /** スロットに載らなかった裾をまとめた行 */
  isOther?: boolean;
}

/** 点が属する塗り分けキー。色はこのキー経由でしか引かない */
export function colorKeyOf(p: ProjectMapPoint, mode: ColorMode): string {
  if (mode === 'ministry') return p.ministry || '不明';
  if (mode === 'policyGroup') {
    const g = p.cat ? GROUP_BY_CATEGORY.get(p.cat) : undefined;
    return g?.id ?? 'unknown';
  }
  return p.rec ?? 'unknown';
}

/**
 * 塗り分けの凡例を作る。
 *
 * 色は必ず「全件での順位」で固定する。絞り込みで件数が変わっても
 * 生き残った系列の色が塗り替わらないようにするため（色は実体に従う）。
 * 引数の allPoints は常にフィルタ前の全件を渡すこと。
 */
export function buildLegend(
  allPoints: ProjectMapPoint[],
  mode: ColorMode,
  dark: boolean,
): LegendEntry[] {
  const series = dark ? SERIES_DARK : SERIES_LIGHT;
  const counts = new Map<string, number>();
  for (const p of allPoints) {
    const k = colorKeyOf(p, mode);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  if (mode === 'recommendation') {
    // 推奨判断は「継続寄り → 見直し寄り」の並びが意味を持つので件数順にしない
    const order = ['継続', '要改善', '条件付き継続', '縮小', '他事業と統合', '再設計', '終了・廃止候補'];
    const entries: LegendEntry[] = [];
    for (const key of order) {
      const count = counts.get(key) ?? 0;
      if (count === 0) continue;
      entries.push({ key, label: key, color: RECOMMENDATION_COLORS[key] ?? OTHER_COLOR, count });
    }
    const unknown = counts.get('unknown') ?? 0;
    if (unknown > 0) {
      entries.push({ key: 'unknown', label: '未判定', color: OTHER_COLOR, count: unknown, isOther: true });
    }
    return entries;
  }

  if (mode === 'policyGroup') {
    // 7グループはスロットに収まる。定義順に固定する
    const entries: LegendEntry[] = [];
    POLICY_CATEGORY_GROUPS.forEach((g, i) => {
      const count = counts.get(g.id) ?? 0;
      if (count === 0) return;
      entries.push({ key: g.id, label: g.label, color: series[i % series.length], count });
    });
    const unknown = counts.get('unknown') ?? 0;
    if (unknown > 0) {
      entries.push({ key: 'unknown', label: '未分類', color: OTHER_COLOR, count: unknown, isOther: true });
    }
    return entries;
  }

  // 府省庁は37あり全部に色は振れない。「事業数トップ10」と「予算額トップ10」の
  // 和集合にスロットを割り当てる（こども家庭庁のような少数・巨額の省庁を落とさない）。
  // 並び＝色の割り当ては事業数順で固定
  const budgets = new Map<string, number>();
  for (const p of allPoints) {
    const k = colorKeyOf(p, mode);
    budgets.set(k, (budgets.get(k) ?? 0) + p.budget);
  }
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const byBudget = [...budgets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const slotted = new Set([
    ...byCount.slice(0, 10).map(([k]) => k),
    ...byBudget.slice(0, 10).map(([k]) => k),
  ]);
  const ranked = byCount.filter(([k]) => slotted.has(k)).slice(0, series.length);
  const entries: LegendEntry[] = ranked.map(([key, count], i) => ({
    key,
    label: key,
    color: series[i],
    count,
  }));
  const inSlots = new Set(ranked.map(([k]) => k));
  const tail = byCount.filter(([k]) => !inSlots.has(k));
  if (tail.length > 0) {
    entries.push({
      key: OTHER_KEY,
      label: `その他 ${tail.length}府省庁`,
      color: OTHER_COLOR,
      count: tail.reduce((s, [, c]) => s + c, 0),
      isOther: true,
    });
  }
  return entries;
}

/** 裾をまとめた行の予約キー。実在の府省庁名と衝突しない値にしてある */
export const OTHER_KEY = '__other__';

/** 塗り分けキー → 色。凡例に無いキー（裾に畳まれたもの）はグレー */
export function buildColorLookup(legend: LegendEntry[]): (key: string) => string {
  const map = new Map(legend.map(e => [e.key, e.color]));
  return (key: string) => map.get(key) ?? OTHER_COLOR;
}

/** 点 → 凡例上の行キー。裾の府省庁は「その他」の行に対応づける */
export function legendKeyOf(p: ProjectMapPoint, mode: ColorMode, legend: LegendEntry[]): string {
  const key = colorKeyOf(p, mode);
  return legend.some(e => e.key === key) ? key : OTHER_KEY;
}

// ── 大きさ ──

/**
 * 半径のスケール。値そのものではなく**母集団内の順位（パーセンタイル）**で決める。
 *
 * 対数正規化を試したが、金額は 10^4〜10^13 と10桁開いており、対数に落としても
 * 大半の事業が中央の似た半径に潰れて大小が読めなかった（利用者にも不評）。
 * 順位ベースなら半径が分布全体に均等に広がり、「他の事業より大きいか」が
 * そのまま見た目の大小になる。絶対量の比は犠牲になるので、目盛りには
 * 中央値・上位10%・最大の実値を添えて換算できるようにする。
 *
 * 半径 = MIN + span × rank^EXP。EXP>1 で上位ほど強調される
 * （このビューはスクリーニング用途なので、分布の端にある事業が目立つ方が正しい）。
 */
export interface SizeScale {
  radius: (p: ProjectMapPoint) => number;
  /** 凡例用。代表的な値と、その半径 */
  ticks: Array<{ label: string; radius: number }>;
}

const MIN_R = 2.2;
const RANK_EXP = 1.5;

export function buildSizeScale(
  points: ProjectMapPoint[],
  metric: SizeMetric,
  maxR: number,
): SizeScale {
  if (metric === 'uniform') {
    const r = Math.max(MIN_R, maxR * 0.28);
    return { radius: () => r, ticks: [{ label: '全事業 同じ大きさ', radius: r }] };
  }

  const raw = (p: ProjectMapPoint): number | null => {
    switch (metric) {
      case 'budget': return p.budget > 0 ? p.budget : null;
      case 'exec': return p.exec > 0 ? p.exec : null;
      case 'years': return p.years;
      // 低評価ほど大きく。これがこのビューの主眼で、
      // 「問題のある事業ほど画面上で目立つ」ようにするための反転
      case 'inverseScore': return p.score === null ? null : 100 - p.score;
      case 'inverseProp': return p.prop === null ? null : 100 - p.prop;
      case 'inverseNec': return p.nec === null ? null : 100 - p.nec;
      default: return null;
    }
  };

  const values = points
    .map(raw)
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  const n = values.length;
  if (n === 0) {
    return { radius: () => MIN_R, ticks: [] };
  }

  /** v 以下の値の割合（0-1）。二分探索で順位を引く */
  const rankOf = (v: number): number => {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return n <= 1 ? 1 : (lo - 1) / (n - 1);
  };

  const rankToR = (t: number) =>
    MIN_R + (maxR - MIN_R) * Math.pow(Math.max(0, Math.min(1, t)), RANK_EXP);

  // 未評価・0円は最小の点にする。消すと「無い」ことが見えなくなる
  const radius = (p: ProjectMapPoint) => {
    const v = raw(p);
    if (v === null || !Number.isFinite(v)) return MIN_R;
    return rankToR(rankOf(v));
  };

  // 目盛りは1行に収める必要があるので、単位を極限まで詰める（2.9億 / 150億 / 30兆）
  const fmtCompact = (v: number) => {
    if (metric === 'years') return `${Math.round(v)}年`;
    if (INVERSE_METRICS.has(metric)) return `${Math.round(100 - v)}点`;
    for (const [d, s] of [[1e12, '兆'], [1e8, '億'], [1e4, '万']] as const) {
      if (v >= d) {
        const x = v / d;
        return `${x >= 10 ? Math.round(x) : x.toFixed(1)}${s}`;
      }
    }
    return `${Math.round(v)}円`;
  };
  const quantile = (q: number) => values[Math.min(n - 1, Math.round(q * (n - 1)))];
  // 順位スケールなので、目盛りは分布上の位置＋実値で示す
  const names: [string, string, string] = INVERSE_METRICS.has(metric)
    ? ['中央', '下位10%', '最低']
    : ['中央', '上位10%', '最大'];
  const ticks = ([0.5, 0.9, 1] as const).map((q, i) => ({
    label: `${names[i]} ${fmtCompact(quantile(q))}`,
    radius: rankToR(q),
  }));

  return { radius, ticks };
}

/** 金額の短縮表記。1円単位のデータを兆・億・万で丸める */
export function formatYenShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}兆円`;
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}億円`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ja-JP')}万円`;
  return `${Math.round(v).toLocaleString('ja-JP')}円`;
}

/** policyCategory の id → 表示名 */
export function categoryLabel(id: string | null): string {
  if (!id) return '未分類';
  return POLICY_CATEGORY_LABELS[id] ?? id;
}
