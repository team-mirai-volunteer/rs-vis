import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  ChartScatter,
  ChevronDown,
  ClipboardCheck,
  Gavel,
  Landmark,
  MessageSquareText,
  Network,
  PiggyBank,
  ReceiptJapaneseYen,
  Scale,
  Search,
  ShieldAlert,
  Baby,
  FlaskConical,
  Target,
  Timer,
  Zap,
  TrendingUp,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { AppHeader } from '@/components/navigation/AppHeader';
import { PRIMARY_PAGES, PRODUCT_NAME } from '@/components/navigation/pages';
import { SITE_URL } from '@/app/lib/site-url';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DIET_PRINCIPLES, DIET_QUESTIONS, HERO_STATS, INSIGHTS, PERSONAS, type Insight } from './insights';

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
  outcomes: Target,
  childcare: Baby,
  research: FlaskConical,
  energy: Zap,
};

/** 主要ビューのアイコン（トップページと同じ対応） */
const PAGE_ICONS: Partial<Record<string, LucideIcon>> = {
  '/budget-sankey': Workflow,
  '/project-bubble': ChartScatter,
  '/quality': ClipboardCheck,
  '/subcontracts': Network,
  '/funds': PiggyBank,
  '/tax-expenditures': ReceiptJapaneseYen,
  '/tax-burden': Scale,
  '/fiscal-space': Landmark,
};

/** Hero に載せるサンキー図の実画面（所管 → 事業 → 支出先、2024年度決算）。public/lp/sankey-preview.jpg */
const PREVIEW_HREF = '/budget-sankey?year=2024&b=settlement&cols=mi%2Cpr%2Cre&ld=all&fnrs=0';

/**
 * LP（ランディングページ）。価値の説明と実画面 → 代表的な発見3件（残りは展開）→ 使い方 → 国会質問の例 → 想定読者・ビュー → 出典、の順。
 * ツール本体は各ビューに任せる。数字と文言は insights.ts に集約。
 */
