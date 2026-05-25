---
allowed-tools: Bash(npm run generate-sankey-svg:*), Bash(npm run generate-sankey-svg-2025:*), Bash(npm run generate-subcontracts:*), Bash(npm run generate-subcontracts-2025:*), Bash(npm run generate-mof-data:*), Bash(npm run generate-project-details:*), Bash(npm run score-quality:*), Bash(npm run score-quality-2025:*), Bash(npm run compress-data:*), Bash(ls:*), Read
description: データパイプライン・CSV処理・JSON生成の実装を行う
---

## タスク

1. データパイプライン全体像が必要な場合は [docs/data-pipeline-guide.md](docs/data-pipeline-guide.md) を読み込む
2. ユーザーの指示に従って実装・調査を行う

## 公開4ページのデータ生成スクリプト

| File | 出力 |
|------|------|
| `scripts/generate-sankey-svg-data.ts` | `sankey-svg-{2024,2025}-graph.json`（/sankey-svg 用） |
| `scripts/generate-subcontracts.ts` | `subcontracts-{2024,2025}.json`（/subcontracts 用） |
| `scripts/generate-mof-budget-overview-data.ts` | `mof-budget-overview-2023.json`（/mof-budget-overview 用） |
| `scripts/generate-project-details.ts` | `rs{2024,2025}-project-details.json`（/api/project-details 用） |
| `scripts/score-project-quality.py` | `project-quality-{scores,recipients}-{2024,2025}.json`（/quality 用） |

### ユーティリティ・補助

| File | 役割 |
|------|------|
| `scripts/csv-reader.ts` | Shift-JIS CSV reader（sankey-svg/subcontracts 生成で使用） |
| `scripts/parse-mof-transfer-data.ts` | MOF繰入データパース（mof-data 生成で使用） |
| `scripts/validate-mof-transfer-data.ts` | MOFデータ整合性検証（手動チェック） |
| `scripts/decompress-data.sh` | prebuild フックで `.gz` を `.json` に展開 |

## データ所在地

| 種別 | パス |
|------|------|
| Source CSV | `data/download/RS_{YEAR}/`（rssystem.go.jp から手動DL、`.gitignore`） |
| SVG Graph | `public/data/sankey-svg-{YEAR}-graph.json(.gz)` |
| Subcontracts | `public/data/subcontracts-{YEAR}.json(.gz)` |
| MOF Overview | `public/data/mof-budget-overview-2023.json` |
| Project Details | `public/data/rs{YEAR}-project-details.json(.gz)` |
| Quality Scores | `public/data/project-quality-scores-{YEAR}.json` + `project-quality-recipients-{YEAR}.json(.gz)` |
| 辞書 CSV | `public/data/dictionaries/*.csv`（Git 管理、`score-project-quality.py` の参照元） |

## パイプラインコマンド

```bash
# SVG Sankey
npm run generate-sankey-svg         # 2024年度
npm run generate-sankey-svg-2025    # 2025年度

# 再委託構造
npm run generate-subcontracts       # 2024年度
npm run generate-subcontracts-2025  # 2025年度

# MOF予算全体
npm run generate-mof-data

# 事業詳細
npm run generate-project-details

# 品質スコア
npm run score-quality               # 2024年度
npm run score-quality-2025          # 2025年度

# Gzip圧縮（コミット前に必須）
npm run compress-data
```

## レイヤー設計ルール

- `scripts/` はCSV処理・JSON生成のみ。UIロジック・APIロジック禁止
- 生成した `.json` は `npm run compress-data` で `.gz` を更新してから Git に積む
- `.json` 本体は `.gitignore` 対象、`.json.gz` のみGit管理
