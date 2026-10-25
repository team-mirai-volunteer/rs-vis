import type { SubcontractGraph } from '@/types/subcontract';
import type { ContractMethodEntry } from '@/app/lib/contract-method';
import { isOthersRowName } from '@/app/lib/others-count';

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
export type OnwardKind = '委託・請負' | '補助・交付' | '支出委任等' | '種別不明';

/** 契約方式と補足の記述から、再委託ブロックの支出の種類を決める */
export function onwardKind(e: Pick<ContractMethodEntry, 'm' | 'mt'>): OnwardKind {
  if (e.m === 'subsidy' || e.m === 'management-expense-grant') return '補助・交付';
  if (e.m !== 'others') return '委託・請負';   // 競争入札・随意契約・国庫債務負担行為
  const mt = e.mt ?? '';
  if (!mt.trim()) return '種別不明';
  if (/補助|交付/.test(mt)) return '補助・交付';
  if (/委託|請負|競争|随意|契約/.test(mt)) return '委託・請負';
  return '支出委任等';
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

/**
 * 再委託先（originKind = subcontract のブロック）の支出先のうち、名前のある最大の相手と、
 * 府省が「その他」とまとめた行の合計（金額・件数）。「最大は その他」では相手が分からないため分けて出す。
 * 件数は各ブロックの othersCount（RS 公開 API の支出先の数から算出）を足す。1 つでも分からなければ null。
 */
export function largestSubcontractRecipients(g: SubcontractGraph): {
  largest: { name: string; amount: number } | null;
  others: { amount: number; count: number | null } | null;
} {
  let largest: { name: string; amount: number } | null = null;
  let othersAmount = 0;
  let othersCount: number | null = 0;
  let hasOthers = false;
  for (const b of g.blocks) {
    if (b.originKind !== 'subcontract') continue;
    let blockHasOthers = false;
    for (const r of b.recipients ?? []) {
      if (r.amount <= 0) continue;
      if (isOthersRowName(r.name)) { othersAmount += r.amount; blockHasOthers = true; continue; }
      if (!largest || r.amount > largest.amount) largest = { name: r.name, amount: r.amount };
    }
    if (blockHasOthers) {
      hasOthers = true;
      othersCount = othersCount !== null && b.othersCount ? othersCount + b.othersCount.n : null;
    }
  }
  return { largest, others: hasOthers ? { amount: othersAmount, count: othersCount } : null };
}

/** ブロックのタグに出す呼び名。契約上の委託・請負だけを「再委託」と呼ぶ */
export const ONWARD_KIND_TAG: Record<OnwardKind, string> = {
  '委託・請負': '再委託',
  '補助・交付': '補助・交付',
  '支出委任等': '支出委任等',
  '種別不明': '種別不明',
};

/**
 * 再委託ブロック（originKind = subcontract）ごとの種類。ブロック内の契約の金額が最も大きい種類で決める。
 * 契約方式の行が無いブロックは入れない（呼び出し側は「再委託」のまま出す）。
 */
export function onwardKindByBlock(g: SubcontractGraph, entries: readonly ContractMethodEntry[]): Map<string, OnwardKind> {
  const sub = new Set(g.blocks.filter(b => b.originKind === 'subcontract').map(b => b.blockId));
  const sums = new Map<string, Map<OnwardKind, number>>();
  for (const e of entries) {
    if (!sub.has(e.b) || !e.a || e.a <= 0) continue;
    const m = sums.get(e.b) ?? new Map<OnwardKind, number>();
    const k = onwardKind(e);
    m.set(k, (m.get(k) ?? 0) + e.a);
    sums.set(e.b, m);
  }
  const out = new Map<string, OnwardKind>();
  for (const [b, m] of sums) out.set(b, [...m].sort((x, y) => y[1] - x[1])[0][0]);
  return out;
}
