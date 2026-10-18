import { Loader2 } from 'lucide-react';

/**
 * 読み込み中の共通表示（回転アイコン＋短い文言）。ページ間で待機表現を揃えるため、
 * 初期読み込みはこれを使う。`fullscreen` は画面全体を覆う（サンキー図など全画面ページ用）。
 */
export default function LoadingSpinner({ text = '読み込み中…', fullscreen = false, className }: { text?: string; fullscreen?: boolean; /** 高さなどの上書き（既定は h-64） */ className?: string }) {
  return (
    <div
      className={`${fullscreen ? 'fixed inset-0 bg-background' : className ?? 'h-64'} flex items-center justify-center gap-2 text-sm text-mirai-text-muted`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
