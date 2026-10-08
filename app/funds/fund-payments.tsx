'use client';

/**
 * 基金の詳細に出す「支出先」。基金シートの支出先グループ（A・B…）を年度別に並べる。
 * グループ間のつながりはシートに無く、国→基金→事業実施主体→最終的な支払先の各段階が並ぶので、合計は出さない。
 */
import { useEffect, useState } from 'react';
import type { FundPaymentGroup } from '@/types/funds';
import { PaymentGroupList } from '@/client/components/PaymentGroupList';

export function FundPayments({ fundKey }: { fundKey: string }) {
  const [years, setYears] = useState<Record<string, FundPaymentGroup[]> | null | undefined>(undefined);
  const [year, setYear] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setYears(undefined);
    fetch(`/api/fund-payments?fund=${encodeURIComponent(fundKey)}`).then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { const y = d?.years ?? null; setYears(y); setYear(y ? Object.keys(y).sort().at(-1) ?? null : null); } })
      .catch(() => { if (!cancelled) setYears(null); });
    return () => { cancelled = true; };
  }, [fundKey]);
  if (years === undefined) return null;
  const available = years ? Object.keys(years).sort() : [];
  if (!available.length || !year) return null;
  const groups = years![year];
  return <section aria-label="基金の支出先">
    <div className="mb-1 mt-4 flex items-center justify-between gap-2">
      <h3 className="font-bold text-mirai-text-secondary">支出先（基金シート）</h3>
      {available.length > 1 && <select aria-label="支出先の年度" className="rounded-md border border-mirai-border bg-card px-1.5 py-0.5 text-[11px]" value={year} onChange={e => setYear(e.target.value)}>
        {available.map(y => <option key={y} value={y}>{Number(y) - 1}年度実績</option>)}
      </select>}
    </div>
    <p className="text-[11px] leading-relaxed text-mirai-text-muted">
      グループ（A・B…）の間のつながりは基金シートに記載がないため、国→基金→事業実施主体→最終的な支払先の各段階が並びます。合計すると同じお金を重ねて数えます。「基金自身」は保有法人が受け取る段階（国からの交付・基金の管理）で、基金の外へ出た支払いではありません。
    </p>
    <PaymentGroupList groups={groups} selfLabel="基金自身" />
  </section>;
}
