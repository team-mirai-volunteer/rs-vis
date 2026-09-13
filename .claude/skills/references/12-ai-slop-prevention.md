# 12. AI Slop の発生原因と検出方法

このファイルは「なぜ AI コーディングエージェントは default で *チームみらいに似ても似つかない* UI を生成するのか」を解析し、その対策を grep ベースの検出スクリプトに落としたもの。

このスキルの過去バージョンでは「言葉でガイドラインを書く」アプローチを取ったが、AI Slop が大量に発生した。今のバージョンでは:

1. *視覚的指紋を明示*する([`10-visual-signature.md`](10-visual-signature.md))
2. *AI Slop の典型パターンを禁止リストとして書く*(本ファイル)
3. *完全な page-level テンプレートを置く*([`11-page-templates.md`](11-page-templates.md) と `examples/`)

の 3 点セットで物理的に防ぐ。

---

## §1 「AI Slop」とは何か

[Anthropic の公式 frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) の表現を借りると、AI Slop とは:

> generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

訳すと「Inter / Roboto / Arial / system フォント、紫グラデを白背景に乗せた手垢のついた配色、見飽きたレイアウト・コンポーネントパターン、文脈固有性の欠けた金太郎飴のデザイン」。

LLM は確率的に「最もありがちな選択」を取る。デザインに関する判断を求められると、訓練データに大量にある shadcn のデフォルトテンプレ・Vercel ブログ・Linear / Notion 風のクリーンな白カードに収束する。これが AI Slop の正体。

チームみらいの場合、これが起きると *3 プロダクトと似ても似つかない*別物が出てくる。理由:
- みらいは紫グラデではなく *teal グラデ* (`#64D8C6 → #BCECD3`) を使う
- みらいは Inter ではなく *Noto Sans JP* を使う
- みらいは cool gray (slate / zinc / stone) ではなく *warm gray* (`#F7F4EE`) を使う
- みらいの CTA は「ピル + グラデ + 黒ボーダー + 黒文字」であり、shadcn 標準の「色付き背景 + 白文字」とは別物

つまり *defaultの「ありがち」が、ちみのデザインから明確に外れている*。明示的に禁止しないと AI は defaultに流れる。

---

## §2 典型的な AI Slop パターン 16 種

実際に過去にチームみらいの Slack で「AI が生成したけど違う」と言われた事例と、業界一般で言われる AI Slop パターンを統合したリスト。

### 2.1 フォント周り

| ❌ パターン | 例 | 修正 |
|---|---|---|
| `<html className="font-inter">` | shadcn テンプレ初期値 | `<html className={`${notoSansJP.variable} font-sans antialiased`}>` |
| `font-family: system-ui, sans-serif;` | reset で雑に書く | `font-family: var(--font-noto-sans-jp), -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;` |
| `font-light` で和文本文 | 軽さを演出しようとして | `font-medium` または `font-normal` |
| Geist / Geist_Mono を UI 本体に | Vercel テンプレからのコピペ | `Noto_Sans_JP` に置き換え(補助用なら残しても可) |
| `font-mono` でコード以外の表示 | 数値強調目的 | プレーンテキストで OK、必要なら `tabular-nums` |

### 2.2 配色周り

| ❌ パターン | 例 | 修正 |
|---|---|---|
| `bg-gradient-to-r from-purple-600 to-pink-600` | ありがちなマーケ LP | `bg-mirai-gradient`(teal グラデ)一択 |
| `bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500` | 3 色グラデ | 同上、1 色対 1 色のみ |
| `bg-slate-50` を全画面背景 | クリーン感を出そうとして | `bg-background`(= `#F7F4EE` warm gray) |
| `text-zinc-500` / `text-stone-500` で本文 | cool gray パレットからの逃避 | `text-mirai-text` / `text-mirai-text-muted` |
| `style={{ background: "linear-gradient(...)" }}` インライン | トークン経由ではない | `bg-mirai-gradient` クラス使用 |
| `bg-white` を `<body>` に | 「真っ白で清潔感」狙い | `bg-background`、白はカード・モーダル・ヘッダー内のみ |

### 2.3 ボタン周り

