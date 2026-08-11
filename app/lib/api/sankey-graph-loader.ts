/**
 * sankey-svg-{YEAR}-graph.json の読み込み・メモリキャッシュ。
 * /api/sankey/query が使用する（/sankey-svg ページはクライアントで直接 fetch する）。
 */
import type { GraphData } from '@/types/sankey-svg';
import { readDataJson } from '@/app/lib/api/data-file';

const cache = new Map<string, GraphData>();

export function loadSankeyGraph(year: string): GraphData {
  if (cache.has(year)) return cache.get(year)!;

  const graph = readDataJson<GraphData>(
    `sankey-svg-${year}-graph.json`,
    'bash scripts/decompress-data.sh または npm run generate-sankey-svg を実行してください。'
  );
  cache.set(year, graph);
  return graph;
}
