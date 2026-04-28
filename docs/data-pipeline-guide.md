# Data Pipeline Guide

RS System CSV → 各種JSON → 各ページ表示 までのデータパイプライン詳細。

---

## 0. ページ別パイプライン早見表

| ページ | 必要なデータファイル（public/data/） | 生成コマンド | 入力CSV |
|--------|--------------------------------------|--------------|---------|
| `/sankey` | `rs2024-structured.json.gz` | `normalize` → `generate-structured` → `compress-data` | 1-1, 1-2, 2-1, 5-1 |
| `/sankey-svg` | `sankey-svg-{YEAR}-graph.json.gz` | `normalize` → `generate-sankey-svg` → `compress-data` | 1-1, 2-1, 5-1, 5-2 |
| `/sankey2` | `sankey2-graph.json.gz`, `sankey2-layout.json.gz` | `normalize` → `generate-sankey2` → `compute-sankey2-layout` → `compress-data` | 1-1, 2-1, 5-1 |
| `/subcontracts` | `subcontracts-{YEAR}.json.gz` | `normalize` → `generate-subcontracts` → `compress-data` | 1-1, 2-1, 5-1, 5-2, 5-3 |
| `/quality` | `project-quality-scores-{YEAR}.json`, `project-quality-recipients-{YEAR}.json.gz` | `normalize` → `score-quality` → `compress-data` | 2-1, 5-1, 5-2 ＋ dictionaries/ |
| `/entities`, `/entities-v2` | `rs{YEAR}-project-details.json.gz`, `entity-labels-csv.json`, `entity-normalization.json`, `houjin-lookup.json` | `normalize` → `generate-project-details`（+ 別途entity生成） | 1-2 |
| `/mof-budget-overview` | `mof-budget-overview-2023.json`（Git管理済み） | `generate-mof-data`（通常再生成不要） | 財務省CSV（別途DL） |

> **Note**: `/sankey2` は現状 2024年度データのみ対応（スクリプト内ハードコード）。

---

## 1. 共通前処理: CSV正規化

すべてのパイプラインで **最初に実行が必要**。

```
data/download/RS_{YEAR}/*.zip   （手動ダウンロード）
  ↓ npm run normalize（2024年度）
  ↓ npm run normalize-2025（2025年度）
data/year_{YEAR}/*.csv           （UTF-8正規化済み、.gitignore）
```

### 1-1. 入力 CSV ファイル（全パイプライン共通）

取得元: `https://rssystem.go.jp/download-csv/{YEAR}`（または行政事業レビューシステムの公式サイト）

| ファイル名（正規化後） | 内容 | 使用するパイプライン |
|----------------------|------|---------------------|
| `1-1_RS_{YEAR}_基本情報_組織情報.csv` | 組織階層（府省庁〜係） | /sankey, /sankey-svg, /sankey2 |
| `1-2_RS_{YEAR}_基本情報_事業概要等.csv` | 事業概要・目的・実施方法等 | /sankey, /entities |
| `2-1_RS_{YEAR}_予算・執行_サマリ.csv` | 事業別予算額・執行額 | /sankey, /sankey-svg, /sankey2, /subcontracts, /quality |
| `5-1_RS_{YEAR}_支出先_支出情報.csv` | 支出先名・金額・法人番号等 | /sankey, /sankey-svg, /sankey2, /subcontracts, /quality |
| `5-2_RS_{YEAR}_支出先_支出ブロックのつながり.csv` | ブロック間の再委託関係 | /sankey-svg, /subcontracts, /quality |
| `5-3_RS_{YEAR}_支出先_費目・使途.csv` | 費目・使途（再委託用途） | /subcontracts |

