/* ============================================================
 * Card コンポーネント — チームみらい標準実装
 *
 * 出典: team-mirai/mirai-gikai/web/src/components/ui/card.tsx
 *
 * デザイン上のポイント:
 * - 角丸 rounded-xl（12px）固定。rounded-2xl 以上は使わない
 * - shadow は最小限（shadow）。装飾的に重ねない
 * - Header/Content/Footer は p-6（24px）固定
 * - Content/Footer は pt-0（Header の bottom padding に任せる）
 * - forwardRef を使い、親が ref を渡せる構成
 * ============================================================ */

import type { HTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 p-6", className)}
      {...props}
    />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center p-6 pt-0", className)}
      {...props}
    />
  )
);
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};

/* ============================================================
 * 使用例
 * ============================================================
 *
 * import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
 * import { Button } from "@/components/ui/button";
 * import { Badge } from "@/components/ui/badge";
 *
 * // 1. 基本構成
 * <Card>
 *   <CardHeader>
 *     <Badge variant="default">新着</Badge>
 *     <CardTitle>議案タイトル</CardTitle>
 *     <CardDescription>議員名 ・ 2026年5月14日</CardDescription>
 *   </CardHeader>
 *   <CardContent>
 *     議案の本文をここに...
 *   </CardContent>
 *   <CardFooter className="justify-end gap-2">
 *     <Button variant="outline" size="sm">後で読む</Button>
 *     <Button size="sm">詳しく見る</Button>
 *   </CardFooter>
 * </Card>
 *
 * // 2. クリック可能なカード（hover で shadow-md にリフト）
 * <Card className="transition-shadow hover:shadow-md cursor-pointer">
 *   ...
 * </Card>
 *
 * // 3. 賛成・反対のステータスを border 色で
 * <Card className={cn(
 *   stance === "for" && "border-stance-for-bg border-2",
 *   stance === "against" && "border-stance-against border-2",
 * )}>
 *   ...
 * </Card>
 *
 * // 4. グリッドで等高揃え
 * <div className="grid gap-4 md:grid-cols-2 pc:grid-cols-3">
 *   {items.map(item => (
 *     <Card key={item.id} className="flex flex-col h-full">
 *       <CardHeader>...</CardHeader>
 *       <CardContent className="flex-1">...</CardContent>
 *       <CardFooter>...</CardFooter>
 *     </Card>
 *   ))}
 * </div>
 *
 * // 5. 空状態（カード内に表示）
 * <Card className="flex flex-col items-center justify-center py-16 gap-4">
 *   <Inbox className="size-12 text-muted-foreground" />
 *   <div className="text-center space-y-1">
 *     <p className="font-semibold">まだコメントがありません</p>
 *     <p className="text-sm text-muted-foreground">最初のコメントを投稿してみましょう</p>
 *   </div>
 *   <Button>コメントを投稿する</Button>
 * </Card>
 *
 * ============================================================ */
