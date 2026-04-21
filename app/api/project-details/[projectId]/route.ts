/**
 * 事業詳細データAPI
 * GET /api/project-details/[projectId]?year=2024|2025
 *
 * 指定されたprojectIdの詳細情報を返す
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ProjectDetailsData, ProjectDetail } from '@/types/project-details';

// データをメモリにキャッシュ（年度別）
const cache = new Map<string, ProjectDetailsData>();

const SUPPORTED_YEARS = ['2024', '2025'] as const;
type SupportedYear = typeof SUPPORTED_YEARS[number];

function isSupportedYear(year: string): year is SupportedYear {
  return (SUPPORTED_YEARS as readonly string[]).includes(year);
}

/**
 * 事業詳細データを取得（年度別キャッシュ付き）
 */
function getProjectDetails(year: SupportedYear): ProjectDetailsData {
  if (!cache.has(year)) {
    const filePath = join(process.cwd(), 'public', 'data', `rs${year}-project-details.json`);
    const fileContent = readFileSync(filePath, 'utf-8');
    cache.set(year, JSON.parse(fileContent) as ProjectDetailsData);
    console.log(`[API] Project details data loaded into cache (year=${year})`);
  }
  return cache.get(year)!;
}

/**
 * GET /api/project-details/[projectId]?year=2024|2025
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const yearParam = request.nextUrl.searchParams.get('year') ?? '2024';

    // バリデーション
    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    if (!isSupportedYear(yearParam)) {
      return NextResponse.json(
        { error: `Unsupported year: ${yearParam}` },
        { status: 400 }
      );
    }

    // データ取得
    const projectDetails = getProjectDetails(yearParam);
    const detail = projectDetails[projectId];

    if (!detail) {
      return NextResponse.json(
        { error: `Project not found: ${projectId}` },
        { status: 404 }
      );
    }

    // レスポンス
    return NextResponse.json(detail, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to get project details:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
