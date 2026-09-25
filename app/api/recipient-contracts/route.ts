/**
 * 支出先の契約の概要（ホバー表示用）
 *   GET /api/recipient-contracts?year=2025&name=個人A&pids=1335,48
 *
 * 指定した事業ごとに、再委託構造データから支出先名が完全一致する記載の金額と契約の概要を返す。
 * 事業は呼び出し側が金額の大きい順に渡し、先頭 RECIPIENT_CONTRACTS_MAX_PIDS 件だけ引く。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_CACHE_CONTROL, SUPPORTED_YEARS, type SupportedYear } from '@/app/lib/api/api-notes';
import { loadSubcontracts } from '@/app/lib/api/subcontracts-loader';
import {
  RECIPIENT_CONTRACTS_MAX_PIDS,
  recipientContractsInProject,
  type RecipientContractEntry,
  type RecipientContractsResponse,
} from '@/app/lib/recipient-contracts';

const MAX_NAME_CHARS = 200;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const year = params.get('year') ?? '';
  if (!(SUPPORTED_YEARS as readonly string[]).includes(year)) {
    return NextResponse.json({ error: `対応していない年度です（${SUPPORTED_YEARS.join(' | ')}）` }, { status: 400 });
  }
  const name = (params.get('name') ?? '').trim();
  if (!name || name.length > MAX_NAME_CHARS) return NextResponse.json({ error: 'name が不正です' }, { status: 400 });
  const pids = (params.get('pids') ?? '').split(',').map(s => s.trim()).filter(s => /^\d{1,12}$/.test(s));
  if (pids.length === 0) return NextResponse.json({ error: 'pids が不正です' }, { status: 400 });

  const data = loadSubcontracts(year as SupportedYear);
  if (!data) return NextResponse.json({ error: `Data file not found for year ${year}` }, { status: 404 });

  const entries: RecipientContractEntry[] = [];
  for (const pid of [...new Set(pids)].slice(0, RECIPIENT_CONTRACTS_MAX_PIDS)) {
    const graph = data[pid];
    if (!graph) continue;
    const entry = recipientContractsInProject(graph, name);
    if (entry) entries.push(entry);
  }
  const body: RecipientContractsResponse = { name, entries };
  return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
}
