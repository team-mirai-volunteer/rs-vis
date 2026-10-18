/**
 * 段階 C で足したツール（支出先一覧・基金・事業者・概算要求）の応答整形。
 * サーバー実装（ローダ直呼び）とクライアント実装（公開 API fetch）の両方がここを通り、payload の形を揃える。
 * 純粋関数。fs・fetch・React を含めない。
 */
import type { RecipientRow } from '@/app/lib/api/quality-recipients-loader';
import type { Fund } from '@/types/funds';
import type { Vendor, VendorYear } from '@/types/vendors';
import type { BudgetRequestProjectLinks } from '@/types/budget-request-links';
import { CONTRACT_METHOD_LABELS, isContractMethodCode } from '@/app/lib/contract-method';
import { FUND_SIGNAL_LABELS, fundSignals, fundsOfProject, latestYear } from '@/app/lib/funds';
import { matchVendor, unpackVendorYear, type VendorRow } from '@/app/lib/vendors';
import { clampText } from '@/app/lib/ai/tool-shaping';

/** 概算要求の対象年度。ローダー（fs を使う）側の BUDGET_REQUEST_LINKS_FY と同じ値。ブラウザ実装はこちらを使う */
export const BUDGET_REQUEST_FY = 2027;
export const RECIPIENT_LIMIT = 20;
export const FUND_SEARCH_LIMIT = 10;
export const VENDOR_SEARCH_LIMIT = 10;
const FUND_RELATED_LIMIT = 10;
const VENDOR_REPEAT_LIMIT = 8;

const STATUS_LABELS: Record<RecipientRow['s'], string> = {
  valid: '法人番号あり（有効）', gov: '行政機関', supp: '補助的に特定', cn: '法人番号の形式不正', invalid: '特定不可', unknown: '不明',
};

/** 事業の支出先一覧（金額の大きい順・上位 N 件）。契約方式はラベルに直す */
export function shapeProjectRecipients(pid: string, rows: RecipientRow[]) {
  const sorted = [...rows].sort((a, b) => (b.a2 ?? -1) - (a.a2 ?? -1));
  const total = rows.reduce((sum, r) => sum + (r.a2 ?? 0), 0);
  const withMethod = rows.filter(r => r.m).length;
  const single = rows.filter(r => r.ap === 1).length;
  return {
    pid,
    recipientCount: rows.length,
    amountTotal: total,
    /** 契約方式を突き合わせできた行数と、そのうち応札者が 1 者だった行数 */
    contractMatched: withMethod,
    singleBidCount: single,
    notes: ['金額は 1 円単位。同じ支出先が複数ブロックに出ることがある（別行）。契約方式は RS 公開 API との突き合わせで、補助金等は「契約以外」'],
    items: sorted.slice(0, RECIPIENT_LIMIT).map(r => ({
      name: r.n,
      corporateNumber: r.cn || null,
      amount: r.a2,
      status: STATUS_LABELS[r.s],
      opaque: r.o,
      block: r.b,
      depth: r.d,
      chain: r.chain || null,
      contractMethod: r.m && isContractMethodCode(r.m) ? CONTRACT_METHOD_LABELS[r.m] : r.mt ?? null,
      applicants: r.ap ?? null,
      bidRate: r.br ?? null,
      role: clampText(r.role, 120),
      contractSummary: clampText(r.cc, 160),
    })),
  };
}

function shapeFundSummary(f: Fund) {
  const latest = latestYear(f);
  return {
    key: f.key,
    name: f.name,
    sheetTitle: f.sheetTitle,
    ministry: f.ministry,
    owner: f.owner,
    createdYear: f.createdYear,
    endDate: f.endDate,
    latestSheetYear: latest?.sheetYear ?? null,
    balance: latest?.balance ?? null,
    expense: latest?.expense ?? null,
    returned: latest?.returned ?? null,
    signals: fundSignals(f).map(s => FUND_SIGNAL_LABELS[s]),
    relatedProjects: f.relatedProjects.slice(0, 3),
  };
}

/** 基金の検索。q は名前・シート名・保有法人・府省の部分一致。pid があればその事業に関連する基金に限る */
export function shapeFundSearch(funds: readonly Fund[], q: string, pid: string | null) {
  let candidates = pid ? fundsOfProject(funds, pid) : [...funds];
  const query = q.trim().toLowerCase();
  if (query) {
    candidates = candidates.filter(f => [f.name, f.sheetTitle ?? '', f.owner, f.ministry].some(v => v.toLowerCase().includes(query)));
  }
  candidates.sort((a, b) => (latestYear(b)?.balance ?? 0) - (latestYear(a)?.balance ?? 0));
  return {
    totalHits: candidates.length,
    notes: ['残高は最新シート年度の年度初め残高（円）。詳細は get_fund(key)'],
    items: candidates.slice(0, FUND_SEARCH_LIMIT).map(shapeFundSummary),
  };
}

