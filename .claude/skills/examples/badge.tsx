/* ============================================================
 * Badge コンポーネント — チームみらい標準実装
 *
 * 出典: team-mirai/mirai-gikai/web/src/components/ui/badge.tsx
 *
 * 7 種の variant でカテゴリ・ステータス・賛否を表示する。
 * 色だけで意味を伝えないため、アイコン or テキストを必ず併用する。
 *
 * デザイン上のポイント:
 * - 角丸 rounded-md（6px）。バッジは小さい四角寄り
 * - text-xs（12px）+ font-medium（500）固定。大きくしない
 * - px-2 py-0.5（横余白 8px / 縦余白 2px）。隣接 Badge は gap-1（4px）
 * - SVG 子要素は size-3（12px）。Button の size-4（16px）とは違う
 * - default variant はグラデ + 黒文字（Button と同じ思想）
 * ============================================================ */

import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        // 最も目立たせたいラベル（新着・PRIMARY）
        default:
          "border-transparent bg-mirai-gradient text-black [a&]:hover:opacity-90",

        // 一般カテゴリ
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",

        // エラー・否定・反対
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",

        // 中立カテゴリ（枠だけ）
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",

        // 控えめなメタ情報（カウント・日付）
        muted:
          "border-muted-foreground/50 bg-white text-muted-foreground [a&]:hover:bg-gray-50",

        // 強調はしないが目立たせたい
        dark: "border-transparent bg-gray-300 text-black [a&]:hover:bg-gray-400",

        // ティール枠だけのアクセント（AI ラベル等）
        light:
          "border-primary bg-transparent text-primary [a&]:hover:opacity-90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };

/* ============================================================
 * 使用例
 * ============================================================
 *
 * import { Badge } from "@/components/ui/badge";
 * import { ThumbsUp, ThumbsDown, Sparkles, AlertCircle, Check } from "lucide-react";
 *
 * // 1. シンプル
 * <Badge>新着</Badge>
 *
 * // 2. variant ごとの使い分け
 * <Badge variant="default">注目</Badge>
 * <Badge variant="secondary">カテゴリ</Badge>
 * <Badge variant="destructive">エラー</Badge>
 * <Badge variant="outline">中立</Badge>
 * <Badge variant="muted">12 件</Badge>
 * <Badge variant="dark">下書き</Badge>
 * <Badge variant="light">AI 生成</Badge>
 *
 * // 3. 色 + アイコン + テキストで意味を伝える（色覚配慮）
 * <Badge variant="default">
 *   <Check /> 賛成
 * </Badge>
 * <Badge variant="destructive">
 *   <ThumbsDown /> 反対
 * </Badge>
 * <Badge variant="light">
 *   <Sparkles /> AI 生成
 * </Badge>
 *
 * // 4. リンク化（asChild + Next.js Link）
 * import Link from "next/link";
 * <Badge asChild variant="secondary">
 *   <Link href="/tags/budget">予算</Link>
 * </Badge>
 *
 * // 5. 数のカウント表示
 * <span className="inline-flex items-center gap-2">
 *   コメント
 *   <Badge variant="muted">{count}</Badge>
 * </span>
 *
 * // 6. 賛否カウントを左右で並べる
 * <div className="flex items-center gap-2">
 *   <Badge variant="default"><ThumbsUp /> {forCount}</Badge>
 *   <Badge variant="destructive"><ThumbsDown /> {againstCount}</Badge>
 *   <Badge variant="outline">中立 {neutralCount}</Badge>
 * </div>
 *
 * // 7. 通知（ヘッダーのベルアイコン横）
 * <Button size="icon" variant="ghost" aria-label="通知">
 *   <Bell />
 *   {unread > 0 && (
 *     <span className="absolute -top-1 -right-1 size-4 bg-destructive text-white text-xs rounded-full flex items-center justify-center">
 *       {unread > 9 ? "9+" : unread}
 *     </span>
 *   )}
 * </Button>
 *
 * ============================================================ */
