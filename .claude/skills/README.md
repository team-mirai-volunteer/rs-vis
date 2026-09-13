---
title: "デザインシステム(Webアプリ向け)"
status: draft
---

# デザインシステム(Webアプリ向け)

> [!IMPORTANT]
> このパッケージは **Claude Skills 形式** で構成されている。エントリポイントは [`SKILL.md`](SKILL.md)。AI コーディングエージェント(Claude Code / Cursor / Figma Make)に丸ごと放り込んで、チームみらいらしい UI を再現することを目的とする。

## なぜ作ったか

- 「みらいのデザインスタイルに合った UI を作るための DESIGN.md / テンプレ / UI キット」が複数プロダクトで散発的に作られていたものの、コーディングエージェントに統一して投げられるものが存在しなかった
- 山根さんが個別に当てているデザイン直感を *言語化し、コードに落とせる粒度で* 残す
- shadcn + Tailwind v4 + Figma MCP + Claude Code という *チームみらい標準スタック* の作法をリポジトリ横断で揃える

> [!NOTE]
> 紙物・スライド・ロゴ運用は [`05-communications/brand-guidelines.md`](../../05-communications/brand-guidelines.md) を参照。両者でカラーパレットは揃えているが、フォントと UI 観点は別物。

## ディレクトリ構成

```
04-development/design-system/
├── README.md                       ← このファイル(ハンドブック目次から最初に開く)
├── SKILL.md                        ← Claude Skills エントリ(AI に渡すならまずこれ)
├── references/                     ← 詳細リファレンス(必要に応じて Claude が読みに行く)
│   ├── 01-philosophy.md            ← デザイン思想(山根さんの考え方)
│   ├── 02-tokens.md                ← トークン詳細(hex / px / 命名規則)
│   ├── 03-components.md            ← shadcn コンポーネント別の運用ルール
│   ├── 04-patterns.md              ← 画面パターン(empty / loading / confirm / toast)
│   ├── 05-writing.md               ← UI 文言・トーン
│   ├── 06-accessibility.md         ← A11y 最低ライン
│   ├── 07-figma-workflow.md        ← Figma → 実装のプロトコル
│   ├── 08-antipatterns.md          ← grep でひっかけられる禁止パターン
│   ├── 09-product-status.md        ← 各プロダクトの現状とリファレンス箇所
│   ├── 10-visual-signature.md      ★ NEW: 3 プロダクトの「視覚的指紋」を並列で詳述
│   ├── 11-page-templates.md        ★ NEW: 4 種類の page-level 完全テンプレ(LP/ダッシュボード/feed/詳細)
│   └── 12-ai-slop-prevention.md    ★ NEW: AI Slop の発生原因と grep ベース検出スクリプト
├── templates/
│   ├── globals.css                 ← 新規プロダクト用にコピペできる完全版トークン定義
│   └── system-prompt.md            ← Cursor / Codex / Figma Make の冒頭に貼る圧縮版(日英)
└── examples/
    ├── button.tsx                  ← mirai-gikai 正典の cva 実装
    ├── badge.tsx                   ← 7 variants のリファレンス
    ├── card.tsx                    ← forwardRef + Header/Content/Footer 構成
    ├── layout.tsx                  ★ NEW: Root Layout 完全テンプレ(Noto Sans JP + warm bg)
    ├── header.tsx                  ★ NEW: 固定ヘッダー完全テンプレ(白 rounded box)
    ├── hero.tsx                    ★ NEW: Hero 2 種(グラデ型 / 画像型)
    ├── home-page.tsx               ★ NEW: トップページ完全テンプレ(gikai 風)
    └── link-button.tsx             ★ NEW: アイコン付きリンクボタン(外部リンク導線)
```

> [!IMPORTANT]
> *v0.3 で `10-visual-signature.md` / `11-page-templates.md` / `12-ai-slop-prevention.md` を追加*。これらが AI Slop 回避の中核。`examples/` にも page / layout / header / hero / home-page / link-button のフル実装を追加し、コンポーネント単位から page 単位まで「写経で済む」ようにした。経緯: v0.2 では Skill 経由で全部生成したら mirai-gikai / marumie / action-board と似ても似つかない AI Slop が出たため。詳細は [`references/12-ai-slop-prevention.md`](references/12-ai-slop-prevention.md)。

## 使い方(3 通り)

### A. Claude Code / Cursor を使う開発者

```bash
# 1. 一度だけ：このディレクトリをそのままプロジェクトの .claude/skills/ にコピー
cp -r docs/handbook/04-development/design-system .claude/skills/mirai-design

# 2. 以降は Claude Code が SKILL.md の description にマッチしたとき自動でロードする
#    または明示的に呼び出す:
#    > /mirai-design  Card と Button を使ってログイン画面を作って
```

