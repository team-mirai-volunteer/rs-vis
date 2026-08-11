/**
 * 事業詳細データAPI
 * GET /api/project-details/[projectId]?year=2024|2025
 *
 * 指定されたprojectIdの詳細情報を返す
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_CACHE_CONTROL, SUPPORTED_YEARS } from '@/app/lib/api/api-notes';
import { projectLinks } from '@/app/lib/api/links';
import { loadProjectDetails } from '@/app/lib/api/project-details-loader';

type SupportedYear = typeof SUPPORTED_YEARS[number];

function isSupportedYear(year: string): year is SupportedYear {
  return (SUPPORTED_YEARS as readonly string[]).includes(year);
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
    const projectDetails = loadProjectDetails(yearParam);
    const detail = projectDetails[projectId];

    if (!detail) {
      return NextResponse.json(
        { error: `Project not found: ${projectId}` },
        { status: 404 }
      );
    }

    // レスポンス（既存フィールドはそのまま、関連リンクのみ追加）
    return NextResponse.json(
      { ...detail, links: projectLinks(projectId, yearParam) },
      {
        headers: {
          'Cache-Control': API_CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    console.error('[API Error] Failed to get project details:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
