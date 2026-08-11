import { NextResponse } from 'next/server';
import { loadHighlights } from '@/app/lib/api/highlights-loader';
import { HIGHLIGHT_METRIC_NAMES, type HighlightMetricName } from '@/app/lib/highlights';
import { parseYear, buildMetadata, API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { projectLinks, sankeyProjectViewLink } from '@/app/lib/api/links';
import type { SupportedYear } from '@/app/lib/api/api-notes';

/** highlights API 固有のデータ留意事項（語彙の規律を固定する） */
const HIGHLIGHTS_NOTES: readonly string[] = [
  '本APIは「異常」「無駄」の判定ではありません。過去のレポートが人力で見つけた発見の型（支出の急増・急減、説明の薄さ、支出先の集中、品質スコアと予算規模の乖離、予算と執行の乖離、再委託の深さ）を機械的にスキャンし、観測可能なシグナルとして列挙するものです',
  '品質スコアはレビューシートに書かれた説明の質（支出先の特定可能性・使途の説明性・成果設計の明確さ等）の評価であり、事業そのものの善悪・要不要を判定するものではありません',
  '事業年度YEARのデータは予算年度YEAR-1の実績を表します。metrics.spendingChange は year と year-1 の比較のため、year=2024 指定時は比較対象年度がなく空になります',
  '「その他」(支出先名がそのまま報告されたもの)と「その他の支出先」(表示件数制限からの集計ノード)は別物です。metrics.otherRatio は前者（実データ）のみを対象とします',
];

function isMetricName(v: string): v is HighlightMetricName {
  return (HIGHLIGHT_METRIC_NAMES as readonly string[]).includes(v);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const year = parseYear(url.searchParams.get('year'));
    if (year === null) {
      return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    }

    const metricParam = url.searchParams.get('metric');
    if (metricParam !== null && !isMetricName(metricParam)) {
      return NextResponse.json(
        { error: `metric は次のいずれかを指定してください: ${HIGHLIGHT_METRIC_NAMES.join(' | ')}（受領値: ${metricParam}）` },
        { status: 400 },
      );
    }

    const result = loadHighlights(year);

    const withLinks = <T extends { pid: string }>(entries: T[]) =>
      entries.map(e => ({ ...e, links: projectLinks(e.pid, year as SupportedYear) }));

    const multiSignalWithLinks = result.multiSignal.map(e => ({
      ...e,
      links: { ...projectLinks(e.pid, year as SupportedYear), sankeyView: sankeyProjectViewLink(e.name, year as SupportedYear) },
    }));

    const metrics = {
      spendingChange: {
        priorYear: result.metrics.spendingChange.priorYear ? Number(result.metrics.spendingChange.priorYear) : null,
        increased: result.metrics.spendingChange.increased,
        decreased: result.metrics.spendingChange.decreased,
        added: result.metrics.spendingChange.added,
        removed: result.metrics.spendingChange.removed,
      },
      otherRatio: withLinks(result.metrics.otherRatio),
      concentration: withLinks(result.metrics.concentration),
      lowScoreHighBudget: withLinks(result.metrics.lowScoreHighBudget),
      execBudgetGap: withLinks(result.metrics.execBudgetGap),
      subcontractDepth: withLinks(result.metrics.subcontractDepth),
    };

    const body = {
      metadata: buildMetadata(year, {
        metric: metricParam ?? null,
        minSpendYen: result.meta.minSpendYen,
        population: {
          otherRatio: result.meta.otherRatioPopulation,
          concentration: result.meta.concentrationPopulation,
          subcontractDepth: result.meta.subcontractDepthPopulation,
        },
        lowScoreThreshold: result.meta.lowScoreThreshold,
      }, HIGHLIGHTS_NOTES),
      metrics: metricParam ? { [metricParam]: metrics[metricParam] } : metrics,
      multiSignal: multiSignalWithLinks,
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('highlights', e);
  }
}
