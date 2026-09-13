# 03. コンポーネント詳細

`mirai-gikai/web/src/components/ui/` を **正典** とする。本ファイルは shadcn 既定 → ちみカスタマイズ → 採用済み variant の順で具体的な実装を示す。

> [!IMPORTANT]
> 同じ機能を `<div>` + class で自作しない。`<button>` `<input>` の **生 HTML タグの直書きも禁止**。必ず `@/components/ui/` 経由で。

---

## 3.0 採用順位

新しい UI を組むときの判断順:

```
1. プロジェクトの src/components/ui/ に既存があれば、それを使う
2. 既存にない shadcn コンポーネントが必要なら `npx shadcn@latest add <name>` で追加
3. shadcn にない要素(例：grade-tied で派手なバッジ)なら、cva ベースで src/components/ui/ に新規作成
4. その場限りの組み合わせなら features/ 配下で組む(ui/ には入れない)
```

---

## 3.1 Button

### 3.1.1 ファイル: `mirai-gikai/web/src/components/ui/button.tsx`

```tsx
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-primary focus-visible:ring-primary/40 focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "border border-black bg-mirai-gradient text-black shadow-xs hover:opacity-90",
        destructive: "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline: "border border-black bg-white shadow-xs hover:bg-gray-50",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 underline !p-0 !h-auto hover:opacity-90",
      },
      size: {
        default: "h-13 px-4 py-2 has-[>svg]:px-3",  // h-13 = 52px
        sm: "h-9 gap-1.5 px-3 has-[>svg]:px-2.5",   // h-9 = 36px
        lg: "h-10 px-6 has-[>svg]:px-4",            // h-10 = 40px
        icon: "size-9",                              // 36 x 36
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
```

### 3.1.2 variants の使い分け

| variant | いつ使う | 1 画面に何個 | 注意 |
|---|---|---|---|
| `default` | プライマリ CTA(送信・公開・保存等) | **1** | グラデピル。これを複数並べたら何かが間違ってる |
| `outline` | セカンダリ(戻る・キャンセル・補助選択) | 0〜2 | プライマリと並べるなら左に置く |
| `secondary` | やや弱めの操作(編集・複製) | 0〜複数 | グレー寄り |
| `ghost` | 低重要度(メニュー内・カード内アクション) | 複数可 | 透明 |
| `link` | テキストリンク代替(「もっと見る」「詳しく」) | 複数可 | `!p-0 !h-auto` で本文に埋め込み可 |
| `destructive` | 破壊的(削除・取消) | **1**(モーダル内) | 必ず Dialog 確認を挟む |

> [!IMPORTANT]
> **`default` の文字色は `text-black`**(白ではない)。グラデが薄いティールなので黒文字でコントラストを取る設計。グラデの上で白文字にすると読みづらい。

### 3.1.3 サイズの使い分け

| size | h | px | 想定 |
|---|---|---|---|
| `sm` | 36px | 12px | デスクトップ密度高めの管理画面 |
| `default` | 52px | 16px | 公開側(タッチ操作対応のため大きめ) |
| `lg` | 40px | 24px | hero / オンボーディング |
| `icon` | 36x36 | — | アイコンのみ(必ず `aria-label` 必須) |

### 3.1.4 アイコン同居パターン

```tsx
import { ArrowRight } from "lucide-react";

<Button>
  保存する
  <ArrowRight />  {/* 自動で size-4 が当たる、gap-2 で間隔も自動 */}
</Button>
```

cva の `[&_svg:not([class*='size-'])]:size-4` により、子の `<svg>` は自動的に `16x16` になる。**手動で `<ArrowRight className="w-4 h-4" />` のようにサイズを当てない**(重複指定)。

### 3.1.5 asChild パターン(Link との結合)

```tsx
import Link from "next/link";

<Button asChild variant="link">
  <Link href={routes.gikai()}>議会に戻る</Link>
</Button>
```

`asChild` は `@radix-ui/react-slot` の機能で、子の要素(ここでは `<Link>`)にスタイルを移譲する。`<a>` を `<Button>` で wrap して `<button>` を生成しないために必要。

---

## 3.2 Card

### 3.2.1 ファイル: `mirai-gikai/web/src/components/ui/card.tsx`

`forwardRef` を使った構成。Header / Title / Description / Content / Footer の 6 部品で 1 つのカード。

