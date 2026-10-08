'use client';

/**
 * 支出先ノードを選んだときの「支出先そのものの説明」。法人番号・受注額・支出元の府省・契約方式の内訳と3年度の推移を出す。
 * データは /api/recipient-profile（支出先インデックスと RS 公開 API の契約方式）。シート年度ごとにキャッシュする。
 */
import { corporateLinks, type RecipientProfile } from '@/app/lib/recipient-profile';
import { externalCorporateLinks } from '@/app/lib/api/links';
import { CONTRACT_CATEGORY_DESCRIPTIONS, CONTRACT_CATEGORY_LABELS } from '@/app/lib/contract-method';
import { fiscalYearLabel } from '@/app/lib/rs-fiscal-year';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { useCached } from './policy-summary-cache';
import { RecipientContractHistory } from './RecipientContractHistory';

const cache = new Map<string, RecipientProfile | null>();
/** 名前の比較用。法人格の表記と空白を落とす */
const bare = (s: string) => s.normalize('NFKC').replace(/\s|株式会社|有限会社|一般社団法人|公益社団法人|一般財団法人|公益財団法人|独立行政法人|国立研究開発法人|\(株\)|（株）/g, '');
/** どちらかがもう一方を含めば同じ相手とみなす（「富士通株式会社」と「富士通」など） */
const sameEntity = (a: string, b: string) => { const x = bare(a), y = bare(b); return x.includes(y) || y.includes(x); };
const extract = (d: unknown) => d as RecipientProfile;

