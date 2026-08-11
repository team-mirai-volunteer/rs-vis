import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { parseYear, buildMetadata, serverErrorResponse, SUPPORTED_YEARS } from '@/app/lib/api/api-notes';
import { apiDocsLink } from '@/app/lib/api/links';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import {
  resolveSankeyQuery,
  buildFilterExcludedIds,
  summarizeFilteredGraph,
  compareYearsSummary,
  sankeyQueryToUrlParams,
  sankeyQueryFromUrlParams,
  hasActiveFilter,
} from '@/app/lib/sankey-query';
import { filterTopN } from '@/app/lib/sankey-svg-filter';
import type { SankeyQuery } from '@/types/sankey-query';

/** /api/sankey/query 固有のデータ留意事項 */
const SANKEY_QUERY_NOTES: readonly string[] = [
  'このAPIは /sankey-svg と同じグラフデータ・フィルタロジックを共有します。links.webView を開くと同一条件のサンキー図が表示されます',
  'グラフの支出先はグラフ生成時に名寄せ・集約済みのため、全支出先件数より少なくなります。ヒットしない支出先は /api/search/recipients で集計データを検索してください',
  'summary.projects.spendingTotal は「残存事業 → 残存支出先」エッジの合計です。支出先フィルタ使用時は事業の総支出より小さくなります',
  'summary はフィルタ適用後の全マッチを集計します（TopN集約前）。detail=full の sankey は表示用にTopN集約された後のノード・エッジです',
  'summary.recipients.topShare1/topShare3は「その他の支出先」（表示件数制限からの集計ノード）を除いて計算しますが、支出先名「その他」（実データ）は1支出先として含みます',
];

/** compareYears 使用時に追加する留意事項 */
const SANKEY_QUERY_COMPARE_NOTES: readonly string[] = [
  'compareYears の2つの数値は「事業年度」です。事業年度Nのデータは予算年度N-1の執行実績のため、compareYears=2024,2025 は予算年度2023 vs 2024 の執行実績比較を意味します',
  'diff は同一フィルタを両年度に適用した結果を projectId／支出先ノードIDで突き合わせたものです。手動での再突合はしないでください',
  'diff.projects.increased/decreased は支出額（spendingDiff、残存支出先への実支出）でランキングします。budgetDiff（project-budgetノードの予算額差）も同梱しますが、デジタル庁一括計上等で事業単体の予算が0円のまま執行額だけ変動するケースがあるため、budgetDiff だけでは実態を見誤ります',
  'diff.recipients は残存事業からの受領額（inflow）を比較します。「その他の支出先」等の集計ノードは diff.recipients から除外されます',
  'diffRate は基準年度（compareYears の1つ目）の値が0の場合 null です',
];

// ローカル実験フェーズのため Cache-Control は付与しない（公開段階で API_CACHE_CONTROL を追加する）

/**
 * ローカル実験フェーズの本番抑制ガード。
 * main マージ → Vercel 自動デプロイで本ルートが公開されてしまうため、Vercel 上では
 * 機能・理由を一切明かさない素の 404 を返す（403 だと「存在するが禁止」と教えてしまう）。
 * ※ 未存在ルートの 404 は HTML ページを返すためボディまでは一致しないが、
 *   リポジトリが公開されている以上ルートの存在自体は秘密ではなく、
 *   ここでの目的は「応答から機能・データを一切漏らさない」ことに置く。
 *
 * 判定は Host ヘッダではなく環境変数で行う: Host はクライアントが任意に送れる値のため
 * 検知に使えないが、`VERCEL=1` はプラットフォームがサーバー側に注入する値で偽装不能。
 * 将来 Vercel 上（preview 等）で試す場合のみ SANKEY_QUERY_API_ENABLED=1 で明示有効化できる。
 * `npm run dev`（development）では常に有効。公開判断時にこのガードを外し、
 * レートリミット・Cache-Control 等の公開段階対策と入れ替える。
 */
function isQueryApiEnabled(): boolean {
  if (process.env.SANKEY_QUERY_API_ENABLED === '1') return true;
  if (process.env.VERCEL === '1') return false; // Vercel 上は常に無効
  return process.env.NODE_ENV !== 'production'; // ローカルでも production ビルドは既定無効
}

