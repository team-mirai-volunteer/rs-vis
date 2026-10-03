'use client';

/**
 * 支出先ノードを選んだときの「支出先そのものの説明」。法人番号・受注額・支出元の府省・契約方式の内訳を出す。
 * データは /api/recipient-profile（支出先インデックスと RS 公開 API の契約方式）。シート年度ごとにキャッシュする。
 */
import type { RecipientProfile } from '@/app/lib/recipient-profile';
import { CONTRACT_CATEGORY_DESCRIPTIONS, CONTRACT_CATEGORY_LABELS } from '@/app/lib/contract-method';
import { fiscalYearLabel } from '@/app/lib/rs-fiscal-year';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { useCached } from './policy-summary-cache';

const cache = new Map<string, RecipientProfile | null>();
const extract = (d: unknown) => d as RecipientProfile;

export function UnifiedRecipientProfile({ name, sheetYear, scaleFont }: { name: string; sheetYear: number; scaleFont: (px: number) => number }) {
  const profile = useCached(cache, `${sheetYear}|${name}`, `/api/recipient-profile?year=${sheetYear}&name=${encodeURIComponent(name)}`, extract);
  const label = { fontSize: scaleFont(11) };
  const meta = { fontSize: scaleFont(10) };
  if (profile === undefined) return <p role="status" className="py-2 text-xs text-mirai-text-muted">支出先の情報を読み込み中…</p>;
  if (profile === null) return <p className="py-2 text-xs text-mirai-text-muted">支出先の情報を取得できませんでした。</p>;
  const entry = profile.entry;
  return <section aria-label="支出先の情報" className="space-y-3 pb-3 text-xs">
    {profile.genericNote && <p className="rounded-lg bg-mirai-surface px-3 py-2 leading-relaxed text-mirai-text-secondary">{profile.genericNote}</p>}
    {!entry && !profile.genericNote && <p className="text-mirai-text-muted">{fiscalYearLabel(sheetYear)}の支出先一覧に、この名前の支出先は見つかりませんでした。</p>}
    {entry && <>
      {/* 法人番号はパネルの見出しに出るので、ここでは記載が無いときだけ伝える */}
      {!entry.corporateNumber && <p className="text-mirai-text-muted" style={meta}>法人番号の記載はありません（任意団体・個人など番号を持たない相手か、記載漏れの可能性があります）。</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1" style={label}>
        <div><dt className="text-mirai-text-muted">直接の受注</dt><dd className="font-bold tabular-nums text-mirai-text">{formatBudgetFromYen(entry.directAmount)}<span className="ml-1 font-normal text-mirai-text-muted">{entry.directCount.toLocaleString()}件</span></dd></div>
        <div><dt className="text-mirai-text-muted">再委託での受注</dt><dd className="font-bold tabular-nums text-mirai-text">{formatBudgetFromYen(entry.subcontractAmount)}<span className="ml-1 font-normal text-mirai-text-muted">{entry.subcontractCount.toLocaleString()}件</span></dd></div>
      </dl>
      <p className="text-mirai-text-muted" style={meta}>直接と再委託は同じお金を二重に数えることがあるため合算していません。支出元は{entry.projectCount.toLocaleString()}事業。</p>
      {entry.byMinistry.length > 0 && <div>
        <div className="mb-1 font-bold text-mirai-text-secondary" style={label}>支出元の府省</div>
        <ul className="m-0 list-none space-y-0.5 p-0" style={label}>
          {entry.byMinistry.map(m => <li key={m.ministry} className="flex justify-between gap-3"><span className="text-mirai-text-subtle">{m.ministry}<span className="ml-1 text-mirai-text-muted">{m.projectCount}事業</span></span><span className="shrink-0 tabular-nums text-mirai-text-muted">{formatBudgetFromYen(m.amount)}</span></li>)}
        </ul>
      </div>}
      {profile.methods.length > 0 && <div>
        <div className="mb-1 font-bold text-mirai-text-secondary" style={label}>契約方式の内訳</div>
        <ul className="m-0 list-none space-y-0.5 p-0" style={label}>
          {profile.methods.map(m => <li key={m.category} className="flex justify-between gap-3" title={CONTRACT_CATEGORY_DESCRIPTIONS[m.category]}>
            <span className="text-mirai-text-subtle">{CONTRACT_CATEGORY_LABELS[m.category]}<span className="ml-1 text-mirai-text-muted">{m.count}件</span>
              {m.singleBidder > 0 && <span className="ml-1 font-bold text-status-warn-fg">1者応札 {m.singleBidder}件</span>}</span>
            <span className="shrink-0 tabular-nums text-mirai-text-muted">{formatBudgetFromYen(m.amount)}</span>
          </li>)}
        </ul>
      </div>}
      {entry.aliases.length > 0 && <p className="text-mirai-text-muted" style={meta}>別の表記: {entry.aliases.join('、')}</p>}
    </>}
    <p className="text-mirai-text-muted" style={meta}>出典: {fiscalYearLabel(sheetYear)}のRSシート（支出先・再委託）、契約方式はRS公開API</p>
  </section>;
}
