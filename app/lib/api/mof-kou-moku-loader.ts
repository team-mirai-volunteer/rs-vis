/**
 * 科目別内訳データの読み込みと、年度をまたいだ追跡。
 *
 * 年度ごとに1ファイル（`mof-kou-moku-{YEAR}.json`）なので、経年推移を出すには
 * 全年度を横断する必要がある。ここでプロセス内にキャッシュし、API 層は薄く保つ。
 * `/mof-jikou` の app/lib/api/mof-jikou-loader.ts と同じ構成。
 */

import type { MOFKouMokuData, MOFKouMokuHistory, MOFKouMokuHistoryYear, MOFKouMokuItem } from '@/types/mof-kou-moku';
import { dataFileExists, readDataJson } from './data-file';

/** 収録候補の会計年度（新しい順）。実際に返せるのは JSON が生成済みの年度だけ */
const CANDIDATE_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017] as const;

const fileName = (year: number) => `mof-kou-moku-${year}.json`;

const cache = new Map<number, MOFKouMokuData>();
let cachedYears: number[] | null = null;

/** 生成済みの年度（新しい順） */
export function availableYears(): number[] {
  if (!cachedYears) cachedYears = CANDIDATE_YEARS.filter(y => dataFileExists(fileName(y)));
  return cachedYears;
}

/** 1年度分を読む（プロセス内キャッシュ） */
export function loadYear(year: number): MOFKouMokuData {
  const cached = cache.get(year);
  if (cached) return cached;
  const data = readDataJson<MOFKouMokuData>(
    fileName(year),
    `npm run generate-mof-kou-moku を実行してください（対象年度: ${year}）。`
  );
  cache.set(year, data);
  return data;
}

/**
 * 予算種別を除いた「同じ目」の識別子。
 * `item.key` は予算種別を含むため、当初と決算を同じ目として辿れない。
 * ここでは種別だけを落とし、会計区分・組織・特会・勘定・機関・項コード・
 * 目分類コード・目名で識別する（`/mof-jikou` の identityKey と同じ考え方）。
 *
 * 所管（ministry）は含めない。共管の追加・解消で表記が変わることがあり（例:
 * 「内閣府及び厚生労働省」→「厚生労働省」、令和6→7年度）、含めるとその境目で
 * 実態としては継続の目が別物として扱われてしまう。
 */
export function identityKey(item: MOFKouMokuItem): string {
  return [
    item.accountType,
    item.organization,
    item.specialAccount,
    item.subAccount,
    item.agency,
    item.sectionCode,
    item.subItemCode,
    item.subItemName,
  ].join('|');
}

/** `item.key`（予算種別を含む）から識別子に落とす */
function identityFromKey(key: string): string {
  const parts = key.split('|');
  // key の並びは 会計区分 | 予算種別 | 所管 | 組織 | … なので予算種別・所管（1・2番目）を取り除く
  return [parts[0], ...parts.slice(3)].join('|');
}

/**
 * 目の経年推移を組み立てる。
 *
 * 目名の改称や目別分類コードの振り直しがあると別の目として扱われ、実態としては
 * 継続でも欠けて見えることがある（`/mof-jikou` の事項と同じ限界。項コードは
 * 年度をまたぐと動くことが実測されているため、目分類コードも同様の不安定さを持つ）。
 */
export function buildHistory(key: string): MOFKouMokuHistory {
  const identity = identityFromKey(key);
  const years: MOFKouMokuHistoryYear[] = [];
  let name = '';

  // 推移は古い順に並べる
  for (const year of [...availableYears()].sort((a, b) => a - b)) {
    const data = loadYear(year);
    const items = data.items.filter(i => identityKey(i) === identity);
    if (items.length === 0) continue;
    if (!name) name = items[0].subItemName;
    years.push({ fiscalYear: year, eraLabel: data.metadata.eraLabel, items });
  }

  return { key, identity, name, availableYears: availableYears(), years };
}
