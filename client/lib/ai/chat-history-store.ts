/**
 * AIチャット会話履歴の IndexedDB 永続化（複数セッション対応）。
 *
 * このブラウザにのみ保存され、サーバへは送信されない（保存対象は表示用メッセージ
 * 配列そのもの。BYOK キーは含まれない — キーは api-key-store の別ストア）。
 * - セッション = 1つの会話スレッド。「クリア」= 新しい会話の開始（旧会話は一覧に残る）
 * - BYOK キー削除時は全セッションを削除する（BYOK中の会話が後からサーバモードへ
 *   送られるプライバシー境界の変化を防ぐ。page.tsx 側の合意事項）
 * - v1（単一 'current' レコード）からは初回オープン時に1セッションとして移行する
 */
import type { AiChatUiMessage } from '@/client/components/SankeySvg/AiChatPanel';

const DB_NAME = 'ai-chat-history';
const DB_VERSION = 2;
const SESSIONS_STORE = 'sessions';
/** v1 の旧ストア名（移行後に削除） */
const LEGACY_STORE = 'session';

/** 1セッションに保存する最大メッセージ数（表示用。API 送信上限とは独立に大きめ） */
const MAX_SAVED_MESSAGES = 100;
/** 保持する最大セッション数（古い順に削除） */
const MAX_SESSIONS = 30;
/** 一覧タイトルの最大文字数（先頭ユーザー発話から合成） */
const TITLE_MAX = 30;

export interface ChatSession {
  id: string;
  title: string;
  /** true ならユーザーが手動でタイトルを変更済み（保存時の自動再合成で上書きしない） */
  titleEdited?: boolean;
  messages: AiChatUiMessage[];
  /** 最終更新時刻（epoch ms） */
  ts: number;
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  ts: number;
  messageCount: number;
}

/** 先頭のユーザー発話からセッションタイトルを合成する */
export function buildSessionTitle(messages: AiChatUiMessage[]): string {
  const first = messages.find(m => m.role === 'user')?.content.trim() ?? '';
  if (!first) return '（無題の会話）';
  return first.length <= TITLE_MAX ? first : `${first.slice(0, TITLE_MAX)}…`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction!;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
      }
      // v1 → v2: 単一会話（'current'）を1セッションとして移行し、旧ストアを削除
      if (db.objectStoreNames.contains(LEGACY_STORE)) {
        const legacy = tx.objectStore(LEGACY_STORE);
        const getReq = legacy.get('current');
        getReq.onsuccess = () => {
          const messages = getReq.result;
          if (Array.isArray(messages) && messages.length > 0) {
            tx.objectStore(SESSIONS_STORE).put({
              id: crypto.randomUUID(),
              title: buildSessionTitle(messages as AiChatUiMessage[]),
              messages,
              ts: Date.now(),
            } satisfies ChatSession);
          }
          db.deleteObjectStore(LEGACY_STORE);
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, mode);
    Promise.resolve(fn(tx.objectStore(SESSIONS_STORE))).then(resolve, reject);
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

/** セッション一覧（新しい順・メッセージ本体なし）。非対応環境は空配列 */
export async function listChatSessions(): Promise<ChatSessionMeta[]> {
  try {
    const all = await withStore('readonly', store => requestAsPromise(store.getAll() as IDBRequest<ChatSession[]>));
    return all
      .sort((a, b) => b.ts - a.ts)
      .map(s => ({ id: s.id, title: s.title, ts: s.ts, messageCount: s.messages.length }));
  } catch {
    return [];
  }
}

/** セッションを取得（存在しなければ null） */
export async function loadChatSession(id: string): Promise<ChatSession | null> {
  try {
    const s = await withStore('readonly', store => requestAsPromise(store.get(id) as IDBRequest<ChatSession | undefined>));
    return s ?? null;
  } catch {
    return null;
  }
}

/**
 * セッションを保存する（同 id は上書き・タイトルは毎回再合成）。
 * 上限超過分の古いセッションを削除する。失敗は握りつぶす（チャット利用を妨げない）
 */
export async function saveChatSession(id: string, messages: AiChatUiMessage[]): Promise<void> {
  try {
    await withStore('readwrite', async store => {
      // 手動変更済みタイトルは自動再合成で上書きしない
      const existing = await requestAsPromise(store.get(id) as IDBRequest<ChatSession | undefined>);
      store.put({
        id,
        title: existing?.titleEdited ? existing.title : buildSessionTitle(messages),
        ...(existing?.titleEdited ? { titleEdited: true } : {}),
        messages: messages.slice(-MAX_SAVED_MESSAGES),
        ts: Date.now(),
      } satisfies ChatSession);
      const all = await requestAsPromise(store.getAll() as IDBRequest<ChatSession[]>);
      const sorted = all.filter(s => s.id !== id).sort((a, b) => b.ts - a.ts);
      for (const old of sorted.slice(MAX_SESSIONS - 1)) {
        store.delete(old.id);
      }
    });
  } catch {
    // IndexedDB 非対応・容量超過等は永続化なしで続行
  }
}

export async function deleteChatSession(id: string): Promise<void> {
  await withStore('readwrite', store => { store.delete(id); });
}

/** セッションのタイトルを変更する（以後の保存で自動再合成しない）。空文字は自動合成へ戻す */
export async function renameChatSession(id: string, title: string): Promise<void> {
  await withStore('readwrite', async store => {
    const session = await requestAsPromise(store.get(id) as IDBRequest<ChatSession | undefined>);
    if (!session) return;
    const trimmed = title.trim();
    store.put(trimmed
      ? { ...session, title: trimmed, titleEdited: true }
      : { ...session, title: buildSessionTitle(session.messages), titleEdited: undefined });
  });
}

/** 全セッション削除（BYOKキー削除時のプライバシー境界維持に使う） */
export async function deleteAllChatSessions(): Promise<void> {
  await withStore('readwrite', store => { store.clear(); });
}