| ❌ パターン | 例 | 修正 |
|---|---|---|
| `<button className="bg-blue-500 text-white px-4 py-2 rounded">` | 生 button タグ | `<Button>` コンポーネント使用、variant 明示 |
| `<Button>` のまま variant 指定なし | shadcn デフォルトの `bg-primary text-primary-foreground` で出る | `variant="default"` を明示(gikai/action-board では「グラデ + 黒ボーダー + 黒文字」) |
| `rounded-md` のボタン | shadcn デフォルト | `rounded-full`(ピル)に統一 |
| `<div onClick={...}>` で擬似ボタン | a11y 無視 | `<Button>` か `<a>` を使う |
| `<Link>` の中に `<Button>` を直接ネスト | 二重要素 | `<Button asChild><Link>...</Link></Button>` の形 |

### 2.4 カード・レイアウト周り

| ❌ パターン | 例 | 修正 |
|---|---|---|
| `shadow-2xl rounded-3xl` のリッチカード | 「立体感」狙い | `shadow-xs rounded-xl border border-mirai-border` |
| `backdrop-blur-md bg-white/30` ガラスモーフ | 2020 年代前半トレンド | `bg-card border border-mirai-border` で flat に |
| `rounded-[40px]` 巨大角丸 | 中途半端な大きさ | `rounded-2xl` (16px) または `rounded-3xl` (24px) のいずれか |
| カードに `border-2 border-blue-500` のような派手なボーダー | アクセント目的 | `border-mirai-border` (1px グレー) または `border-black` (1px) |
| `<div className="bg-white rounded-lg p-4 shadow">` 生 div カード | カスタムで作る | `<Card><CardHeader>...<CardContent>...</Card>` を使う |

### 2.5 タイポ・スペーシング周り

| ❌ パターン | 例 | 修正 |
|---|---|---|
| `text-6xl font-extrabold` の hero h1 | 業界 LP テンプレ | `text-4xl md:text-4xl font-bold`(gikai/action-board の hero)に近づける |
| `tracking-tight` の本文 | スタイリッシュ狙い | `tracking-normal` |
| `leading-tight` の本文段落 | 同上 | `leading-relaxed` か `leading-[28px]` |
| `gap-[7px]` `p-[13px]` 等の中途半端な arbitrary | Figma スクショから推測 | 4px スケール (`gap-2 = 8px`) に丸める、または Figma の `get_variable_defs` で正確値 |

### 2.6 アニメーション・インタラクション周り

| ❌ パターン | 例 | 修正 |
|---|---|---|
| `transition-all duration-300` | 雑な全 transition | `transition-colors duration-200` のように property を絞る |
| `hover:scale-105` の本文カード hover | 動かしすぎ | `hover:bg-muted/50` か `hover:opacity-90` |
| `animate-bounce` の常時アニメ | 装飾目的 | gikai の `animate-bounce-gentle` のように控えめ、または使わない |
| `outline-none` 単独(focus-visible なし) | a11y 違反 | `outline-none focus-visible:ring-2 focus-visible:ring-primary/40` セット |

### 2.7 アイコン・絵文字周り

| ❌ パターン | 例 | 修正 |
|---|---|---|
| インライン `<svg>...</svg>` で自作アイコン | Figma からトレース | `import { Star } from "lucide-react"` |
| h1 に 🚀✨🎉 を散布 | デコレーション | 文脈固有なら OK(「注目🔥」)、装飾目的は禁止 |
| `<img src="/icons/...">` でアイコン | next/image を使わない | `lucide-react` または `<Image>` |

### 2.8 文言周り

| ❌ パターン | 例 | 修正 |
|---|---|---|
| 「リアルタイムで分析」 | 誇張 | 「自動で集計」「順次更新」 |
| 「AI が最適化」(曖昧) | 責任所在が不明 | 「AIおすすめ順」「AI生成(要校閲)」 |
| 「保存してください」(敬語) | ボタン文言 | 「保存する」(命令形) |
| 「Team Mirai について」 | 英語表記 | 「チームみらいについて」(ひらがな) |

---

## §3 grep ベース検出スクリプト(PR 直前必須)

以下を `pnpm lint:design` のような script として `package.json` に追加することを推奨。