**正規化ルール（適用順）**:
```python
1. neologdn.normalize(text)           # 日本語テキスト正規化（最優先）
2. convert_circled_numbers(text)      # ① → 1
3. unicodedata.normalize('NFKC', text)# Unicode正規化
4. convert_era_to_year(text)          # 令和5年 → 2023年、令和6年 → 2024年
5. convert_fullwidth_brackets(text)   # （） → ()
6. unify_hyphens(text)                # 各種ダッシュ → -
7. fix_hyphen_to_choon(text)          # ア- → アー
8. fix_katakana_choon(text)           # ア ー ー → アー
9. remove_consecutive_spaces(text)    # 連続スペース → 1個
```

---

## 2. パイプライン別詳細

### 2-1. `/sankey`（メインSankey図）

```
data/year_{YEAR}/（1-1, 1-2, 2-1, 5-1）
  ↓ npm run generate-structured
public/data/rs{YEAR}-structured.json（~96MB、.gitignore）
  ↓ npm run compress-data
public/data/rs{YEAR}-structured.json.gz（~11MB、Git管理）
```

| コマンド | スクリプト | 入力CSV |
|---------|-----------|---------|
| `npm run generate-structured` | `scripts/generate-structured-json.ts` | 1-1, 1-2, 2-1, 5-1 |

**生成内容**: 府省庁〜係の階層ツリー、事業別予算詳細、支出先情報、集計統計

---

### 2-2. `/sankey-svg`（SVG直接支出Sankey図）

```
data/year_{YEAR}/（1-1, 2-1, 5-1, 5-2）
  ↓ npm run generate-sankey-svg（2024年度）
  ↓ npm run generate-sankey-svg-2025（2025年度）
public/data/sankey-svg-{YEAR}-graph.json（.gitignore）
  ↓ npm run compress-data
public/data/sankey-svg-{YEAR}-graph.json.gz（Git管理）
```

| コマンド | スクリプト | 入力CSV |
|---------|-----------|---------|
| `npm run generate-sankey-svg` | `scripts/generate-sankey-svg-data.ts 2024` | 1-1, 2-1, 5-1, 5-2 |
| `npm run generate-sankey-svg-2025` | `scripts/generate-sankey-svg-data.ts 2025` | 同上（2025年度） |

**5-2が必要な理由**: `担当組織からの支出=TRUE` の判定で直接支出先を絞り込む

**特殊ノード `r-no-spending`**: 予算あり・直接支出先なし事業（2024: 264件 / 2025: 292件）は `r-no-spending`（「支出先なし」）ノードに接続される。`generate-sankey-svg-data.ts` が recipientMap へ `__no-spending__` エントリを追加し、`sankey-svg-filter.ts` が集約ノード処理時に考慮する。

---

### 2-3. `/sankey2`（事前計算レイアウトSankey図）

```
data/year_2024/（1-1, 2-1, 5-1）       ← 現在2024年度固定
  ↓ npm run generate-sankey2
public/data/sankey2-graph.json（.gitignore）
  ↓ npm run compute-sankey2-layout
public/data/sankey2-layout.json（~45MB、.gitignore）
  ↓ npm run compress-data
public/data/sankey2-graph.json.gz / sankey2-layout.json.gz（Git管理）
```

| コマンド | スクリプト | 入力CSV |
|---------|-----------|---------|
| `npm run generate-sankey2` | `scripts/generate-sankey2-data.ts` | 1-1, 2-1, 5-1（2024年度固定） |
| `npm run compute-sankey2-layout` | `scripts/compute-sankey2-layout.ts` | `sankey2-graph.json`（前ステップ出力） |

---

### 2-4. `/subcontracts`（再委託構造ブラウザ）

```
data/year_{YEAR}/（1-1, 2-1, 5-1, 5-2, 5-3）
  ↓ npm run generate-subcontracts（2024年度）
  ↓ npm run generate-subcontracts-2025（2025年度）
public/data/subcontracts-{YEAR}.json（.gitignore）
  ↓ npm run compress-data
public/data/subcontracts-{YEAR}.json.gz（Git管理）
```

