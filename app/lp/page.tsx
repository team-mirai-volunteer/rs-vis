import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ClipboardCheck,
  Gavel,
  Landmark,
  MessageSquareText,
  Network,
  PiggyBank,
  Search,
  ShieldAlert,
  Timer,
  TrendingUp,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { PRODUCT_NAME } from '@/components/navigation/pages';
import { SITE_URL } from '@/app/lib/site-url';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DIET_QUESTIONS, HERO_STATS, INSIGHTS, PERSONAS, type Insight } from './insights';

const TITLE = '国の予算は、ここまで見える。';
const DESCRIPTION =
  '1者応札が競争入札の48%、基金残高16.7兆円、予算の半分も使われない事業が340件。行政事業レビューと財務省予算書の公開データから分かったことと、国会質問への使い方。';

export const metadata: Metadata = {
  title: `${TITLE}｜${PRODUCT_NAME}`,
  description: DESCRIPTION,
  alternates: { canonical: new URL('/lp', SITE_URL).href },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: new URL('/lp', SITE_URL).href,
    siteName: PRODUCT_NAME,
    locale: 'ja_JP',
    type: 'website',
    images: [{ url: new URL('/og/home.png', SITE_URL).href, width: 1200, height: 630, alt: `${TITLE} — チームみらい ${PRODUCT_NAME}` }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [new URL('/og/home.png', SITE_URL).href] },
};

/** 示唆カードの先頭アイコン。未登録は Workflow にフォールバック */
const INSIGHT_ICONS: Partial<Record<Insight['id'], LucideIcon>> = {
  'single-bid': Gavel,
  funds: PiggyBank,
  'low-execution': Timer,
  opaque: ShieldAlert,
  subcontract: Network,
  audit: ClipboardCheck,
  'defense-growth': TrendingUp,
  'long-running': Landmark,
};

