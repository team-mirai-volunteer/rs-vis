# 06. アクセシビリティ最低ライン

「美しさ」と「親切さ」のトレードオフは **親切さに倒す**([`01-philosophy.md`](01-philosophy.md))。本ファイルは PR レビューで弾くべき A11y 違反のリスト。WCAG 2.2 AA を最低ラインとする。

---

## 6.1 フォーカス管理

### 鉄則：キーボードだけで全機能を操作できる

- すべての対話的要素(ボタン・リンク・入力・チェックボックス・タブ)は `Tab` で到達可能
- `Tab` の順序が **視覚的な順序と一致** すること
- マウスフォーカスはデフォルト非表示でよいが、`:focus-visible` は必ず有効にする(キーボード時に枠線が出る)

### mirai-gikai/web の標準実装

```css
*:focus-visible,
button:focus-visible,
a:focus-visible,
table:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
```

`outline-none` 単体は禁止(フォーカスが完全に消える)。`outline-none` を使う場合は **必ず `focus-visible:` で代替を当てる**。

### 「Skip to main content」リンク

長いヘッダーやサイドバーがある場合、ページ冒頭に「メインコンテンツに移動」リンクを置く：

```tsx
<a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2">
  メインコンテンツに移動
</a>
{/* ... */}
<main id="main">{children}</main>
```

通常は隠れていて、`Tab` でフォーカスすると出現する。

---

## 6.2 コントラスト比

### 鉄則：本文 4.5:1 以上、大文字 3:1 以上

WCAG 2.2 AA の基準。

| 組み合わせ | 本文サイズ(14px〜)| 大文字サイズ(18px+ Bold or 24px〜) |
|---|---|---|
| `text-foreground` (`#1F2937`) on `bg-card` (`#FFFFFF`) | ✅ 16.1:1 | ✅ |
| `text-muted-foreground` (`#8E8E93`) on `bg-card` (`#FFFFFF`) | ⚠️ 3.6:1 — **本文には使わない** | ✅ |
| `text-primary` (`#2AA693`) on `bg-card` (`#FFFFFF`) | ⚠️ 3.0:1 — リンク・大文字なら可 | ✅ |
| `text-primary-foreground` (white) on `bg-primary` (`#2AA693`) | ✅ 4.7:1 | ✅ |
| `text-black` on `bg-mirai-gradient` (`#64D8C6` 側) | ✅(黒文字なので余裕) | ✅ |

### `text-muted-foreground` の扱い

- 14px 以上で使う場合は OK
- 12px の補足テキストに使う場合、**重要情報を含めない**(読めなくても影響がない情報のみ)
- 重要なメタ情報(日時・著者名)を 12px で出す場合は `text-foreground/70` 等に上げる

### コントラストチェック

PR レビューで疑問があれば https://webaim.org/resources/contrastchecker/ を使う。

---

## 6.3 色だけで意味を伝えない

### 鉄則：ステータスは「色 + アイコン + 文言」

色覚特性(赤緑色覚異常など)を持つユーザーが情報を取り逃さないため。

```tsx
// ❌ 色だけ
<span className="text-stance-for">賛成</span>
<span className="text-stance-against">反対</span>

// ✅ 色 + アイコン + 文言
<span className="text-stance-for inline-flex items-center gap-1">
  <ThumbsUp className="size-4" /> 賛成
</span>
<span className="text-stance-against inline-flex items-center gap-1">
  <ThumbsDown className="size-4" /> 反対
</span>
```

### バリエーション

- 緑✅ / 黄⚠️ / 赤❌ のステータスバッジ：アイコンも一緒に
- グラフの線：色 + パターン(実線・破線)または ラベル直付け
- 必須項目：色 + 「\*」+ `aria-required="true"`
- エラーフィールド：色 + アイコン + エラーメッセージ

---

## 6.4 ARIA 属性

### よく使う属性