export default function LandingPage() {
  const featured = INSIGHTS.filter(i => i.featured);
  const rest = INSIGHTS.filter(i => !i.featured);
  const scripted = DIET_QUESTIONS.filter(q => q.script).length;

  return (
    <div className="flex min-h-screen flex-col bg-background text-mirai-text">
      <AppHeader current="/" />

      <main className="flex-1">
        {/* Hero */}
        <section className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-mirai-gradient">
            <div className="p-6 sm:p-10 lg:p-14 lg:pb-8">
              <p className="mb-3 text-xs font-bold tracking-normal">チームみらい {PRODUCT_NAME}</p>
              <h1 className="max-w-3xl text-3xl/10 font-bold tracking-normal sm:text-4xl/[3rem]">{TITLE}</h1>
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed font-medium">
                省庁から事業へ、事業から支出先へ。国の予算がどこへ流れたかを、1本の図で追えます。
                5,794事業・9.9万の支出先・328基金・外部の検査結果まで、公開データをひとつながりにしました。
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mirai-text-subtle">
                議員・政策秘書の質問づくり、記者・研究者の調査、気になる事業や企業を調べたい市民のために。
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Button asChild size="lg">
                  <Link href={PREVIEW_HREF}>
                    予算の流れを見てみる <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/quality">
                    <Search /> 気になる事業・企業を調べる
                  </Link>
                </Button>
              </div>
            </div>

            {/* 実画面 */}
            <div className="px-4 pb-4 sm:px-8 sm:pb-8 lg:px-14 lg:pb-10">
              <Link href={PREVIEW_HREF} className="group block overflow-hidden rounded-2xl border border-black/10 bg-card shadow-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-mirai-border px-4 py-2 text-xs font-bold">
                  <span className="text-mirai-text-muted">サンキー図（2024年度決算）</span>
                  <span className="flex items-center gap-1">
                    省庁 <ArrowRight className="size-3" aria-hidden="true" /> 事業 <ArrowRight className="size-3" aria-hidden="true" /> 支出先
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-primary-accent">
                    クリックして開く <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </span>
                </div>
                <div className="relative aspect-[1200/470] w-full">
                  <Image
                    src="/lp/sankey-preview.jpg"
                    alt="サンキー図の画面。左に省庁、中央に事業、右に支出先が並び、金額の太さで流れが結ばれている"
                    fill
                    sizes="(min-width: 1152px) 1040px, 100vw"
                    className="object-cover object-left-top"
                    priority
                  />
                  <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-card/90 px-2.5 py-0.5 text-xs font-bold shadow-xs sm:left-4 sm:top-3">① 省庁</span>
                  <span className="pointer-events-none absolute left-[41%] top-2 rounded-full bg-card/90 px-2.5 py-0.5 text-xs font-bold shadow-xs sm:top-3">② 事業</span>
                  <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-card/90 px-2.5 py-0.5 text-xs font-bold shadow-xs sm:right-4 sm:top-3">③ 支出先</span>
                </div>
              </Link>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          </div>
        </section>

        {/* Insights */}
        <section id="insights" aria-labelledby="insights-heading" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl space-y-6">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-primary-accent">Insights</p>
              <h2 id="insights-heading" className="mt-1 text-2xl/8 font-bold tracking-normal">公開データをつなぐと、見えてきたこと</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-mirai-text-subtle">
                各府省が自ら公表した数字の集計です。数字は問題の結論ではなく、具体的な問いを立てる材料です。各項目を「分かった事実 → まだ分からないこと → 確認する事項」の順に書いています。まず代表的な{featured.length}件、続けて残りの{rest.length}件。
              </p>
            </div>

            <ol className="grid gap-4 lg:grid-cols-3">
              {featured.map((insight, index) => (
                <li key={insight.id}>
                  <InsightCard insight={insight} index={index + 1} />
                </li>
              ))}
            </ol>

            <details className="group">
              <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-black bg-card px-5 py-2.5 text-sm font-bold shadow-xs hover:bg-mirai-surface [&::-webkit-details-marker]:hidden">
                残りの{rest.length}件を見る
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ol className="mt-4 grid gap-4 lg:grid-cols-2" start={featured.length + 1}>
                {rest.map((insight, index) => (
                  <li key={insight.id}>
                    <InsightCard insight={insight} index={featured.length + index + 1} />
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </section>

        {/* How to use */}
        <section id="howto" aria-labelledby="howto-heading" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl rounded-3xl border border-mirai-border bg-card p-6 sm:p-10">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-primary-accent">How to</p>
              <h2 id="howto-heading" className="mt-1 text-2xl/8 font-bold tracking-normal">3ステップで、根拠つきの問いにする</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-mirai-text-subtle">
                数字はすべて公開データから再現できます。質問や記事の根拠として示すときは、画面の共有URLをそのまま添えてください。
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
          </div>
        </section>

        {/* Diet questions */}
        <section id="questions" aria-labelledby="questions-heading" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-primary-accent">For the Diet</p>
              <h2 id="questions-heading" className="mt-1 text-2xl/8 font-bold tracking-normal">国会質問の設計（台本つき{scripted}本＋{DIET_QUESTIONS.length - scripted}本）</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-mirai-text-subtle">
                「誰に・何を目的に・どの手段で」で中身が変わるので、各問に目的と答弁者のタグを付け、参考人への確認・大臣への問い・取る約束・切り返し・翌年の検証に分けています。
              </p>
            </div>

            <ol className="mt-5 grid gap-3 md:grid-cols-3">
              {DIET_PRINCIPLES.map((pr, index) => (
                <li key={pr.title} className="rounded-2xl bg-mirai-surface-teal p-4">
                  <p className="text-xs font-bold text-primary-accent">原則 {index + 1}</p>
                  <h3 className="mt-0.5 text-sm font-bold">{pr.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-mirai-text-subtle">{pr.body}</p>
                </li>
              ))}
            </ol>

            <ol className="mt-6 space-y-3">
              {DIET_QUESTIONS.map((q, index) => (
                <li key={q.theme}>
                  <details className="group rounded-2xl border border-mirai-border bg-card shadow-xs transition-colors hover:border-primary open:border-primary">
                    <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <span className="mt-0.5 text-xs font-bold text-mirai-text-muted">Q{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="light" className="rounded-full">{q.theme}</Badge>
                          {q.script && <Badge variant="default" className="rounded-full">台本つき</Badge>}
                          {q.purpose.map(tag => <Badge key={tag} variant="light" className="rounded-full">{tag}</Badge>)}
                          {q.answerer.map(tag => <Badge key={tag} variant="outline" className="rounded-full bg-mirai-surface">{tag}</Badge>)}
                        </span>
                        <span className="mt-1.5 block text-sm leading-relaxed font-medium">{q.summary}</span>
                        <span className="mt-1 block text-xs text-mirai-text-muted">{q.committee}</span>
                      </span>
                      <ChevronDown className="mt-1 size-5 shrink-0 text-mirai-text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="space-y-4 border-t border-mirai-border px-4 pb-4 pt-3 text-sm leading-relaxed sm:pl-12">
                      <QuestionBlock label="このサイトで分かっていること（通告・事前レクで固める数字）" items={q.known} tone="fact" />
                      <QuestionBlock label="参考人への事実確認" items={q.official} tone="check" />
                      <div>
                        <p className="text-xs font-bold text-primary-accent">大臣への問い</p>
                        <p className="mt-1 rounded-xl border-l-4 border-primary bg-mirai-surface-teal/60 px-3 py-2 font-medium">{q.minister}</p>
                      </div>
                      {q.promise && (
                        <div>
                          <p className="text-xs font-bold text-primary-accent">大臣に取る約束</p>
                          <p className="mt-1 rounded-xl border-l-4 border-primary-accent bg-mirai-surface-teal/60 px-3 py-2 font-medium">{q.promise}</p>
                        </div>
                      )}
                      {q.written && (
                        <p>
                          <span className="font-bold text-primary-accent">質問主意書で求める数表：</span>
                          {q.written}
                        </p>
                      )}
                      {q.committeeAction && (
                        <p>
                          <span className="font-bold text-primary-accent">委員会として：</span>
                          {q.committeeAction}
                        </p>
                      )}
                      <div>
                        <p className="text-xs font-bold text-primary-accent">逃げ答弁への切り返し</p>
                        <dl className="mt-1 space-y-1.5">
                          {q.rebuttals.map(r => (
                            <div key={r.reply} className="grid gap-0.5 rounded-xl bg-mirai-surface px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
                              <dt className="text-mirai-text-subtle">「{r.reply}」</dt>
                              <dd className="font-medium">→ {r.counter}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                      <p>
                        <span className="font-bold text-primary-accent">翌年の検証：</span>
                        {q.verify}
                      </p>
                      <p className="text-mirai-text-subtle">
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
              <h2 id="views-heading" className="mt-1 text-2xl/8 font-bold tracking-normal">ひとつのデータを、{PRIMARY_PAGES.length}つの見方で</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PRIMARY_PAGES.map(page => {
                const Icon = PAGE_ICONS[page.href] ?? Workflow;
                return (
                  <Link
                    key={page.href}
                    href={page.href}
                    className="group flex flex-col gap-2 rounded-2xl border border-mirai-border bg-card p-5 transition-colors hover:border-primary"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-5 shrink-0 text-primary-accent" aria-hidden="true" />
                      <span className="text-base font-bold">{page.navLabel}</span>
                      {page.prototype && <Badge variant="muted">試作</Badge>}
                    </span>
                    <span className="flex-1 text-sm leading-relaxed text-mirai-text-subtle">{page.description}</span>
                    <span className="inline-flex items-center gap-1 text-sm font-bold text-primary-accent">
                      開く <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </Link>
                );
              })}
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
                <SourceLink href="https://rssystem.go.jp/">行政事業レビューシステム</SourceLink>（レビューシート・基金シート・セグメントシート・公開API）、
                <SourceLink href="https://www.bb.mof.go.jp/">財務省 予算書・決算書データベース</SourceLink>、
                <SourceLink href="https://report.jbaudit.go.jp/">会計検査院 決算検査報告</SourceLink>、
                <SourceLink href="https://www.mof.go.jp/policy/budget/topics/budget_execution_audit/">財務省 予算執行調査</SourceLink>、
                <SourceLink href="https://www.mof.go.jp/tax_policy/reference/stm_report/">租税特別措置の適用実態調査</SourceLink>、
                <SourceLink href="https://www.e-stat.go.jp/">家計調査（e-Stat）</SourceLink>。
                各画面に取得日と原本のハッシュを記録しています。集計条件は各示唆の「分かった事実」に母数とともに書いています。
              </li>
              <li className="rounded-xl bg-mirai-surface p-4">
                <span className="font-bold text-mirai-text">金額は府省の記載どおり。</span>
                このサイトでは検証していません。「2024年度実績」は2025年版レビューシートの前年度執行額です。基金は2026年版基金シートに載る328基金の年度初め残高で、過去のシートにしかない基金を含めた全体は354基金です。
              </li>
              <li className="rounded-xl bg-mirai-surface p-4">
                <span className="font-bold text-mirai-text">AI評価はスクリーニング。</span>
                公開資料に基づく独自基準で、説明の充実度を見ています。事業の良し悪しの結論ではなく、人が確かめに行く順番を決めるためのものです。
              </li>
              <li className="rounded-xl bg-mirai-surface p-4">
                <span className="font-bold text-mirai-text">対象は国の予算の約27%。</span>
                分母は2023年度の財務省予算書の歳出総額555.5兆円（一般会計と特別会計の合計。会計間の繰入れを重複して含む）、分子は同年度の行政事業レビュー対象事業の歳出予算現額151.1兆円です。冒頭の147.6兆円は2024年度の対象事業の予算現額です。国債費・地方交付税・年金給付・財政投融資はレビューの対象外で、サンキー図では「RS対象外」として別に示しています。
              </li>
            </ul>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button asChild size="lg">
                <Link href={PREVIEW_HREF}>
                  予算の流れを見てみる <ArrowRight />
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
  { icon: MessageSquareText, title: '問う', body: '参考人には数字を、大臣には判断を聞く。一覧は質問主意書に回し、約束は金額・件数・期限で取って翌年この画面で確かめる。' },
] as const;

function InsightCard({ insight, index }: { insight: Insight; index: number }) {
  const Icon = INSIGHT_ICONS[insight.id] ?? Workflow;
  return (
    <article className="flex h-full flex-col gap-4 rounded-2xl border border-mirai-border bg-card p-5 sm:p-6">
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
      <FactList label="分かった事実" items={insight.facts.slice(0, 2)} />
      <details className="group/more text-sm leading-relaxed">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-bold text-primary-accent [&::-webkit-details-marker]:hidden">
          続きと、まだ分からないこと
          <ChevronDown className="size-4 transition-transform group-open/more:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-3 space-y-3">
          {insight.facts.length > 2 && <FactList items={insight.facts.slice(2)} />}
          <FactList label="まだ分からないこと" items={insight.unknown} tone="unknown" />
          <FactList label="確認する事項" items={insight.check} tone="check" />
          <p className="rounded-xl bg-mirai-surface px-3 py-2 text-xs leading-relaxed text-mirai-text-note">
            <span className="font-bold">読み方の注意：</span>
            {insight.caveat}
          </p>
        </div>
      </details>
      <div className="mt-auto flex flex-col gap-2 border-t border-mirai-border pt-4">
        <p className="text-xs text-mirai-text-muted">{insight.source}</p>
        <Link href={insight.href} className="inline-flex items-center gap-1 text-sm font-bold text-primary-accent hover:underline">
          {insight.linkLabel} <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function FactList({ label, items, tone = 'fact' }: { label?: string; items: string[]; tone?: 'fact' | 'unknown' | 'check' }) {
  const dot = tone === 'fact' ? 'bg-primary' : tone === 'unknown' ? 'bg-mirai-border-light' : 'bg-primary-accent';
  return (
    <div className="text-sm leading-relaxed text-mirai-text-subtle">
      {label && <p className="text-xs font-bold text-primary-accent">{label}</p>}
      <ul className="mt-1 space-y-1.5">
        {items.map(item => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className={`mt-2.5 size-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-bold text-primary-accent underline underline-offset-2 hover:opacity-90">
      {children}
    </a>
  );
}

function QuestionBlock({ label, items, tone }: { label: string; items: string[]; tone: 'fact' | 'unknown' | 'check' }) {
  return <FactList label={label} items={items} tone={tone} />;
}
