# 11. Page-level 完全テンプレート集

このファイルは「新規 page を書き始めるときに、その場でコピペして使える *完全な page 単位の実装*」を 4 種類載せている。

過去バージョンでは「コンポーネント単位の例」(`examples/button.tsx` 等) しかなく、page 全体の構造を AI が想像で組み立てる必要があった。結果、AI Slop(hero に紫グラデ・全画面 `bg-white`・shadcn デフォルト Button 等)が混入した。

このファイルでは *page 全体のスケルトン*を提供する。新規ページは:

```
1. 似たパターンを下から選ぶ
2. そのまま全コピー
3. プロジェクト固有の要素(プロダクト名・コピー・データソース)だけ差し替える
4. SKILL.md §0 の Visual Signature 7 項目をセルフチェック
```

の順で書くと、AI Slop が混入しない。

> [!IMPORTANT]
> *ロゴは自作・トレースしない*。以下のテンプレ内に出てくる `/img/logo.png` などのロゴ画像は、チームみらい公式ロゴを指す。
> [`../assets/logos/`](../assets/logos/) に同梱しているので、LP を作るときはここから 1 つ選んでプロジェクトの `public/` にコピーして使う(hero の主役は `team-mirai-logo.png`、ヘッダー/フッターは `team-mirai-wordmark.svg` か `team-mirai-logo-flat.png`)。選び方は [`../assets/logos/README.md`](../assets/logos/README.md)。

---

## §1 パターン 1: ランディング (gikai 風)

mirai-gikai/web の `(main)/page.tsx` に近い。Hero → セクション群 → About → Footer の構成。

ユースケース: プロダクトの公式 LP、政策の説明 page、サービスの紹介 page。

### 1.1 完全スケルトン

```tsx
// app/page.tsx
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative w-full h-[80vh] min-h-[400px] md:h-[70vh] bg-mirai-gradient overflow-hidden">
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <Image
            src="/img/logo.png"
            alt="チームみらい"
            width={143}
            height={120}
            priority
            className="h-[120px] w-auto mb-8"
          />
          <h1 className="text-4xl md:text-4xl font-bold text-mirai-text mb-4">
            プロダクト名
          </h1>
          <p className="text-sm font-bold text-mirai-text mb-8 px-3">
            テクノロジーで政治をかえる。<br />
            あなたと一緒に未来をつくる。
          </p>
          <Button asChild variant="outline" size="lg" className="rounded-full">
            <a href="/sign-up">登録する</a>
          </Button>
        </div>
      </section>

      {/* メインコンテンツ */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <main className="flex flex-col gap-16">
          {/* 特徴セクション */}
          <section className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[22px] font-bold text-mirai-text leading-[1.48]">
                特徴
              </h2>
              <p className="text-xs font-medium text-mirai-text-muted leading-[1.67]">
                このプロダクトでできること
              </p>
            </div>
            <div className="flex flex-col gap-4">
              {[
                { title: "見出し1", desc: "本文の説明文を入れる場所。" },
                { title: "見出し2", desc: "本文の説明文を入れる場所。" },
                { title: "見出し3", desc: "本文の説明文を入れる場所。" },
              ].map((item) => (
                <Card key={item.title} className="border border-mirai-border hover:bg-muted/50 transition-colors">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold">
                      {item.title}
                    </CardTitle>
                    <p className="text-[15px] leading-[28px] text-mirai-text">
                      {item.desc}
                    </p>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </section>

          {/* About セクション */}
          <section className="py-10">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4">
                <h2 className="text-2xl font-bold leading-[43.2px]">
                  プロダクト
                  <br />
                  について
                </h2>
                <p className="text-sm font-bold text-primary-accent">
                  About
                </p>
              </div>
              <div className="flex flex-col gap-6">
                <p className="text-[15px] leading-[28px] text-mirai-text">
                  ここにプロダクトの説明文を入れる。だいたい 3-4 行で書く。
                </p>
                <Button asChild variant="outline" className="w-fit rounded-full px-6 py-3 h-auto">
                  <a href="https://team-mir.ai/" target="_blank" rel="noopener noreferrer">
                    詳しく見る
                  </a>
                </Button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
```

### 1.2 ポイント

