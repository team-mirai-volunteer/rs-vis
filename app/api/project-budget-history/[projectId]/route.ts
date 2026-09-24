import { NextResponse } from 'next/server';
import { readDataJson } from '@/app/lib/api/data-file';
import { API_CACHE_CONTROL } from '@/app/lib/api/api-notes';
import type { ProjectBudgetHistoryData, ProjectBudgetHistoryResponse } from '@/types/project-budget-history';

let cache: ProjectBudgetHistoryData | undefined;

/** Always use the corrected historical amounts in the 2025 sheet, regardless of the view year. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  try {
    cache ??= readDataJson<ProjectBudgetHistoryData>('rs2025-project-budget-history.json', 'python scripts/generate-project-budget-history.py');
    const { projects, ...source } = cache;
    const response: ProjectBudgetHistoryResponse = { ...source, projectId: Number(projectId), points: projects[projectId] ?? [] };
    return NextResponse.json(response, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    console.error('[project-budget-history]', error);
    return NextResponse.json({ error: 'Failed to load budget history' }, { status: 500 });
  }
}
