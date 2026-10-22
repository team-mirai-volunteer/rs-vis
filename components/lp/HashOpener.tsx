'use client';

/**
 * `#insight-xxx` や `#q-5` 付きで開かれたとき、その段落を隠している <details>（「残りの13件を見る」など）を開いてから
 * 段落までスクロールする。閉じたままだとブラウザのアンカー移動が空振りして、リンク先が見えない。
 * 国会質問は li の中の <details> が本文なので、それも開く。
 */
import { useEffect } from 'react';

function reveal(hash: string) {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  for (let el: HTMLElement | null = target; el; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement) el.open = true;
  }
  const inner = target.querySelector(':scope > details');
  if (inner instanceof HTMLDetailsElement) inner.open = true;
  requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
}

export function HashOpener() {
  useEffect(() => {
    reveal(window.location.hash);
    const onHash = () => reveal(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return null;
}
