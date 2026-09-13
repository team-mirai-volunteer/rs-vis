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

## 1. 共通前処理: RS CSV の取得と展開

すべてのパイプラインで **最初に実行が必要**。

```
https://rssystem.go.jp/download-csv/{YEAR}   （JS描画・ZIPはクリック要素）
  ↓ node scripts/download-rs-csv.mjs {YEAR} [接頭辞...]   … Playwright(Chromium)でZIPを取得
data/download/RS_{YEAR}/*.zip                 （.gitignore）
  ↓ python scripts/extract-rs-csv.py {YEAR}                … 文字コード判定してUTF-8で展開
data/year_{YEAR}/*.csv                        （.gitignore）
```

2025年度は `npm run download-rs-csv-2025` で上の2段を一括実行する（1-1/1-2/2-1/2-2/5-1/5-2/5-3）。
ダウンロードページはJS描画で `<a>` リンクが無いため、curl等では取得できない。

CSVヘッダの括弧は取得時期により全角・半角が揺れる（同一ファイル内で混在することもある）。
読み取り側 `scripts/csv-reader.ts` がヘッダだけ NFKC 正規化するので、各スクリプトは半角表記
（例: `予算額(歳出予算項目ごと)`）で列名を参照する。データ本体は生値のまま。

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

> **注記**: この節の記述は初期実装（2023年度・ハードコード）時点のもので古い。現行の `generate-mof-budget-overview-data.ts` は
> 2017〜2026年度を予算書ZIP同梱CSVから全自動生成し、ハードコードは無い（詳細はスクリプト先頭コメント）。
> MOF系の他パイプライン（`generate-mof-jikou` / `generate-mof-kou-moku` / `generate-mof-section-pages` / `generate-mof-budget`）も同様に
> スクリプト先頭コメントを参照。

---

### 2-8. MOF目 ↔ RS事業 紐づけ（`/mof-sankey`・`/mof-kou`・`/mof-kou-moku`、統合ビューの基盤）

```
public/data/mof-kou-moku-{予算年度}.json（.gz を展開）
data/year_{シート年度}/1-1, 2-2
  ↓ tsx scripts/generate-mof-rs-kou-moku-linkage.ts --sheet {シート年度} --budget-year {予算年度}
public/data/mof-rs-kou-moku-linkage-{予算年度}.json      （.gz を Git 管理）
public/data/mof-rs-linkage-unmatched-{予算年度}.json      （未一致全件・ローカル診断用・Git 管理外）
```

**RSシート年度と予算年度の関係**（設計: `docs/tasks/20260913_0428_財務省予算書とRS事業の完全統合サンキー設計.md` 1.5・3.6）

RSシートNの 2-2 は予算年度 N-4〜N の行を持つが、項・目が充足しているのは予算年度N（99%）と、
N-1シートから引き継がれたN-1行だけ。予算年度N行には N+1 年度の**要求額が目単位**で入っている。
1枚のシートから3つの予算年度を生成する:

| 予算年度 | 2-2 の行 | rsAmount | MOF側 | 用途 |
|---|---|---|---|---|
| N-1（例: 2024） | 予算年度N-1行 | 予算額（当初・補正） | 当初・補正・決算（引き継ぎ） | 執行・支出先まで揃う完全統合 |
| N（例: 2025） | 予算年度N行 | 予算額（当初・補正） | 当初・補正 | 予算のみ |
| N+1（例: 2026） | 予算年度N行 | **翌年度要求額** | 当初予算 | 要求→査定対比（`metadata.rsAmountKind = 'request'`） |

`npm run generate-mof-rs-kou-moku-linkage` は 2025シートから 2024/2025/2026 の3表をまとめて生成する。
予算年度2023以前はシートが旧様式で項・目が半分以上空欄のため、カバレッジは構造的に低い（2023: 金額47.7%）。

**出力の要点**
- `links[]`: 事業×目の紐づけ。同名キーで項・目コードが異なる目が複数ある場合は目額比で按分し `ambiguous=true`
- `projects[]`: 事業ごとの合計（紐づいた額・未一致額・繰越/予備費等の項目無し額 `rsAmountNoSubject`）
- `metadata.unmatched`: RS側（項・目空欄 / MOFに同名キー無し）とMOF側（RS事業が付かない目）の要約と上位50件
- `metadata.coverage.kouMokuAmountByBudgetType`: MOF目の総額と紐づいた額を予算種別ごとに（補正は改予算額なので当初と足さない）

**実測（2025シート）**: RS金額カバレッジ 2024: 97.7% / 2025: 97.8% / 2026要求: 95.9%。未一致のほぼ全てはRS側の項・目空欄行。

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
