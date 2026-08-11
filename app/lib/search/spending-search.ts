/**
 * 使途検索（Pure関数）。
 * 支出行（role=事業を行う上での役割 / cc=契約概要）に対する正規化部分一致。
 * 直接支出（d=0）と再委託（d>0）の二重計上を避けるため、集計は必ず分離して返す。
 */
import type { SpendingSearchRow } from '@/app/lib/api/quality-recipients-loader';
import { normalizeQuery } from '@/app/lib/search/project-search';

export type SpendingMatchField = 'role' | 'cc';

export interface SpendingSearchHit {
  row: SpendingSearchRow;
  matchedIn: SpendingMatchField;
  /** マッチ箇所の前後を含めた抜粋（約120字） */
  excerpt: string;
}

export interface SpendingTopProject {
  pid: string;
  /** 直接支出（d=0）行の合計。転記にはこちらを基本とする */
  amountDirect: number;
  /** 再委託（d>0）行の合計。直接分との単純合算は資金通過分の二重計上になりうる */
  amountSubcontract: number;
}

export interface SpendingSearchAggregate {
  hitCount: number;
  projectCount: number;
  /** マッチ行のうち直接支出（d=0）の金額合計 */
  amountDirect: number;
  /** マッチ行のうち再委託（d>0）の金額合計。amountDirectとの単純合算は資金通過分の二重計上になる */
  amountSubcontract: number;
  topProjects: SpendingTopProject[];
}

export interface SpendingSearchResult {
  aggregate: SpendingSearchAggregate;
  totalHits: number;
  items: SpendingSearchHit[];
}

const EXCERPT_RADIUS = 60;

/**
 * マッチ位置の前後（合わせて約120字）を抜き出す。マッチ位置が特定できない場合は先頭120字。
 * 照合は normalizeQuery と同一規則（NFKC + 小文字化 + 空白除去）で行い、正規化文字ごとに
 * 元テキストの位置を記録しておくことで、空白や NFKC による長さ変化があっても抜粋位置がずれない。
 */
function buildExcerpt(text: string, normalizedQuery: string): string {
  const normChars: string[] = [];
  const origIndex: number[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const c of text[i].normalize('NFKC').toLowerCase()) {
      if (/\s/.test(c)) continue;
      normChars.push(c);
      origIndex.push(i);
    }
  }
  const idx = normChars.join('').indexOf(normalizedQuery);
  if (idx === -1 || origIndex.length === 0) {
    return text.length <= 120 ? text : `${text.slice(0, 120)}…`;
  }
  const matchStart = origIndex[idx];
  const matchEnd = origIndex[Math.min(idx + normalizedQuery.length - 1, origIndex.length - 1)] + 1;
  const start = Math.max(0, matchStart - EXCERPT_RADIUS);
  const end = Math.min(text.length, matchEnd + EXCERPT_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export interface SpendingSearchOptions {
  limit: number;
  offset: number;
  /** aggregate.topProjects の件数（既定10） */
  topProjectsLimit?: number;
}

export function searchSpending(
  rows: SpendingSearchRow[],
  query: string,
  opts: SpendingSearchOptions,
): SpendingSearchResult {
  const q = normalizeQuery(query);
  if (!q) {
    return { aggregate: { hitCount: 0, projectCount: 0, amountDirect: 0, amountSubcontract: 0, topProjects: [] }, totalHits: 0, items: [] };
  }

  const hits: SpendingSearchHit[] = [];
  for (const row of rows) {
    const roleMatch = row.roleNorm.includes(q);
    const ccMatch = !roleMatch && row.ccNorm.includes(q);
    if (!roleMatch && !ccMatch) continue;
    const matchedIn: SpendingMatchField = roleMatch ? 'role' : 'cc';
    const sourceText = matchedIn === 'role' ? row.role : row.cc;
    hits.push({ row, matchedIn, excerpt: buildExcerpt(sourceText ?? '', q) });
  }

  // 集計はページングに依存しない全マッチ対象
  let amountDirect = 0;
  let amountSubcontract = 0;
  const projectAmounts = new Map<string, { direct: number; sub: number }>();
  for (const hit of hits) {
    const amount = hit.row.a2 ?? 0;
    const acc = projectAmounts.get(hit.row.pid) ?? { direct: 0, sub: 0 };
    if (hit.row.d > 0) {
      amountSubcontract += amount;
      acc.sub += amount;
    } else {
      amountDirect += amount;
      acc.direct += amount;
    }
    projectAmounts.set(hit.row.pid, acc);
  }
  const topProjectsLimit = opts.topProjectsLimit ?? 10;
  // 順位付けは直接+再委託の合算規模で行うが、金額は分離して返す（転記時の二重計上防止）
  const topProjects: SpendingTopProject[] = [...projectAmounts.entries()]
    .sort((a, b) => (b[1].direct + b[1].sub) - (a[1].direct + a[1].sub))
    .slice(0, topProjectsLimit)
    .map(([pid, acc]) => ({ pid, amountDirect: acc.direct, amountSubcontract: acc.sub }));

  // 表示順は金額（絶対値の大きさ）降順にしておく（ページングの意味を持たせるため）
  hits.sort((a, b) => (b.row.a2 ?? 0) - (a.row.a2 ?? 0));

  return {
    aggregate: {
      hitCount: hits.length,
      projectCount: projectAmounts.size,
      amountDirect,
      amountSubcontract,
      topProjects,
    },
    totalHits: hits.length,
    items: hits.slice(opts.offset, opts.offset + opts.limit),
  };
}
