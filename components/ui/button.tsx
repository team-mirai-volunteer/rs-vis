/**
 * Button — チームみらい標準実装（mirai-gikai/web 正典を Tailwind v3 に移植）
 *
 * - ピル型（rounded-full）。default はグラデ + 黒文字 + 黒 1px ボーダー
 * - 生 <button> ではなく必ずこれを使う（focus ring / disabled / アイコンサイズを集約）
 * - 内側の SVG（lucide-react）は自動で 16px（size-4）
 * - 本アプリは可視化ツールで情報密度が高いため、xs / icon-sm サイズを追加している
 */
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "border border-black bg-mirai-gradient text-black shadow-xs hover:opacity-90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline: "border border-black bg-white text-mirai-text shadow-xs hover:bg-mirai-surface",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-mirai-surface-light",
        ghost: "text-mirai-text hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 underline !p-0 !h-auto hover:opacity-90",
      },
      size: {
        default: "h-13 px-4 py-2 has-[>svg]:px-3",
        sm: "h-9 gap-1.5 px-3 has-[>svg]:px-2.5",
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        data-slot="button"
        type={asChild ? undefined : type ?? "button"}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
