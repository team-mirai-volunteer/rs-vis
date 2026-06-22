import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import type { SubcontractIndex } from '@/types/subcontract';
import { buildMetadata, API_CACHE_CONTROL, RECIPIENT_NOTES } from '@/app/lib/api/api-notes';
import { projectLinks, recipientLinks } from '@/app/lib/api/links';
import { buildRecipientKey, isExcludedRecipientName } from '@/app/lib/recipient-key';

const SUPPORTED_YEARS = ['2024', '2025'] as const;
type SupportedYear = typeof SUPPORTED_YEARS[number];

function isSupportedYear(y: string): y is SupportedYear {
  return (SUPPORTED_YEARS as readonly string[]).includes(y);
}

// リクエストごとにファイル再読み込みしないようにメモ化
const cache = new Map<SupportedYear, SubcontractIndex>();

function loadData(year: SupportedYear): SubcontractIndex | null {
  if (cache.has(year)) return cache.get(year)!;
  const filePath = path.join(process.cwd(), 'public', 'data', `subcontracts-${year}.json`);
  if (!fs.existsSync(filePath)) return null;
  const data: SubcontractIndex = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  cache.set(year, data);
  return data;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const year = request.nextUrl.searchParams.get('year') ?? '2024';

  if (!isSupportedYear(year)) {
    return NextResponse.json({ error: `Unsupported year: ${year}` }, { status: 400 });
  }

  const data = loadData(year);
  if (!data) {
    return NextResponse.json({ error: `Data file not found for year ${year}` }, { status: 404 });
  }

  const graph = data[projectId];
  if (!graph) {
    return NextResponse.json({ error: `Project ${projectId} not found` }, { status: 404 });
  }

  // 既存フィールドはそのまま、各支出先に逆引きキーと関連リンクを追加
  const body = {
    ...graph,
    metadata: buildMetadata(year, { projectId: graph.projectId }, RECIPIENT_NOTES),
    blocks: graph.blocks.map(block => ({
      ...block,
      recipients: block.recipients.map(r =>
        isExcludedRecipientName(r.name)
          ? r
          : {
              ...r,
              recipientKey: buildRecipientKey(r.name, r.corporateNumber),
              links: recipientLinks(buildRecipientKey(r.name, r.corporateNumber), year),
            }
      ),
    })),
    links: projectLinks(projectId, year),
  };

  return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
}
