/**
 * 複数項ぶんの目一覧をまとめて返す。/mof-sankey のサイドパネルで所管・組織/特会・
 * 勘定/業務ノードを選んだときの「目」タブ用（配下の項すべてを合算して見せる）。
 * 集計（sectionDetail の呼び出し・RS事業の突き合わせ・並べ替え）は app/lib/ に委譲し、
 * ここではHTTPの受け取り・検証・レスポンス変換だけを行う。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, sectionDetailBatchRows } from '@/app/lib/api/mof-kou-loader';

/** 所管丸ごと選択時などに項数が際限なく膨らまないよう、安全弁として上限を設ける */
const MAX_IDS = 1000;

/**
 * POST /api/mof-kou/detail-batch
 *
 * 所管丸ごとなど数百件の項を指定しうるため、URLの長さ制限に掛かるGETクエリではなく
 * JSONボディで受ける。
 *
 * body: { year: number; ids: string[] }
 *   year — 会計年度（西暦）。必須
 *   ids — 項の合成キー（一覧APIの sections[].id）の配列。必須
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { year?: number; ids?: string[] } | null;
    const year = body?.year;
    const ids = body?.ids;
    if (!year || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'year と ids（配列）を指定してください' }, { status: 400 });
    }
    if (!availableYears().includes(year)) {
      return NextResponse.json({ error: `対象外の年度です: ${year}` }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json({ error: `項の指定が多すぎます（上限${MAX_IDS}件）` }, { status: 400 });
    }

    const rows = sectionDetailBatchRows(year, ids);

    return NextResponse.json({ rows }, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
  } catch (error) {
    return serverErrorResponse('mof-kou/detail-batch', error);
  }
}
