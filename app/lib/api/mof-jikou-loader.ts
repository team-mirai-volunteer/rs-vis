/**
 * 事項別内訳データの読み込みと、年度をまたいだ追跡。
 *
 * 年度ごとに1ファイル（`mof-jikou-{YEAR}.json`）なので、経年推移を出すには
 * 全年度を横断する必要がある。ここでプロセス内にキャッシュし、API 層は薄く保つ。
 */

import type {
  MOFJikouData,
  MOFJikouHistory,
  MOFJikouHistoryYear,
  MOFJikouItem,
} from '@/types/mof-jikou';
import { dataFileExists, readDataJson } from './data-file';

/**
 * 収録候補の会計年度（新しい順）。
 * 実際に返せるのは JSON が生成済みの年度だけ。
 */
const CANDIDATE_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017] as const;

const fileName = (year: number) => `mof-jikou-${year}.json`;

const cache = new Map<number, MOFJikouData>();
let cachedYears: number[] | null = null;

/** 生成済みの年度（新しい順） */
export function availableYears(): number[] {
  if (!cachedYears) cachedYears = CANDIDATE_YEARS.filter(y => dataFileExists(fileName(y)));
  return cachedYears;
}

/** 1年度分を読む（プロセス内キャッシュ） */
export function loadYear(year: number): MOFJikouData {
  const cached = cache.get(year);
  if (cached) return cached;
  const data = readDataJson<MOFJikouData>(
    fileName(year),
    `npm run generate-mof-jikou を実行してください（対象年度: ${year}）。`
  );
  cache.set(year, data);
  return data;
}

/**
 * 予算種別を除いた「同じ事項」の識別子。
 *
 * `item.key` は予算種別を含むため、当初と決算を同じ事項として辿れない。
 * ここでは種別だけを落とし、会計区分・組織・特会・勘定・機関・項コード・事項名で識別する。
 * 平成29〜令和8年度（10年度）のいずれの年度でも「識別子 × 予算種別」に重複は無い。
 *
 * 所管（ministry）は含めない。共管の追加・解消で表記が変わることがあり（例:
 * 「内閣府及び厚生労働省」→「厚生労働省」、令和6→7年度）、含めるとその境目で
 * 実態としては継続の事項が別物として扱われてしまう。組織・特会・勘定・項コード・
 * 事項名がすべて一致すれば所管表記の違いだけで区別する必要は薄いと判断している。
 *
 * MOF は事項にも項にも公式な ID を振っていない。主要経費別分類コード等は静的な分類で
 * （1コードが最大696事項を束ねる）識別には使えない。詳細は docs/mof-budget-data-guide.md 3-1-1節。
 */
export function identityKey(item: MOFJikouItem): string {
  return [
    item.accountType,
    item.organization,
    item.specialAccount,
    item.subAccount,
    item.agency,
    item.sectionCode,
    item.name,
  ].join('|');
}

/** `item.key`（予算種別を含む）から識別子に落とす。 */
export function identityFromKey(key: string): string {
  const parts = key.split('|');
  // key の並びは 会計区分 | 予算種別 | 所管 | 組織 | … なので予算種別・所管（1・2番目）を取り除く
  return [parts[0], ...parts.slice(3)].join('|');
}

/**
 * 事項の経年推移を組み立てる。
 *
 * 実態としては継続でも「新規」に見えるケースがある。原因は2系統あり、いずれも識別子由来:
 *
 * - 事項名の改称。識別子に名前を含むため別の事項になる（10年度で156件）
 * - 項コードの移動。項コードは組織内の連番で、項が増減すると以降が総ずれする
 *   （項名が同じままコードが変わったものが10年度で96件・6.4%）
 *
 * 項コードを外せば追跡は伸びるが、事項名は項をまたいで重複するため金額が合算されてしまう。
 * 詳細と実測値は docs/mof-budget-data-guide.md 3-1-2節。
 */
export function buildHistory(key: string): MOFJikouHistory {
  const identity = identityFromKey(key);
  const years: MOFJikouHistoryYear[] = [];
  let name = '';

  // 推移は古い順に並べる
  for (const year of [...availableYears()].sort((a, b) => a - b)) {
    const data = loadYear(year);
    const items = data.items.filter(i => identityKey(i) === identity);
    if (items.length === 0) continue;
    if (!name) name = items[0].name;
    years.push({ fiscalYear: year, eraLabel: data.metadata.eraLabel, items });
  }

  return { key, identity, name, availableYears: availableYears(), years };
}
