/**
 * 会計検査院「決算検査報告」の個別の指摘
 *   GET /api/audit-report           全指摘
 *   GET /api/audit-report?pid=1234  その事業に対応づけた指摘
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { auditItemsOfProject, loadAuditReport } from '@/app/lib/api/audit-report-loader';

export async function GET(req: NextRequest) {
  try {
    const data = loadAuditReport();
    if (!data) return NextResponse.json({ error: '決算検査報告のデータがありません（scripts/generate-audit-report.py）' }, { status: 404 });
    const pid = req.nextUrl.searchParams.get('pid');
    if (pid && !/^\d{1,12}$/.test(pid)) return NextResponse.json({ error: 'pid が不正です' }, { status: 400 });
    const items = pid ? auditItemsOfProject(data, String(Number(pid))) : data.items;
    return NextResponse.json({ metadata: data.metadata, items }, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('audit-report', e);
  }
}