- Hero は `bg-mirai-gradient` 単色グラデのみ。背景画像を使う場合は半透明オーバーレイ
- セクションヘッダーは `h2 (22px bold)` + `p (12px muted)` の 2 行構成
- カード並びは縦 (`flex flex-col gap-4`)、横並びにする場合は `grid grid-cols-1 md:grid-cols-2 gap-4`
- About セクションは「英語見出し画像 or 大きなテキスト」+ 「キャプション」のリズム

### 1.3 出典

[mirai-gikai/web/src/app/(main)/page.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/app/(main)/page.tsx) と [`web/src/components/top/`](https://github.com/team-mirai/mirai-gikai/tree/develop/web/src/components/top) を写経した形。

---

## §2 パターン 2: ダッシュボード (marumie 風)

marumie/webapp の `(main)/[slug]/[year]` 風。固定ヘッダー(白 rounded box)+ 薄ティールグラデ背景 + 白カードの列。

ユースケース: 集計・統計の表示、データダッシュボード、レポート page。

### 2.1 完全スケルトン

```tsx
// app/dashboard/page.tsx
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  return (
    <div className="pt-24"> {/* 固定ヘッダーの高さ分を確保 */}
      {/* タイトル */}
      <section className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-mirai-text mb-2">
          ダッシュボード
        </h1>
        <p className="text-sm text-mirai-text-muted font-medium">
          2026年4月時点のデータ
        </p>
      </section>

      {/* メトリクスカード */}
      <section className="max-w-6xl mx-auto px-4 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "総収入", value: "¥12,345,678" },
            { label: "総支出", value: "¥8,765,432" },
            { label: "残高", value: "¥3,580,246" },
          ].map((m) => (
            <div
              key={m.label}
              className="bg-white rounded-[24px] px-[18px] py-8 sm:p-12 space-y-2"
            >
              <p className="text-sm text-mirai-text-muted font-medium">
                {m.label}
              </p>
              <p className="text-3xl font-bold text-mirai-text">{m.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* メインカード(marumie の MainColumnCard 相当) */}
      <section className="max-w-6xl mx-auto px-4 mb-8">
        <div
          id="cash-flow"
          className="bg-white rounded-[24px] px-[18px] py-8 sm:p-12 space-y-8 scroll-mt-24"
        >
          <div>
            <h2 className="text-base sm:text-lg font-bold text-mirai-text mb-3">
              収支の流れ
            </h2>
            <p className="text-[11px] sm:text-[15px] leading-[1.82] sm:leading-[1.87] text-mirai-text-muted sm:text-mirai-text font-medium sm:font-normal">
              ここにグラフやチャートを配置する。データの説明文も付ける。
            </p>
          </div>
          {/* グラフコンポーネント */}
        </div>
      </section>

      {/* 行動 CTA */}
      <section className="max-w-6xl mx-auto px-4 mb-8 flex justify-center">
        <Button
          asChild
          variant="outline"
          className="w-[270px] h-[48px] rounded-[6px] border border-[#1F2937] text-[#1F2937] font-bold"
        >
          <a href="https://team-mirai.notion.site/FAQ-..." target="_blank" rel="noopener noreferrer">
            よくあるご質問
          </a>
        </Button>
      </section>
    </div>
  );
}
```

### 2.2 ポイント

- 背景は `body` レベルで薄ティールグラデを当てる(`globals.css` の `--background: linear-gradient(135deg, rgba(226, 246, 243, 1) 0%, rgba(238, 246, 226, 1) 100%);`)
- カードは `bg-white rounded-[24px]` の大ぶり角丸 + 厚めのパディング (`px-[18px] py-8 sm:p-12`)
- カードのインターナル余白は `space-y-8`(要素間に大きめの間隔)
- 固定ヘッダーがあるので `pt-24` でコンテンツを下げる
- CTA の角丸は marumie の MainButton スタイルで `rounded-[6px]`(gikai のピルとは違う、ここは marumie 独自)

### 2.3 出典

[marumie/webapp/src/app](https://github.com/team-mirai/marumie/tree/develop/webapp/src/app) 配下の `[year]/page.tsx` と [`MainColumnCard.tsx`](https://github.com/team-mirai/marumie/blob/develop/webapp/src/client/components/layout/MainColumnCard.tsx) を写経。

---

## §3 パターン 3: ゲーム性ある feed (action-board 風)

action-board の `home.tsx` 風。Hero 大画像 → メトリクス → アクティビティ feed → ランキング → ミッションリストの構成。

ユースケース: ガミフィケーション要素のある UI、ユーザー参加型 page、進捗トラッキング画面。

### 3.1 完全スケルトン

```tsx
// app/page.tsx
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function Home() {
  return (
    <div className="flex flex-col min-h-screen w-full">
      {/* Hero (グラデ大画面) */}
      <section className="relative w-full h-[740px] bg-linear-to-b from-[#64d8c6] to-[#bcecd3] overflow-hidden mt-[-96px] pt-24">
        <div className="absolute inset-0 w-full h-full flex justify-center items-end">
          <div className="relative w-[1080px] min-w-[1080px] h-[560px]">
            <Image
              src="/img/hero-background.svg"
              alt="街並みと雲のイラスト"
              fill
              className="object-contain object-bottom"
              priority
            />
          </div>
        </div>

        <div className="relative z-10 px-4 pt-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="flex justify-center mb-8">
              <Image
                src="/img/logo.png"
                alt="チームみらい"
                width={143}
                height={120}
                className="h-[120px] w-auto"
              />
            </div>
            <h1 className="text-4xl md:text-4xl font-bold text-mirai-text mb-4">
              タイトル
            </h1>
            <p className="text-sm font-bold mb-8 px-3">
              キャッチコピー
            </p>

            <div className="flex flex-col items-center gap-4">
              <Button asChild variant="outline" size="lg" className="rounded-full">
                <Link href="/sign-up">登録する</Link>
              </Button>
              <Button asChild variant="link" className="text-sm">
                <Link href="/about">これは何？</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* メトリクスバー(ゲーム的) */}
      <section className="bg-mirai-gradient py-4 md:py-8">
        <div className="w-full max-w-lg mx-auto px-4">
          <div className="bg-white rounded-2xl p-6 flex items-center justify-between">
            <div className="text-center">
              <p className="text-xs text-mirai-text-muted">参加者</p>
              <p className="text-2xl font-bold text-mirai-text">1,234人</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-mirai-text-muted">アクション</p>
              <p className="text-2xl font-bold text-mirai-text">5,678件</p>
            </div>
          </div>
        </div>
      </section>

      {/* アクティビティ feed */}
      <section className="py-12 md:py-16 bg-background">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-mirai-text mb-6">
            最近のアクティビティ
          </h2>
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-mirai-border p-4 flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-full bg-mirai-gradient flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-bold">ユーザー名</p>
                  <p className="text-xs text-mirai-text-muted">が「ミッション名」を達成しました</p>
                </div>
                <span className="text-xs text-mirai-text-muted">5分前</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ミッションリスト */}
      <section className="py-12 md:py-16 bg-background">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-mirai-text mb-6">
            ミッション
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-mirai-border p-6 hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <span className="inline-flex items-center justify-center px-3 py-0.5 text-xs font-medium text-mirai-text bg-mirai-highlight rounded-[20px] mb-3">
                  注目🔥
                </span>
                <h3 className="text-lg font-bold text-mirai-text mb-2">
                  ミッションタイトル
                </h3>
                <p className="text-sm text-mirai-text-muted leading-relaxed">
                  ミッションの説明文。やることを 2-3 行で。
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
```

### 3.2 ポイント

- Hero は背景イラスト + ロゴ中央 + h1 + サブコピー + outline ピル CTA の構成。`mt-[-96px] pt-24` はヘッダーに被せるためのテクニック
- メトリクスバーは `bg-mirai-gradient` のフルブリードバー + 白カードを内側に
- アクティビティ feed は `bg-white rounded-xl border border-mirai-border` の小カードを縦並び (`flex flex-col gap-3`)
- 「注目」バッジは `bg-mirai-highlight` (`#F4FF5F` 蛍光黄) + `rounded-[20px]` のピル

### 3.3 出典

[action-board/src/app/home.tsx](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/app/home.tsx) と [`src/components/top/hero.tsx`](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/components/top/hero.tsx) を写経。

---

## §4 パターン 4: 詳細 page (gikai 風 bill detail)

mirai-gikai の bill detail 系。タイトル + メタ情報 + タグ + 本文 + サイドバー(または下部)の補足情報の構成。

ユースケース: 記事・コンテンツの詳細表示、ユーザープロファイル、政策の解説 page。

### 4.1 完全スケルトン

```tsx
// app/[slug]/page.tsx
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function DetailPage({ params }: { params: { slug: string } }) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* パンくず */}
      <nav className="text-xs text-mirai-text-muted mb-4">
        <a href="/" className="hover:underline">トップ</a>
        <span className="mx-2">/</span>
        <span>詳細</span>
      </nav>

      {/* タイトル + メタ */}
      <header className="mb-8">
        <span className="inline-flex items-center justify-center px-3 py-0.5 text-xs font-medium text-mirai-text bg-mirai-highlight rounded-[20px] mb-3">
          注目🔥
        </span>
        <h1 className="text-2xl/8 md:text-3xl font-bold text-mirai-text tracking-normal mb-4">
          タイトル
        </h1>
        <div className="flex items-center gap-3 text-xs text-mirai-text-muted font-medium">
          <time>2026.05.14 提出</time>
          <span>•</span>
          <span>カテゴリ</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {["タグ1", "タグ2"].map((t) => (
            <span
              key={t}
              className="px-3 py-1 text-xs font-medium text-mirai-text bg-mirai-surface-tag rounded-full"
            >
              {t}
            </span>
          ))}
        </div>
      </header>

      {/* サムネ */}
      <div className="relative w-full aspect-video mb-8 rounded-2xl overflow-hidden">
        <Image
          src="/img/thumbnail.png"
          alt=""
          fill
          className="object-cover"
          priority
          sizes="100vw"
        />
      </div>

      {/* 本文 */}
      <article className="prose prose-mirai max-w-none mb-10">
        <p className="text-[15px] leading-[28px] text-mirai-text">
          本文の段落 1。詳しい説明を書く場所。
        </p>
        <h2 className="text-[22px] font-bold leading-[1.48] mt-8 mb-4">
          見出し
        </h2>
        <p className="text-[15px] leading-[28px] text-mirai-text">
          本文の段落 2。
        </p>
      </article>

      {/* アクション */}
      <div className="flex flex-col sm:flex-row gap-3 mb-10">
        <Button variant="default" className="rounded-full">
          応援する
        </Button>
        <Button variant="outline" className="rounded-full">
          シェアする
        </Button>
      </div>

      {/* 関連情報カード */}
      <section className="mt-12">
        <h2 className="text-[22px] font-bold text-mirai-text leading-[1.48] mb-6">
          関連情報
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <Card key={i} className="border border-mirai-border hover:bg-muted/50 transition-colors">
              <CardHeader>
                <CardTitle className="text-lg font-bold">
                  関連タイトル
                </CardTitle>
                <p className="text-sm text-mirai-text leading-relaxed">
                  関連情報の説明文。
                </p>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
```

### 4.2 ポイント

- パンくずは `text-xs text-mirai-text-muted` でひそやかに
- h1 は `text-2xl/8 tracking-normal font-bold`、line-height 32px。長い和文タイトルでも読みやすい
- 「注目」バッジは `bg-mirai-highlight` (蛍光黄) でタイトル上に
- タグは `bg-mirai-surface-tag` (`#E8E8E8`) のピル
- 本文の段落は `text-[15px] leading-[28px]`(gikai の About と同じ)
- アクションは横並び(モバイルでは縦) + ピルボタン

### 4.3 出典

[mirai-gikai の bill detail 関連](https://github.com/team-mirai/mirai-gikai/tree/develop/web/src/features/bills) を写経。

---

## §5 パターン共通: layout.tsx の完全テンプレ

すべての page で共通のレイアウト。Noto Sans JP + warm gray 背景 + 固定ヘッダー or 通常ヘッダーの選択。

```tsx
// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Lexend_Giga, Noto_Sans_JP } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import type { ReactNode } from "react";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const lexendGiga = Lexend_Giga({
  variable: "--font-lexend-giga",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "プロダクト名｜チームみらい",
  description: "プロダクトの説明文",
  // ...
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#2aa693",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body
        className={`${notoSansJP.variable} ${lexendGiga.variable} font-sans antialiased bg-background text-foreground`}
      >
        <NextTopLoader showSpinner={false} color="#2aa693" />
        {children}
      </body>
    </html>
  );
}
```

ポイント:
- `lang="ja"` を必ず指定
- `font-sans antialiased` で Noto Sans JP をデフォルト化
- `bg-background text-foreground` で warm gray 背景 + dark text
- `themeColor: "#2aa693"` でモバイルブラウザのナビバーを teal に
- `<NextTopLoader color="#2aa693" />` でページ遷移のプログレスバーを brand 色に

---

## §6 共通: 固定ヘッダーの完全テンプレ(marumie / action-board 風)

ヘッダー自体を「白い rounded box on warm gray」で浮かせるパターン。

```tsx
// components/common/header.tsx
import Link from "next/link";
import Image from "next/image";

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 px-2.5 py-3 xl:px-6 xl:py-4">
      <div className="bg-white rounded-[20px] px-3 py-3 xl:px-6 xl:py-0 relative z-10">
        <div className="flex items-center gap-2 xl:h-16">
          <Link href="/" className="flex items-center gap-2 xl:gap-4 hover:opacity-80 transition-opacity">
            <div className="w-14 h-12 xl:w-12 xl:h-11 relative">
              <Image
                src="/logos/team-mirai-logo.svg"
                alt="チームみらい"
                fill
                className="object-contain"
              />
            </div>
            <span className="font-bold text-mirai-text">プロダクト名</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-6 ml-auto" aria-label="メインナビゲーション">
            {[
              { href: "/about", label: "About" },
              { href: "/contact", label: "お問い合わせ" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-bold text-mirai-text hover:text-primary-accent transition-colors whitespace-nowrap"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
```

ポイント:
- `fixed top-0 left-0 right-0 z-40` の上に `bg-white rounded-[20px]` の浮島
- 外側に余白 (`px-2.5 py-3 xl:px-6 xl:py-4`) を取ることで「浮いている」感
- ヘッダーの高さは `h-16` (64px) + 外側 padding で総計 80-96px
- モバイルでは `<Sheet>` か `<DropdownMenu>` でナビを折りたたむ

---

## §7 page を組み立てる「決定木」

新規 page を作るときの判断フロー:

```
Q1. このページの目的は？
├─ A. ユーザーに「これは何？」を伝える (LP)
│   → §1 ランディング (gikai 風) を採用
│
├─ B. データを可視化して見せる (ダッシュボード)
│   → §2 ダッシュボード (marumie 風) を採用
│
├─ C. ユーザーに行動を促す (feed / gamified)
│   → §3 ゲーム性ある feed (action-board 風) を採用
│
└─ D. 個別アイテムの詳細を見せる (record detail)
    → §4 詳細 page (gikai 風) を採用

Q2. ヘッダーは？
├─ シンプル (LP) → ヘッダーなし or 最小限のロゴ+1〜2 リンク
└─ アプリ全体で固定 (ダッシュボード/feed) → §6 の固定ヘッダー

Q3. Hero は必要？
├─ LP/feed → §1 か §3 の Hero パターン
└─ ダッシュボード/detail → タイトル + メタの「ページヘッダー」のみ

Q4. CTA は？
├─ プライマリ (登録/保存/応援) → Button variant="default" (グラデピル)
├─ セカンダリ → Button variant="outline" (白ピル)
└─ リンク的 → Button variant="link"
```

決定木に従えば、4 パターンの組み合わせで *チームみらいの 8 割以上の page* がカバーできる。新しい組み合わせが必要なら、まずこの 4 パターンを参考に SKILL.md §0 Visual Signature をチェックしながら設計する。

---

## §8 出典 — 一次情報

- [mirai-gikai/web/src/app/(main)/page.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/app/(main)/page.tsx)
- [mirai-gikai/web/src/components/top/](https://github.com/team-mirai/mirai-gikai/tree/develop/web/src/components/top) — Hero, About, TeamMirai, LinkButton, ComingSoonSection
- [mirai-gikai/web/src/features/bills/server/components/featured-bill-section.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/features/bills/server/components/featured-bill-section.tsx)
- [mirai-gikai/web/src/features/bills/client/components/bill-list/bill-card.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/features/bills/client/components/bill-list/bill-card.tsx)
- [marumie/webapp/src/app/o/[slug]/[year]/page.tsx](https://github.com/team-mirai/marumie/tree/develop/webapp/src/app/o)
- [marumie/webapp/src/client/components/layout/MainColumnCard.tsx](https://github.com/team-mirai/marumie/blob/develop/webapp/src/client/components/layout/MainColumnCard.tsx)
- [marumie/webapp/src/client/components/layout/header/HeaderClient.tsx](https://github.com/team-mirai/marumie/blob/develop/webapp/src/client/components/layout/header/HeaderClient.tsx)
- [action-board/src/app/home.tsx](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/app/home.tsx)
- [action-board/src/components/top/hero.tsx](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/components/top/hero.tsx)
- [action-board/src/components/common/navbar.tsx](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/components/common/navbar.tsx)
