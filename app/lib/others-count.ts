/**
 * 支出先ブロックの「その他」行（上位以外をまとめた行）に何件がまとめられているか（Pure 層）。
 *
 * RS システムは件数そのものを持たない。ただしブロックごとに府省庁が入力する「支出先の数」
 * （公開API の payment_count、5-1 CSV の「支出先の数」列）があり、記載要領は
 * 「支出先の数が10を超える場合、10を超える分を『その他』にまとめて入力する」としている。
 * そこで「支出先の数 − 個別に記載された行数」を、その他にまとめられた件数とみなす。
 * 入力値どうしが合わない（差が1以下）・その他行が複数ある等、一意に決まらなければ出さない。
 */

/** その他行にまとめられた件数（n）と、算出のもとにしたブロックの支出先の数（t）・その他行の金額（a） */
export interface OthersCount {
  /** その他行にまとめられた件数 */
  n: number;
  /** ブロックの「支出先の数」（府省庁の記載） */
  t: number;
  /** その他行の金額（円）。突き合わせ用。未確認は null */
  a: number | null;
}

/** pid → ブロック番号 → 件数 */
export type OthersCountsByPid = Record<string, Record<string, OthersCount>>;

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');

/** 上位以外をまとめた「その他」行の名前か（「その他の支出先」表記も含む。「その他労働局」など個別の名前は含めない） */
export function isOthersRowName(name: string): boolean {
  return /^(その他|その他の支出先|その他支出先|其他)$/.test(norm(name));
}

/** 公開API の支払先グループ1つから件数を出す。一意に決まらなければ null */
export function othersCountFromGroup(group: {
  payment_count?: number | null;
  payments: ReadonlyArray<{ name: string; total_contract_amount: number | null }>;
}): OthersCount | null {
  const others = group.payments.filter(p => isOthersRowName(p.name));
  if (others.length !== 1 || !Number.isInteger(group.payment_count)) return null;
  const t = group.payment_count!;
  const n = t - (group.payments.length - 1);
  // 差が1以下は「その他行も1件と数えた」入力と区別できないので出さない
  if (n < 2) return null;
  const a = others[0].total_contract_amount;
  return { n, t, a: typeof a === 'number' && Number.isFinite(a) ? a : null };
}

/**
 * 公式CSV由来の行（金額）と、公開API の件数を突き合わせる。取得時点が違うと内訳が変わりうるので、
 * その他行の金額が一致したときだけ件数を使う
 */
export function matchOthersCount(entry: OthersCount | undefined, amount: number | null | undefined): OthersCount | null {
  if (!entry || entry.a === null || amount === null || amount === undefined) return null;
  return entry.a === amount ? entry : null;
}

export const OTHERS_COUNT_UNKNOWN_NOTE =
  '件数は元データ（RSシステム）に記載がないため表示できません。行政側が上位以外をまとめて記載した行です';

/** 表示名。件数が分かれば「その他（1,234件）」 */
export function othersLabel(name: string, count: Pick<OthersCount, 'n'> | null | undefined): string {
  return count ? `${name}（${count.n.toLocaleString('ja-JP')}件）` : name;
}

/** ツールチップ。件数が分からなければ、記載が無い旨を出す */
export function othersTitle(count: Pick<OthersCount, 'n' | 't'> | null | undefined): string {
  if (!count) return OTHERS_COUNT_UNKNOWN_NOTE;
  return `行政側が上位以外をまとめて記載した行です。RSシステムに府省庁が記載したブロックの「支出先の数」${count.t.toLocaleString('ja-JP')}件から、個別に記載された${(count.t - count.n).toLocaleString('ja-JP')}件を引いた件数です。内訳は公表されていません。`;
}

/** 複数ブロックのその他行をまとめた行（事業の支出先一覧など）。全ブロックの件数が分かるときだけ合計する */
export function sumOthersCounts(counts: ReadonlyArray<{ blockId: string; count: OthersCount | null | undefined }>):
  { total: number | null; title: string } {
  if (counts.length === 0) return { total: null, title: OTHERS_COUNT_UNKNOWN_NOTE };
  const known = counts.every(c => c.count);
  const lines = counts.map(c => `ブロック${c.blockId}: ${c.count ? `${c.count.n.toLocaleString('ja-JP')}件` : '件数不明'}`);
  const total = known ? counts.reduce((s, c) => s + c.count!.n, 0) : null;
  const head = known
    ? '行政側が上位以外をまとめて記載した行です。件数は各ブロックの「支出先の数」（府省庁の記載）から個別記載分を引いたものの合計（ブロック間の重複を含みうる）。'
    : OTHERS_COUNT_UNKNOWN_NOTE.replace('件数は', '一部のブロックの件数は') + '。';
  return { total, title: `${head}\n${lines.join('\n')}` };
}

/** ブロックの支出先一覧（公式CSV由来）に、その他行の金額合計が一致する件数を引き当てる */
export function blockOthersCount(recipients: ReadonlyArray<{ name: string; amount: number }>, entry: OthersCount | undefined): OthersCount | null {
  const others = recipients.filter(r => isOthersRowName(r.name));
  if (others.length === 0) return null;
  return matchOthersCount(entry, others.reduce((s, r) => s + r.amount, 0));
}
