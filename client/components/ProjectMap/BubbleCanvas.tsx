'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProjectMapCluster, ProjectMapPoint } from '@/types/project-map';

/**
 * 5,000超のバブルを描く canvas。
 *
 * SVG にしなかったのは、ズーム/パンのたびに数千ノードを再レイアウトさせると
 * 操作が明確に引っかかるため。代わりに当たり判定を自前で持つ必要があるので、
 * 画面座標を毎フレーム配列に書き出し、その上に格子インデックスを張って
 * 「最も近い点」を引く（点の上にピンポイントで乗せる操作を要求しない）。
 *
 * 座標は2段階で決める:
 *   1. UMAP座標 → 基準画面座標（ズーム前・アスペクト比保持）
 *   2. 円同士の衝突を反復緩和で解き、重なりを最小化した「表示座標」を作る
 * ズームは表示座標に対する線形変換なので、ズーム1で重ならない配置は
 * 拡大してもそのまま重ならない。
 */

/** 府省庁の勢力圏レイヤに使う凡例（スロットが割り当たった府省庁のみ渡す） */
export interface RegionEntry {
  key: string;
  label: string;
  color: string;
}

/** 半径は画面ピクセル固定。ズームは点の間隔だけを広げ、密集を解くために使う */
export interface BubbleCanvasProps {
  points: ProjectMapPoint[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  clusters: ProjectMapCluster[];
  clusterLabel: (c: ProjectMapCluster) => string;
  showClusterLabels: boolean;
  colorOf: (p: ProjectMapPoint) => string;
  radiusOf: (p: ProjectMapPoint) => number;
  /** 凡例上の行キー。ハイライト対象の判定に使う */
  legendKeyOf: (p: ProjectMapPoint) => string;
  /** 凡例ホバー/選択で絞り込んでいる行。null なら全件が前面 */
  highlightKey: string | null;
  selectedPid: string | null;
  onHover: (p: ProjectMapPoint | null, screen: { x: number; y: number } | null) => void;
  onSelect: (p: ProjectMapPoint | null) => void;
  dark: boolean;
  /** 府省庁の勢力圏（背景の色面）。点の塗り分けとは独立に、常に府省庁で塗る */
  showRegions: boolean;
  regionEntries: RegionEntry[];
  /** 点 → 勢力圏のキー。スロット外の府省庁は null（中立扱いで色面を抑制する） */
  regionKeyOf: (p: ProjectMapPoint) => string | null;
  /**
   * 勢力圏の計算に使う点。絞り込み後の points ではなく常に全件を渡す。
   * 絞り込むたびに背景の地図が描き変わると「地形」として信用できなくなるため
   */
  regionPoints: ProjectMapPoint[];
}

const SURFACE_LIGHT = '#fcfcfb';
const SURFACE_DARK = '#1a1a19';
const MUTED = '#898781';
const LABEL_LIGHT = '#52514e';
const LABEL_DARK = '#c3c2b7';

const PADDING = 36;
const GRID_CELL = 36;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 40;

/** 勢力圏KDEの格子解像度（長辺のセル数）。粗いほど柔らかい色面になる */
const REGION_GRID = 150;

interface Transform { k: number; tx: number; ty: number }

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function BubbleCanvas(props: BubbleCanvasProps) {
  const {
    points, bounds, clusters, clusterLabel, showClusterLabels,
    colorOf, radiusOf, legendKeyOf, highlightKey, selectedPid,
    onHover, onSelect, dark,
    showRegions, regionEntries, regionKeyOf, regionPoints,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState<Transform>({ k: 1, tx: 0, ty: 0 });

  // 画面座標のキャッシュ。描画と当たり判定で同じ配列を見る
  const layoutRef = useRef<{
    sx: Float32Array; sy: Float32Array; r: Float32Array;
    grid: Map<number, number[]>;
  } | null>(null);

  // ── 表示領域 ──
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0].contentRect;
      setSize({ w: Math.max(1, Math.floor(box.width)), h: Math.max(1, Math.floor(box.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** UMAP座標 → 画面座標の基準変換（ズーム前）。アスペクト比は保つ */
  const base = useMemo(() => {
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxY - bounds.minY);
    const k = Math.min((size.w - PADDING * 2) / w, (size.h - PADDING * 2) / h);
    return {
      k,
      // 中央寄せ。yは反転させない（UMAP座標に上下の意味は無い）
      ox: (size.w - w * k) / 2 - bounds.minX * k,
      oy: (size.h - h * k) / 2 - bounds.minY * k,
    };
  }, [bounds, size.w, size.h]);

  /** データ座標 → 画面座標（勢力圏・クラスタ名などデータ空間に固定される要素用） */
  const toScreen = useCallback((x: number, y: number) => ({
    x: (x * base.k + base.ox) * transform.k + transform.tx,
    y: (y * base.k + base.oy) * transform.k + transform.ty,
  }), [base, transform]);

  /**
   * 衝突回避後の表示座標（ズーム1の画面座標系）。
   *
   * UMAPの生座標のままだと密集地帯で数十点が完全に重なり、下の点が読めない。
   * 円の重なりを格子スイープで反復的に押し広げる（beeswarm と同じ考え方）。
   * 押し出しは局所的なので、意味的な配置（どの塊に属すか）は保たれる。
   */
  const relaxed = useMemo(() => {
    const n = points.length;
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const pr = new Float32Array(n);
    if (n === 0 || base.k <= 0 || !Number.isFinite(base.k)) return { px, py, pr };

    // 完全な非重畳を要求すると、円の総面積が塊の面積を超える密集地帯で
    // 全体が押し広げられ、一枚のハニカムになってクラスタ構造が消える。
    // なので (1) 中心距離は半径和の OVERLAP 倍まで許す（縁の重なりは残る）、
    // (2) 元のUMAP位置からの移動量に上限を置く、の2つで「なるべく避ける」に留める
    const OVERLAP = 0.62;
    const MAX_SHIFT = 22;   // px。意味的な所属クラスタを跨がない程度
    const ox = new Float32Array(n);
    const oy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      ox[i] = px[i] = p.x * base.k + base.ox;
      oy[i] = py[i] = p.y * base.k + base.oy;
      pr[i] = radiusOf(p);
    }

    let maxR = 0;
    for (let i = 0; i < n; i++) if (pr[i] > maxR) maxR = pr[i];
    const cell = Math.max(8, maxR * 2 * OVERLAP);

    const ITER = 28;
    for (let it = 0; it < ITER; it++) {
      // 毎回格子を張り直す（点が動くため）
      const grid = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        const key = (Math.floor(py[i] / cell) * 100003) ^ Math.floor(px[i] / cell);
        const bucket = grid.get(key);
        if (bucket) bucket.push(i);
        else grid.set(key, [i]);
      }
      let moved = 0;
      for (let i = 0; i < n; i++) {
        const gx = Math.floor(px[i] / cell);
        const gy = Math.floor(py[i] / cell);
        for (let yy = gy - 1; yy <= gy + 1; yy++) {
          for (let xx = gx - 1; xx <= gx + 1; xx++) {
            const bucket = grid.get((yy * 100003) ^ xx);
            if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              let dx = px[j] - px[i];
              let dy = py[j] - py[i];
              const min = (pr[i] + pr[j]) * OVERLAP;
              let d = Math.hypot(dx, dy);
              if (d >= min) continue;
              if (d < 1e-4) {
                // 完全に同座標の点は決定的な方向へ割る（乱数は使わない＝再現可能）
                const a = ((i * 37 + j * 101) % 360) * (Math.PI / 180);
                dx = Math.cos(a); dy = Math.sin(a); d = 1;
              }
              const push = (min - d) / d * 0.5;
              // 大きい円ほど動かさない（重い）。塊の主が居場所を保つ
              const wi = pr[j] / (pr[i] + pr[j]);
              px[i] -= dx * push * wi;
              py[i] -= dy * push * wi;
              px[j] += dx * push * (1 - wi);
              py[j] += dy * push * (1 - wi);
              moved++;
            }
          }
        }
      }
      // 元位置からの移動量を制限。密集の解消より意味的な位置の保持を優先する
      for (let i = 0; i < n; i++) {
        const dx = px[i] - ox[i];
        const dy = py[i] - oy[i];
        const d = Math.hypot(dx, dy);
        if (d > MAX_SHIFT) {
          const s = MAX_SHIFT / d;
          px[i] = ox[i] + dx * s;
          py[i] = oy[i] + dy * s;
        }
      }
      if (moved === 0) break;
    }
    return { px, py, pr };
  }, [points, base, radiusOf]);

  /**
   * 府省庁の勢力圏。データ空間の格子に各点の重みを撒き（ガウス核）、
   * セルごとの最多府省庁で淡く塗る。スロット外の府省庁は「中立」として
   * 分母にだけ入れる＝優勢と言えない混在地帯は塗らない。
   * 結果は低解像度のオフスクリーンに焼き、描画時に拡大補間して柔らかい色面にする。
   */
  const regions = useMemo(() => {
    if (!showRegions || regionPoints.length === 0 || regionEntries.length === 0) return null;

    const padX = (bounds.maxX - bounds.minX) * 0.05;
    const padY = (bounds.maxY - bounds.minY) * 0.05;
    const x0 = bounds.minX - padX, x1 = bounds.maxX + padX;
    const y0 = bounds.minY - padY, y1 = bounds.maxY + padY;
    const aspect = (y1 - y0) / (x1 - x0);
    const GW = aspect <= 1 ? REGION_GRID : Math.round(REGION_GRID / aspect);
    const GH = aspect <= 1 ? Math.round(REGION_GRID * aspect) : REGION_GRID;

    const nk = regionEntries.length;
    const keyIndex = new Map(regionEntries.map((e, i) => [e.key, i]));
    // [キー0..nk-1, 中立] × セル
    const weights = new Float32Array((nk + 1) * GW * GH);

    // ガウス核（半径2セル）
    const K: Array<[number, number, number]> = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const w = Math.exp(-(dx * dx + dy * dy) / (2 * 1.3 * 1.3));
        if (w > 0.02) K.push([dx, dy, w]);
      }
    }

    for (const p of regionPoints) {
      const key = regionKeyOf(p);
      const ki = key !== null ? (keyIndex.get(key) ?? nk) : nk;
      const cx = Math.floor(((p.x - x0) / (x1 - x0)) * GW);
      const cy = Math.floor(((p.y - y0) / (y1 - y0)) * GH);
      for (const [dx, dy, w] of K) {
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || xx >= GW || yy < 0 || yy >= GH) continue;
        weights[ki * GW * GH + yy * GW + xx] += w;
      }
    }

