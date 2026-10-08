/**
 * 財務省「予算執行調査」
 *   GET /api/budget-execution-audit           全事案
 *   GET /api/budget-execution-audit?pid=1234  その事業に対応づけた事案
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { auditCasesOfProject, loadBudgetExecutionAudit } from '@/app/lib/api/budget-execution-audit-loader';

export async function GET(req: NextRequest) {
  try {
    const data = loadBudgetExecutionAudit();
    if (!data) return NextResponse.json({ error: '予算執行調査のデータがありません（scripts/generate-budget-execution-audit.py）' }, { status: 404 });
    const pid = req.nextUrl.searchParams.get('pid');
    if (pid && !/^\d{1,12}$/.test(pid)) return NextResponse.json({ error: 'pid が不正です' }, { status: 400 });
    const cases = pid ? auditCasesOfProject(data, String(Number(pid))) : data.cases;
    return NextResponse.json({ metadata: data.metadata, cases }, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('budget-execution-audit', e);
  }
}
