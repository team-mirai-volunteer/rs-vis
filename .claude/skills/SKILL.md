---
name: mirai-design
description: チームみらいの Web プロダクトで「みらいらしい UI」を作るためのデザインシステム。みらい議会 (mirai-gikai) / みらいまる見え政治資金 (marumie) / アクションボード (action-board) と同じ視覚的トーンに揃えるための、トークン・実装パターン・禁止事項・完全な page テンプレート群。Web の UI を実装する／既存 UI を直す／Figma URL から実装する／配色やフォントを選ぶ／`globals.css` を編集する／「みらいっぽく」「ちみのデザインで」「3 プロダクトと揃えて」と言われた場合に必ずこの skill を読み込むこと。読み飛ばすと shadcn デフォルト(Inter / 紫グラデ / slate / 浅い角丸)に寄り、3 プロダクトと似ても似つかない AI Slop が出る。
when_to_use: Next.js + Tailwind + shadcn 構成の Web で UI を実装するとき／ボタン・カード・フォーム・ダイアログ・トースト・サイドバー・ヘッダー・ヒーローを書くとき／配色・フォント・角丸・グラデーションを選ぶとき／Figma URL からコードに落とすとき／`globals.css` を新規作成するとき／「mirai-gikai / marumie / action-board と揃った見た目にしたい」と言われたとき／既存実装の UI レビューをするとき。
allowed-tools: Read Grep Glob Bash
---

# mirai-design — チームみらい Web プロダクト 視覚統一スキル

これからあなたはチームみらいの Web UI を実装する。
*真っ先にやるのは「みらいの視覚的指紋を頭に入れる」こと*。それを終えてから他のセクションを読む。

このファイルだけで 8 割の判断ができるよう設計してある。迷ったら `references/` を読みに行く。

---

## §0 みらいの視覚的指紋(Visual Signature)— 必ずこれが出ること

新規 page・新規コンポーネントを作るとき、生成物に *以下の 7 つの指紋がすべて見えなければ失敗*。失敗したら破棄してやり直す。

1. *フォントは `Noto Sans JP` (和文)と `Lexend Giga`(英文アクセント、任意)の 2 種類だけ*。`var(--font-noto-sans-jp)` で当てる。Inter / Roboto / Arial / Helvetica / system-ui / Geist は使わない
2. *プライマリカラーは `#2AA693`(チームみらいティール)*。CTA・active state・focus ring・link で使う。蛍光緑・濃緑・青緑には絶対に外さない
3. *メインのグラデーションは `linear-gradient(to bottom right, #64D8C6, #BCECD3)` (`bg-mirai-gradient`)の 1 種類だけ*。これを hero とプライマリ CTA に使う。紫・青・ピンクのグラデーション、3 色以上のグラデーション、放射状グラデーションは禁止
4. *背景は warm gray*。`#F7F4EE`〜`#F7F4F0`(gikai webの `--background`)または `#E2F6F3` 系の薄ティール(marumie のヒーロー背景)。`bg-white` / `bg-slate-50` / `bg-zinc-50` / `bg-gray-50` のような cool gray / 純白を全画面背景に使わない
5. *プライマリ CTA は「ピル型 (`rounded-full`) ＋ `bg-mirai-gradient` ＋ 黒 1px ボーダー ＋ 黒文字」*。これが mirai-gikai / action-board 共通の最重要シグネチャ。色付き背景 + 白文字の shadcn デフォルト Button は禁止
6. *カードは「白背景 ＋ `rounded-xl` (12px) または `rounded-2xl` (16px) または `rounded-3xl` (24px) ＋ 1px の控えめなボーダー」*。`shadow-2xl` / `shadow-lg` の濃い影、`rounded-[40px]` のような過大な角丸、ガラスっぽい backdrop-blur 飾りは禁止
7. *日本語の本文は `font-medium` (500) もしくは `font-normal` (400) ＋ `leading-relaxed` (1.875)*。`font-light` (300) は使わない(ひらがな・カタカナがか細くなって読みづらい)。見出しは `font-bold` (700) ＋ `tracking-normal` を基本にする

