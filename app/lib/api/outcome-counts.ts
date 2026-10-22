/**
 * 事業ごとの成果指標（アウトカム指標）の件数。rs{YEAR}-project-indicators.json から数える。
 * - outcome: 種別が「アウトカム」の指標の数
 * - outcomeActual: そのうち実績値（年度ごとの数値、または定性的な実績の文章）が 1 つでもある数
 * 指標のある事業しか載っていないので、Map に無い事業は 0 件として扱う。
 */
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { loadProjectIndicators } from '@/app/lib/api/project-indicators-loader';
import type { ProjectIndicator } from '@/types/project-indicators';

export interface OutcomeCounts {
  outcome: number;
  outcomeActual: number;
}

export function countOutcomes(indicators: readonly ProjectIndicator[]): OutcomeCounts {
  let outcome = 0;
  let outcomeActual = 0;
  for (const i of indicators) {
    if (i.kind !== 'アウトカム') continue;
    outcome++;
    if (Object.keys(i.actual).length > 0 || i.qualitativeResult.trim() !== '') outcomeActual++;
  }
  return { outcome, outcomeActual };
}

const cache = new Map<SupportedYear, Map<string, OutcomeCounts>>();

/** 年度ぶんの件数。データ未生成の年度は空の Map（全事業が「指標なし」になる） */
export function loadOutcomeCounts(year: SupportedYear): Map<string, OutcomeCounts> {
  const hit = cache.get(year);
  if (hit) return hit;
  const map = new Map<string, OutcomeCounts>();
  const data = loadProjectIndicators(year);
  if (data) for (const [pid, entry] of Object.entries(data)) map.set(pid, countOutcomes(entry.indicators));
  cache.set(year, map);
  return map;
}