    let maxTot = 0;
    const totals = new Float32Array(GW * GH);
    for (let c = 0; c < GW * GH; c++) {
      let t = 0;
      for (let ki = 0; ki <= nk; ki++) t += weights[ki * GW * GH + c];
      totals[c] = t;
      if (t > maxTot) maxTot = t;
    }
    if (maxTot === 0) return null;

    const rgb = regionEntries.map(e => hexToRgb(e.color));
    // 0-255。当初36 →「薄すぎて見えない」→ 66 →「もっと濃くていい」で現在値。
    // 点は不透明度~0.8で上に載るので、この濃さでも点の色を邪魔しない
    const baseAlpha = dark ? 130 : 110;
    const img = new ImageData(GW, GH);
    // 各府省庁のピーク（ラベル位置）も同じループで拾う
    const peaks = regionEntries.map(() => ({ w: 0, cx: 0, cy: 0 }));

    for (let cy = 0; cy < GH; cy++) {
      for (let cx = 0; cx < GW; cx++) {
        const c = cy * GW + cx;
        const tot = totals[c];
        if (tot < maxTot * 0.06) continue;   // ほぼ点が無い場所は塗らない
        let best = -1, bw = 0;
        for (let ki = 0; ki < nk; ki++) {
          const w = weights[ki * GW * GH + c];
          if (w > bw) { bw = w; best = ki; }
          if (w > peaks[ki].w) peaks[ki] = { w, cx, cy };
        }
        if (best < 0) continue;
        const share = bw / tot;
        if (share < 0.42) continue;          // 優勢と言えない混在地帯は塗らない
        const strength = Math.min(1, (share - 0.42) / 0.4) * Math.min(1, tot / (maxTot * 0.35));
        const o = c * 4;
        const [r, g, b] = rgb[best];
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b;
        img.data[o + 3] = Math.round(baseAlpha * strength);
      }
    }

