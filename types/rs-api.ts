/** Provisional API snapshot. Monetary values are yen; null is unknown, never zero. */
export interface RsApiContract {
  overview: string | null;
  amount: number | null;
  negative_amount_count?: number;
  amount_breakdown: { name: string; purpose: string; amount: number | null }[];
}
export interface RsApiPayment {
  id: string;
  name: string;
  corporate_number: string | null;
  is_others: boolean;
  type: string;
  total_contract_amount: number | null;
  negative_total_contract_amount_count?: number;
  contracts: RsApiContract[];
}
export interface RsApiGroup {
  id: string;
  project_id: string;
  display_code: string;
  name: string;
  overview: string | null;
  total_amount: number | null;
  negative_total_amount_count?: number;
  payments: RsApiPayment[];
}
export interface RsApiEdge {
  source_node_id: string | null;
  target_node_id: string;
  is_connected_to_source_root: boolean;
  label: string | null;
}
export interface RsApiProject {
  id: string;
  fiscal_year: number;
  project_number: string;
  name: string;
  ministry_name: string;
  overview: string;
  purpose: string;
  /** Last external-expert review year, NOT the spending year. */
  last_implemented_fiscal_year: number | null;
  previous_year_execution_amount: number | null;
  negative_previous_year_execution_amount_count?: number;
}
export interface RsApiDetail {
  id: string;
  projectId: number;
  name: string;
  ministry: string;
  sourceUrl: string;
  fiscalYear: number;
  overview: string;
  purpose: string;
  execution: number | null;
  paymentStatus: 'available' | 'missing';
  fetchedAt: string | null;
  groups: RsApiGroup[];
  edges: RsApiEdge[];
}
export interface RsApiCoverage {
  unmatchedBudgetProjects?: number;
  source: 'rs-api';
  provisional: true;
  listed: number;
  executionKnown: number;
  paymentsFetched: number;
  paymentsMissing: number;
  executionUnknown: number;
  unknownPaymentAmounts: number;
  fetchedFrom: string;
  fetchedThrough: string;
}
