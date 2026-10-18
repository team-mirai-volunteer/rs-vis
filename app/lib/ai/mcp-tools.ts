/**
 * MCP サーバー（/api/mcp）に公開するツールのカタログ。
 *
 * チャットのエージェント（chat-core.ts）と同じ `TOOLS` を元にし、会話の文脈で決まっていた年度を
 * 明示の引数 `year` に変えて公開する。確定用の `submit_result` は会話を終えるための道具なので出さない。
 * 実行は chat-core の `executeToolCall`（検証込み）に委ね、ここは定義（名前・説明・JSON Schema）だけを持つ Pure 層。
 */
import { SANKEY_QUERY_DEFAULTS } from '@/app/lib/sankey-query';
import { SUPPORTED_YEARS, type SupportedYear } from '@/types/rs-year';
import { TOOLS } from '@/app/lib/ai/chat-core';

/** MCP クライアントへ送る 1 ツールの定義（JSON Schema はそのまま inputSchema として渡す） */
export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const YEAR_DESCRIPTION =
  `RS（行政事業レビュー）のシート年度。${SUPPORTED_YEARS.map(y => `"${y}"`).join('・')}。` +
  `シート年度 N には N-1 年度の執行・支出先が載る（例: "2025" = 2024年度の実績）。省略時は "${SANKEY_QUERY_DEFAULTS.year}"`;

/** MCP サーバーの instructions（クライアントの LLM に最初に渡す使い方とデータの約束事） */
export const MCP_INSTRUCTIONS = [
  '日本の国の予算・行政事業レビュー（RS）のデータを引くツール群です。',
  '金額はすべて 1 円単位（千円単位ではありません）。',
  '支出先名「その他」は公開データ側の記載で、「その他の支出先」は上位 N 件以外の集計です。別物として扱ってください。',
  'year は RS のシート年度で、N 年版のシートには N-1 年度の執行・支出先が載ります。',
  'AI 評価（get_quality_scores）は公開資料に基づく独自基準の試行であり、政府の公式評価ではありません。結論ではなく参考情報として示してください。',
  '回答で数字を示すときは出典として「行政事業レビュー見える化サイト（内閣官房）ほか、チームみらい 行政事業レビュー可視化による編集・加工」と明記してください。',
  '進め方: search_projects / search_recipients で候補を探し、get_project_detail・get_subcontract_chain・get_quality_scores で深掘りし、条件が固まったら run_sankey_query で件数・金額を確かめます。',
].join('\n');

/** JSON Schema に `year` を足して返す（元の定義は変更しない） */
function withYear(parameters: Record<string, unknown>): Record<string, unknown> {
  const properties = (parameters.properties ?? {}) as Record<string, unknown>;
  return {
    ...parameters,
    properties: { ...properties, year: { type: 'string', enum: [...SUPPORTED_YEARS], description: YEAR_DESCRIPTION } },
  };
}

export const MCP_TOOLS: readonly McpToolSpec[] = TOOLS
  .filter(t => t.function.name !== 'submit_result')
  .map(t => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: withYear(t.function.parameters),
  }));

/** 引数の year を取り出し、無ければ既定年度にする（未対応の値はエラー文を返す） */
export function resolveToolYear(args: Record<string, unknown>): { year: SupportedYear } | { error: string } {
  const raw = args.year;
  if (raw === undefined || raw === null || raw === '') return { year: SANKEY_QUERY_DEFAULTS.year };
  if (typeof raw === 'string' && (SUPPORTED_YEARS as readonly string[]).includes(raw)) return { year: raw as SupportedYear };
  return { error: `year は ${SUPPORTED_YEARS.map(y => `"${y}"`).join('・')} のいずれかで指定してください（受領値: ${String(raw)}）` };
}
