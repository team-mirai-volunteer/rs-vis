/**
 * 事業者別の横断ビュー（/vendors）のドメインロジック（Pure 層）。
 * 生成（scripts/generate-vendors.ts）と画面・APIで同じ定義を使う。
 */
import type { Vendor, VendorYear } from '@/types/vendors';

export const VENDOR_MINISTRY_LIMIT = 6;
export const VENDOR_REPEAT_LIMIT = 8;
/** 一覧（/api/vendors の既定）に載せる契約額の下限（円）。それ未満は検索（?q=）か法人番号（?key=）で引く */
export const VENDOR_LIST_MIN_CONTRACT = 1e7;
export const VENDOR_SEARCH_LIMIT = 50;

/** 一覧の1行。全年度の合計（total）だけを数値の配列に詰めて配信量を抑える */
export interface VendorRow {
  key: string;
  name: string;
  corporateNumber: string;
  kind?: string;
  /** 主な支出元の府省（契約金額が最大のもの） */
  ministry?: string;
  /** VENDOR_YEAR_FIELDS の順の数値 */
  t: number[];
  repeatSingleCount: number;
  repeatSoleCount: number;
}

export const VENDOR_YEAR_FIELDS: readonly Exclude<keyof VendorYear, 'sheetYear'>[] = ['amount', 'count', 'contractAmount', 'contractCount', 'nonContractAmount', 'projects', 'ministries',
  'competitiveCount', 'competitiveAmount', 'competitiveWithApplicants', 'singleCount', 'singleAmount', 'singleBidRateSum', 'singleBidRateN',
  'multiBidRateSum', 'multiBidRateN', 'soleCount', 'soleAmount', 'negotiatedCompetitiveCount', 'negotiatedCompetitiveAmount', 'multiYearAmount'] as const;

export function packVendorYear(y: VendorYear): number[] { return VENDOR_YEAR_FIELDS.map(f => y[f]); }
export function unpackVendorYear(t: readonly number[], sheetYear = 0): VendorYear {
  const y = emptyVendorYear(sheetYear);
  VENDOR_YEAR_FIELDS.forEach((f, i) => { y[f] = t[i] ?? 0; });
  return y;
}
export function toVendorRow(v: Vendor): VendorRow {
  return { key: v.key, name: v.name, corporateNumber: v.corporateNumber, ...(v.kind ? { kind: v.kind } : {}),
    ...(v.ministries[0] ? { ministry: v.ministries[0].ministry } : {}), t: packVendorYear(v.total),
    repeatSingleCount: v.repeatSingleCount, repeatSoleCount: v.repeatSoleCount };
}
/** 一覧の行を Vendor と同じ形（years は空）に戻す。画面の並べ替え・論点の判定で共用するため */
export function fromVendorRow(r: VendorRow): Vendor {
  return { key: r.key, name: r.name, corporateNumber: r.corporateNumber, ...(r.kind ? { kind: r.kind } : {}), years: [], total: unpackVendorYear(r.t),
    ministries: r.ministry ? [{ ministry: r.ministry, amount: 0, projects: 0 }] : [], repeatSingle: [], repeatSingleCount: r.repeatSingleCount, repeatSoleCount: r.repeatSoleCount };
}

/** 名前・法人番号での検索（正規化して部分一致） */
export function matchVendor(v: { name: string; corporateNumber: string }, query: string): boolean {
  const q = query.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  if (!q) return true;
  return v.name.normalize('NFKC').replace(/\s+/g, '').toLowerCase().includes(q) || (!!v.corporateNumber && v.corporateNumber.includes(q));
}

export function emptyVendorYear(sheetYear: number): VendorYear {
  return { sheetYear, amount: 0, count: 0, contractAmount: 0, contractCount: 0, nonContractAmount: 0, projects: 0, ministries: 0,
    competitiveCount: 0, competitiveAmount: 0, competitiveWithApplicants: 0, singleCount: 0, singleAmount: 0,
    singleBidRateSum: 0, singleBidRateN: 0, multiBidRateSum: 0, multiBidRateN: 0,
    soleCount: 0, soleAmount: 0, negotiatedCompetitiveCount: 0, negotiatedCompetitiveAmount: 0, multiYearAmount: 0 };
}

