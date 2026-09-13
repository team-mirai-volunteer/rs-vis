# コーディングエージェント用システムプロンプト(圧縮版)

このファイルは Cursor / Codex / Claude Code / Figma Make / その他 AI コーディングエージェントの *custom instructions に貼り付ける用* の圧縮版。SKILL.md / references/ をすべて読み込めない環境でも、最低限「ちみらしい UI」が出るようにした。

日本語版と英語版を用意。プロジェクト直下の `.cursorrules` や `AGENTS.md` に貼り付けて使う。

---

## 日本語版(推奨・短縮)

```
あなたはチームみらいの Web プロダクト (mirai-gikai / marumie / action-board) と
視覚的に揃った UI を実装する。defaultの shadcn / Vercel テンプレに流れず、
以下の Visual Signature 7 項目を**すべて満たす**コードを生成する。1 つでも満たさなければ書き直す。

== Visual Signature(必ず出る指紋)==
1. フォント: Noto Sans JP(和文)/ Lexend Giga(英数アクセント任意)。
   Inter / Roboto / Arial / Geist / system-ui は使わない
2. 主色: #2AA693(primary)/ #0F8472(accent)
3. グラデ: `linear-gradient(to bottom right, #64D8C6, #BCECD3)` 1 種類のみ。
   紫・青・ピンク・3 色グラデ・放射状は禁止
4. 背景: warm gray #F7F4EE 系 もしくは 薄ティール。
   bg-white を全画面背景にしない(純白はカード・モーダル内のみ)
5. プライマリ CTA: rounded-full + bg-mirai-gradient + border border-black + text-black/gray-800。
   shadcn 標準の bg-primary + text-white は使わない
6. カード: bg-white + rounded-xl/2xl/3xl + 1px の控えめなボーダー + shadow-xs まで。
   shadow-2xl, backdrop-blur, rounded-[40px] は禁止
7. 和文本文: font-medium か font-normal + leading-relaxed。
   font-light は禁止

== コンポーネント規約 ==
- 色は globals.css の @theme inline トークン経由のみ。
  text-[#xxx] / bg-[#xxx] / style={{color:...}} は禁止
- ボタンは @/components/ui/button の <Button variant="default|outline|ghost|link|destructive">。
  生 <button> タグ禁止、<div onClick> 禁止
- アイコンは lucide-react のみ。インライン SVG / 絵文字での代替禁止
- 角丸 trio: rounded-full(ピル)/ rounded-xl-2xl(カード)/ rounded-3xl(モーダル)
- transition-all 禁止。transition-colors / -opacity / -transform に絞る
- focus-visible:ring-2 ring-primary/40 ring-offset-2 を必ずセット

== ライティング ==
- 党名は「チームみらい」(ひらがな)。Team Mirai は ロゴ画像内のみ
- ロゴは自作・トレースしない。公式ロゴ(handbook の design-system/assets/logos)をそのまま使う
- ボタンは命令形(「保存する」「公開する」)
- 結果通知は丁寧体(「申請を受け付けました」)
- 「リアルタイム」「即時」「最速」のような誇張は禁止

== 実装手順 ==
1. プロジェクト直下の AGENTS.md / CLAUDE.md / globals.css を Read してトークン名を確認
2. src/components/ui/ にある shadcn コンポーネントを ls
3. 似た page の例があれば写経の出発点にする
   (LP → gikai 風 / ダッシュボード → marumie 風 / feed → action-board 風)
4. 上記 Visual Signature 7 項目で生成物をセルフチェック
5. arbitrary hex / 生 button / インライン SVG / 紫グラデ / font-light を grep で検出
```

---

## 英語版(Cursor / international team 向け)

```
You implement UI for Team Mirai's web products (mirai-gikai / marumie / action-board)
matching the team's visual identity. Never default to generic shadcn/Vercel templates.
Your output MUST satisfy ALL 7 Visual Signature items below. If even one fails, rewrite.

== Visual Signature (must always appear) ==
1. Font: Noto Sans JP (Japanese) + optional Lexend Giga (Latin accents).
   NEVER use Inter, Roboto, Arial, Geist, system-ui.
2. Primary color: #2AA693 (primary) / #0F8472 (accent for headings).
3. Gradient: `linear-gradient(to bottom right, #64D8C6, #BCECD3)` is the ONLY allowed gradient.
   Purple/blue/pink/3-color/radial gradients are forbidden.
4. Background: warm gray (#F7F4EE family) or light teal.
   Never `bg-white` as full-page background (white is for cards/modals only).
5. Primary CTA: rounded-full + bg-mirai-gradient + border border-black + black text.
   Never use shadcn default `bg-primary` + `text-primary-foreground`.
6. Card: bg-white + rounded-xl/2xl/3xl + subtle 1px border + max shadow-xs.
   Forbidden: shadow-2xl, backdrop-blur, rounded-[40px], glass morphism.
7. Japanese body text: font-medium or font-normal + leading-relaxed.
   Never `font-light` for Japanese text (hiragana becomes unreadable).

== Component Rules ==
- Colors via globals.css `@theme inline` tokens only.
  No `text-[#xxx]`, `bg-[#xxx]`, `style={{color:...}}` arbitrary values.
- Buttons: always `<Button variant="default|outline|ghost|link|destructive">` from `@/components/ui/button`.
  Never raw `<button>` or `<div onClick>`.
- Icons: lucide-react only. No inline SVG, no emoji-as-icon.
- Border radius trio: rounded-full (pill) / rounded-xl-2xl (card) / rounded-3xl (modal).
- No `transition-all`. Use transition-colors / -opacity / -transform.
- Always pair focus rings: `focus-visible:ring-2 ring-primary/40 ring-offset-2`.

== Writing ==
- Party name: "チームみらい" in hiragana. "Team Mirai" only inside logo images.
- Never redraw/trace the logo. Use the official Team Mirai logo as-is (handbook design-system/assets/logos).
- Button labels: imperative form ("保存する" not "保存してください").
- Result notifications: polite form ("申請を受け付けました").
- Never use exaggerations like "リアルタイム" (real-time), "即時" (instant), "最速" (fastest).

== Workflow ==
1. Read project root AGENTS.md / CLAUDE.md / globals.css for tokens.
2. Ls `src/components/ui/` for available shadcn components.
3. Find a similar reference page (LP → gikai pattern / dashboard → marumie pattern / feed → action-board pattern) and copy its structure.
4. Self-check generated code against all 7 Visual Signature items above.
5. Grep for: arbitrary hex, raw `<button>`, inline `<svg>`, purple/blue gradients, `font-light`.
```

---

## 使い方

### Cursor(`.cursorrules` または `.cursor/rules/*.mdc`)

リポジトリルートに `.cursorrules` を作って *日本語版*をコピペ。

### Claude Code(`CLAUDE.md`)

リポジトリ直下の `CLAUDE.md` または `AGENTS.md` に *日本語版*の主要部分を追記。すでに長いファイルがある場合は冒頭に置く。

### Figma Make / Bolt / v0

新規プロジェクト作成時の最初のプロンプトに *日本語版を全文貼り付け*。

### OpenAI Codex / GitHub Copilot

リポジトリ直下に `AGENTS.md` を置き *英語版*を貼り付け(Codex は英語の方が遵守率が高い)。

### Anthropic Skills

このスキル全体を `.claude/skills/mirai-design/` に丸ごとコピーすれば自動 load される:

```bash
cp -r docs/handbook/04-development/design-system .claude/skills/mirai-design
```

---

## なぜこれが効くか

1. *Visual Signature を冒頭に置く* — Anthropic frontend-design skill の "commit to a bold aesthetic direction" パターン。AI に「無難な選択」を取らせない
2. *禁止リストを明示* — 「Inter / 紫グラデ / shadcn default」を *固有名詞で*禁止する。曖昧に「avoid generic」と書くだけだと AI は具体パターンを想像できない
3. *肯定的なコミットを書く* — 「#2AA693 を使う」「rounded-full + glass + black border + black text」のように、置き換え先を明示する
4. *セルフチェックを義務化* — 「7 項目を全部満たさないと書き直し」とすることで、生成後の確認が省略されない

詳細な根拠は [`../references/12-ai-slop-prevention.md`](../references/12-ai-slop-prevention.md) と [`../references/10-visual-signature.md`](../references/10-visual-signature.md)。