export function UnifiedRecipientProfile({ name, sheetYear, corporateNumber, scaleFont }: {
  name: string; sheetYear: number;
  /** ノードが持つ代表法人番号。あれば名前より優先して引く（見出しの法人番号と説明を一致させる） */
  corporateNumber?: string;
  scaleFont: (px: number) => number;
}) {
  const cn = corporateNumber && /^\d{13}$/.test(corporateNumber) ? corporateNumber : '';
  const profile = useCached(cache, `${sheetYear}|${name}|${cn}`, `/api/recipient-profile?year=${sheetYear}&name=${encodeURIComponent(name)}${cn ? `&cn=${cn}` : ''}`, extract);
  const label = { fontSize: scaleFont(11) };
  const meta = { fontSize: scaleFont(10) };
  if (profile === undefined) return <p role="status" className="py-2 text-xs text-mirai-text-muted">支出先の情報を読み込み中…</p>;
  if (profile === null) return <p className="py-2 text-xs text-mirai-text-muted">支出先の情報を取得できませんでした。</p>;
  const entry = profile.entry;
  return <section aria-label="支出先の情報" className="space-y-3 pb-3 text-xs">
    {profile.genericNote && <p className="rounded-lg bg-mirai-surface px-3 py-2 leading-relaxed text-mirai-text-secondary">{profile.genericNote}</p>}
    {!entry && !profile.genericNote && <p className="text-mirai-text-muted">{fiscalYearLabel(sheetYear)}の支出先一覧に、この名前の支出先は見つかりませんでした。</p>}
    {entry && <>
      {/* 法人番号で突き合わせた外部情報（所在地・法人種別は RS 公開 API、説明は Wikipedia の冒頭、設立・公式サイト・記事は Wikidata） */}
      {(profile.external || entry.corporateNumber) && <div className="space-y-1.5">
        {/* 法人番号の持ち主の名前が支出先名と食い違うとき（国の出先機関は本省の番号で記載されるなど）は、以下が誰の情報かを先に言う */}
        {/* 会社の略称・英語名・旧社名の違いは同じ相手なので出さない。国の機関・自治体（出先機関・部局が本庁の番号で載る）に限る */}
        {profile.external?.label && (profile.external.k === '101' || profile.external.k === '201') && !sameEntity(profile.name, profile.external.label) &&
          <p className="text-mirai-text-muted" style={meta}>この法人番号は「{profile.external.label}」のものです。以下の説明・所在地は{profile.external.label}の情報です（国の出先機関などは本省の番号で記載されます）。</p>}
        {/* 説明は Wikipedia の冒頭（CC BY-SA のため出典とリンクを添える）。無ければ Wikidata の短い説明 */}
        {profile.external?.wt
          ? <p className="leading-relaxed text-mirai-text-secondary" style={label}>{profile.external.wt}
            {profile.external.wiki && <a href={profile.external.wiki} target="_blank" rel="noopener noreferrer" className="ml-1 whitespace-nowrap text-mirai-text-muted underline underline-offset-4 hover:text-primary-accent" style={meta}>Wikipedia より（CC BY-SA）</a>}</p>
          : profile.external?.desc && <p className="leading-relaxed text-mirai-text-secondary" style={label}>{profile.external.desc}</p>}
        {(profile.external?.kindLabel || profile.external?.ad || profile.external?.since) && <dl className="space-y-0.5" style={label}>
          {profile.external.kindLabel && <div className="flex gap-2"><dt className="w-14 shrink-0 text-mirai-text-muted">法人種別</dt><dd className="text-mirai-text-subtle">{profile.external.kindLabel}</dd></div>}
          {profile.external.ad && <div className="flex gap-2"><dt className="w-14 shrink-0 text-mirai-text-muted">所在地</dt><dd className="text-mirai-text-subtle">{profile.external.ad}</dd></div>}
          {/* Wikidata の日付は年までの精度のことが多い（1月1日で入る）ので年だけ出す */}
          {profile.external.since && <div className="flex gap-2"><dt className="w-14 shrink-0 text-mirai-text-muted">設立</dt><dd className="tabular-nums text-mirai-text-subtle">{profile.external.since.slice(0, 4)}年</dd></div>}
        </dl>}
        <div className="flex flex-wrap gap-x-3 gap-y-1" style={label}>
          {[
            ['公式サイト', profile.external?.site],
            ['Wikipedia', profile.external?.wiki],
            ['法人番号公表サイト', entry.corporateNumber ? corporateLinks(entry.corporateNumber).nta : undefined],
            ['gBizINFO', entry.corporateNumber ? externalCorporateLinks(entry.corporateNumber)?.gbizinfo : undefined],
            ['Wikidata', profile.external?.wd ? `https://www.wikidata.org/wiki/${profile.external.wd}` : undefined],
          ].filter((link): link is [string, string] => !!link[1]).map(([text, href]) =>
            <a key={text} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary-accent">{text} ↗</a>)}
        </div>
      </div>}
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
        <div className="mb-1 font-bold text-mirai-text-secondary" style={label}>契約方式の内訳<span className="ml-1 font-normal text-mirai-text-muted">{fiscalYearLabel(sheetYear)}</span></div>
        <ul className="m-0 list-none space-y-0.5 p-0" style={label}>
          {profile.methods.map(m => <li key={m.category} className="flex justify-between gap-3" title={CONTRACT_CATEGORY_DESCRIPTIONS[m.category]}>
            <span className="text-mirai-text-subtle">{CONTRACT_CATEGORY_LABELS[m.category]}<span className="ml-1 text-mirai-text-muted">{m.count}件</span>
              {m.singleBidder > 0 && <span className="ml-1 font-bold text-status-warn-fg">1者応札 {m.singleBidder}件</span>}</span>
            <span className="shrink-0 tabular-nums text-mirai-text-muted">{formatBudgetFromYen(m.amount)}</span>
          </li>)}
        </ul>
      </div>}
      {profile.history && <RecipientContractHistory history={profile.history} label={label} meta={meta} />}
      {profile.funds && profile.funds.length > 0 && <div>
        <div className="mb-1 font-bold text-mirai-text-secondary" style={label}>この法人が保有する基金<span className="ml-1 font-normal text-mirai-text-muted">{profile.funds.length}基金</span></div>
        <ul className="m-0 list-none space-y-0.5 p-0" style={label}>
          {profile.funds.slice(0, 8).map(f => <li key={f.key} className="flex justify-between gap-3">
            <a href={`/funds?fund=${encodeURIComponent(f.key)}`} className="min-w-0 truncate text-primary underline underline-offset-4 hover:text-primary-accent" title={f.name}>{f.name}</a>
            <span className="shrink-0 tabular-nums text-mirai-text-muted" title={`${f.sheetYear - 1}年度末の残高`}>残高 {f.balance === null ? '—' : formatBudgetFromYen(f.balance)}</span>
          </li>)}
        </ul>
        {profile.funds.length > 8 && <p className="mt-0.5 text-mirai-text-muted" style={meta}>ほか{profile.funds.length - 8}基金（基金一覧で保有法人名を検索）</p>}
      </div>}
      {entry.aliases.length > 0 && <p className="text-mirai-text-muted" style={meta}>別の表記: {entry.aliases.join('、')}</p>}
    </>}
    <p className="text-mirai-text-muted" style={meta}>出典: {fiscalYearLabel(sheetYear)}のRSシート（支出先・再委託）、契約方式・所在地・法人種別はRS公開API{profile.external?.wd && '、設立・公式サイト・Wikipedia の記事は Wikidata（法人番号で一致したもの）'}</p>
  </section>;
}
