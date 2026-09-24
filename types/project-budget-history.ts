/** 金額は円。欠損値・未確定の執行額は null。 */
export interface ProjectBudgetHistoryPoint {
  fiscalYear: number;
  initialBudget: number | null;
  totalBudget: number | null;
  executedAmount: number | null;
}

export interface ProjectBudgetHistorySource {
  sheetYear: number;
  sourceUrl: string;
  retrievedAt: string;
  sourceSha256: string;
}

export interface ProjectBudgetHistoryData extends ProjectBudgetHistorySource {
  projects: Record<string, ProjectBudgetHistoryPoint[]>;
}

export interface ProjectBudgetHistoryResponse extends ProjectBudgetHistorySource {
  projectId: number;
  points: ProjectBudgetHistoryPoint[];
}
