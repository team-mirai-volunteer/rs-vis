/**
 * 支出先ノードを選んだときに出す「支出先そのものの説明」（Pure 層）。
 * 支出先インデックス（recipient-index）と契約方式（contract-methods）から組み立てる。
 */
import type { RecipientEntry } from '@/types/recipient-index';
import { totalsByCategory, type CategoryTotal, type ContractMethodsByPid } from '@/app/lib/contract-method';
import { normalizeRecipientName } from '@/app/lib/recipient-key';

export interface RecipientProfile {
  name: string;
  /** 個別の相手ではなく、受給者などの集合を1行で記載したものと思われるとき、その説明 */
  genericNote?: string;
  /** 支出先インデックスに見つかったときだけ */
  entry?: {
    corporateNumber: string;
    aliases: string[];
    directAmount: number;
    directCount: number;
    subcontractAmount: number;
    subcontractCount: number;
    projectCount: number;
    byMinistry: { ministry: string; amount: number; projectCount: number }[];
  };
  /** 契約方式の区分ごとの集計（RS公開APIと突き合わせできた契約のみ） */
  methods: CategoryTotal[];
}

/** 名前から、個別の相手ではない集合的な記載（受給者・自治体の一括・その他）かを判定する */
export function genericRecipientNote(name: string): string | undefined {
  const n = name.trim();
  if (/^その他/.test(n)) return '「その他」は、上位以外の支出先をまとめて1行で記載したものです。特定の相手ではありません。';
  if (/受給者|受給世帯|被保険者|対象者|利用者|加入者/.test(n)) return '給付金などを受け取る人の集まりを1行で記載したものです。特定の法人・個人ではありません。';
  if (/(都道府県|市区町村|市町村)(等|及び|・|$)|^都道府県|^市区町村|^市町村/.test(n)) return '複数の自治体への交付をまとめて1行で記載したものです。個々の自治体の内訳は事業のレビューシートにあります。';
  if (/^個人[A-ZＡ-Ｚ]?(ほか)?$/.test(n)) return '個人名を伏せて記載した支出先です。';
  return undefined;
}

export const MINISTRY_LIMIT = 6;

export function buildRecipientProfile(name: string, entry: RecipientEntry | null, methodsByPid: ContractMethodsByPid | null): RecipientProfile {
  const genericNote = genericRecipientNote(name);
  if (!entry) return { name, genericNote, methods: [] };
  // 契約は法人番号で引く。番号が無いときは表記ゆれ（aliases）のどれかと名前が一致するもの
  const aliases = new Set(entry.aliases.map(normalizeRecipientName));
  const pids = new Set(entry.appearances.map(a => String(a.pid)));
  const contracts = [...pids].flatMap(pid => (methodsByPid?.[pid] ?? []).filter(c => entry.corporateNumber
    ? c.cn === entry.corporateNumber || (!c.cn && aliases.has(normalizeRecipientName(c.n)))
    : aliases.has(normalizeRecipientName(c.n))));
  return {
    name, genericNote,
    entry: {
      corporateNumber: entry.corporateNumber,
      aliases: entry.aliases.filter(a => a !== entry.name).slice(0, 5),
      directAmount: entry.totals.directAmount, directCount: entry.totals.directCount,
      subcontractAmount: entry.totals.subcontractAmount, subcontractCount: entry.totals.subcontractCount,
      projectCount: pids.size,
      byMinistry: entry.byMinistry.slice(0, MINISTRY_LIMIT).map(m => ({ ministry: m.ministry, amount: m.directAmount + m.subcontractAmount, projectCount: m.projectCount })),
    },
    methods: totalsByCategory(contracts),
  };
}
