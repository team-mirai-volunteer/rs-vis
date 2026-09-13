# 09. プロダクト別の現状とリファレンス箇所

「新規プロダクトを立ち上げるときどれをクローンするか」「既存プロダクトの修正で参考にする箇所」を一覧化。

---

## 9.1 みらい議会(公開側)— 🟢 正典

| 項目 | 値 |
|---|---|
| リポジトリ | [`team-mirai/mirai-gikai`](https://github.com/team-mirai/mirai-gikai) |
| パス | `web/` |
| 公開 URL | `gikai.team-mir.ai` |
| 技術スタック | Next.js (App Router) + TypeScript + Tailwind v4 + shadcn (new-york) + Radix UI + lucide-react + sonner + streamdown |
| パッケージ管理 | pnpm(モノレポ：`web/` `admin/` `packages/supabase` `packages/shared` `packages/seed`) |
| AGENTS.md | [`AGENTS.md`](https://github.com/team-mirai/mirai-gikai/blob/develop/AGENTS.md) — 開発ルール一次出典 |

### このプロダクトを正典扱いする理由

- `globals.css` の `@theme inline` が **最も整備されている**：text / surface / border / stance / reaction / star / progress / gradient endpoints の 9 カテゴリでトークン化
- `--color-mirai-*` 命名規則がチームみらい横展開しやすい
- `components/ui/` に 20+ の shadcn コンポーネントが揃っている(Button cva、Badge 7 variants、Card forwardRef 構成、Dialog `rounded-3xl`、Sheet、Tooltip、Toast 等)
- AGENTS.md でデザイン規約が **厳格運用** されている(`<button>` 禁止・arbitrary value 禁止・`get_variable_defs` 必須)
- フォーカスリング / `:focus-visible` の実装が標準化されている
- カスタムアニメーション(`shake` / `bounce-gentle` / `fade-in`)が用意されている

### 写経の出発点

新規プロダクトを始めるときは以下をコピーする:

```bash
# トークン定義
curl -fsSL https://raw.githubusercontent.com/team-mirai/mirai-gikai/develop/web/src/app/globals.css > src/app/globals.css

# 主要コンポーネント
mkdir -p src/components/ui
for c in button card badge input dialog sheet tooltip toast; do
  curl -fsSL https://raw.githubusercontent.com/team-mirai/mirai-gikai/develop/web/src/components/ui/${c}.tsx > src/components/ui/${c}.tsx
done

# 開発ルール
curl -fsSL https://raw.githubusercontent.com/team-mirai/mirai-gikai/develop/AGENTS.md > AGENTS.md
```

または [`../templates/globals.css`](../templates/globals.css) と [`../examples/`](../examples/) を使う。

---

## 9.2 みらい議会(管理画面)— 🟡 機能優先

| 項目 | 値 |
|---|---|
| リポジトリ | 同上 |
| パス | `admin/` |
| ポート | 3001(開発時) |

公開側と同じ `globals.css` を共有しているが、UI 検証が公開側より浅い。CRUD オペレーション中心。

参考にしてよいが、**新規 UI パターンの参考にはしない**(公開側を見る)。

---

## 9.3 みらい まる見え政治資金(公開側)— 🟡 旧 Figma DS 命名

| 項目 | 値 |
|---|---|
| リポジトリ | [`team-mirai/marumie`](https://github.com/team-mirai/marumie) |
| パス | `webapp/` |
| 技術スタック | Next.js + Tailwind v4 + Noto Sans JP / Noto Sans |
| globals.css 特徴 | `--color-black-500..900`, `--color-primary-400..600`, `--color-danger-500/600` の **数値レンジ命名**(旧 Figma DS 系) |

### 旧命名との対応(再掲、詳細は [`02-tokens.md` §2.1.6](02-tokens.md))

| marumie | mirai-gikai |
|---|---|
| `--color-primary-500` (`#2AA693`) | `--primary` (`#2AA693`) |
| `--color-black-800` (`#1F2937`) | `--color-mirai-text` (`#1F2937`) |
| `--color-danger-600` (`#DC2626`) | `--destructive` |

将来 `--color-mirai-*` 系に寄せる方針だが、当面は併存。**新規プロダクトでは marumie 命名を真似しない**。

特徴的な実装:

- 背景がグラデーション固定：`linear-gradient(135deg, rgba(226,246,243,1) 0%, rgba(238,246,226,1) 100%)`
- `.sr-only` ユーティリティを明示定義
- フォーカスリングは `outline: 2px solid #2aa693`(mirai と同じ)

---

## 9.4 みらい まる見え政治資金(管理画面)— 🟡 shadcn Dark Blue 固定

| 項目 | 値 |
|---|---|
| リポジトリ | 同上 |
| パス | `admin/` |
| テーマ | **ダークモード固定**(shadcn Dark Blue) |
| ローカルガイド | [`docs/admin-ui-guidelines.md`](https://github.com/team-mirai/marumie/blob/develop/docs/admin-ui-guidelines.md) |

### 独自ルール

- `import` は `index.ts` 経由(mirai-gikai と逆)：`import { Button, Input, Label } from "@/client/components/ui";`
- shadcn コンポーネントの `dark:` プレフィックスを **デフォルト** として適用(`bg-transparent dark:bg-input/30` → `bg-input/30` に書き換える)
- 主軸カラーが青系(`oklch(0.488 0.243 264.376)`)— ちみ標準のティールではない

### このプロダクト固有の取り扱い

- 新規 UI パターンは marumie 管理画面で実験されることが多い(Figma Make 経由のコードが入る)
- **書き出しコードをそのまま使うときは [`07-figma-workflow.md`](07-figma-workflow.md) のルールを必ず通す**：`rounded-xl`(40px ピル)、`Hiragino Kaku Gothic Std` 単体フォントスタックの問題に注意

---

## 9.5 internal_handbook_proto(このリポジトリ)— ⚪ 例外

| 項目 | 値 |
|---|---|
| リポジトリ | [`team-mirai/internal_handbook_proto`](https://github.com/team-mirai/internal_handbook_proto) |
| 技術スタック | Next.js + **Tailwind 不使用** + インラインスタイル中心 |
| カラー | 公式サイト互換の `#2AA693` / `#0F8472` / `#F7F4F0` / グラデ `#64D8C6 → #BCECD3` |

ハンドブック表示のためのミニマル設計。**Web プロダクトでは真似しない**。

このリポジトリの `CLAUDE.md` に書かれているスタイル規約は **このリポジトリ専用**。トークンの色域はちみ標準と一致させているので、配色を参考にするのは OK。

---

## 9.6 公式サイト(`team-mir.ai`)

| 項目 | 値 |
|---|---|
| URL | `team-mir.ai` / `policy.team-mir.ai` / `gikai.team-mir.ai` |
| リポジトリ | 一部公開(詳細は山根さんに確認) |

### カラーパレットの一次情報源

公式サイトの配色を **チームみらい標準** とする：

- プライマリ：`#2AA693`
- アクセント：`#089781`(公式サイト系)または `#0F8472`(mirai-gikai 系)
- 背景：`#F7F4F0` または `#F7F4EE`
- グラデ：`#64D8C6 → #BCECD3`

`gikai.team-mir.ai` ですでに `--color-mirai-*` トークンが実運用されているため、Web プロダクトはこの色域に揃える。

---

## 9.7 みらいいぬ Webapp / 各種 admin UI

| 項目 | 値 |
|---|---|
| 用途 | チーム内向け Slack bot / 各種ダッシュボード |
| 技術 | プロダクトによる |

新規 admin UI を作るときは mirai-gikai/web を参照する。

---

## 9.8 比較表

| プロダクト | リポジトリ | スタック | デザイン状態 | 参考価値 |
|---|---|---|---|---|
| みらい議会 web | mirai-gikai | Next + TS + Tailwind v4 + shadcn (new-york / neutral) | 🟢 正典 | ⭐⭐⭐⭐⭐ |
| みらい議会 admin | mirai-gikai | 同上 | 🟡 機能優先 | ⭐⭐⭐ |
| まる見え webapp | marumie | Next + TS + Tailwind v4(旧命名) | 🟡 旧 DS | ⭐⭐ |
| まる見え admin | marumie | shadcn dark blue 固定 | 🟡 ダーク | ⭐⭐ |
| internal_handbook_proto | 同名 | Tailwind 不使用 | ⚪ 例外 | ⭐ |
| 公式サイト | team-mir.ai | — | — | ⭐⭐⭐⭐(カラー一次情報) |

---

## 9.9 新規プロダクトを立ち上げる手順(おすすめ)

1. mirai-gikai/web を雛形にする(globals.css コピー + ui/ 主要 8 コンポーネントコピー)
2. `AGENTS.md` を新規プロダクト用に編集(リポ構造・コマンド名等を差し替え)
3. ハンドブックの本パッケージを `.claude/skills/mirai-design/` に配置(Claude Code が自動 load する)
4. プロダクト初期に「`index.ts` 経由 import するか」「`<button>` 完全禁止か」をチームで合意して `AGENTS.md` に明記
5. 開発開始

---

## 9.10 既存プロダクトの修正 PR で参考にする箇所

| 場面 | 参照先 |
|---|---|
| ボタンの variant を増やしたい | [mirai-gikai/web/src/components/ui/button.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/components/ui/button.tsx) |
| Badge の色を変えたい | [mirai-gikai/web/src/components/ui/badge.tsx](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/components/ui/badge.tsx) |
| トークンを追加したい | [mirai-gikai/web/src/app/globals.css](https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/app/globals.css) |
| ダークモードでスタイルが崩れる | [marumie/admin-ui-guidelines.md](https://github.com/team-mirai/marumie/blob/develop/docs/admin-ui-guidelines.md) — `dark:` デフォルト化のテクニック |
| Figma Make 経由コードを混ぜたい | [`07-figma-workflow.md` §7.1.2](07-figma-workflow.md) |
| ライティング / トーンで迷う | [`05-writing.md`](05-writing.md) |
| アクセシビリティチェック | [`06-accessibility.md`](06-accessibility.md) |

---

## 関連ページ

- [`README.md`](../README.md) — このパッケージのエントリ
- [`SKILL.md`](../SKILL.md) — Claude Skills エントリ
- [`02-tokens.md`](02-tokens.md) — トークン詳細
