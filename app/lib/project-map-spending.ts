/**
 * 事業マップの支出つながり（Pure）。
 *
 * sankey-svg グラフの「事業(支出) → 支出先」辺を、事業マップに載っている事業だけに絞り、
 * 支出先ごとに束ねる。2事業以上から支出を受ける支出先が事業同士を結ぶ（二部グラフ）。
 * 1事業だけの支出先も、大口はそれ自体が見どころなので残す（件数の絞り込みは画面側で行う）。
 *
 * 匿名・集約表記の支出先（「その他」「個人A」「A社」「支出先なし」など）は実名と分けて返す。
 * 名前が同じでも別事業では別の実体を指すため、実名と混ぜると無関係な事業同士を
 * 巨大なハブで結んでしまう（「その他」だけで1,000事業超に繋がる）。
 * 一方で「支出先を具体的に書いていない事業」を洗い出す材料にはなるので、捨てずに別枠で持つ。
 */
import type { GraphData } from '@/types/sankey-svg';
import type {
  PlaceholderKind, ProjectMapSpendingRecipient, ProjectMapSpendingResponse,
} from '@/types/project-map';

export const PLACEHOLDER_KIND_LABELS: Record<PlaceholderKind, string> = {
  aggregate: 'その他（集約）',
  person: '個人（伏せ字）',
  masked: '法人等（伏せ字）',
  undisclosed: '支出先なし・非公表',
};

/** 匿名・集約表記の種類。実名（事業をまたいで同一実体とみなせる名前）なら null */
export function placeholderKindOf(name: string): PlaceholderKind | null {
  const n = name.trim();
  if (n === '' || n === '支出先なし' || n === '非公表' || n === '匿名') return 'undisclosed';
  if (n.includes('その他')) return 'aggregate';        // その他 / 〜を受給している事業主その他
  if (n.startsWith('個人')) return 'person';           // 個人A / 個人(B) / 個人事業主A / 個人Aほか
  if (/^[A-ZＡ-Ｚa-z]{1,2}$/.test(n)) return 'masked';  // A
  // A社 / 某A社 / 〜を受給している事業主A社
  if (/(^|某|事業主)[A-ZＡ-Ｚa-z]{1,2}社$/.test(n)) return 'masked';
  // 株式会社A / 民間事業者B / 法人A / 企業Kほか / 発信実施団体A：和文の直後に英字1文字で終わる伏せ字
  if (/[^\x00-\x7F][A-ZＡ-Ｚ](ほか|等)?$/.test(n)) return 'masked';
  return null;
}

/** 匿名・集約表記の支出先名。事業をまたいで同一実体とみなせないもの */
export function isPlaceholderRecipient(name: string): boolean {
  return placeholderKindOf(name) !== null;
}

export function buildProjectMapSpending(
  graph: Pick<GraphData, 'nodes' | 'edges'>,
  mapPids: ReadonlySet<string>,
  year: number,
): ProjectMapSpendingResponse {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));

  // 支出先 id → (pid → 金額)。同じ事業・支出先の辺が複数あっても合算する
  const byRecipient = new Map<string, Map<string, number>>();
  const projectSpending: Record<string, number> = {};
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
    projectSpending[pid] = (projectSpending[pid] ?? 0) + e.value;
  }

  const recipients: ProjectMapSpendingRecipient[] = [];
  const placeholders: ProjectMapSpendingRecipient[] = [];
  let links = 0;
  for (const [id, m] of byRecipient) {
    const name = nodeById.get(id)!.name;
    const pairs = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const r: ProjectMapSpendingRecipient = {
      id,
      name,
      amount: pairs.reduce((s, [, v]) => s + v, 0),
      pids: pairs.map(([pid]) => pid),
      amounts: pairs.map(([, v]) => v),
    };
    const kind = placeholderKindOf(name);
    if (kind) {
      placeholders.push({ ...r, kind });
      continue;
    }
    recipients.push(r);
    links += pairs.length;
  }
  const byAmount = (a: ProjectMapSpendingRecipient, b: ProjectMapSpendingRecipient) =>
    b.amount - a.amount || a.id.localeCompare(b.id);
  recipients.sort(byAmount);
  placeholders.sort(byAmount);

  return {
    year,
    recipients,
    placeholders,
    projectSpending,
    summary: { recipients: recipients.length, links, excludedPlaceholders: placeholders.length },
  };
}
