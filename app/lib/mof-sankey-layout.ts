/**
 * MOF 予算全体ビューのサンキー配置計算。
 *
 * `/sankey-svg` と同じく自前 SVG で描くため、座標をここで決める。純粋関数で
 * React にも DOM にも依存しない（描画は `client/components/mof-budget/SankeyChart.tsx`）。
 *
 * 対象のグラフは「財源 → 会計 → 使途」の小さな DAG（ノード30本程度）なので、
 * 列は最長経路で決め、列内は生成順に積むだけで足りる。生成順は
 * `mof-sankey-generator.ts` が意図した並び（税目 → その他歳入 → 特会財源…）なので、
 * 値で並べ替えるとかえって読みにくくなる。
 */

import type { SankeyNode, SankeyLink } from '@/types/sankey';

// ノードに添える詳細は図ごとに違う（予算全体ビュー / 階層ビュー）。
// 配置計算は中身を見ないので、型引数でそのまま通す。

export interface MOFLayoutNode<D = unknown> {
  id: string;
  name: string;
  value: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  details?: D;
}

export interface MOFLayoutLink<D = unknown> {
  source: MOFLayoutNode<D>;
  target: MOFLayoutNode<D>;
  value: number;
  /** 送り手側の帯の上端 */
  y0: number;
  /** 受け手側の帯の上端 */
  y1: number;
  width: number;
}

export interface MOFSankeyLayout<D = unknown> {
  nodes: MOFLayoutNode<D>[];
  links: MOFLayoutLink<D>[];
  width: number;
  height: number;
  columnCount: number;
  /** ノードを積んだ結果の実際の高さ（余白込み）。縮尺を決めるのに使う */
  contentHeight: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  nodeWidth: number;
  /** ノード間の最小の空き（px） */
  nodePadding: number;
  /**
   * 列の中身を上下中央に寄せるか。
   * 既定は中央寄せ。階層図のように列ごとの合計が揃う図では上詰めのほうが
   * 帯が水平に流れて読みやすい（/sankey-svg と同じ）。
   */
  align?: 'center' | 'top';
  /**
   * ノード1つが最低限占める縦幅（px）。
   *
   * ラベルだけを下へずらして重なりを避けると、ラベルと箱が離れて引き出し線だらけになる。
   * `/sankey-svg` はノード自体をずらしてラベル1行分の場所を確保する。同じ方式にする。
   * 指定すると列の合計高さが伸びるので、呼び出し側は `contentHeight` を見て縮尺を決める。
   */
  minNodeSlot?: number;
  /**
   * ノードの手前に空ける余白（px）を返す。
   * 集約ノード（「その他」）の前を空けて、実体のあるノードと視覚的に切り離す
   * （`/sankey-svg` の AGGREGATE_BOUNDARY_GAP_PX と同じ狙い）。
   */
  gapBefore?: (node: { id: string; type?: string }) => number;
  /**
   * 列を明示する。階層が固定の図（所管→組織→…）はこちらを使う。
   * 省略時は辺をたどって最長経路で決める。
   */
  columnOf?: (node: { id: string; type?: string }) => number | undefined;
  /**
   * 同じ列に揃えたいノードの判定。最長経路だと離れてしまうものをまとめる用途。
   * 予算全体ビューの会計ノード（一般会計・特別会計・政府関係機関）で使う。
   */
  alignToSameColumn?: (node: { id: string; type?: string }) => boolean;
}

type InputNode<D> = SankeyNode & { name?: string; details?: D };

/**
 * 列を決める。入力の無いノードを 0 とし、辺をたどって最長経路で後ろへ送る。
 * 一般会計 → 特別会計 のように会計どうしを結ぶ辺があるため、
 * 単純な「種別ごとに固定の列」では表せない。
 */
