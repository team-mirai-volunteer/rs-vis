# 02. デザイントークン — 完全版

`mirai-gikai/web/src/app/globals.css`(develop ブランチ)の `@theme inline` を **正典** とする。本ファイルは「どのトークンが何のためにあるか」「どの値を持つか」「どう組み合わせるか」を 1 箇所に集約したもの。実際の CSS を写経したい場合は [`../templates/globals.css`](../templates/globals.css) を使う。

> [!IMPORTANT]
> **arbitrary value(`text-[#xxx]` 等)は絶対に書かない**。色が必要なら必ずトークン経由。新色が必要なら **`globals.css` にトークンを追加する PR** を先に切る。

---

## 2.1 カラートークン

### 2.1.1 shadcn 標準(プロダクト共通の意味タグ)

shadcn/ui の Theming 仕様に従う標準トークン。意味タグで命名されているため、ライト／ダーク切り替えやテーマ拡張に強い。

| トークン | 用途 | mirai-gikai/web 値 | marumie/admin(dark)値 |
|---|---|---|---|
| `--background` | ページ背景 | `#F7F4EE` | `oklch(0.141 0.005 285.823)` |
| `--foreground` | 本文テキスト | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--card` | カード背景 | `oklch(1 0 0)` (= `#FFFFFF`) | `oklch(0.21 0.006 285.885)` |
| `--card-foreground` | カード上テキスト | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--popover` / `--popover-foreground` | ポップオーバー(ツールチップ・メニュー) | カードと同色 | カードと同色 |
| `--primary` | プライマリ(CTA・active) | `#2AA693` | `oklch(0.488 0.243 264.376)` (blue) |
| `--primary-accent` | プライマリ強調 | `#0F8472` | — |
| `--primary-foreground` | プライマリ上の文字色 | `oklch(0.985 0 0)` | `oklch(0.97 0.014 254.604)` |
| `--secondary` | セカンダリ背景(薄ニュートラル) | `oklch(0.97 0 0)` | `oklch(0.274 0.006 286.033)` |
| `--secondary-foreground` | セカンダリ上のテキスト | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--muted` | 控えめな背景(無効・empty) | `oklch(0.97 0 0)` | `oklch(0.274 0.006 286.033)` |
| `--muted-foreground` | 補足テキスト | `oklch(0.656 0 0)` | `oklch(0.705 0.015 286.067)` |
| `--accent` | ホバー時の背景 | `oklch(0.97 0 0)` | `oklch(0.274 0.006 286.033)` |
| `--accent-foreground` | ホバー時のテキスト | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--destructive` | 破壊的アクション・エラー | `oklch(0.577 0.245 27.325)` (= `#DC2626` 系) | `oklch(0.704 0.191 22.216)` |
| `--border` | 既定ボーダー | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--input` | 入力フィールドのボーダー | `oklch(0.922 0 0)` | `oklch(1 0 0 / 15%)` |
| `--ring` | フォーカスリング | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` |

**鉄則**: `bg-primary` を使うなら必ず `text-primary-foreground` をセットで当てる。`bg-card` には `text-card-foreground`、`bg-secondary` には `text-secondary-foreground`。**foreground を省略するとダーク／ライトの切替時にコントラストが崩れる**。

### 2.1.2 ちみ独自トークン(`--color-mirai-*`)

`mirai-gikai/web/src/app/globals.css` が定義し、新規プロダクトでもそのまま使える「ちみ専用」レイヤー。shadcn 標準と意味が被るところは shadcn 標準を優先するが、本文テキストの強弱や stance / reaction のような **チームみらいで頻出する意味** には専用トークンを用意した。

#### Text(テキスト階層)

| トークン | hex | 用途 |
|---|---|---|
| `--color-mirai-text` | `#1F2937` | 本文(gray-800 相当)。`<p>` の標準色 |
| `--color-mirai-text-secondary` | `#404040` | サブ見出し・強調文 |
| `--color-mirai-text-muted` | `#8E8E93` | 補足・メタデータ(日時・著者名等)。14px 以上で使う |
| `--color-mirai-text-placeholder` | `#AEAEB2` | input の placeholder |
| `--color-mirai-text-note` | `#4C4C4C` | 注釈・脚注 |
| `--color-mirai-text-subtle` | `#666666` | ふつうの灰色(mirai-text-muted より少し濃い) |
| `--color-mirai-text-close` | `#9F9B9B` | ❌ 閉じるアイコン色 |

