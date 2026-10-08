'use client';

/**
 * 事業の詳細パネルに出す「独立行政法人の事業区分（セグメントシート）」。
 * 運営費交付金などで独立行政法人に渡ったお金が、法人の中でどの事業区分にいくら使われ、誰に支払われたかを示す。
 */
import type { AgencySegment } from '@/types/agency-segments';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { PaymentGroupList } from '@/client/components/PaymentGroupList';
import { useCached } from './policy-summary-cache';

const cache = new Map<string, AgencySegment[] | null>();
const extract = (d: unknown) => (d as { segments: AgencySegment[] }).segments;
const yen = (v: number | null) => (v === null ? '—' : formatBudgetFromYen(v));

export function ProjectAgencySegments({ pid, rsSheetYear, scaleFont }: { pid: number; rsSheetYear: number; scaleFont: (px: number) => number }) {
  const segments = useCached(cache, `${pid}-${rsSheetYear}`, `/api/agency-segments?pid=${pid}&year=${rsSheetYear}`, extract);
  if (!segments || segments.length === 0) return null;
  const agencies = [...new Set(segments.map(s => s.agency))];
  const year = segments[0].sheetYear;
  const byName = segments.some(s => s.linkBasis === 'name');
  return <section aria-label="独立行政法人の事業区分" className="border-b border-border px-3.5 py-2.5">
    <div className="mb-1 font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(13) }}>
      独立行政法人の事業区分<span className="ml-1.5 font-normal text-mirai-text-muted" style={{ fontSize: scaleFont(11) }}>{agencies.join('・')}・{segments.length}区分・{year - 1}年度実績</span>
    </div>
    <ul className="m-0 list-none space-y-1 p-0" style={{ fontSize: scaleFont(11) }}>
      {segments.map(s => <li key={s.id}>
        <details>
          <summary className="flex cursor-pointer items-baseline justify-between gap-2">
            <span className="min-w-0 truncate" title={s.name}>{s.name}</span>
            <span className="shrink-0 tabular-nums text-mirai-text-muted" title="前年度の執行額（セグメントシートの記載）">{yen(s.execution)}</span>
          </summary>
          <div className="mt-1 space-y-1 pl-2">
            {s.overview && <p className="whitespace-pre-line leading-relaxed text-mirai-text-subtle">{s.overview}</p>}
            <p className="tabular-nums text-mirai-text-muted">収入の当初予算 {yen(s.revenueBudget)}・支出予算 {yen(s.expenditureBudget)}{s.concept && `・${s.concept}`}</p>
            {s.groups.length > 0 && <PaymentGroupList groups={s.groups} selfLabel="法人自身" />}
          </div>
        </details>
      </li>)}
    </ul>
    <p className="mt-1.5 text-mirai-text-muted" style={{ fontSize: scaleFont(10) }}>
      出典：RSシステムのセグメントシート（独立行政法人の運営費交付金などを法人内の事業区分ごとに示す資料）。支出先のグループ間のつながりは記載が無いため、合計すると同じお金を重ねて数えることがあります。{byName && '一部の区分は、シートに関連事業の記載が無く、法人名と「運営費交付金」を含む事業名で対応づけています。'}
    </p>
  </section>;
}
