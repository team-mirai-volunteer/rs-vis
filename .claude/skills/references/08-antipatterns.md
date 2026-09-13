# 08. アンチパターン — grep でひっかかる禁止リスト

PR レビューと PR 直前のセルフチェックで使う「機械的に検出できる違反」のリスト。**1 件でもヒットしたら直す**。意図的に逸脱が必要な場合は、PR コメントで `// design-system: <reason>` のような根拠を残す。

---

## 8.1 色の arbitrary value

### ❌ ハードコードした hex 値

```bash
grep -rE '(text|bg|border|fill|stroke|ring|outline|via|from|to|decoration|caret|accent)-\[#[0-9A-Fa-f]+\]' src/
```

検出例：
```tsx
<div className="text-[#2AA693]">  // ❌
<span className="bg-[#FF9500]">    // ❌
<button className="border-[#D2D2D2]"> // ❌
```

→ `globals.css` のトークンを使う：
```tsx
<div className="text-primary">
<span className="bg-mirai-star">
<button className="border-border">
```

### ❌ Tailwind v3 系の color palette を生で使う

```bash
grep -rE '(text|bg|border)-(red|blue|green|yellow|gray|slate|zinc|neutral)-(50|100|200|300|400|500|600|700|800|900)' src/
```

検出例：
```tsx
<span className="text-red-500">エラー</span>  // ❌
<div className="bg-green-100">成功</div>      // ❌
```

→ 意味的トークンを使う：
```tsx
<span className="text-destructive">エラー</span>
<div className="bg-stance-for-bg">成功</div>
```

例外：`gray-50` `gray-300` `gray-400` だけは button.tsx 等で限定的に許容されている(`hover:bg-gray-50` `bg-gray-300`)。新しい場所には増やさない。

### ❌ style 属性で色を直接当てる

```bash
grep -rE 'style=\{\{[^}]*(color|background|border|fill|stroke)' src/
```

検出例：
```tsx
<div style={{ color: "#1F2937" }}>本文</div>           // ❌
<div style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>  // ❌
```

→ クラスを使う：
```tsx
<div className="text-foreground">本文</div>
<div className="bg-black/50">  // Tailwind opacity 記法
```

---

## 8.2 生 HTML タグ

### ❌ `<button>` タグの直書き

```bash
grep -rE '<button(\s|>)' src/
```

→ shadcn `<Button>` を使う：
```tsx
import { Button } from "@/components/ui/button";
<Button>送信する</Button>
```

例外：`@/components/ui/button.tsx` 自身(cva の中で `<button>` を使う)

### ❌ `<input>` `<textarea>` `<select>` の直書き

```bash
grep -rE '<(input|textarea|select)(\s|>)' src/
```

→ shadcn の対応コンポーネントを使う

### ❌ `<div onClick={...}>` でボタン代用

```bash
grep -rE '<div[^>]*onClick' src/
```

→ `<Button>` または `<a>`(遷移なら)を使う。理由：`<div>` はキーボード操作不可、`role="button"` を付けても A11y で完璧にはならない。

### ❌ `<a href>` でロジック起動

```bash
grep -rE 'href="#"' src/
```

検出例：
```tsx
<a href="#" onClick={handleClick}>クリック</a>  // ❌
```

→ `<Button>` または `<Button variant="link">` を使う。

---

## 8.3 アイコン

### ❌ インライン SVG

```bash
grep -rE '<svg(\s|>)' src/
```

→ `lucide-react` から import：
```tsx
import { Heart } from "lucide-react";
<Heart className="size-4" />
```

例外：プロダクト固有ロゴ(`team-mirai-logo.svg`, `mirainu.svg`)は `public/` に置いて `next/image` で読む。

### ❌ アイコンサイズを w/h で個別指定

```bash
grep -rnE '<[A-Z][a-zA-Z]+\s+[^>]*className="[^"]*\b(w|h)-[0-9]+' src/ | grep -v -E 'lucide|Loader2'
```