```tsx
import type { HTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref}
      className={cn("rounded-xl border bg-card text-card-foreground shadow", className)}
      {...props} />
  )
);

const CardHeader = forwardRef(...(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
)));

const CardTitle = forwardRef(...(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
)));

const CardDescription = forwardRef(...(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
)));

const CardContent = forwardRef(...(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
)));

const CardFooter = forwardRef(...(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
)));
```

### 3.2.2 パディングの規則

- `CardHeader` `CardContent` `CardFooter` はそれぞれ `p-6`(= 24px)
- ただし `CardContent` `CardFooter` は **`pt-0`**(Header 直下なら top padding を Header に任せる)
- カード全体の高さを揃えたい場合は `<Card className="flex flex-col h-full">` で親の grid に追従させる

### 3.2.3 hover 挙動

カードがクリック可能か否かで分ける:

- **対話的カード**(クリックで遷移する): `hover:shadow-md transition-shadow` + 全体を `<Link>` で wrap
- **装飾的カード**(読むだけ): hover 効果を当てない

両者を同じ画面に混在させない(ユーザーがカード = クリック可能 と学習してしまうため)。

### 3.2.4 例：賛否別のカード(みらい議会の典型パターン)

```tsx
<Card className={cn(
  "transition-shadow hover:shadow-md",
  stance === "for" && "border-stance-for-bg",
  stance === "against" && "border-stance-against",
)}>
  <CardHeader>
    <Badge variant={stance === "for" ? "default" : stance === "against" ? "destructive" : "outline"}>
      {stanceLabel}
    </Badge>
    <CardTitle>{title}</CardTitle>
    <CardDescription>{author} ・ {date}</CardDescription>
  </CardHeader>
  <CardContent>{body}</CardContent>
  <CardFooter>
    <Button variant="ghost" size="sm">詳しく見る</Button>
  </CardFooter>
</Card>
```

---

## 3.3 Badge

### 3.3.1 ファイル: `mirai-gikai/web/src/components/ui/badge.tsx`

7 種の variant を持つ。stance(賛成・反対)やステータスを示す要 partsだが、**色だけで意味を伝えないために必ずテキスト or アイコンを併用** する([`06-accessibility.md`](06-accessibility.md))。

```tsx
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-mirai-gradient text-black [a&]:hover:opacity-90",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90",
        outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        muted: "border-muted-foreground/50 bg-white text-muted-foreground [a&]:hover:bg-gray-50",
        dark: "border-transparent bg-gray-300 text-black [a&]:hover:bg-gray-400",
        light: "border-primary bg-transparent text-primary [a&]:hover:opacity-90",
      },
    },
    defaultVariants: { variant: "default" },
  }
);
```

### 3.3.2 variants の使い分け

| variant | 用途 |
|---|---|
| `default` | 最も目立たせたいラベル(注目・新着・PRIMARY) |
| `secondary` | 一般カテゴリ |
| `destructive` | エラー・否定・反対 |
| `outline` | 中立カテゴリ |
| `muted` | 控えめなメタ情報(カウント・日付) |
| `dark` | 強調はしないが目立たせたい |
| `light` | ティール枠だけのアクセント |

### 3.3.3 サイズ

固定。`text-xs` / `px-2 py-0.5` で常に小さい。複数 Badge を並べるときは `gap-1` で密接させる。

---

## 3.4 Input / Textarea

### 3.4.1 Input ファイル

```tsx
function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}
```

### 3.4.2 フォームのレイアウト規則

- **ラベルはフィールドの上**(横並びにしない。モバイルで折り返すと醜くなる)
- フィールド間 `gap-4`(16px)
- 必須項目はラベルに `*` を付ける(赤字)、`aria-required="true"` を input に当てる
- ヘルプテキストは input の下、`text-xs text-muted-foreground`
- エラー時は input に `aria-invalid="true"`、エラーメッセージは `text-xs text-destructive`

```tsx
<div className="flex flex-col gap-1.5">
  <label htmlFor="email" className="text-sm font-medium">
    メールアドレス <span className="text-destructive">*</span>
  </label>
  <Input id="email" type="email" aria-required="true" aria-invalid={!!errors.email} />
  {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
</div>
```

### 3.4.3 disable は慎重に

