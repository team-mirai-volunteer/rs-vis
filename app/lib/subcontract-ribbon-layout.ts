import type {
  SubcontractGraph,
  BlockNode,
  BlockOriginKind,
  FlowOrigin,
} from '@/types/subcontract';
import type { BudgetBreakdownItem, BudgetSummary } from '@/types/sankey-svg';
import { computeDepths, mergeParallelFlows } from '@/app/lib/subcontract-layout';
import { INDIRECT_COST_NODE_LABEL, summarizeOffFlowIndirectCosts } from '@/app/lib/subcontracts/indirect-costs';

/** レイアウト入力: 再委託グラフ ＋ API 合成の予算内訳（予算・執行列の描画に使う） */
export type RibbonLayoutInput = SubcontractGraph & {
  budgetBreakdown?: BudgetBreakdownItem[];
  budgetSummary?: BudgetSummary | null;
};

/** 予算・執行列の1ノード（歳出予算項目＝budgetType 単位。緑） */
export interface RibbonBudgetItem {
  label: string;
  amount: number;
  x: number;
  y: number;
  w: number;
  h: number;
  // ホバーツールチップ表示用の会計内訳（本家RSシステムの「予算・執行額」相当）
  accountCategory: string;
  item: string;
  subItem: string;
  note: string;
  nextYearRequestAmount: number;
}

/**
 * B案（サンキー風横フロー・リボン表現）のレイアウト計算。
 *
 * 列 = 深度（col0 = ルート、col1 = 深度1、…）。列内は「縦サブツリー帯（バンド）」で
 * ノードを配置する。これは A案（subcontract-layout.ts）の横方向バンドアルゴリズム
 * （subtreeW/placeSubtree）を縦方向に移植したもの: 各ノードは自分の子孫全体が専有する
 * 縦バンドを持ち、親はバンドの中央に置かれる（単一子の連鎖は真横に一直線になる）。
 *
 * 別財源ブロック（separate-origin 起点）は直接系バンド群と混ざらないよう、下に独立した
 * レーンとして配置する（レーン境界に薄い区切り線・ラベルを描画するための extent を返す）。
 *
 * 既存A案の computeDepths / mergeParallelFlows をそのまま再利用し、深度・エッジのマージ規則を
 * 統一する（同じグラフに対して両ビューが矛盾しないことを保証するため）。
 */

// ─── 定数 ──────────────────────────────────────────────

// バー幅は sankey ノード風にスリム化（app/sankey-svg の NODE_W=18 に準拠する太さ感）。
// 列の内容幅（バー + ラベル領域）と列間ギャップは分けて持つ。列ピッチ = COL_W + COL_GAP
// （sankey の colSpacing = NODE_W + labelSpace 相当の考え方）。
export const RIBBON_BAR_W = 20;
export const RIBBON_LABEL_W = 190;
export const RIBBON_COL_W = RIBBON_BAR_W + RIBBON_LABEL_W;
export const RIBBON_COL_GAP = 40;
// ノード縦間隔は /sankey-svg（NODE_PAD=2）の密な詰め方を参考に小さめに取る
export const RIBBON_ROW_GAP = 6;
// 直接系バンド群と別財源レーンの間の追加ギャップ（通常の兄弟間ギャップより大きく取り、
// 視覚的に「別レーン」であることを示す）
export const RIBBON_LANE_GAP = 28;
// /sankey-svg の computeLayout に合わせ、最低高さは「読みやすさのための下駄」ではなく
// 描画上のハード床（1px）とする。金額差はすべて線形スケールの高さ差として表現する。
export const RIBBON_BAR_MIN_H = 1;
export const RIBBON_MARGIN = { top: 28, right: 36, bottom: 40, left: 36 };
// 列（深度）ごとの合計金額のうち最大のものを、この高さ（px, ギャップ除く）に収める形で
// 線形スケール係数 k を決定する（/sankey-svg の ky 決定＝「最も厳しい列が innerH に収まる
// ky」という考え方を、固定描画キャンバスに単純化して移植したもの）。
export const RIBBON_TARGET_COL_H = 640;

const ROOT_KEY = '__root__';
/** 間接経費ノードの合成キー（ブロックIDと衝突しない前提の予約語） */
export const INDIRECT_NODE_KEY = '__indirect__';

// ─── 型 ──────────────────────────────────────────────

export interface RibbonBar {
  blockId: string;
  blockName: string;
  totalAmount: number;
  originKind: BlockOriginKind;
  isTerminal: boolean;
  isZeroAmount: boolean;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  node: BlockNode;
}

export interface RibbonRoot {
  label: string;
  x: number;
  y: number;
  w: number;
  /** 事業ノードでは支出側(右・オレンジ)の高さ。予算内訳ノードでは通常の高さ */
  h: number;
  /** 事業ノードのみ: 予算側(左・緑)の高さ。h(支出) と別（メインの mergedProjectPath 相当のドッキング） */
  budgetH?: number;
  /** 事業ノードのみ: 予算総額・支出額（左右のラベル用） */
  budgetAmount?: number;
  spendingAmount?: number;
}

