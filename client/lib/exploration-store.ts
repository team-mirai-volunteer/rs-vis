/**
 * 探索履歴・発見メモの IndexedDB ストア（api-key-store.ts と同じ流儀）。
 *
 * すべて**このブラウザにのみ保存**され、サーバへは送信されない（UI 文言と一致させること）。
 * - 自動履歴（pinned=false）: URL 状態の確定変化を記録。上限 AUTO_HISTORY_MAX 件で古い順に削除
 * - メモ（pinned=true）: ユーザーの明示保存。上限なし（実質小さい）
 * 同一 qs は1エントリに揃える（自動履歴・メモそれぞれで dedupe。再訪は ts 更新）。
 */

export const AUTO_HISTORY_MAX = 50;

export interface ExplorationEntry {
  id: string;
  /** URL クエリ文字列（先頭 ? なし）= 完全な再現状態 */
  qs: string;
  /** 自動合成ラベル（app/lib/exploration-label.ts） */
  label: string;
  /** メモのタイトル（手動保存の入力値 / レポート保存時は見出しから自動抽出。pinned=true のみ） */
  title?: string;
  /** メモ本文（チャットのレポート保存等の長文 Markdown。pinned=true のみ） */
  note?: string;
  /** true=メモ（明示保存） / false=自動履歴 */
  pinned: boolean;
  /** 最終訪問・更新時刻（epoch ms） */
  ts: number;
  year: string;
}

const DB_NAME = 'exploration-history';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    Promise.resolve(fn(tx.objectStore(STORE_NAME))).then(resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    tx.onerror = () => reject(tx.error);
  }));
}

function requestAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 全エントリを新しい順で取得（IndexedDB 非対応環境は空配列） */
export async function listEntries(): Promise<ExplorationEntry[]> {
  try {
    const all = await withStore('readonly', store => requestAsPromise(store.getAll() as IDBRequest<ExplorationEntry[]>));
    return all.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/**
 * 自動履歴に訪問を記録する。同一 qs の自動履歴があれば ts/label を更新、
 * なければ追加し、上限超過分の古い自動履歴を削除する。失敗は握りつぶす（利用を妨げない）。
 */
export async function recordVisit(qs: string, label: string, year: string): Promise<void> {
  try {
    await withStore('readwrite', async store => {
      const all = await requestAsPromise(store.getAll() as IDBRequest<ExplorationEntry[]>);
      const existing = all.find(e => !e.pinned && e.qs === qs);
      if (existing) {
        store.put({ ...existing, label, year, ts: Date.now() });
        return;
      }
      store.put({ id: crypto.randomUUID(), qs, label, pinned: false, ts: Date.now(), year } satisfies ExplorationEntry);
      const autos = all.filter(e => !e.pinned).sort((a, b) => b.ts - a.ts);
      for (const old of autos.slice(AUTO_HISTORY_MAX - 1)) {
        store.delete(old.id);
      }
    });
  } catch {
    // IndexedDB 非対応・容量超過等は履歴なしで続行
  }
}

/** メモとして保存する（常に新規エントリ。同じ図の状態に複数のメモ・レポートを残せる） */
export async function saveMemo(qs: string, label: string, year: string, note: string, title?: string): Promise<void> {
  await withStore('readwrite', store => {
    store.put({ id: crypto.randomUUID(), qs, label, title, note, pinned: true, ts: Date.now(), year } satisfies ExplorationEntry);
  });
}

/** エントリのタイトルを変更する（空文字はタイトル削除 = 自動ラベル表示に戻る） */
export async function updateEntryTitle(id: string, title: string): Promise<void> {
  await withStore('readwrite', async store => {
    const entry = await requestAsPromise(store.get(id) as IDBRequest<ExplorationEntry | undefined>);
    if (!entry) return;
    store.put({ ...entry, title: title.trim() || undefined });
  });
}

export async function deleteEntry(id: string): Promise<void> {
  await withStore('readwrite', store => { store.delete(id); });
}

/** 自動履歴のみ全削除（メモは残す） */
export async function clearAutoHistory(): Promise<void> {
  await withStore('readwrite', async store => {
    const all = await requestAsPromise(store.getAll() as IDBRequest<ExplorationEntry[]>);
    for (const e of all) {
      if (!e.pinned) store.delete(e.id);
    }
  });
}
