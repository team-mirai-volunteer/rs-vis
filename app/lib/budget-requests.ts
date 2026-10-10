/**
 * 概算要求の絞り込み・表示。資料間の重複があるため金額の合計は作らない。
 * 一覧に出すのは要求額（通常要求）を読み取れた行だけ。要望額・特別投資枠は原資料が自由レイアウトの一覧で
 * 現状は抽出しておらず、項目としては出さない（読み取れた行があれば抽出根拠の中に補足として示す）。
 */
import type { AcquisitionStatus, BudgetRequestDataset, BudgetRequestDocument, BudgetRequestRecord, RequestAmount, RequestDocumentType } from '@/types/budget-requests';

export const REQUESTED_FY = 2027;
export const DOCUMENT_TYPE_LABELS: Record<RequestDocumentType, string> = {
  overview: '要求概要', accounting_table: '会計別表', demand_list: '要望一覧', investment_list: '特別投資枠一覧', index: '掲載ページ', unknown: '未分類',
};
export const ACQUISITION_STATUS_LABELS: Record<AcquisitionStatus, string> = {
  discovered: '発見・未取得', fetched: '取得済・未抽出', extracted: '抽出済', partial: '一部抽出', unsupported: '対象外・未対応', fetch_failed: '取得失敗', extraction_failed: '抽出失敗',
};
export const AMOUNT_TYPE_LABELS = { request: '要求額', demand: '要望額', specialInvestment: '特別投資枠' } as const;

/**
 * 資料の種類（読む人向け）。機械判定の documentType（リンクの文言から推定）より、取得後の中身で決める。
 * - 要求書（明細表）: 歳出概算要求額明細表を抽出できた資料、または題名がそれ
 * - 歳入: 歳入予算見積書（歳出の要求ではない）
 * - 要望一覧・投資枠一覧: 要求額とは別枠の一覧
 * - 概要: 概算要求の概要・主要事項・ポイント（自由レイアウト。数値は未抽出）
 * - 参考資料: 自己点検・政策評価調書・事前分析表など、要求額を示す資料ではないもの
 * - 掲載ページ: HTML の掲載ページ
 */
export type DocumentKind = 'request-table' | 'revenue' | 'demand' | 'investment' | 'overview' | 'reference' | 'index' | 'other';
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  'request-table': '要求書（明細表）', revenue: '歳入見積（対象外）', demand: '要望一覧', investment: '投資枠一覧', overview: '要求の概要', reference: '参考資料', index: '掲載ページ', other: 'その他',
};
export function documentKind(document: Pick<BudgetRequestDocument, 'documentType' | 'title' | 'validation' | 'recordCount' | 'status'>): DocumentKind {
  const title = document.title.normalize('NFKC');
  if (document.documentType === 'index') return 'index';
  if (document.validation.some(note => note.includes('歳入資料')) || (/歳入/.test(title) && !/歳出/.test(title))) return 'revenue';
  if (/自己点検|政策評価|事前分析|行政事業レビュー|参考資料|説明資料|調書|Q&A|よくある|定員|機構/.test(title)) return 'reference';
  if (document.recordCount > 0 || /歳出概算要求書|要求額明細|概算要求書/.test(title)) return 'request-table';
  if (document.documentType === 'demand_list' || /要望一覧|要望事項/.test(title)) return 'demand';
  if (document.documentType === 'investment_list' || /投資枠/.test(title)) return 'investment';
  if (document.documentType === 'overview' || /概要|主要事項|重点|ポイント|姿|総括表/.test(title)) return 'overview';
  return 'other';
}
export type RequestAmountType = keyof typeof AMOUNT_TYPE_LABELS;
export const BUDGET_REQUEST_NOTES = [
  '概算要求・要望段階の公表資料です。成立予算・執行実績ではありません。',
  '数値は1円単位です。事項要求・空欄・抽出失敗はゼロとは異なります。',
  '概要・内訳・総計など重複しうる資料を含みます。資料横断の金額合計は算出していません。',
  '自動取得・抽出した記載です。解釈や金額は原資料と照合してください。過年度のAI評価を当年度評価として引き継いでいません。',
] as const;

export interface BudgetRequestFilters {
  query: string; ministry: string; status: AcquisitionStatus | ''; documentType: RequestDocumentType | ''; kind: DocumentKind | '';
  page: number; pageSize: number;
}
export const DEFAULT_REQUEST_FILTERS: BudgetRequestFilters = { query: '', ministry: '', status: '', documentType: '', kind: '', page: 1, pageSize: 50 };

