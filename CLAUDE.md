# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
npm run dev              # Dev server (localhost:3000, Turbopack)
npm run build            # Production build（prebuildで.gzを自動展開）
npm run lint             # ESLint チェック
npx tsc --noEmit         # TypeScript 型チェック
```

データパイプライン・JSON生成コマンドは `/pipeline` スキルを参照。

## Architecture

日本の2024年度予算・支出データをインタラクティブなSankey図で可視化する Next.js アプリ。

**公開ページ**: `/sankey-svg`（メイン、`/` からリダイレクト）、`/subcontracts`、`/mof-budget-overview`（URL直打ち）、`/quality`（URL直打ち）、`/project-bubble`（URL直打ち・事業バブルチャート＝意味的2次元配置）、`/budget-sankey`（メニュー名「統合ビュー」。MOF予算書の会計→所管→項→目とRS事業→支出先を1本のサンキーで見る追加ビュー。設計: `docs/tasks/20260913_0428_財務省予算書とRS事業の完全統合サンキー設計.md`）

**Key Statistics**: 151.12兆円 総予算 / 5,003事業 / 26,823支出先（予算年度2023実績・再委託先含む）

### Layer Design Rules

| Layer | Directory | 役割 |
|-------|-----------|------|
| Data Pipeline | `scripts/` | CSV処理のみ。UIやAPIロジック禁止 |
| Domain Logic | `app/lib/` | Pure Sankey生成。HTTP・React禁止 |
| API Layer | `app/api/` | HTTPハンドラ。ロジックは `app/lib/` に委譲 |
| UI Components | `client/components/` / `components/` | 再利用可能UI。直接APIコール禁止（`components/` はフィルタUI等の共通部品） |
| Pages | `app/*/page.tsx` | 状態管理・API呼び出し・レイアウトのみ |
| Types | `types/` | 全レイヤー共通の型定義 |

### Critical Notes

- **データ単位**: 全金額は **1円単位**（千円単位ではない）。総予算 = 151,120,000,000,000円
- **「その他」vs「その他の支出先」**: 別ノード。"その他" = 支出先名が「その他」(~26兆円)、"その他の支出先" = TopN以外集計(~51兆円)
- **Import alias**: `@/*` はリポジトリルートにマップ（例: `@/types/structured`）
- **データ圧縮**: `.gz` のみGit管理（~11MB）、ビルド時に自動展開（~96MB）

## Skills（作業別エントリーポイント）

| 作業内容 | 使うスキル |
|---------|-----------|
| Sankey図の実装（/sankey-svg） | `/sankey` |
| データパイプライン・CSV処理・JSON生成 | `/pipeline` |
| lint + TypeScript チェック | `/quality-check` |
| CSVデータ更新→JSON生成→Git反映 | `/data-update` |

## Deployment

**本番 URL: https://rs-vis.team-mir.ai**（Vercel 既定 URL は marumie-rssystem-team-mirai.vercel.app）。
Vercel チーム `team-mirai` のプロジェクト `marumie-rssystem`（`prj_xRZPq22PXHNpf8zvDLtDZOFILr7e`）に
GitHub 連携済み（2026-09-12 に `infra/terraform/` の Terraform で作成）。
`main` への push → Vercel 自動ビルド（東京リージョン `hnd1`）となり、
`prebuild` フックが `.gz` → `.json` を自動展開する。
プロジェクト・環境変数の変更は Terraform で行う（手順は infra/terraform/README.md）。
Supabase はプロジェクト `marumie-rssystem`（ref `igtulishrosqdukrrixx`、東京）を作成済みで、
接続情報は Terraform が Vercel 環境変数へ自動配布する。スキーマは `supabase/schema.sql`（適用済み）。

### 事業コメント機能（AIインタビュー）

- `NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が揃った環境でのみ有効（専用フラグ無し）。無ければ API は 404、UI は非表示
- LLM は BYOK（訪問者の OpenRouter キー・ブラウザ直）。サーバは `app/api/projects/[pid]/comments` で保存・一覧のみ
- 設計: `docs/tasks/20260828_1508_事業コメント機能（みらい議会ライク）設計.md`

## Agent の行動ルール

- **PR は必ずユーザーの明示的な許可を得てから作成すること。** 実装・修正が完了しても、ユーザーから「PR を出してください」「PR お願いします」などの指示がない限り、自律的に PR を作成・プッシュしてはならない。
- コミットは実装完了のタイミングで行ってよいが、プッシュ・PR 作成は指示待ちとする。

## Documentation Standards

- **Task docs**（設計・調査・実装計画）: `docs/tasks/YYYYMMDD_HHMM_タイトル.md`
- **Architecture guides**（恒久的な参照ドキュメント）: `docs/*.md`

## Known Bugs / Limitations

- **Multi-block spending**: 支出先が同一事業の複数ブロックに出現する場合、`projects.find()` ではなく `projects.filter().reduce()` で金額を合算すること
