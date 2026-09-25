/**
 * 支出先の「何に支払ったか」（契約の概要）を事業の再委託構造データから引く（Pure 層）。
 *
 * 「個人A」「A社」のような伏せ字や、金額だけでは誤解しやすい支出先を、ホバーで契約内容とともに示すためのもの。
 * 同じ表記でも事業が違えば別の相手になりうるので、必ず事業（pid）ごとに引き、事業名を添えて返す。
 */
import type { SubcontractGraph } from '@/types/subcontract';

export interface RecipientContractEntry {
  pid: number;
  projectName: string;
  /** その事業でこの支出先に記載された金額の合計（円） */
  amount: number;
  /** 契約の概要（重複は除く・記載順） */
  contracts: string[];
}

export interface RecipientContractsResponse {
  name: string;
  entries: RecipientContractEntry[];
}

/** 一度に引く事業の上限。ホバー1回で重い処理にしない */
export const RECIPIENT_CONTRACTS_MAX_PIDS = 5;

/** 1事業ぶん。支出先名が完全一致する記載を全ブロックから集める。無ければ null */
export function recipientContractsInProject(graph: Pick<SubcontractGraph, 'projectId' | 'projectName' | 'blocks'>, name: string): RecipientContractEntry | null {
  const target = name.trim();
  let amount = 0;
  let found = false;
  const contracts: string[] = [];
  for (const block of graph.blocks) {
    for (const recipient of block.recipients) {
      if (recipient.name.trim() !== target) continue;
      found = true;
      if (Number.isFinite(recipient.amount)) amount += recipient.amount;
      for (const summary of recipient.contractSummaries) {
        const text = summary.trim();
        if (text && !contracts.includes(text)) contracts.push(text);
      }
    }
  }
  return found ? { pid: graph.projectId, projectName: graph.projectName, amount, contracts } : null;
}
