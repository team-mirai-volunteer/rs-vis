/**
 * recipient-index-{YEAR}.json の読み込み・メモリキャッシュ。
 * /api/recipients/[key] と /api/search/recipients が共用する。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { RecipientIndex, RecipientEntry } from '@/types/recipient-index';
import { normalizeRecipientName } from '@/app/lib/recipient-key';

const cache = new Map<string, RecipientIndex>();
// 正規化名 → キー（法人番号エントリを優先できるよう、出現数最大のエントリに解決）
const nameKeyCache = new Map<string, Map<string, string>>();

export function loadRecipientIndex(year: string): RecipientIndex {
  if (cache.has(year)) return cache.get(year)!;

  const jsonPath = path.join(process.cwd(), 'public', 'data', `recipient-index-${year}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `recipient-index-${year}.json が見つかりません。` +
      `npm run generate-recipient-index${year === '2024' ? '' : `-${year}`} を実行してください。`
    );
  }

  const data: RecipientIndex = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  cache.set(year, data);
  return data;
}

/**
 * キーで支出先を引く。"name:正規化名" キーは、全エントリの表記ゆれ（aliases）から
 * 同名で最も出現数の多いエントリへ解決する。同じ名前で法人番号あり/なしの
 * エントリが併存する場合に、法人番号側（=本体）へ誘導するため
 * （サンキー図など法人番号を持たない画面からのリンクを成立させる）。
 */
/** 自前プロパティのみ取得（"__proto__"・"constructor" 等のプロトタイプ参照を弾く） */
function getOwnEntry(recipients: Record<string, RecipientEntry>, key: string): RecipientEntry | null {
  return Object.prototype.hasOwnProperty.call(recipients, key) ? recipients[key] : null;
}

export function resolveRecipient(year: string, key: string): RecipientEntry | null {
  const index = loadRecipientIndex(year);
  if (!key.startsWith('name:')) return getOwnEntry(index.recipients, key);

  let nameMap = nameKeyCache.get(year);
  if (!nameMap) {
    nameMap = new Map();
    const best = new Map<string, number>(); // 正規化名 → 採用エントリの出現数
    for (const entry of Object.values(index.recipients)) {
      for (const alias of entry.aliases) {
        const n = normalizeRecipientName(alias);
        if ((best.get(n) ?? -1) < entry.appearances.length) {
          best.set(n, entry.appearances.length);
          nameMap.set(n, entry.key);
        }
      }
    }
    nameKeyCache.set(year, nameMap);
  }

  const resolvedKey = nameMap.get(key.slice('name:'.length));
  const resolved = resolvedKey ? getOwnEntry(index.recipients, resolvedKey) : null;
  return resolved ?? getOwnEntry(index.recipients, key);
}