#### Surface(背景の階層)

| トークン | hex | 用途 |
|---|---|---|
| `--color-mirai-surface` | `#F7F4F0` | ページ背景(`--background` と揃える) |
| `--color-mirai-surface-light` | `#EEEEEE` | カード内のサブセクション背景 |
| `--color-mirai-surface-grouped` | `#F2F2F7` | iOS 風グルーピング背景 |
| `--color-mirai-surface-muted` | `#E5E5EA` | 無効化された行・列 |
| `--color-mirai-surface-tag` | `#E8E8E8` | タグ・ラベル背景 |
| `--color-mirai-surface-warm` | `#EAE6DD` | warm 系の差別化(メディア・お知らせ) |
| `--color-mirai-surface-gray` | `#F6F6F6` | テーブル偶数行 |

#### Border(ボーダーの階層)

| トークン | hex | 用途 |
|---|---|---|
| `--color-mirai-border` | `#D2D2D2` | 既定ボーダー |
| `--color-mirai-border-light` | `#B1B1B1` | 強調ボーダー(focus 候補) |
| `--color-mirai-border-muted` | `#BEBCBC` | 区切り線(horizontal rule) |

#### Stance(賛成・反対・中立)

みらい議会のような「意見の立場」を扱うときの専用配色。色だけで意味を伝えないために、必ずアイコンと文言を併用する([`06-accessibility.md`](06-accessibility.md))。

| トークン | hex | 用途 |
|---|---|---|
| `--color-stance-for-bg` | `#ECFCF1` | 賛成バッジ／カード背景 |
| `--color-stance-for-badge-start` | `#E2F6F3` | 賛成バッジのグラデ start |
| `--color-stance-for-badge-end` | `#EEF6E2` | 賛成バッジのグラデ end |
| `--color-stance-against` | `#C9272A` | 反対カラー(文字・アイコン) |
| `--color-stance-against-light` | `#D23C3F` | 反対 hover |
| `--color-stance-against-bg` | `#FFF1F1` | 反対バッジ背景 |
| `--color-stance-against-badge-bg` | `#FFEAEA` | 反対バッジ強調背景 |
| `--color-stance-neutral` | `#805F34` | 中立(茶系)の文字色 |
| `--color-stance-neutral-badge-bg` | `#F7E8DB` | 中立バッジ背景 |

#### Reaction(リアクション)

| トークン | hex | 用途 |
|---|---|---|
| `--color-mirai-reaction-active` | `#DD425F` | リアクション選択中(赤系ピンク) |
| `--color-mirai-reaction-inactive` | `var(--color-mirai-text-muted)` | 未選択リアクション |

#### Accent(強調・タグ)

| トークン | hex | 用途 |
|---|---|---|
| `--color-mirai-star` | `#FF9500` | ⭐ お気に入り・推奨 |
| `--color-mirai-highlight` | `#F4FF5F` | 蛍光イエロー(重要箇所のハイライト) |
| `--color-mirai-badge-yellow` | `#FFFD96` | バッジ用の薄イエロー |
| `--color-mirai-info-blue` | `#B2D3E8` | 情報バッジの薄ブルー |

#### Progress(プログレスバー)

| トークン | hex | 用途 |
|---|---|---|
| `--color-mirai-progress-track` | `#D9D9D9` | プログレスバーの track(未進捗部分) |
| `--color-mirai-progress-fill` | `#A9E89D` | プログレスバーの fill(進捗部分) |

### 2.1.3 グラデーション(CTA / hero)

ちみらしさの **視覚的アンカー**。1 画面に 1 箇所だけ使う(複数使うと装飾過多になりノイズ)。