/** 順方向フロー（col間を繋ぐ帯）。両端の太さは接続先バーの高さから配分され、異なる値を取り得る（テーパー付き） */
export interface RibbonFlow {
  sourceBlock: string | null;
  targetBlock: string;
  origin: FlowOrigin;
  isReference: boolean;
  note?: string;
  targetIncomingBlockCount: number;
  /** 推定流量（円）。target の totalAmount を親間分配した値 — targetThickness と同じ根拠（share）から
   *  ピクセルスケール(k)を介さずに直接算出するため、床(RIBBON_BAR_MIN_H)による丸め誤差を含まない */
  amount: number;
  x1: number;
  y1Top: number;
  y1Bot: number;
  x2: number;
  y2Top: number;
  y2Bot: number;
}

/** バックエッジ・自己ループ（細線・簡略表現） */
export interface RibbonBackEdge {
  sourceBlock: string | null;
  targetBlock: string;
  origin: FlowOrigin;
  isReference: boolean;
  note?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isSelfLoop: boolean;
}

/**
 * 間接経費の終端ノード（支出先を持たない支出。深度1列の最下段・グレー）。
 * ブロックではないため bars/flows とは別枠で返す（blockId を持つ前提のロジックを汚さない）
 */
export interface RibbonIndirectNode {
  /** ラベル衝突回避シフト等でブロックIDと同じ Map に載せるための合成キー */
  key: string;
  label: string;
  amount: number;
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 別財源レーンの縦方向の範囲（区切り線・ラベル描画用）。別財源ブロックが無ければ null */
export interface RibbonSeparateLane {
  top: number;
  bottom: number;
}

export interface SubcontractRibbonLayout {
  /** 予算・執行列（最左）。歳出予算項目ごとの緑ノード。事業ノードの予算側へ流入する */
  budgetItems: RibbonBudgetItem[];
  /** 予算→事業(予算側) のリボン。budgetItems[i] に対応 */
  budgetFlows: { x1: number; y1Top: number; y1Bot: number; x2: number; y2Top: number; y2Bot: number }[];
  root: RibbonRoot;
  bars: RibbonBar[];
  flows: RibbonFlow[];
  /** 間接経費の終端ノード（金額0・記録なしなら null） */
  indirectNode: RibbonIndirectNode | null;
  /** 事業ノード(支出側) → 間接経費ノード のリボン。indirectNode が null なら null */
  indirectFlow: { x1: number; y1Top: number; y1Bot: number; x2: number; y2Top: number; y2Bot: number } | null;
  backEdges: RibbonBackEdge[];
  separateLane: RibbonSeparateLane | null;
  svgWidth: number;
  svgHeight: number;
  maxAmount: number;
  /** Σ子への流出額推定が親バー高さを超えたため比例圧縮したブロック数（データ不整合の検知用。通常0） */
  sourceOverflowCount: number;
}

// ─── スケール関数 ──────────────────────────────────────────────

/**
 * 金額 → バー高さ / リボン太さ（線形スケール）。/sankey-svg の
 * `Math.max(1, node.value * ky)` と同じ考え方: 金額差はすべて高さの線形比に反映し、
 * 最低高さは「読みやすさの下駄」ではなくハード床（1px）に留める。
 */
export function ribbonAmountScale(amount: number, k: number): number {
  return Math.max(RIBBON_BAR_MIN_H, Math.max(0, amount) * k);
}

/**
 * 線形スケール係数 k の決定。「列（深度）ごとの合計金額が最大の列」が
 * RIBBON_TARGET_COL_H に収まるように k を選ぶ（/sankey-svg の ky 決定の簡略移植）。
 * 全ブロックが 0 円（制度フローのみ等）の場合は k=1 にフォールバックする
 * （その場合は全バーが RIBBON_BAR_MIN_H の床に張り付く）。
 */
export function computeRibbonK(byDepth: Map<number, BlockNode[]>, extraColTotal = 0, depth1Extra = 0): number {
  let maxColTotal = Math.max(0, extraColTotal); // 予算・執行列（予算総額）も列合計の最大候補に含める
  // depth1Extra: 深度1列に置く非ブロックノード（間接経費の終端ノード）の金額。
  // 加算しないと深度1列の実描画高さが RIBBON_TARGET_COL_H を超える
  for (const [depth, nodes] of byDepth) {
    const total = nodes.reduce((s, n) => s + Math.max(0, n.totalAmount), 0)
      + (depth === 1 ? Math.max(0, depth1Extra) : 0);
    if (total > maxColTotal) maxColTotal = total;
  }
  if (byDepth.size === 0 && depth1Extra > 0 && depth1Extra > maxColTotal) maxColTotal = depth1Extra;
  if (maxColTotal <= 0) return 1;
  return RIBBON_TARGET_COL_H / maxColTotal;
}

// ─── パス生成 ──────────────────────────────────────────────

/** サンキー風の帯（一定太さ、両端をベジェで滑らかに繋ぐ塗りパス） */
export function ribbonFlowPath(x1: number, y1Top: number, y1Bot: number, x2: number, y2Top: number, y2Bot: number): string {
  const cx = (x1 + x2) / 2;
  return [
    `M ${x1} ${y1Top}`,
    `C ${cx} ${y1Top}, ${cx} ${y2Top}, ${x2} ${y2Top}`,
    `L ${x2} ${y2Bot}`,
    `C ${cx} ${y2Bot}, ${cx} ${y1Bot}, ${x1} ${y1Bot}`,
    'Z',
  ].join(' ');
}

/** バックエッジ: 上方を迂回する弧（水平フロー前提。左右どちら向きでも上を通す） */
export function ribbonBackEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const arcY = Math.min(y1, y2) - 40;
  return `M ${x1} ${y1} C ${x1} ${arcY}, ${x2} ${arcY}, ${x2} ${y2}`;
}

