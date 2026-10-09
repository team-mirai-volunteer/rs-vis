import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { BUDGET_REQUEST_LINKS_FY, budgetRequestLinksFor, loadBudgetRequestLinks } from '@/app/lib/api/budget-request-links-loader';

/**
 * GET /api/budget-request-links/[pid]
 * 事業が使う歳出予算項目（所管・組織・項・目）ごとの、原資料（歳出概算要求額明細表）に記載された翌々年度要求額。
 * 目 は複数事業で共有されるので、額は 目 全体のもの。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  if (!/^\d{1,8}$/.test(pid)) return NextResponse.json({ error: 'pid が不正です' }, { status: 400 });
  try {
    const links = budgetRequestLinksFor(pid);
    if (!links) return NextResponse.json({ error: '概算要求の対応データはまだ生成されていません。', code: 'DATA_NOT_AVAILABLE' }, { status: 404 });
    const data = loadBudgetRequestLinks()!;
    return NextResponse.json({ pid, requestedFY: BUDGET_REQUEST_LINKS_FY, sheetYear: data.sheetYear, generatedAt: data.generatedAt, ...links }, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) { return serverErrorResponse('budget-request-links', error); }
}