| クラス | 値 | 用途 |
|---|---|---|
| `bg-mirai-gradient` | `linear-gradient(to bottom right, #64D8C6, #BCECD3)` | プライマリ CTA(`<Button variant="default">`)、hero badge |
| `bg-mirai-light-gradient` | `linear-gradient(to bottom, #E2F6F3, #EEF6E2)` | 軽量グラデ。hero 背景や card 背景の柔らかい差別化に |
| `bg-mirai-white-fade` | `linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgb(255,255,255) 62%)` | 画像 → 白フェード遷移 |
| `border-mirai-gradient` | 逆斜め `#BCECD3 → #64D8C6` のグラデボーダー | カードに装飾的ボーダーが欲しいとき(多用しない) |

グラデの endpoints は `--color-mirai-gradient-start: #64D8C6` / `--color-mirai-gradient-end: #BCECD3` として CSS 変数化されているので、新ユーティリティ追加もしやすい。

### 2.1.4 Sidebar 専用トークン

サイドバー内では `--sidebar-*` を使う(通常の `--background` 等とは別系統)。

| トークン |
|---|
| `--sidebar` / `--color-sidebar` |
| `--sidebar-foreground` / `--color-sidebar-foreground` |
| `--sidebar-primary` / `--color-sidebar-primary` |
| `--sidebar-primary-foreground` / `--color-sidebar-primary-foreground` |
| `--sidebar-accent` / `--color-sidebar-accent` |
| `--sidebar-accent-foreground` / `--color-sidebar-accent-foreground` |
| `--sidebar-border` / `--color-sidebar-border` |
| `--sidebar-ring` / `--color-sidebar-ring` |

Tailwind クラスは `bg-sidebar` / `text-sidebar-foreground` / `bg-sidebar-primary` / `bg-sidebar-accent` / `border-sidebar-border` のように `mirai-` プリフィックスなしで使う。

> [!NOTE]
> なぜ別系統？ → サイドバーはページの一部だが「常時表示の操作領域」として独立した視覚言語を持たせたい。`--background` を変えるとページ本体も変わってしまうため、サイドバーだけ色を調整できるように分けている。shadcn の標準仕様。

### 2.1.5 Chart 用カラー

`recharts` などの可視化用に 5 色。あえて高彩度を避けてある(チームみらいのデータ可視化は煽らない方針)。

```css
--chart-1: oklch(0.646 0.222 41.116);  /* オレンジ系 */
--chart-2: oklch(0.6 0.118 184.704);   /* ティール系 */
--chart-3: oklch(0.398 0.07 227.392);  /* ブルー系(暗め) */
--chart-4: oklch(0.828 0.189 84.429);  /* イエロー系 */
--chart-5: oklch(0.769 0.188 70.08);   /* イエローオレンジ */
```

複数系列のチャートでは `--chart-1` から順に当てる。色の意味(賛成・反対)が必要な場合は `--color-stance-*` を直接使う。

### 2.1.6 marumie 旧命名との対応

`marumie/webapp` は **旧 Figma DS の命名規則** で書かれている。将来的に `--color-mirai-*` 系に寄せる方針だが、当面は併存する。

| marumie 旧命名 | mirai 系 |
|---|---|
| `--color-black-500` (`#85868E`) | `--color-mirai-text-muted` (`#8E8E93`) に近い |
| `--color-black-600` (`#6B7280`) | (対応なし) |
| `--color-black-800` (`#1F2937`) | `--color-mirai-text` (`#1F2937`) |
| `--color-black-900` (`#000000`) | (対応なし、真っ黒は使わない) |
| `--color-primary-500` (`#2AA693`) | `--primary` (`#2AA693`) |
| `--color-primary-400` (`#30BCA7`) | (対応なし、hover 用) |
| `--color-primary-600` (`#238778`) | `--primary-accent` (`#0F8472`) に近いが値が違う |
| `--color-danger-500` (`#EF4444`) / `--color-danger-600` (`#DC2626`) | `--destructive` (`#DC2626`) |

新規プロダクトでは **`--color-mirai-*` / shadcn 標準系を使う**。marumie 風命名は将来移行対象。

---

## 2.2 タイポグラフィ

### 2.2.1 フォントファミリー

#### 日本語本文・見出し(Web アプリ)

