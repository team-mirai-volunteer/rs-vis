import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/navigation/AppHeader';

/**
 * 利用規約・プライバシーポリシーの共通レイアウト。
 * 本文は各ページが `<LegalSection>` の並びで渡す。見出しの番号は条文順に振る。
 */
export function LegalDocument({ title, updated, lead, children }: {
  title: string;
  /** 最終更新日（YYYY-MM-DD） */
  updated: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  const updatedLabel = updated.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日');
  return (
    <div className="flex min-h-screen flex-col bg-background text-mirai-text">
      <AppHeader current="/" />
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <article className="mx-auto max-w-3xl">
          <header className="rounded-2xl bg-mirai-gradient p-6 sm:p-8">
            <h1 className="text-2xl font-bold tracking-normal sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm text-mirai-text-subtle">最終更新日：{updatedLabel}</p>
            {lead && <div className="mt-3 text-sm leading-relaxed">{lead}</div>}
          </header>
          <div className="mt-6 space-y-6">{children}</div>
          <nav aria-label="関連ページ" className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-mirai-border pt-4 text-sm">
            <Link href="/terms" className="font-bold text-primary-accent underline underline-offset-4">利用規約</Link>
            <Link href="/privacy" className="font-bold text-primary-accent underline underline-offset-4">プライバシーポリシー</Link>
            <Link href="/" className="text-mirai-text-subtle underline underline-offset-4">トップへ戻る</Link>
          </nav>
        </article>
      </main>
      <footer className="mt-4 bg-mirai-text px-4 py-6 text-xs leading-relaxed text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <p className="font-bold">チームみらい</p>
          <p className="mt-1 text-white/80">お問い合わせ：support@team-mir.ai</p>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="rounded-2xl border border-mirai-border bg-card p-5 sm:p-6">
      <h2 id={`${id}-heading`} className="text-lg font-bold">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-mirai-text [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/** 本文中の外部リンク */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-accent underline underline-offset-4">{children}</a>;
}
