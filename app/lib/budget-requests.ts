/** 概算要求の絞り込み・表示。資料間の重複があるため金額の合計は作らない。 */
import type { AcquisitionStatus, BudgetRequestDataset, BudgetRequestDocument, BudgetRequestRecord, RequestAmount, RequestDocumentType } from '@/types/budget-requests';

export const REQUESTED_FY = 2027;
export const DOCUMENT_TYPE_LABELS: Record<RequestDocumentType, string> = {
  overview: '要求概要', accounting_table: '会計別表', demand_list: '要望一覧', investment_list: '特別投資枠一覧', index: '掲載ページ', unknown: '未分類',
};
export const ACQUISITION_STATUS_LABELS: Record<AcquisitionStatus, string> = {
  discovered: '発見・未取得', fetched: '取得済・未抽出', extracted: '抽出済', partial: '一部抽出', unsupported: '対象外・未対応', fetch_failed: '取得失敗', extraction_failed: '抽出失敗',
};
export const AMOUNT_TYPE_LABELS = { request: '要求額', demand: '要望額', specialInvestment: '特別投資枠' } as const;
export type RequestAmountType = keyof typeof AMOUNT_TYPE_LABELS;
export const BUDGET_REQUEST_NOTES = [
  '概算要求・要望段階の公表資料です。成立予算・執行実績ではありません。',
  '数値は1円単位です。事項要求・空欄・抽出失敗はゼロとは異なります。',
  '概要・内訳・総計など重複しうる資料を含みます。資料横断の金額合計は算出していません。',
  '自動取得・抽出した記載です。解釈や金額は原資料と照合してください。過年度のAI評価を当年度評価として引き継いでいません。',
] as const;

export interface BudgetRequestFilters {
  query: string; ministry: string; status: AcquisitionStatus | ''; documentType: RequestDocumentType | ''; amountType: RequestAmountType | '';
  page: number; pageSize: number;
}
export const DEFAULT_REQUEST_FILTERS: BudgetRequestFilters = { query: '', ministry: '', status: '', documentType: '', amountType: '', page: 1, pageSize: 50 };

export function parseBudgetRequestFilters(params: URLSearchParams): BudgetRequestFilters {
  const query = (params.get('q') ?? '').trim();
  const ministry = (params.get('ministry') ?? '').trim();
  const status = params.get('status') ?? '';
  const documentType = params.get('type') ?? '';
  const amountType = params.get('amount') ?? '';
  const fy = params.get('fy');
  if (fy !== null && fy !== String(REQUESTED_FY)) throw new Error('対応する要求年度は2027年度です');
  if (query.length > 200 || ministry.length > 100) throw new Error('検索条件が長すぎます');
  if (status && !Object.hasOwn(ACQUISITION_STATUS_LABELS, status)) throw new Error('取得状況が不正です');
  if (documentType && !Object.hasOwn(DOCUMENT_TYPE_LABELS, documentType)) throw new Error('資料種別が不正です');
  if (amountType && !Object.hasOwn(AMOUNT_TYPE_LABELS, amountType)) throw new Error('金額区分が不正です');
  const parsePositive = (key: string, fallback: number, max: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^[1-9]\d*$/.test(raw) || Number(raw) > max) throw new Error(`${key} が不正です`);
    return Number(raw);
  };
  return { query, ministry, status: status as AcquisitionStatus | '', documentType: documentType as RequestDocumentType | '', amountType: amountType as RequestAmountType | '',
    page: parsePositive('page', 1, 100_000), pageSize: parsePositive('limit', 50, 100) };
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja');
const contains = (values: (string | null | undefined)[], query: string) => normalize(values.filter(Boolean).join(' ')).includes(query);
const documentText = (document: BudgetRequestDocument) => [document.title, document.ministry, document.account, document.url];

export function filterBudgetRequests(data: BudgetRequestDataset, filters: BudgetRequestFilters) {
  const query = normalize(filters.query);
  const eligibleDocuments = data.documents.filter(document => (!filters.ministry || document.ministry === filters.ministry)
    && (!filters.status || document.status === filters.status) && (!filters.documentType || document.documentType === filters.documentType));
  const documentsById = new Map(eligibleDocuments.map(document => [document.id, document]));
  const records = data.records.filter(record => {
    const document = documentsById.get(record.documentId);
    return !!document && (!filters.ministry || record.ministry === filters.ministry)
      && (!filters.amountType || record.amounts[filters.amountType].status !== 'blank')
      && (!query || contains([record.projectName, record.department, record.account, record.requestNumber, ...record.itemCodes, ...documentText(document)], query));
  });
  const recordDocumentIds = new Set(records.map(record => record.documentId));
  const documents = eligibleDocuments.filter(document => (!query || contains(documentText(document), query) || recordDocumentIds.has(document.id))
    && (!filters.amountType || recordDocumentIds.has(document.id)));
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