```ts
// Next.js layout.tsx の標準セットアップ
import { Noto_Sans_JP, Lexend_Giga } from "next/font/google";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

const lexendGiga = Lexend_Giga({
  variable: "--font-lexend-giga",
  weight: ["400", "500", "700", "800", "900"],
  subsets: ["latin"],
});

// html / body には variable を当てて、tailwind 側で font-sans に解決させる
// globals.css 側: --font-sans: var(--font-noto-sans-jp);
```

| 用途 | フォント | 備考 |
|---|---|---|
| 日本語本文・見出し | **Noto Sans JP** | Google Fonts。weight 400/500/700 の 3 段階で十分 |
| アクセント英字(数字・ロゴ周辺) | **Lexend Giga** | mirai-gikai 標準。「Lexend がかわいいです」by 山根([Slack 2026-05-07](https://team-mirai-staff.slack.com/archives/C0AF339V3CZ/p1778659270636029)) |
| 紙物・スライド | `Zen Kaku Gothic New` | Web では使わない |

#### Figma Make 書き出し系(Hiragino 経路)

Figma Make が `Publish Library > Export to Figma Make` で書き出すコードを使う場合、フォントスタックは必ず下記:

```css
font-family: "Hiragino Sans", "Hiragino Kaku Gothic Std", "Noto Sans JP", sans-serif;
```

**`Hiragino Sans` を先頭** にする理由(重要):

- `Hiragino Kaku Gothic Std` は PostScript 名のフォントで、ウェイトが **W3(≒300)と W8(≒800)の 2 段階しか持たない**
- CSS Font Matching Algorithm([W3C](https://www.w3.org/TR/css-fonts-4/#font-style-matching))の解決順序によって `font-weight: 400` / `500` が **W8 に解決される現象** が macOS / Chrome で発生する
- 結果として `font-weight: 400`(Regular)のはずの本文が **ExtraBold 相当** で表示される
- `Hiragino Sans`(W1〜W9 の 9 ウェイト完備)を先頭に置けば全 weight が正しく解決される

詳細は jujunjun110 さんの調査メモ([Slack 2026-04-13](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC/p1774076018849129?thread_ts=1773623258.419589))参照。

### 2.2.2 サイズ階層

Tailwind デフォルトの `text-*` クラスを使ってよい。**同じテキスト要素にサイズ系クラスを複数当てない**(`text-2xl text-lg` のような重複指定は避ける)。

| 役割 | クラス例 | 値 | 用途 |
|---|---|---|---|
| 画面タイトル H1 | `text-2xl font-bold leading-tight` | 24px / 700 / 1.25 | ページタイトル |
| セクション H2 | `text-xl font-semibold` | 20px / 600 | カード見出し |
| サブ見出し H3 | `text-base font-semibold` | 16px / 600 | サブセクション |
| Body | `text-sm leading-relaxed` | 14px / 1.875 | 本文(標準) |
| Caption | `text-xs text-muted-foreground` | 12px / 400 | 補足・メタ |
| Code | `font-mono text-xs` | 12px monospace | コード断片 |

> [!IMPORTANT]
> **行間**: 日本語本文には `leading-relaxed`(= `1.875`)を当てる。`mirai-gikai/web` の `:root` で `--leading-relaxed: 1.875` を上書きして CJK 向けに広げている。`leading-none` を本文に使うのは禁止。

### 2.2.3 字間(letter-spacing)

特に指定しない(Tailwind デフォルト = `0`)。**和文に `tracking-wider` 等の正の字間は当てない**(字間が広い和文は読みづらい)。

### 2.2.4 「`<h1>` 自動スタイル」と「Tailwind クラス」の混在を避ける

jujunjun110 さんの叩き台([Slack 2026-04-08](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC/p1773989547630149?thread_ts=1773623258.419589))で議論された通り、`@layer base` で `<h1>`〜`<h4>` `<p>` `<label>` 等にデフォルトスタイルが当たっている場合、**手動でフォント系クラスを付けると二重定義になる**。

ルール:

- グローバルに `@layer base` で要素に font-size / weight を当てている場合、`<h1>` を使ったら追加クラスを当てない
- どうしてもサイズ変えたい場合は専用クラス(`.h1` `.h2` のような)を定義する
- 現在の `mirai-gikai/web/src/app/globals.css` は `@layer base` で `border-border` `outline-ring/50` 以外の要素規定は **当てていない** ので、見出しに Tailwind クラスを当てる現状運用で問題ない。**プロダクト初期化時にどちらの方針を取るか決めて固定する**

### 2.2.5 数字の表示

- **大きい数字(金額・カウント)には `Lexend Giga` の `font-medium` (500) を当てる**
- 桁区切りは `Intl.NumberFormat("ja-JP")` で(`,` 区切り)
- 単位(円・件・人)は数字より 1 段小さい字で隣に置く

---

## 2.3 スペーシング・角丸・影

### 2.3.1 スペーシング — 4px グリッド

すべての余白を **4 の倍数** で統一する：`4 / 8 / 12 / 16 / 24 / 32 / 48`。Tailwind の `gap-2`(8px)、`p-4`(16px)、`mt-6`(24px)のような `0.25rem` 刻みのクラスをそのまま使う。

| 場面 | 推奨 |
|---|---|
| カード内パディング | `p-6`(24px)。`Card` の既定。狭くしない |
| カード間 gap | `gap-4`(16px)または `gap-6`(24px) |
| セクション間 | `mt-8`(32px)または `mt-12`(48px) |
| ボタン内パディング | size による(`size="default"` で `px-4`、`size="sm"` で `px-3`) |
| フォーム要素間 | `gap-4`(16px) |
| ラベルとフィールド | `gap-1.5`(6px)または `gap-2`(8px) |
| アイコンとテキスト | `gap-2`(8px)または `gap-1.5`(6px) |

**避ける**: `p-5`(20px)/ `p-7`(28px)/ `gap-5`(20px)のような中途半端な値。1 つでも 4px グリッドから外れると、複数コンポーネントの組み合わせ時に揃わなくなる。

### 2.3.2 角丸 — 用途別に固定

| 要素 | クラス | 値 | 補足 |
|---|---|---|---|
| ピル型ボタン・タグ | `rounded-full` | 9999px | プライマリ CTA はこれ |
| ボタン(square 系) | `rounded-md` | 6px | shadcn の `--radius-md` |
| カード | `rounded-xl` | 12px | `Card` 既定 |
| ダイアログ | `rounded-3xl` | 24px | `<Dialog>` の DialogContent はこれ |
| 入力フィールド | `rounded-md` | 6px | `Input` `Textarea` 既定 |
| バッジ | `rounded-md` | 6px | `Badge` 既定 |
| アバター | `rounded-full` | 9999px | `Avatar` 既定 |

> [!IMPORTANT]
> **`rounded-2xl` 以上を一般要素に使わない**。とくに `marumie/admin` の Figma Make 経由コードでは `rounded-xl` が `--radius-button: 40px` にマッピングされているケースがあり、書き出しコードをそのままコミットすると見た目がかなり丸くなる。**`rounded-xl` を見たら必ず意図を確認し、一般要素なら `rounded-md` に直す**。

`globals.css` 側の定義:

```css
--radius: 0.625rem;             /* 10px。すべての --radius-* のベース */
--radius-sm: calc(var(--radius) - 4px);   /* 6px */
--radius-md: calc(var(--radius) - 2px);   /* 8px */
--radius-lg: var(--radius);                /* 10px */
--radius-xl: calc(var(--radius) + 4px);    /* 14px */
```

Tailwind の `rounded-md` は `--radius-md` を参照するので、上の定義により `rounded-md` = 8px となる(実値はプロダクト側の `--radius` 設定次第)。

### 2.3.3 影 — 軽く、目的を持って

| クラス | 用途 |
|---|---|
| `shadow-xs` | ボタン・入力フィールドの控えめなリフト |
| `shadow-sm` | カードの最小限の浮き |
| `shadow-md` | ホバー時のリフト、選択中のカード |
| `shadow-lg` | ダイアログ(DialogContent 既定) |
| `shadow-xl` 以上 | 使わない |

`shadow-md` 以上はインタラクションがあるときだけ。装飾目的の浮き上がりは避ける。

### 2.3.4 モーション(アニメーション)

#### 既定アニメーション

`mirai-gikai/web` で定義されているカスタムアニメーション 3 種:

```css
@keyframes shake { /* 0%/100% translateX(0); 20%/60% -1px; 40%/80% 1px; */ }
.animate-shake          { animation: shake 0.4s ease-in-out; }   /* 入力エラー時 */

@keyframes bounce-gentle { /* 50% translateY(5px) */ }
.animate-bounce-gentle  { animation: bounce-gentle 2s ease-in-out infinite; } /* 注目させたい要素 */

@keyframes fade-in       { /* opacity 0→1, translateY 4px→0 */ }
.animate-fade-in        { animation: fade-in 0.3s ease-out forwards; }       /* モーダル登場・新規アイテム */
```

#### 鉄則

- **`transition: all` 禁止**。`transition-colors`・`transition-opacity`・`transition-[color,box-shadow]` のように特定プロパティを名指しする
- duration は **200ms か 300ms** のどちらか。それ以上は鈍重に感じる
- easing は `ease-out` または `ease-in-out`。`ease-in` 単体は使わない
- **prefers-reduced-motion を尊重する**：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

---

## 2.4 ブレイクポイント

`mirai-gikai/web` の `@theme inline` で定義されているブレイクポイントに揃える:

```css
--breakpoint-sm: 500px;    /* スマホ縦 */
--breakpoint-md: 700px;    /* タブレット縦 */
--breakpoint-pc: 1000px;   /* PC 標準 */
--breakpoint-pcl: 1400px;  /* 大画面 PC */
```

Tailwind の `sm:` / `md:` / `pc:` / `pcl:` プレフィックスがそれぞれ対応する。

> [!NOTE]
> shadcn 標準は `sm: 640px / md: 768px / lg: 1024px / xl: 1280px / 2xl: 1536px`。**ちみは独自値で運用** している(スマホ縦の最大幅が 500px、タブレット縦が 700px と日本のスマホ実機サイズに寄せている)。

### モバイルでの sidebar 切替

- `width < 768px`：サイドバーを `<Sheet>`(shadcn のドロワー)に置換
- `width ≥ 768px`：サイドバー幅 260px を固定で常時表示
- メインコンテンツの最大幅は `~1200px`(コンテンツ密度が高いダッシュボードは無し、記事系は `max-w-3xl` 〜 `max-w-prose`)

---

## 2.5 z-index 階層

shadcn の `@radix-ui/react-*` 系は内部で `z-50` を多用する。プロジェクト側ではそれより上の階層を増やすときに段階を切る:

```
z-0    通常コンテンツ
z-10   ヘッダー固定要素
z-20   ナビゲーション overlay
z-30   sticky な要素
z-40   ドロップダウン
z-50   モーダル・ダイアログ(shadcn 既定)
z-60   トースト(sonner 既定)
```

`z-[9999]` のような暴力的な値は **絶対に書かない**。階層を上げたい場合は既存の段階のどこに収まるか考えて当てる。

---

## 2.6 トークン追加のフロー(新色が必要になったとき)

1. **本当に新色が必要か？** 既存の `--color-mirai-text-muted` を 1 段濃くしたいだけなら、新色を増やすより既存トークンに寄せられないか検討する
2. 必要なら命名する：`--color-mirai-<カテゴリ>-<バリアント>` の規則に従う
   - カテゴリ: `text` / `surface` / `border` / `stance` / `reaction` / `progress` / `gradient` / `accent`
   - バリアント: `light` / `muted` / `secondary` / 色名 / 用途名
3. `globals.css` の `@theme inline` ブロックに追加(順序は既存カテゴリの末尾)
4. **`@theme inline` の対応エイリアスも追加**：`--color-mirai-foo: var(--color-mirai-foo);` のような変換は不要(直接 hex を書く)
5. PR を切って `#3_開発本部_デザイン` でレビュー
6. マージ後、`templates/globals.css` に同期する PR を本ハンドブックリポジトリにも切る

---

## 関連ページ

- [`../templates/globals.css`](../templates/globals.css) — そのままコピペできる完全版
- [`03-components.md`](03-components.md) — トークンをコンポーネントでどう使うか
- [`08-antipatterns.md`](08-antipatterns.md) — arbitrary value など禁止リスト
- [`01-philosophy.md` 原則 1〜3](01-philosophy.md) — なぜトークンに固執するのか
