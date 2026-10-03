'use client';

/**
 * 支出先の契約方式を3年度（RS公開API シート2024〜2026）で並べる。支出先の説明（UnifiedRecipientProfile）の一部。
 * 「同じ事業で随意契約が続いているもの」は確認の手がかりで、随意契約そのものは法令で認められた方式。
 */
import { historyYearLabel, type ContractHistory, type ContractHistoryYear, type ContinuingProjectYear } from '@/app/lib/contract-history';
import { CONTRACT_CATEGORY_DESCRIPTIONS, type ContractCategory } from '@/app/lib/contract-method';
import { formatBudgetFromYen, formatBudgetShort } from '@/client/lib/formatBudget';

/** 狭い欄用（有効数字3〜4桁。formatBudgetShort は千円単位を受ける） */
const yen = (amount: number) => <span className="whitespace-nowrap">{formatBudgetShort(amount / 1000)}</span>;

/** 推移の表の列（区分のまとめ方）。国庫債務負担行為・補助金等・少額随契は省く */
const COLUMNS: { label: string; categories: ContractCategory[] }[] = [
  { label: '競争入札', categories: ['open', 'selective'] },
  { label: '随契（企画競争・公募）', categories: ['negotiated-competitive'] },
  { label: '随契（競争なし）', categories: ['negotiated-sole'] },
];

const sum = (y: ContractHistoryYear, categories: ContractCategory[]) => y.methods.filter(m => categories.includes(m.category))
  .reduce((s, m) => ({ count: s.count + m.count, amount: s.amount + m.amount }), { count: 0, amount: 0 });

function YearCell({ y }: { y: ContinuingProjectYear }) {
  if (!y.projectListed) return <span className="text-mirai-text-muted">事業の記載なし</span>;
  if (y.soleCount + y.negotiatedCompetitiveCount + y.otherCount === 0) return <span className="text-mirai-text-muted">契約なし</span>;
  return <>
    {y.soleCount > 0 && <div className="tabular-nums"><span className="text-status-warn-fg">競争なし</span> {yen(y.soleAmount)}</div>}
    {y.negotiatedCompetitiveCount > 0 && <div className="tabular-nums"><span className="text-mirai-text-subtle">企画競争等</span> {yen(y.negotiatedCompetitiveAmount)}</div>}
    {y.otherCount > 0 && <div className="tabular-nums text-mirai-text-muted">ほか {yen(y.otherAmount)}</div>}
  </>;
}

export function RecipientContractHistory({ history, label, meta }: {
  history: ContractHistory; label: React.CSSProperties; meta: React.CSSProperties;
}) {
  if (history.years.every(y => y.count === 0)) return null;
  return <div className="space-y-3">
    <div>
      <div className="mb-1 font-bold text-mirai-text-secondary" style={label}>契約方式の推移（3年度）</div>
      <table className="w-full table-fixed border-collapse" style={meta}>
        <thead><tr className="text-left text-mirai-text-muted">
          <th className="w-[22%] pb-1 font-normal">年度</th>
          {COLUMNS.map(c => <th key={c.label} className="pb-1 pr-1 font-normal" title={c.categories.map(k => CONTRACT_CATEGORY_DESCRIPTIONS[k]).join(' ')}>{c.label}</th>)}
          <th className="w-[14%] pb-1 font-normal">1者応札</th>
        </tr></thead>
        <tbody>
          {history.years.map(y => <tr key={y.sheetYear} className="border-t border-mirai-border align-top">
            <td className="py-1 text-mirai-text-subtle">{historyYearLabel(y.sheetYear)}</td>
            {!y.available ? <td colSpan={COLUMNS.length + 1} className="py-1 text-mirai-text-muted">データなし</td> : <>
              {COLUMNS.map(c => { const t = sum(y, c.categories); return <td key={c.label} className="py-1 pr-1 tabular-nums">
                <div className="text-mirai-text-subtle">{t.count}件</div>{t.count > 0 && <div className="text-mirai-text-muted">{yen(t.amount)}</div>}</td>; })}
              <td className={`py-1 tabular-nums ${y.singleBidder > 0 ? 'font-bold text-status-warn-fg' : 'text-mirai-text-muted'}`}>{y.singleBidder}件</td>
            </>}
          </tr>)}
        </tbody>
      </table>
      <p className="mt-1 text-mirai-text-muted" style={meta}>件数・金額はRS公開APIの契約（法人番号で年度をまたいで突き合わせ）。1者応札は全契約のうち応札・応募が1者だった件数。国庫債務負担行為・補助金等・少額随契は表から省いています。2023年度は元データで一部の契約に契約方式の記載がなく、その分は数えていません。</p>
    </div>
    {history.continuingCount > 0 && <div>
      <div className="mb-1 font-bold text-mirai-text-secondary" style={label}>同じ事業で随意契約が続いているもの
        <span className="ml-1 font-normal text-mirai-text-muted">{history.continuingCount}事業{history.continuingAllSoleCount > 0 && `（うち競争なしのみ ${history.continuingAllSoleCount}事業）`}</span></div>
      <p className="mb-1.5 leading-relaxed text-mirai-text-muted" style={meta}>3年度のうち2年度以上、同じ事業でこの相手と随意契約（企画競争・公募・競争なし。少額を除く）を結んでいる事業です。システムの保守など、継続性から随意契約になる場合もあります。適否の判断ではなく、理由や応札状況を確かめる手がかりとしてご覧ください。</p>
      <ul className="m-0 list-none space-y-2 p-0">
        {history.continuing.map(p => <li key={p.pid} className="rounded-lg bg-mirai-surface px-2.5 py-2">
          <div className="flex items-start justify-between gap-2" style={label}>
            <span className="text-mirai-text">{p.name ?? `事業ID ${p.pid}`}</span>
            {p.allSole && <span className="shrink-0 rounded-full bg-status-warn-bg px-1.5 py-0.5 font-bold text-status-warn-fg" style={meta}
              title="契約があった年度はすべて、競争を経ない随意契約（少額を除く）でした">競争なし</span>}
          </div>
          <div className="mb-1 text-mirai-text-muted" style={meta}>{p.ministry && `${p.ministry} · `}随意契約 計{formatBudgetFromYen(p.negotiatedAmount)}（{p.negotiatedYears}年度）</div>
          <div className="grid grid-cols-3 gap-1.5" style={meta}>
            {p.years.map(y => <div key={y.sheetYear}>
              <div className="text-mirai-text-muted">{historyYearLabel(y.sheetYear)}</div>
              <YearCell y={y} />
            </div>)}
          </div>
        </li>)}
      </ul>
      {history.continuingCount > history.continuing.length && <p className="mt-1 text-mirai-text-muted" style={meta}>随意契約の金額が大きい{history.continuing.length}事業を表示しています。</p>}
    </div>}
  </div>;
}