検出例：
```tsx
<Star className="w-4 h-4" />   // ❌(重複指定)
```

→ `size-N` で一括指定：
```tsx
<Star className="size-4" />    // ✅ 16x16
<Star className="size-5" />    // ✅ 20x20
```

ボタン内のアイコンは shadcn の cva が `[&_svg:not([class*='size-'])]:size-4` で自動 16px にするので **省略可能**：
```tsx
<Button><Star /> お気に入り</Button>  // ✅ アイコンサイズ指定不要
```

### ❌ 絵文字をアイコン代わりに

```bash
grep -rE '🔍|❌|✅|⚠️' src/ --include='*.tsx' --include='*.ts'
```

→ lucide-react の対応アイコンを使う：
```tsx
<Search />       // 🔍 の代わり
<X />            // ❌ の代わり
<Check />        // ✅ の代わり
<AlertTriangle /> // ⚠️ の代わり
```

例外：絵文字を **文字として** 扱う場合(ニックネーム・コメント内容など)は OK。

---

## 8.4 クラス名の合成

### ❌ 三項演算子・テンプレートリテラルで合成

```bash
grep -rE 'className=\{`[^`]*\$\{' src/
```

検出例：
```tsx
<div className={`base ${isActive ? "active" : ""}`}>  // ❌
```

→ `cn()` を使う：
```tsx
import { cn } from "@/lib/utils";
<div className={cn("base", isActive && "active")}>
```

理由：`cn()` は `tailwind-merge` を内包しているので、`p-4 p-6` のような同プロパティの重複を自動解決する。テンプレートリテラルだと両方が当たって順序依存の事故を起こす。

### ❌ classnames / classcat 等の他ライブラリ

`cn()` で一本化する。

---

## 8.5 ルーティング(mirai-gikai 限定)

### ❌ 文字列リテラルでルート直書き

```bash
grep -rE 'href="/' src/ | grep -v 'mailto:' | grep -v '\.svg' | grep -v '\.png'
```

→ `@/lib/routes` のヘルパー関数を使う：
```tsx
import { routes } from "@/lib/routes";
<Link href={routes.gikai.bill(billId)}>議案を見る</Link>
```

新規 `page.tsx` を追加したら `lib/routes.ts` にもルート関数を追加する(テストで同期検証される)。詳細は [mirai-gikai/AGENTS.md](https://github.com/team-mirai/mirai-gikai/blob/develop/AGENTS.md)。

### ❌ `index.ts` re-export 経由の import

```bash
grep -rE "from '@/components/ui'" src/
```

→ 個別ファイルから直接 import：
```tsx
// ❌
import { Button } from "@/components/ui";
// ✅
import { Button } from "@/components/ui/button";
```

例外：marumie/admin は逆に `index.ts` 経由 import を採用している([admin-ui-guidelines.md](https://github.com/team-mirai/marumie/blob/develop/docs/admin-ui-guidelines.md))。**プロダクト初期で方針を決めて固定する**。新規プロダクトは mirai-gikai の「直接 import」方式を推奨。

---

## 8.6 タイポグラフィ

### ❌ サイズ系クラスの重複

```bash
grep -rnE 'className="[^"]*\btext-(xs|sm|base|lg|xl|2xl|3xl)\b[^"]*\btext-(xs|sm|base|lg|xl|2xl|3xl)\b' src/
```

→ 1 要素 1 サイズ。

### ❌ `leading-none` を本文に

`leading-none` は見出し(複数行にならない単発の見出し)専用。日本語本文には `leading-relaxed`(1.875)を使う。

### ❌ Tailwind デフォルトの font 系クラスを Figma Make 経由で乱用

Figma Make が書き出す `text-2xl font-bold leading-none tracking-tight` のような多重クラスは、**1 クラス 1 役** に整理して書き直す。詳細は [`02-tokens.md` §2.2.4](02-tokens.md)。

---

## 8.7 スペーシング

### ❌ 4px グリッド外の値

```bash
grep -rE '(p|m|gap|space-x|space-y)-[xy]?-(5|7|9|11|13|15|17|19|21|22)' src/
```

→ 4 の倍数(`p-4 / p-6 / p-8 / p-12`)に揃える。`p-5`(20px) `p-7`(28px) は使わない。

### ❌ arbitrary value での spacing

```bash
grep -rE '(p|m|gap)-\[' src/
```

検出例：
```tsx
<div className="p-[14px]">  // ❌
<div className="gap-[22px]"> // ❌
```

→ Tailwind スケールに丸める：`p-4`(16px)または `p-3`(12px)。

---

## 8.8 角丸

### ❌ 用途と合わない角丸

| 要素 | OK | NG |
|---|---|---|
| ピル型ボタン | `rounded-full` | `rounded-2xl` |
| 標準ボタン | `rounded-md` | `rounded-full`(意図的でなければ) |
| カード | `rounded-xl` | `rounded-2xl` `rounded-3xl` |
| 入力フィールド | `rounded-md` | `rounded-xl` |
| ダイアログ | `rounded-3xl` | (これは Dialog 専用) |

### ❌ `rounded-xl` を一般要素に

Figma Make が rounded-xl を 40px(ピル相当)にマッピングしているケースがあり、書き出しコードをそのままコミットすると一般要素まで丸くなる。**意図確認が必要**：

```tsx
// ❌ ただの div に
<div className="rounded-xl">情報</div>
// ✅ カードなら Card コンポーネント
<Card>...</Card>
// ✅ 通常の box なら rounded-md
<div className="rounded-md">情報</div>
```

詳細：[`02-tokens.md` §2.3.2](02-tokens.md) ／ [guidelines.md 叩き台](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC/p1773989547630149?thread_ts=1773623258.419589)

---

## 8.9 影

### ❌ `shadow-lg` / `shadow-xl` を装飾目的で

→ `shadow-md` まで。装飾的な浮き上がりはちみ標準のミニマル設計に合わない。

### ❌ box-shadow を style で直書き

```bash
grep -rE 'boxShadow' src/
```

→ Tailwind の `shadow-*` クラスを使う。

---

## 8.10 アニメーション

### ❌ `transition: all`

```bash
grep -rE 'transition-all\b' src/
```

→ プロパティを名指し：
```tsx
<div className="transition-colors">         // ✅ 色だけ
<div className="transition-opacity">        // ✅ 透明度だけ
<div className="transition-[color,box-shadow]"> // ✅ 複数指定可
```

理由：`transition: all` は全プロパティに対してリスナーが発火するため、パフォーマンス低下と意図しない animation 発生を招く。

### ❌ `animate-spin` を装飾で

`animate-spin` はローディングの意味を持つ。装飾目的でくるくる回すと、ユーザーが「何か処理中？」と誤解する。

### ❌ duration 1000ms 以上

アニメーション duration は 200ms / 300ms / 500ms(最大)まで。それ以上は鈍重に感じる。

---

## 8.11 文字列ハードコード(i18n の前準備)

国際化対応の予定があるなら、UI 文字列をコンポーネント内に直書きせず、`messages/ja.json` 等の翻訳ファイルから参照する。現時点(2026-05)では日本語固定なので **必須ではない** が、将来分離しやすいよう **コピー文言は features/<feature>/locales/ja.ts に集約する** という方針を立てるプロダクトもある。

---

## 8.12 ネットワーク

### ❌ 巨大配列を非 virtualize で `map()`

```bash
grep -rnE '\.map\(' src/ | head  # 件数チェックのみ
```

リスト長が **100 件を超える可能性がある** 場合、`@tanstack/react-virtual` で virtualize する。実例：[山根さん 70 件のコメント表示で気づいた事例](https://team-mirai-staff.slack.com/archives/C0AFPQKSKS7/p1774620746459069)。

### ❌ 大きな画像を `<img>` 生で

`next/image` を使う。LCP に影響する画像には `priority` を付ける。

---

## 8.13 文言

### ❌ ボタンの文言が「OK」「Submit」「Save」

→ 命令形の日本語：「保存する」「送信する」「公開する」([`05-writing.md`](05-writing.md))

### ❌ 「リアルタイム」「即時」「絶対」

→ 「最新の」「数秒で」「現時点では」

### ❌ 「みらい」を漢字・カタカナで

→ 「みらい」(ひらがな)

```bash
grep -rE 'チーム(未来|ミライ|Mirai)' src/
```

例外：URL `team-mir.ai` のような技術的な文字列。

---

## 8.14 Tailwind v4 の罠

### ❌ `bg-opacity-50` のような独立 opacity utility

v4 では非推奨。`bg-black/50` のようなスラッシュ記法を使う：

```bash
grep -rE '(bg|text|border)-opacity-' src/
```

→ `/<percentage>` 記法：
```tsx
<div className="bg-black/50">   // ✅
<div className="text-foreground/70"> // ✅
```

### ❌ `@apply` の濫用

shadcn 既定の `@layer base` で `border-border outline-ring/50` を当てている程度は OK。新規に `@apply` で複雑なクラス合成をしない(コンポーネント化する)。

---

## 8.15 Server / Client 境界

### ❌ Client Component に `server-only` 依存を持ち込む

mirai-gikai のレポジトリ構造では `features/<f>/server/` と `features/<f>/client/` を分けている。**client から server を import しない**。型・ユーティリティの共有は `shared/` に集約する。

```bash
grep -rnE 'from "@/features/.*/server/' src/features/*/client/
```

→ あれば違反。`shared/` 経由にする。

---

## 8.16 セルフチェックスクリプト

PR 直前に実行する 1 ライナー(プロジェクトルートで):

```bash
#!/usr/bin/env bash
set -e
echo "🔍 デザインシステム違反チェック..."

violations=0

check() {
  local pattern="$1"
  local message="$2"
  local count=$(grep -rE "$pattern" src/ 2>/dev/null | grep -v '\.test\.' | wc -l | xargs)
  if [ "$count" -gt 0 ]; then
    echo "❌ $message ($count 件)"
    grep -rnE "$pattern" src/ | grep -v '\.test\.' | head -5
    violations=$((violations + count))
  fi
}

check '(text|bg|border|fill|stroke)-\[#' 'arbitrary hex 値を使っている → トークンに置換せよ'
check 'style=\{\{[^}]*color' 'インライン style で色を当てている'
check '<button(\s|>)' '<button> タグを直書きしている → <Button> を使え'
check '<svg(\s|>)' 'インライン SVG → lucide-react を使え'
check '<input(\s|>)' '<input> タグを直書きしている → <Input> を使え'
check 'className=\{`[^`]*\$\{' 'テンプレートリテラルでクラス合成 → cn() を使え'
check 'transition-all\b' 'transition-all → プロパティを名指しせよ'

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "🚨 $violations 件のデザイン違反が見つかりました"
  exit 1
fi

echo "✅ デザインシステム違反なし"
```

`package.json` の `scripts` に登録すると CI でも回せる：

```json
{
  "scripts": {
    "lint:design": "bash scripts/check-design-system.sh"
  }
}
```

---

## 関連ページ

- [`02-tokens.md`](02-tokens.md) — トークン値とクラス対応
- [`03-components.md`](03-components.md) — shadcn 既存コンポーネント
- [`05-writing.md`](05-writing.md) — 文言ルール
- [mirai-gikai/AGENTS.md](https://github.com/team-mirai/mirai-gikai/blob/develop/AGENTS.md) — 一次出典