> [!IMPORTANT]
> *生成後の自己検証*: 上の 7 項目を 1 つずつチェックし「✅／❌」と判定。1 つでも ❌ があれば書き直す。これをやらないと AI Slop が混入する。

---

## §1 絶対に出してはいけないもの(Forbidden — AI Slop 禁止リスト)

AI コーディングエージェントが *何も指示しないと defaultで選びがちな選択肢*。チームみらいでは全て *禁止* する。理由付きで列挙する(explain-the-why パターン — 列挙された個別パターンだけでなく、同種のものすべてを避ける判断基準として使うこと)。

| ❌ 禁止 | 理由 |
|---|---|
| `Inter` / `Roboto` / `Arial` / `Helvetica` / `system-ui` / `Geist` などの欧文フォントをUI 本体に使う | 和文 UI なのに欧文フォントを指定すると、ブラウザの和文フォールバックがバラバラになり、3 プロダクトの「Noto Sans JP の柔らかな印象」が崩れる |
| 紫グラデ (`from-purple-* to-pink-*` など) / 青グラデ / 3 色以上のグラデ / 放射状グラデ | Hero と CTA で「みらいの teal グラデ」と競合する。これが出た瞬間に AI 生成物だと一目でバレる |
| `slate-*` / `zinc-*` / `gray-*` / `stone-*` の Tailwind 標準パレットを *主要色*として使う | 我々は warm gray (`#F7F4EE` 系) と独自トークン (`mirai-*`) を使う。cool gray のパレットは「ありがちな SaaS」の典型 |
| `bg-white` を全画面背景に使う / `body { background: white }` | 我々は `bg-background` = warm gray が基本。純白背景はカード・モーダル・ヘッダーの内部だけ |
| 色付き背景 + 白文字の shadcn 標準 `<Button variant="default">` | 我々の `default` variant は「グラデ + 黒文字 + 黒ボーダー」。shadcn デフォルトの `bg-primary text-primary-foreground` のままでは別物になる |
| `rounded-[40px]` 以上の過大な角丸を *ボタン*に使う | ピル型なら `rounded-full`、それ以下なら `rounded-xl/2xl/3xl` の trio に統一。中間値の arbitrary 角丸(`rounded-[40px]` `rounded-[18px]` 等)は禁止 |
| `shadow-2xl` / `shadow-lg` の濃い影を カード・ボタンに使う | 我々のシャドウは `shadow-xs` か `shadow-soft` 相当の控えめなもの。濃い影は「立体的でリッチに見せる SaaS LP」の典型 AI Slop |
| `backdrop-blur` のグラスモーフィズム飾り | 2020 年代前半のトレンドで、今は AI 生成物の典型。我々のデザインは flat |
| `font-light` (300) で和文を書く | ひらがなが細くなって視認性が落ちる。山根さんの「文字組みクオリティ」原則に反する |
| 過剰な絵文字を h1/h2 に並べる(🚀✨🎉 のような汎用絵文字) | アクションボードの「注目🔥」のような文脈固有の絵文字は OK だが、デコレーション目的の汎用絵文字は禁止 |
| `<button>` 生タグ / `<div onClick>` で擬似ボタン | 必ず `@/components/ui/button` の `<Button>` を使う。a11y とトークン適用が破綻する |
| インライン SVG / `<img>` をアイコンに使う | 必ず `lucide-react` から import。サイズ・色がトークン化されない |
| `text-[#xxx]` / `bg-[#xxx]` / `style={{ color: }}` で hex 直書き | 必ず `globals.css` のトークン経由で色を当てる |
| `transition-all` / `transition: all` | パフォーマンス問題。`transition-colors` `transition-opacity` `transition-transform` のように properties を絞る |
| `outline: none` をフォーカスから外す(`focus-visible` を残さず) | a11y 違反。`focus:outline-none focus-visible:ring-2` のセットでのみ使う |

