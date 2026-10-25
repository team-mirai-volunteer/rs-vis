import type { SubcontractGraph } from '@/types/subcontract';
import type { ContractMethodEntry } from '@/app/lib/contract-method';

/** 直接支出ブロックから 1 段先のブロック ID（参照フローと直接支出どうしは除く） */
function firstHopBlocks(g: SubcontractGraph): Set<string> {
  const direct = new Set(g.blocks.filter(b => b.originKind === 'direct').map(b => b.blockId));
  const hop = new Set<string>();
  for (const f of g.flows) {
    if (f.isReference || f.sourceBlock === null || !direct.has(f.sourceBlock) || direct.has(f.targetBlock)) continue;
    hop.add(f.targetBlock);
  }
  return hop;
}

/**
 * 直接支出のうち、直接の支出先からさらに先のブロックへ流れた額と、その割合（0〜1）。
 *
 * 「支出額合計」は各段階を足した額で同じお金を二重に数えるため、分母にしない。
 * 分子は直接支出ブロックから 1 段先のブロックの金額だけ（2 段目以降を足すとまた二重になる）。
 * 先のブロックは契約上の再委託とは限らない（補助金の再交付・支出委任なども 5-2 では同じ形で並ぶ）。
 */
export function onwardShare(g: SubcontractGraph): { amount: number; share: number | null } {
  const amountById = new Map(g.blocks.map(b => [b.blockId, b.totalAmount]));
  const amount = [...firstHopBlocks(g)].reduce((sum, id) => sum + Math.max(0, amountById.get(id) ?? 0), 0);
  const share = g.directExpenseTotal > 0 ? Math.min(1, amount / g.directExpenseTotal) : null;
  return { amount, share };
}

/** 再委託（1 段先）の種類。画面全体の呼び名は「再委託」のまま、詳細の内訳だけをこの粒度で出す */
export type OnwardKind = '委託・請負' | '補助・交付金' | '支出委任・その他' | '種別の記載なし';

/** 契約方式と補足の記述から、再委託ブロックの支出の種類を決める */
export function onwardKind(e: Pick<ContractMethodEntry, 'm' | 'mt'>): OnwardKind {
  if (e.m === 'subsidy' || e.m === 'management-expense-grant') return '補助・交付金';
  if (e.m !== 'others') return '委託・請負';   // 競争入札・随意契約・国庫債務負担行為
  const mt = e.mt ?? '';
  if (!mt.trim()) return '種別の記載なし';
  if (/補助|交付/.test(mt)) return '補助・交付金';
  if (/委託|請負|競争|随意|契約/.test(mt)) return '委託・請負';
  return '支出委任・その他';
}

/**
 * 1 段先の再委託ブロックの支出を種類ごとに集計し、金額の多い順に割合（0〜1）で返す。
 * 契約方式の行が無いブロックは数えない。合計が 0 なら空。
 */
export function onwardKindBreakdown(g: SubcontractGraph, entries: readonly ContractMethodEntry[]): { kind: OnwardKind; share: number }[] {
  const hop = firstHopBlocks(g);
  const sums = new Map<OnwardKind, number>();
  for (const e of entries) {
    if (!hop.has(e.b) || !e.a || e.a <= 0) continue;
    const k = onwardKind(e);
    sums.set(k, (sums.get(k) ?? 0) + e.a);
  }
  const total = [...sums.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return [...sums].map(([kind, v]) => ({ kind, share: v / total })).sort((a, b) => b.share - a.share);
}