/** 基金 1 件の詳細 */
export function shapeFund(f: Fund) {
  return {
    ...shapeFundSummary(f),
    ownerForm: f.ownerForm,
    operationForms: f.operationForms,
    businessForms: f.businessForms,
    newApplicationEndDate: f.newApplicationEndDate,
    necessity: clampText(f.necessity, 600),
    ownershipBasis: clampText(f.ownershipBasis, 400),
    inspection: f.inspection,
    inspectionNote: clampText(f.inspectionNote, 600),
    overviewUrl: f.overviewUrl,
    compositions: f.compositions,
    relatedProjects: f.relatedProjects.slice(0, FUND_RELATED_LIMIT),
    years: f.years.map(y => ({
      sheetYear: y.sheetYear, balance: y.balance, nationalBalance: y.nationalBalance, granted: y.granted,
      income: y.income, expense: y.expense, businessExpense: y.businessExpense, adminExpense: y.adminExpense,
      adminRate: y.adminRate, returned: y.returned, divergence: y.divergence, ownership: y.ownership,
    })),
  };
}

function shapeVendorYear(y: VendorYear) {
  return {
    sheetYear: y.sheetYear, amount: y.amount, count: y.count, contractAmount: y.contractAmount, contractCount: y.contractCount,
    nonContractAmount: y.nonContractAmount, projects: y.projects, ministries: y.ministries,
    competitiveCount: y.competitiveCount, singleBidCount: y.singleCount, singleBidAmount: y.singleAmount,
    /** 競争入札のうち応札者数が分かる件数と、その平均 1者応札率（0〜1） */
    singleBidRate: y.singleBidRateN > 0 ? Number((y.singleBidRateSum / y.singleBidRateN).toFixed(3)) : null,
  };
}

/** 事業者の検索結果（VendorRow = 公開 API の一覧形） */
export function shapeVendorSearch(rows: readonly VendorRow[], q: string) {
  const hits = rows.filter(v => matchVendor(v, q));
  return {
    totalHits: hits.length,
    notes: ['合計は全年度。詳細（年度別・主な府省・1者応札が続く事業）は get_vendor(key)'],
    items: hits.slice(0, VENDOR_SEARCH_LIMIT).map(v => {
      const total = unpackVendorYear(v.t);
      return {
        key: v.key, name: v.name, corporateNumber: v.corporateNumber, ministry: v.ministry ?? null,
        amount: total.amount, contractAmount: total.contractAmount, projects: total.projects,
        singleBidCount: total.singleCount, repeatSingleCount: v.repeatSingleCount, repeatSoleCount: v.repeatSoleCount,
      };
    }),
  };
}

/** 事業者 1 件の詳細 */
export function shapeVendor(v: Vendor) {
  return {
    key: v.key,
    name: v.name,
    corporateNumber: v.corporateNumber,
    total: shapeVendorYear(v.total),
    years: v.years.map(shapeVendorYear),
    ministries: v.ministries,
    /** 2 年度以上 1 者応札が続く事業（金額の大きい順・上位）と総数 */
    repeatSingle: v.repeatSingle.slice(0, VENDOR_REPEAT_LIMIT),
    repeatSingleCount: v.repeatSingleCount,
    repeatSoleCount: v.repeatSoleCount,
    notes: ['金額は 1 円単位。契約（入札・随意契約）と契約以外（補助金・運営費交付金）を分けて述べる'],
  };
}

/** 事業の来年度概算要求（レビューシートの要求額と財務省明細表の突き合わせ） */
export function shapeBudgetRequest(pid: string, links: BudgetRequestProjectLinks | null, requestedFY: number) {
  if (!links) return { pid, requestedFY, coverage: 'not-crawled' as const, items: [], notes: ['この事業の府省は原資料を取得できていない'] };
  const COVERAGE_NOTE: Record<BudgetRequestProjectLinks['coverage'], string> = {
    linked: '明細表の 目 と対応づけできた',
    'no-match': '府省の明細表は取得済みだが、この事業の 目 に一致する行が無い',
    'not-crawled': 'この府省の原資料をまだ取得できていない',
    'no-line-items': 'この事業のレビューシートに 目 の明細が無い',
  };
  return {
    pid,
    requestedFY,
    coverage: links.coverage,
    notes: [
      COVERAGE_NOTE[links.coverage],
      'rsBudgetYen = レビューシートの当初予算（目から受けている額）、rsNextRequestYen = レビューシートの翌年度要求額、requestYen / previousYen = 財務省明細表の 目 全体の要求額と前年度額（事業単位ではなく 目 単位）',
    ],
    items: links.items.map(i => ({
      ministry: i.ministry, organization: i.organization, kou: i.kou, moku: i.moku,
      rsBudgetYen: i.rsBudgetYen, rsNextRequestYen: i.rsNextRequestYen,
      requestYen: i.requestYen, previousYen: i.previousYen, rows: i.rows, matchedBy: i.matchedBy,
      source: { url: i.url, page: i.page, documentTitle: i.documentTitle },
    })),
    unmatched: links.unmatched,
  };
}