これらは [`references/12-ai-slop-prevention.md`](references/12-ai-slop-prevention.md) で grep ベースの検出スクリプトつきで詳述している。

---

## §2 必ずやること(Commit To — みらいに寄せるための明示的コミット)

以下を *明示的に選択*する。「無難な選択」を取らない。山根さんが Slack で繰り返している「親切さ > 統一感 > 美しさ」「文字組みのクオリティに妥協しない」「オーバーコミットメントしない」の 3 原則を、見える形のルールに落としたもの。

| ✅ コミット | 具体 |
|---|---|
| *フォント* | 和文 `Noto Sans JP` / 英数の見出し強調に `Lexend Giga` (任意)。fallback は `-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif` |
| *色の主役* | `#2AA693`(primary)/ `#0F8472`(primary-accent、強調・見出し) |
| *色の脇役* | warm gray `#F7F4EE`(背景)/ `#FFFFFF`(カード)/ `#1F2937`(本文)/ `#8E8E93`(補助)/ `#D2D2D2`(ボーダー) |
| *グラデ* | `bg-mirai-gradient` = `linear-gradient(to bottom right, #64D8C6, #BCECD3)`。これ 1 種類だけを hero と一部 CTA で使う |
| *角丸 trio* | ピル `rounded-full` / カード `rounded-xl` (12px) - `rounded-2xl` (16px) / 強調モーダル `rounded-3xl` (24px) |
| *シャドウ* | 基本 `shadow-xs` 〜 `shadow-soft` のみ。濃い影は禁止 |
| *スペーシング* | Tailwind 標準の 4px スケール (`gap-4` `p-6` `py-10` 等)。arbitrary 値 (`gap-[15px]`) は最小限に |
| *レイアウト幅* | `max-w-4xl mx-auto px-4 sm:px-6 lg:px-8`(gikai の `Container` パターン)が基本コンテンツ幅 |
| *見出しの文字組み* | `text-2xl/8 tracking-normal font-bold`(24px / line-height 32px / トラッキング詰めない) |
| *本文の文字組み* | `text-[15px] leading-[28px] text-mirai-text font-normal`〜`font-medium`(15px / 行間 28px / 中肉) |
| *動き* | キーボードフォーカス時のみ `ring-2 ring-primary/40 ring-offset-2`。それ以外の動きは控えめに |
| *ロゴ運用* | チームみらい公式ロゴは [`assets/logos/`](assets/logos/) に同梱(`team-mirai-wordmark.svg` / `team-mirai-logo.png` / `team-mirai-logo-flat.png`)。LP・hero・ヘッダーではここからそのまま使い、再描画しない。選び方は [`assets/logos/README.md`](assets/logos/README.md) |
| *人物表示* | 個別の人に言及する UI は Slack アバター(円形)＋ イニシャル fallback を添える。アバター URL の出典は member directory。詳細は [`references/04-patterns.md`](references/04-patterns.md) §4.16 |

完全なトークン一覧は [`references/02-tokens.md`](references/02-tokens.md)、視覚的指紋の根拠は [`references/10-visual-signature.md`](references/10-visual-signature.md)。

---

## §3 鉄則(5 個だけ、explain-the-why)

ALWAYS/NEVER を強要すると edge case で誤適用するので、「なぜ」を 1 行で添えて *判断軸*として使えるようにする。

1. *色は CSS 変数経由で取り、Tailwind の arbitrary value (`text-[#xxx]`) は使わない*。
   → 全プロダクトで `--color-mirai-*` を共通化する設計のため。hex 直書きを許すと、後から「全プロダクトでブランドカラーを微調整」したときに `git grep` で漏れる。

2. *shadcn コンポーネントを最優先し、生 `<button>` / `<div>` でボタン・カードを作らない*。
   → トークン適用と a11y(フォーカスリング・disabled・aria)が `@/components/ui/*` に集約されている。自作すると 80% は揃うが、20% の細部(disabled の opacity、focus-visible のリング色)が必ずズレる。

