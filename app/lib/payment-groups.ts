/**
 * RS公開APIの支出先グループ（payment-groups：A・B…のブロック）を表示用に整える。基金シート・セグメントシートで共用。
 * グループ間のつながり（payment-edges）はこれらのシートでは空なので、段階の違う支払いが並ぶ。合計は出さないこと。
 */
import type { FundPaymentGroup } from '@/types/funds';
import { normalizeRecipientName } from './recipient-key';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim() !== 'ー' && v.trim() !== '-' ? v.trim() : null);

/** 法人格を付けた正式名（独立行政法人国際協力機構）と、法人格を省いた名前（国際協力機構）を同じ法人とみなす */
const isOwner = (payee: string, owner: string) => payee === owner || (owner.length >= 4 && payee.endsWith(owner));

/** owner は基金の保有法人・独立行政法人の名前。支払先がすべてその法人のグループを self（法人自身が受け取る段階）とする */
export function paymentGroups(groups: Raw[], owner: string): FundPaymentGroup[] {
  const ownerKey = normalizeRecipientName(owner);
  return groups.map(g => {
    const payees = (g.payments ?? []).map((pay: Raw) => ({
      name: text(pay.name) ?? '（名称なし）',
      corporateNumber: text(pay.corporate_number),
      amount: pay.negative_total_contract_amount_count ? null : num(pay.total_contract_amount),
      method: text(pay.contracts?.[0]?.contract_method),
      others: !!pay.is_others,
    })).sort((a: { amount: number | null }, b: { amount: number | null }) => (b.amount ?? 0) - (a.amount ?? 0));
    const overview = text(g.overview);
    return {
      code: text(g.display_code) ?? '',
      name: text(g.name) ?? '',
      overview: overview && overview.length > 300 ? `${overview.slice(0, 300)}…` : overview,
      total: g.negative_total_amount_count ? null : num(g.total_amount),
      self: !!ownerKey && payees.length > 0 && payees.every((pay: { name: string }) => isOwner(normalizeRecipientName(pay.name), ownerKey)),
      payees,
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
}