| コマンド | スクリプト | 入力CSV |
|---------|-----------|---------|
| `npm run generate-subcontracts` | `scripts/generate-subcontracts.ts 2024` | 1-1, 2-1, 5-1, 5-2, **5-3** |
| `npm run generate-subcontracts-2025` | `scripts/generate-subcontracts.ts 2025` | 同上（2025年度） |

**5-3が必要な理由**: 費目・使途（再委託の目的分類）を付与するため

---

### 2-5. `/quality`（支出データ品質スコア）

```
data/year_{YEAR}/（2-1, 5-1, 5-2）
＋ public/data/dictionaries/（支出先名判定辞書）
  ↓ npm run score-quality（2024年度）
  ↓ npm run score-quality-2025（2025年度）
public/data/project-quality-scores-{YEAR}.json（Git管理、~4MB）
public/data/project-quality-recipients-{YEAR}.json（→ .gz のみGit管理）
```

| コマンド | スクリプト | 入力CSV |
|---------|-----------|---------|
| `npm run score-quality` | `scripts/score-project-quality.py --year 2024` | 2-1, 5-1, 5-2 |
| `npm run score-quality-2025` | `scripts/score-project-quality.py --year 2025` | 同上（2025年度） |

**辞書ファイル（`public/data/dictionaries/`）**:

| ファイル | 用途 |
|----------|------|
| `recipient_dictionary.csv` | 支出先名の valid/invalid 判定（厳密辞書） |
| `government_agency_names.csv` | 行政機関名（辞書invalidの中から救済） |
| `supplementary_valid_names.csv` | 大学名改組等（補助辞書） |
| `opaque_recipient_keywords.csv` | 不透明支出先名キーワード（軸5評価用） |

これらの辞書ファイルは `public/data/dictionaries/` に Git 管理されており、再生成不要。

**5軸スコア**:
- 軸1: 支出先名品質（辞書突合、重み40%）
- 軸2: 法人番号記入率（重み20%）
- 軸3: 予算・支出バランス（執行額との乖離、重み20%）
- 軸4: ブロック構造妥当性（再委託深度・不整合検出、重み10%）
- 軸5: 支出先名透明性（不透明キーワード割合、重み10%）

---

### 2-6. `/entities`・`/entities-v2`（事業詳細・エンティティブラウザ）

```
data/year_{YEAR}/（1-2のみ）
  ↓ npm run generate-project-details
public/data/rs{YEAR}-project-details.json（.gitignore）
  ↓ npm run compress-data
public/data/rs{YEAR}-project-details.json.gz（Git管理）
```

加えて以下のファイルが Git 管理済みで必要:

| ファイル | 生成コマンド | 備考 |
|----------|------------|------|
| `entity-labels-csv.json` | `npm run generate-entity-labels-csv` | 支出先エンティティラベル（~4MB） |
| `entity-normalization.json` | `npm run generate-entity-dict` | 表記揺れ正規化マッピング（~2.5MB） |
| `houjin-lookup.json` | `npm run build-houjin-lookup` | 法人番号照合テーブル（~2.4MB、任意） |

---

### 2-7. `/mof-budget-overview`（財務省予算全体ビュー）

```
data/download/mof_2023/（財務省CSVを手動ダウンロード・配置）
  ↓ npm run generate-mof-data
public/data/mof-budget-overview-2023.json（Git管理、~4KB）
public/data/mof-funding-2024.json（Git管理、~56KB）
```

| コマンド | スクリプト | 入力 |
|---------|-----------|------|
| `npm run generate-mof-data` | `scripts/generate-mof-budget-overview-data.ts` | `parse-mof-transfer-data.ts` 経由で `data/download/mof_2023/` を読む |

**入力 CSV（`data/download/mof_2023/` に配置）**:

| ファイル名 | 内容 |
|-----------|------|
| `DL202311001b.csv` | 一般会計歳出（項・目別） |
| `DL202312001a.csv` | 特別会計歳入（一般会計からの繰入等） |

