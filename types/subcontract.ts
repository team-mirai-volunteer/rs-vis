export interface RecipientExpense {
  category: string;
  purpose: string;
  amount: number;
}

export interface BlockRecipient {
  name: string;
  corporateNumber: string;
  amount: number;
  contractSummaries: string[];
  expenses: RecipientExpense[];
}

export interface BlockNode {
  blockId: string;
  blockName: string;
  totalAmount: number;
  isDirect: boolean;
  role?: string;
  recipients: BlockRecipient[];
}

export interface BlockEdge {
  sourceBlock: string | null;
  targetBlock: string;
  note?: string;
}

export interface SubcontractGraph {
  projectId: number;
  projectName: string;
  ministry: string;
  budget: number;
  execution: number;
  blocks: BlockNode[];
  flows: BlockEdge[];
  maxDepth: number;
  directBlockCount: number;
  totalBlockCount: number;
  totalRecipientCount: number;
}

export type SubcontractIndex = Record<string, SubcontractGraph>;
