/** Official budget requests: never enacted budgets, expenditure, or inherited AI scores. */
export type AmountStatus = 'numeric' | '事項要求' | 'blank' | 'extraction_failed';
export interface RequestAmount { valueYen: number | null; status: AmountStatus; raw: string; }
export type RequestDocumentType = 'overview' | 'accounting_table' | 'demand_list' | 'investment_list' | 'index' | 'unknown';
export type AcquisitionStatus = 'discovered' | 'fetched' | 'extracted' | 'partial' | 'unsupported' | 'fetch_failed' | 'extraction_failed';
export interface RequestRevision { hash: string; retrievedAt: string; revision: number; }
export interface BudgetRequestDocument {
  id: string; url: string; title: string; ministry: string; account: string | null;
  documentType: RequestDocumentType; parentUrl: string | null; requestedFY: number;
  status: AcquisitionStatus; retrievedAt: string | null; lastAttemptAt: string;
  hash: string | null; revision: number; revisions: RequestRevision[];
  contentType: string | null; recordCount: number; error: string | null; validation: string[];
}
export interface BudgetRequestRecord {
  id: string; documentId: string; requestedFY: number; publicationFY: number | null; sheetFY: number | null;
  ministry: string; department: string | null; account: string | null; subaccount: string | null;
  itemCodes: string[]; requestNumber: string | null; projectName: string;
  amounts: { request: RequestAmount; demand: RequestAmount; specialInvestment: RequestAmount };
  originalUnit: string | null; previousYear: RequestAmount; previousYearComparisonBasis: string | null;
  documentType: RequestDocumentType; parentId: string | null; aggregationFlag: 'total' | 'subtotal' | 'detail' | 'unknown';
  provenance: { url: string; page: number | null; cell: string | null; rawQuote: string; hash: string; retrievedAt: string; extractionMethod: string; validation: string[] };
  rsLink: { status: 'exact' | 'inferred' | 'unmatched'; projectIds: number[]; sheetFY: number | null; evidence: string | null };
}
export interface BudgetRequestDataset {
  schemaVersion: 1; requestedFY: number; generatedAt: string; indexUrl: string;
  coverage: { ministries: number; discoveredDocuments: number; fetchedDocuments: number; extractedDocuments: number; records: number; warnings: string[] };
  documents: BudgetRequestDocument[]; records: BudgetRequestRecord[];
}