```bash
#!/bin/bash
# scripts/lint-design.sh
set -e

PROJECT_ROOT="${1:-src/}"
FAIL=0

echo "🔍 mirai-design lint: scanning $PROJECT_ROOT"
echo ""

# 1. arbitrary hex 値
if grep -rEn '(text|bg|border|fill|stroke|ring|from|to|via)-\[#[0-9a-fA-F]+\]' "$PROJECT_ROOT" --include="*.tsx" --include="*.ts"; then
  echo "❌ §3 鉄則1 違反: arbitrary hex を使っている。globals.css のトークンを使う"
  FAIL=1
fi

# 2. インラインスタイルで色
if grep -rEn 'style=\{\{[^}]*(color|background|borderColor):' "$PROJECT_ROOT" --include="*.tsx"; then
  echo "❌ §3 鉄則1 違反: インラインスタイルで色を当てている"
  FAIL=1
fi

# 3. 生 <button> タグ
if grep -rEn '<button(\s|>)' "$PROJECT_ROOT" --include="*.tsx" | grep -vE '(// ok|/\* ok)' ; then
  echo "❌ §3 鉄則2 違反: 生 <button> タグ。@/components/ui/button の <Button> を使う"
  FAIL=1
fi

# 4. インライン SVG
if grep -rEn '<svg(\s|>)' "$PROJECT_ROOT" --include="*.tsx" | grep -v 'public/'; then
  echo "❌ §3 鉄則3 違反: インライン SVG。lucide-react を使う"
  FAIL=1
fi

# 5. 禁止フォント
if grep -rEn 'font-(inter|roboto|arial|geist|helvetica)\b' "$PROJECT_ROOT" --include="*.tsx" --include="*.css"; then
  echo "❌ §1 違反: Inter / Roboto / Arial / Geist / Helvetica。Noto Sans JP を使う"
  FAIL=1
fi

# 6. 禁止グラデーション色
if grep -rEn 'from-(purple|pink|fuchsia|violet|indigo|blue|red|orange|amber|yellow|rose)-' "$PROJECT_ROOT" --include="*.tsx"; then
  echo "❌ §1 違反: 紫・青・赤系などの Tailwind 標準色グラデ。bg-mirai-gradient を使う"
  FAIL=1
fi

# 7. 3 色以上のグラデ (via-)
if grep -rEn '\bvia-' "$PROJECT_ROOT" --include="*.tsx"; then
  echo "❌ §1 違反: 3 色以上のグラデーション。1 色対 1 色のみ"
  FAIL=1
fi

# 8. cool gray の主要使用
if grep -rEn 'bg-(slate|zinc|stone|gray)-(50|100|200)' "$PROJECT_ROOT" --include="*.tsx"; then
  echo "⚠️  §1 警告: cool gray を主要色として使っている。warm gray (#F7F4EE) または mirai-* トークンに寄せる"
  # FAIL=1  # 警告のみ
fi

# 9. transition-all
if grep -rEn '\btransition-all\b|transition:\s*all' "$PROJECT_ROOT" --include="*.tsx" --include="*.css"; then
  echo "❌ §1 違反: transition-all。個別 property に絞る (transition-colors 等)"
  FAIL=1
fi

# 10. font-light で和文
if grep -rEn '\bfont-light\b' "$PROJECT_ROOT" --include="*.tsx"; then
  echo "❌ §1 違反: font-light。和文では font-normal か font-medium を使う"
  FAIL=1
fi

# 11. shadow-2xl / shadow-xl
if grep -rEn '\bshadow-(2xl|xl)\b' "$PROJECT_ROOT" --include="*.tsx"; then
  echo "⚠️  §1 警告: 濃いシャドウ。shadow-xs か shadow-soft に寄せる"
fi

# 12. backdrop-blur (ガラスモーフ)
if grep -rEn '\bbackdrop-blur\b' "$PROJECT_ROOT" --include="*.tsx"; then
  echo "⚠️  §1 警告: backdrop-blur。flat デザインに寄せる"
fi

# 13. outline-none 単独
if grep -rEn '\boutline-none\b' "$PROJECT_ROOT" --include="*.tsx" --include="*.css" | grep -v 'focus-visible:ring\|focus:ring\|focus-visible:outline'; then
  echo "❌ a11y 違反: outline-none 単独。focus-visible:ring とセットで使う"
  FAIL=1
fi

# 14. <Button> variant 未指定
if grep -rEn '<Button(\s+[^>]*)?>' "$PROJECT_ROOT" --include="*.tsx" | grep -vE 'variant=|asChild'; then
  echo "⚠️  §6 警告: <Button> に variant が未指定。明示的に variant を選ぶ"
fi

# 15. 巨大角丸
if grep -rEn 'rounded-\[([4-9][0-9]|[1-9][0-9]{2,})px\]' "$PROJECT_ROOT" --include="*.tsx"; then
  echo "⚠️  §1 警告: 40px 以上の arbitrary 角丸。rounded-2xl/3xl もしくは rounded-full に統一"
fi

# 16. "Team Mirai" 表記
if grep -rEn '(Team Mirai|チーム未来|チームミライ)' "$PROJECT_ROOT" --include="*.tsx" | grep -v 'alt=\|src=\|//\|/\*'; then
  echo "⚠️  §8 警告: 党名表記。本文では「チームみらい」(ひらがな)"
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo "✅ mirai-design lint: passed"
else
  echo "💥 mirai-design lint: failed (上記を修正)"
  exit 1
fi
```

