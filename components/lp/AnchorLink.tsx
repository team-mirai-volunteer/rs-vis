'use client';

/**
 * LP の段落（示唆カード・国会質問）ごとの固定 URL。
 * 押すと `#id` 付きの URL をクリップボードに入れ、アドレスバーにも反映する（共有して開くとその段落へ飛ぶ）。
 * `<summary>` の中に置く場合もあるので、クリックが開閉に伝わらないよう止める。
 */
import { useEffect, useState } from 'react';
import { Check, Link2 } from 'lucide-react';

export function AnchorLink({ id, label, className = '' }: { id: string; label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    history.replaceState(null, '', `#${id}`);
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <a href={`#${id}`} onClick={copy} title={`${label}のリンクをコピー`} aria-label={`${label}のリンクをコピー`}
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-bold text-mirai-text-muted transition-colors hover:bg-mirai-surface hover:text-primary-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40 ${className}`}>
      {state === 'copied' ? <Check className="size-3.5 text-primary-accent" aria-hidden="true" /> : <Link2 className="size-3.5" aria-hidden="true" />}
      <span role="status">{state === 'copied' ? 'コピーしました' : state === 'failed' ? 'アドレスバーからコピー' : 'リンク'}</span>
    </a>
  );
}