function assignColumns<D>(
  nodes: InputNode<D>[],
  links: SankeyLink[],
  alignToSameColumn?: (node: { id: string; type?: string }) => boolean
): Map<string, number> {
  const column = new Map<string, number>(nodes.map(n => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const link of links) {
    const list = outgoing.get(link.source) ?? [];
    list.push(link.target);
    outgoing.set(link.source, list);
  }
  // ノード数が少ないので、変化が無くなるまで回す素朴な緩和で足りる
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const link of links) {
      const next = (column.get(link.source) ?? 0) + 1;
      if (next > (column.get(link.target) ?? 0)) {
        column.set(link.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // 出口の無いノードは最終列に寄せる（実支出などが中途半端な列に残らないように）
  if (column.size === 0) return column;
  const maxColumn = Math.max(...column.values());
  for (const node of nodes) {
    if (!outgoing.has(node.id)) column.set(node.id, maxColumn);
  }

  // 指定されたノードは、その仲間へ辺を出すものを除いて同じ列に揃える。
  // 予算全体ビューでは、最長経路のままだと 一般会計＝1列目・特別会計＝2列目・
  // 政府関係機関＝1列目 となり、関係の無い政府関係機関が一般会計の隣に並ぶ。
  if (alignToSameColumn) {
    const group = nodes.filter(n => alignToSameColumn({ id: n.id, type: n.type }));
    const groupIds = new Set(group.map(n => n.id));
    const feedsGroup = new Set(
      links.filter(l => groupIds.has(l.target)).map(l => l.source)
    );
    const terminals = group.filter(n => !feedsGroup.has(n.id));
    if (terminals.length > 0) {
      const targetColumn = Math.max(...terminals.map(n => column.get(n.id) ?? 0));
      for (const node of terminals) column.set(node.id, targetColumn);
    }
  }

  return column;
}

/** サンキーの座標を計算する */
export function computeMOFSankeyLayout<D>(
  input: { nodes: InputNode<D>[]; links: SankeyLink[] },
  options: LayoutOptions
): MOFSankeyLayout<D> {
  const { width, height, margin, nodeWidth, nodePadding } = options;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // 列が外から与えられていればそれを使う。階層が固定の図では最長経路より意図が明確で、
  // 値の無い列を素通りした枝（勘定を持たない特別会計など）も正しい列に載る
  const column = options.columnOf
    ? new Map(
        input.nodes.map(n => [n.id, options.columnOf?.({ id: n.id, type: n.type }) ?? 0])
      )
    : assignColumns(input.nodes, input.links, options.alignToSameColumn);
  // ノードが無いと Math.max(...[]) が -Infinity になり、そのまま返ってしまう。
  // 絞り込みで何も残らない場面があるので明示的に0にする
  const columnCount = column.size > 0 ? Math.max(...column.values()) + 1 : 0;

  // 値 → 高さの倍率。いちばん詰まっている列に合わせる
  const byColumn = new Map<number, InputNode<D>[]>();
  for (const node of input.nodes) {
    const col = column.get(node.id) ?? 0;
    const list = byColumn.get(col) ?? [];
    list.push(node);
    byColumn.set(col, list);
  }
  // 値 → 高さの倍率。
  //
  // ラベル1行分の場所（minNodeSlot）は固定 px なので、単純に「合計 ÷ 使える高さ」で
  // 割ると、小さいノードがスロットまで膨らんだ分だけ列が指定より高くなる。
  // スロットに達するノードを固定分として除きながら数回繰り返して収束させる。
  const slot = options.minNodeSlot ?? 0;
  let scale = Infinity;
  for (const [, list] of byColumn) {
    const rows = list.filter(
      n => !(n.details as { passThrough?: boolean } | undefined)?.passThrough
    );
    const total = list.reduce((s, n) => s + (n.value ?? 0), 0);
    const gaps =
      nodePadding * Math.max(rows.length - 1, 0) +
      rows.reduce((s, n) => s + (options.gapBefore?.({ id: n.id, type: n.type }) ?? 0), 0);
    const available = innerH - gaps;
    if (total <= 0 || available <= 0) continue;
    let columnScale = available / total;
    if (slot > 0) {
      for (let pass = 0; pass < 6; pass += 1) {
        const fixed = rows.filter(n => (n.value ?? 0) * columnScale + nodePadding < slot);
        const flexible = list.filter(n => !fixed.includes(n));
        const flexibleTotal = flexible.reduce((s, n) => s + (n.value ?? 0), 0);
        const remaining = available - fixed.length * (slot - nodePadding);
        if (flexibleTotal <= 0 || remaining <= 0) break;
        const next = remaining / flexibleTotal;
        if (Math.abs(next - columnScale) / columnScale < 0.001) break;
        columnScale = next;
      }
    }
    scale = Math.min(scale, columnScale);
  }
  if (!Number.isFinite(scale)) scale = 0;

  const gap = columnCount > 1 ? (innerW - nodeWidth) / (columnCount - 1) : 0;

  const nodes: MOFLayoutNode<D>[] = [];
  const byId = new Map<string, MOFLayoutNode<D>>();
  let contentHeight = height;
  for (const [col, list] of [...byColumn].sort((a, b) => a[0] - b[0])) {
    // 列ごとに合計が違うので、中央寄せにしないと図が傾いて見える。
    // ただし階層図のように列の合計が揃う図では上詰めのほうが帯が水平に流れる
    const used =
      list.reduce((s, n) => s + (n.value ?? 0) * scale, 0) +
      nodePadding * Math.max(list.length - 1, 0);
    let y =
      options.align === 'top'
        ? margin.top
        : margin.top + Math.max((innerH - used) / 2, 0);
    const heightOf = (n: (typeof list)[number]) => Math.max((n.value ?? 0) * scale, 1);
    const isPassThroughNode = (n: (typeof list)[number]) =>
      (n.details as { passThrough?: boolean } | undefined)?.passThrough === true;
    for (let i = 0; i < list.length; i += 1) {
      const node = list[i];
      const isPassThrough = isPassThroughNode(node);
      if (!isPassThrough) {
        y += options.gapBefore?.({ id: node.id, type: node.type }) ?? 0;
      }
      const h = heightOf(node);
      // 通過ノードはラベルも箱も出さないので、スロットも余白も取らない。
      // 取ると素通りの多い列（勘定など）が余白だけで間延びする
      let slot = isPassThrough
        ? h
        : options.minNodeSlot
          ? Math.max(h + nodePadding, options.minNodeSlot)
          : h + nodePadding;
      // ラベルはノードの中心に出るのに、スロットは上端から測る。
      // 高さが不揃いだと「箱は離れているのにラベルは重なる」が起きるので、
      // 次にラベルを出すノードとの中心間隔が1行分に届くまでスロットを広げる。
      //
      //   center_next - center_cur = slot + Σ(間にある通過ノードの高さ) - h/2 + h_next/2
      //
      // 通過ノードはラベルを持たないので飛ばすが、場所は取るのでその分は差し引く。
      // 隣だけを見ると、間に通過ノードが挟まった並びで間隔が足りなくなる。
      if (!isPassThrough && options.minNodeSlot) {
        let passedHeight = 0;
        let next: (typeof list)[number] | undefined;
        for (let k = i + 1; k < list.length; k += 1) {
          if (!isPassThroughNode(list[k])) {
            next = list[k];
            break;
          }
          passedHeight += heightOf(list[k]);
        }
        if (next) {
          slot = Math.max(
            slot,
            options.minNodeSlot + h / 2 - heightOf(next) / 2 - passedHeight
          );
        }
      }
      const placed: MOFLayoutNode<D> = {
        id: node.id,
        name: node.name ?? node.id,
        value: node.value ?? 0,
        column: col,
        x: margin.left + col * gap,
        y,
        width: nodeWidth,
        height: h,
        details: node.details,
      };
      nodes.push(placed);
      byId.set(placed.id, placed);
      y += slot;
    }
    contentHeight = Math.max(contentHeight, y - nodePadding + margin.bottom);
  }

  // 帯の位置。ノードの上端から順に積む。
  //
  // 帯1本ごとに「最低1px」の下限は掛けない。集約ノードのように大量の
  // 細い流れが1点に集まる箱では、本数ぶんの下限がノード自身の高さを
  // 超えてしまい、「帯の集合がノードよりも大きい」という見た目になる
  // （実測: 57本の帯が1pxずつ床上げされ、高さ1pxのノードに57px流れ込む）。
  // 下限を掛けるのはノードの高さだけにして、帯はそこから機械的に
  // 割り付ける。極端に細い帯は見えなくなるが、面積が正しい代わりに
  // 描画が消えるほうが、ノードより帯の集合が膨らむよりまだ誠実である
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const links: MOFLayoutLink<D>[] = [];
  for (const link of input.links) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target) continue;
    const w = link.value * scale;
    const y0 = source.y + (outOffset.get(source.id) ?? 0);
    const y1 = target.y + (inOffset.get(target.id) ?? 0);
    outOffset.set(source.id, (outOffset.get(source.id) ?? 0) + w);
    inOffset.set(target.id, (inOffset.get(target.id) ?? 0) + w);
    links.push({ source, target, value: link.value, y0, y1, width: w });
  }

  return { nodes, links, width, height, columnCount, contentHeight };
}

/** 帯のパス。両端をノードの縁に付け、中間で滑らかに繋ぐ */
export function mofRibbonPath<D>(link: MOFLayoutLink<D>): string {
  const sx = link.source.x + link.source.width;
  const tx = link.target.x;
  const sTop = link.y0;
  const sBot = sTop + link.width;
  const tTop = link.y1;
  const tBot = tTop + link.width;
  const mx = (sx + tx) / 2;
  return (
    `M${sx},${sTop}C${mx},${sTop} ${mx},${tTop} ${tx},${tTop}` +
    `L${tx},${tBot}` +
    `C${mx},${tBot} ${mx},${sBot} ${sx},${sBot}Z`
  );
}
