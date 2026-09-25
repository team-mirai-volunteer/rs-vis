/**
 * 事業マップの支出つながり（Pure）。
 *
 * sankey-svg グラフの「事業(支出) → 支出先」辺を、事業マップに載っている事業だけに絞り、
 * 支出先ごとに束ねる。2事業以上から支出を受ける支出先が事業同士を結ぶ（二部グラフ）。
 * 1事業だけの支出先も、大口はそれ自体が見どころなので残す（件数の絞り込みは画面側で行う）。
 *
 * 匿名・集約表記の支出先（「その他」「個人A」「A社」「支出先なし」など）は除外する。
 * 名前が同じでも別事業では別の実体を指すため、残すと無関係な事業同士を
 * 巨大なハブで結んでしまう（「その他」だけで1,000事業超に繋がる）。
 */
import type { GraphData } from '@/types/sankey-svg';
import type { ProjectMapSpendingRecipient, ProjectMapSpendingResponse } from '@/types/project-map';

/** 匿名・集約表記の支出先名。事業をまたいで同一実体とみなせないもの */
export function isPlaceholderRecipient(name: string): boolean {
  const n = name.trim();
  if (n === '' || n === '支出先なし' || n === '非公表' || n === '匿名') return true;
  if (n.includes('その他')) return true;               // その他 / 〜を受給している事業主その他
  if (n.startsWith('個人')) return true;              // 個人A / 個人(B) / 個人事業主A / 個人Aほか
  if (/^[A-ZＡ-Ｚa-z]{1,2}$/.test(n)) return true;     // A
  // A社 / 某A社 / 〜を受給している事業主A社
  if (/(^|某|事業主)[A-ZＡ-Ｚa-z]{1,2}社$/.test(n)) return true;
  // 株式会社A / 民間事業者B / 法人A / 企業Kほか / 発信実施団体A：和文の直後に英字1文字で終わる伏せ字
  if (/[^\x00-\x7F][A-ZＡ-Ｚ](ほか|等)?$/.test(n)) return true;
  return false;
}

export function buildProjectMapSpending(
  graph: Pick<GraphData, 'nodes' | 'edges'>,
  mapPids: ReadonlySet<string>,
  year: number,
): ProjectMapSpendingResponse {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));

  // 支出先 id → (pid → 金額)。同じ事業・支出先の辺が複数あっても合算する
  const byRecipient = new Map<string, Map<string, number>>();
  for (const e of graph.edges) {
    if (!(e.value > 0)) continue;
    const src = nodeById.get(e.source);
    if (!src || src.type !== 'project-spending' || src.projectId === undefined) continue;
    const dst = nodeById.get(e.target);
    if (!dst || dst.type !== 'recipient') continue;
    const pid = String(src.projectId);
    if (!mapPids.has(pid)) continue;
    let m = byRecipient.get(dst.id);
    if (!m) { m = new Map(); byRecipient.set(dst.id, m); }
    m.set(pid, (m.get(pid) ?? 0) + e.value);
  }

  const recipients: ProjectMapSpendingRecipient[] = [];
  let excludedPlaceholders = 0;
  let links = 0;
  for (const [id, m] of byRecipient) {
    const name = nodeById.get(id)!.name;
    if (isPlaceholderRecipient(name)) { excludedPlaceholders++; continue; }
    const pairs = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    recipients.push({
      id,
      name,
      amount: pairs.reduce((s, [, v]) => s + v, 0),
      pids: pairs.map(([pid]) => pid),
      amounts: pairs.map(([, v]) => v),
    });
    links += pairs.length;
  }
  recipients.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  return {
    year,
    recipients,
    summary: { recipients: recipients.length, links, excludedPlaceholders },
  };
}
