/* ============================================================
 * Button コンポーネント — チームみらい標準実装
 *
 * 出典: team-mirai/mirai-gikai/web/src/components/ui/button.tsx
 *
 * 新規プロダクトはこれをそのままコピーして `src/components/ui/button.tsx` に置く。
 * カスタマイズが必要な場合は variant を追加する形で拡張する（既存 variant は触らない）。
 *
 * デザイン上のポイント:
 * - 角丸は rounded-full（ピル型）。チームみらいの CTA は基本ピル
 * - default variant は黒文字 + グラデ。グラデが薄いティールなので黒の方が読みやすい
 * - default の border は黒（border-black）。グラデの輪郭を立たせる
 * - default size の h-13（=52px）はタッチターゲット 44px を超えるサイズで設計
 * - SVG 子要素は自動で size-4（16px）。Button 内で <Heart /> と書けば 16px になる
 * - focus-visible で primary 色のリング（3px + offset 2px）。`outline-none` は単体使用しない
 * ============================================================ */

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-primary focus-visible:ring-primary/40 focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // プライマリ CTA。1 画面 1 つだけ。
        default:
          "border border-black bg-mirai-gradient text-black shadow-xs hover:opacity-90",

        // 破壊的アクション。Dialog 内で使うのが原則。
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",

        // セカンダリ。default と並べるなら左に置く。
        outline: "border border-black bg-white shadow-xs hover:bg-gray-50",

        // 補助操作（編集・複製等）。
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",

        // 低重要度（メニュー内・カード内アクション）。
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",

        // テキストリンク代替（「もっと見る」「詳しく」）。
        link: "text-primary underline-offset-4 underline !p-0 !h-auto hover:opacity-90",
      },
      size: {
        default: "h-13 px-4 py-2 has-[>svg]:px-3", // 52px、タッチ対応
        sm: "h-9 gap-1.5 px-3 has-[>svg]:px-2.5",  // 36px、デスクトップ密度高い管理画面用
        lg: "h-10 px-6 has-[>svg]:px-4",            // 40px、hero
        icon: "size-9",                              // 36x36
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

/* ============================================================
 * 使用例
 * ============================================================
 *
 * import { Button } from "@/components/ui/button";
 * import { Save, ArrowRight, Trash2 } from "lucide-react";
 *
 * // 1. 基本（プライマリ CTA）
 * <Button>送信する</Button>
 *
 * // 2. アイコン同居（SVG サイズは自動）
 * <Button>
 *   保存する <Save />
 * </Button>
 *
 * // 3. セカンダリと並べる
 * <div className="flex gap-2">
 *   <Button variant="outline">キャンセル</Button>
 *   <Button>公開する</Button>
 * </div>
 *
 * // 4. 破壊的アクション（必ず Dialog 内で）
 * <Button variant="destructive">
 *   <Trash2 /> 削除する
 * </Button>
 *
 * // 5. リンク化（Next.js Link を wrap）
 * import Link from "next/link";
 * <Button asChild variant="link">
 *   <Link href={routes.gikai.bill(id)}>詳しく見る <ArrowRight /></Link>
 * </Button>
 *
 * // 6. アイコンのみ（aria-label 必須）
 * <Button size="icon" variant="ghost" aria-label="お気に入りに追加">
 *   <Star />
 * </Button>
 *
 * // 7. 送信中（disabled + spinner）
 * import { Loader2 } from "lucide-react";
 * <Button disabled={isSubmitting}>
 *   {isSubmitting && <Loader2 className="animate-spin" />}
 *   {isSubmitting ? "送信中..." : "送信する"}
 * </Button>
 *
 * ============================================================ */