- **送信前に Submit ボタンを disable しない**(Vercel Web Interface Guidelines 由来のルール)。ユーザーが「なぜ押せないか」を解消するためにフォームを見直せなくなる
- 代わりに **押したらバリデーションして該当フィールドにフォーカス** を当てる
- 送信中だけ disable + spinner にする

---

## 3.5 Dialog(モーダル)

### 3.5.1 ファイル: `mirai-gikai/web/src/components/ui/dialog.tsx`

Radix UI ベース。`DialogContent` のスタイル:

```css
"bg-white data-[state=open]:animate-in data-[state=closed]:animate-out
 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)]
 translate-x-[-50%] translate-y-[-50%] gap-4 rounded-3xl border p-6 shadow-lg
 duration-200 outline-none sm:max-w-lg"
```

ポイント:

- **角丸 `rounded-3xl`(24px)** — カードより丸い(ダイアログだけの特殊サイズ)
- **`bg-white`** — 背景の透明・ぼかしは使わない
- **`max-w-lg`(512px)** — それ以上は中身がスカスカに見えるので別の UI に置き換える
- オーバーレイは `bg-black/50`(半透明黒)

### 3.5.2 使い方の規則

- **破壊的アクションは必ず Dialog で確認**(削除・公開取消・課金など)
- 内容は短く：1〜2 段落 + 「キャンセル」「実行」のボタンセット
- 確認ボタンは `<Button variant="destructive">` または `<Button variant="default">`
- キャンセルボタンは左、確認は右(Dialog Footer 内で `sm:flex-row sm:justify-end`)

### 3.5.3 例

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button variant="destructive">削除する</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>本当に削除しますか？</DialogTitle>
      <DialogDescription>
        この操作は取り消せません。コメントとリアクションも一緒に削除されます。
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose asChild><Button variant="outline">キャンセル</Button></DialogClose>
      <Button variant="destructive" onClick={handleDelete}>削除する</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## 3.6 Sheet(モバイル sidebar・ドロワー)

`mirai-gikai/web/src/components/ui/sheet.tsx`。`<768px` で sidebar の代替に使う。

```tsx
<Sheet>
  <SheetTrigger asChild>
    <Button size="icon" variant="ghost" aria-label="メニューを開く">
      <Menu />
    </Button>
  </SheetTrigger>
  <SheetContent side="left" className="w-[280px] sm:w-[260px]">
    {/* ナビ */}
  </SheetContent>
</Sheet>
```

- 幅は **260〜280px**(PC サイドバーと同じ)
- 左側から開く(`side="left"`)が標準。右から開くのは通知パネル等の補助用途
- 中身はフッターまでスクロール可能にする：`overflow-y-auto`

---

## 3.7 Tooltip / HoverCard

### Tooltip

短い説明(10 文字程度)に使う。**アイコンのみのボタンには必須**(A11y)。

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button size="icon" variant="ghost" aria-label="お気に入りに追加">
      <Star />
    </Button>
  </TooltipTrigger>
  <TooltipContent>お気に入りに追加</TooltipContent>
</Tooltip>
```

### HoverCard

長めの説明(プロフィール・参考リンク等)に使う。ホバーで開くので **クリック必須の情報は入れない**(モバイルで表示できない)。

---

## 3.8 Toast(sonner)

```tsx
import { toast } from "sonner";

toast.success("保存しました");
toast.error("保存できませんでした。通信状態を確認してください");
toast.info("自動保存が完了しました");
```

- 1 行で書く。長文は別画面か `<Dialog>` に
- 成功は緑系(sonner デフォルト)、エラーは赤系
- 表示時間はデフォルト(4 秒)で良い
- アクション付きトースト(`toast("...", { action: { label: "元に戻す", onClick: ... } })`)は破壊的アクション直後にだけ使う

`<Toaster />` は `app/layout.tsx` に 1 回だけ配置:

```tsx
import { Toaster } from "sonner";
// ...
<Toaster position="bottom-right" richColors />
```

---

## 3.9 Sidebar

`mirai-gikai/web` には正規 `Sidebar` コンポーネントはないが、`globals.css` に `--sidebar-*` トークンが定義済み。新規プロダクトで使う場合は shadcn の `npx shadcn@latest add sidebar` で導入。

幅: **260px 固定**(モバイルでは `<Sheet>` に置換)。

```tsx
<aside className="hidden md:flex w-[260px] flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
  <SidebarHeader />
  <nav className="flex-1 overflow-y-auto p-4 space-y-1">
    <SidebarNavItem icon={<Home />} active>ホーム</SidebarNavItem>
    <SidebarNavItem icon={<MessageCircle />}>コメント</SidebarNavItem>
    {/* ... */}
  </nav>
  <SidebarFooter />