/** 自己ループ: バー右端の小さな弧 */
export function ribbonSelfLoopPath(x: number, y: number): string {
  const r = 20;
  return `M ${x - 6} ${y} C ${x - r} ${y - r * 2}, ${x + r} ${y - r * 2}, ${x + 6} ${y}`;
}

// ─── ラベル文字幅の概算・切り詰め ──────────────────────────────────────────────
// SVG <text> は実測なしに文字幅がわからないため、全角/半角の概算係数で近似する。
// 太字（選択・ホバー時）でも崩れないよう、両係数にわずかな安全マージンを乗せてある。
const LABEL_FULLWIDTH_COEF = 1.05;
const LABEL_HALFWIDTH_COEF = 0.58;

/** 文字幅の概算合計（px）。全角=fontSize×約1.0 / 半角=fontSize×約0.55 相当（太字向けに少し余裕を持たせた係数） */
export function estimateLabelWidth(text: string, fontSizePx: number): number {
  let width = 0;
  for (const ch of text) {
    const isFullWidth = ch.charCodeAt(0) > 0xff;
    width += fontSizePx * (isFullWidth ? LABEL_FULLWIDTH_COEF : LABEL_HALFWIDTH_COEF);
  }
  return width;
}

/**
 * 「名前 (金額)」形式のラベルで、金額部分（amountText、例: " (1,234億円)"）を必ず収めた上で
 * 名前部分だけを切り詰める。名前が収まらない場合は末尾を "…" にして詰める。
 * 金額側は呼び出し側でそのまま描画すること（この関数は名前部分のみ返す）。
 */
export function truncateRibbonLabelName(
  name: string,
  amountText: string,
  maxWidth: number,
  fontSizePx: number,
): string {
  const amountWidth = estimateLabelWidth(amountText, fontSizePx);
  const nameBudget = Math.max(0, maxWidth - amountWidth);
  if (estimateLabelWidth(name, fontSizePx) <= nameBudget) return name;
  const ellipsisWidth = estimateLabelWidth('…', fontSizePx);
  let acc = '';
  let w = 0;
  for (const ch of name) {
    const chWidth = estimateLabelWidth(ch, fontSizePx);
    if (w + chWidth + ellipsisWidth > nameBudget) break;
    acc += ch;
    w += chWidth;
  }
  return `${acc}…`;
}

// ─── メインレイアウト関数 ──────────────────────────────────────────────

