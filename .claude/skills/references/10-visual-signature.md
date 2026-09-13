# 10. 視覚的指紋(Visual Signature)— 3 プロダクトを並列で見る

これはチームみらいの 3 プロダクト(みらい議会 `mirai-gikai/web` / みらいまる見え政治資金 `marumie/webapp` / アクションボード `team-mirai-volunteer/action-board`)の *実装コードから抽出した「見た目の指紋」* である。

新規プロダクトを 0 から作るとき、または既存プロダクトに新規ページを足すとき、*以下の指紋が「見えなければ」失敗*している。逆に、これらが全て揃っていれば「ちみらしい」と認識される。

このファイルを書いた目的: *AI コーディングエージェントが「無難な shadcn デフォルト(AI Slop)」に流れるのを物理的に防ぐ*。指紋が言語化されていないと、AI は judgement call で「Inter / 紫グラデ / slate / shadow-lg」のような業界標準に寄ってしまう。

---

## §1 フォントの指紋

3 プロダクト全てが Google Fonts の `Noto Sans JP` を `<html>` レベルで指定する。

| プロダクト | 一次フォント | 二次フォント | 設定ファイル |
|---|---|---|---|
| mirai-gikai/web | `Noto Sans JP` (400, 500, 700) | `Lexend Giga` (400, 500, 700, 800, 900) — 英数の見出し用 | [`web/src/app/layout.tsx`](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/app/layout.tsx) |
| marumie/webapp | `Noto Sans JP` (400, 500, 700, 900) | `Noto Sans` / `Geist` / `Geist_Mono` / `Inter`(補助用) | [`webapp/src/app/layout.tsx`](https://github.com/team-mirai/marumie/blob/develop/webapp/src/app/layout.tsx) |
| action-board | `Noto Sans JP` | fallback: `Hiragino Kaku Gothic ProN`, `Yu Gothic`, `Meiryo` | [`src/app/globals.css`](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/app/globals.css) |

*ルール*:
- `<html>` または `<body>` の className に `var(--font-noto-sans-jp)` が必ず入る
- Inter / Roboto / Arial / Helvetica / system-ui / Geist を UI 本体(ヘッダー・カード・本文・ボタン)に当てない
- 和文は `font-medium` (500) もしくは `font-normal` (400) を基本にし、`font-light` (300) で書かない(ひらがな・カタカナが細くなって視認性が落ちる)
- 見出しは `font-bold` (700)。`font-extrabold` (800) や `font-black` (900) は使いどころを絞る(action-board の `h1〜h6` のみ)

*なぜこのルール？*:
- 山根さんが Slack で繰り返している「文字組みのクオリティに妥協しない」原則の具体形。Noto Sans JP は字形の和欧バランスが整っており、3 プロダクトで同じ印象が出る
- 過去に `Hiragino Kaku Gothic Std` を先頭にしたら W3/W8 しか持たない端末で `font-weight: 400` が `800` に解決される事故があった([`#3_開発本部_デザイン`](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC) の jujunjun110 さんによる調査)。Google Fonts の `Noto Sans JP` は全ウェイトをサーバから配るので、この問題が原理的に起きない

---

## §2 カラーパレットの指紋

3 プロダクト全てが以下のコアパレットを共有する:

```
Primary (CTA / link / active):  #2AA693  ← チームみらい teal
Primary accent (見出し強調):     #0F8472
Gradient (hero / 強調 CTA):      linear-gradient(to bottom right, #64D8C6, #BCECD3)
Background (warm gray):          #F7F4EE  (gikai) / #E2F6F3 → #EEF6E2 (marumie の薄ティールグラデ) / #F7F2EE (action-board)
Card (白):                       #FFFFFF
Text (本文):                     #1F2937
Text (補助):                     #8E8E93
Border:                          #D2D2D2
Destructive:                     #DC2626 / #EF4444
```

*ルール*:
- 主色は `#2AA693`。他のティール(`#26A69A` `#2BA694` `#30BAA7` `#30BCA7` など揺れがあるが、これは Figma library の整理待ち)
- グラデーションは *1 種類のみ* (`bg-mirai-gradient`)。紫・青・ピンク・3 色以上・放射状は全部禁止
- 背景は warm gray か薄ティール。`bg-white` を全画面背景にするのは、純粋な記事 page など特殊用途のみ
- `slate-*` / `zinc-*` / `stone-*` / `gray-*` Tailwind 標準パレットを主要色に使わない。cool gray は「ありがちな SaaS」の典型 AI Slop

*なぜこのルール？*:
- 公式サイト `team-mir.ai` のブランドガイドラインで定義された `#2AA693` を起源にしている
- グラデを 1 種類に絞るのは、ユーザーに「これがチームみらいだ」と認識させる視覚的フックを単一化するため。複数のグラデを並べると「色々な色を試した結果」に見える

完全なトークン定義は [`02-tokens.md`](02-tokens.md)、3 プロダクトの `globals.css` の写経素材は [`../templates/globals.css`](../templates/globals.css)。

---

## §3 ボタンの指紋

3 プロダクト全てで *プライマリ CTA* は以下の組み合わせ:

```
形状: ピル型 (rounded-full)
背景: bg-mirai-gradient (#64D8C6 → #BCECD3 の対角グラデ)
ボーダー: border border-black(1px の黒)
文字: text-gray-800 か text-black、font-bold
hover: opacity-90 か brightness 微変化
```

```tsx
// mirai-gikai/web の Button variant="default" の cva 抜粋
"border border-black bg-mirai-gradient text-black shadow-xs hover:opacity-90"

// action-board の Button variant="default" の cva 抜粋
"bg-mirai-gradient text-gray-800 border border-black hover:opacity-90"
```

*ルール*:
- 「色付き背景 + 白文字」の shadcn 標準パターンは禁止(`bg-primary text-primary-foreground` のままでは別物)
- 黒ボーダーは 1px。`border-2` 以上にしない
- 角丸は `rounded-full`(ピル)。他の角丸(`rounded-md` `rounded-lg`)は使わない
- ホバーは `opacity-90` で *色を変えない*(グラデは保持)

*セカンダリ*: `border border-black bg-white hover:bg-gray-50` で同じピル形状。アイコン付きの場合は `<Image>` + `lucide` の組み合わせも OK(gikai の `link-button.tsx` 参照)。

完全な cva 実装は [`03-components.md`](03-components.md) と [`../examples/button.tsx`](../examples/button.tsx)。

---

## §4 カードの指紋

3 プロダクト共通:

```
背景: bg-white (#FFFFFF)
角丸: rounded-xl (12px) / rounded-2xl (16px) / rounded-3xl (24px) のいずれか
ボーダー: 1px の控えめなボーダー (border-mirai-border か border-black か border-border)
影: shadow-xs か shadow-soft(gikai の utility)か影なし
パディング: p-6 〜 p-12 の範囲(密度で選ぶ)
```

*ルール*:
- `shadow-2xl` / `shadow-xl` のリッチな影は禁止。`shadow-lg` も控える
- 角丸は trio で固定(`rounded-xl` / `rounded-2xl` / `rounded-3xl`)。中間値の arbitrary `rounded-[20px]` `rounded-[18px]` は marumie の MainColumnCard のような既存パターン以外は避ける
- ヘッダー領域がある場合(タイトル + メタ)は `flex flex-col gap-3` で縦並び、本文は `text-sm` か `text-[15px]`
- カードに画像がある場合、画像は `aspect-video` または固定高 (`h-52` / `h-65`) + `object-cover` で

*なぜこのルール？*:
- 「シンプル主義」原則。影が濃いと「リッチな SaaS」に見え、政治・公共領域の信頼性とトーンが合わない
- 角丸 trio で固定するのは、3 プロダクト間で同じ感触を出すため

完全実装は [`../examples/card.tsx`](../examples/card.tsx) と [`11-page-templates.md`](11-page-templates.md)。

---

## §5 ヘッダーの指紋

| プロダクト | パターン |
|---|---|
| mirai-gikai/web | シンプルな絶対配置(hero に被せる)。ロゴと最小ナビ |
| marumie/webapp | *固定ヘッダーの白い rounded box*(`fixed top-0 left-0 right-0 px-2.5 py-3 xl:px-6 xl:py-4` 外 + `bg-white rounded-[20px] px-3 py-3` 内)。ロゴ画像 + 横ナビ + organization セレクタ |
| action-board | *スティッキーヘッダー*(`sticky top-4 z-50 h-16` + `bg-white border-b-foreground/10 mx-4 rounded-2xl`)。ロゴ + 「アクションボード」テキスト + メニュー |

共通点:
- ヘッダー *自体* は白背景の rounded box(`rounded-2xl` か `rounded-[20px]`)になっており、warm gray の body 背景に浮いている
- ロゴは Image コンポーネントで SVG / PNG を表示。テキストとしてのブランド名は併記しない(または小さく)
- z-index は 40〜50 で fixed/sticky

*ルール*:
- ヘッダー高さは 48〜72px の範囲
- 白い rounded ヘッダーを採用する場合、ヘッダー外側の余白(`px-2.5` `mx-4` 等)を必ず取って「浮いている」見た目にする
- ヘッダー内部に複数色のボタンを並べない。CTA は最大 1 つ
- モバイルでは `<DropdownMenu>` か `<Sheet>` で折りたたむ

[`marumie/webapp の HeaderClient.tsx`](https://github.com/team-mirai/marumie/blob/develop/webapp/src/client/components/layout/header/HeaderClient.tsx) と [`action-board の navbar.tsx`](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/components/common/navbar.tsx) を写経対象にする。`examples/header.tsx` にも雛形を置いている。

---

## §6 Hero の指紋

3 プロダクトで顕著にトーンが揃う:

| プロダクト | パターン |
|---|---|
| mirai-gikai/web | フル画面画像(国会議事堂)+ 下部のキャッチコピー + Lexend で `Scroll` インジケーター |
| marumie/webapp | グラデーション背景 (`#E2F6F3 → #EEF6E2` の 135deg) 上にロゴ + 集計サマリ |
| action-board | *ロゴ画像中央配置* + `bg-mirai-gradient` (135deg) + 「アクションボード」h1 + サブコピー + outline ピルボタン |

共通点:
- ヒーローの高さは `min-h-[400px]` 〜 `h-[740px]` の範囲、モバイルでは縮める
- 中央寄せ(`max-w-4xl mx-auto text-center`)が基本
- メインのコピーは `text-2xl md:text-4xl font-bold` 程度。長文にしない
- CTA は最大 2 つ(プライマリ + リンク的セカンダリ)

*ルール*:
- Hero に背景画像を使う場合、画像の上に半透明オーバーレイを置く(テキストの可読性確保)
- グラデ Hero の場合は `bg-mirai-gradient` または `bg-gradient-hero` のいずれかを使い、他のグラデは使わない
- Hero 内のロゴ画像は `priority` を付けて優先ロード

[`mirai-gikai の hero.tsx`](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/components/top/hero.tsx) と [`action-board の hero.tsx`](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/components/top/hero.tsx) を比較すると典型パターンが見える。

---

## §7 タイポグラフィの指紋(文字組み詳細)

```
h1: text-4xl md:text-4xl font-bold tracking-normal (36px / 36px / bold / トラッキング詰めない)
h2: text-[22px] font-bold leading-[1.48] tracking-normal (22px / bold / line-height 32px)
h2 (display): text-2xl/8 (24px / line-height 32px)
h3: text-2xl font-bold leading-[43.2px] (24px / bold / 行間広め)
body: text-[15px] leading-[28px] text-mirai-text (15px / 28px / dark)
body small: text-sm leading-relaxed (14px / 1.625)
meta: text-xs font-medium text-mirai-text-muted (12px / 500 / muted)
button: text-sm font-bold (14px / bold)
caption: text-xs font-medium leading-[1.67]
```

*ルール*:
- 本文は `text-[15px] leading-[28px]` がベース(gikai の About / TeamMirai 参照)
- `tracking-normal`(トラッキング詰めない)が基本。日本語は字間を詰めると読みづらい
- 見出しは `font-bold`(700)。`font-extrabold`(800)以上は `<h1>` の最重要見出しのみ
- 行間は `leading-relaxed` (1.875) もしくは `leading-[28px]` 程度。`leading-tight` は見出しのみ

`globals.css` の `--leading-relaxed: 1.875;` が gikai 側で定義されている(`:root` 直下)。

---

## §8 スペーシング・密度の指紋

- セクション間: `py-10` 〜 `py-16`、モバイル/PC で `md:py-16` のように切替
- カード並び内: `flex flex-col gap-4`(縦)または `grid gap-4` (横)
- カード内部: `p-6` 〜 `p-12`
- 標準コンテンツ幅: `max-w-4xl mx-auto px-4 sm:px-6 lg:px-8`(gikai の `<Container>`)
- max-w-lg (32rem) / max-w-2xl (42rem) / max-w-4xl (56rem) / max-w-6xl (72rem) を主に使う

*ルール*:
- 4px の Tailwind スケールに乗る(`gap-2 = 8px`, `gap-4 = 16px`, `gap-6 = 24px`, `gap-8 = 32px`)
- arbitrary 値 (`gap-[15px]` `p-[18px]` 等) は Figma で明示的に指定されたときだけ
- セクションの内側パディングは画面幅で柔軟に(モバイル `px-4`、デスクトップ `px-8`)

---

## §9 アイコン・画像の指紋

- *アイコン*: `lucide-react` のみ。`Menu` `ChevronDown` `ChevronRight` `X` `Heart` `Star` などサイズは `size-4` (16px) / `size-5` (20px) / `size-6` (24px)
- *ブランドアイコン*: 公式 SVG (`/icons/team-mirai-typography.svg` `/icons/about-typography.svg`) を `Image` で配置。再描画しない
- *SNS アイコン*: 円形 (`rounded-full`) で 48x48px、`hover:opacity-70 transition-opacity`
- *イラスト*: SVG (`/img/hero-people.svg` `/img/hero-background.svg`) を `priority` で Hero に配置
- *写真*: `aspect-video` または `aspect-square` + `object-cover` + `priority`(above-the-fold のとき)

*ルール*:
- 絵文字の散布は禁止(🚀✨🎉 のような装飾的)
- ただし文脈固有の絵文字は OK: アクションボードの達成バッジ、gikai の「注目🔥」「powered by Team Mirai & AI」など
- 写真や動画には alt を必ず付ける

---

## §10 動き・アニメーションの指紋

gikai が `globals.css` で定義しているカスタムアニメ:

```css
.animate-shake          /* バリデーション失敗時 */
.animate-bounce-gentle  /* Scroll インジケーター(hero下) */
.animate-fade-in        /* 要素出現 */
```

*ルール*:
- アクセシビリティ目的のフォーカスリング(`focus-visible:ring-2`)以外は控えめに
- `transition-colors` `transition-opacity` `transition-transform` に絞る。`transition-all` は禁止(パフォーマンス)
- 過度なホバー演出(拡大 / 浮き上がり)は controller 系画面でのみ。本文・カード一覧では使わない
- スクロール連動アニメ(parallax 等)は使わない(モバイル端末で重くなる)

---

## §11 ライティング・トーンの指紋

3 プロダクトで一貫している:

- 党名表記: 「チームみらい」(ひらがな)。Team Mirai はロゴ画像内のみ
- ボタン: 命令形(「保存する」「公開する」「詳しく見る」「寄附で応援する」)
- 結果通知: 丁寧体(「申請を受け付けました」)
- AI ラベル: 「AIおすすめ順」「AI生成」「powered by Team Mirai & AI」のように責任の所在を明示
- 誇張禁止: 「リアルタイム」「即時」「最速」を使わない(オーバーコミットメントしない原則)

詳細は [`05-writing.md`](05-writing.md)。

---

## §12 「これが見えないと AI Slop」セルフチェック

新規 page / コンポーネントを生成した後、以下を 1 つずつ確認:

- [ ] フォントは `Noto Sans JP` か？(Inter / Roboto / Arial が紛れていないか)
- [ ] プライマリカラーは `#2AA693` か？(青すぎる / 緑すぎる teal でないか)
- [ ] グラデは `bg-mirai-gradient` 1 種類のみか？(紫・青・ピンク・3 色グラデが紛れていないか)
- [ ] 背景は warm gray (`#F7F4EE` 系) か薄ティールか？(`bg-white` 全画面 / `bg-slate-50` でないか)
- [ ] プライマリ CTA は「ピル + グラデ + 黒ボーダー + 黒文字」か？(shadcn デフォルトの色付き背景白文字でないか)
- [ ] カードの角丸は `rounded-xl/2xl/3xl` のいずれか？(中間値 arbitrary / 過大角丸でないか)
- [ ] シャドウは控えめか？(`shadow-2xl` / `shadow-lg` が乱用されていないか)
- [ ] 和文は `font-medium` か `font-normal`、見出しは `font-bold` か？(`font-light` が紛れていないか)
- [ ] アイコンは `lucide-react` のみか？(インライン SVG / 絵文字での代替がないか)
- [ ] 文字組みの行間は `leading-relaxed` か `leading-[28px]` ベースか？(`leading-tight` が本文に紛れていないか)

10 個中 *1 つでも ❌ があれば書き直し*。「8 個満たしてるからまあ OK」とは判断しない。視覚的指紋は all-or-nothing。

---

## §13 出典 — 一次情報の場所

このファイルは以下の実コードを *直接読んで*抽出した。判断に迷ったら直接 Read する。

- [mirai-gikai/web/src/app/globals.css](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/app/globals.css) — トークン定義の正典
- [mirai-gikai/web/src/app/layout.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/app/layout.tsx) — Noto Sans JP + Lexend Giga の設定
- [mirai-gikai/web/src/app/(main)/page.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/app/(main)/page.tsx) — トップページの構造
- [mirai-gikai/web/src/components/ui/button.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/components/ui/button.tsx) — Button cva の正典
- [mirai-gikai/web/src/components/top/hero.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/components/top/hero.tsx) — Hero パターン
- [mirai-gikai/AGENTS.md](https://github.com/team-mirai/mirai-gikai/blob/develop/AGENTS.md) — 既存運用ルール(インラインカラー禁止等)
- [marumie/webapp/src/app/globals.css](https://github.com/team-mirai/marumie/blob/develop/webapp/src/app/globals.css)
- [marumie/webapp/src/app/layout.tsx](https://github.com/team-mirai/marumie/blob/develop/webapp/src/app/layout.tsx)
- [marumie/webapp/src/client/components/layout/header/HeaderClient.tsx](https://github.com/team-mirai/marumie/blob/develop/webapp/src/client/components/layout/header/HeaderClient.tsx)
- [marumie/webapp/src/client/components/layout/MainColumnCard.tsx](https://github.com/team-mirai/marumie/blob/develop/webapp/src/client/components/layout/MainColumnCard.tsx)
- [marumie/webapp/src/client/components/ui/MainButton.tsx](https://github.com/team-mirai/marumie/blob/develop/webapp/src/client/components/ui/MainButton.tsx)
- [marumie/docs/admin-ui-guidelines.md](https://github.com/team-mirai/marumie/blob/develop/docs/admin-ui-guidelines.md)
- [action-board/src/app/globals.css](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/app/globals.css)
- [action-board/src/app/layout.tsx](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/app/layout.tsx)
- [action-board/src/app/home.tsx](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/app/home.tsx)
- [action-board/src/components/top/hero.tsx](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/components/top/hero.tsx)
- [action-board/src/components/common/navbar.tsx](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/components/common/navbar.tsx)
- [action-board/src/components/ui/button.tsx](https://github.com/team-mirai-volunteer/action-board/blob/develop/src/components/ui/button.tsx)
- [action-board/tailwind.config.ts](https://github.com/team-mirai-volunteer/action-board/blob/develop/tailwind.config.ts)
- [team-mirai 公式ブランドガイドライン Slides](https://docs.google.com/presentation/d/1l8IUi5cS281fnGB4ngIDnIjx6xE4wXE-z3CvGRmKFAo/edit) — `#2AA693` の起源