3. *アイコンは `lucide-react` のみ。インライン SVG や絵文字での代替は禁止*。
   → lucide は stroke-width とサイズが揃っており、`size-4` `size-5` のクラスでスケールする。インライン SVG だと size と色のトークン化が破綻する。

4. *Figma URL を渡されたら、必ず `get_variable_defs` / `get_design_context` MCP ツールを呼んで生の数値を取る*。
   → スクリーンショットから推測すると `--primary` が `#2AA693` か `#2BA694` かでズレる。山根さんの Figma library とトークン名を 1:1 対応させるのが目的なので、推測は致命的。

5. *新規 page を書き始める前に必ず以下 3 ファイルを Read する*。
   → 現プロジェクトの `src/app/globals.css` の `@theme inline` ブロック / `src/components/ui/` のディレクトリリスト / プロジェクト直下の `AGENTS.md` か `CLAUDE.md` 。これをやらないと「ありがちな shadcn」が出てくる。

---

## §4 新規 page を作る 7 ステップ(必ずこの順番で)

```
1. プロジェクトの globals.css を Read(@theme inline ブロックを把握)
2. src/components/ui/ を ls(使える shadcn コンポーネント一覧を把握)
3. プロジェクト直下の AGENTS.md / CLAUDE.md を Read(追加のローカルルール)
4. references/11-page-templates.md から似た形のテンプレを選ぶ
   - ランディング系 → gikai-home パターン
   - ダッシュボード系 → marumie パターン
   - ゲーム性ある fed feed 系 → action-board パターン
5. テンプレを写経しつつトークン名を当該プロジェクトに合わせる
6. §0 の Visual Signature 7 項目をセルフチェック
7. §1 の Forbidden を grep でセルフチェック(references/12 の bash スクリプト)
```

これを *必ず順番に*実行する。1〜3 を飛ばすと、トークン名が違うのに気づかず arbitrary value で色を当てがちになる。

---

## §5 早見表 — トークン

| 用途 | クラス | hex |
|---|---|---|
| プライマリ(CTA・active・link) | `bg-primary` / `text-primary` | `#2AA693` |
| プライマリ強調(見出しアクセント) | `text-primary-accent` | `#0F8472` |
| 背景(warm gray) | `bg-background` | `#F7F4EE` |
| カード(白) | `bg-card` | `#FFFFFF` |
| 本文 | `text-foreground` / `text-mirai-text` | `#1F2937` |
| 補助テキスト | `text-mirai-text-muted` | `#8E8E93` |
| ボーダー | `border-mirai-border` | `#D2D2D2` |
| メイングラデ(hero・CTA) | `bg-mirai-gradient` | `linear-gradient(to bottom right, #64D8C6, #BCECD3)` |
| Hero 用 vertical グラデ | `bg-gradient-hero` (`linear-gradient(90deg, #64d8c6, #bcecd3)`) | action-board 風 |
| Destructive | `bg-destructive text-white` | `#DC2626` |
| Stance For (賛成) | `bg-stance-for-bg` | `#ECFCF1` |
| Stance Against (反対) | `text-stance-against` | `#C9272A` |
| Reaction (お気に入り) | `text-mirai-reaction-active` | `#DD425F` |
| Star (注目バッジ) | `bg-mirai-highlight` | `#F4FF5F` |

完全版は [`references/02-tokens.md`](references/02-tokens.md)。新規プロダクトは [`templates/globals.css`](templates/globals.css) をそのまま置けば 95% カバー。

---

## §6 早見表 — コンポーネント variant

