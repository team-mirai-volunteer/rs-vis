/**
 * 財務省予算書の「所管」名の扱い。
 *
 * 予算書には「内閣府及び厚生労働省」「内閣府、総務省及び財務省」のような共管の所管があり、
 * そのままだと絞り込みの選択肢に長い複合名が並び、「環境省」を選んでも共管分が落ちる。
 * ここで複合名を構成する省庁に分解し、選択肢は単独の省庁だけにして、判定は「いずれかが選ばれていれば含む」にする。純関数。
 */

/** 「内閣府、総務省及び財務省」→ ['内閣府', '総務省', '財務省']。単独名はそのまま 1 要素 */
export function splitMinistryName(name: string): string[] {
  return name
    .split(/、|及び/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** 共管名か */
export const isCompoundMinistry = (name: string): boolean => splitMinistryName(name).length > 1;

/** 所管名が選択に含まれるか。単独名の一致か、共管の構成省庁のいずれかが選ばれていれば true */
export function ministryMatches(selected: ReadonlySet<string>, name: string): boolean {
  if (selected.has(name)) return true;
  return splitMinistryName(name).some(part => selected.has(part));
}

/** 絞り込みの選択肢: 共管を分解して単独の省庁だけを重複なく並べる（日本語順） */
export function atomicMinistryOptions(names: readonly string[]): string[] {
  const set = new Set<string>();
  for (const name of names) for (const part of splitMinistryName(name)) set.add(part);
  return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
}