/** 競争入札のうち応札が1者だった割合（%）。応札者数の記載が無ければ null */
export function singleBidRatio(y: VendorYear): number | null {
  return y.competitiveWithApplicants > 0 ? (y.singleCount / y.competitiveWithApplicants) * 100 : null;
}

/** 落札率の平均（%）。1者応札・複数応札それぞれ、記載が無ければ null */
export const avgSingleBidRate = (y: VendorYear): number | null => (y.singleBidRateN > 0 ? y.singleBidRateSum / y.singleBidRateN : null);
export const avgMultiBidRate = (y: VendorYear): number | null => (y.multiBidRateN > 0 ? y.multiBidRateSum / y.multiBidRateN : null);

/** 契約額のうち、競争を経ていない契約（1者応札＋競争なしの随意契約）の割合（%）。契約が無ければ null */
export function nonCompetitiveShare(y: VendorYear): number | null {
  return y.contractAmount > 0 ? ((y.singleAmount + y.soleAmount) / y.contractAmount) * 100 : null;
}

/** 絞り込みの論点 */
export type VendorSignal = 'singleMajority' | 'repeatSingle' | 'soleMajor' | 'repeatSole' | 'highBidRate' | 'multiMinistry';
export const VENDOR_SIGNAL_LABELS: Record<VendorSignal, string> = {
  singleMajority: '1者応札が半数以上',
  repeatSingle: '同じ事業で1者応札が続く',
  soleMajor: '競争なしの随意契約が主',
  repeatSole: '同じ事業で随意契約が続く',
  highBidRate: '1者応札の落札率95%以上',
  multiMinistry: '3府省以上から受注',
};
export const VENDOR_SIGNAL_SHORT: Record<VendorSignal, string> = {
  singleMajority: '1者過半', repeatSingle: '1者連続', soleMajor: '随契主', repeatSole: '随契連続', highBidRate: '落札率高', multiMinistry: '複数府省',
};
export const VENDOR_SIGNAL_DESCRIPTIONS: Record<VendorSignal, string> = {
  singleMajority: '全年度合計で、応札者数の記載がある競争入札が5件以上あり、そのうち半数以上が1者応札。',
  repeatSingle: '同じ事業で2つ以上のシート年度に競争入札の1者応札がある。',
  soleMajor: '全年度合計の契約額の半分以上が、競争なしの随意契約（特命・不落随契）。',
  repeatSole: '同じ事業で2つ以上のシート年度に競争なしの随意契約がある。',
  highBidRate: '1者応札の落札率（記載のある契約3件以上の単純平均）が95%以上。',
  multiMinistry: '3つ以上の府省から契約を受けている。',
};
export const VENDOR_SIGNALS = Object.keys(VENDOR_SIGNAL_LABELS) as VendorSignal[];

export function vendorSignals(v: Vendor): VendorSignal[] {
  const t = v.total;
  const out: VendorSignal[] = [];
  if (t.competitiveWithApplicants >= 5 && (singleBidRatio(t) ?? 0) >= 50) out.push('singleMajority');
  if (v.repeatSingleCount > 0) out.push('repeatSingle');
  if (t.contractAmount > 0 && t.soleAmount / t.contractAmount >= 0.5) out.push('soleMajor');
  if (v.repeatSoleCount > 0) out.push('repeatSole');
  if (t.singleBidRateN >= 3 && (avgSingleBidRate(t) ?? 0) >= 95) out.push('highBidRate');
  if (t.ministries >= 3) out.push('multiMinistry');
  return out;
}

