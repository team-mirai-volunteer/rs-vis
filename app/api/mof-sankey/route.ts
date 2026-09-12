/**
 * MOF 予算→項→RS紐づけサンキー API。
 *
 * データ源は項レベルの正準データ（`mof-budget-{YEAR}.json`。事項別内訳と科目別内訳を
 * 事前結合したもの。`/mof-kou` と同じ）と目↔RS事業紐づけ（`mof-rs-kou-moku-linkage-{YEAR}.json`）。
 * 組み立ては `app/lib/mof-section-rs-sankey.ts` に委譲する。
 *
 * 事項別内訳（Web帳票）単体だと決算が一般会計にしかなく、決算選択時に `/mof-kou`
 * と合計が大きく食い違うため、`mof-kou-loader.ts` の `listSections`（`/mof-kou` と同じ
 * 項レベル集計）を経由する
 *
 * 年度は「RS紐づけデータが生成済みの年度」だけを対象にする。紐づけデータの
 * 無い年度では全項が「RS対象外」になり、図として意味を持たないため。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears as mofBudgetAvailableYears, listSections } from '@/app/lib/api/mof-kou-loader';
import { linkageAvailable, resolveLinks, linkageRsYear, linkageScope } from '@/app/lib/api/mof-rs-kou-moku-linkage-loader';
import { buildMOFSectionRsSankey, DEFAULT_TOP_N } from '@/app/lib/mof-section-rs-sankey';
import { filterMOFSectionRsRows } from '@/app/lib/mof-section-rs-filter';
import type { MOFSectionRsColumn, MOFSectionRsOffset, MOFSectionRsTopN } from '@/types/mof-section-rs-sankey';
import type { MOFAccountType, MOFBudgetType } from '@/types/mof-jikou';

const TOP_N_MAX = 300;

const TOP_N_PARAMS: Array<[Exclude<MOFSectionRsColumn, 'total'>, string]> = [
  ['ministry', 'topMinistry'],
  ['organization', 'topOrganization'],
  ['subAccount', 'topSubAccount'],
  ['section', 'topSection'],
  ['rsStatus', 'topRsStatus'],
];

const OFFSET_PARAMS: Array<[Exclude<MOFSectionRsColumn, 'total' | 'rsStatus'>, string]> = [
  ['ministry', 'offsetMinistry'],
  ['organization', 'offsetOrganization'],
  ['subAccount', 'offsetSubAccount'],
  ['section', 'offsetSection'],
];

const ACCOUNT_TYPES: readonly MOFAccountType[] = ['general', 'special', 'agency'];

/** 収録候補の会計年度（新しい順）。mof-kou-loader と同じ候補集合 */
const CANDIDATE_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017] as const;

/** mof-budget（項レベル正準データ）とRS紐づけの両方が生成済みの年度（新しい順） */
function linkedYears(): number[] {
  const budgetYears = new Set(mofBudgetAvailableYears());
  return CANDIDATE_YEARS.filter(y => linkageAvailable(y) && budgetYears.has(y));
}

function parseAmount(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseOffset(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function parseTopN(raw: string | null, fallback: number | undefined): number | undefined {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), TOP_N_MAX);
}

/**
 * GET /api/mof-sankey
 *
 * クエリ:
 *   year       — 会計年度（西暦）。省略時はRS紐づけデータが収録済みの最新年度
 *   budgetType — 予算種別。省略時・その年度に無い場合は当初予算
 *   topSection — 項の TopN
 */
export async function GET(request: Request) {
  try {
    const years = linkedYears();
    if (years.length === 0) {
      return NextResponse.json(
        { error: 'RS紐づけデータが生成されていません。npm run generate-mof-rs-kou-moku-linkage を実行してください。' },
        { status: 503 }
      );
    }

    const params = new URL(request.url).searchParams;
    const rawYear = params.get('year');
    const year = rawYear ? Number(rawYear) : years[0];
    if (!years.includes(year)) {
      return NextResponse.json(
        { error: `対象外の年度です: ${rawYear}`, availableYears: years },
        { status: 400 }
      );
    }

    const data = listSections(year);
    const budgetTypes = data.metadata.budgetTypes;
    if (budgetTypes.length === 0) {
      return NextResponse.json({ error: `${year}年度に収録されている予算種別がありません。` }, { status: 503 });
    }
    const requested = params.get('budgetType') as MOFBudgetType | null;
    const budgetType =
      requested && budgetTypes.includes(requested) ? requested : (budgetTypes.find(t => t === '当初予算') ?? budgetTypes[0]);

    const topN: MOFSectionRsTopN = Object.fromEntries(
      TOP_N_PARAMS.map(([column, param]) => [column, parseTopN(params.get(param), DEFAULT_TOP_N[column])])
    );
    const offset: MOFSectionRsOffset = Object.fromEntries(
      OFFSET_PARAMS.map(([column, param]) => [column, parseOffset(params.get(param))])
    );

    const accountTypes = params
      .getAll('filterAccount')
      .filter((v): v is MOFAccountType => ACCOUNT_TYPES.includes(v as MOFAccountType));
    const filter = {
      ministries: params.getAll('filterMinistry'),
      accountTypes,
      sectionName: params.get('filterSection')
        ? { query: params.get('filterSection') as string, regex: params.get('filterSectionRegex') === '1' }
        : undefined,
      minAmount: parseAmount(params.get('filterMinAmount')),
      maxAmount: parseAmount(params.get('filterMaxAmount')),
    };
    const items = filterMOFSectionRsRows(data.sections, filter);

    const linkage = resolveLinks(year);
    const rsYear = linkageRsYear(year);
    const scope = linkageScope(year);

    const result = buildMOFSectionRsSankey(items, {
      fiscalYear: year,
      eraLabel: data.metadata.eraLabel,
      budgetType,
      budgetTypes,
      availableYears: years,
      rsYear,
      linkageScope: scope,
      rsLinks: linkage.links,
      topN,
      offset,
      allItems: data.sections,
    });

    return NextResponse.json(result, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('MOF Section RS Sankey API', error);
  }
}