| 用途 | コンポーネント | 必ず指定する variant |
|---|---|---|
| プライマリ CTA | `<Button>` | `variant="default"` — グラデ + 黒文字 + 黒ボーダー |
| セカンダリ | `<Button>` | `variant="outline"` — 白背景 + 黒ボーダー |
| 低重要度 | `<Button>` | `variant="ghost"` — 透明、hover で accent |
| テキストリンク | `<Button>` | `variant="link"` — primary 色 + underline |
| 破壊的(削除など) | `<Button>` | `variant="destructive"` |
| ステータスバッジ | `<Badge>` | gikai の場合は7種類、状況に応じて選ぶ |
| 注目強調 | 自作 | `bg-mirai-highlight text-mirai-text rounded-[20px] px-3 py-0.5 text-xs font-medium` |
| カード | `<Card>` `<CardHeader>` `<CardContent>` `<CardFooter>` | `rounded-xl border border-black` か `border-mirai-border` |
| 入力 | `<Input>` `<Textarea>` `<Select>` `<Switch>` | shadcn 標準のまま |
| モーダル | `<Dialog>` | `rounded-3xl max-w-lg` |
| ドロワー(モバイル sidebar) | `<Sheet>` | `<768px` で sidebar をこれに置換 |
| トースト | `import { toast } from "sonner"` | `toast.success` / `toast.error` のみ |
| ツールチップ | `<Tooltip>` | アイコンボタン使用時は必須 |

`<Button>` の cva 全文と他コンポーネント詳細は [`references/03-components.md`](references/03-components.md)。実装写経は [`examples/`](examples/)。

---

## §7 早見表 — レイアウト

| 要素 | パターン |
|---|---|
| 全体 body | `bg-background text-foreground font-sans antialiased` |
| 固定ヘッダー | 白背景 + `rounded-2xl` の浮島型(`fixed top-0 left-0 right-0 z-40 px-2.5 py-3` の外側 + `bg-white rounded-[20px]` の内側) |
| 標準コンテンツ幅 | `max-w-4xl mx-auto px-4 sm:px-6 lg:px-8`(`<Container>` 化推奨) |
| Hero | `bg-mirai-gradient` ベースの 70-80vh、ロゴ画像([`assets/logos/`](assets/logos/) の公式ロゴをそのまま配置) + 1 行コピー + サブコピー + CTA |
| セクション間スペース | `py-10` 〜 `py-16`。`md:py-16` でモバイル/PC 切替 |
| カード並び | `flex flex-col gap-4` または `grid grid-cols-1 md:grid-cols-2 gap-4` |
| フッター | dark gray (`bg-mirai-text` = `#1F2937`) + 白文字 + SNS アイコンを `rounded-full` で |

完全な page-level テンプレートは [`references/11-page-templates.md`](references/11-page-templates.md) と [`examples/home-page.tsx`](examples/home-page.tsx) を参照。

---

## §8 早見表 — ライティング

- *党名*: 「チームみらい」(ひらがな)。「チーム未来」「チームミライ」「Team Mirai」を本文に書かない(ロゴ画像内の Team Mirai はそのまま使ってよい)
- *ボタンは命令形*: 「保存する」「公開する」「詳しく見る」「寄附で応援する」。敬語の「保存してください」は使わない
- *結果通知は丁寧体*: 「申請を受け付けました」「保存できませんでした」
- *AI 出力ラベルは責任の所在を明示*: 「AIおすすめ順」「AI生成」「powered by Team Mirai & AI」。「リアルタイム」「即時」「最速」のような誇張は禁止(オーバーコミットメントしない原則)
- *エラーメッセージ*: 「原因 + 次の一手」のセットで。「ネットワークエラーが発生しました。再読み込みしてください」

詳細は [`references/05-writing.md`](references/05-writing.md)。

---

## §9 Figma → コード ワークフロー

```
1. Figma URL を受け取る
2. get_variable_defs / get_design_context MCP ツールを呼ぶ(必須)
3. 取得した hex / px / font name を、現プロジェクトの globals.css のトークンと突き合わせる
   - 完全一致 → 既存トークン名でクラスを当てる
   - 微妙に違う (≦5% の差) → 既存トークンに寄せる
   - 全く違う色 → globals.css にトークン追加 PR を先に作る
4. shadcn コンポーネントで構造を組む
5. アイコンは Figma スクショからトレースせず lucide-react で該当アイコンを検索
6. §0 Visual Signature 7 項目をセルフチェック
7. §1 Forbidden を grep でセルフチェック
8. Before/After スクリーンショット(モバイル + PC)を PR 本文に貼る
```

