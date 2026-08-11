/**
 * highlights（注目シグナル）計算結果の年度別メモリキャッシュ。
 *
 * パイプライン新設はせず、既存のロード済みキャッシュ（loadSankeyGraph・loadQualityScores）を
 * 入力に in-process で computeHighlights を実行する（設計ドキュメント 設計判断2）。
 * 5,000事業 × 6指標のフルスキャンは年度ごとに1回だけ実行し、結果をメモリに保持する。
 */
import { computeHighlights, type HighlightsResult } from '@/app/lib/highlights';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { loadQualityScores } from '@/app/lib/api/quality-scores-loader';
import { SUPPORTED_YEARS, type SupportedYear } from '@/app/lib/api/api-notes';

const cache = new Map<SupportedYear, HighlightsResult>();

/** year の1つ前の対応年度（存在すれば）。spendingChange の比較対象。 */
function priorSupportedYear(year: SupportedYear): SupportedYear | null {
  const prior = String(Number(year) - 1);
  return (SUPPORTED_YEARS as readonly string[]).includes(prior) ? (prior as SupportedYear) : null;
}

export function loadHighlights(year: SupportedYear): HighlightsResult {
  const cached = cache.get(year);
  if (cached) return cached;

  const currentGraph = loadSankeyGraph(year);
  const qualityItems = loadQualityScores(year).items;

  const priorYear = priorSupportedYear(year);
  const priorGraph = priorYear ? loadSankeyGraph(priorYear) : null;

  const result = computeHighlights({
    year,
    currentGraph: { nodes: currentGraph.nodes, edges: currentGraph.edges },
    priorGraph: priorGraph ? { year: priorYear!, nodes: priorGraph.nodes, edges: priorGraph.edges } : undefined,
    qualityItems,
  });

  cache.set(year, result);
  return result;
}