    const off = document.createElement('canvas');
    off.width = GW; off.height = GH;
    off.getContext('2d')!.putImageData(img, 0, 0);

    const labels = regionEntries
      .map((e, i) => ({
        label: e.label,
        color: e.color,
        // ピークセル中心 → データ座標
        x: x0 + ((peaks[i].cx + 0.5) / GW) * (x1 - x0),
        y: y0 + ((peaks[i].cy + 0.5) / GH) * (y1 - y0),
        ok: peaks[i].w > 0,
      }))
      .filter(l => l.ok);

    return { off, labels, x0, x1, y0, y1 };
  }, [showRegions, regionPoints, regionEntries, regionKeyOf, bounds, dark]);

  // ── 描画 ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const surface = dark ? SURFACE_DARK : SURFACE_LIGHT;
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, size.w, size.h);

    // 勢力圏（点より先に敷く）
    if (regions) {
      const a = toScreen(regions.x0, regions.y0);
      const b = toScreen(regions.x1, regions.y1);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(regions.off, a.x, a.y, b.x - a.x, b.y - a.y);
    }

    const n = points.length;
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sx[i] = relaxed.px[i] * transform.k + transform.tx;
      sy[i] = relaxed.py[i] * transform.k + transform.ty;
      r[i] = relaxed.pr[i];
    }

    // 大きい順に描く。小さい点が大きい点の下に隠れると、
    // 低予算の事業だけが見えなくなって偏った読み方を誘発する
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => r[b] - r[a]);

    // 強調していない系列は先に薄く敷く。前面/背面を分けることで、
    // 選んだ系列が他の点に埋もれないようにする
    const dimmed: number[] = [];
    const front: number[] = [];
    for (const i of order) {
      if (highlightKey === null || legendKeyOf(points[i]) === highlightKey) front.push(i);
      else dimmed.push(i);
    }

    const draw = (idx: number[], alpha: number, mono: boolean, ring: boolean) => {
      ctx.globalAlpha = alpha;
      for (const i of idx) {
        // 画面外は描かない。全国表示のときにここが効く
        if (sx[i] < -40 || sx[i] > size.w + 40 || sy[i] < -40 || sy[i] > size.h + 40) continue;
        ctx.beginPath();
        ctx.arc(sx[i], sy[i], r[i], 0, Math.PI * 2);
        // 背面の点は色を落とす。薄い色で残すと紙吹雪状のノイズになる
        ctx.fillStyle = mono ? (dark ? '#33332f' : '#e4e3dc') : colorOf(points[i]);
        ctx.fill();
        // 大きい点だけ地の色の細い隙間で区切る。全点に付けるとドーナツ状の網目になる
        if (ring && r[i] >= 5) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = surface;
          ctx.stroke();
        }
      }
    };

    // 背面（強調外）は無彩色で敷く
    draw(dimmed, dark ? 0.6 : 0.7, true, false);
    // 前面は半透明の通常合成。重なりが自然に濃くなり、密度が読める
    draw(front, highlightKey === null ? 0.78 : 0.9, false, true);
    ctx.globalAlpha = 1;

    // 選択中の事業は最前面に輪で示す（色ではなく形で示すので塗り分けと干渉しない）
    if (selectedPid) {
      const i = points.findIndex(p => p.pid === selectedPid);
      if (i >= 0) {
        ctx.beginPath();
        ctx.arc(sx[i], sy[i], Math.max(r[i] + 4, 8), 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = dark ? '#ffffff' : '#0b0b0b';
        ctx.stroke();
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // 勢力圏のラベル（府省庁名）。色面がどの省庁かはこれが無いと分からない
    if (regions) {
      ctx.font = '700 11px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.globalAlpha = highlightKey === null ? 0.85 : 0.4;
      for (const l of regions.labels) {
        const s = toScreen(l.x, l.y);
        if (s.x < 0 || s.x > size.w || s.y < 0 || s.y > size.h) continue;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = surface;
        ctx.strokeText(l.label, s.x, s.y);
        ctx.fillStyle = l.color;
        ctx.fillText(l.label, s.x, s.y);
      }
      ctx.globalAlpha = 1;
    }

    // クラスタ名。塊の真ん中に置く。地の色の太い縁取りで点の上でも読めるようにする。
    // 文字はインク色（データ色を着せない）。強調中は前面の邪魔になるので少し引く
    if (showClusterLabels) {
      ctx.font = '600 10.5px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.globalAlpha = highlightKey === null ? 1 : 0.55;
      for (const c of clusters) {
        const s = toScreen(c.cx, c.cy);
        if (s.x < 0 || s.x > size.w || s.y < 0 || s.y > size.h) continue;
        const text = clusterLabel(c);
        ctx.lineWidth = 4;
        ctx.strokeStyle = surface;
        ctx.strokeText(text, s.x, s.y);
        ctx.fillStyle = dark ? LABEL_DARK : LABEL_LIGHT;
        ctx.fillText(text, s.x, s.y);
      }
      ctx.globalAlpha = 1;
    }

    // 当たり判定用の格子。最近傍を引くので、点の真上に乗せる必要はない
    const grid = new Map<number, number[]>();
    const cols = Math.ceil(size.w / GRID_CELL) + 1;
    for (let i = 0; i < n; i++) {
      if (sx[i] < 0 || sx[i] > size.w || sy[i] < 0 || sy[i] > size.h) continue;
      const key = Math.floor(sy[i] / GRID_CELL) * cols + Math.floor(sx[i] / GRID_CELL);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
    layoutRef.current = { sx, sy, r, grid };
  }, [points, size, transform, toScreen, relaxed, regions, colorOf, legendKeyOf, highlightKey,
      selectedPid, clusters, clusterLabel, showClusterLabels, dark]);

  /** 画面座標から最も近い点を引く。半径ぶん + 余白を許容して当たりを広げる */
  const pick = useCallback((mx: number, my: number): number => {
    const layout = layoutRef.current;
    if (!layout) return -1;
    const { sx, sy, r, grid } = layout;
    const cols = Math.ceil(size.w / GRID_CELL) + 1;
    const cx = Math.floor(mx / GRID_CELL);
    const cy = Math.floor(my / GRID_CELL);

    let best = -1;
    let bestDist = Infinity;
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const bucket = grid.get(gy * cols + gx);
        if (!bucket) continue;
        for (const i of bucket) {
          const d = Math.hypot(sx[i] - mx, sy[i] - my);
          // 小さい点ほど当たりを広げる。2px の点を狙わせない
          const reach = Math.max(r[i] + 4, 11);
          if (d <= reach && d - r[i] < bestDist) {
            bestDist = d - r[i];
            best = i;
          }
        }
      }
    }
    return best;
  }, [size.w]);

  // ── 操作 ──
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const pinchRef = useRef<{ dist: number; k: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());

  const clampZoom = (k: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));

  const zoomAt = useCallback((mx: number, my: number, factor: number) => {
    setTransform(t => {
      const k = clampZoom(t.k * factor);
      const ratio = k / t.k;
      // ポインタの下にある点が動かないように平行移動を補正する
      return { k, tx: mx - (mx - t.tx) * ratio, ty: my - (my - t.ty) * ratio };
    });
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // React の onWheel は passive で preventDefault できず、ページごとスクロールしてしまう
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: transform.k };
      dragRef.current = null;
      return;
    }
    dragRef.current = {
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      tx: transform.tx, ty: transform.ty, moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // 2本指ピンチ
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current.dist > 0) {
        const target = clampZoom(pinchRef.current.k * (dist / pinchRef.current.dist));
        setTransform(t => {
          const ratio = target / t.k;
          const cx = (a.x + b.x) / 2 - rect.left;
          const cy = (a.y + b.y) / 2 - rect.top;
          return { k: target, tx: cx - (cx - t.tx) * ratio, ty: cy - (cy - t.ty) * ratio };
        });
      }
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      const dx = mx - drag.x;
      const dy = my - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.moved) {
        setTransform(t => ({ ...t, tx: drag.tx + dx, ty: drag.ty + dy }));
        onHover(null, null);
        return;
      }
    }

    const i = pick(mx, my);
    onHover(i >= 0 ? points[i] : null, i >= 0 ? { x: mx, y: my } : null);
  };

  const endPointer = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;

    const drag = dragRef.current;
    dragRef.current = null;
    // ドラッグではない＝クリック。選択として扱う
    if (drag && !drag.moved) {
      const i = pick(e.clientX - rect.left, e.clientY - rect.top);
      onSelect(i >= 0 ? points[i] : null);
    }
  };

  const resetView = () => setTransform({ k: 1, tx: 0, ty: 0 });

  return (
    <div className="relative h-full w-full">
      <div
        ref={wrapRef}
        className="h-full w-full touch-none select-none"
        style={{ cursor: dragRef.current?.moved ? 'grabbing' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => onHover(null, null)}
      >
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      </div>

      {/* ズーム操作。右側は凡例のフロートが使うので左下に置く */}
      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-lg border border-black/10 bg-white/90 shadow-sm backdrop-blur dark:border-white/10 dark:bg-neutral-800/90">
        <button
          type="button"
          onClick={() => zoomAt(size.w / 2, size.h / 2, 1.4)}
          className="h-8 w-8 text-[15px] leading-none text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
          aria-label="拡大"
        >＋</button>
        <button
          type="button"
          onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.4)}
          className="h-8 w-8 border-t border-black/5 text-[15px] leading-none text-neutral-600 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10"
          aria-label="縮小"
        >−</button>
        <button
          type="button"
          onClick={resetView}
          className="h-8 w-8 border-t border-black/5 text-[9px] leading-none text-neutral-500 hover:bg-black/5 dark:border-white/10 dark:text-neutral-400 dark:hover:bg-white/10"
          aria-label="表示を戻す"
          title="表示を戻す"
        >全体</button>
      </div>

      {transform.k > 1.05 && (
        <div className="pointer-events-none absolute bottom-3 left-14 rounded-full border border-black/5 bg-white/80 px-2 py-0.5 text-[10px] tabular-nums backdrop-blur dark:border-white/10 dark:bg-neutral-800/80" style={{ color: MUTED }}>
          ×{transform.k.toFixed(1)}
        </div>
      )}
    </div>
  );
}
