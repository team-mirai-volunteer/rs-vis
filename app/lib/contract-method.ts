/**
 * 契約方式（RS公開APIの contract_method）の分類と表示ラベル（Pure 層）。
 *
 * 金額の大半は補助金・交付金など「契約ではない支出」なので、競争の有無が読み取れる
 * 入札・随意契約と区別して表示する。列挙値は RS システムの API 仕様のまま保持し、分類はここだけで行う。
 */

export type ContractMethodCode =
  | 'open-tendering-lowest-price'
  | 'open-tendering-comprehensive-evaluation'
  | 'selective-tendering-lowest-price'
  | 'selective-tendering-comprehensive-evaluation'
  | 'negotiated-contract-small-amount'
  | 'negotiated-contract-competitive-bidding'
  | 'negotiated-contract-public-offering'
  | 'negotiated-contract-unsuccessful'
  | 'negotiated-contract-others'
  | 'subsidy'
  | 'management-expense-grant'
  | 'act-bearing-national-treasury-liabilities'
  | 'others';

export type ContractCategory = 'open' | 'selective' | 'negotiated-competitive' | 'negotiated-small' | 'negotiated-sole' | 'multi-year' | 'non-contract';

export const CONTRACT_METHOD_LABELS: Record<ContractMethodCode, string> = {
  'open-tendering-lowest-price': '一般競争（最低価格）',
  'open-tendering-comprehensive-evaluation': '一般競争（総合評価）',
  'selective-tendering-lowest-price': '指名競争（最低価格）',
  'selective-tendering-comprehensive-evaluation': '指名競争（総合評価）',
  'negotiated-contract-small-amount': '随意契約（少額）',
  'negotiated-contract-competitive-bidding': '随意契約（企画競争）',
  'negotiated-contract-public-offering': '随意契約（公募）',
  'negotiated-contract-unsuccessful': '随意契約（不落・不調）',
  'negotiated-contract-others': '随意契約（その他）',
  subsidy: '補助金等',
  'management-expense-grant': '運営費交付金',
  'act-bearing-national-treasury-liabilities': '国庫債務負担行為（複数年度）',
  others: 'その他',
};

const CATEGORY_OF: Record<ContractMethodCode, ContractCategory> = {
  'open-tendering-lowest-price': 'open',
  'open-tendering-comprehensive-evaluation': 'open',
  'selective-tendering-lowest-price': 'selective',
  'selective-tendering-comprehensive-evaluation': 'selective',
  'negotiated-contract-small-amount': 'negotiated-small',
  'negotiated-contract-competitive-bidding': 'negotiated-competitive',
  'negotiated-contract-public-offering': 'negotiated-competitive',
  'negotiated-contract-unsuccessful': 'negotiated-sole',
  'negotiated-contract-others': 'negotiated-sole',
  subsidy: 'non-contract',
  'management-expense-grant': 'non-contract',
  'act-bearing-national-treasury-liabilities': 'multi-year',
  others: 'non-contract',
};

export const CONTRACT_CATEGORY_LABELS: Record<ContractCategory, string> = {
  open: '一般競争',
  selective: '指名競争',
  'negotiated-competitive': '随意契約（企画競争・公募）',
  'negotiated-small': '随意契約（少額）',
  'negotiated-sole': '随意契約（競争なし）',
  'multi-year': '国庫債務負担行為（複数年度）',
  'non-contract': '契約以外（補助金等）',
};

export const CONTRACT_CATEGORY_DESCRIPTIONS: Record<ContractCategory, string> = {
  open: '誰でも参加できる入札で相手を決めた契約。',
  selective: '発注者が指名した事業者だけの入札で決めた契約。',
  'negotiated-competitive': '企画競争や公募で候補を募り、その中から選んだ随意契約。',
  'negotiated-small': '少額のため入札を省いた随意契約。',
  'negotiated-sole': '特命・不落随契など、競争を経ずに相手を決めた随意契約。応札者数・理由とあわせて読む。',
  'multi-year': '複数年度にわたる支出を約束する国庫債務負担行為に基づくもの。入札か随意契約かはこの区分からは分からない。',
  'non-contract': '補助金・交付金・給付など、入札や随意契約の対象ではない支出。',
};