詳細プロトコル: [`references/07-figma-workflow.md`](references/07-figma-workflow.md)

---

## §10 PR 直前の grep セルフチェック

以下を実行して *0 件*であることを確認。1 件でもあれば直す。

```bash
# 1. arbitrary hex 検出
grep -rE '(text|bg|border|fill|stroke)-\[#' src/ && echo "❌ §3 鉄則1 違反: トークンを使う"

# 2. インラインスタイルで色
grep -rE 'style=\{\{[^}]*(color|background)' src/ && echo "❌ §3 鉄則1 違反"

# 3. 生 <button> タグ
grep -rE '<button(\s|>)' src/ && echo "❌ §3 鉄則2 違反: <Button> を使う"

# 4. インライン SVG
grep -rE '<svg(\s|>)' src/ | grep -v 'public/' && echo "❌ §3 鉄則3 違反: lucide-react を使う"

# 5. 禁止フォント
grep -rE 'font-(inter|roboto|arial|geist|helvetica)' src/ && echo "❌ §1 違反: Noto Sans JP を使う"

# 6. 禁止グラデ
grep -rE 'from-(purple|pink|blue|indigo|violet|fuchsia)-' src/ && echo "❌ §1 違反: bg-mirai-gradient を使う"

# 7. cool gray の主要使用
grep -rE 'bg-(slate|zinc|stone|gray)-(50|100)' src/ && echo "⚠️ §1 警告: warm gray に寄せる"

# 8. transition: all
grep -rE 'transition-all|transition: all' src/ && echo "❌ §1 違反: 個別 property に絞る"
```

全部入りの bash スクリプトと、各違反の修正例は [`references/12-ai-slop-prevention.md`](references/12-ai-slop-prevention.md) に置いてある。

---

## §11 プロダクト別の現状と「写経の出発点」

新規プロダクトを 0 から立ち上げるとき、*どれをクローン元にするか* の早見表。

