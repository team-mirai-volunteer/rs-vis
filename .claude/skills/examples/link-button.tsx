/**
 * link-button.tsx — チームみらい Web のアイコン付きリンクボタン
 *
 * 出典: mirai-gikai/web/src/components/top/link-button.tsx
 *
 * 視覚的指紋:
 * - 形状: 黒 1px ボーダー + 白背景 + rounded-full（ピル）
 * - 構造: [左アイコン] [テキスト font-bold 15px] [右矢印アイコン]
 * - hover: bg-gray-50
 * - 主に「外部リンクへの遷移」「About 系の補足リンク」「寄附で応援する」のような行動誘導に使う
 *
 * shadcn 標準の <Button variant="outline"> に asChild で <a> を入れる構造。
 */

import Image from "next/image";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface LinkButtonProps {
  href: string;
  /** 左側のアイコン */
  iconSrc: string;
  iconAlt: string;
  iconWidth: number;
  iconHeight: number;
  /** 右側の矢印アイコン（デフォルト: /icons/arrow-right.svg） */
  arrowSrc?: string;
  children: ReactNode;
  target?: string;
  rel?: string;
}

export function LinkButton({
  href,
  iconSrc,
  iconAlt,
  iconWidth,
  iconHeight,
  arrowSrc = "/icons/arrow-right.svg",
  children,
  target = "_blank",
  rel = "noopener noreferrer",
}: LinkButtonProps) {
  return (
    <Button
      asChild
      variant="outline"
      className="w-fit rounded-full px-6 py-3 h-auto"
    >
      <a href={href} target={target} rel={rel}>
        <Image
          src={iconSrc}
          alt={iconAlt}
          width={iconWidth}
          height={iconHeight}
          className="flex-shrink-0"
        />
        <span className="text-[15px] font-bold">{children}</span>
        <Image
          src={arrowSrc}
          alt=""
          width={16}
          height={15}
          className="flex-shrink-0"
        />
      </a>
    </Button>
  );
}
