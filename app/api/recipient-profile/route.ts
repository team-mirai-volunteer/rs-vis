/**
 * 支出先そのものの説明（サンキー図で支出先ノードを選んだときの詳細パネル用）
 *   GET /api/recipient-profile?year=2025&name=株式会社〇〇[&cn=法人番号13桁]
 * cn があれば法人番号で引く（同名で番号の無い記載の方が多いと、名前だけでは番号なしのエントリに当たるため）。
 * 支出先インデックス（法人番号・受注額・府省別）と、契約方式の区分ごとの集計を返す。
 * history は契約方式の3年度（RS公開API シート2024〜2026）の推移。年度をまたぐ突き合わせは法人番号で行う。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { resolveRecipient } from '@/app/lib/api/recipient-index-loader';
import { loadContractMethods, loadProjectLabels, loadRecipientExternal } from '@/app/lib/api/contract-methods-loader';
import { buildRecipientProfile } from '@/app/lib/recipient-profile';
import { buildContractHistory, HISTORY_SHEET_YEARS } from '@/app/lib/contract-history';
import { normalizeRecipientName } from '@/app/lib/recipient-key';

const MAX_NAME_CHARS = 200;

export async function GET(req: NextRequest) {
  try {
    const year = parseYear(req.nextUrl.searchParams.get('year'));
    if (year === null) return NextResponse.json({ error: '対応していない年度です（2024 | 2025）' }, { status: 400 });
    const name = (req.nextUrl.searchParams.get('name') ?? '').trim();
    if (!name || name.length > MAX_NAME_CHARS) return NextResponse.json({ error: 'name が不正です' }, { status: 400 });
    const cn = req.nextUrl.searchParams.get('cn') ?? '';
    const entry = /^その他/.test(name) ? null
      : (/^\d{13}$/.test(cn) ? resolveRecipient(year, cn) : null) ?? resolveRecipient(year, `name:${normalizeRecipientName(name)}`);
    const profile = buildRecipientProfile(name, entry, loadContractMethods(year), loadRecipientExternal()?.byCn ?? null, cn);
    if (entry && profile.entry && !profile.genericNote) {
      // 事業名は表示中の年度の出現 → シート2025・2024の採点結果の順に引く（シート2026の事業名データは無い）
      const fromIndex = new Map(entry.appearances.map(a => [String(a.pid), { name: a.projectName, ministry: a.ministry }]));
      const history = buildContractHistory(profile.entry.corporateNumber, entry.aliases,
        Object.fromEntries(HISTORY_SHEET_YEARS.map(y => [y, loadContractMethods(y)])),
        pid => fromIndex.get(pid) ?? loadProjectLabels('2025')?.get(pid) ?? loadProjectLabels('2024')?.get(pid));
      if (history) profile.history = history;
    }
    return NextResponse.json(profile, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('recipient-profile', e);
  }
}