これを `package.json` の scripts に:

```json
{
  "scripts": {
    "lint:design": "bash scripts/lint-design.sh"
  }
}
```

CI で必須化する場合は `.github/workflows/lint.yml` に追加:

```yaml
- name: mirai-design lint
  run: pnpm lint:design
```

---

## §4 「コミット前の自己宣言」テンプレート

新規 page を書き始める *前に*、AI セッションのログとして以下を宣言する。これをやるだけで AI Slop が激減する(Anthropic の "explain-the-why" + "commit to direction" パターン)。

```
このタスクのコミット:
- フォント: Noto Sans JP(和文)/ Lexend Giga(英数アクセント)
- 主色: #2AA693(CTA / link / active)
- アクセント: #0F8472(見出し強調)
- グラデ: bg-mirai-gradient(hero と一部 CTA に 1 種類だけ)
- 背景: warm gray #F7F4EE
- 角丸: pill (rounded-full) / card (rounded-xl/2xl) / modal (rounded-3xl)
- これ以外(Inter, 紫グラデ, slate, 純白背景, shadow-2xl, font-light)は使わない
- 出典は mirai-gikai/web の globals.css と (main)/page.tsx を写経する
```

宣言してから書くと、途中で AI が「無難な選択」に流れにくくなる。

---

## §5 「これが出たら全部書き直し」サイン

生成物の中に以下のサインが 1 つでもあれば *破棄して書き直し*。部分修正で済まそうとしない。

1. *最初の paragraph に Inter / Roboto / Arial / Geist が出てくる* — フォント設計が根本から間違っている
2. *紫グラデーション (`from-purple-* to-pink-*` 等) が hero に出てくる* — カラーパレット設計が AI Slop に汚染されている
3. *`bg-white` が `<body>` または `<html>` の直下にある* — 背景設計が AI Slop
4. *`<Button variant="default">` を使わずに `<button>` で代用* — コンポーネント階層を理解していない
5. *`shadow-2xl` が複数箇所に* — visual signature が AI Slop に寄っている

逆に、書き直し時には *まず `examples/home-page.tsx` をそのままコピーしてから差分で改造する*のが速い。0 から書くと再度 AI Slop に陥る。

---

## §6 参考: 業界の AI Slop 議論

このスキルが解こうとしている問題は、業界全体で議論されている「frontend AI Slop」の特殊解。一般論の参考リンク:

- [Anthropic frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design) — 公式の AI Slop 回避 skill(277K+ installs)
- [Best Claude Code Skills to Try in 2026 (Firecrawl)](https://www.firecrawl.dev/blog/best-claude-code-skills) — frontend-design skill の解説
- [Skill Authoring Patterns from Anthropic's Best Practices](https://generativeprogrammer.com/p/skill-authoring-patterns-from-anthropics) — explain-the-why パターンの解説
- [shadcn/ui + Claude Code: 3 Settings That Fix AI-Generated UI Quality](https://dev.to/_46ea277e677b888e0cd13/shadcnui-claude-code-3-settings-that-fix-ai-generated-ui-quality-2dea) — shadcn+Claude の運用ノウハウ

ただし上記はいずれも「ジェネリックな AI Slop 回避」を目的にしており、*チームみらい固有の visual signature* に揃える話ではない。本ファイルはみらい固有のパターンを書き下したもの。