Cursor / Codex の場合は `.cursorrules` などに [`templates/system-prompt.md`](templates/system-prompt.md) を貼る。

### B. Figma Make を使うデザイナー

Figma Make の System Guidelines に [`templates/system-prompt.md`](templates/system-prompt.md) を貼り付ける。山根さんが publish 済みの Figma design library と組み合わせて使う(library URL は [`#3_開発本部_デザイン`](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC) で山根さんに確認)。

### C. PR レビュアー

レビューで「これってちみのデザインルール的にどうだっけ？」と思ったら [`references/08-antipatterns.md`](references/08-antipatterns.md) を grep ベースのチェックリストとして使える。

## 立ち位置と更新権限

- *正典扱いするリファレンス実装*: [`team-mirai/mirai-gikai`](https://github.com/team-mirai/mirai-gikai) `web/`(みらい議会公開側)。`globals.css` の `--color-mirai-*` トークン群と `components/ui/` の shadcn 実装が現時点で最も整っている
- *対象プロダクト*: みらい議会 (`mirai-gikai`) / みらいまる見え政治資金 (`marumie`) / アクションボード ([`team-mirai-volunteer/action-board`](https://github.com/team-mirai-volunteer/action-board)) の 3 つを「同じトーン」に揃えるのが本パッケージの目的
- *このパッケージは v0.3 叩き台*: 2026-03 から「複数プロダクト共通のデザインシステム」立ち上げ議論が `#3_開発本部_デザイン` で進行中。最新の Figma library publish 状況や正式 npm package 化の進捗は山根さんに確認
  - [#3_開発本部_デザイン — デザインシステム会キックオフ](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC/p1771688701701659)
- *更新権限*: 開発本部(山根さん／jujunjun110／k.murai が現在のドライバー)。本ディレクトリへの変更 PR は `#3_開発本部_デザイン` で軽く合意してからマージ
- *既存 `guidelines.md` 叩き台との関係*: jujunjun110 さんが [Slack 2026-04-08](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC/p1773989547630149?thread_ts=1773623258.419589) で AI に書かせたまるみえ向け叩き台、および [Slack 2026-03-27](https://team-mirai-staff.slack.com/archives/C0AFZQSG1GC/p1771943529805999?thread_ts=1771943515.567089) のドラフトレビューくん向け Content Reviewer Guidelines を統合・拡張したものが本パッケージ

## v0.2 → v0.3 で何が変わったか

v0.2 (`5f254a6`) では「ガイドラインを言葉で書く」アプローチを取ったが、Skill 経由で UI 生成を試したら *3 プロダクトと似ても似つかない AI Slop* が出た。原因と対策:

| 問題(v0.2) | 改善(v0.3) |
|---|---|
| 「視覚的指紋」が言語化されておらず、AI が「無難な shadcn」に流れた | [`references/10-visual-signature.md`](references/10-visual-signature.md) で 3 プロダクトの指紋 13 項目を全て書き下した |
| 禁止パターンが「インライン hex 禁止」レベルで、AI Slop の本丸(Inter / 紫グラデ / shadow-2xl 等)が放置されていた | [`references/12-ai-slop-prevention.md`](references/12-ai-slop-prevention.md) に AI Slop 16 種を grep スクリプト付きで列挙 |
| `examples/` がコンポーネント単位のみで、page 全体を組み立てるとき AI が想像で構造を作っていた | [`references/11-page-templates.md`](references/11-page-templates.md) に 4 種類の page-level 完全テンプレ、`examples/` に layout / header / hero / home-page / link-button を追加 |
| SKILL.md の鉄則が抽象的で、AI が judgement call で AI Slop に流れた | SKILL.md §0 に「Visual Signature 7 項目」を冒頭に置き、§1 で 14 個の Forbidden パターンを explain-the-why で禁止 |
| アクションボードのコードベースを参照していなかった | v0.3 で `team-mirai-volunteer/action-board` を一次情報に追加し、3 プロダクト並列で抽出 |
| `system-prompt.md` の圧縮版が長くて Cursor の context を圧迫していた | 日本語版・英語版に分け、それぞれ 1 ページ以内に収めた |

## 関連ページ

- [`05-communications/brand-guidelines.md`](../../05-communications/brand-guidelines.md) — 紙物・スライド・ロゴ運用(Web 以外のブランドルール)
- [`04-development/dev-flow.md`](../dev-flow.md) — 開発フロー全般(CodeRabbit / Claude Code / Ralph Loop)
- [`04-development/projects.md`](../projects.md) — 各プロダクトの概要
