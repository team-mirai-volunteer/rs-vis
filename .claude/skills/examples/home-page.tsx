/**
 * home-page.tsx — チームみらい Web のトップページ完全テンプレート
 *
 * 出典: mirai-gikai/web/src/app/(main)/page.tsx + components/top/* を統合
 *
 * このファイルは「新規プロダクトのトップページを 0 から作るときの起点」。
 * このまま `app/page.tsx` にコピーしてプロダクト固有の文言・画像を差し替えるのが速い。
 *
 * 構成:
 * 1. Hero（背景画像 + キャッチ）
 * 2. メインコンテンツ（max-w-4xl の Container）
 *    - 注目セクション（カード並び）
 * 3. About セクション（プロダクト説明 + LinkButton）
 * 4. TeamMirai セクション（党の紹介 + SNS アイコン）
 * 5. Disclaimer
 *
 * 全要素が SKILL.md §0 の Visual Signature 7 項目を満たすように構成されている:
 * - Noto Sans JP の font-bold / font-medium / font-normal
 * - #2AA693 primary / #0F8472 accent
 * - bg-mirai-gradient は使わず、画像 Hero でも実装可
 * - warm gray 背景 (bg-background)
 * - グラデ + 黒ボーダー + 黒文字の CTA
 * - rounded-xl カード、控えめなボーダー
 * - font-medium 本文 + leading-relaxed
 */

import Image from "next/image";
import Link from "next/link";
import { HeroWithImage } from "./hero";
import { LinkButton } from "./link-button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// プロダクト固有の定数（このファイルをコピーしたら差し替える）
const PRODUCT_NAME = "プロダクト名";
const PRODUCT_DESCRIPTION =
  "このプロダクトは、〇〇のためのプラットフォームです。〇〇を目指して、継続的にアップデートしていきます。";

interface FeaturedItem {
  id: string;
  title: string;
  description: string;
  href: string;
  tags?: string[];
}

const SAMPLE_ITEMS: FeaturedItem[] = [
  // 実プロダクトでは loaders / fetch で取得する
  {
    id: "1",
    title: "サンプルタイトル 1",
    description: "サンプルの説明文。だいたい 2-3 行で書く。",
    href: "/items/1",
    tags: ["タグA", "タグB"],
  },
];

// ============================================
// Container コンポーネント（max-w-4xl の共通幅）
// ============================================
function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}

// ============================================
// セクションヘッダー（h2 + サブキャプション）
// ============================================
function SectionHeader({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-[22px] font-bold text-mirai-text leading-[1.48]">
        {title}
      </h2>
      <p className="text-xs font-medium text-mirai-text-muted leading-[1.67]">
        {caption}
      </p>
    </div>
  );
}

// ============================================
// アイテムカード（画像なし版）
// ============================================
function ItemCard({ item }: { item: FeaturedItem }) {
  return (
    <Card className="border border-mirai-border hover:bg-muted/50 transition-colors relative overflow-hidden max-w-[634px]">
      <CardHeader>
        <div className="flex flex-col gap-3">
          <CardTitle className="text-2xl/8 tracking-normal">
            {item.title}
          </CardTitle>
          <p className="text-sm leading-relaxed text-mirai-text">
            {item.description}
          </p>
          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 text-xs font-medium text-mirai-text bg-mirai-surface-tag rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}

// ============================================
// About セクション
// ============================================
function About() {
  return (
    <div className="py-10">
      <div className="flex flex-col gap-4">
        {/* ヘッダー */}
        <div className="flex flex-col gap-4">
          {/* 英語見出し画像（任意） */}
          {/* <h2>
            <Image src="/icons/about-typography.svg" alt="About" width={143} height={36} priority />
          </h2> */}
          <h2 className="text-2xl font-bold leading-[43.2px]">About</h2>
          <p className="text-sm font-bold text-primary-accent">
            {PRODUCT_NAME}とは
          </p>
        </div>

        {/* コンテンツ */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h3 className="text-2xl font-bold leading-[43.2px]">
              わかりやすく
              <br />
              情報を届ける
            </h3>
            <p className="text-[15px] leading-[28px] text-mirai-text">
              {PRODUCT_DESCRIPTION}
            </p>
          </div>

          {/* もっと詳しく知るボタン */}
          <LinkButton
            href="https://team-mir.ai/"
            iconSrc="/icons/info-icon.svg"
            iconAlt=""
            iconWidth={23}
            iconHeight={22}
          >
            詳しく見る
          </LinkButton>
        </div>
      </div>
    </div>
  );
}

// ============================================
// TeamMirai セクション
// ============================================
function TeamMirai() {
  return (
    <div className="py-10">
      <div className="flex flex-col gap-6">
        {/* ヘッダー */}
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold leading-[43.2px]">Team Mirai</h2>
          <p className="text-sm font-bold text-primary-accent">
            チームみらいについて
          </p>
        </div>

        {/* コンテンツ */}
        <div className="flex flex-col gap-6">
          <p className="text-[15px] leading-[28px] text-mirai-text">
            参議院議員・AIエンジニアの安野たかひろが立ち上げた政党です。テクノロジーで政治の課題を解決することを目指しています。
          </p>

          {/* ボタングループ */}
          <div className="flex flex-col gap-4">
            <LinkButton
              href="https://team-mir.ai/"
              iconSrc="/icons/info-icon.svg"
              iconAlt=""
              iconWidth={23}
              iconHeight={22}
            >
              チームみらいについて詳しく
            </LinkButton>

            <LinkButton
              href="https://team-mir.ai/#donation"
              iconSrc="/icons/heart-icon.svg"
              iconAlt=""
              iconWidth={18}
              iconHeight={17}
            >
              寄附で応援する
            </LinkButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// 免責事項
// ============================================
function Disclaimer() {
  return (
    <div className="py-6 text-xs text-mirai-text-muted leading-relaxed">
      <p>
        本サービスは、可能な限り正確な情報を反映するよう努めていますが、その正確性・完全性・即時性について保証するものではありません。
      </p>
    </div>
  );
}

// ============================================
// トップページ本体
// ============================================
export default async function Home() {
  return (
    <>
      <HeroWithImage
        catchCopy={
          <>
            キャッチコピーを <br />
            ここに 2 行で
          </>
        }
        poweredByLabel="powered by Team Mirai & AI"
        backgroundImageSrc="/img/hero-background.png"
        backgroundImageAlt="背景画像"
      />

      <Container>
        <div className="py-10">
          <main className="flex flex-col gap-16">
            {/* 注目セクション */}
            <section className="flex flex-col gap-6">
              <SectionHeader
                title="注目🔥"
                caption="まず知ってほしい情報"
              />
              <div className="flex flex-col gap-4">
                {SAMPLE_ITEMS.map((item) => (
                  <Link key={item.id} href={item.href}>
                    <ItemCard item={item} />
                  </Link>
                ))}
              </div>
            </section>

            {/* About / TeamMirai */}
            <About />
            <TeamMirai />

            {/* 免責 */}
            <Disclaimer />
          </main>
        </div>
      </Container>
    </>
  );
}