export function computeSubcontractRibbonLayout(graph: RibbonLayoutInput): SubcontractRibbonLayout {
  const depthMap = computeDepths(graph.flows); // blockId -> depth(>=1)。root は depth 0 相当（別管理）
  // 予算・執行列（最左）: 歳出予算項目を緑ノードに。並びは本家RSシステムの「予算・執行額」表と
  // 同じくレコード順（データ登録順）を尊重し、金額でのソートはしない。予算総額は事業ノードの予算側の高さになる
  const budgetBreakdown = (graph.budgetBreakdown ?? []).filter((b) => b.amount > 0);
  // 予算総額は「実際に描画する予算内訳ノードの合計」を採用する（budgetSummary.totalBudget を
  // 優先すると、公式合計と内訳合計がズレる事業で funnel が root.budgetH まで届かず緑側に隙間が
  // できたり、逆にはみ出したりする）。公式合計との差分は側パネル側で別途警告表示している。
  const budgetTotal = budgetBreakdown.reduce((s, b) => s + b.amount, 0);
  const mergedFlows = mergeParallelFlows(graph.flows);

  const blockById = new Map<string, BlockNode>();
  for (const b of graph.blocks) blockById.set(b.blockId, b);

  // 深さ別グループ化
  const byDepth = new Map<number, BlockNode[]>();
  for (const [blockId, depth] of depthMap) {
    const node = blockById.get(blockId);
    if (!node) continue;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(node);
  }

  // 「直接系(direct/subcontract)」か「別財源系」かの判定。別財源レーンを直接系バンド群の
  // 下に独立配置するための分類に使う（A案の originRank と同じ規則を踏襲）
  const isSeparateOriginKind = (k: BlockOriginKind): boolean =>
    k === 'separate-origin-strong' || k === 'separate-origin-broad';
  const originRank = (k: BlockOriginKind): number => (isSeparateOriginKind(k) ? 1 : 0);

  // depth1: 「direct/subcontract 群 → 別起点群」の順、各群内は金額降順（A案と同じ規則）
  const depth1Nodes = [...(byDepth.get(1) ?? [])].sort((a, b) => {
    const r = originRank(a.originKind) - originRank(b.originKind);
    return r !== 0 ? r : b.totalAmount - a.totalAmount;
  });

  // 即時親（順方向エッジのみ: sourceDepth < targetDepth）
  const immediateParents = new Map<string, string[]>();
  for (const f of mergedFlows) {
    if (f.sourceBlock === null) continue;
    const sd = depthMap.get(f.sourceBlock) ?? -1;
    const td = depthMap.get(f.targetBlock) ?? -1;
    if (sd >= td) continue;
    if (!immediateParents.has(f.targetBlock)) immediateParents.set(f.targetBlock, []);
    immediateParents.get(f.targetBlock)!.push(f.sourceBlock);
  }

  // fan-in は最大金額の親に所属させ、子は親内で金額降順に並べる（A案と同じ規則）。
  // 順方向の親が特定できないノード（バックエッジ経由の到達等）は orphan として
  // 自分の originKind に応じたグループの末尾に独立バンドで置く
  const maxDepthVal = depthMap.size > 0 ? Math.max(...depthMap.values()) : 1;
  const childrenOf = new Map<string, BlockNode[]>();
  const directOrphans: BlockNode[] = [];
  const separateOrphans: BlockNode[] = [];
  for (let depth = 2; depth <= maxDepthVal; depth++) {
    for (const node of byDepth.get(depth) ?? []) {
      const parents = immediateParents.get(node.blockId) ?? [];
      if (parents.length === 0) {
        (isSeparateOriginKind(node.originKind) ? separateOrphans : directOrphans).push(node);
        continue;
      }
      let bestParentId = parents[0];
      let bestAmount = -Infinity;
      for (const pid of parents) {
        const amt = blockById.get(pid)?.totalAmount ?? -Infinity;
        if (amt > bestAmount) { bestAmount = amt; bestParentId = pid; }
      }
      if (!childrenOf.has(bestParentId)) childrenOf.set(bestParentId, []);
      childrenOf.get(bestParentId)!.push(node);
    }
  }
  for (const kids of childrenOf.values()) kids.sort((a, b) => b.totalAmount - a.totalAmount);

  // ─── 縦サブツリー帯（バンド）配置 ──────────────────────────────────
  // A案のサブツリー帯配置（subtreeW/placeSubtree）を縦方向に移植したもの。
  // 各トップレベルノード（depth1 または orphan）は、自分の子孫全体が専有する縦バンドを持つ。
  // 親は自分のバンドの中央に置かれる（単一子の連鎖は真横に一直線になる）。
  const maxAmount = Math.max(0, ...graph.blocks.map((b) => b.totalAmount));
  // 間接経費（支出先ブロックを持たない＝フローに現れない支出）。深度1列の最下段に終端ノードとして置く
  const indirect = summarizeOffFlowIndirectCosts(graph.indirectCosts);
  const hasIndirectNode = indirect.total > 0;
  const k = computeRibbonK(byDepth, budgetTotal, hasIndirectNode ? indirect.total : 0);
  const barH = (node: BlockNode): number => ribbonAmountScale(node.totalAmount, k);

  // ─── フロー分類（順方向 / バックエッジ）とテーパー太さ配分 ──────────────────────
  // バー高さ（平方根スケール）とリボン太さを両端で厳密一致させるため、エッジ太さは
  // 「出口側は source バーの高さを子の totalAmount 比で配分」「入口側は target バーの
  // 高さを流入元の totalAmount 比で配分」の2パスで計算する（/sankey-svg の
  // computeLayout の sy/ty カーソル配分と同じ考え方: proportion = value/total,
  // nodeHeight * proportion をカーソルに積み上げる。ギャップは入れない）。
  // ルート（source===null）は自身の高さが未確定のため、出口側は入口側の配分値を
  // そのまま引き継ぐ（= ルートバー高さは「配分後の出口リボン太さ合計」として事後的に決まる）。
  const getDepth = (blockId: string | null) => (blockId === null ? 0 : depthMap.get(blockId) ?? -1);

  type FlowRef = (typeof mergedFlows)[number];
  type Classified = { flow: FlowRef; isSelfLoop: boolean; isBackEdge: boolean };
  const classified: Classified[] = mergedFlows
    // バーが必ず存在する対象のみ（bars は byDepth=depthMap∩blockById から構築される）。
    // source 側も同条件で守る: バー未生成の source を持つフローを通すと sd=-1 で順方向扱いになり、
    // ルート起点のリボンとして誤描画される（target 唯一の流入なら全高を占める）ため除外する
    .filter((f) =>
      depthMap.has(f.targetBlock) && blockById.has(f.targetBlock)
      && (f.sourceBlock === null || (depthMap.has(f.sourceBlock) && blockById.has(f.sourceBlock))))
    .map((f) => {
      const isSelfLoop = f.sourceBlock === f.targetBlock;
      const sd = getDepth(f.sourceBlock);
      const td = getDepth(f.targetBlock);
      const isBackEdge = isSelfLoop || (f.sourceBlock !== null && sd > td);
      return { flow: f, isSelfLoop, isBackEdge };
    });

  const forwardFlows = classified.filter((c) => !c.isBackEdge).map((c) => c.flow);
  const backFlowsClassified = classified.filter((c) => c.isBackEdge);

  const targetThickness = new Map<FlowRef, number>();
  const sourceThickness = new Map<FlowRef, number>();
  // 推定流量（円）。ピクセル太さ(targetThickness)と同じ share から直接算出（k を介さないため
  // RIBBON_BAR_MIN_H の床による丸め誤差を含まない、ツールチップ表示用の実額推定）
  const flowAmountEstimate = new Map<FlowRef, number>();

  // 入口側: target バーの高さを、流入元（source）の totalAmount 比で配分。
  // ルートが唯一の流入元の場合は target 自身の totalAmount を重みとして使う（配分比 1）
  const byTarget = new Map<string, FlowRef[]>();
  for (const f of forwardFlows) {
    if (!byTarget.has(f.targetBlock)) byTarget.set(f.targetBlock, []);
    byTarget.get(f.targetBlock)!.push(f);
  }
  for (const [targetId, fs] of byTarget) {
    const targetNode = blockById.get(targetId);
    if (!targetNode) continue;
    const targetH = barH(targetNode);
    const weights = fs.map((f) => (f.sourceBlock ? blockById.get(f.sourceBlock)?.totalAmount ?? 0 : targetNode.totalAmount));
    const totalWeight = weights.reduce((s, w) => s + Math.max(0, w), 0);
    fs.forEach((f, i) => {
      const w = Math.max(0, weights[i]);
      const share = totalWeight > 0 ? w / totalWeight : 1 / fs.length;
      targetThickness.set(f, targetH * share);
      flowAmountEstimate.set(f, targetNode.totalAmount * share);
    });
  }

  // 出口側: リボン太さは「流れる金額」の推定値（= 入口側で計算済みの targetThickness、
  // 線形スケール下では両端で同じ値になる）をそのまま使う。source バーの高さいっぱいに
  // 正規化して埋め尽くすことはしない — 直接委託の金額と再委託金額は一致するとは限らない
  // ため、Σ子への流出額 < 親バー高さのときは親バーの上部からのみリボンが出て、
  // 下部は空白（= 再委託していない直接執行分）として残るのが正しい表現。
  // 例外: Σ子への流出額推定 > 親バー高さ（データ不整合）の場合のみ、はみ出しではなく
  // 比例圧縮でフォールバックする（sourceOverflowCount で件数を計上）。
  const bySource = new Map<string, FlowRef[]>();
  for (const f of forwardFlows) {
    const key = f.sourceBlock ?? ROOT_KEY;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(f);
  }
  let sourceOverflowCount = 0;
  for (const [sourceKey, fs] of bySource) {
    if (sourceKey === ROOT_KEY) {
      for (const f of fs) sourceThickness.set(f, targetThickness.get(f) ?? 0);
      continue;
    }
    const sourceNode = blockById.get(sourceKey);
    if (!sourceNode) continue;
    const sourceH = barH(sourceNode);
    const rawThicknesses = fs.map((f) => Math.max(0, targetThickness.get(f) ?? 0));
    const sumRaw = rawThicknesses.reduce((s, v) => s + v, 0);
    if (sumRaw > sourceH && sumRaw > 0) {
      sourceOverflowCount++;
      const scale = sourceH / sumRaw;
      fs.forEach((f, i) => sourceThickness.set(f, rawThicknesses[i] * scale));
    } else {
      fs.forEach((f, i) => sourceThickness.set(f, rawThicknesses[i]));
    }
  }

  const subtreeH = new Map<string, number>();
  const calcSubtreeH = (node: BlockNode): number => {
    const kids = childrenOf.get(node.blockId) ?? [];
    const h = kids.length === 0
      ? barH(node)
      : Math.max(barH(node), kids.reduce((sum, k) => sum + calcSubtreeH(k), 0) + RIBBON_ROW_GAP * (kids.length - 1));
    subtreeH.set(node.blockId, h);
    return h;
  };

  const nodeY = new Map<string, number>();
  const placeSubtree = (node: BlockNode, bandTop: number): void => {
    // メイン画面（/sankey-svg）と同じく列ごとに上端（bandTop）から Top揃えで積む。
    // 親を子サブツリーの縦中央に寄せる方式はやめ、親も子も各自のバンド上端に置く。
    nodeY.set(node.blockId, bandTop);
    let cursor = bandTop;
    for (const kid of childrenOf.get(node.blockId) ?? []) {
      placeSubtree(kid, cursor);
      cursor += (subtreeH.get(kid.blockId) ?? barH(kid)) + RIBBON_ROW_GAP;
    }
  };

  // 直接系グループ（direct/subcontract の depth1 + orphan）を上から詰める
  const directTopLevel = [...depth1Nodes.filter((n) => !isSeparateOriginKind(n.originKind)), ...directOrphans];
  let bandCursor = RIBBON_MARGIN.top;
  for (const node of directTopLevel) {
    calcSubtreeH(node);
    placeSubtree(node, bandCursor);
    bandCursor += subtreeH.get(node.blockId)! + RIBBON_ROW_GAP;
  }
  // 間接経費ノードは直接系バンド群の最下段（別財源レーンより上）。x は CONTENT_BASE_X 確定後に決める
  const indirectH = hasIndirectNode ? ribbonAmountScale(indirect.total, k) : 0;
  const indirectY = bandCursor;
  if (hasIndirectNode) bandCursor += indirectH + RIBBON_ROW_GAP;
  const directBandBottom = directTopLevel.length > 0 || hasIndirectNode
    ? bandCursor - RIBBON_ROW_GAP
    : RIBBON_MARGIN.top;

  // ルート（col0）: 他ノードと同じスリムバー。高さ = 出口リボン太さの合計（テーパー配分の
  // パススルー値。上のフロー分類パスで計算済み）。列ごとTop揃えのため上端に配置する。
  // 最小高さのみ RIBBON_BAR_MIN_H を確保する（通常は流出フローが必ず1本以上あるため未使用）
  const hasDirectBand = directTopLevel.length > 0 || hasIndirectNode;
  const rootOutgoing = bySource.get(ROOT_KEY) ?? [];
  // ブロック向け流出の合計。間接経費リボンはこの下に積むため、開始位置の基準にもなる
  const rootBlockOutH = rootOutgoing.reduce((sum, f) => sum + (sourceThickness.get(f) ?? 0), 0);
  // 事業ノードの支出側は「支出先ブロックへの流出 ＋ 間接経費」= 図として金が閉じる高さ
  const rootH = Math.max(RIBBON_BAR_MIN_H, rootBlockOutH + indirectH);
  const hasBudgetCol = budgetBreakdown.length > 0 && budgetTotal > 0;
  // 予算・執行ノード列がある場合のみ、事業(root)以降を1列右へずらす基準x。
  // 予算データが無い事業では左端に余分な空列を作らず root を最左に置く。
  const CONTENT_BASE_X = hasBudgetCol ? RIBBON_MARGIN.left + RIBBON_COL_W + RIBBON_COL_GAP : RIBBON_MARGIN.left;
  const budgetH = hasBudgetCol ? Math.max(rootH, budgetTotal * k) : 0;
  // 事業(root)・予算列も列ごとTop揃えに合わせ、上端から配置する（中央寄せしない）。
  const rootY = RIBBON_MARGIN.top;
  // 事業ノード: メインの mergedProjectPath 相当。予算(左・緑, budgetH)＋支出(右・オレンジ, rootH)の結合。
  // 幅は 2*RIBBON_BAR_W（左半分=予算, 右半分=支出）。支出側(右)から blocks へ流出する
  const root: RibbonRoot = {
    label: graph.projectName,
    x: CONTENT_BASE_X,
    w: hasBudgetCol ? RIBBON_BAR_W * 2 : RIBBON_BAR_W,
    y: rootY,
    h: rootH,
    budgetH: hasBudgetCol ? budgetH : undefined,
    budgetAmount: hasBudgetCol ? budgetTotal : undefined,
    spendingAmount: hasBudgetCol ? graph.execution : undefined,
  };
  // 予算・執行列（最左・緑）: 歳出予算項目を上から積む（合計高さ = budgetH = budgetTotal*k）
  const budgetItems: RibbonBudgetItem[] = [];
  const budgetFlows: SubcontractRibbonLayout['budgetFlows'] = [];
  if (hasBudgetCol) {
    // ブロック列と同じ RIBBON_ROW_GAP を予算内訳ノード間にも入れて詰め方を揃える。
    // ノード群は事業ノードの緑側(高さ budgetH)より縦に広がるため、フローは金額按分で
    // 緑側へ収束（ファネル）させる（メインの sankey と同じ流儀）。
    let cursor = rootY;
    let cumAmount = 0;
    for (const bi of budgetBreakdown) {
      const h = Math.max(RIBBON_BAR_MIN_H, bi.amount * k);
      budgetItems.push({
        label: bi.budgetType || '—', amount: bi.amount, x: RIBBON_MARGIN.left, y: cursor, w: RIBBON_BAR_W, h,
        accountCategory: bi.accountCategory, item: bi.item, subItem: bi.subItem, note: bi.note, nextYearRequestAmount: bi.nextYearRequestAmount,
      });
      // 予算内訳ノード右端 → 事業(予算側=左端 root.x)。事業側の着地は金額按分位置に収束
      const y2Top = rootY + (cumAmount / budgetTotal) * budgetH;
      const y2Bot = rootY + ((cumAmount + bi.amount) / budgetTotal) * budgetH;
      budgetFlows.push({ x1: RIBBON_MARGIN.left + RIBBON_BAR_W, y1Top: cursor, y1Bot: cursor + h, x2: root.x, y2Top, y2Bot });
      cursor += h + RIBBON_ROW_GAP;
      cumAmount += bi.amount;
    }
  }

  // 間接経費の終端ノード（深度1列・最下段）と、事業ノード支出側からのリボン。
  // リボンはブロック向け流出をすべて積んだ「後」に置く（ノード縦位置と出口順を揃える）
  const depth1ColX = CONTENT_BASE_X + (RIBBON_COL_W + RIBBON_COL_GAP);
  const indirectNode: RibbonIndirectNode | null = hasIndirectNode
    ? {
        key: INDIRECT_NODE_KEY,
        label: INDIRECT_COST_NODE_LABEL,
        amount: indirect.total,
        count: indirect.count,
        x: depth1ColX,
        y: indirectY,
        w: RIBBON_BAR_W,
        h: indirectH,
      }
    : null;
  const indirectFlow = indirectNode
    ? {
        x1: root.x + root.w,
        y1Top: root.y + rootBlockOutH,
        y1Bot: root.y + rootBlockOutH + indirectH,
        x2: indirectNode.x,
        y2Top: indirectNode.y,
        y2Bot: indirectNode.y + indirectH,
      }
    : null;

  // 別財源グループ（separate-origin の depth1 + orphan）を、直接系グループ（バー・ルート
  // カードの両方）の下に追加ギャップを空けて独立レーンとして配置する
  const separateTopLevel = [...depth1Nodes.filter((n) => isSeparateOriginKind(n.originKind)), ...separateOrphans];
  let separateLane: RibbonSeparateLane | null = null;
  if (separateTopLevel.length > 0) {
    // 事業ノードは top 揃えの結合形状で、緑側(budgetH)が支出側(h)より下へ伸び得るため、
    // 別財源レーンは root.h ではなく max(h, budgetH) の下端を基準に配置して重なりを防ぐ。
    const directContentBottom = Math.max(directBandBottom, hasDirectBand ? root.y + Math.max(root.h, root.budgetH ?? 0) : RIBBON_MARGIN.top);
    bandCursor = directContentBottom + RIBBON_LANE_GAP;
    const laneTop = bandCursor;
    for (const node of separateTopLevel) {
      calcSubtreeH(node);
      placeSubtree(node, bandCursor);
      bandCursor += subtreeH.get(node.blockId)! + RIBBON_ROW_GAP;
    }
    separateLane = { top: laneTop - RIBBON_LANE_GAP / 2, bottom: bandCursor - RIBBON_ROW_GAP };
  }

  // 線形スケール係数 k（バー高さ・リボン太さの共通スケール基準）は上で算出済み

  // 列ごとに x 座標のみ決定（y は band 配置で決まっている）
  const bars: RibbonBar[] = [];
  const barByBlockId = new Map<string, RibbonBar>();
  for (const [depth, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const colX = CONTENT_BASE_X + depth * (RIBBON_COL_W + RIBBON_COL_GAP);
    for (const node of nodes) {
      const h = barH(node);
      const y = nodeY.get(node.blockId) ?? RIBBON_MARGIN.top;
      const bar: RibbonBar = {
        blockId: node.blockId,
        blockName: node.blockName,
        totalAmount: node.totalAmount,
        originKind: node.originKind,
        isTerminal: node.isTerminal,
        isZeroAmount: node.totalAmount === 0 && node.recipientCount === 0,
        depth,
        x: colX,
        y,
        w: RIBBON_BAR_W,
        h,
        node,
      };
      bars.push(bar);
      barByBlockId.set(node.blockId, bar);
    }
  }

  // ─── フロー（順方向・バックエッジ）の描画用データ組み立て ──────────────────────
  // 太さ配分（targetThickness/sourceThickness）は上のフロー分類パスで計算済み。
  // ここでは「各バーの入口・出口カーソルに、両端の配分値でテーパー付き帯を積む」だけを行う。
  const getBarTop = (blockId: string | null) => (blockId === null ? root.y : barByBlockId.get(blockId)?.y ?? 0);

  // クロッシングを抑えるため、送出元の y → 送出先の y の順で安定ソートしてからカーソルを送る。
  // fan-in（合流）は「ターゲットの入口カーソルに source の y 順で積む」ことで実現される
  const sortedForward = [...forwardFlows].sort((a, b) => {
    const say = getBarTop(a.sourceBlock);
    const sby = getBarTop(b.sourceBlock);
    if (say !== sby) return say - sby;
    return getBarTop(a.targetBlock) - getBarTop(b.targetBlock);
  });

  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const flows: RibbonFlow[] = [];

  for (const f of sortedForward) {
    const targetBar = barByBlockId.get(f.targetBlock);
    if (!targetBar) continue;
    const sourceKey = f.sourceBlock ?? ROOT_KEY;
    const sourceRightX = f.sourceBlock === null ? root.x + root.w : (barByBlockId.get(f.sourceBlock)?.x ?? root.x) + RIBBON_BAR_W;
    const sourceTopDefault = f.sourceBlock === null ? root.y : barByBlockId.get(f.sourceBlock)?.y ?? root.y;

    // テーパー: 出口側(y1)と入口側(y2)で別々の太さを使う。両端ともバー高さぴったりに
    // 積み上がるよう配分済み（ギャップなしでカーソルを積む。sankeyのリンク積み方と同じ）
    const srcThick = Math.max(0, sourceThickness.get(f) ?? 0);
    const tgtThick = Math.max(0, targetThickness.get(f) ?? 0);

    const y1Top = outCursor.get(sourceKey) ?? sourceTopDefault;
    const y1Bot = y1Top + srcThick;
    outCursor.set(sourceKey, y1Bot);

    const y2Top = inCursor.get(f.targetBlock) ?? targetBar.y;
    const y2Bot = y2Top + tgtThick;
    inCursor.set(f.targetBlock, y2Bot);

    flows.push({
      sourceBlock: f.sourceBlock,
      targetBlock: f.targetBlock,
      origin: f.origin,
      isReference: f.isReference,
      note: f.note,
      targetIncomingBlockCount: f.targetIncomingBlockCount,
      amount: flowAmountEstimate.get(f) ?? 0,
      x1: sourceRightX,
      y1Top,
      y1Bot,
      x2: targetBar.x,
      y2Top,
      y2Bot,
    });
  }

  const backEdges: RibbonBackEdge[] = backFlowsClassified.map(({ flow: f, isSelfLoop }) => {
    const targetBar = barByBlockId.get(f.targetBlock)!;
    if (isSelfLoop) {
      const x = targetBar.x + RIBBON_BAR_W;
      const y = targetBar.y + targetBar.h / 2;
      return {
        sourceBlock: f.sourceBlock,
        targetBlock: f.targetBlock,
        origin: f.origin,
        isReference: f.isReference,
        note: f.note,
        x1: x, y1: y, x2: x, y2: y,
        isSelfLoop: true,
      };
    }
    const sourceBar = f.sourceBlock ? barByBlockId.get(f.sourceBlock) : null;
    const x1 = sourceBar ? sourceBar.x : root.x;
    const y1 = sourceBar ? sourceBar.y + sourceBar.h / 2 : root.y + root.h / 2;
    return {
      sourceBlock: f.sourceBlock,
      targetBlock: f.targetBlock,
      origin: f.origin,
      isReference: f.isReference,
      note: f.note,
      x1,
      y1,
      x2: targetBar.x,
      y2: targetBar.y + targetBar.h / 2,
      isSelfLoop: false,
    };
  });

  // SVGサイズ
  // 間接経費ノードのみでブロックが1件も無い事業でも、深度1列を含む幅を確保する
  const maxColDepth = Math.max(
    byDepth.size > 0 ? Math.max(...byDepth.keys()) : 0,
    indirectNode ? 1 : 0,
  );
  const maxRight = CONTENT_BASE_X + (maxColDepth + 1) * (RIBBON_COL_W + RIBBON_COL_GAP) - RIBBON_COL_GAP + RIBBON_MARGIN.right;
  const maxBottomBars = bars.length > 0 ? Math.max(...bars.map((b) => b.y + b.h)) : 0;
  const maxBudgetBottom = budgetItems.length > 0 ? Math.max(...budgetItems.map((b) => b.y + b.h)) : 0;
  const maxIndirectBottom = indirectNode ? indirectNode.y + indirectNode.h : 0;
  const maxBottom = Math.max(maxBottomBars, maxBudgetBottom, maxIndirectBottom, root.y + Math.max(root.h, root.budgetH ?? 0), RIBBON_MARGIN.top + 100) + RIBBON_MARGIN.bottom;

  return {
    budgetItems,
    budgetFlows,
    root,
    bars,
    flows,
    indirectNode,
    indirectFlow,
    backEdges,
    separateLane,
    svgWidth: Math.max(maxRight, RIBBON_MARGIN.left + RIBBON_COL_W + RIBBON_MARGIN.right),
    svgHeight: maxBottom,
    maxAmount,
    sourceOverflowCount,
  };
}
