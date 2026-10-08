'use client';

/**
 * 支出先グループ（A・B…のブロック）の一覧。基金シート・セグメントシートで共用する。
 * グループ間のつながりはシートに無く段階の違う支払いが並ぶので、合計は出さない。
 */
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { CONTRACT_METHOD_LABELS, isContractMethodCode } from '@/app/lib/contract-method';
import type { FundPaymentGroup } from '@/types/funds';

const yen = (v: number | null) => (v === null ? '—' : formatBudgetFromYen(v));
const methodLabel = (m: string | null) => (m && isContractMethodCode(m) ? CONTRACT_METHOD_LABELS[m] : null);

/** selfLabel は支払先がすべて法人自身のグループに付ける印（基金なら「基金自身」、独法なら「法人自身」） */
export function PaymentGroupList({ groups, selfLabel }: { groups: FundPaymentGroup[]; selfLabel: string }) {
  return <ul className="m-0 mt-1 list-none space-y-1 p-0">
    {groups.map(g => <li key={g.code}>
      <details className="rounded-lg bg-mirai-surface px-2 py-1">
        <summary className="flex cursor-pointer items-baseline gap-1.5">
          <span className="w-4 shrink-0 font-bold text-mirai-text-muted">{g.code}</span>
          <span className="min-w-0 flex-1 truncate" title={g.name}>{g.name}</span>
          {g.self && <span className="shrink-0 rounded bg-card px-1 text-[10px] text-mirai-text-muted">{selfLabel}</span>}
          <span className="shrink-0 tabular-nums">{yen(g.total)}</span>
        </summary>
        {g.overview && <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-mirai-text-subtle">{g.overview}</p>}
        <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[11px]">
          {g.payees.map((p, i) => <li key={`${p.name}-${i}`} className="flex justify-between gap-2">
            <span className="min-w-0 truncate" title={[p.name, p.corporateNumber && `法人番号 ${p.corporateNumber}`, methodLabel(p.method)].filter(Boolean).join('・')}>
              {p.others ? <span className="text-mirai-text-muted">{p.name}</span> : p.name}
              {methodLabel(p.method) && <span className="ml-1 text-mirai-text-muted">{methodLabel(p.method)}</span>}
            </span>
            <span className="shrink-0 tabular-nums">{yen(p.amount)}</span>
          </li>)}
        </ul>
      </details>
    </li>)}
  </ul>;
}