/**
 * LP（ランディングページ）。サイトの各ビューから得られた示唆を数字で示し、
 * 国会質問・取材・市民の調査への使い方に誘導する。ツール本体は各ビューに任せる。
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-mirai-text">
      <AppHeader current="/" />

      <main className="flex-1">
        {/* Hero */}
        <section className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl rounded-3xl bg-mirai-gradient p-6 sm:p-10 lg:p-14">
            <p className="mb-3 text-xs font-bold tracking-normal">チームみらい {PRODUCT_NAME}</p>
            <h1 className="max-w-3xl text-3xl/10 font-bold tracking-normal sm:text-4xl/[3rem]">{TITLE}</h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed font-medium">
              5,794事業・9.9万の支出先・354基金・外部の検査結果を、ひとつながりのデータにしました。
              「誰に、いくら、どんな契約で」が1本の線で追えます。見つかった論点は、そのまま国会質問の材料になります。
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/budget-sankey">
                  サンキー図を見る <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="#questions">国会質問の例を読む</Link>
              </Button>
            </div>

            <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {HERO_STATS.map(stat => (
                <div key={stat.label} className="rounded-2xl border border-black/10 bg-card/70 px-4 py-3">
                  <dd className="font-lexend text-2xl font-medium tracking-normal text-mirai-text">
                    {stat.value}
                    <span className="ml-1 font-sans text-sm font-bold">{stat.unit}</span>
                  </dd>
                  <dt className="mt-1 text-xs leading-relaxed text-mirai-text-subtle">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Insights */}
        <section id="insights" aria-labelledby="insights-heading" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl space-y-6">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-primary-accent">Insights</p>
              <h2 id="insights-heading" className="mt-1 text-2xl/8 font-bold tracking-normal">公開データをつなぐと、見えてきた8つのこと</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-mirai-text-subtle">
                どれも各府省が自ら公表した数字の集計です。読み方の注意を添えているので、断定ではなく「確かめに行く入口」として使ってください。
              </p>
            </div>

            <ol className="grid gap-4 lg:grid-cols-2">
              {INSIGHTS.map((insight, index) => (
                <li key={insight.id}>
                  <InsightCard insight={insight} index={index + 1} />
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* How to use in the Diet */}
        <section aria-labelledby="diet-heading" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl rounded-3xl border border-mirai-border bg-card p-6 sm:p-10">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-primary-accent">For the Diet</p>
              <h2 id="diet-heading" className="mt-1 text-2xl/8 font-bold tracking-normal">国会質問に、3ステップで使う</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-mirai-text-subtle">
                数字はすべて公開データから再現できます。質問の根拠として示すときは、画面の共有URLをそのまま添えてください。
              </p>
            </div>

            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3 rounded-2xl bg-mirai-surface-teal p-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-primary-accent">
                    <step.icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-primary-accent">STEP {index + 1}</p>
                    <h3 className="mt-0.5 text-base font-bold">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-mirai-text-subtle">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div id="questions" className="mt-8">
              <h3 className="text-lg font-bold tracking-normal">質問の例（10件）</h3>
              <p className="mt-1 text-sm leading-relaxed text-mirai-text-subtle">
                本問は「このサイトで分かっていること」を述べたうえで、公開データでは分からないことを問う形にしています。自明に見える問いでも、政府に数字で答えさせる価値があるものは残しています。テーマを開くと、再質問・問う価値・読み方の注意が出ます。
              </p>
              <ol className="mt-3 space-y-3">
                {DIET_QUESTIONS.map((q, index) => (
                  <li key={q.theme}>
                    <details className="group rounded-2xl border border-mirai-border bg-background open:bg-card">
                      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
                        <span className="mt-0.5 text-xs font-bold text-mirai-text-muted">Q{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <Badge variant="light" className="rounded-full">{q.theme}</Badge>
                            <span className="text-xs text-mirai-text-muted">{q.target}</span>
                          </span>
                          <span className="mt-2 block text-xs font-bold text-primary-accent">このサイトで分かっていること</span>
                          <ul className="mt-1 space-y-1 text-sm leading-relaxed text-mirai-text-subtle">
                            {q.known.map(k => (
                              <li key={k} className="flex gap-2">
                                <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
                                <span>{k}</span>
                              </li>
                            ))}
                          </ul>
                          <span className="mt-2 block text-xs font-bold text-primary-accent">分からないので問う</span>
                          <span className="mt-1 block text-sm leading-relaxed font-medium">{q.question}</span>
                        </span>
                        <ChevronDown className="mt-1 size-5 shrink-0 text-mirai-text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="space-y-3 border-t border-mirai-border px-4 pb-4 pt-3 text-sm leading-relaxed sm:pl-12">
                        <p>
                          <span className="font-bold text-primary-accent">再質問：</span>
                          {q.followUp}
                        </p>
                        <p>
                          <span className="font-bold text-primary-accent">問う価値：</span>
                          {q.why}
                        </p>
                        <p className="rounded-xl bg-mirai-surface px-3 py-2 text-xs leading-relaxed text-mirai-text-note">
                          <span className="font-bold">読み方の注意：</span>
                          {q.caveat}
                        </p>
                        <Link href={q.href} className="inline-flex items-center gap-1 font-bold text-primary-accent hover:underline">
                          {q.linkLabel} <ArrowUpRight className="size-4" aria-hidden="true" />
                        </Link>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Personas */}
        <section aria-labelledby="persona-heading" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl space-y-4">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-primary-accent">Who</p>
              <h2 id="persona-heading" className="mt-1 text-2xl/8 font-bold tracking-normal">こんな人に</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {PERSONAS.map(persona => (
                <div key={persona.title} className="rounded-2xl border border-mirai-border bg-card p-5">
                  <span className="flex size-10 items-center justify-center rounded-full bg-mirai-surface-teal text-primary-accent">
                    <Users className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-3 text-base font-bold">{persona.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-mirai-text-subtle">{persona.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Views */}
        <section aria-labelledby="views-heading" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl space-y-4">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-primary-accent">Views</p>
              <h2 id="views-heading" className="mt-1 text-2xl/8 font-bold tracking-normal">ひとつのデータを、8つの見方で</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {VIEWS.map(view => (
                <Link
                  key={view.href}
                  href={view.href}
                  className="group flex flex-col gap-2 rounded-2xl border border-mirai-border bg-card p-5 transition-colors hover:border-primary"
                >
                  <span className="flex items-center gap-2">
                    <view.icon className="size-5 text-primary-accent" aria-hidden="true" />
                    <span className="text-base font-bold">{view.label}</span>
                  </span>
                  <span className="flex-1 text-sm leading-relaxed text-mirai-text-subtle">{view.description}</span>
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-primary-accent">
                    開く <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Data notes */}
        <section aria-labelledby="data-heading" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl rounded-3xl border border-mirai-border bg-card p-6 sm:p-10">
            <h2 id="data-heading" className="text-2xl/8 font-bold tracking-normal">データについて</h2>
            <ul className="mt-4 grid gap-3 text-sm leading-relaxed text-mirai-text-subtle md:grid-cols-2">
              <li className="rounded-xl bg-mirai-surface p-4">
                <span className="font-bold text-mirai-text">出典。</span>
                行政事業レビューシステム（レビューシート・基金シート・セグメントシート・公開API）、財務省 予算書・決算書データベース、会計検査院 決算検査報告、財務省 予算執行調査、租税特別措置の適用実態調査、家計調査。各画面に取得日と原本のハッシュを記録しています。
              </li>
              <li className="rounded-xl bg-mirai-surface p-4">
                <span className="font-bold text-mirai-text">金額は府省の記載どおり。</span>
                このサイトでは検証していません。「2024年度実績」は2025年版レビューシートの前年度執行額です。基金の残高は2026年版基金シートの年度初め残高です。
              </li>
              <li className="rounded-xl bg-mirai-surface p-4">
                <span className="font-bold text-mirai-text">AI評価はスクリーニング。</span>
                公開資料に基づく独自基準で、説明の充実度を見ています。事業の良し悪しの結論ではなく、人が確かめに行く順番を決めるためのものです。
              </li>
              <li className="rounded-xl bg-mirai-surface p-4">
                <span className="font-bold text-mirai-text">対象は国の予算の約27%。</span>
                国債費・地方交付税・年金給付・財政投融資は行政事業レビューの対象外で、サンキー図では「RS対象外」として別に示しています。
              </li>
            </ul>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/budget-sankey">
                  サンキー図を見る <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/">すべてのビューへ</Link>
              </Button>
            </div>
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

const STEPS = [
  { icon: Search, title: '探す', body: '評価一覧・基金一覧・委託構造で、1者応札率・残高÷支出・「その他」比率などの論点で絞り込み、並べ替える。' },
  { icon: ClipboardCheck, title: '根拠を固める', body: '事業の詳細で支出先・契約方式・落札率・5年の予算執行推移・検査院と予算執行調査の指摘を確かめ、共有URLを控える。' },
  { icon: MessageSquareText, title: '質問する', body: '「数字（出典）→ 制度上の理由があるか → 改善の目標と期限」の順で問う。サポーターからの意見も同じ事業IDに集まる。' },
] as const;

const VIEWS = [
  { href: '/budget-sankey', icon: Workflow, label: 'サンキー図', description: '会計 → 所管 → 項 → 目 → 事業 → 支出先を1本の流れで。' },
  { href: '/quality', icon: ClipboardCheck, label: '評価一覧', description: 'AI評価・執行率・契約方式・外部の検査結果を事業ごとに。' },
  { href: '/subcontracts', icon: Network, label: '委託構造', description: '再委託・再補助の段階と、合流する別財源。' },
  { href: '/funds', icon: PiggyBank, label: '基金', description: '残高・支出・国庫返納・終了予定で論点ごとに絞り込む。' },
] as const;

function InsightCard({ insight, index }: { insight: Insight; index: number }) {
  const Icon = INSIGHT_ICONS[insight.id] ?? Workflow;
  return (
    <article className={cn('flex h-full flex-col gap-4 rounded-2xl border border-mirai-border bg-card p-5 sm:p-6')}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mirai-surface-teal text-primary-accent">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span className="text-xs font-bold text-mirai-text-muted">{String(index).padStart(2, '0')}</span>
      </div>
      <div>
        <p className="font-lexend text-3xl font-medium tracking-normal text-primary-accent">{insight.figure}</p>
        <p className="mt-1 text-xs font-medium text-mirai-text-subtle">{insight.figureNote}</p>
      </div>
      <h3 className="text-lg/7 font-bold tracking-normal">{insight.title}</h3>
      <p className="text-[15px] leading-relaxed">{insight.body}</p>
      <ul className="space-y-1.5 text-sm leading-relaxed text-mirai-text-subtle">
        {insight.points.map(point => (
          <li key={point} className="flex gap-2">
            <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <p className="rounded-xl bg-mirai-surface px-3 py-2 text-xs leading-relaxed text-mirai-text-note">
        <span className="font-bold">読み方の注意：</span>
        {insight.caveat}
      </p>
      <div className="mt-auto flex flex-col gap-2 border-t border-mirai-border pt-4">
        <p className="text-xs text-mirai-text-muted">{insight.source}</p>
        <Link href={insight.href} className="inline-flex items-center gap-1 text-sm font-bold text-primary-accent hover:underline">
          {insight.linkLabel} <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