取得元: 財務省「財政統計」CSVダウンロードページ（[bb.mof.go.jp/archive](https://www.bb.mof.go.jp/archive/)）  
ファイル命名規則: `DL{YYYY}{会計区分}{連番}a/b.csv`（`11`=一般会計歳出、`12`=特別会計歳入）

> **重要**: `generate-mof-budget-overview-data.ts` は CSV から完全自動生成ではなく、年金特別会計・地方交付税・国債整理基金等の金額詳細はスクリプト内にハードコードされている。データ年度を変更する場合は手動でのコード編集が必要。

> **通常は再生成不要**: `mof-budget-overview-2023.json` と `mof-funding-2024.json` はどちらも Git 管理済みで小サイズ。財務省の年度が変わらない限り更新不要。

---

## 3. 圧縮（compress-data）

**コマンド**: `npm run compress-data`

全パイプラインの生成物をまとめて圧縮する。`.gz` のみ Git 管理対象。

```bash
# 圧縮対象（package.json より）
rs2024-structured.json
rs2024-project-details.json
project-quality-recipients-2024.json
project-quality-recipients-2025.json
sankey2-graph.json / sankey2-layout.json
sankey-svg-2024-graph.json / sankey-svg-2025-graph.json
subcontracts-2024.json / subcontracts-2025.json
```

---

## 4. ビルド時展開（prebuildフック）

**トリガー**: `npm run build`

- `scripts/decompress-data.sh` が自動実行される
- `.gz` が `.json` より新しい場合のみ展開
- Vercel でも同様に動作

---

## 5. ディレクトリ構成

```
marumie-rssystem/
├── data/                       # ローカルデータ（.gitignore）
│   ├── download/RS_{YEAR}/     # ZIPダウンロード先
│   └── year_{YEAR}/            # 正規化済みCSV（normalize後）
├── public/data/
│   ├── *.json.gz               # Git管理（圧縮済みデータ）
│   ├── project-quality-scores-{YEAR}.json  # Git管理（小サイズ）
│   ├── entity-labels-csv.json  # Git管理（手動生成後コミット）
│   ├── entity-normalization.json  # Git管理
│   ├── houjin-lookup.json      # Git管理（任意）
│   ├── mof-budget-overview-2023.json  # Git管理（静的）
│   └── dictionaries/*.csv      # Git管理（辞書ファイル）
└── scripts/                    # データ生成スクリプト
```

---

## 6. デプロイ（Vercel）

**設定** (`vercel.json`):
```json
{ "buildCommand": "npm run build", "framework": "nextjs", "regions": ["hnd1"] }
```

**フロー**:
1. `git push origin main` → GitHub webhook → Vercel ビルド開始
2. `npm install`
3. `npm run build`:
   - `prebuild`: `.gz` を展開（decompress-data.sh）
   - TypeScript コンパイル / Next.js バンドル
4. Edge Network にデプロイ

**重要**: Vercel へのデプロイには `.gz` ファイルが Git にコミットされていること必須。ローカルの非圧縮 JSON は `.gitignore` 対象のため、`compress-data` → `git add *.gz` → `git push` が必要。

---

## 7. トラブルシューティング

| 症状 | 対処 |
|------|------|
| データ 404 エラー | `npm run build` 完了確認。`decompress-data.sh` のログ確認 |
| `neologdn not installed` | `pip3 install neologdn` を実行 |
| 5-1 等 CSV が見つからない | 取得元サイトからZIPをDLして `data/download/RS_{YEAR}/` に配置し `npm run normalize` |
| quality スコアが生成されない | `data/year_{YEAR}/` に 2-1, 5-1, 5-2 CSV があるか確認 |
| TypeScript エラー | `types/rs-system.ts` の型定義と CSV のヘッダーが一致しているか確認 |
| JSON が小さすぎる（<1MB） | 正規化・生成スクリプトのエラーログを確認 |
