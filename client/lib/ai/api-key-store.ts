/**
 * BYOK設定（使用者の API キー・モデル）の IndexedDB ストア。
 *
 * キーは**このブラウザにのみ保存され、自サイトのサーバへは送信しない**（設計:
 * docs/ai-chat-architecture-guide.md）。ブラウザ保存キーは XSS に対して原理的に防御不能のため、
 * UI では「利用上限を設定したキーの使用」を案内すること。
 * キーを console.log・URL・エラーレポートに含めないこと。
 */

const DB_NAME = 'ai-chat-settings';
const DB_VERSION = 1;
const STORE_NAME = 'byok';
const RECORD_KEY = 'openrouter';

export interface ByokSettings {
  apiKey: string;
  model: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const req = fn(tx.objectStore(STORE_NAME));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
  }));
}

/** 保存済み設定を取得する（未保存・読込失敗は null） */
export async function loadByokSettings(): Promise<ByokSettings | null> {
  try {
    const value = await withStore('readonly', store => store.get(RECORD_KEY));
    if (value && typeof value === 'object' && typeof (value as ByokSettings).apiKey === 'string' && typeof (value as ByokSettings).model === 'string') {
      return value as ByokSettings;
    }
    return null;
  } catch {
    // IndexedDB が使えない環境（プライベートブラウジング等）は BYOK 無効として扱う
    return null;
  }
}

export async function saveByokSettings(settings: ByokSettings): Promise<void> {
  await withStore('readwrite', store => store.put(settings, RECORD_KEY));
}

export async function deleteByokSettings(): Promise<void> {
  await withStore('readwrite', store => store.delete(RECORD_KEY));
}