| プロダクト | リポジトリ | 写経の出発点として | 特徴 |
|---|---|---|---|
| *みらい議会 (公開側)* | [`team-mirai/mirai-gikai`](https://github.com/team-mirai/mirai-gikai) `web/` | 🟢 *正典*(必ずここから始める) | `--color-mirai-*` トークン群が最も整備されている。`web/src/app/globals.css` を写経すれば 95% 揃う |
| *みらいまる見え政治資金* (公開側) | [`team-mirai/marumie`](https://github.com/team-mirai/marumie) `webapp/` | 🟡 ダッシュボード系で参考に | `bg-white` の rounded card on 薄ティールグラデ背景。Header の固定 rounded box |
| *みらいまる見え政治資金 (admin)* | 同上 `admin/` | 🟢 admin / 管理画面の正典 | shadcn Dark Blue 固定(明示的にダークモードで運用) |
| *アクションボード* | [`team-mirai-volunteer/action-board`](https://github.com/team-mirai-volunteer/action-board) | 🟡 ゲーム性ある画面の参考に | `bg-mirai-gradient` Hero がド派手。ピル button + 黒ボーダー + ロゴ画像中央配置 |
| *公式サイト* | `team-mir.ai` | カラーパレットの一次出典 | `#2AA693` の起源 |

詳細マッピングと「新規プロダクト立ち上げ手順」は [`references/09-product-status.md`](references/09-product-status.md)。

---

## §12 supporting files の使い分け

> [!IMPORTANT]
> このファイル(SKILL.md)で 8 割の判断ができるが、*以下のいずれかに該当したら必ず該当 reference を Read する*。

| いつ読む | ファイル |
|---|---|
| 哲学・原則の根拠を確認したい | [`references/01-philosophy.md`](references/01-philosophy.md) |
| トークンの命名・hex・用途で迷う | [`references/02-tokens.md`](references/02-tokens.md) |
| shadcn の variant をどう使うか迷う | [`references/03-components.md`](references/03-components.md) |
| 「空状態」「破壊的アクション」「ローディング」の作法を確認 | [`references/04-patterns.md`](references/04-patterns.md) |
| ボタン文言・エラー・ラベルで迷う | [`references/05-writing.md`](references/05-writing.md) |
| a11y(`aria-*` / フォーカス順序)で迷う | [`references/06-accessibility.md`](references/06-accessibility.md) |
| Figma URL を実装する手順 | [`references/07-figma-workflow.md`](references/07-figma-workflow.md) |
| PR 直前の自己 grep、古いコードの修正 | [`references/08-antipatterns.md`](references/08-antipatterns.md) |
| プロダクト現状マッピング、新規立ち上げ手順 | [`references/09-product-status.md`](references/09-product-status.md) |
| *Visual Signature(視覚的指紋)の根拠と全部* | [`references/10-visual-signature.md`](references/10-visual-signature.md) |
| *Page-level の完全な実装テンプレート* | [`references/11-page-templates.md`](references/11-page-templates.md) |
| *AI Slop の発生原因と検出方法* | [`references/12-ai-slop-prevention.md`](references/12-ai-slop-prevention.md) |
| LP / hero / ヘッダーに貼るチームみらい公式ロゴ | [`assets/logos/`](assets/logos/)(選び方は [`README.md`](assets/logos/README.md)) |
| 新規プロダクトの `globals.css` を 0 から作る | [`templates/globals.css`](templates/globals.css) |
| Cursor / Codex / Figma Make に投げる圧縮版 | [`templates/system-prompt.md`](templates/system-prompt.md) |
| Button / Badge / Card の cva 実装 | [`examples/`](examples/) |
| *Layout / Header / Footer / Hero / Home の完全な実装* | [`examples/`](examples/) |

「とりあえずこれだけ守れば 8 割みらいらしくなる」 → このファイル(§0〜§3)
「迷ったときの詳細根拠」 → `references/`
「写経してほしい完全実装」 → `examples/`

---

## §13 例外的にこの skill から逸脱してよい場合

- *`internal_handbook_proto` の webapp*: Tailwind を使わない方針なので、トークン名と意味だけ揃える。クラス名規約は適用外(インラインスタイルで `--primary` を直接参照する)
- *`marumie/admin`*: shadcn Dark Blue 固定で運用中。明示的にダークモードがデフォルトなので、明色画面向けの本 skill のうち「背景色」「テキスト色」の指針はそのまま使えない(その他は適用)
- *社内向け実験プロトタイプ(PR 化前提でないもの)*: 速度優先で OK だが、最終的に main にマージする段階で本 skill に揃える

それ以外は本 skill のルールが優先する。

---

## §14 セッション開始時の自己宣言テンプレ(推奨)

新規 page / 大きな UI を書き始めるとき、コードを書く *前に*以下を 1 段落で口にする(ログに残す)と、ズレが激減する:

```
このタスクのコミット:
- フォント: Noto Sans JP(和文)/ Lexend Giga(英数アクセント)
- 主色: #2AA693(CTA / link / active)
- アクセント: #0F8472(見出し強調)
- グラデ: bg-mirai-gradient(hero と一部 CTA に 1 種類だけ)
- 背景: warm gray #F7F4EE
- 角丸: pill (rounded-full) / card (rounded-xl/2xl) / modal (rounded-3xl)
- これ以外の選択肢(Inter, 紫グラデ, slate, 純白背景, shadow-2xl, font-light)は使わない
出典は mirai-gikai/web の globals.css と (main)/page.tsx を写経対象にする。
```

これを最初に宣言することで、AI が途中で「無難な選択(=AI Slop)」に流れるのを防げる。

---

> [!NOTE]
> このスキルは *3 プロダクト(mirai-gikai / marumie / action-board)の実コードベース*を一次情報として書かれている。それ以外の SaaS テンプレや shadcn デフォルトを参考にしてはいけない。判断に迷ったら *gikai の `web/src/app/globals.css` と `(main)/page.tsx` をその場で Read* するのが一番速い。
