import { RE2JS } from 're2js';

export const MAX_REGEX_PATTERN_LENGTH = 128;
export class SearchPatternError extends Error {}
const cache = new Map<string, (text: string) => boolean>();

/** No native backtracking and no unbounded cache/compiled repetition expansion. */
export function compileSearchPattern(pattern: string, ignoreCase = true): (text: string) => boolean {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) throw new SearchPatternError(`正規表現は${MAX_REGEX_PATTERN_LENGTH}文字以内で入力してください`);
  const key = `${ignoreCase ? 'i' : ''}:${pattern}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // Conservative bound: even nested counted repetitions cannot expand without limit.
  let expansion = 1;
  for (const match of pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
    expansion *= Math.max(1, Number(match[2] || match[1]));
    if (expansion > 1000) throw new SearchPatternError('正規表現の繰り返し指定が大きすぎます');
  }
  try {
    const expression = RE2JS.compile(pattern, ignoreCase ? RE2JS.CASE_INSENSITIVE : 0);
    const matches = (text: string) => expression.matcher(text).find();
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, matches);
    return matches;
  } catch {
    throw new SearchPatternError('対応していない正規表現です。先読み・後読み・後方参照は使用できません');
  }
}
