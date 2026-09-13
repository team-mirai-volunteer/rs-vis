/**
 * header.tsx — チームみらい Web の固定ヘッダー完全テンプレート
 *
 * 出典:
 * - marumie/webapp/src/client/components/layout/header/HeaderClient.tsx
 * - action-board/src/components/common/navbar.tsx
 *
 * 視覚的指紋:
 * - 白い rounded box (rounded-[20px]) が warm gray の body に浮いている
 * - 外側に余白 (px-2.5 py-3 xl:px-6 xl:py-4) を取って「浮き島」感を出す
 * - z-index 40 で fixed
 * - ロゴ画像（SVG 推奨）+ プロダクト名のテキスト併記（任意）
 * - 右側に最大 1 つの CTA、それ以上はモバイルで Sheet/DropdownMenu に折りたたむ
 *
 * これを使うときの body は pt-24 など、ヘッダー高さ分の上余白が必要。
 */

"use client";

import { Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  productName: string;
  logoSrc: string; // SVG 推奨。/logos/team-mirai-logo.svg など
  navItems: { href: string; label: string }[];
  ctaLabel?: string;
  ctaHref?: string;
}

export function Header({
  productName,
  logoSrc,
  navItems,
  ctaLabel,
  ctaHref,
}: HeaderProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-40 px-2.5 py-3 xl:px-6 xl:py-4">
      {/* 白い rounded box — warm gray の body に浮いている浮き島 */}
      <div className="bg-white rounded-[20px] px-3 py-3 xl:px-6 xl:py-0 relative z-10 shadow-xs">
        <div className="flex items-center gap-2 xl:h-16">
          {/* ロゴと製品名 */}
          <Link
            href="/"
            className="flex items-center gap-2 xl:gap-4 hover:opacity-80 transition-opacity"
          >
            <div className="w-12 h-12 xl:w-12 xl:h-11 relative flex-shrink-0">
              <Image
                src={logoSrc}
                alt="チームみらい"
                fill
                className="object-contain"
                priority
              />
            </div>
            <span className="font-bold text-mirai-text whitespace-nowrap">
              {productName}
            </span>
          </Link>

          {/* デスクトップナビ */}
          <nav
            className="hidden lg:flex items-center gap-6 ml-auto flex-shrink-0"
            aria-label="メインナビゲーション"
          >
            {navItems.map((item) => {
              const isExternal = item.href.startsWith("http");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm font-bold text-mirai-text hover:text-primary-accent transition-colors whitespace-nowrap"
                  {...(isExternal && {
                    target: "_blank",
                    rel: "noopener noreferrer",
                  })}
                >
                  {item.label}
                </Link>
              );
            })}
            {ctaLabel && ctaHref && (
              <Button asChild variant="default" size="sm" className="rounded-full">
                <Link href={ctaHref}>{ctaLabel}</Link>
              </Button>
            )}
          </nav>

          {/* モバイルメニュー */}
          <div className="lg:hidden ml-auto flex items-center gap-2">
            {ctaLabel && ctaHref && (
              <Button asChild variant="default" size="sm" className="rounded-full">
                <Link href={ctaHref}>{ctaLabel}</Link>
              </Button>
            )}
            <DropdownMenu open={open} onOpenChange={setOpen}>
              <DropdownMenuTrigger
                aria-label="ナビゲーションメニューを開く"
                className="p-2 rounded-full hover:bg-muted/50 transition-colors"
              >
                <Menu className="size-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56 rounded-2xl"
                side="bottom"
                align="end"
                sideOffset={8}
              >
                {navItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href}>{item.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
