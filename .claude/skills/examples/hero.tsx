/**
 * hero.tsx — チームみらい Web の Hero セクション完全テンプレート
 *
 * 出典:
 * - action-board/src/components/top/hero.tsx (グラデ + ロゴ中央配置型)
 * - mirai-gikai/web/src/components/top/hero.tsx (背景画像 + 下部キャッチコピー型)
 *
 * 2 種類提供する: HeroWithGradient（グラデ Hero）と HeroWithImage（画像 Hero）
 *
 * 視覚的指紋:
 * - 高さ 70-80vh、min-h-[400px]
 * - グラデは bg-mirai-gradient （#64D8C6 → #BCECD3 の対角）1 種類のみ
 * - ロゴ画像は priority、中央配置
 * - h1 は text-4xl md:text-4xl font-bold text-mirai-text
 * - サブコピーは text-sm font-bold mb-8
 * - CTA は variant="outline" size="lg" の outline ピル + variant="link" のサブ CTA
 */

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// ============================================
// パターン A: グラデ + ロゴ中央配置（action-board 風）
// ============================================

interface HeroWithGradientProps {
  productName: string;
  catchCopy: React.ReactNode; // 短いキャッチ。<br /> を含めて 1-2 行
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  logoSrc?: string; // デフォルトは /img/logo.png
  showBackgroundIllustration?: boolean;
  backgroundIllustrationSrc?: string; // 街並み・人物などのイラスト
}

export function HeroWithGradient({
  productName,
  catchCopy,
  primaryCtaLabel,
  primaryCtaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  logoSrc = "/img/logo.png",
  showBackgroundIllustration = false,
  backgroundIllustrationSrc = "/img/hero-background.svg",
}: HeroWithGradientProps) {
  return (
    <section className="relative w-full h-[740px] bg-linear-to-b from-[#64d8c6] to-[#bcecd3] overflow-hidden mt-[-96px] pt-24">
      {/* 背景イラスト（任意） */}
      {showBackgroundIllustration && (
        <div className="absolute inset-0 w-full h-full flex justify-center items-end pointer-events-none">
          <div className="relative w-[1080px] min-w-[1080px] h-[560px]">
            <Image
              src={backgroundIllustrationSrc}
              alt=""
              fill
              className="object-contain object-bottom"
              priority
            />
          </div>
        </div>
      )}

      {/* メインコンテンツ */}
      <div className="relative z-10 px-4 pt-8">
        <div className="max-w-4xl mx-auto text-center">
          {/* ロゴ画像 */}
          <div className="flex justify-center mb-8">
            <Image
              src={logoSrc}
              alt="チームみらい"
              width={143}
              height={120}
              sizes="100vw"
              className="h-[120px] w-auto"
              priority
            />
          </div>

          {/* h1 */}
          <h1 className="text-4xl md:text-4xl font-bold text-mirai-text mb-4">
            {productName}
          </h1>

          {/* サブコピー */}
          <p className="text-sm font-bold mb-8 px-3">{catchCopy}</p>

          {/* CTA */}
          {(primaryCtaLabel || secondaryCtaLabel) && (
            <div className="flex flex-col items-center gap-4">
              {primaryCtaLabel && primaryCtaHref && (
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="rounded-full px-8 py-3 text-base font-bold whitespace-nowrap"
                >
                  <Link href={primaryCtaHref}>{primaryCtaLabel}</Link>
                </Button>
              )}
              {secondaryCtaLabel && secondaryCtaHref && (
                <Button
                  asChild
                  variant="link"
                  className="text-sm font-medium text-mirai-text hover:text-primary-accent"
                >
                  <Link href={secondaryCtaHref}>{secondaryCtaLabel}</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================
// パターン B: 背景画像 + 下部キャッチコピー（mirai-gikai 風）
// ============================================

interface HeroWithImageProps {
  catchCopy: React.ReactNode; // <br /> 込みの 1-2 行
  poweredByLabel?: string; // "powered by Team Mirai & AI" 的なクレジット
  backgroundImageSrc: string;
  backgroundImageAlt: string;
  showScrollIndicator?: boolean;
}

export function HeroWithImage({
  catchCopy,
  poweredByLabel,
  backgroundImageSrc,
  backgroundImageAlt,
  showScrollIndicator = true,
}: HeroWithImageProps) {
  return (
    <div className="relative w-full h-[80vh] min-h-[400px] md:h-[70vh]">
      <Image
        src={backgroundImageSrc}
        alt={backgroundImageAlt}
        fill
        priority
        className="object-cover"
        sizes="100vw"
        quality={85}
      />

      {/* キャッチコピーの帯 */}
      <div className="absolute bottom-[30vh] left-0 right-0 py-4">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-bold text-xl md:text-2xl leading-relaxed text-mirai-text">
            {catchCopy}
          </p>
          {poweredByLabel && (
            <p className="mt-2 font-lexend text-xs text-mirai-text">
              {poweredByLabel}
            </p>
          )}
        </div>
      </div>

      {/* スクロールインジケーター */}
      {showScrollIndicator && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center animate-bounce-gentle">
          <div className="w-[1px] h-[34px] bg-black"></div>
          <p className="mt-2 font-lexend text-[10px] leading-[20px] text-black">
            Scroll
          </p>
        </div>
      )}
    </div>
  );
}