export async function GET(req: Request) {
  if (!isQueryApiEnabled()) {
    // 素の 404（ボディ・理由なし）。notFound() は例外を投げるため、
    // 下の try/catch（500化）の外で呼ぶこと。
    notFound();
  }
  try {
    const url = new URL(req.url);

    // detail: summary（既定）= 件数・金額のみ / full = TopN集約後の nodes/edges も返す
    const detailParam = url.searchParams.get('detail') ?? 'summary';
    if (detailParam !== 'summary' && detailParam !== 'full') {
      return NextResponse.json(
        { error: `detail は "summary" または "full" を指定してください（受領値: ${detailParam}）` },
        { status: 400 },
      );
    }

    // クエリの受領: q=JSON（推奨）または /sankey-svg と同じ短縮URLパラメータ
    let input: SankeyQuery;
    const q = url.searchParams.get('q');
    if (q !== null) {
      try {
        input = JSON.parse(q) as SankeyQuery;
      } catch (e) {
        return NextResponse.json(
          { error: `q パラメータのJSONが不正です: ${e instanceof Error ? e.message : String(e)}` },
          { status: 400 },
        );
      }
    } else {
      input = sankeyQueryFromUrlParams(url.searchParams);
    }

    // 年度: q.year > yr > year > 既定（2024）
    if (input.year == null) {
      const year = parseYear(url.searchParams.get('year'));
      if (year === null) {
        return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
      }
      input.year = year;
    }

    const { query, errors } = resolveSankeyQuery(input);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'クエリが不正です。details を修正して再実行してください', details: errors },
        { status: 400 },
      );
    }

    // compareYears=基準年,比較年（例: 2024,2025）— 同一フィルタを2年度に適用し summary + 差分を返す
    const compareYearsParam = url.searchParams.get('compareYears');
    if (compareYearsParam !== null) {
      const parts = compareYearsParam.split(',').map(s => s.trim());
      const isSupportedYear = (v: string): v is SupportedYear => (SUPPORTED_YEARS as readonly string[]).includes(v);
      if (parts.length !== 2 || !isSupportedYear(parts[0]) || !isSupportedYear(parts[1])) {
        return NextResponse.json(
          { error: `compareYears は "基準年,比較年" の形式で対応年度（${SUPPORTED_YEARS.join(' | ')}）を2つ指定してください（受領値: ${compareYearsParam}）` },
          { status: 400 },
        );
      }
      const [baseYear, compareYear] = parts;
      if (baseYear === compareYear) {
        return NextResponse.json(
          { error: `compareYears には異なる2年度を指定してください（受領値: ${compareYearsParam}）` },
          { status: 400 },
        );
      }

      const baseGraph = loadSankeyGraph(baseYear);
      const compareGraph = loadSankeyGraph(compareYear);
      const baseExcludedIds = buildFilterExcludedIds(baseGraph.nodes, baseGraph.edges, query.filter, [query.view.pin.projectId]);
      const compareExcludedIds = buildFilterExcludedIds(compareGraph.nodes, compareGraph.edges, query.filter, [query.view.pin.projectId]);
      const result = compareYearsSummary(
        { nodes: baseGraph.nodes, edges: baseGraph.edges, excludedIds: baseExcludedIds },
        { nodes: compareGraph.nodes, edges: compareGraph.edges, excludedIds: compareExcludedIds },
      );

      return NextResponse.json({
        metadata: buildMetadata(baseYear, {
          compareYear: Number(compareYear),
          appliedQuery: query,
          filterActive: hasActiveFilter(query.filter),
        }, [...SANKEY_QUERY_NOTES, ...SANKEY_QUERY_COMPARE_NOTES]),
        years: { [baseYear]: result.base, [compareYear]: result.compare },
        diff: result.diff,
      });
    }

    const graph = loadSankeyGraph(query.year);

    // プレフィルタ（/sankey-svg と同一ロジック）。ピン中の事業はカスケード除外から保護される
    const excludedIds = buildFilterExcludedIds(
      graph.nodes,
      graph.edges,
      query.filter,
      [query.view.pin.projectId],
    );
    const summary = summarizeFilteredGraph(graph.nodes, graph.edges, excludedIds);

    const params = sankeyQueryToUrlParams(query);
    const body: Record<string, unknown> = {
      metadata: buildMetadata(query.year, {
        appliedQuery: query,
        detail: detailParam,
        filterActive: hasActiveFilter(query.filter),
      }, SANKEY_QUERY_NOTES),
      summary,
      links: {
        webView: `/sankey-svg?${params.toString()}`,
        ...(apiDocsLink() ? { docs: apiDocsLink() } : {}),
      },
    };

    if (detailParam === 'full') {
      // page.tsx の filtered useMemo と同じ手順: 除外 → recipientOffset クランプ → filterTopN
      const nodes = excludedIds ? graph.nodes.filter(n => !excludedIds.has(n.id)) : graph.nodes;
      const edges = excludedIds
        ? graph.edges.filter(e => !excludedIds.has(e.source) && !excludedIds.has(e.target))
        : graph.edges;
      const { view } = query;
      const maxOffset = Math.max(0, nodes.filter(n => n.type === 'recipient').length - view.topRecipient);
      const clampedOffset = Math.min(view.offset.recipient, maxOffset);
      const result = filterTopN(
        nodes, edges,
        view.topMinistry, view.topProject, view.topRecipient,
        clampedOffset,
        view.pin.projectId,
        true, // includeZeroSpending（/sankey-svg と同じ固定値）
        view.showAggRecipient, view.showAggProject,
        view.scaleBudgetToVisible,
        view.focusRelated,
        view.pin.recipientId, view.pin.ministryName,
        view.offset.target, view.offset.project,
        view.projectSortBy,
        !!query.filter.recipientName?.query,
      );
      body.sankey = {
        nodes: result.nodes,
        edges: result.edges,
        totalProjectCount: result.totalProjectCount,
        totalRecipientCount: result.totalRecipientCount,
      };
    }

    return NextResponse.json(body);
  } catch (e) {
    return serverErrorResponse('sankey/query', e);
  }
}
