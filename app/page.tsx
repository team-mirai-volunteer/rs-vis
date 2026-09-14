import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { PAGES } from '@/components/navigation/pages';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * トップページ。各ビューへの入口（gikai-home パターン: Hero + カード一覧）。
 * ツール本体は各ビューに任せ、ここは「何が見られるか」を説明するだけにする。
 */
export default function Home() {
  const primary = PAGES.filter(p => p.primary);
  const secondary = PAGES.filter(p => !p.primary);

  return (
    <div className="flex min-h-screen flex-col bg-background text-mirai-text">
      <AppHeader current="/" />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        <section className="flex flex-col justify-between gap-6 rounded-2xl bg-mirai-gradient p-6 sm:flex-row sm:items-end sm:p-10">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-bold tracking-normal">行政事業レビュー可視化</p>
            <h1 className="text-2xl/8 font-bold tracking-normal sm:text-3xl/10">国の予算は、どこから来て、どこへ行くのか。</h1>
            <p className="mt-3 text-[15px] leading-relaxed font-medium">
              行政事業レビューシステムの 5,000 超の事業と 2 万超の支出先、財務省予算書の会計・項・目、
              そして歳入と国民負担を、ひとつながりのデータとして見られるようにしています。
            </p>
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link href="/budget-sankey">
              統合ビューを見る <ArrowRight />
            </Link>
          </Button>
        </section>

        <section aria-labelledby="views-heading" className="space-y-3">
          <h2 id="views-heading" className="text-lg font-bold tracking-normal">主なビュー</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {primary.map(p => (
              <Card key={p.href} className="flex flex-col transition-shadow hover:shadow-soft">
                <CardContent className="flex flex-1 flex-col gap-2 p-5">
                  <h3 className="text-base font-bold">{p.label}</h3>
                  <p className="flex-1 text-sm leading-relaxed text-mirai-text-subtle">{p.description}</p>
                  <Button asChild variant="link" className="self-start text-sm">
                    <Link href={p.href}>
                      開く <ArrowRight />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="mof-heading" className="space-y-3">
          <div>
            <h2 id="mof-heading" className="text-lg font-bold tracking-normal">財務省予算書のビュー</h2>
            <p className="text-sm text-mirai-text-muted">予算書・決算書データベースの会計・所管・項・目を、そのまま一覧やフローで確かめるための補助ビューです。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {secondary.map(p => (
              <Link
                key={p.href}
                href={p.href}
                className="group flex items-start justify-between gap-3 rounded-xl border border-mirai-border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-mirai-surface-teal/60"
              >
                <span>
                  <span className="block text-sm font-bold">{p.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-mirai-text-subtle">{p.description}</span>
                </span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-mirai-text-muted transition-colors group-hover:text-primary-accent" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="mt-4 bg-mirai-text px-4 py-6 text-xs leading-relaxed text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="font-bold">チームみらい</p>
          <p className="mt-1 text-white/80">
            データは行政事業レビューシステム（RS）と財務省 予算書・決算書データベースの公開データを加工したものです。
            AI による評価はスクリーニングであり、結論ではありません。
          </p>
        </div>
      </footer>
    </div>
  );
}
