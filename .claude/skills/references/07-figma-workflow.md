# 07. Figma → 実装ワークフロー

Figma の URL をコーディングエージェントに渡して実装させるときの **プロトコル**。これを守らないと、見た目は似ているが hex 値や spacing が微妙に違うコードが量産される。

参考: [mirai-gikai/AGENTS.md の Coding Style](https://github.com/team-mirai/mirai-gikai/blob/develop/AGENTS.md) ／ [marumie/docs/admin-ui-guidelines.md](https://github.com/team-mirai/marumie/blob/develop/docs/admin-ui-guidelines.md) ／ [#3_開発本部_デザイン キックオフ](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC/p1771688701701659)。

---

## 7.0 前提：Figma MCP を必ず使う

`get_variable_defs` / `get_design_context` を呼ばずにスクリーンショットだけで実装するのは禁止。山根さんの Figma design library が変数として持っている色・サイズ・spacing を **実値で取得** することが前提。

### Claude Code の場合

`.mcp.json` に Figma MCP server を登録(または Anthropic 公式の Figma MCP)。

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "figma-mcp"],
      "env": { "FIGMA_API_TOKEN": "..." }
    }
  }
}
```

実行例:

```
> このフレームを実装して: https://www.figma.com/file/xxx?node-id=123
```

Claude が自動的に `get_design_context(node_id=123)` → `get_variable_defs(...)` を呼ぶ。

---

## 7.1 Figma 側の準備

### 7.1.1 デザインライブラリを参照する

山根さんが publish 済みの Figma design library を使う(URL は [`#3_開発本部_デザイン`](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC) で山根さんに確認)。新規フレームを作るときは:

- Auto Layout + 既存コンポーネント の組み合わせで作る
- 新コンポーネントを増やしたい場合は **山根さんレビュー**を経る
- 配色・タイポはライブラリの Color Style / Text Style を使う。直書き禁止

### 7.1.2 Figma Make を使う場合

[`Publish Library > Export to Figma Make`](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC/p1773623879960169?thread_ts=1773623258.419589) 経由でライブラリを Figma Make にロード。System Guidelines に [`../templates/system-prompt.md`](../templates/system-prompt.md) を貼り付ける。

**フォントスタックの注意**：Figma Make が初期に書き出すコードは `font-family: "Hiragino Kaku Gothic Std", sans-serif` だけになっており、`font-weight: 400/500` が極太に解決される問題がある。出力されたコードは必ず:

```css
font-family: "Hiragino Sans", "Hiragino Kaku Gothic Std", "Noto Sans JP", sans-serif;
```

に修正する。詳細は [`02-tokens.md` §2.2](02-tokens.md) ／ [Slack 2026-04-13 山根さん宛て調査メモ](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC/p1774076018849129?thread_ts=1773623258.419589)。

---

## 7.2 実装プロトコル(必須順序)

### Step 1: Figma URL を受け取ったら

1. **ノード ID を確認** する(URL 末尾の `?node-id=XXX`)
2. `get_design_context(node_id)` で構造を取得
3. `get_variable_defs(...)` で使われている変数(色・spacing・radius)を一覧化

### Step 2: 取得した値を既存トークンとマッピング

例：Figma から `#2AA693` という色が返ってきた。

```
Figma 値: #2AA693
   ↓ globals.css の @theme inline をチェック
既存トークン: --primary が #2AA693
   ↓
クラス: bg-primary / text-primary を使う
```

| 取得した値 | 対応 | アクション |
|---|---|---|
| 完全一致のトークンがある | ✅ | そのトークン名でクラスを当てる |
| 微妙に違う(数 hex の差) | ⚠️ | 山根さんに確認、または既存トークンに寄せる判断 |
| 既存トークンが存在しない | 🔴 | **`globals.css` にトークンを追加する PR を先に切る** |

### Step 3: shadcn 既存コンポーネントで構造を組む

- ボタンらしき要素 → `<Button>` を使う(`<button>` 直書きはしない)
- カードらしき要素 → `<Card>` 系を使う(`<div className="rounded-xl ...">` で自作しない)
- ダイアログ → `<Dialog>`
- 入力 → `<Input>` `<Textarea>` `<Select>`

「Figma で長方形+角丸+影」と書かれていても、それが意味的にカードなら `<Card>` を使う。

### Step 4: アイコンは lucide-react から探す

Figma に貼られているアイコン SVG を **そのまま使わない**。`lucide-react` で同名・類似のアイコンを探す。

```
Figma 上のアイコン: ハートマーク
   ↓
lucide-react で検索: Heart
   ↓
import { Heart } from "lucide-react";
<Heart className="size-4" />
```

例外：lucide-react に存在しないチームみらい固有のロゴ・キャラクター(みらいいぬ等)は SVG を `public/` に置いて `<Image>` で扱う。

### Step 5: spacing / 角丸 / 影 を既存ルールにマッピング

