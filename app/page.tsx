import Link from 'next/link';
import {
  ArrowRight,
  ChartScatter,
  PiggyBank,
  ClipboardCheck,
  FileSearch,
  Landmark,
  Network,
  ReceiptJapaneseYen,
  Scale,
  Waypoints,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { LegalLinks } from '@/components/legal/LegalLinks';
import { PAGES, PRIMARY_PAGES, PRODUCT_NAME, SECONDARY_PAGES } from '@/components/navigation/pages';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** 各ビューの内容を表すアイコン。未登録のページは Waypoints にフォールバックする */
const PAGE_ICONS: Partial<Record<string, LucideIcon>> = {
  '/budget-sankey': Workflow,
  '/project-bubble': ChartScatter,
  '/quality': ClipboardCheck,
  '/budget-requests': FileSearch,
  '/subcontracts': Network,
  '/funds': PiggyBank,
  '/tax-expenditures': ReceiptJapaneseYen,
  '/tax-burden': Scale,
  '/fiscal-space': Landmark,
};

/**
 * トップページ。各ビューへの入口（gikai-home パターン: Hero + カード一覧）。
 * ツール本体は各ビューに任せ、ここは「何が見られるか」を説明するだけにする。
 */
export default function Home() {
  const primary = PRIMARY_PAGES;
  const secondary = SECONDARY_PAGES;
  const mof = PAGES.filter(p => !p.primary && !p.secondary);

  return (
    <div className="flex min-h-screen flex-col bg-background text-mirai-text">
      <AppHeader current="/" />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        <section className="flex flex-col justify-between gap-6 rounded-2xl bg-mirai-gradient p-6 sm:flex-row sm:items-end sm:p-10">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-bold tracking-normal">{PRODUCT_NAME}</p>
            <h1 className="text-2xl/8 font-bold tracking-normal sm:text-3xl/10">国の予算は、どこから来て、どこへ行くのか。</h1>
            <p className="mt-3 text-[15px] leading-relaxed font-medium">
              行政事業レビューシステムの 5,000 超の事業と 2 万超の支出先、財務省予算書の会計・項・目、
              そして歳入と国民負担を、ひとつながりのデータとして見られるようにしています。
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:w-56">
            <Button asChild size="lg">
              <Link href="/budget-sankey">
                サンキー図を見る <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/quality">事業の評価を見る</Link>
            </Button>
          </div>
        </section>

        <section aria-labelledby="views-heading" className="space-y-3">
          <h2 id="views-heading" className="text-lg font-bold tracking-normal">主なビュー</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {primary.map((p, index) => {
              const Icon = PAGE_ICONS[p.href] ?? Waypoints;
              const featured = index === 0;
              return (
                <Link
                  key={p.href}
                  href={p.href}
                  className={cn(
                    'group flex flex-col gap-3 rounded-2xl border border-mirai-border bg-card p-5 shadow-xs transition-colors hover:border-primary',
                    featured && 'sm:col-span-2'
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mirai-surface-teal text-primary-accent">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 text-base font-bold">{p.navLabel}</span>
                    {p.prototype && <Badge variant="muted">試作</Badge>}
                  </span>
                  <span className="flex-1 text-sm leading-relaxed text-mirai-text-subtle">{p.description}</span>
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-primary-accent">
                    開く <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="secondary-heading" className="space-y-3">
          <div>
            <h2 id="secondary-heading" className="text-lg font-bold tracking-normal">補助ビュー</h2>
            <p className="text-sm text-mirai-text-muted">基金・概算要求・租税特別措置・国民負担・財政余力。事業の外側（資金の置き場・来年度の要求・税の優遇・負担・余力）から予算を見る試作です。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {secondary.map(p => (
              <Link
                key={p.href}
                href={p.href}
                className="group flex items-start justify-between gap-3 rounded-xl border border-mirai-border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-mirai-surface-teal/60"
              >
                <span>
                  <span className="flex items-center gap-2 text-sm font-bold">{p.navLabel}{p.prototype && <Badge variant="light" className="rounded-full text-[10px]">試作</Badge>}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-mirai-text-subtle">{p.description}</span>
                </span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-mirai-text-muted transition-colors group-hover:text-primary-accent" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="mof-heading" className="space-y-3">
          <div>
            <h2 id="mof-heading" className="text-lg font-bold tracking-normal">財務省予算書のビュー</h2>
            <p className="text-sm text-mirai-text-muted">予算書・決算書データベースの会計・所管・項・目を、そのまま一覧やフローで確かめるための補助ビューです。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mof.map(p => (
              <Link
                key={p.href}
                href={p.href}
                className="group flex items-start justify-between gap-3 rounded-xl border border-mirai-border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-mirai-surface-teal/60"
              >
                <span>
                  <span className="block text-sm font-bold">{p.navLabel}</span>
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
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}
