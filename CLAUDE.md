# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
# 開発
npm run dev              # Dev server (localhost:3002, Turbopack)
npm run build            # Production build（prebuildで.gzを自動展開）
npm run lint             # ESLint チェック
npx tsc --noEmit         # TypeScript 型チェック

# データパイプライン（CSVファイル更新後）
npm run normalize        # CSV正規化（要: pip3 install neologdn）
npm run generate-structured  # rs2024-structured.json 生成（~96MB）
npm run compress-data    # Gzip圧縮（Git管理用）

# Sankey2パイプライン（5-1/5-2 CSVから直接生成）
npm run generate-sankey2         # sankey2-graph.json 生成（~25MB）
npm run compute-sankey2-layout   # sankey2-layout.json 生成（~45MB）
# compress-data で graph.json.gz / layout.json.gz も圧縮される

# 法人番号照合データ（支出先ブラウザ用・オプション）
# 事前に data/download/houjin-bangou/ に国税庁ZIPを配置
# 取得元: https://www.houjin-bangou.nta.go.jp/download/zenken/index.html
npm run build-houjin-db      # ZIP → SQLite（~1GB、初回のみ・約44秒）
npm run build-houjin-lookup  # SQLite → data/houjin-lookup.json（約4秒）
```

## Architecture

日本の2024年度予算・支出データをインタラクティブなSankey図で可視化する Next.js アプリ。

**Key Statistics**: 151.12兆円 総予算 / 5,003事業 / 26,823支出先（予算年度2023実績・再委託先含む）

### Layer Design Rules

| Layer | Directory | 役割 |
|-------|-----------|------|
| Data Pipeline | `scripts/` | CSV処理のみ。UIやAPIロジック禁止 |
| Domain Logic | `app/lib/` | Pure Sankey生成。HTTP・React禁止 |
| API Layer | `app/api/` | HTTPハンドラ。ロジックは `app/lib/` に委譲 |
| UI Components | `client/components/` | 再利用可能UI。直接APIコール禁止 |
| Pages | `app/*/page.tsx` | 状態管理・API呼び出し・レイアウトのみ |
| Types | `types/` | 全レイヤー共通の型定義 |

### Critical Notes

- **データ単位**: 全金額は **1円単位**（千円単位ではない）。総予算 = 151,120,000,000,000円
- **「その他」vs「その他の支出先」**: 別ノード。"その他" = 支出先名が「その他」(~26兆円)、"その他の支出先" = TopN以外集計(~51兆円)
- **Import alias**: `@/*` はリポジトリルートにマップ（例: `@/types/structured`）
- **データ圧縮**: `.gz` のみGit管理（~11MB）、ビルド時に自動展開（~96MB）

## Main Entry Points

### /sankey（動的生成版）

| File | Purpose |
|------|---------|
| [app/sankey/page.tsx](app/sankey/page.tsx) | メインUI・状態管理・ノードインタラクション |
| [app/lib/sankey-generator.ts](app/lib/sankey-generator.ts) | Sankey生成コアロジック |
| [app/api/sankey/route.ts](app/api/sankey/route.ts) | 動的Sankeyデータエンドポイント |

### /sankey-svg（SVGベース直接支出版）

| File | Purpose |
|------|---------|
| [app/sankey-svg/page.tsx](app/sankey-svg/page.tsx) | メインUI・状態管理・フィルタ・描画（TopN・予算/支出フィルタ・府省庁フィルタ・Pin・ミニマップ・検索） |
| [client/components/SankeySvg/MinimapOverlay.tsx](client/components/SankeySvg/MinimapOverlay.tsx) | ミニマップオーバーレイ |
| [app/lib/sankey-svg-filter.ts](app/lib/sankey-svg-filter.ts) | グラフフィルタリングロジック（r-no-spending 昇格含む） |
| [app/lib/sankey-svg-constants.ts](app/lib/sankey-svg-constants.ts) | 色定数・レイアウト定数 |
| [scripts/generate-sankey-svg-data.ts](scripts/generate-sankey-svg-data.ts) | 1-1/2-1/5-1/5-2 CSV → graph.json 生成（r-no-spending ノード含む） |

### /sankey2（事前計算版）

| File | Purpose |
|------|---------|
| [app/sankey2/page.tsx](app/sankey2/page.tsx) | Sankey2 UI・Canvas描画・ノードインタラクション |
| [client/components/Sankey2/Sankey2View.tsx](client/components/Sankey2/Sankey2View.tsx) | Sankey2メインコンポーネント（BFS・パネル・描画） |
| [client/components/Sankey2/types.ts](client/components/Sankey2/types.ts) | Sankey2専用型定義 |
| [scripts/generate-sankey2-data.ts](scripts/generate-sankey2-data.ts) | 5-1/5-2 CSV → graph.json 生成 |
| [scripts/compute-sankey2-layout.ts](scripts/compute-sankey2-layout.ts) | graph.json → layout.json（座標計算） |

### 共通

| File | Purpose |
|------|---------|
| [scripts/](scripts/) | CSV正規化・JSON生成パイプライン |

## Data Location

- **Source CSV**: `data/download/RS_2024/`（rssystem.go.jp から手動DL）
- **Normalized CSV**: `data/year_2024/`（自動生成、.gitignore）
- **Structured JSON**: `public/data/rs2024-structured.json`（~96MB、.gitignore）
- **Compressed JSON**: `public/data/rs2024-structured.json.gz`（~11MB、Git管理）
- **Sankey2 Graph**: `public/data/sankey2-graph.json(.gz)`（5-1/5-2 CSVから生成）
- **Sankey2 Layout**: `public/data/sankey2-layout.json(.gz)`（graph.jsonから座標計算）

## Deployment

`main` ブランチへの push → Vercel 自動ビルド（東京リージョン `hnd1`）。
`prebuild` フックが `.gz` → `.json` を自動展開。

## Git Hooks

現在は未設定。`pre-push` で lint を自動実行することを推奨（[導入計画](docs/tasks/20260214_0805_ハーネスエンジニアリング導入計画.md) 参照）。

## Documentation Standards

- **Task docs**（設計・調査・実装計画）: `docs/tasks/YYYYMMDD_HHMM_タイトル.md`
- **Architecture guides**（恒久的な参照ドキュメント）: `docs/*.md`

## 修正時に読むべきガイド

| 修正対象 | 読むべきガイド |
|---------|---------------|
| Sankey生成ロジック・UI・ノード処理 | [docs/sankey-architecture-guide.md](docs/sankey-architecture-guide.md) |
| sankey-svg フィルタ・レイアウト・ノード処理 | [app/lib/sankey-svg-filter.ts](app/lib/sankey-svg-filter.ts) + [app/lib/sankey-svg-constants.ts](app/lib/sankey-svg-constants.ts) |
| データパイプライン・CSV処理・JSON生成 | [docs/data-pipeline-guide.md](docs/data-pipeline-guide.md) |
| APIエンドポイント仕様 | [docs/api-guide.md](docs/api-guide.md) |

## Known Bugs / Limitations

- **Multi-block spending**: 支出先が同一事業の複数ブロックに出現する場合、`projects.find()` ではなく `projects.filter().reduce()` で金額を合算すること
- **Sankey2 再委託エッジ**: 支出先ノードのみでは再委託チェーンの27.3%が表現不可能（ブロックノード層導入で解決予定。詳細: [docs/tasks/20260322_1751_再委託チェーン表現の限界と次のステップ.md](docs/tasks/20260322_1751_再委託チェーン表現の限界と次のステップ.md)）