| 属性 | 用途 | 例 |
|---|---|---|
| `aria-label` | アイコンのみのボタン・リンクに名前を付ける | `<Button size="icon" aria-label="お気に入りに追加">` |
| `aria-labelledby` | 別要素の ID を指して名前を参照 | `<section aria-labelledby="section-title">` |
| `aria-describedby` | 補助説明を参照 | `<Input aria-describedby="email-help">` |
| `aria-required` | 必須項目 | `<Input aria-required="true">` |
| `aria-invalid` | バリデーション NG | `<Input aria-invalid="true">` |
| `aria-expanded` | 展開可能要素の開閉状態 | アコーディオン・ドロップダウン |
| `aria-current="page"` | 現在のページ(ナビ用) | `<Link aria-current="page">ホーム</Link>` |
| `role="alert"` | 動的に表示されるアラート | toast 内部で使う(sonner が自動付与) |

### `aria-label` を **重複させない**

```tsx
// ❌ Tooltip と aria-label が両方ついて、SR が二重に読み上げる
<Tooltip>
  <TooltipTrigger asChild>
    <Button size="icon" aria-label="お気に入りに追加"><Star /></Button>
  </TooltipTrigger>
  <TooltipContent>お気に入りに追加</TooltipContent>
</Tooltip>

// ✅ Tooltip の中身を aria-label として参照
<Tooltip>
  <TooltipTrigger asChild>
    <Button size="icon" aria-label="お気に入りに追加"><Star /></Button>
  </TooltipTrigger>
  <TooltipContent>お気に入りに追加</TooltipContent>
</Tooltip>
// ※ shadcn の Tooltip は aria-describedby を自動で当てるので、両方付いていても問題ないが、
//   テキストが完全に同じ場合は冗長。aria-label 側を優先する。
```

---

## 6.5 セマンティック HTML

### 鉄則：意味のあるタグを使う

| 内容 | 正しいタグ |
|---|---|
| メインの見出し(ページ 1 つ) | `<h1>` |
| セクション見出し | `<h2>` `<h3>` … |
| ナビゲーション | `<nav>` |
| メインコンテンツ | `<main>` |
| 補助情報(サイドバー) | `<aside>` |
| 一時的な選択肢(モーダル等) | `<dialog>` または shadcn `<Dialog>` |
| 行為を起こすボタン | `<button>`(shadcn `<Button>` 経由) |
| ページ間遷移 | `<a>`(Next.js `<Link>` 経由) |

### 避けるパターン

- ❌ `<div onClick={...}>` でボタン代用(キーボード操作不可、`<Button>` を使う)
- ❌ `<span>` でリンク代用(`<Link>` を使う)
- ❌ `<h3>` を見出しではなくサイズ目的で使う(`<p className="text-base font-semibold">` を使う)

---

## 6.6 キーボード操作

### Dialog / Modal

- `Esc` で閉じる(shadcn `<Dialog>` は自動)
- 開いた瞬間に最初の対話要素にフォーカスを移す(autofocus 不要、shadcn 自動)
- Tab は内部を巡回(外には抜けない)
- 閉じたら **元のトリガーに戻る**(shadcn 自動)

### Dropdown / Combobox

- `↑` `↓` でリスト内移動
- `Enter` で選択
- `Esc` で閉じる
- 文字を打つと候補に飛ぶ(typeahead)

shadcn の Radix UI ベースコンポーネントはほぼすべて対応済み。**自作する場合は同じ挙動を再現する**。

### Tab

- `Tab` で次の対話要素へ
- `Shift+Tab` で前へ
- フォーム内で `Enter` を押したら submit(テキストエリアは除く)

---

## 6.7 言語属性

`<html lang="ja">` を必ず付ける。Next.js の場合 `app/layout.tsx` に書く：

```tsx
export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
```

英語が混在する箇所には部分的に `lang="en"` を付ける：

```tsx
<p>これは <span lang="en">Team Mirai</span> の例です</p>
```

---

## 6.8 画像

### `<img>` ではなく `next/image`

```tsx
import Image from "next/image";

<Image src="/hero.jpg" alt="議会の風景写真" width={1200} height={630} priority />
```

### `alt` の書き方

