import Link from 'next/link';

/** フッター用の利用規約・プライバシーポリシーへのリンク（暗い背景の上で使う） */
export function LegalLinks() {
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-white/80">
      <Link href="/terms" className="underline underline-offset-4 hover:text-white">利用規約</Link>
      <Link href="/privacy" className="underline underline-offset-4 hover:text-white">プライバシーポリシー</Link>
      <a href="https://github.com/team-mirai-volunteer/rs-vis" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-white">ソースコード（AGPL-3.0）</a>
    </p>
  );
}