export type VendorSortKey = 'contractAmount' | 'amount' | 'singleAmount' | 'singleRatio' | 'soleAmount' | 'nonCompetitive' | 'bidRate' | 'projects' | 'ministries' | 'repeatSingle' | 'name';
export const VENDOR_SORTS: { key: VendorSortKey; label: string; desc: boolean }[] = [
  { key: 'contractAmount', label: '契約額', desc: true },
  { key: 'amount', label: '支出合計（補助金等を含む）', desc: true },
  { key: 'singleAmount', label: '1者応札の金額', desc: true },
  { key: 'singleRatio', label: '1者応札率', desc: true },
  { key: 'soleAmount', label: '競争なしの随意契約', desc: true },
  { key: 'nonCompetitive', label: '競争を経ない割合', desc: true },
  { key: 'bidRate', label: '1者応札の落札率', desc: true },
  { key: 'repeatSingle', label: '1者応札が続く事業数', desc: true },
  { key: 'projects', label: '事業数', desc: true },
  { key: 'ministries', label: '府省数', desc: true },
  { key: 'name', label: '事業者名', desc: false },
];

export function vendorSortValue(v: Vendor, key: VendorSortKey): number | string | null {
  const t = v.total;
  switch (key) {
    case 'contractAmount': return t.contractAmount;
    case 'amount': return t.amount;
    case 'singleAmount': return t.singleAmount;
    case 'singleRatio': return t.competitiveWithApplicants >= 3 ? singleBidRatio(t) : null;
    case 'soleAmount': return t.soleAmount;
    case 'nonCompetitive': return nonCompetitiveShare(t);
    case 'bidRate': return t.singleBidRateN >= 3 ? avgSingleBidRate(t) : null;
    case 'repeatSingle': return v.repeatSingleCount;
    case 'projects': return t.projects;
    case 'ministries': return t.ministries;
    case 'name': return v.name;
  }
}

/** 並べ替え。null（記載なし・件数不足）は末尾 */
export function sortVendors(list: readonly Vendor[], key: VendorSortKey, desc: boolean): Vendor[] {
  return [...list].sort((a, b) => {
    const va = vendorSortValue(a, key), vb = vendorSortValue(b, key);
    if (va === null && vb === null) return b.total.contractAmount - a.total.contractAmount;
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === 'string' ? va.localeCompare(String(vb), 'ja') : va - (vb as number);
    return (desc ? -c : c) || b.total.contractAmount - a.total.contractAmount;
  });
}

/** 国税庁の法人種別コード → 絞り込み用の大まかな区分 */
export type VendorKindGroup = 'company' | 'public' | 'other' | 'unknown';
export const VENDOR_KIND_GROUP_LABELS: Record<VendorKindGroup, string> = { company: '会社', public: '国・自治体', other: '独法・公益法人など', unknown: '不明（番号なしなど）' };
export function vendorKindGroup(kind: string | undefined): VendorKindGroup {
  if (!kind) return 'unknown';
  if (kind === '101' || kind === '201') return 'public';
  if (kind.startsWith('3') && kind !== '399') return 'company';
  if (kind === '401') return 'company';
  return 'other';
}

export const VENDOR_COLUMN_DESCRIPTIONS: Record<string, string> = {
  name: '事業者名（最も多く使われた表記）と法人番号。番号の無い記載は名前でまとめている',
  contractAmount: '入札・随意契約・国庫債務負担行為の合計（全年度）。補助金・交付金は含まない',
  single: '競争入札のうち応札が1者だった契約の金額と、応札者数の記載がある競争入札に対する割合（件数ベース）',
  bidRate: '1者応札の落札率の単純平均（記載のある契約のみ）。括弧内は複数応札の平均',
  sole: '競争なしの随意契約（特命・不落随契）の金額。少額随契・企画競争・公募は含まない',
  nonCompetitive: '契約額のうち、1者応札と競争なしの随意契約が占める割合',
  projects: '支出元の事業数と府省数（全年度）',
  repeat: '同じ事業で2年度以上1者応札が続いている事業の数',
  signals: '確認の手がかり。不適切さの判定ではない',
};