- **情報を伝える画像**：内容を簡潔に。「議会の風景写真」「グラフ：5 月の支持率推移」
- **装飾画像**：`alt=""`(空文字列)。SR がスキップする
- **リンク内の画像**：リンク先を表す。`alt="ホームに戻る"` のように

### 動画

- 字幕(`<track>`)を付ける
- 自動再生は **しない**(必要なら音声なしで `muted`)
- 視聴覚以外の方法でも情報を伝える(説明テキストを併記)

---

## 6.9 動きの配慮(prefers-reduced-motion)

過度なアニメーションは前庭障害・てんかんなどを持つユーザーに影響する。

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

JavaScript で大きなアニメーションを行う場合も:

```ts
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!prefersReducedMotion) {
  // アニメーション開始
}
```

---

## 6.10 タッチターゲット

モバイル UI では **44x44px 以上** のタップ領域を確保する(WCAG 2.5.5)。

- `Button size="default"` (h-13 = 52px) は OK
- `Button size="sm"` (h-9 = 36px) は **モバイルでは避ける**(または `size-9` を `size-11` に拡張)
- アイコンボタン (`Button size="icon"` size-9 = 36px) は **モバイルでは `size-11` に拡張**

```tsx
<Button size="icon" className="md:size-9 size-11" aria-label="メニュー">
  <Menu />
</Button>
```

---

## 6.11 フォーム

### `<label>` を必ず関連付ける

```tsx
// ✅ for / id で結びつけ
<label htmlFor="email">メールアドレス</label>
<Input id="email" />

// ✅ または label で wrap
<label>
  メールアドレス
  <Input />
</label>

// ❌ placeholder だけでラベル代替(IME 起動時に消える、SR で読み上げづらい)
<Input placeholder="メールアドレス" />
```

### エラーメッセージとフィールドの紐付け

```tsx
<Input
  id="email"
  aria-invalid={!!errors.email}
  aria-describedby={errors.email ? "email-error" : undefined}
/>
{errors.email && (
  <p id="email-error" className="text-xs text-destructive">{errors.email}</p>
)}
```

`aria-describedby` でフィールドとエラーメッセージを結びつける。SR がフィールドにフォーカスしたとき、エラーも続けて読み上げられる。

### 入力候補(autocomplete)

`autocomplete` 属性を活用する：

```tsx
<Input type="email" autoComplete="email" />
<Input type="tel" autoComplete="tel" />
<Input type="text" autoComplete="name" />
```

ブラウザ・iCloud Keychain・パスワードマネージャが入力を補助できる。

---

## 6.12 ライブリージョン

動的に変わるテキスト(toast・ロード完了通知)には `aria-live` を付ける：

```tsx
<div aria-live="polite" aria-atomic="true">
  {status}
</div>
```

- `polite`：今読んでいる箇所が終わったら読む
- `assertive`：即座に読む(緊急エラーのみ)

shadcn の `<Toaster />` は内部で対応済み。

---

## 6.13 PR 直前の A11y チェックリスト

- [ ] すべての対話要素が `Tab` で到達できるか
- [ ] フォーカスリングが見えるか(`focus-visible:` で `outline` が出るか)
- [ ] アイコンのみのボタンに `aria-label` があるか
- [ ] 色だけで意味を伝えていないか(ステータス・必須・エラー)
- [ ] 画像に `alt` があるか
- [ ] フォームに `<label>` があるか
- [ ] `<button>` `<div onClick>` で代用していないか
- [ ] エラーメッセージが `aria-describedby` で紐付いているか
- [ ] `<html lang="ja">` が付いているか

---

## ツール

- **axe DevTools**(Chrome 拡張)：自動 A11y 検査。PR 前にチェック
- **VoiceOver**(macOS)：実際にスクリーンリーダーで読み上げてみる
- **キーボードのみ操作**：マウスを抜いて全機能を試す

---

## 関連ページ

- [`05-writing.md`](05-writing.md) — ラベル・エラーメッセージのトーン
- [`03-components.md`](03-components.md) — Dialog / Form / Tooltip の正しい使い方
- [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) — A11y 含む 100+ ベスプラ