export function parseBudgetRequestFilters(params: URLSearchParams): BudgetRequestFilters {
  const query = (params.get('q') ?? '').trim();
  const ministry = (params.get('ministry') ?? '').trim();
  const status = params.get('status') ?? '';
  const documentType = params.get('type') ?? '';
  const kind = params.get('kind') ?? '';
  const fy = params.get('fy');
  if (fy !== null && fy !== String(REQUESTED_FY)) throw new Error('対応する要求年度は2027年度です');
  if (query.length > 200 || ministry.length > 100) throw new Error('検索条件が長すぎます');
  if (status && !Object.hasOwn(ACQUISITION_STATUS_LABELS, status)) throw new Error('取得状況が不正です');
  if (documentType && !Object.hasOwn(DOCUMENT_TYPE_LABELS, documentType)) throw new Error('資料種別が不正です');
  if (kind && !Object.hasOwn(DOCUMENT_KIND_LABELS, kind)) throw new Error('資料の種類が不正です');
  const parsePositive = (key: string, fallback: number, max: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^[1-9]\d*$/.test(raw) || Number(raw) > max) throw new Error(`${key} が不正です`);
    return Number(raw);
  };
  return { query, ministry, status: status as AcquisitionStatus | '', documentType: documentType as RequestDocumentType | '', kind: kind as DocumentKind | '',
    page: parsePositive('page', 1, 100_000), pageSize: parsePositive('limit', 50, 100) };
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja');
const contains = (values: (string | null | undefined)[], query: string) => normalize(values.filter(Boolean).join(' ')).includes(query);
const documentText = (document: BudgetRequestDocument) => [document.title, document.ministry, document.account, document.url];
/** 要求額を読み取れた行か。事項要求（金額未定）は原資料の記載なので残し、空欄・抽出失敗は一覧に出さない */
export const hasRequestAmount = (record: Pick<BudgetRequestRecord, 'amounts'>) =>
  record.amounts.request.status === '事項要求' || (record.amounts.request.status === 'numeric' && Number.isFinite(record.amounts.request.valueYen));

export function filterBudgetRequests(data: BudgetRequestDataset, filters: BudgetRequestFilters) {
  const query = normalize(filters.query);
  const eligibleDocuments = data.documents.filter(document => (!filters.ministry || document.ministry === filters.ministry)
    && (!filters.status || document.status === filters.status) && (!filters.documentType || document.documentType === filters.documentType)
    && (!filters.kind || documentKind(document) === filters.kind));
  const documentsById = new Map(eligibleDocuments.map(document => [document.id, document]));
  const records = data.records.filter(record => {
    const document = documentsById.get(record.documentId);
    return !!document && (!filters.ministry || record.ministry === filters.ministry)
      && hasRequestAmount(record)
      && (!query || contains([record.projectName, record.department, record.account, record.requestNumber, ...record.itemCodes, ...documentText(document)], query));
  });
  const recordDocumentIds = new Set(records.map(record => record.documentId));
  const documents = eligibleDocuments.filter(document => !query || contains(documentText(document), query) || recordDocumentIds.has(document.id));
  return { documents, records };
}

export function budgetRequestResponse(data: BudgetRequestDataset, filters: BudgetRequestFilters) {
  const filtered = filterBudgetRequests(data, filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const pageRecords = filtered.records.slice(offset, offset + filters.pageSize);
  const pageDocumentIds = new Set(pageRecords.map(record => record.documentId));
  const statusCounts = Object.fromEntries(Object.keys(ACQUISITION_STATUS_LABELS).map(status => [status, data.documents.filter(document => document.status === status).length])) as Record<AcquisitionStatus, number>;
  return {
    schemaVersion: data.schemaVersion, requestedFY: data.requestedFY, generatedAt: data.generatedAt, indexUrl: data.indexUrl,
    metadata: { unit: 'JPY', stage: 'request', notes: BUDGET_REQUEST_NOTES }, coverage: data.coverage,
    ministries: [...new Set(data.documents.map(document => document.ministry))].sort((a, b) => a.localeCompare(b, 'ja')),
    statusCounts,
    pagination: { page: filters.page, pageSize: filters.pageSize, matchingDocuments: filtered.documents.length, matchingRecords: filtered.records.length },
    documents: filtered.documents.slice(offset, offset + filters.pageSize), records: pageRecords,
    recordDocuments: data.documents.filter(document => pageDocumentIds.has(document.id)),
  };
}
export type BudgetRequestResponse = ReturnType<typeof budgetRequestResponse>;

export function formatRequestAmount(amount: RequestAmount): string {
  if (amount.status === '事項要求') return '事項要求（金額未定）';
  if (amount.status === 'blank') return '記載なし';
  if (amount.status === 'extraction_failed' || amount.valueYen === null || !Number.isFinite(amount.valueYen)) return '抽出できず';
  return `${amount.valueYen.toLocaleString('ja-JP')}円`;
}

/** 外部資料の URL は http(s) だけ。PDF ページは資料内の所在を示す。 */
export function requestSourceUrl(url: string, page: number | null = null): string | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (page !== null && Number.isInteger(page) && page > 0 && /\.pdf$/i.test(parsed.pathname)) parsed.hash = `page=${page}`;
    return parsed.href;
  } catch { return null; }
}

export function recordLocation(record: BudgetRequestRecord): string {
  return [record.provenance.page !== null ? `PDF ${record.provenance.page}ページ` : null, record.provenance.cell].filter(Boolean).join('・') || 'ページ・セル未特定';
}