Figma の `padding: 24px` → Tailwind `p-6`。Figma の `border-radius: 12px` → `rounded-xl`。「4 の倍数で固定」「角丸は用途別に固定」のルール([`02-tokens.md` §2.3](02-tokens.md))に当てる。

**ピクセル単位を arbitrary value で書かない**：

```tsx
// ❌ Figma の値を生で
<div className="p-[23px] rounded-[10px]">

// ✅ 既存スケールに丸める
<div className="p-6 rounded-xl">
```

ズレが 1〜3px なら既存スケールに寄せる。それより大きいなら山根さんに確認。

### Step 6: タイポは globals.css 側のルールに準拠

Figma で `font-size: 14px / font-weight: 400 / line-height: 26px` のような指定があっても、`text-sm leading-relaxed` のように既存クラスにマッピングする。`text-[14px]` のような arbitrary value は使わない。

### Step 7: セルフチェック

実装が終わったら [`08-antipatterns.md`](08-antipatterns.md) のチェックリストを grep ベースで実行。

```bash
grep -rE '(text|bg|border|fill|stroke)-\[#' src/  # arbitrary hex がないか
grep -rE 'style=\{\{[^}]*color' src/              # インラインで色がないか
grep -rE '<button(\s|>)' src/                     # <button> タグがないか
grep -rE '<svg(\s|>)' src/                        # インライン SVG がないか
```

### Step 8: スクリーンショットを撮って PR に貼る

`mirai-gikai` では `/pr-screenshot` スキルが自動で行う運用。手動でやる場合:

1. `pnpm dev` で起動
2. PC(1440px)とモバイル(375px)の 2 サイズで該当画面を撮影
3. PR 本文に Before / After を貼る

---

## 7.3 「これは Figma の意図と違う」と思ったら

機械的に hex を移すだけでは Figma 側の意図が伝わらないことがある。たとえば:

- Figma 上で `#2AA693` の長方形だが、それは「決定」ボタンを意図している → `<Button variant="default">` を使う(bg-primary でグラデなし、ではない)
- Figma 上で角丸 40px のピル要素 → `rounded-full`(`rounded-xl` ではない)
- Figma 上で「赤いテキスト」 → エラーまたは destructive。ただの強調なら別の色を検討

**意図の整合性をチェックする質問**:

1. このボタンは 1 画面で何番目に重要？
2. このカードはクリックできる？
3. このテキストは「エラー」「警告」「強調」のどれ？
4. このアイコンの代替テキストは何？

迷ったら Figma 上のコメント or `#3_開発本部_デザイン` で山根さんに確認。

---

## 7.4 新コンポーネントが必要になったら

Figma で「既存にないけど統一的に使う部品」が登場した場合:

1. **本当に新規が必要か** を再検討(shadcn の組み合わせで作れないか)
2. 必要なら山根さんレビューを経て Figma library に追加
3. 実装側は `src/components/ui/` 配下に cva ベースで新規コンポーネントを作る
4. 既存の `Button` `Badge` を参考に variant を設計
5. PR で `#3_開発本部_デザイン` レビューを依頼

---

## 7.5 Figma スクリーンショットだけで実装しないといけないケース

Figma MCP がない / アクセス権がない場合の **やむを得ない手順**:

1. スクリーンショットを Claude に渡す
2. 「**これは Figma の正確な値が取れないので、既存トークンに最も近い値で実装する**」と Claude に宣言させる
3. 実装後、PR 本文に「⚠️ Figma 値未取得のため既存トークン推定で実装。`#3_開発本部_デザイン` で確認お願いします」と明記
4. 山根さん / デザイン担当が値を確認 → 必要なら修正 PR

**この手順を「常用」にしない**。Figma MCP のセットアップを先に済ませる。

---

## 7.6 関連リソース

### Figma 側
- 山根さんが publish 済みの Figma design library(URL は `#3_開発本部_デザイン` で)
- [デザインガイドライン本体(Google Slides)](https://docs.google.com/presentation/d/1l8IUi5cS281fnGB4ngIDnIjx6xE4wXE-z3CvGRmKFAo/edit) — 紙物・ロゴ含む一次情報
- [デザインガイドライン Drive フォルダ](https://drive.google.com/drive/folders/1NEx0IxGLAicD6Ubus148BqVOgkNYDLGP)

### MCP
- [Figma MCP 公式(GitHub)](https://github.com/GLips/Figma-Context-MCP) または同等

### 既存運用ルール
- [mirai-gikai/AGENTS.md の Figma 実装ルール](https://github.com/team-mirai/mirai-gikai/blob/develop/AGENTS.md)
- [marumie/docs/admin-ui-guidelines.md](https://github.com/team-mirai/marumie/blob/develop/docs/admin-ui-guidelines.md)

### 関連ページ
- [`02-tokens.md`](02-tokens.md) — トークンの完全リスト
- [`03-components.md`](03-components.md) — shadcn コンポーネント詳細
- [`08-antipatterns.md`](08-antipatterns.md) — PR レビューチェックリスト