export const isContractMethodCode = (value: unknown): value is ContractMethodCode =>
  typeof value === 'string' && value in CATEGORY_OF;

export const contractCategory = (code: ContractMethodCode): ContractCategory => CATEGORY_OF[code];

/** 支出先の1件の契約（API の contracts[] を短縮キーで保持） */
export interface ContractMethodEntry {
  /** ブロック番号（A, B, …） */
  b: string;
  /** 支出先名 */
  n: string;
  /** 法人番号（空欄は ""） */
  cn: string;
  /** 契約金額（円）。非公表は null */
  a: number | null;
  /** 契約方式 */
  m: ContractMethodCode;
  /** 契約方式の補足（自由記述） */
  mt?: string;
  /** 応札・応募者数 */
  ap?: number;
  /** 落札率（%）。0〜100 を超える誤記載は落とす */
  br?: number;
}

export type ContractMethodsByPid = Record<string, ContractMethodEntry[]>;

/** API の契約1件から、方式・補足・応札者数・落札率を取り出す。方式が無い・未知の値なら null */
export function apiContractMethod(c: { contract_method?: string | null; contract_method_description?: string | null;
  number_of_applicants?: number | null; bid_rate?: number | null }): Pick<ContractMethodEntry, 'm' | 'mt' | 'ap' | 'br'> | null {
  if (!isContractMethodCode(c.contract_method)) return null;
  const out: Pick<ContractMethodEntry, 'm' | 'mt' | 'ap' | 'br'> = { m: c.contract_method };
  const text = c.contract_method_description?.trim();
  // 「-」「－」「その他」などの埋め草は補足として意味を持たないので落とす
  if (text && !/^[-－ー‐―—–・\s]*$/.test(text) && text !== 'その他') out.mt = text;
  if (Number.isInteger(c.number_of_applicants) && c.number_of_applicants! >= 0) out.ap = c.number_of_applicants!;
  // 落札率は 0〜100%。それを超える値（999 など）は誤記載とみなして出さない
  if (typeof c.bid_rate === 'number' && c.bid_rate > 0 && c.bid_rate <= 100) out.br = c.bid_rate;
  return out;
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');

/** 支出行（ブロック・名前・金額）に対応する契約を探す。一意に決まらなければ null */
export function findContract(entries: readonly ContractMethodEntry[] | undefined,
  row: { b: string; n: string; a2: number | null }): ContractMethodEntry | null {
  if (!entries?.length) return null;
  const name = norm(row.n);
  const sameRecipient = entries.filter(e => e.b === row.b && norm(e.n) === name);
  if (sameRecipient.length === 0) return null;
  if (sameRecipient.length === 1) return sameRecipient[0];
  const byAmount = sameRecipient.filter(e => e.a !== null && e.a === row.a2);
  if (byAmount.length === 1) return byAmount[0];
  const pool = byAmount.length > 1 ? byAmount : sameRecipient;
  // 方式がすべて同じなら、どの契約でも表示は変わらない
  return pool.every(e => e.m === pool[0].m) ? pool[0] : null;
}

export interface RecipientMethodSummary {
  m: ContractMethodCode;
  /** この方式の契約金額の合計（円）。非公表を除く */
  amount: number;
  /** この方式の契約の件数 */
  count: number;
  /** 応札・応募者数が1者だった件数 */
  singleBidder: number;
}

/** 1事業の中で、支出先名が一致する契約を方式ごとにまとめる（金額の大きい順） */
export function methodsForRecipient(entries: readonly ContractMethodEntry[] | undefined, name: string): RecipientMethodSummary[] {
  const target = norm(name);
  const byMethod = new Map<ContractMethodCode, RecipientMethodSummary>();
  for (const e of entries ?? []) {
    if (norm(e.n) !== target) continue;
    const s = byMethod.get(e.m) ?? { m: e.m, amount: 0, count: 0, singleBidder: 0 };
    s.amount += e.a ?? 0;
    s.count++;
    if (e.ap === 1) s.singleBidder++;
    byMethod.set(e.m, s);
  }
  return [...byMethod.values()].sort((a, b) => b.amount - a.amount);
}