</aside>
```

`SidebarNavItem` は active 時に `bg-sidebar-accent text-sidebar-accent-foreground` を当てる。

---

## 3.10 Tabs

shadcn 標準。`TabsList` はカード状ではなく **下線型** を採用する：

```tsx
<Tabs defaultValue="overview">
  <TabsList className="border-b border-border w-full justify-start rounded-none bg-transparent p-0 h-auto">
    <TabsTrigger value="overview" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 pb-2">
      概要
    </TabsTrigger>
    <TabsTrigger value="details">詳細</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">...</TabsContent>
</Tabs>
```

> [!NOTE]
> shadcn デフォルトの `TabsList` は灰色背景のピル群(ボタン群風)になる。それも有効だが、ちみ標準は **下線型**(テキストエディタや Notion 風)。理由：CTA との視覚的競合を避けるため。

---

## 3.11 Progress

```tsx
<Progress value={66} max={100} />
```

`globals.css` の `--color-mirai-progress-track`(`#D9D9D9`)と `--color-mirai-progress-fill`(`#A9E89D`)を内部で使うように shadcn の `progress.tsx` を上書きする。

色の意味:
- 既定: 淡い緑(成功・正常進捗)
- 警告レベルの遅延: `--color-mirai-star`(`#FF9500`)
- エラー(停止・失敗): `--destructive`

---

## 3.12 Speech Bubble(みらい議会 独自)

`mirai-gikai/web/src/components/ui/speech-bubble.tsx`。「賛成・反対のコメント」を吹き出しで表現するちみ独特のコンポーネント。AI 議論・ユーザー対話を視覚化する用途で再利用可能。

> 新規プロダクトで「ユーザーコメント」を表示する場合、`Card` ではなく `SpeechBubble` を使うか検討する。

---

## 3.13 cn() ユーティリティ

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

クラス名の合成は **必ず `cn()` 経由**。理由:

- `tailwind-merge` が同じプロパティのクラス重複を自動解決する(`p-4 p-6` → `p-6`)
- 条件付きクラスを安全に書ける(`cn("base", isActive && "bg-primary", disabled && "opacity-50")`)
- 後から追加された className が確実に優先される

**避けるパターン**:

```tsx
// ❌ 三項演算子
<div className={`base-class ${condition ? "active" : "inactive"}`} />

// ❌ template literal で重複指定
<div className={`p-4 ${needsMorePadding ? "p-8" : ""}`} />

// ✅ cn()
<div className={cn("base-class", condition && "active", !condition && "inactive")} />
<div className={cn("p-4", needsMorePadding && "p-8")} />  // tailwind-merge が p-4 を上書き
```

---

## 3.14 ファイル配置の規則

```
src/
├── app/
│   └── globals.css           ← トークンの真の出典
├── components/
│   ├── ui/                   ← shadcn / cva ベースの primitive
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── badge.tsx
│   │   ├── input.tsx
│   │   ├── dialog.tsx
│   │   └── ...
│   └── (features 由来の共通コンポーネント)
├── features/
│   └── <feature>/
│       ├── client/components/    ← Client Component(features 固有)
│       └── server/components/    ← Server Component(features 固有)
└── lib/
    └── utils.ts              ← cn() を含むユーティリティ
```

- **`ui/` の中の primitive を `features/` で wrap して新コンポーネントを作る**のは OK
- **`features/` から `ui/` の primitive をスキップして生 HTML を書く**のは NG
- **`ui/` の中で features 固有のロジックを混ぜる**のは NG(primitive は無汚染を保つ)

---

## 関連ページ

- [`../examples/`](../examples/) — 実装例(button / card / badge)
- [`04-patterns.md`](04-patterns.md) — コンポーネントの組み合わせパターン
- [`08-antipatterns.md`](08-antipatterns.md) — 「shadcn 既存をスキップして自作」など禁止リスト
- [mirai-gikai/web/src/components/ui/](https://github.com/team-mirai/mirai-gikai/tree/develop/web/src/components/ui) — 一次出典
