/**
 * 委託構造の一覧（/subcontracts）の最後の URL（検索・フィルタ・並び順を含む）を覚えておき、
 * 詳細の「← 一覧」で同じ状態に戻れるようにする。保存できない環境では素の一覧に戻る。
 */
const KEY = 'subcontracts:listUrl';

export function rememberSubcontractsListUrl(url: string): void {
  try { window.sessionStorage.setItem(KEY, url); } catch { /* 保存できなくても一覧は使える */ }
}

export function lastSubcontractsListUrl(): string | null {
  try {
    const url = window.sessionStorage.getItem(KEY);
    return url && url.startsWith('/subcontracts') ? url : null;
  } catch { return null; }
}
